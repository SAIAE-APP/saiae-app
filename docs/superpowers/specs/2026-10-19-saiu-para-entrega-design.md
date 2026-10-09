# "Saiu para entrega" — coluna do kanban e aviso ao cliente (spec curta)

Estado: **proposta para o João**. Só documento. Depende de: link do motoboy (`/e/:token`, já no ar), "pagar depois" (Fase 1, já no ar) e do modelo Meta `pedido_saiu_entrega_v2` (ativo) no CRM.

## 1. Problema
Hoje o kanban tem duas colunas (A fazer, Pronto) e o pedido de Entrega fica "Pronto" até alguém tocar "Entregue". Não dá para saber quais já saíram com o motoboy, e o cliente não recebe o aviso "seu pedido saiu para entrega" (existe só o botão manual "Avisar cliente" quando fica pronto).

## 2. Comportamento
- **Quatro estados só para Entrega:** A fazer → Pronto → **Saiu para entrega** → Entregue. Retirada, Mesa e Balcão seguem **A fazer → Pronto → Entregue**, como hoje.
- **A coluna só existe** quando o modo **Entrega está ligado** em Ajustes (`barracas.modos_atendimento` inclui `entrega`) **e** o interruptor novo `barracas.saiu_entrega_habilitado` (padrão false) está ligado. Desligado, o kanban é idêntico ao de hoje. A coluna **só mostra pedidos de Entrega**.
- **Card em Pronto (Entrega):** o botão principal vira **"Saiu para entrega"** (e "Voltar" continua). Ao tocar, uma folha oferece **"Enviar link ao entregador"** (reaproveita `BotoesLinkEntregador`: WhatsApp sem número + copiar link) e **"Pular"**; o pedido vai para a coluna nova.
- **Card em Saiu para entrega:** mostra o tempo desde que saiu, o telefone/endereço (como o Detalhe) e os botões **"Entregue"** e **"Voltar para Pronto"**.
- **Cronômetro e semáforo:** congelam em Pronto, como hoje (a cor operacional não muda na coluna nova); o card mostra "saiu há N min".
- **Tela de Chamada:** pedido de Entrega que saiu deixa a lista de senhas chamadas.
- **Histórico/relatórios:** rótulo "Saiu para entrega"; tempo de entrega (saiu → entregue) fica disponível como dado, sem tela nova nesta fase.

## 3. Ligação com o link do motoboy
- O motoboy continua confirmando pelo link (`entregador_confirmar`): isso leva o pedido a **Entregue** de qualquer estado não cancelado (inclusive Saiu para entrega) e grava a forma de pagamento escolhida por ele. Se ele abrir o link **antes** de o operador tocar "Saiu", o link já funciona.
- Tocar "Saiu para entrega" **não** gera outro link: o token do pedido (`entrega_token`) já existe desde a criação.

## 4. Ligação com "pagar depois"
- Pedido de Entrega "A receber" (`na_entrega`, interruptor ligado) segue com a etiqueta **"A receber"** nas colunas Pronto e Saiu.
- Quem define a forma: o **motoboy** no link (a etiqueta some quando ele confirma) ou o **operador** ao tocar "Entregue" no card (modal "Como o cliente pagou?", que já existe). "Saiu para entrega" **não** pergunta a forma.
- A correção da forma continua só no Histórico (dono, antes da NFC-e).

## 5. Aviso ao cliente (pelo CRM)
- Novo evento de saída **`order.out_for_delivery`** (aditivo: entra no CHECK de `eventos_saida.tipo` e no `evento.schema.json`; `data.status` ganha o valor `saiu_entrega`). Emitido pelo gatilho que já existe em `pedidos` quando o status muda para `saiu_entrega`, junto de `order.status_changed`.
- O CRM, ao receber, envia o modelo **`pedido_saiu_entrega_v2`** ao telefone do pedido (`cliente_telefone` ou o telefone da entrega) **só se** o cliente aceita avisos (`aceita_avisos_pedido` quando há perfil) e a loja tem o CRM ligado. **No máximo um aviso por pedido** (o CRM deduplica por pedido + tipo, então voltar e sair de novo não reenvia). Variáveis sugeridas: primeiro nome, senha, nome da loja. **Não envia o link do motoboy ao cliente** (é do entregador).
- Sem CRM ou com o envio falhando, o botão manual "Avisar cliente" (WhatsApp sem API) continua existindo no card, como fallback.

## 6. Modelo de dados (aditivo)
- `pedidos.saiu_entrega_em timestamptz` e `barracas.saiu_entrega_habilitado boolean not null default false`.
- `pedidos.status` é texto sem CHECK: o valor novo `saiu_entrega` entra sem mudar constraint. Atenção: tudo que filtra por `a_fazer/pronto/entregue` precisa tratar o valor (Cozinha, Chamada, Histórico, relatórios, Caixa, estoque, `entregador_confirmar`); o plano abaixo lista cada ponto.
- Contrato SAI-001: `order.out_for_delivery` e o status novo, aditivos (consumidores que ignoram tipos desconhecidos seguem funcionando; aviso à aorus-03).

## 7. Offline e versões antigas
- A mudança de estado vai pela fila (`mudar_status`) como as demais, com `saiu_entrega_em` no payload.
- **Migration antes do front:** sem a coluna, o update da fila falharia e travaria a fila; por isso a migration entra e o interruptor só liga depois.
- **App antigo** não conhece o status: pedido em Saiu para entrega **some** do kanban dele (a Cozinha antiga só mostra A fazer e Pronto). Mitigação: ligar o interruptor só depois de atualizar todos os aparelhos da loja; o Histórico antigo mostra o pedido com status desconhecido.

## 8. Decisões para o João
1. "Saiu para entrega" também vale para **Retirada** (cliente busca)? Proposta: **não**, só Entrega.
2. O aviso ao cliente sai **ao tocar "Saiu"** (proposto) ou só quando o operador confirmar o envio da mensagem?
3. Pedir o link do motoboy na folha ao tocar "Saiu" (proposto) ou só pelo botão que já existe?
4. O aviso respeita `aceita_avisos_pedido` do perfil (proposto) e, sem perfil, sai para o telefone do pedido?

## 9. Plano (PRs pequenos, depois da aprovação)
1. **Migration:** colunas, `order.out_for_delivery` no CHECK e no gatilho, `entregador_confirmar` aceitando o status novo; testes no PGlite.
2. **Contrato:** `evento.schema.json` e exemplo; mensagem à aorus-03 para o CRM tratar o evento e o modelo.
3. **Lógica pura + Cozinha:** coluna condicional, card, botões, folha do link; Chamada e Histórico; fila.
4. **Relatórios/Caixa/estoque:** revisar filtros por status e tempo de entrega.
Tudo em staging; produção só com ordem do João e do orquestrador.

## 10. Fora de escopo
Rastreamento em tempo real do motoboy, link de acompanhamento para o cliente, atribuir motoboy a pedido, cobrança de frete por distância.
