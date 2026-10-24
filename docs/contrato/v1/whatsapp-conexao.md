# Contrato v1: conexão do WhatsApp e avisos de pedido (WhatsApp e Automação)

Aditivo ao SAI-001 (`INTEGRACAO.md`). Fonte: `docs/superpowers/specs/2026-10-23-whatsapp-automacao-design.md`.

## 1. Segredo e URLs
- Segredo de **plataforma** `WHATSAPP_CONEXAO_SEGREDO` (Sai aê, secret das edge functions) = `COMANDA_WHATSAPP_SEGREDO` (CRM, Railway). Mínimo de 16 caracteres; lista separada por vírgula no CRM para rotação. Nunca em repositório, log ou navegador.
- `CRM_WHATSAPP_CONEXAO_URL` (Sai aê): URL https pública da rota do CRM.
- Assinatura em toda chamada, nos dois sentidos: `X-Saiae-Event-Id` (= `request_id`), `X-Saiae-Timestamp` (segundos, janela de 5 min) e `X-Saiae-Signature = "sha256=" + HMAC-SHA256(segredo, timestamp + "." + corpo bruto)`, comparação em tempo constante, resposta idêntica em toda falha de autenticação.

## 2. Sai aê → CRM: `POST /api/integracao/comanda/v1/whatsapp-conexao`
Corpo: `{ "barraca_id": "<uuid>", "acao": "iniciar" | "status" | "desconectar" | "historico", "request_id": "<uuid>" }`.

Resposta 200:
```json
{ "estado": "sem_sessao | aguardando_qr | conectado | desconectado",
  "qr": "texto bruto do QR, só em aguardando_qr, senão null",
  "numero": "só dígitos, ou null",
  "avisos": [ { "pedido_id": "uuid", "tipo": "recebido|pronto|saiu_entrega|entregue|cancelado",
                "estado": "pendente|enviado|falhou|pulado_sem_telefone|pulado_optout|pulado_desconectado|pulado_nao_aplica",
                "motivo": "string|null", "em": "ISO-8601" } ] }
```
`avisos` só em `historico` (no máximo 20, mais recentes primeiro); nas outras ações vem `[]`. `iniciar` cria a sessão da barraca se não existir e a inicia. A rota só opera na sessão da barraca do corpo.
Erros: 401 (igual em toda falha de autenticação), 422 (corpo fora do contrato, nunca ecoa valores), 429, 503 (segredo ausente; nunca aceita sem segredo).

## 3. CRM → Sai aê: `POST {SUPABASE}/functions/v1/crm-evento-sessao` (sem JWT)
Corpo: `{ "barraca_id": "<uuid>", "estado": "conectado" | "desconectado" | "caiu", "occurred_at": "ISO-8601", "request_id": "<uuid>" }`. Corpo máximo 4 KB. `occurred_at` mais antigo que o estado gravado é ignorado. Barraca desconhecida responde igual ao sucesso. 200 `{ "ok": true }`; 401 e 422 como acima; 503 sem segredo.

## 4. Campo `data.avisos` nos eventos `order.*`
Ver `evento.schema.json` (`aviso_config`) e `exemplos/pedido-com-avisos.json`. Ausente = os cinco avisos ativos com texto padrão. `ativo: false` = não enviar (e registrar). `texto: null` = padrão. Variáveis `{nome}` `{senha}` `{barraca}`: variável sem valor some da frase junto do espaço antes dela. Texto que ficar vazio depois de trocar as variáveis (ex.: só `{nome}` sem nome) também vale como padrão: o CRM deve aplicar essa regra.

## 5. Quais eventos geram qual aviso
| Aviso | Evento |
|---|---|
| `recebido` | `order.created` |
| `pronto` | `order.ready` |
| `saiu_entrega` | `order.out_for_delivery` |
| `entregue` | `order.status_changed` com `data.status = "entregue"` (não para pedido nascido entregue nem correção de status) |
| `cancelado` | `order.cancelled` |

## 6. Validade do aviso atrasado (aplicada no CRM)
`recebido` 30 min; `pronto`, `saiu_entrega`, `entregue` 15 min; `cancelado` 60 min. Passou da validade: não envia, registra `pulado_desconectado`.
