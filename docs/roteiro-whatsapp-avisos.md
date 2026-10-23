# Roteiro de teste: avisos de WhatsApp (fase 1)

Loja de teste: `qa-teste-varredura`, em **staging**. Pré-requisito: a ordem de deploy abaixo cumprida e o CRM do Gael com a rota de conexão no ar.

## Ordem de deploy

1. CRM do Gael: rota `whatsapp-conexao`, mapeamento sessão ↔ loja, tabelas de log e o segredo `COMANDA_WHATSAPP_SEGREDO` (itens 1 a 13 de `PENDENCIAS-CRM-GAEL.md`).
2. Migrations `20261030100000_whatsapp_avisos` e `20261030110000_whatsapp_status`.
3. Secrets do Sai aê: `WHATSAPP_CONEXAO_SEGREDO` (igual ao `COMANDA_WHATSAPP_SEGREDO`, mínimo 16 caracteres) e `CRM_WHATSAPP_CONEXAO_URL` (https público).
4. Deploy das functions `whatsapp-conexao` e `crm-evento-sessao` (esta com `--no-verify-jwt`).
5. App. A seção continua escondida até o João liberar lojas (`SLUGS_COM_IA_E_CRM` ou `VITE_MOSTRAR_WHATSAPP_AUTOMACAO=1`).

## Passos

1. **Ajustes > Cardápio & Operação > Avisos**: aparece "WhatsApp e Automação" com o botão "Conectar WhatsApp". Esperado: QR Code em até alguns segundos, com os 3 passos.
2. Escanear o QR no celular da loja. Esperado: a tela passa a "Conectado" com o número mascarado, `(DD) 9••••-NNNN`.
3. Percorrer um pedido de Entrega: recebido, `a_fazer → pronto → saiu_entrega → entregue`. Esperado: o cliente recebe **um aviso de cada, uma vez só**.
4. Cancelar outro pedido. Esperado: um aviso de cancelado.
5. Pedido sem telefone. Esperado: nada é enviado; o histórico mostra "Sem telefone".
6. Editar o texto de um aviso e salvar. Esperado: o próximo aviso daquele tipo sai com o novo texto.
7. Desligar um aviso. Esperado: o status correspondente não envia nada.
8. Reiniciar o CRM no meio de um pedido. Esperado: nenhum aviso repetido.
9. Derrubar a conexão (desconectar o aparelho no WhatsApp). Esperado: a faixa "O WhatsApp da loja desconectou" aparece no app e o aviso seguinte fica `pulado_desconectado`.
10. O cliente responde "SAIR" e o próximo pedido dele é lançado. Esperado: o aviso não é enviado.
11. Entrar com a segunda loja de teste. Esperado: ela não enxerga o QR, o número nem o histórico da primeira.
12. Pedido de balcão que nasce `entregue`. Esperado: não envia o aviso "entregue".
13. Usuário que não é dono (operador/suporte) abre a aba. Esperado: vê estado e histórico, mas "Conectar" e "Desconectar" são recusados.
