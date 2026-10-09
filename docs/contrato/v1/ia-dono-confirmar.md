# Contrato SAI-003 — confirmação do WhatsApp do dono (Comanda ⇄ CRM)

Antes de ligar a IA, o dono precisa **provar que é dono do número** que cadastrou como responsável pelos avisos. Sem isso, qualquer um poderia cadastrar o número de um terceiro e a plataforma mandaria a mensagem a ele. Mesma família de assinatura do SAI-002 (`ia-contexto`); segredo de plataforma `IA_CONTEXTO_SEGREDO` (Comanda) = `COMANDA_IA_SEGREDO` (CRM), nunca em chat, repositório, log ou prompt.

Assinatura (os dois sentidos): `X-Saiae-Timestamp` = segundos desde 1970 (inteiro canônico); `X-Saiae-Signature` = `sha256=` + HMAC-SHA256 hex minúsculo de `timestamp + "." + corpo bruto`; janela de **5 min**; corpo máx. **4 KB**. Enviar o corpo exatamente como foi assinado.

## Fluxo
1. O dono salva o WhatsApp (com 55) em Ajustes › Atendente IA. Trocar o número depois **zera a confirmação e desliga a IA**.
2. Toque em **Enviar confirmação**: o app chama a function `ia-dono-pedir-confirmacao` (com o login do dono), que confere o acesso à loja, gera o código da loja se ainda não existir, aplica 60 s entre pedidos e pede ao CRM (item 1) que mande o template `ia_chamar_dono` ao número cadastrado com o motivo "confirmar este número como responsável; responda CONFIRMAR #CODIGO".
3. O dono responde `CONFIRMAR #CODIGO` **do próprio número**. O CRM só avisa a Comanda (item 2) se o número de quem respondeu é o número cadastrado.
4. A Comanda grava `barracas.ia_whatsapp_dono_confirmado_em`. Só então `ia_ligar` aceita ligar (erro `ia_dono_nao_confirmado` antes disso). A tela mostra "aguardando confirmação" e depois "WhatsApp confirmado".

## 1. Comanda → CRM — `POST {CRM}/api/integracao/comanda/v1/ia-dono-pedir-confirmacao`
Corpo:
```json
{ "codigo_loja": "ABC234", "telefone": "5561988887777" }
```
- `codigo_loja`: 6 caracteres `[A-Z0-9]`. `telefone`: só dígitos, **com 55** (12 ou 13), lido do **banco da Comanda** (nunca do navegador). O CRM manda o template para **este** telefone; **não** deve buscá-lo no `ia-contexto` (a IA ainda está desligada e o contexto devolve `{ "ativa": false }`).

Respostas esperadas pela Comanda:
| Status | Corpo |
|---|---|
| 200 | `{ "enviado": true }` ou `{ "enviado": false, "motivo": "sem_whatsapp" \| "ia_inativa" \| "limite" \| "falha_envio" }` |
| 401 / 400 / 503 | vazio |

Limite do CRM: 3 pedidos por loja por dia (`limite`). Qualquer resposta fora disso a Comanda trata como falha e mostra "tente de novo"; o erro cru do CRM nunca chega à tela. Env na Comanda: `CRM_IA_DONO_PEDIR_URL`.

## 2. CRM → Comanda — `POST {SUPABASE_URL}/functions/v1/ia-dono-confirmar`
Sem JWT (a autenticação é a assinatura). Corpo igual ao do `ia-contexto`:
```json
{ "codigo_loja": "ABC234", "telefone": "5561988887777" }
```
`telefone` = o número de **quem respondeu** (só dígitos, 10 a 13, com ou sem 55). A Comanda compara com o cadastrado ignorando o 55 e usando **DDD + 8 últimos dígitos** (o WhatsApp às vezes entrega sem o 9º dígito).

| Status | Quando | Corpo |
|---|---|---|
| 200 | gravou, ou já estava confirmado (idempotente) | `{ "confirmado": true }` |
| 200 | número diferente do cadastrado, ou loja inexistente | `{ "confirmado": false, "motivo": "numero_diferente" \| "loja_inexistente" }` |
| 400 | assinatura válida, corpo inválido | `{ "erro": "Corpo inválido" }` |
| 401 | assinatura ausente/errada ou fora da janela | vazio |
| 405 / 413 / 503 | método, tamanho, segredo não configurado | vazio |
| 500 | falha ao gravar | `{ "confirmado": false, "motivo": "erro" }` |

O CRM só diz "confirmado" ao dono quando recebe `{ "confirmado": true }`.

## Mudanças no `ia-contexto` (SAI-002, aditivas)
- `ia.dono_confirmado: boolean` — o número do dono está confirmado.
- `ia.plano_limite_conversas`: quando o plano não tem linha em `ia_limites_plano`, passa a valer **200** (padrão seguro) em vez de `null`.

## Publicação (só por ordem do dono)
```
supabase functions deploy ia-dono-confirmar --no-verify-jwt --project-ref <ref>
supabase functions deploy ia-dono-pedir-confirmacao --project-ref <ref>
```
Staging `qzcqwovbbylqxljcrqhk` primeiro. Aplicar a migration `20261019150000_ia_dono_confirmado.sql` **antes** dos deploys e do front. Lojas que já estavam com a IA ligada (só a de teste) seguem ligadas até alguém trocar o número.
