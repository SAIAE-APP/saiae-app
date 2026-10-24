# Contrato v1: `integracao-v1` (bot de WhatsApp que atende e anota pedido)

Aditivo ao SAI-001 (`INTEGRACAO.md`). Fontes: `docs/superpowers/specs/2026-10-23-whatsapp-automacao-design.md` (seções 6 e 10) e `docs/superpowers/plans/2026-10-24-whatsapp-bot-fase2.md`. O Bearer do `INTEGRACAO.md` §3 continua reservado para integrações de terceiros; esta rota é de plataforma (CRM → Sai aê).

## 1. Autenticação
`POST {SUPABASE}/functions/v1/integracao-v1` (deploy sem JWT: a autenticação é a assinatura).
- `X-Saiae-Timestamp`: segundos desde 1970, janela de 300 s.
- `X-Saiae-Signature`: `"sha256=" + HMAC-SHA256(segredo, timestamp + "." + corpo bruto)`, comparação em tempo constante.
- Segredo de plataforma `WHATSAPP_CONEXAO_SEGREDO` (o mesmo do `crm-evento-sessao` e do `whatsapp-conexao`): lista separada por vírgula para rotação, cada segredo com 16+ caracteres. Na verificação (as três rotas) vale se qualquer um conferir; ao ASSINAR chamadas de saída vale o primeiro da lista.
- A assinatura é conferida antes de qualquer consulta ao banco. Nenhuma resposta ecoa valores do corpo; nenhum log guarda corpo, telefone, nome, itens ou ids.

## 2. Erros de transporte
| Status | Quando |
|---|---|
| 401 (sem corpo) | assinatura ausente, errada, adulterada ou fora da janela |
| 405 (sem corpo) | método diferente de POST |
| 413 (sem corpo) | corpo acima de 4 KB (pelo `Content-Length` declarado, antes de ler, ou pelo tamanho real) |
| 422 (sem corpo) | JSON inválido ou corpo fora do contrato (ação desconhecida, chave extra, uuid/telefone inválido, mais de 40 linhas) |
| 503 (sem corpo) | `WHATSAPP_CONEXAO_SEGREDO` ausente ou sem nenhum segredo de 16+ caracteres |
| 500 `{ "erro": "Erro interno" }` | falha do banco; genérica |

Resposta 200 é sempre `{ "ok": boolean, ... }`. Erro de negócio é `ok:false` com `codigo` e `mensagem`.

## 3. Corpo comum
`{ "barraca_id": "<uuid>", "acao": "cardapio" | "rascunho" | "pedido" | "pix", ... }`. Só as chaves de cada ação abaixo são aceitas.
`total_esperado_centavos` (inteiro >= 0, opcional) em `rascunho`, `pedido` e `pix`: o total que o cliente viu. Se divergir do total calculado agora (itens + taxa de entrega quando houver), a resposta é `{ "ok": false, "codigo": "total_mudou", "mensagem": "...", "total_centavos": <total atual> }` e nada é criado. No `pix` com cobrança já emitida, o total comparado é o do pendente. Sem o campo, nenhuma checagem.
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
Idempotência: o mesmo `client_uuid` devolve a MESMA senha e o mesmo total, sem criar outro pedido e sem reavaliar horário nem preço. `client_uuid` de outra loja, ou já usado por uma cobrança Pix (`pagamentos_pendentes`, qualquer loja): `client_uuid_em_uso`.
Recusas (`ok:false`, na ordem): `barraca_invalida`, `bot_desligado` (`barracas.ia_habilitada` falso), `fechado`, `modo_indisponivel`, `sem_pagar_na_entrega`, `carrinho_invalido`, `carrinho_vazio`, `bairro_nao_atendido`, `total_mudou`, `sem_estoque`.

### `pix`
Corpo: `client_uuid`, `conversa_id` (texto opaco do CRM, 1 a 200 caracteres, gravado em `pagamentos_pendentes.conversa_id`), `itens`, `cliente_telefone` (só dígitos, 10 a 13), `cliente_nome` (opcional) e `tipo_atendimento` (só `retirada`; `entrega` ou o campo `entrega` dão 422: Pix para Entrega fica fora desta fase).
Sucesso: `{ "ok": true, "copia_cola": "...", "expira_em": "ISO-8601", "total_centavos": 1200, "pendente_id": "<uuid>" }`. Grava `pagamentos_pendentes` com as linhas do `resolver_carrinho` e cria a cobrança no provedor da loja (referência = id do pendente). O pedido só nasce quando o webhook do provedor confirma o pagamento (o webhook não muda); o aviso "pedido recebido" da fase 1 (CRM) é a confirmação ao cliente. Sem cupom, sem entrega, sem pedido grátis.
Idempotência: o mesmo `client_uuid` com cobrança emitida devolve o MESMO QR (`copia_cola` e `expira_em` antigos) e o `total_centavos` do PENDENTE já emitido (congelado na emissão, nunca recalculado com o cardápio de agora), sem criar cobrança nova e sem reavaliar horário, estoque nem preço. Duas chamadas simultâneas com o mesmo `client_uuid`: só uma emite; a outra recebe `pix_em_andamento` e deve repetir (cai no retry do QR). `client_uuid` que já é de um pedido (qualquer loja) sem pendente da mesma loja: `client_uuid_em_uso`. Cobrança vencida ou rejeitada: `pix_expirado`; já paga: `ja_pago`.
Recusas (`ok:false`): `barraca_invalida`, `bot_desligado`, `fechado`, `modo_indisponivel`, `perfil_obrigatorio` (loja com `perfil_cliente_obrigatorio`: o bot cai para o link do cardápio), `sem_pix` (sem pagamento online ou sem token do provedor), `carrinho_invalido`, `carrinho_vazio`, `sem_estoque`, `provedor_indisponivel`, `client_uuid_em_uso`, `pix_em_andamento`, `pix_expirado`, `ja_pago`, `total_mudou`.

## 5. Interruptor
`barracas.ia_habilitada` liga o bot da loja (nasce desligado, exige o WhatsApp do dono confirmado). Desligado: `pedido` e `pix` recusam com `bot_desligado`; o CRM só manda o link do cardápio.
