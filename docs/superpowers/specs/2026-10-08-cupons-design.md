# Cupons de desconto (código digitado, cardápio digital) — design

Data: 2026-10-08. Fonte: respostas do dono do produto em 2026-10-08 (prioridade "clientes e cupons"; segunda entrega depois do perfil do cliente final). Status: **aguardando revisão do dono do produto.** Nenhum código foi escrito.

## Objetivo
Permitir que o dono da loja crie cupons com código (ex.: `FEIRA10`) e que o cliente do **cardápio digital** digite o código no carrinho para pagar menos no Pix (ou no "pagar na entrega"). Sem cupom automático, sem cupom no balcão.

## Decisões do dono (2026-10-08)
| # | Decisão |
|---|---|
| 1 | Só **código digitado**. Cupom automático por cliente fica para depois. |
| 2 | Tipo: **porcentagem** ou **valor fixo**, escolhido ao criar. |
| 3 | Limites na v1: **validade** (início e fim), **limite total de usos**, **uma vez por cliente**, **pedido mínimo**. Fora: restrição por tipo de atendimento. |
| 4 | Vale **só no cardápio digital**. O operador no balcão não digita cupom nesta versão. |
| 5 | O desconto incide **só sobre os itens**; a taxa de entrega nunca é descontada. |
| 6 | O cupom só conta como **usado quando o pagamento é confirmado**. Durante o Pix aberto ele fica **reservado**; se o Pix expira ou é rejeitado, a reserva é liberada. |
| 7 | **Um cupom por pedido** (não soma com outro). |

## Estado atual (auditado em origin/main)
- Total do pedido do cardápio sai do servidor: `resolver_carrinho` devolve `total_centavos` dos itens; `criar-pagamento-pix` soma a taxa de entrega e compara com `total_esperado_centavos` (o cliente vê um total e o servidor recusa se mudou). É nesse ponto que o desconto entra.
- Cobrança Pix nasce em `pagamentos_pendentes` (snapshot dos itens, `expira_em`); o webhook do Mercado Pago confirma consultando o provedor e então chama `criar_pedido` (idempotente por `client_uuid`). "Pagar na entrega" cria o pedido direto em `criar-pedido-cardapio`.
- `pedidos.taxa_entrega_centavos` já é guardado **à parte** dos itens; relatórios e nota fiscal tratam a taxa fora. O desconto de cupom segue o mesmo padrão: guardado à parte, nunca misturado aos preços dos itens.
- Perfil do cliente final (flag `perfil_cliente_obrigatorio`, sessão do cliente em `cliente_sessoes`, `pedidos.cliente_id`) já está em produção na loja de teste.

## Parte 1 — Dados (migrations aditivas, staging antes da produção)
**`barracas.cupons_habilitado boolean not null default false`** — liga cupons por loja (nasce desligado). RPC pública `cupom_config(slug)` devolve `true` só se a loja ligou (mesmo padrão de `perfil_cliente_config`); o front só mostra o campo "Tem cupom?" com ela ligada.

**`cupons` (nova):**
- `id`, `barraca_id`, `codigo` (guardado em maiúsculas, `[A-Z0-9_-]`, 3–20 caracteres), índice único `(barraca_id, codigo)`.
- `tipo` (`percentual` | `fixo`), `valor`: percentual = inteiro 1–100; fixo = centavos > 0.
- `inicio_em`, `fim_em` (timestamptz, opcionais; `fim_em > inicio_em`).
- `limite_usos int null` (null = ilimitado), `uma_por_cliente boolean`, `pedido_minimo_centavos int not null default 0`.
- `ativo boolean not null default true`, `criado_em`.
- RLS: dono lê, cria e edita via `usuario_tem_acesso_barraca` com WITH CHECK. Sem DELETE para cupom com uso (só pausar).

**`cupom_usos` (nova):** `id`, `cupom_id`, `barraca_id`, `cliente_id null` (→ `clientes_finais`, `on delete set null`), `pagamento_pendente_id null`, `pedido_id null`, `estado` (`reservado` | `confirmado` | `liberado`), `desconto_centavos`, `reservado_ate`, `criado_em`. Índice único `(pagamento_pendente_id)` quando não nulo (uma reserva por cobrança). Sem policy de leitura para o público; o dono lê o agregado por RPC.

