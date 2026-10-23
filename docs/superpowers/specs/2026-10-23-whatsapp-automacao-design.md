# WhatsApp e Automação (Sai aê + Sai aê CRM) — design

Data: 2026-10-23. Status: **rascunho aguardando aprovação do João.** Nenhum código foi escrito. Fonte: auditoria da Fase 1 (leitura do código dos dois repositórios, sem acesso aos bancos nem execução dos apps) e a conversa de brainstorming com o João.

Repositórios: `SAIAE-APP/saiae-app` (Sai aê, React/Vite + Capacitor + Supabase/Postgres + edge functions Deno) e `centraldeatendimentoaia-cyber/saiae-crm` (CRM, Next.js com servidor customizado, Prisma/MySQL, Baileys, Railway).

## 1. Intenção

Transformar o Sai aê numa plataforma integrada para restaurantes. O Sai aê continua dono da operação (cardápio, pedido, status, pagamento). O CRM fornece WhatsApp, bot e disparos. Reaproveitar o que já existe nos dois projetos, sem fundir as aplicações e sem reescrita.

Por quê: o restaurante hoje avisa o cliente à mão ("Avisar cliente" abre `wa.me` e o operador toca em enviar). Os avisos automáticos existentes dependem da API oficial da Meta, que o João não quer usar.

## 2. Decisões do João

1. Canal WhatsApp: **Baileys** (conexão não oficial). Sem API oficial para estas funcionalidades.
2. **Um número de WhatsApp por restaurante.**
3. Aviso de status do pedido é transacional: **envia mesmo com `consentimento_contato = false`**. O descadastro ("SAIR") é sempre respeitado. `consentimento_contato` e `consentimento_marketing_em` valem só para marketing.
4. A UI "Atendente IA" e "Integração com o CRM" (hoje escondida em `src/lib/visibilidadeIaCrm.ts`) pode ser reativada quando necessário.
5. Pedido pelo WhatsApp aceita pagar na entrega **e Pix**.
6. Conexão: **somente QR Code**, numa aba em Ajustes. Sem código de pareamento.
7. Avisos de status: **recebido, pronto, saiu para entrega, entregue e cancelado.** Não existe "em preparo".
8. Bot: manda o link do cardápio digital; anota o pedido na conversa se o cliente preferir. Se não entender, manda o cliente ao link e **avisa o dono** pelo WhatsApp dele (motivo, problema, nome do cliente e link da conversa).
9. Pedido com Pix **só entra na cozinha depois do pagamento**.
10. O bot com IA é um **módulo extra pago**. Disparos de marketing também são parte do produto.
11. Disparos previstos: reativar quem sumiu, promoção do dia, pedir avaliação.
12. **Ordem de entrega:** avisos de status primeiro, depois o bot, depois os disparos.
13. O que mais preocupa o João: o **número ser bloqueado**.

## 3. Objetivos, não objetivos e anti-objetivos

Objetivos:
- Aviso automático e confiável do status do pedido, sem nunca atrasar ou bloquear o PDV.
- Cada restaurante conecta e usa o próprio número, sem enxergar dados de outro.
- O dono entende o estado da conexão e o histórico de avisos numa única aba.

Não objetivos (por enquanto):
- API oficial da Meta, número único compartilhado entre lojas, aviso de "em preparo".
- Fusão de bancos, de login ou das aplicações.
- Bot e disparos nesta primeira entrega (têm direção, mas não plano detalhado).

Anti-objetivos (seria falha mesmo que "funcione"):
- Aviso duplicado ao cliente.
- Pedido criado pelo bot sem confirmação explícita, ou com preço que não veio do servidor.
- Vazamento de sessão, conversa, pedido ou cliente entre restaurantes.
- Mecanismo cujo propósito seja **impedir a detecção de envio em massa pelo WhatsApp**. Isso foi recusado no brainstorming: o sistema limita e espaça os envios (ritmo humano, tetos), mas não se propõe a camuflar disparos.

## 4. Estado atual relevante (verificado no código)

