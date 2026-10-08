# Integração Comanda ⇄ CRM — contrato v1 (RASCUNHO)

> Status: **rascunho, aguardando aprovação do dono do produto e das duas frentes.**
> Fonte: SAI-001 do `PLANO-AGIL-SAIAE.md`. Regra: só mudanças aditivas na v1; quebra = v2 (a v1 vive 90 dias).
> A Comanda é a fonte de verdade de loja, cardápio, pedido e cliente (ADR-01). O CRM guarda só conversa e mensagem.

## 1. Identidade e vínculo
- Tenant = barraca. Toda chamada e todo evento carrega `barraca_id` (UUID da Comanda).
- Cada sessão de WhatsApp do CRM guarda o `comanda_barraca_id` a que pertence. Uma barraca pode ter 1..N sessões.
- Segredos são por barraca e rotacionáveis. Nunca em repositório, log ou navegador.

## 2. Comanda → CRM: webhooks de eventos
`POST {CRM}/api/integracao/comanda/v1/eventos`

Cabeçalhos:
| Cabeçalho | Valor |
|---|---|
| `X-Saiae-Event-Id` | UUID do evento (igual ao `id` do corpo) |
| `X-Saiae-Timestamp` | epoch em segundos |
| `X-Saiae-Signature` | `sha256=` + HMAC-SHA256(segredo da barraca, `timestamp + "." + corpo bruto`) |

Regras:
- O CRM rejeita (401) assinatura inválida ou `timestamp` com diferença maior que 5 min.
- Idempotência por `id`: duplicata responde 200 sem reprocessar.
- Resposta 2xx = entregue. Qualquer outra = retry com backoff 1 min, 5 min, 30 min, 2 h, 12 h; depois vai para a fila de falhas (visível na Comanda).
- Ordem: `sequence` é crescente por `pedido_id`. O CRM ignora evento com `sequence` menor que o já visto.
- `occurred_at` é sempre hora do **servidor** (nunca do aparelho, que pode vir atrasado pela fila offline).

Envelope (ver `docs/contrato/v1/evento.schema.json`):
```json
{ "id": "uuid", "type": "order.created", "version": 1,
  "occurred_at": "2026-10-07T20:00:00Z", "barraca_id": "uuid",
  "sequence": 1, "data": { } }
```

Eventos v1:
| Tipo | Disparo |
|---|---|
| `order.created` | pedido criado (operador, cardápio, IA) |
| `order.paid` | pagamento confirmado (webhook do provedor, ou método definido na entrega) |
| `order.status_changed` | qualquer mudança de `status` |
| `order.ready` | status passou a `pronto` (pedido nascido `entregue` não dispara) |
| `order.cancelled` | status passou a `cancelado` |
| `customer.created`, `customer.updated` | cliente novo ou alterado |
| `coupon.redeemed` | **reservado** (Sprint 3) |

`data` de `order.*`: `pedido_id`, `senha`, `status`, `tipo_atendimento`, `itens[]` (`nome`, `quantidade`, `preco_centavos`, `observacao`), `taxa_entrega_centavos`, `total_centavos`, `metodo_pagamento`, `cliente` (`nome`, `telefone`, `consentimento_contato`).
Minimização (LGPD): `telefone` só vai se existir; o CRM o usa só para aviso de pedido. Marketing exige o consentimento separado que a Comanda já guarda.

Implementação na Comanda (frente B): tabela `eventos_saida` (outbox) alimentada por trigger em `pedidos` (`AFTER INSERT` e `AFTER UPDATE OF status`), com worker (edge function + cron) que assina, envia e retenta. Os itens são lidos no worker, não no trigger (itens entram depois do pedido). Filtrar por `OF status` para não gerar evento de `cliente_avisado_em`.

## 3. CRM → Comanda: API
Base: edge function `integracao-v1`. Autenticação: `Authorization: Bearer <chave>`; chave por integração, guardada com hash, escopada a uma barraca.

| Método e rota | Resposta |
|---|---|
| `GET /barracas/{id}` | nome, slug, modos de atendimento, fuso |
| `GET /cardapio` | itens **ativos e não esgotados**: id, nome, preço, descrição, categoria |
| `GET /horario` | aberto agora (fuso da barraca) e próximos horários |
| `GET /taxa-entrega?bairro=` | taxa ou "não entrega" |
| `GET /pedidos/status?telefone=&senha=` | status, **só do próprio cliente** |
| `POST /eventos` | recebe `optout.registered` e `conversation.handoff` |

Reservado para a v1.1 (Sprint 4): `POST /rascunhos-pedido` e `POST /pedidos` (confirmar). Toda ação de IA que gera dinheiro exige confirmação explícita do cliente e log (ADR-06).

## 4. Testes de contrato
- Fonte: `docs/contrato/v1/` neste repositório (JSON Schema e exemplos).
- O CRM mantém cópia **fixada por versão**; os dois CIs validam os exemplos contra o schema.
- Mudança de schema só por PR de contrato aprovado pelas duas frentes.

## 5. Pendências para a outra frente
- CRM: rota `/api/integracao/comanda/v1/eventos`, campo `comanda_barraca_id` na sessão, cópia do schema.
- Comanda: outbox, worker, `integracao-v1`, cadastro/rotação de segredos em Ajustes.
- Ambas: SSO (ver spec), staging e CI.

## 6. Estado do último teste de integração
Nenhum ainda.
