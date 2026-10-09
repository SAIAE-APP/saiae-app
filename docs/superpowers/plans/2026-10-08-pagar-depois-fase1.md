# Pagar depois, Fase 1 (Retirada e Entrega) — plano curto

**Spec:** `docs/superpowers/specs/2026-10-08-pagar-depois-e-dividido-design.md` (Fase 1 aprovada; Fase 2, pagamento dividido, **não começa** antes de o João validar a Fase 1 em uso real).

**Regras de execução:** ambiente de TESTE; nada em produção nem merge sem o orquestrador e o João; migrations só aditivas e em PR separado; o app em produção (Sabor Kawashima, restaurante do Paulo) continua igual com o interruptor desligado e com versões antigas do app.

## Decisões de desenho (Fase 1)
- **Valor interno:** reaproveita `metodo_pagamento = 'na_entrega'` (sem mexer em constraint, eventos, entregador, relatórios). Rótulo na tela: "Pagar na retirada" (Retirada) e "Pagar na entrega" (Entrega); etiqueta de pendente: **"A receber"**.
- **Interruptor:** `barracas.pagamento_depois_habilitado boolean not null default false`. Desligado = comportamento de hoje, sem exceção. Toggle em Ajustes › Cardápio & Operação. Ligado primeiro só na loja do Paulo.
- **Só Retirada e Entrega.** Mesa e Balcão ficam de fora. Pix aqui **só registra a forma** (nenhum QR).
- **Correção depois de entregue:** nova RPC `corrigir_metodo_pagamento(p_pedido_id, p_metodo)`; só o **dono** da barraca (papel `dono`, checado no banco); só enquanto a NFC-e não foi emitida (`nfce_status` nulo, `erro` ou `erro_autorizacao`; autorizada, em processamento ou qualquer outro status trava); nunca em pedido cancelado; idempotente; registra quem e quando (colunas do pedido + tabela de histórico `pedidos_metodo_historico`). No app a ação mora no Histórico, que já fica atrás da **senha administrativa** (`GateSenhaAdmin`). A RPC não confere o PIN (o PIN é barreira de tela, como nas demais ações administrativas); a barreira de servidor é "só o dono".
- **Fila offline:** nova operação `definir_metodo` (payload `pedido_id`, `metodo`, `client_uuid`), idempotente por (pedido, método). Chama `definir_metodo_pagamento` (e `corrigir_metodo_pagamento` quando o método atual já é real). Banco sem a RPC nova (PGRST202) = operação **adiada**, sem travar a fila (padrão da v6). App antigo ignora a operação desconhecida.
- **Evento SAI-001:** o gatilho atual só dispara na saída de `na_entrega`; a correção real→real **não** emite evento nesta fase (registrado como pendência para a Fase 2/contrato).

## PRs (pequenos, nesta ordem)
1. **Docs** (este plano + a spec copiada).
2. **Migration** `20261019170000_pagamento_depois.sql`: coluna do interruptor, colunas `metodo_corrigido_em/por`, tabela de histórico, RPC `corrigir_metodo_pagamento`. Testes no PGlite com a migration real.
3. **Interruptor + "Pagar depois"**: tipos, toggle em Ajustes, opção em Confirmar Pedido (Retirada/Entrega), `humanizarMetodo` por modo, etiqueta "A receber" (Cozinha, Detalhe, Histórico), comanda impressa com "PAGAMENTO: A RECEBER", testes.
4. **Entregue com forma**: modal de forma ao tocar "Entregue" em pedido a receber (com "Receber depois"; valor recebido/troco informativo no dinheiro), fila `definir_metodo` offline e retrocompatível, testes.
5. **Corrigir no Histórico**: botão para corrigir a forma (dono, antes da nota), mensagens por estado, testes.
Cada PR é avisado ao orquestrador; todos dependem do PR 2 aplicado no banco de teste antes de qualquer teste manual.

## Fora desta fase
Pagamento dividido (`misto`, `pedido_pagamentos`, NFC-e com várias formas), Mesa/Balcão, QR de Pix na retirada, cancelamento de NFC-e já autorizada.

## Critérios de aceite (resumo)
Com o interruptor ligado: Retirada com "Pagar depois" imprime "A RECEBER", aparece como pendente, "Entregue" pede a forma, a NFC-e sai com a forma escolhida, corrigir antes da nota funciona e depois é bloqueado, sem rede a escolha sincroniza depois. Com o interruptor desligado nada muda.
