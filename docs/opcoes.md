# Adicionais e variações (SAI-010a)

Spec de origem: `docs/superpowers/specs/2026-10-07-sai-010-adicionais-design.md`. Contrato: `INTEGRACAO.md` §3.1.
Este documento descreve o que existe no código e como operar.

## Modelo (v1)

- `grupos_opcoes` (`tipo` = `variacao` | `adicional`, `min_escolhas`, `max_escolhas`), `opcoes` (preço, `ativo`, `esgotado`) e `itens_grupos` (liga item ↔ grupo).
- **Variação:** no máximo **uma** por item; sempre `min = max = 1`; o preço da opção é **absoluto** e substitui o preço base. **Adicional:** preço é soma; min/max livres.
- **Item não pedível:** grupo obrigatório (`min >= 1`) com todas as opções esgotadas ou inativas.
- Sem quantidade por opção na v1 (o snapshot reserva o campo, fixo em 1).
- A loja só usa isso com `barracas.opcoes_habilitado = true` (padrão `false`). Sem isso o item é plano, como sempre foi.
- Cada linha do pedido guarda o snapshot em `itens_do_pedido.opcoes`, e `preco_centavos_unitario` é o preço final da unidade.

## Fluxo no cardápio público e no Pix

1. O navegador manda só ids: `itens: [{ item_id, quantidade, opcao_ids?, observacao? }]`.
2. `criar-pedido-cardapio` e `criar-pagamento-pix` montam as linhas (`_shared/carrinho.ts`, junta linhas idênticas) e chamam o RPC **`resolver_carrinho`** com a chave de serviço. O banco devolve preço, nome, snapshot das opções e total, ou os erros por linha.
3. Erros: carrinho malformado = 400 `Itens inválidos`; barraca inexistente = 404; indisponibilidade e regras de grupo = 422 com a mensagem do banco.
4. Pix: o resultado (com `opcoes`) vira o `itens` do `pagamentos_pendentes`. O **webhook não muda**: repassa `pendente.itens` ao `criar_pedido`, e o preço fica congelado no momento da cobrança.
5. `criar_pedido` v9 (mesma assinatura da v8) grava o snapshot sanitizado. Operador e fila offline mandam o snapshot do aparelho e **nunca são recusados** por regra de catálogo.

O estoque continua nas edge functions (por `item_id` × quantidade, somando as linhas do mesmo item).

## Ordem de deploy

1. Migrations `20261015100000`, `20261015101000`, `20261015110000` (nessa ordem).
2. Edge functions `criar-pedido-cardapio` e `criar-pagamento-pix`.
3. App.

**Não** faça o passo 2 antes do 1: as functions chamam `resolver_carrinho` e, sem ele, respondem 500 `Falha ao carregar o cardápio`. Só ligue `opcoes_habilitado` em loja depois da SAI-010b (a Cozinha ainda não mostra as opções) e com os aparelhos no build novo.

## Janela residual (conhecida e aceita)

O `resolver_carrinho` roda **imediatamente antes** do `criar_pedido` (ou da gravação do pendente do Pix), mas são chamadas separadas, sem transação única. Se o dono esgotar um item ou mudar um preço nesse intervalo de milissegundos, o pedido nasce com o valor resolvido um instante antes. É a mesma janela que o cardápio já tinha antes desta mudança (as functions liam o cadastro e só depois chamavam o `criar_pedido`).

Por que não revalidar dentro do `criar_pedido`: ele também é o caminho do operador e da fila offline, que nunca podem ser recusados por regra de catálogo, e o preço do Pix é congelado na cobrança por desenho. Fechar a janela de verdade exigiria uma RPC pública transacional própria; decisão do orquestrador, hoje fora do escopo.

## Biblioteca de modelos e kits iniciais

Atrás de `VITE_ONBOARDING_KITS=1`. `src/lib/modelosDeOpcoes.ts` tem 31 modelos de grupo (Tamanho em várias versões, Ponto da carne, Mistura do PF, Borda, Molhos, Coberturas e Extras de açaí, Temperatura etc.), cada um com regra (variação ou adicional, obrigatório, mínimo e máximo) e os tipos de negócio a que pertence. Em **Ajustes › Opções › "Usar modelo"** o dono vê primeiro os do tipo de negócio da loja; tocar abre o formulário já preenchido, sem preços. O formulário de grupo tem **"Mínimo de escolhas"** para adicional obrigatório (ex.: combo de 3 sabores). O onboarding monta um cardápio de exemplo com esses modelos: ver `CLAUDE.md` ("Kits iniciais") e a spec `2026-10-09-kits-iniciais-design.md`.

O que o modelo atual **não** resolve (fase seguinte): meio a meio com preço pelo maior sabor, quantidade por opção, opções que mudam com o tamanho, "primeiros N grátis" no mesmo grupo e estoque por opção. O kit não inventa contorno para isso.

## Testes

- `tests/opcoesResolver.test.ts`: migration real no PGlite (constraints, multi-tenant, RLS, permissões, regras do resolver, contrato com `_shared/carrinho.ts`).
- `tests/criarPedidoV9.test.ts`: cadeia v8 → schema → v9.
- `tests/carrinhoEdge.test.ts`: lógica pura das edge functions.
