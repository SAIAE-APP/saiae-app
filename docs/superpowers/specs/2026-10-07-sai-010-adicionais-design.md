# SAI-010 — Adicionais e variações (design)

Data: 2026-10-07. Fonte: `PLANO-AGIL-SAIAE.md` (SAI-010). Status: **aprovado pelo dono em 07/10/2026; sem código nem migration até a liberação do CI (SAI-004).**

Base auditada: `origin/main` (a863b91). Hoje o item é plano (`src/types/database.ts`), `itens_do_pedido` só tem `observacao`, e `criar_pedido` (última versão em `20261008120000_aviso_pedido_pronto.sql`) lê só `item_id`, `nome_item`, `quantidade`, `preco_centavos_unitario`, `entrega_direta`, `observacao`. O cardápio público usa carrinho `Record<itemId, quantidade>`; `criar-pagamento-pix` e `webhook-mercadopago` carregam só `item_id` + `quantidade` e conferem o total no servidor.

## Decisões do dono
1. Preço da **variação é absoluto** (substitui o preço base do item).
2. **Sem quantidade por opção** na v1 (o snapshot reserva o campo).
3. **Meio a meio e combos** estão fora de escopo.
4. A mudança de contrato (eventos e `GET /cardapio`) vai em PR próprio, aditivo na v1.

## Achado que simplifica
`criar_pedido` recebe `p_itens` como jsonb e ignora chaves desconhecidas. As escolhas do cliente viajam numa chave `opcoes` dentro de cada linha, **sem argumento novo**. A v9 mantém a assinatura de 12 argumentos da v8: sem `DROP`, sem PGRST202, sem degrau novo em `useSincronizacao`. Servidor velho com app novo ignora a chave. `pagamentos_pendentes.itens` já é jsonb e o webhook repassa `pendente.itens` ao `criar_pedido`, então o snapshot atravessa o Pix sem mudar o webhook.

## 1. Schema (tudo aditivo, `barraca_id` e RLS no padrão de `itens`)
- `grupos_opcoes`: `id`, `barraca_id`, `nome`, `tipo` (`'variacao'` | `'adicional'`), `min_escolhas` int default 0, `max_escolhas` int null (null = sem limite), `ordem`, `ativo`. "Obrigatório" é derivado: `min_escolhas >= 1`. **Regra fixa na v1 (Frente A):** no máximo **um** grupo `tipo = variacao` por item e, nele, `min_escolhas = 1` e `max_escolhas = 1`; só `adicional` pode ter outros min/max. Garantida em três camadas: validação no cadastro (Ajustes), no `resolver_carrinho` e, como rede de segurança, por constraint/trigger no banco (`variacao` ⇒ min = max = 1; máximo de um grupo `variacao` por item em `itens_grupos`).
- **Item não pedível:** se um grupo obrigatório (`min_escolhas >= 1`) do item tem **todas** as opções esgotadas ou inativas, o item não pode ser pedido. O cardápio público o mostra como indisponível, o `resolver_carrinho` o recusa e `GET /cardapio` do contrato o **omite**.
- `opcoes`: `id`, `grupo_id`, `barraca_id`, `nome`, `preco_centavos >= 0`, `ordem`, `ativo`, `esgotado`. Em adicional o preço é **delta**; em variação é **absoluto** e substitui `itens.preco_centavos`, que vira "a partir de".
- `itens_grupos` (`item_id`, `grupo_id`, `ordem`): um grupo reutilizável em vários itens.
- `itens_do_pedido.opcoes jsonb not null default '[]'`: snapshot imutável `[{grupo_id, grupo_nome, tipo, opcao_id, nome, preco_centavos}]` (campo `quantidade` reservado, fixo em 1 na v1). `preco_centavos_unitario` continua sendo o preço **final** da unidade (variação ou base + adicionais), então totais, Pix, relatórios e NFC-e atuais seguem corretos. Opção renomeada ou removida depois não altera pedido antigo. Opção nunca é apagada: `ativo = false`.
- `barracas.opcoes_habilitado boolean not null default false`: flag de rollout por loja. Item sem grupo segue o fluxo de hoje.
- Estoque: a baixa segue por `item_id` × quantidade (triggers atuais intactos). Estoque por opção fica fora; só `opcoes.esgotado`, que desabilita a opção no seletor.

## 2. Resolução de preço no servidor (fonte única)
Função SQL `STABLE` `resolver_carrinho(p_barraca_id uuid, p_linhas jsonb)`.
- Entrada: `[{item_id, quantidade, opcao_ids[], observacao}]`.
- Valida: item ativo e não esgotado, grupos ligados ao item, no máximo um grupo `variacao` por item e (nele) min = max = 1, grupo obrigatório com ao menos uma opção disponível, opção ativa e não esgotada, min/max por grupo, sem duplicata, no máximo 20 opções por linha, observação até 120 caracteres.
- Saída: linhas resolvidas `{item_id, nome_item, quantidade, preco_centavos_unitario, opcoes[snapshot], observacao}`, ou erro por item.