**Colunas novas:** `pagamentos_pendentes.cupom_id`, `.desconto_cupom_centavos int not null default 0`, `.cupom_uso_id`; `pedidos.cupom_id`, `.cupom_codigo` (cópia do texto), `.desconto_cupom_centavos int not null default 0`. A cópia do código e do valor fica no pedido, então editar ou apagar o cupom depois não muda pedido antigo.

## Parte 2 — Regras e cálculo (sempre no servidor)
O app só envia o **código**; nunca o valor do desconto.

`subtotal` = total dos itens vindo de `resolver_carrinho` (já com adicionais). Validação, nesta ordem, com mensagem própria:
1. Cupom existe na loja e `cupons_habilitado` ligado, senão "Cupom inválido".
2. `ativo`, senão "Cupom inválido".
3. Dentro da validade, senão "Este cupom venceu" / "Este cupom ainda não começou".
4. `subtotal >= pedido_minimo_centavos`, senão "Vale a partir de R$ X,XX em itens".
5. Limite total: `confirmados + reservas vigentes < limite_usos`, senão "Este cupom esgotou".
6. Uma vez por cliente: exige sessão do cliente; se já há uso confirmado ou reserva vigente do mesmo `cliente_id`, "Você já usou este cupom". Sem sessão, "Entre com seu telefone para usar este cupom".

Cálculo (inteiros em centavos): percentual = `floor(subtotal * valor / 100)`; fixo = `valor`. O desconto nunca passa do subtotal dos itens (`greatest(0, least(desc, subtotal))`); cupom de 100% (ou fixo igual/maior que os itens) zera os itens e o pedido sai **grátis de verdade** (decisão do dono, 2026-10-19; antes havia o piso de R$ 1,00, que foi removido). `total cobrado = subtotal - desconto + taxa de entrega`.

**Reserva atômica:** função de banco (`cupom_reservar`) trava a linha do cupom (`for update`), reconta usos e cria a reserva na mesma transação — duas pessoas não levam o último cupom. `reservado_ate` = `expira_em` do Pix. Reserva vencida (`reservado_ate < now()`) é ignorada na contagem, então não depende de cron para liberar.

**Ciclo de vida:**
- Pix: `criar-pagamento-pix` valida, reserva e grava o desconto no `pagamentos_pendentes`; o QR sai com o valor descontado. Retry idempotente reaproveita a reserva (mesmo `client_uuid`); se o código mudar, libera a anterior e reserva de novo.
- Webhook `aprovado`: na mesma etapa que cria o pedido, marca o uso como `confirmado`, grava `pedido_id` e copia cupom/desconto para `pedidos`. Corrida de notificações segue a regra atual (23505 vira sucesso idempotente) e não confirma duas vezes.
- Webhook `expirado`/`rejeitado`: marca `liberado`.
- Pagar na entrega: valida e **confirma direto** na criação do pedido (não há pagamento a esperar).
- Se o valor mudou entre a tela e o servidor (cupom venceu, esgotou, dono mexeu), vale a regra existente de `total_esperado_centavos`: recusa com o novo total para o cliente confirmar.

## Parte 3 — Segurança e abuso
- Edge function `cupom-validar` (sem JWT, só consulta, **não reserva**) devolve desconto e novo total para a tela. Reserva real só dentro de `criar-pagamento-pix`/`criar-pedido-cardapio`.
- Limite de tentativas de adivinhar código, no estilo do código de verificação: tabela de log por `ip_hash` e loja; no máximo 15 tentativas **inválidas** por IP por loja por hora e 100 por loja por hora; acima disso 429. Tentativa válida não conta.
- `ip_hash` com o mesmo pepper já usado no perfil; nenhum IP em texto puro.
- Funções de reserva/confirmação só executáveis pelo papel de serviço (sem grant para `anon`/`authenticated`); `cupom_config` é a única pública, devolvendo apenas booleano.
- LGPD: ao apagar os dados do cliente, `cupom_usos.cliente_id` vira null (o uso continua contando para o limite total; o "uma vez por cliente" daquele telefone deixa de valer, consequência assumida).

