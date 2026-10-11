# Roteiro de teste: "Saiu para entrega"

Pré-requisito: migration `20261022120000_saiu_para_entrega` aplicada e o app atualizado em TODOS os aparelhos da loja (app antigo não mostra o pedido em "Saiu").

1. **Ajustes > Cardápio & Operação**: com o modo **Entrega** ligado, aparece "Saiu para entrega". Ligue o interruptor.
2. **Cozinha** ganha a coluna "Saiu para entrega" (aba "Saiu" no celular). Sem o interruptor, o kanban é o de sempre.
3. Lance um pedido de **Entrega**, marque **Pronto**. O botão principal vira **"Saiu para entrega"**.
4. Toque nele: o pedido vai para a coluna nova e abre a folha **"Enviar link ao entregador"** (WhatsApp sem número / copiar) com **Pular**.
5. No card em Saiu: "Saiu há N min", nome/telefone, **Avisar cliente** (WhatsApp manual), **Voltar para Pronto** e **Entregue**.
6. Pedido "A receber" (pagar depois): a etiqueta continua em Pronto e em Saiu; ao tocar **Entregue** pergunta a forma de pagamento.
7. **Link do motoboy**: abrir o link e confirmar a entrega leva o pedido a **Entregue**, mesmo estando em Saiu.
8. **Tela de Chamada**: o pedido que saiu deixa a lista de senhas chamadas.
9. **Retirada/Mesa/Balcão**: seguem A fazer → Pronto → Entregue, sem o botão "Saiu".
10. **Desligar o interruptor** com um pedido em Saiu: o pedido aparece em Pronto (nada some).
11. **Aviso ao cliente (CRM)**: com o CRM ligado e o CRM atualizado, tocar "Saiu" gera o evento `order.out_for_delivery` e o cliente recebe o modelo `pedido_saiu_entrega_v2` (no máximo uma vez por pedido).
