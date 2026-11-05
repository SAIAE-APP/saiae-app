# Cashback do cardápio digital: relatório de execução

Branch `feat/cashback`, empilhada sobre `feat/cardapio-hierarquia` (PR #198). Plano: `2026-10-27-cashback.md`; spec: `../specs/2026-10-27-cashback-design.md`; roteiro manual: `docs/roteiro-cashback.md`. Nada foi feito em produção, nenhum deploy de produção, nenhum merge.

## Rulings (do dono e da execução)
1. `feat/cashback` nasceu de `origin/main` atualizado e depois foi rebaseada sobre `origin/feat/cardapio-hierarquia` (sem conflitos). O PR draft tem base `feat/cardapio-hierarquia` e depende do #198.
2. Colisão de versão: as migrations do cashback usam `20261106100000` a `20261106160000` (M1..M7) mais `20261106170000` (M8, correções da revisão), porque o cardápio usa `20261105100000` e `20261105110000`. Plano e spec renomeados e commitados.
3. Task 20 (integração em `CardapioPublico.tsx`) feita sobre o cardápio novo, só nos pontos C1 a C6, guardada por `tests/cashbackCardapioContato.test.ts`. Acréscimo mínimo fora do plano: uma linha "Saldo de cashback" nos dois resumos de total, para o cliente entender o desconto.
4. SUPOSIÇÃO-CASHBACK-1 a 6 marcadas em código, testes e documentos (grep confere 1 a 4 em todos; 5 e 6 em código e documentos).
5. M7 (`20261106160000_cashback_aviso_pix.sql`): `consultar_status_pagamento` passa a devolver também `cashback_gerado_centavos` e `cashback_vence_em` (as três colunas atuais seguem na mesma ordem). A função foi recriada por drop e create porque o tipo de retorno muda. O Pix lê pelo polling (com uma releitura única após 3 s, porque o crédito é gravado logo depois de o pagamento virar aprovado) e o cartão pela resposta síncrona.
6. Rulings dos implementadores (M1..M6): M5 acrescenta `pedidos.cashback_estornado_em` (marca de estorno processado); `cashback_reservar` não libera reservas de outras cobranças; `cashback_avaliar_resgate` e `cashback_reservar` exigem cliente da loja com telefone confirmado; `cashback_confirmar_resgate` com `cliente_id` nulo (cliente apagado) confirma sem lançar no razão e vira tudo excedente; excedente do `cashback_resumo` por pedido com guarda de acesso; `saldoVigente` trata o instante exato do vencimento como vencido (SQL usa `expira_em > now()`); `reservarCashbackDoPedido` devolve 500 se o banco responder `ok:true` sem `uso_id`; códigos 422 `cashback_e_cupom`, `cashback_sem_cliente` (401) e `cashback_invalido`; em `emitir-nfce`, cupom e saldo juntos dão 422 sem chamar a FocusNFe; a ordem TDD (teste vermelho antes) foi invertida em algumas tarefas.
7. Revisão final (um revisor sonnet, somente leitura, sem acesso ao `git diff`: leu os arquivos): nenhum achado crítico. Importantes corrigidos na M8 e no webhook: (I1) `cashback_liberar_abandonadas` agora libera só a reserva do Pix anterior informado e só do mesmo cliente (antes liberava todas as do cliente, e dois Pix em paralelo podiam usar o mesmo saldo duas vezes); (I2) o reenvio do webhook de um pagamento já aprovado chama de novo `cashback_creditar_pedido` (idempotente), e crédito e estorno acham o cliente pela cobrança aprovada quando o vínculo `pedidos.cliente_id` (best-effort) falhou. Menores corrigidos: ordem dos locks de `cashback_confirmar_resgate` (M1), pedido já estornado não recebe crédito retardatário (M2), comentário de privilégios (M5). Não corrigidos (aceitos): "vencido" do `cashback_resumo` mistura períodos (M3); redundância inofensiva no retry de `criar-pagamento-pix` (M4).

## Testes por tarefa
- Tasks 1, 9, 10, 15 (regras puras, shared, pedido, NFC-e): 72 testes novos (vetores compartilhados TS/SQL em `tests/fixtures/cashback-vetores.json`).
- Tasks 2 a 7, M7 e M8 (migrations): `tests/cashbackMigration.test.ts`, 65 testes, texto e PGlite (fórmulas contra os vetores, idempotência, reserva vencida com excedente, saldo vencido que não ressuscita, estorno repetido, resumo, status do Pix, M8).
- Tasks 11, 12, 13, 14 (functions e cliente de API), 16 a 19 (UI e textos), 20 (contatos no cardápio, 7 testes): testes de texto e de unidade nos arquivos `tests/cashback*.test.ts`.
- Final: `npm test` 2075 testes, 0 falhas (base de `origin/main`: 1831); `npm run lint` 13 avisos, 0 erros (limite 13, igual ao da base); `npx tsc -b` limpo; `npm run build` ok.

## Staging (`qzcqwovbbylqxljcrqhk`)
- Migrations M1 a M8 aplicadas por `apply_migration`, uma por vez, em ordem. Smokes por migration em transação com rollback: M1 `cashback_config` devolve false, 500, 50, 60 e ligar sem o termo falha pelo check; M2 escrita direta negada para authenticated; M3 16 de 16 vetores batem entre TS e SQL; M4 reservar duas vezes não duplica e confirmar duas vezes grava um só resgate; M5 4000 a 500 bp rende 200 (175 com cupom de 500), saldo vencido não ressuscita, estorno depois de gastar reverte só o que sobra; M6 a conta fecha (concedido 200 − usado 120 − estornado 80 = em aberto 0); M7 e M8 confirmadas por consulta de privilégios e de retorno.
- `tests/cashback.staging.mjs` (Task 8): script escrito, passa em `node --check`, NÃO executado por Node (não há `STAGING_CHAVE_SERVICO` no ambiente e não leio `.env*`). Os 10 casos foram executados por SQL via MCP no staging, todos OK: paridade, idempotência, corrida (parcial, ver abaixo), reserva vencida com excedente, saldo vencido, sem identidade, desligado, RLS (anon, dono de outra loja, dono da loja, resumo de loja alheia zerado), `cliente_apagar_dados`, exclusão de barraca com razão. Sem sobra de dados fictícios.
- Functions no staging: `criar-pagamento-pix`, `webhook-mercadopago`, `cliente-sessao` e `estornar-pagamento` foram republicadas pelo agente da tarefa (versões recentes na lista do projeto). `emitir-nfce` NÃO foi republicada no staging. `webhook-mercadopago` precisa ser republicada de novo para levar o reprocesso do crédito (correção I2), feito depois do deploy.
- Reconciliação pendente de versões: o MCP `apply_migration` grava a versão com o horário de aplicação (`20261027044933` a `20261027070458` e a M8 do mesmo modo), não com os `20261106…` dos arquivos. Antes de qualquer `staging:push`, `staging:repair` ou `db push`, é preciso reconciliar o histórico do staging com os arquivos (renomear as versões gravadas ou marcar as do repositório como aplicadas). Não mexi nisso.

## O que NÃO foi validado
- Pagamento real: Pix e cartão com saldo (não há token de teste do Mercado Pago no ambiente), webhook ponta a ponta e estorno real.
- Corrida com concorrência real de duas reservas: o caso foi serializado pela ferramenta; a exclusão mútua se apoia no advisory lock e no teste sequencial.
- O caso de RLS do `.mjs` precisa de `STAGING_CHAVE_ANON` (sem ela imprime PULADO); o equivalente por SQL passou.
- Validação visual: só a página pública do cardápio a 360 px renderiza sem erro no console (`screens-cashback/cardapio-360.png`, vite local contra o staging com URL e chave pública passadas por variável de ambiente). O bloco de cashback no checkout exige sessão de cliente (código por WhatsApp; o hash do token usa um segredo do servidor, então não dá para forjar sessão) e uma loja com pagamento online ligado, que o staging não tem. Ajustes > Cashback exige login do dono, para o qual não há credencial: não inventei. As telas ficam cobertas por testes de texto e pelo roteiro manual.
- Primeira NFC-e com desconto (cupom e cashback) em homologação.
- Piso de R$ 1,00 com a comissão de R$ 0,99 no Mercado Pago (o sandbox de cartão com token OAuth devolvia HTTP 500 no marketplace).

## Riscos
- Chargeback sem tratamento automático; excedente (saldo gasto em outro pedido depois da reserva vencida) fica com a barraca.
- Aviso fiscal: não é parecer fiscal; o texto manda confirmar com o contador antes de ligar.
- A API de Payments do Mercado Pago será descontinuada (mesmo risco do marketplace).
- Poucas barracas com pagamento online: pouco poder estatístico para medir efeito.

## Pendências que dependem do dono
1. Aprovar as SUPOSIÇÃO-CASHBACK-1 a 6 (lista em `docs/roteiro-cashback.md`).
2. Parecer do contador (aviso fiscal) e de quem entende de CDC (saldo honrado depois de desligar).
3. Reconciliar as versões de migration do staging; republicar `webhook-mercadopago` e `emitir-nfce` no staging; fornecer token de teste do Mercado Pago, chave de serviço e chave anon de staging para rodar `tests/cashback.staging.mjs` e o roteiro de pagamento.
4. Emitir em homologação a primeira NFC-e com desconto e validar o piso de R$ 1,00 com a taxa de R$ 0,99.
5. Validar visualmente o checkout com sessão de cliente e Ajustes > Cashback (login do dono).
6. Só então, e depois do merge do #198, pensar em produção (migrations M1..M8, depois functions, depois app), sempre com ordem do João.
