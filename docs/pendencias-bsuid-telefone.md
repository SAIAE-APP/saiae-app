# Pendência: cliente sem telefone (BSUID da Meta)

**Origem:** aviso do time do CRM (07/10/2026). A Meta está introduzindo o BSUID (identificador do usuário do WhatsApp), e o telefone do cliente pode vir **oculto** nas mensagens e eventos da API oficial.

**Impacto na Comanda (não implementado, só registrado):**
- `clientes_finais` hoje exige telefone: é único por `barraca_id` + `telefone` (`onConflict: 'barraca_id,telefone'`), e o telefone é normalizado por trigger. Cliente que chega pelo WhatsApp sem telefone visível não teria cadastro.
- O aviso "pedido pronto" (`pedidos.cliente_telefone`) e o contrato com o CRM (`customer.*`, `order.*` com `cliente.telefone`, ver `INTEGRACAO.md`) também assumem telefone.

**Decisões a tomar antes de implementar:**
1. Chave de identidade do cliente: telefone, BSUID ou as duas (com unicidade parcial).
2. Onde guardar o BSUID (`clientes_finais.bsuid`?) e como o CRM o envia no contrato (campo aditivo na v1).
3. O que fazer com cliente só com BSUID: o aviso de pedido pelo `wa.me` do operador precisa de telefone; pela Cloud API talvez dê para responder pelo BSUID.
4. Exportar/importar clientes e consentimento (LGPD) para quem não tem telefone.

Sem prazo definido; depende do que a Meta confirmar e do contrato com o CRM.