## Parte 4 — Telas
**Dono (Ajustes > Cardápio & Operação > "Cupons", `SecaoCupons`):** liga/desliga cupons da loja; lista com código, desconto, validade, usos (`confirmados / limite`), total de desconto dado, selo Ativo/Pausado/Vencido/Esgotado; formulário único (`BottomSheet`) com código, tipo, valor, validade, limite, uma vez por cliente, pedido mínimo. "Uma vez por cliente" fica desabilitado, com aviso, se a loja não usa o perfil do cliente (flag `perfil_cliente_obrigatorio` desligada). Salvar por botão explícito, como o resto de Ajustes. Apagar só sem uso; com uso, "Pausar".

**Cliente (`CardapioPublico`, carrinho):** linha "Tem cupom?" que abre um campo; aplicar mostra "Cupom FEIRA10: −R$ 5,00" e o novo total; remover cupom volta ao total anterior. Erros com as mensagens da Parte 2, em linguagem simples. Alvos de toque de 44px; só aparece com `cupom_config` ligado.

## Parte 5 — Onde o desconto aparece depois
- **Cozinha/Histórico:** linha "Cupom FEIRA10: −R$ 5,00" no card do pedido.
- **Relatório/Faturamento:** nova linha "Descontos de cupom" **à parte**, na planilha uma coluna; o bruto continua sendo a soma dos itens e o valor líquido recebido = bruto − descontos (rótulo claro). Mesmo padrão da taxa de entrega.
- **NFC-e:** o valor da nota é o dos itens **menos** o desconto (a nota deve refletir o que o cliente pagou). `emitir-nfce` rateia o desconto proporcionalmente entre os itens (o resto de centavos vai no último) usando o campo de desconto por item da FocusNFe. **Confirmar o nome do campo e o rateio contra a documentação na implementação; nenhuma nota real foi emitida ainda**, então a primeira emissão deve ser conferida. A taxa de entrega continua fora da nota.
- **Evento para o CRM (SAI-001):** campos opcionais aditivos `cupom_codigo` e `desconto_cupom_centavos` no pedido; CRM que não conhece ignora. Sem mudança de versão do contrato.
- **Impressão da comanda:** sem alteração (cozinha não precisa do desconto).

## Fora desta versão
Cupom no balcão/operador, cupom automático por cliente (ex.: 5º pedido, primeiro pedido), restrição por tipo de atendimento, cupom que soma com outro, frete grátis, cupom por item ou categoria, envio do cupom por WhatsApp.

## Testes e liberação
- **Banco (staging):** reserva atômica sob concorrência (N pedidos paralelos para o último uso: exatamente 1 vence), reserva vencida libera, uso confirmado só com pagamento aprovado, `uma_por_cliente` com e sem sessão, mínimo, validade nas bordas, cálculo percentual com arredondamento, cupom que cobre tudo (pedido grátis), retry idempotente, webhook duplicado não confirma duas vezes, cupom editado depois não muda pedido antigo, isolamento entre lojas (código igual em duas lojas).
- **Segurança:** limite de tentativas inválidas, funções de reserva recusam chamada anônima, cliente não consegue forçar valor de desconto no corpo da requisição.
- **Front:** passada visual em 375 px (campo, erros, linhas no resumo, formulário do dono).
- **Revisão independente (aorus-19) antes de produção**, como no perfil.
- **Liberação:** `cupons_habilitado` nasce `false`; migrations e funções em produção só por ordem do dono; primeiro só na `qa-teste-varredura`, com um Pix real de valor baixo; as demais lojas não mudam.

## Pontos para o plano de implementação (Review Focus)
1. Último cupom disputado por dois clientes ao mesmo tempo.
2. Cliente aplica cupom, gera Pix, volta e muda o carrinho ou o código (reserva antiga precisa ser liberada).
3. Pix pago depois de o cupom vencer ou ser pausado (vale a reserva feita antes; o pagamento aprovado não pode ser recusado).
4. Percentual que deixaria o pedido abaixo de R$ 1,00 ou fixo maior que o subtotal.
5. Webhook duplicado ou fora de ordem (aprovado depois de expirado) sem confirmar duas vezes nem perder o pedido.