- Sai aê: outbox `eventos_saida` alimentado por triggers em `pedidos`, worker `enviar-eventos-saida` (pg_cron 1/min), assinatura HMAC-SHA256 de `timestamp.corpo`, retry 1 min/5 min/30 min/2 h/12 h, `sequence` por pedido. Eventos emitidos: `order.created`, `order.status_changed`, `order.ready`, `order.out_for_delivery`, `order.cancelled`, `order.paid`. Contrato em `INTEGRACAO.md` e `docs/contrato/v1/`.
- CRM: rota `POST /api/integracao/comanda/v1/eventos` (assinatura, janela de 5 min, schema, dedupe por `id` e ordem por `sequence`). Consumidores via `registerComandaEventConsumer` (`consumers.ts`). Único consumidor real: `order-notifier.ts`, que envia **templates da Cloud API** para `order.created`, `order.ready` e `order.out_for_delivery`, desligado por padrão (`COMANDA_NOTIFY_TEMPLATES`).
- Idempotência e ordem no CRM são **em memória** (`BoundedTtlMap`, janela de 24 h, 10 mil entradas). Não sobrevivem a reinício nem a mais de uma instância.
- Não há tabela de resultado de envio. O log guarda só tipo e código de erro, sem telefone.
- Provedores: `WhatsAppProvider` (`src/modules/whatsapp/provider/types.ts`) com `BaileysProvider` e `CloudApiProvider`. `getProvider(sessionId)` escolhe a Cloud API se a sessão estiver em `WHATSAPP_CLOUD_SESSION_ID` (variável global, piloto de um número); caso contrário usa o Baileys. O Baileys declara `freeTextAnytime: true` e `templates: false`.
- `Session` (Prisma) tem `userId`, `sessionId`, `status`, `qr` e `config`; **não tem `barraca_id`**. O contrato diz que deveria ter `comanda_barraca_id`, mas isso não foi implementado. Hoje o vínculo é `COMANDA_WEBHOOK_SECRETS` (variável de ambiente, barraca_id → segredo).
- O CRM tem `src/modules/whatsapp/antispam.ts`, que **não foi lido**; precisa ser lido antes de definir os limites de envio.
- Telefone do cliente: `pedidos.cliente_telefone` (opcional, só dígitos, sem o 55) ou `entrega_telefone`. O evento leva `cliente.telefone` e `cliente.nome`.
- Status reais do pedido: `a_fazer`, `pronto`, `saiu_entrega` (só com `barracas.saiu_entrega_habilitado`), `entregue`, `cancelado`. "Entregue" não tem evento próprio; chega como `order.status_changed` com `status = entregue`.
- Opt-out do CRM: tabela `OptOut` (`sessionId`, `phoneKey`, `jid`), alimentada hoje só pelo fluxo do Baileys.

## 5. Fase 1 — Conexão e avisos de status

### 5.1 A aba "WhatsApp e Automação"

Fica em Ajustes do Sai aê. Reaproveita o padrão das seções existentes (`SecaoAvisoPronto`, `SecaoAcessoSuporte`).

Desconectada: mostra o QR Code (renovado sozinho) e os passos ("Aparelhos conectados → Conectar aparelho"). Conectada: mostra o número (mascarado), o status, o botão Desconectar, os interruptores de cada aviso, o texto editável de cada aviso e o histórico dos últimos avisos com status (enviado, falhou, pulado) e botão de reenviar quando fizer sentido.

Na hora de conectar, a tela avisa em linguagem simples que o Baileys não é a API oficial do WhatsApp e que existe risco de bloqueio do número.

**Decisão em aberto de arquitetura (do construtor):** a aba mostra dados do CRM (QR, status, histórico). Opções: (a) a aba do Sai aê chama uma edge function do Sai aê que faz proxy assinado para o CRM; (b) abre o painel do CRM embutido com SSO. Recomendação: (a), com rotas novas no CRM autenticadas por HMAC no mesmo padrão do contrato, e nada de segundo login. A spec de SSO já existente no Sai aê (`docs/superpowers/specs/2026-10-07-sprint0-1-integracao-design.md`) **não foi lida** e deve ser consultada antes de decidir.

### 5.2 Mapeamento restaurante ↔ sessão

Nova associação persistente no CRM entre `Session` e `barraca_id` (UUID do Sai aê). Regras:
- Uma sessão pertence a exatamente uma barraca; uma barraca pode ter 1..N sessões (como no contrato v1).
- Todo evento recebido usa o `barraca_id` do corpo (já validado pela assinatura daquela barraca) para achar a sessão. Nunca escolhe "a primeira sessão".
- As rotas da aba só operam na sessão da barraca autenticada.
- Os `User`/`Session` já existentes do CRM não são alterados nem migrados. O vínculo é aditivo.

Como o CRM roda `prisma db push` em todo start, mudança de schema vai para produção no deploy. Precisa de revisão e de ordem de deploy explícita.

### 5.3 Canal de envio

`order-notifier` deixa de assumir a Cloud API e passa a pedir o provedor da sessão da barraca. Para Baileys envia **texto livre** (sem template). A Cloud API continua funcionando para quem já a usa, mas não é necessária.

### 5.4 Quais eventos geram aviso

| Aviso | Gatilho | Observação |
|---|---|---|
| Recebido | `order.created` | Um por pedido. |
| Pronto | `order.ready` | Um por pedido. |
| Saiu para entrega | `order.out_for_delivery` | Só lojas com a coluna ligada. Um por pedido. |
| Entregue | `order.status_changed` com `status = entregue` | **Decisão minha:** não envia se o pedido nasceu `entregue` (entrega direta no balcão) nem quando o operador apenas corrige o status. Um por pedido. |
| Cancelado | `order.cancelled` | Um por pedido. |

