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

`data` de `order.*`: `pedido_id`, `senha`, `status`, `tipo_atendimento`, `itens[]` (`nome`, `quantidade`, `preco_centavos`, `observacao`, `opcoes[]`), `taxa_entrega_centavos`, `total_centavos`, `metodo_pagamento`, `cliente` (`nome`, `telefone`, `consentimento_contato`).
Minimização (LGPD): `telefone` só vai se existir; o CRM o usa só para aviso de pedido. Marketing exige o consentimento separado que a Comanda já guarda.

Implementação na Comanda (frente B): tabela `eventos_saida` (outbox) alimentada por trigger em `pedidos` (`AFTER INSERT` e `AFTER UPDATE OF status`), com worker (edge function + cron) que assina, envia e retenta. Os itens são lidos no worker, não no trigger (itens entram depois do pedido). Filtrar por `OF status` para não gerar evento de `cliente_avisado_em`.

## 3. CRM → Comanda: API
Base: edge function `integracao-v1`. Autenticação: `Authorization: Bearer <chave>`; chave por integração, guardada com hash, escopada a uma barraca.

| Método e rota | Resposta |
|---|---|
| `GET /barracas/{id}` | nome, slug, modos de atendimento, fuso |
| `GET /cardapio` | itens **ativos e não esgotados**: id, nome, preço, descrição, categoria, `grupo_ids[]`; mais `grupos[]` com `opcoes[]` (ver §3.1). Schema: `docs/contrato/v1/cardapio.schema.json` |
| `GET /horario` | aberto agora (fuso da barraca) e próximos horários |
| `GET /taxa-entrega?bairro=` | taxa ou "não entrega" |
| `GET /pedidos/status?telefone=&senha=` | status, **só do próprio cliente** |
| `POST /eventos` | recebe `optout.registered` e `conversation.handoff` |

Reservado para a v1.1 (Sprint 4): `POST /rascunhos-pedido` e `POST /pedidos` (confirmar). Toda ação de IA que gera dinheiro exige confirmação explícita do cliente e log (ADR-06).

### 3.1 Adicionais e variações (SAI-010) — aditivo na v1
Fonte: `docs/superpowers/specs/2026-10-07-sai-010-adicionais-design.md`. Só campos novos e opcionais; consumidor v1 que os ignora continua válido.
- **Modelo:** `grupos[]` (`id`, `nome`, `tipo` = `variacao` | `adicional`, `min_escolhas`, `max_escolhas` — null = sem limite) com `opcoes[]` (`id`, `nome`, `preco_centavos`, `esgotado`). Item aponta para seus grupos em `grupo_ids[]`. Obrigatório = `min_escolhas >= 1`.
- **Regra fixa na v1 (variação):** no máximo **um** grupo `tipo = variacao` por item e, nele, `min_escolhas = 1` e `max_escolhas = 1`. Só `adicional` pode ter outros min/max. A Comanda valida isso no cadastro e no `resolver_carrinho`.
- **Item não pedível:** se um grupo obrigatório (`min_escolhas >= 1`) do item tem **todas** as opções esgotadas, o item não pode ser pedido e a Comanda **omite** o item de `GET /cardapio`.
- **Preço:** em `variacao` o `preco_centavos` da opção é o preço **absoluto** da unidade e substitui o preço base do item (que vira "a partir de"); em `adicional` é o valor **somado**. O preço final é sempre resolvido pela Comanda.
- **Presença:** `grupos` e `grupo_ids` só vêm em loja com opções habilitadas. Loja sem isso continua devolvendo apenas `itens`.
- **Eventos `order.*`:** `itens[].opcoes[]` é o snapshot das escolhas (`grupo_id`, `grupo_nome`, `tipo`, `opcao_id`, `nome`, `preco_centavos`, `quantidade` — sempre 1 na v1; o leitor deve tolerar valores maiores). `itens[].preco_centavos` continua sendo o preço **final** da unidade; o `total_centavos` não muda de fórmula. Item simples: `opcoes` ausente ou vazio.
- **Fora da v1:** quantidade por opção, meio a meio, combos, estoque por opção.
- **Criar pedido pela IA** (`POST /rascunhos-pedido`, reservado): o cliente do CRM envia só `item_id`, `opcao_ids[]`, `quantidade` e `observacao`; preço e validação de min/max são da Comanda. A resposta devolve o **preço final por linha e o `total_centavos` já resolvidos pela Comanda**; a IA nunca soma sozinha (ADR-06).
- Exemplos: `docs/contrato/v1/exemplos/cardapio-com-opcoes.json` e `pedido-itens-com-opcoes.json`.

## 4. Testes de contrato
- Fonte: `docs/contrato/v1/` neste repositório (JSON Schema e exemplos).
- O CRM mantém cópia **fixada por versão**; os dois CIs validam os exemplos contra o schema.
- Mudança de schema só por PR de contrato aprovado pelas duas frentes.

## 5. Pendências para a outra frente
- CRM: rota `/api/integracao/comanda/v1/eventos`, campo `comanda_barraca_id` na sessão, cópia do schema.
- Comanda: outbox, worker, `integracao-v1`, cadastro/rotação de segredos em Ajustes.
- Ambas: SSO (ver spec), staging e CI.

### 5.1 Outbox de eventos (SAI-013, lado Comanda) — como ligar
- Migration `20261016110000_eventos_saida.sql` (depende da `20261015100000`): tabelas `integracao_crm` (URL + segredo por barraca, sem leitura pela API) e `eventos_saida`, 4 triggers, `montar_evento_saida`, RPCs do worker (`reservar_eventos_saida`, `concluir_evento_saida`, só service role) e de Ajustes (`integracao_crm_*`).
- Edge function `enviar-eventos-saida` (`--no-verify-jwt`): secret `EVENTOS_WORKER_SECRET`. O pg_cron (1/min) chama `disparar_worker_eventos()`, que faz o POST com o cabeçalho `x-worker-secret`. Para funcionar, preencher em `app_config`: `eventos_worker_url` (URL da function) e `eventos_worker_secret` (mesmo valor), ambos JSON string. Sem isso o cron não faz nada.
- Por barraca (Ajustes > Cardápio & Operação > Integração com o CRM): URL do CRM (https), gerar segredo (mostrado uma vez; vai para `COMANDA_WEBHOOK_SECRETS` do CRM) e ligar. Sem integração ativa nada é gravado no outbox.
- Disparos: `order.created` (INSERT em pedidos), `order.status_changed`/`order.ready`/`order.cancelled` (UPDATE OF status), `order.paid` (Pix: webhook liga a cobrança ao pedido; entrega: método deixa de ser `na_entrega`). `cliente_avisado_em` não gera evento. Retry 1 min, 5 min, 30 min, 2 h, 12 h; depois "com falha" (Ajustes mostra e reenvia). `sequence` crescente por pedido e um evento só sai depois dos anteriores do mesmo pedido.
- Limites conhecidos: a guarda de SSRF do worker recusa http, hosts internos e IP privado literal, mas não DNS que resolva para IP privado; evento de pedido sem integração ativa na hora não é criado depois (sem backfill).

## 6. Estado do último teste de integração
Nenhum ainda.
