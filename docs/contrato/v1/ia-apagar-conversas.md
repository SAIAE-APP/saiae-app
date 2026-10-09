# Contrato SAI-004 — apagar conversas da IA no CRM (Comanda → CRM)

Quando o cliente apaga os dados dele (perfil) ou o dono exclui a conta, a Comanda pede ao CRM que apague também as conversas da IA do WhatsApp. Assinatura igual à do SAI-002 (`ia-contexto`); segredo de plataforma `IA_CONTEXTO_SEGREDO` (Comanda) = `COMANDA_IA_SEGREDO` (CRM), nunca em chat, repositório, log ou prompt.

## Requisição — `POST {CRM}/api/integracao/comanda/v1/ia-apagar-conversas`
| Cabeçalho | Valor |
|---|---|
| `X-Saiae-Timestamp` | segundos desde 1970, inteiro canônico |
| `X-Saiae-Signature` | `sha256=` + HMAC-SHA256 hex minúsculo de `timestamp + "." + corpo bruto` |
| `Content-Type` | `application/json` |

Corpo (máx. 1 KB), uma de duas formas:
```json
{ "codigo_loja": "ABC234", "telefone": "5561988887777" }
{ "codigo_loja": "ABC234" }
```
- Com `telefone` (só dígitos, 10 a 13; a Comanda envia com 55): apaga as conversas desse telefone nessa loja e a conversa "sem loja" do mesmo número (com e sem o 9º dígito). Não apaga o opt-out.
- Sem `telefone`: apaga **todas** as conversas da loja (exclusão de conta). `telefone` presente porém vazio, nulo ou inválido = 400 (nunca vira exclusão em massa por engano).

Respostas: `200 { "apagadas": n }` (n pode ser 0); `401` assinatura/timestamp; `400` corpo fora do contrato; `413` corpo > 1 KB; `503` sem segredo; todos os erros sem corpo. **Idempotente**: repetir é seguro.

## Lado Comanda
- `cliente_apagar_dados` (apagar dados do cliente) e `excluir_dados_conta` (exclusão de conta) **só enfileiram** o pedido em `ia_apagar_fila`, na mesma transação do apagamento local. Loja sem `ia_codigo` (a IA nunca foi ligada) não enfileira nada. Na exclusão de conta enfileira a loja inteira **e** cada telefone conhecido (perfis e pedidos), para cobrir também a conversa "sem loja".
- O envio é feito logo depois do apagamento (`cliente-sessao` ação `apagar`, `excluir-conta`) e, para o que falhou, pelo job `ia-apagar-processar` (agendar a cada 15 min). **Falha do CRM nunca impede o apagamento na Comanda.**
- Retentativa: backoff de 15 min × 2^tentativas (máx. 6 h). `200` = sucesso (sai da fila); `400` = erro de contrato (sai da fila, sem retentar); qualquer outra coisa retenta. Pedido com mais de **14 dias** é descartado: a fila guarda telefone, então nunca fica parada para sempre. A fila só guarda código da loja e telefone, e a linha some no sucesso.
- Logs: mensagem fixa, nunca telefone, código ou corpo.
- Limite conhecido: quem conversou com a IA sem nunca ter perfil nem pedido não é conhecido da Comanda; essa conversa só sai do CRM pelo prazo de retenção dele (30 dias), ou pela exclusão de conta (loja inteira).

## Publicação (só por ordem do dono)
Migration `20261019160000_ia_apagar_fila.sql` **antes** de tudo. Envs na Comanda: `CRM_IA_APAGAR_URL` (URL completa da rota) e `IA_APAGAR_JOB_SEGREDO` (segredo do job, gerado pelo dono). Depois:
```
supabase functions deploy cliente-sessao --no-verify-jwt --project-ref <ref>
supabase functions deploy excluir-conta --project-ref <ref>
supabase functions deploy ia-apagar-processar --no-verify-jwt --project-ref <ref>
```
Agendar `POST .../functions/v1/ia-apagar-processar` com `Authorization: Bearer <IA_APAGAR_JOB_SEGREDO>` a cada 15 min. Staging `qzcqwovbbylqxljcrqhk` primeiro. Sem `CRM_IA_APAGAR_URL` os pedidos ficam na fila (até 14 dias) e o apagamento local acontece normalmente.