Só recebe quem informou WhatsApp no pedido. Telefone ausente ou inválido: não envia, registra "pulado". Cliente descadastrado: não envia.

### 5.5 Idempotência, falha e diagnóstico

- Chave de dedupe persistida em banco no CRM: `(barraca_id, pedido_id, tipo_de_aviso)`, com restrição única. Substitui o `BoundedTtlMap` para os avisos.
- Tabela de log de avisos: barraca, pedido, tipo, estado (`pendente`, `enviado`, `falhou`, `pulado_sem_telefone`, `pulado_optout`, `pulado_desconectado`), motivo do erro (sem telefone nem texto da mensagem) e horário.
- O worker do Sai aê já reenvia o evento até receber 2xx. O CRM deve responder 2xx **depois de gravar o aviso como pendente** e enviar de forma assíncrona, com retentativa própria (decisão minha: poucas tentativas com espera crescente, depois `falhou`). Assim a falha de envio não depende de o Sai aê reenviar.
- Sessão desconectada: o aviso fica `pulado_desconectado` (ou pendente por um prazo curto — **decisão minha a validar**: não acumular fila para enviar horas depois, porque aviso de "pronto" atrasado vira ruído).
- Nada disso roda no caminho do operador: o PDV grava o pedido, o outbox cuida do resto.

### 5.6 Textos configuráveis

Texto por aviso e por barraca, com variáveis `{nome}`, `{senha}`, `{barraca}` (mesmo padrão do `SecaoAvisoPronto`; variável sem valor some da frase). Há um texto padrão em português para cada aviso. Onde guardar (Sai aê ou CRM) é decisão do construtor; recomendação minha: no Sai aê, junto das outras configurações da barraca, enviado no evento ou lido por rota assinada.

### 5.7 Regras de envio para reduzir bloqueio (todas decisões minhas, a revisar)

Não eliminam o risco. Só o reduzem.
- Só responde a quem escreveu ou fez pedido. Nenhum disparo de marketing nesta fase.
- Espaço aleatório de poucos segundos entre envios, indicador "digitando", teto por minuto e por dia por número, fila em vez de rajada.
- Teto mais baixo nos primeiros dias de um número novo.
- Desconexão: detectar, pausar automações e avisar o dono no Sai aê. O pedido segue entrando normalmente pelo cardápio.
- Aviso honesto ao dono sobre o risco, na hora de conectar.
- Base provável: `src/modules/whatsapp/antispam.ts` (não lido).

### 5.8 Opt-out

"SAIR" (e variações já tratadas por `isOptOutText`) grava em `OptOut` por sessão. Vale para todos os avisos e disparos. O fluxo atual do Baileys já grava; verificar que continua valendo quando a sessão é por barraca.

### 5.9 Segurança e privacidade

- Credenciais da sessão Baileys ficam no banco do CRM (`AuthState`). O mapeamento e as rotas novas exigem autenticação por barraca; nenhuma rota devolve QR ou histórico de outra barraca.
- Rotas novas do CRM seguem o padrão HMAC do contrato (janela de 5 min, comparação em tempo constante, resposta idêntica para falha).
- Logs sem telefone, nome, itens ou texto de mensagem.
- LGPD: o aviso é transacional (telefone informado no próprio pedido, uso só para o aviso). Política de Privacidade (seção 4) deve ser conferida e atualizada se necessário.

## 6. Fase 2 — Bot que atende e anota pedido (direção)

- **Entrada pelo Baileys.** Hoje o consumidor da IA recebe mensagens só pelo webhook da Cloud API (`/api/whatsapp/webhook` → `dispatchInbound`) e responde com `criarEnvioCloud`. Precisa de um caminho equivalente para as mensagens do Baileys (`store/index.ts` já trata `messages.upsert`), mantendo idempotência por id de mensagem, rate limit, opt-out e pausa para humano. Não é necessário `#CODIGO` do link: o número já identifica a loja.
- **Padrão da conversa:** "oi" → saudação curta + link do cardápio. Se o cliente preferir pedir por mensagem, o bot anota.
- **Pedido na conversa:** a fonte de verdade é o Sai aê. Criar a edge function `integracao-v1` (reservada no contrato; **não existe hoje**) com cardápio e horário, e rascunho de pedido validado por `carrinho.ts`/`resolver_carrinho`, que devolve preço por linha e total já resolvidos. A IA nunca soma preço. Só confirma o pedido depois de um "sim" explícito do cliente ao resumo. `criar_pedido` já é idempotente por `client_uuid`.
- **Não entendeu / fora do cardápio:** manda o link do cardápio e avisa o dono (motivo, problema em uma frase, nome do cliente, link da conversa). A IA pausa na conversa até o dono assumir ou até expirar. Reaproveita `chamar_dono`.
- **Pagamento:** pagar na entrega cria o pedido na hora. **Pix:** o servidor gera a cobrança (reaproveitar `criar-pagamento-pix`); o pedido só nasce quando o webhook do provedor confirma. O bot manda o copia e cola e depois "pagamento confirmado, pedido #N recebido" (uma mensagem só, em vez de duas — decisão minha). Pix vencido: avisa e manda o link do cardápio. **Falta:** vínculo entre conversa e cobrança pendente. `criar-pagamento-pix` hoje é um endpoint público de cardápio com exigências próprias (perfil/telefone); como o bot o chama com segurança é decisão aberta.
- **Módulo pago:** `barracas.ia_habilitada` já nasce desligado; o CRM já mede consumo (`IaConsumo`). Preço e limite por plano são decisão do João.

