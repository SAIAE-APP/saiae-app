# Contrato v1: disparos (campanhas) e avaliação pós-entrega

Aditivo ao contrato de conexão (`whatsapp-conexao.md`). Plano: `docs/superpowers/plans/2026-10-24-whatsapp-disparos-fase3.md`. Spec: `docs/superpowers/specs/2026-10-23-whatsapp-automacao-design.md` §7 e §10.

## 1. Responsabilidades
- **Sai aê** decide o público (clientes com `consentimento_marketing_em`), mostra a prévia e só envia ao CRM quando o dono confirma. O CRM nunca lê o banco do Sai aê.
- **CRM** é dono da fila, dos tetos, do "SAIR" e do envio. Toda mensagem de campanha termina com `Para não receber mais mensagens, responda SAIR.`
- A avaliação nasce do evento `order.status_changed` com `status = entregue`; o CRM consulta a configuração pela ação `avaliacao_config` da `integracao-v1`.

## 2. Segredo, URLs e assinatura
Igual ao contrato de conexão: segredo `WHATSAPP_CONEXAO_SEGREDO` (Sai aê) = `COMANDA_WHATSAPP_SEGREDO` (CRM); cabeçalhos `X-Saiae-Event-Id` (= `request_id`), `X-Saiae-Timestamp` (janela de 5 min) e `X-Saiae-Signature`.
URL no Sai aê: `CRM_WHATSAPP_DISPAROS_URL`; sem ela, deriva de `CRM_WHATSAPP_CONEXAO_URL` trocando o final `whatsapp-conexao` por `whatsapp-disparos`.

## 3. Sai aê → CRM: `POST /api/integracao/comanda/v1/whatsapp-disparos`
Rota pública no proxy do CRM (caminho exato). Mesma ordem de checagens da rota de conexão: 503 (segredo ausente) → 413 (corpo acima de 262144 bytes) → 401 → 400 → 422 (corpo estrito fora do contrato, `X-Saiae-Event-Id` diferente de `request_id`) → 429 (30 chamadas/min por loja) → ação.

Campos comuns: `barraca_id` (uuid), `request_id` (uuid), `acao`.

### `criar`
`tipo` (`promocao` | `reativacao`), `texto` (1 a 600), `barraca_nome` (1 a 80), `destinatarios` (1 a 500 itens `{ "telefone": "8 a 15 dígitos", "nome": "até 60 | null" }`).
- 200 `{ "ok": true, "campanha_id": "…", "total": n, "invalidos": n, "repetido": bool }`. `repetido: true` quando o `request_id` já existia (devolve a campanha original, sem duplicar envio).
- 200 `{ "ok": false, "motivo": "whatsapp_desconectado | campanha_em_andamento | limite_campanhas_dia | sem_destinatarios_validos" }`.

### `historico`
200 `{ "ok": true, "campanhas": [{ "id", "tipo", "estado", "criada_em", "total", "enviados", "falhas", "pulados", "na_fila" }], "avaliacoes": { "media": n|null, "total": n, "enviadas_30d": n, "itens": [{ "pedido_id", "nota", "comentario": "string|null", "em" }] } }`.
Até 10 campanhas (mais recentes primeiro) e 20 avaliações. `estado`: `em_andamento | concluida | cancelada | expirada`.

### `cancelar`
`campanha_id` (string 1 a 40). 200 `{ "ok": true, "cancelados": n }`. Campanha de outra loja = `cancelados: 0`.

## 4. CRM → Sai aê: `integracao-v1`, ação `avaliacao_config`
Mesmo envelope HMAC das demais ações (sem JWT). Corpo `{ "barraca_id", "acao": "avaliacao_config" }` (nenhum outro campo).
Resposta 200 `{ "ok": true, "avaliacao": { "ativo": bool, "texto": "string|null", "whatsapp_dono": "dígitos|null", "barraca_nome": "string" } }`. `ativo` = módulo liberado E avaliação ligada. `texto: null` = texto padrão do CRM. `whatsapp_dono` vem do WhatsApp do dono cadastrado (IA) ou, na falta, do WhatsApp de pedidos. Loja inexistente: `{ "ok": false, "codigo": "barraca_invalida" }`.

## 5. App → edge function `whatsapp-disparos` (com JWT)
Corpo `{ "barraca_id", "acao", … }`. Exige vínculo em `usuarios_barracas` (403 sem vínculo). `enviar` e `cancelar` só `papel = 'dono'`. Módulo desligado (`barracas.whatsapp_disparos_habilitado = false`) = 403 `{ "erro": "modulo_desligado" }`. Falha do CRM = 502 `{ "erro": "Conexão indisponível" }`; o erro do CRM nunca chega ao navegador, nem telefones.

| Ação | Corpo extra | Resposta |
|---|---|---|
| `previa` | `tipo`, `dias?` | `{ ok, total, enviaveis }` (`enviaveis = min(total, 500)`) |
| `enviar` | `tipo`, `dias?`, `texto` | `{ ok: true, campanha_id, total }` ou `{ ok: false, motivo }` (motivos do CRM mais `sem_publico`) |
| `historico` | | repassa o `historico` do CRM |
| `cancelar` | `campanha_id` | `{ ok: true, cancelados }` |

`dias` é obrigatório e em 15 | 30 | 60 | 90 quando `tipo = reativacao`. Texto: 1 a 600 caracteres depois do `trim`.

## 6. Banco (Sai aê)
- `barracas.whatsapp_disparos_habilitado` (módulo pago, default false; só a plataforma altera), `avaliacao_ativa` (default false) e `avaliacao_texto` (até 500; nulo = padrão). O cliente autenticado não escreve as três colunas direto (trigger `barracas_disparos_proteger`); a avaliação muda só pela RPC `whatsapp_avaliacao_salvar(p_barraca_id, p_ativa, p_texto)` (estados `ok | nao_autenticado | sem_acesso | modulo_desligado | dados_invalidos`).
- RPCs só para `service_role`: `disparos_publico(p_barraca_id, p_tipo, p_dias)` (telefone, nome; ignora pedido cancelado, só consentidos; reativação = última atividade, maior entre último pedido e cadastro, mais antiga que `p_dias`, mais recentes primeiro), `disparos_publico_contagem(...)` e `integracao_avaliacao_config(p_barraca_id)`.
- Ordem de deploy: migrations `20261101100000` e `20261101110000` → functions `whatsapp-disparos` e `integracao-v1` → app. Rollback no cabeçalho de cada migration.

## 7. Limites assumidos
- O público é calculado e enviado ao CRM na hora do "Enviar"; o CRM guarda telefone e nome só enquanto o item está pendente.
- Pedido casa com o cliente por `cliente_id` ou pelo telefone do pedido (`cliente_telefone` / `entrega_telefone`), o mesmo critério dos eventos de saída.
- Não existe registro de reclamação no Sai aê: a trava da avaliação é "sem cancelamento no mesmo pedido" (aplicada no CRM).
- Baileys é conexão não oficial: risco de bloqueio do número permanece. A cobrança do módulo fica fora do código.