`criar-pedido-cardapio` e `criar-pagamento-pix` trocam o bloco "preço do cadastro" por uma chamada a essa RPC (service role). O cliente só manda ids; preço, nome e total nunca vêm dele. O `total_esperado_centavos` existente (409) já cobre mudança de preço de adicional entre a tela e o Pix.

## 3. `criar_pedido` v9 (mesma assinatura da v8)
`create or replace`. Única mudança: grava `opcoes` de cada linha, sanitizada (array, até 20 elementos, só as chaves conhecidas, preço inteiro ≥ 0).
- **Operador e fila offline:** o snapshot do aparelho vale, igual ao preço hoje. Não revalida nem recusa (pedido da fila offline nunca é recusado por regra de catálogo).
- **Público e Pix:** o servidor já resolveu pela RPC, então o snapshot é confiável.
- **Rollback:** recriar a v8; as colunas ficam inertes.

## 4. Compatibilidade
- **Ordem de deploy:** (1) migration, (2) edge functions, (3) app. A loja só liga `opcoes_habilitado` depois, então nenhum carrinho com opções existe antes do banco estar pronto.
- **App novo + servidor velho:** não ocorre pelo gate acima. Se ocorresse, a chave extra é ignorada e o preço unitário final já está certo; só se perderia o texto das opções.
- **APK antigo (versionCode 13) + banco novo:** vende item simples normalmente; em item com grupo obrigatório venderia sem escolha. Mitigação: ligar `opcoes_habilitado` só em loja cujos aparelhos estão no build novo. O rigor de min/max vale só no cardápio público; operador e offline são tolerantes.
- **Fila offline:** payloads antigos (sem `opcoes`) seguem válidos; payload novo funciona na v8 e na v9. Os degraus PGRST202 atuais ficam intocados.

## 5. Cardápio público, Pix, webhook
- **Cardápio público:** o carrinho vira linhas `{key, item_id, opcao_ids[], qtd, obs}`. Para item simples `key = item_id`, preservando o comportamento atual. Mesmo item com opções diferentes = linhas diferentes. Item com grupos abre um seletor (bottom sheet) com min/max validados ao vivo e total da linha; item simples mantém o +/− de hoje. Grupos e opções vêm junto do cardápio, com policy anon de leitura só dos ativos (espelha `itens`). O estado local do carrinho migra de forma trivial.
- **`criar-pagamento-pix`:** aceita `opcao_ids` e `observacao` por linha, chama `resolver_carrinho` e grava no pendente `itens` com `opcoes`. Total e 409 continuam.
- **`webhook-mercadopago`:** sem mudança de lógica. O pendente já carrega o snapshot e o preço fica congelado na cobrança. Só o tipo `ItemPendente` ganha `opcoes?` opcional.
- **`criar-pedido-cardapio` (pagar na entrega):** igual ao Pix; passa a aceitar `observacao` por item.

## 6. Fatiamento
**SAI-010a — modelo, cadastro, cardápio, pedido (~8 pts):**
- migration das tabelas e colunas, RLS e flag;
- `resolver_carrinho` e `criar_pedido` v9;
- cadastro em Ajustes/Cardápio (grupos, opções, ligar a itens, copiar grupo, modelos prontos "Tamanho P/M/G" e "Adicionais"), **recusando** variação com min/max diferentes de 1 e um segundo grupo de variação no mesmo item, e avisando quando um grupo obrigatório fica sem opção disponível;
- seletor no cardápio público e a mesma tela no Lançar Pedido do operador (sem ela, item com grupo obrigatório não vende no balcão);
- as 3 edge functions;
- testes: regra min/max do resolvedor, 422 e 409 nas functions, snapshot imutável, payload antigo na fila.

**SAI-010b — exibição e relatório (~5 pts), em branch própria depois da 010a:**
- Cozinha, `DetalheComanda`, comanda do entregador, Histórico;
- impressão térmica e auto-impressão (opções indentadas sob o item);
- relatório de vendas por variação e adicional, e exportações;
- NFC-e: linha única do item, opções só na descrição, NCM do item pai;
- popularidade.

**Gate:** sem a 010b a Cozinha não mostra as opções. A 010a vai para staging com `opcoes_habilitado` desligado e só liga em loja real depois da 010b.

## 7. Contrato
Mudança aditiva na v1, em PR próprio (aprovação das duas frentes): `order.*` ganha `itens[].opcoes[]`; `GET /cardapio` ganha `grupos[]` com `opcoes[]`. A SAI-050 (pedido conversacional) depende disso.

Ajustes aprovados pela Frente A (CRM) no PR #45: a regra de variação única e o item não pedível (omitido de `GET /cardapio`); `opcao_escolhida.quantidade` é `integer >= 1`, "sempre 1 na v1", e o leitor deve tolerar valores maiores. Na v1.1 (`POST /rascunhos-pedido`) a resposta devolve o **preço final por linha e o `total_centavos` já resolvidos pela Comanda**, para a IA nunca somar sozinha (ADR-06). Os CIs validam os schemas e exemplos com Ajv draft 2020-12 (`ajv/dist/2020`) + `ajv-formats` (format `uuid`).

## 8. Fora de escopo
Quantidade por opção, meio a meio, combos, estoque por opção.
