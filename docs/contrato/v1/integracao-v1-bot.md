# Contrato v1: `integracao-v1` (bot de WhatsApp que atende e anota pedido)

Aditivo ao SAI-001 (`INTEGRACAO.md`). Fontes: `docs/superpowers/specs/2026-10-23-whatsapp-automacao-design.md` (seções 6 e 10) e `docs/superpowers/plans/2026-10-24-whatsapp-bot-fase2.md`. O Bearer do `INTEGRACAO.md` §3 continua reservado para integrações de terceiros; esta rota é de plataforma (CRM → Sai aê).

## 1. Autenticação
`POST {SUPABASE}/functions/v1/integracao-v1` (deploy sem JWT: a autenticação é a assinatura).
- `X-Saiae-Timestamp`: segundos desde 1970, janela de 300 s.
- `X-Saiae-Signature`: `"sha256=" + HMAC-SHA256(segredo, timestamp + "." + corpo bruto)`, comparação em tempo constante.
- Segredo de plataforma `WHATSAPP_CONEXAO_SEGREDO` (o mesmo do `crm-evento-sessao`): lista separada por vírgula para rotação, cada segredo com 16+ caracteres; vale se qualquer um conferir.
- A assinatura é conferida antes de qualquer consulta ao banco. Nenhuma resposta ecoa valores do corpo; nenhum log guarda corpo, telefone, nome, itens ou ids.

## 2. Erros de transporte
| Status | Quando |
|---|---|
| 401 (sem corpo) | assinatura ausente, errada, adulterada ou fora da janela |
| 405 (sem corpo) | método diferente de POST |
| 413 (sem corpo) | corpo acima de 4 KB |
| 422 (sem corpo) | JSON inválido ou corpo fora do contrato (ação desconhecida, chave extra, uuid/telefone inválido, mais de 40 linhas) |
| 503 (sem corpo) | `WHATSAPP_CONEXAO_SEGREDO` ausente ou sem nenhum segredo de 16+ caracteres |
| 500 `{ "erro": "Erro interno" }` | falha do banco; genérica |

Resposta 200 é sempre `{ "ok": boolean, ... }`. Erro de negócio é `ok:false` com `codigo` e `mensagem`.

## 3. Corpo comum
`{ "barraca_id": "<uuid>", "acao": "cardapio" | "rascunho" | "pedido" | "pix", ... }`. Só as chaves de cada ação abaixo são aceitas.
Cada linha de `itens`: `{ "item_id": "<uuid>", "quantidade": 1..99, "opcao_ids": ["<uuid>"], "observacao": "texto até 120" }` (`opcao_ids` e `observacao` opcionais; 1 a 40 linhas). O cliente do bot nunca envia preço nem total.

## 4. Ações
### `cardapio`
Corpo: só `barraca_id` e `acao`.
```json
{ "ok": true,
  "loja": { "nome": "", "slug": "", "link_cardapio": "https://app.../<slug>/cardapio", "aberta_agora": true,
            "modos": ["retirada", "entrega"], "pagamentos": { "na_entrega": true, "pix": false },
            "whatsapp_dono": "só dígitos, ou null (só o número confirmado)", "bot_habilitado": true },
  "itens": [ { "item_id": "", "nome": "", "descricao": null, "preco_centavos": 1200, "categoria": null, "esgotado": false,
               "grupos": [ { "grupo_id": "", "nome": "", "tipo": "variacao|adicional", "minimo": 0, "maximo": 2,
                             "opcoes": [ { "opcao_id": "", "nome": "", "preco_adicional_centavos": 200, "esgotado": false } ] } ] } ] }
```
Só itens ativos e sem preço aberto. `aberta_agora` segue o horário cadastrado (sem horário = aberta). `modos`: Retirada, e Entrega só com "pagar na entrega" ligado. `pagamentos.pix` é falso se a loja exige perfil confirmado. Informativo: nunca some preço no bot.

### `rascunho`
Corpo: `itens`. Não cria nada.
Sucesso: `{ "ok": true, "linhas": [{ "item_id", "nome_item", "quantidade", "preco_centavos_unitario", "opcoes", "observacao" }], "total_centavos": 2400 }`.
Erro: `{ "ok": false, "codigo": "carrinho_invalido", "erros": [{ "linha", "item_id", "codigo", "mensagem" }] }` (item inexistente/esgotado, opção inválida, mínimo/máximo do grupo etc., códigos do `resolver_carrinho`).

### `pedido` (pagar na entrega)
Corpo: `client_uuid` (uuid, chave de idempotência), `itens`, `cliente_telefone` (só dígitos, 10 a 13), `cliente_nome` (opcional na Retirada; obrigatório, 2+ letras, na Entrega), `tipo_atendimento` (`retirada` padrão, ou `entrega`), `entrega` (`{ rua, numero, bairro, referencia? }`, obrigatório na Entrega e proibido na Retirada).
Sucesso: `{ "ok": true, "senha": 4, "total_centavos": 2400 }`. O total é itens do `resolver_carrinho` + taxa de entrega calculada no banco. Cria o pedido por `criar_pedido` (método `na_entrega`).
Idempotência: o mesmo `client_uuid` devolve a MESMA senha e o mesmo total, sem criar outro pedido e sem reavaliar horário nem preço. `client_uuid` de outra loja: `client_uuid_em_uso`.
Recusas (`ok:false`, na ordem): `barraca_invalida`, `bot_desligado` (`barracas.ia_habilitada` falso), `fechado`, `modo_indisponivel`, `sem_pagar_na_entrega`, `carrinho_invalido`, `carrinho_vazio`, `bairro_nao_atendido`, `sem_estoque`.

### `pix`
Ver seção 5 (adicionada com a Task 3 do plano).

## 5. Interruptor
`barracas.ia_habilitada` liga o bot da loja (nasce desligado, exige o WhatsApp do dono confirmado). Desligado: `pedido` e `pix` recusam com `bot_desligado`; o CRM só manda o link do cardápio.
