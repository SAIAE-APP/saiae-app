# Relatório de execução: cardápio com hierarquia (2026-10-27)

Branch `feat/cardapio-hierarquia` (a partir de `origin/main` em 3b9c10e). Plano e spec nesta mesma pasta e em `docs/superpowers/specs/`.

## O que foi feito por tarefa

| Tarefa | Resultado | Commit |
|---|---|---|
| 1. Migration do destaque | `20261105100000_destaque_cardapio.sql`: coluna `barracas.item_destaque_id` (on delete set null) e RPC `destaque_publico(slug)`. Teste em PGlite (inclui item de outra barraca, inativo, preço aberto, apagar item). Aplicada SÓ no staging (`qzcqwovbbylqxljcrqhk`) por `apply_migration`; conferida por SQL (coluna existe, RPC devolve 0 linhas para slug inexistente). | 7a60477 |
| 2, 3 | `resolverDestaque`, `lojaAberta`, `estadoBotaoPedir` e `itensElegiveisParaDestaque` puros, com testes (19 casos, incluindo janela que cruza a meia-noite, sem horário e preço zero). | segundo commit |
| 4. Ajustes | `SeletorItemDestaque` (select nativo com rótulo, 44px, salva na hora, mantém o item atual como "(indisponível)"); tipo `item_destaque_id`. | terceiro commit |
| 5, 6, 7. Componentes e página | `BotaoPedir` e `CardDestaque`; `BotaoAdicionar` e `BotaoAdicionarCompacto` removidos; botão mostarda de 44px em todo card (largura total nos cards horizontais); Mais pedidos antes de Populares; bloco destaque; carrinho tinta com pill claro; botões desabilitados fora do horário (relógio recalculado ao voltar o foco). | ac3d94c |
| 8. Métrica | `docs/consulta-pedidos-cardapio-semana.sql`; executada no staging (devolve linhas). Não existe coluna de origem em `pedidos`: usa pagamento aprovado ligado ao pedido OU observação 'PAGAR NA ENTREGA%'. Limites declarados no arquivo. | 4ab3f4d |
| 9. CLAUDE.md | Leitura A de "um primário por tela" e trecho "Hierarquia do cardápio público". | 4ab3f4d |

Revisão: um subagente revisor (sonnet) leu o branch. Sem críticos. Ajustes aplicados depois: comentário de `SecaoCardapioDigital` voltou ao lugar e o stepper ganhou `min-h-11` (evita o card encolher ao adicionar).

## Verificação (saída resumida)

- `npm test`: tests 1858, pass 1858, fail 0 (inclui `tests/icones.test.ts`).
- `npm run lint`: 0 erros, 13 avisos (teto 13, igual ao de antes).
- `npm run build`: `tsc -b` sem erro, `vite build` concluído, PWA gerado.
- Nenhum ícone novo (fonte não alterada).

## Validação visual: NÃO FEITA

`npm run dev:staging` exige `.env.staging.local` (URL e chave anon do staging), que não existe neste worktree. A regra do trabalho proibia ler ou escrever `.env*`, e não coloquei a chave na linha de comando. O `agent-browser` não foi usado. Nada do visual a 360px foi conferido: o portão de aceite visual (amarelo demais? primeira tela?) continua pendente e é do João em celular real.

## Rulings

1. Subagentes: implementei as tarefas eu mesmo, em sequência, no mesmo worktree (evita conflito em `CardapioPublico.tsx`) e usei um subagente só para a revisão final. Motivo: custo e tarefas pequenas.
2. Tarefas 6 e 7 foram feitas e commitadas juntas (mesmo arquivo); 5 foi junto delas porque os componentes só compilam sem aviso quando usados.
3. `item_destaque_id` ficou opcional (`?`) no tipo `Barraca`, como outras colunas recentes (banco sem migration não quebra o cache).
4. RLS: a policy de update de `barracas` é por linha, não por coluna; o dono salva a coluna nova pelo mesmo caminho. Não testado com usuário real.
5. Carrinho fechado: segui o spec literal (5.8): a barra inteira fica desabilitada com "Fechado". Consequência no risco abaixo.
6. Título do bloco mudou de "Mais pedido" para "Mais pedidos" (texto do spec).
7. Seletor de Ajustes usa `<select>` nativo (mesmo padrão de `Desktop.tsx`), sem componente novo.
8. Não rodei `staging:push`, `staging:repair`, deploy de função, nem toquei produção.

## Riscos

- Loja fechada com item que tem opções no carrinho: o stepper do card some (vira "Fechado") e a barra do carrinho está desabilitada, então o cliente não consegue remover esse item sem recarregar. Fere a anti-meta "cliente sempre pode remover". Correção sugerida: manter a barra habilitada para abrir "Seu pedido" e desabilitar só o avanço ao pagamento. Decisão do dono.
- Bloqueio fora do horário é só na tela (o servidor recusa só com `bloquear_fora_do_horario`); relógio do visitante, não o fuso da barraca; a aba aberta passando da hora só atualiza ao voltar o foco.
- O destaque é lido uma vez por carga (dono trocando com a aba do cliente aberta: só vale ao recarregar).
- Visual (amarelo demais, altura dos cards horizontais) não validado.
- Métrica por rastros, não por coluna de origem.

## Passos que dependem do dono

1. Validar o visual em celular real (ou 360px) apontando o app ao staging: criar `.env.staging.local` a partir de `.env.staging.example`, `npm run dev:staging`, escolher um item em Ajustes > Cardápio digital > Item em destaque e conferir o cardápio (com e sem destaque, loja fechada).
2. Decidir o risco do carrinho fechado.
3. Produção, na ordem: aplicar a migration `20261105100000_destaque_cardapio.sql` no projeto `vimjwzumjggrlvlxdejr` (rollback no topo do arquivo) e só depois publicar o app. App novo sem a migration funciona, sem destaque.
4. Revisar e fazer o merge do PR (draft) em `main`; nada foi mesclado.
5. Medir: rodar `docs/consulta-pedidos-cardapio-semana.sql` antes e 2 a 4 semanas depois do lançamento.
