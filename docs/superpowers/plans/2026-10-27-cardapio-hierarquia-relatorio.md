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

## Validação visual (feita, 360px, staging)

Dev server do worktree (
px vite --port 5199 --mode staging) com URL e chave pública do staging passadas SÓ como variáveis de ambiente do processo (nenhum arquivo .env lido ou criado). Navegador: `npx --no-install agent-browser` (v0.39.4), viewport 360x780, barraca de teste `barraca-teste` do staging. Prints em `docs/superpowers/plans/screens-cardapio/` (01 a 10).

Dados de teste criados SÓ no staging: Refrigerante marcado Popular e X-Teste como item em destaque (ficaram assim); horários inseridos para os testes de loja fechada e removidos depois (barraca voltou a "sem horário").

Conferido:
- Hierarquia: informações, modos, banner, DESTAQUE DA CASA, Mais pedidos, Populares, busca + categorias, lista, carrinho fixo (01, 02, 10).
- Todos os 10 botões de pedir medidos: 44px de altura, fundo mostarda rgb(255,194,26) com texto tinta rgb(24,23,28); o do herói é tinta sobre mostarda. Stepper: botões de 44x44 (03).
- "Adicionar" vira "− N +" (03); item com opções mostra "Escolher" e abre o seletor (04); depois de escolher, o botão fica "Escolher (N)".
- Destaque: some sem item escolhido (08) e com o item esgotado (09); o resto da tela segue normal.
- Loja fechada (05): selo e herói com "Fechado · abre sexta às 10:00", todos os botões "Fechado" desabilitados, preço e itens visíveis. Com itens já no carrinho ao fechar (simulado com janela até 02:00 e evento de foco): barra "2 itens · Fechado" habilitada, stepper do herói "− 1 +" com "+" desabilitado (06), "Seu pedido" permite remover item simples e com opções, e "Pagar com Pix" fica desabilitado com o aviso (07).

Defeitos visuais corrigidos nesta validação:
1. Cards horizontais com preço "a partir de" empurravam o botão para baixo (botões desalinhados entre cards): card agora é coluna e o botão fica no fim (mt-auto).
2. O aviso de loja fechada no "Seu pedido" repetia "Fechado" duas vezes: texto ajustado.

Não validado: aparência em celular real (decisão do João), modo escuro, desktop largo, pagamento com cartão fechado (o botão do cartão recebe o mesmo bloqueio, mas não foi clicado), e o seletor de Ajustes (só tipos e build; não aberto no navegador).
## Correções da revisão independente (PR #198)

- Horário no fuso da barraca: `statusFuncionamento` ganhou o parâmetro `fuso` (Intl, sem depender do relógio do visitante). Nenhuma RPC pública expunha o fuso, então a migration nova `20261105110000_fuso_publico.sql` cria `fuso_publico(slug)` (só devolve o fuso). Aplicada SÓ no staging. Sem a função ou com erro o app usa America/Sao_Paulo. Testes: `tests/horarioFuncionamentoFuso.test.ts` (virada da meia-noite, Manaus e Rio Branco, TZ do processo diferente) e `tests/fusoPublicoMigration.test.ts`.
- Botão Aumentar do sheet "Seu pedido" fica desabilitado com a loja fechada (remover continua livre).
- Efeito de `destaque_publico`: zera o destaque no início e no erro.
- `aria-label` do botão Fechado é o próprio texto de estado.
- Botão "Escolher (N)" nos cards de 144px: padding menor (`px-2!`) e sem ícone com mais de 9 no carrinho; medido a 320px (`Escolher (99)` cabe, sem rolagem horizontal; print 11).

## Decisão a confirmar pelo dono: bloqueio fora do horário só na tela

Ruling do dono: o cardápio segue os horários cadastrados e fecha os botões fora deles. Risco: quem usa o horário só para exibir e aceita encomenda fora do horário perde a venda, porque o botão fecha mesmo sem `bloquear_fora_do_horario`; o servidor só recusa pedido fechado quando essa opção está ligada. `bloquear_fora_do_horario` NÃO chega ao cliente por nenhuma RPC pública (nem `cardapio_publico` nem `horarios_publicos`), então não mudei o comportamento: só documentei. Se o dono quiser respeitar a opção (botões ativos quando a barraca aceita encomenda), é preciso expor esse flag numa função pública e usá-lo em `aberta`.

## Rulings

1. Subagentes: implementei as tarefas eu mesmo, em sequência, no mesmo worktree (evita conflito em `CardapioPublico.tsx`) e usei um subagente só para a revisão final. Motivo: custo e tarefas pequenas.
2. Tarefas 6 e 7 foram feitas e commitadas juntas (mesmo arquivo); 5 foi junto delas porque os componentes só compilam sem aviso quando usados.
3. `item_destaque_id` ficou opcional (`?`) no tipo `Barraca`, como outras colunas recentes (banco sem migration não quebra o cache).
4. RLS: a policy de update de `barracas` é por linha, não por coluna; o dono salva a coluna nova pelo mesmo caminho. Não testado com usuário real.
5. Carrinho fechado (ruling do dono-delegado, 2026-10-27, corrige o que o spec dizia): a barra fica HABILITADA para o cliente sempre poder revisar e remover itens; só o avanço ao pagamento/envio fica bloqueado, com aviso. Spec 5.8 atualizado. Teste puro: `podeFinalizarPedido` e stepper fechado em `tests/estadoBotaoPedir.test.ts`.
6. Título do bloco mudou de "Mais pedido" para "Mais pedidos" (texto do spec).
7. Seletor de Ajustes usa `<select>` nativo (mesmo padrão de `Desktop.tsx`), sem componente novo.
8. Não rodei `staging:push`, `staging:repair`, deploy de função, nem toquei produção.

## Riscos

- Bloqueio fora do horário é só na tela (o servidor recusa só com `bloquear_fora_do_horario`); a aba aberta passando da hora só atualiza ao voltar o foco.
- O destaque é lido uma vez por carga (dono trocando com a aba do cliente aberta: só vale ao recarregar).
- Visual validado a 360px no staging (ver acima); falta o olhar do João em celular real (amarelo demais?).
- Métrica por rastros, não por coluna de origem.

## Passos que dependem do dono

1. Conferir o visual em celular real (portão de aceite do spec, seção 10).
3. Produção, na ordem: aplicar as migrations `20261105100000_destaque_cardapio.sql` e `20261105110000_fuso_publico.sql` no projeto `vimjwzumjggrlvlxdejr` (rollback no topo de cada uma) e só depois publicar o app. App novo sem elas funciona (sem destaque, fuso de Brasília).
4. Revisar e fazer o merge do PR (draft) em `main`; nada foi mesclado.
5. Medir: rodar `docs/consulta-pedidos-cardapio-semana.sql` antes e 2 a 4 semanas depois do lançamento.