## 7. Fase 3 — Disparos (direção)

- **Reativar quem sumiu:** público = clientes sem pedido há N dias com `clientes_finais.consentimento_marketing_em`. O CRM não tem essa lista; o Sai aê precisa expor uma rota assinada com os elegíveis. Limite conhecido: telefone de pedido de balcão **não** entra em `clientes_finais` (decisão LGPD de 2026-10-08), então a base é só de entrega/cardápio consentidos.
- **Promoção do dia:** o dono escreve ou escolhe o texto, define o público consentido e dispara. Nada sai sozinho.
- **Pedir avaliação:** uma vez por pedido depois do "entregue", só para quem informou WhatsApp, não envia se houve reclamação ou cancelamento. **Decisão minha:** tratar como follow-up do pedido (não marketing), com "SAIR" respeitado. Não existe tela de avaliação; para onde vai a resposta fica em aberto.
- Regras comuns: descadastro vale para tudo, no máximo um disparo por cliente por dia, fila com teto diário.
- **Limite honesto:** o Baileys é uma conexão não oficial. Mesmo disparo consentido e espaçado mantém risco de bloqueio, e disparo em volume é o que mais o aumenta. O design não tenta contornar a detecção de envio em massa do WhatsApp.

## 8. Testes (Fase 1)

- Mesmo evento entregue duas vezes, inclusive após reiniciar o CRM: um único aviso.
- Eventos fora de ordem e `sequence` antiga.
- Sessão desconectada, número inexistente, falha do Baileys: o PDV segue normal e o log registra.
- Isolamento: eventos e rotas da barraca A nunca tocam a sessão, o log ou o histórico da barraca B.
- "Entregue" não dispara para pedido nascido entregue nem para correção de status.
- Pedido sem telefone: nenhum envio, log "pulado".
- Descadastro: "SAIR" para o aviso seguinte.
- Texto com variável vazia.

## 9. Deixado para o construtor

Formato exato das rotas novas do CRM e do proxy no Sai aê, modelagem das tabelas, política de retentativa e tetos de envio, texto padrão de cada aviso, desenho dos estados da aba, e ordem de deploy (o CRM faz `prisma db push` em todo start).

## 10. Decisões do João (aprovadas em 2026-10-23)

1. **Aviso atrasado com WhatsApp desconectado:** descartar após 15 min ("pronto"), 30 min ("recebido") e 60 min ("cancelado"). "Saiu para entrega" e "entregue" seguem os 15 min (decisão minha). Prazos numa constante fácil de mudar. Descartado vira `pulado_desconectado`.
2. **Módulo do bot:** R$ 69,90 por mês, com franquia de conversas incluída e excedente cobrado por bloco. O tamanho da franquia e o preço do bloco saem da medição de custo na loja de teste (palpite meu: margem de pelo menos 2x o custo medido). Passando da franquia, o bot volta ao modo "só manda o link do cardápio".
3. **Resposta da avaliação:** nota de 1 a 5 e comentário opcional vão para o WhatsApp do dono e para o histórico da aba. Nota 1 ou 2 chama o dono na hora. Google Avaliações fica para depois, só para notas 4 e 5.
4. **Pix pelo bot:** rota própria na `integracao-v1`, autenticada por HMAC, que gera a cobrança a partir de um rascunho já validado pelo servidor e grava o ID da conversa na cobrança pendente. O bot nunca informa valor.
5. Spec e ordem das fases aprovadas.

## 11. Não verificado

Conteúdo dos bancos, execução dos apps e testes, `antispam.ts`, o código interno do Baileys (`instance.ts`, `store/index.ts`), a spec de SSO e a de perfil do cliente, as policies RLS do Sai aê, os termos de uso do WhatsApp sobre conexões não oficiais, e o restante do `CLAUDE.md` do Sai aê (lido só até a linha 599 de 1131).
