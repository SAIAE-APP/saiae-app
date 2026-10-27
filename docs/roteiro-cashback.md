# Roteiro de teste: Cashback do cardápio digital

Spec: `docs/superpowers/specs/2026-10-27-cashback-design.md`. Regras no `CLAUDE.md` ("Cashback do cardápio digital"). Só no STAGING (`qzcqwovbbylqxljcrqhk`), com token de TESTE do Mercado Pago na barraca de seed e dados fictícios. Nada em produção.

## Pré-requisitos
- Migrations `20261106100000` a `20261106170000` aplicadas no staging, nesta ordem; functions `criar-pagamento-pix`, `webhook-mercadopago`, `estornar-pagamento`, `cliente-sessao` e `emitir-nfce` publicadas SÓ no staging (`npm run staging:deploy`, conferindo o link da CLI antes).
- Barraca de seed com pagamento online (OAuth de teste), perfil do cliente ligado e cashback ligado em Ajustes > Cardápio > Cashback (aceitar o aviso do contador).
- Um cliente de teste com telefone confirmado (código por WhatsApp) na loja.

## Cenários
1. **Ligar**: Ajustes > Cardápio > Cashback. Ligar exige abrir o aviso e marcar "Entendi". Percentual 16% mostra erro; 15% salva. Sem perfil do cliente ligado a seção explica o motivo. Desligar mantém os valores e avisa que os saldos já dados continuam valendo até vencer.
2. **Ganhar (Pix)**: pedido de R$ 40,00 com cliente identificado. O carrinho mostra "Você ganha R$ 2,00". Pague o Pix de teste; a tela de confirmação mostra "Você ganhou R$ 2,00. Vale até DD/MM." (pode levar alguns segundos: o app relê o status uma vez).
3. **Ganhar (cartão)**: mesmo pedido com cartão de teste; o aviso vem na resposta síncrona.
4. **Usar**: novo pedido de R$ 40,00. O checkout oferece "Usar meu saldo" desmarcado. Marque: o total cai pelo saldo (nunca abate entrega nem a taxa Sai aê, nunca zera os itens: piso de R$ 1,00). Após pagar, o saldo diminui e o pedido mostra "Cashback usado" no Histórico.
5. **Cupom × saldo**: com cupom aplicado o bloco explica "Cupom e saldo não somam" e o saldo desmarca. O servidor recusa os dois juntos (422).
6. **Pagar na entrega**: trocar para "pagar na entrega" some o desconto e o corpo não leva `usar_cashback`.
7. **Estorno**: estorne um pedido que gerou e usou saldo. O razão ganha `estorno_credito` (limitado ao saldo atual) e `estorno_resgate`; repetir não duplica. Estorno com o saldo já gasto reverte só o que resta.
8. **Vencimento**: no staging, force `expira_em` no passado do último crédito do cliente (SQL). O saldo some do app, não ressuscita ao ganhar um crédito novo e aparece como "vencido" no relatório.
9. **Desligar com saldo**: desligue em Ajustes. O cliente ainda usa o saldo; novos pedidos não geram crédito.
10. **Apagar meus dados**: a confirmação avisa o valor que será perdido; depois o saldo é 0 e o razão fica sem `cliente_id`.
11. **Relatório**: seção Cashback com Concedido, Usado, Vencido, Estornado e Saldo em aberto.
12. **NFC-e com desconto**: emitir em HOMOLOGAÇÃO uma nota de pedido que usou saldo; conferir `valor_desconto` por item e o total da nota (itens − saldo, sem taxas).
13. **Reenvio do webhook**: reenviar a notificação de um pagamento aprovado; nada duplica (um crédito, um resgate).

## SUPOSIÇÕES a aprovar pelo João
- **SUPOSIÇÃO-CASHBACK-1**: a barraca financia o cashback (o Sai aê não paga nada e a taxa de R$ 0,99 não muda).
- **SUPOSIÇÃO-CASHBACK-2**: desligado por padrão; se o dono desligar, saldos já concedidos continuam valendo até vencer.
- **SUPOSIÇÃO-CASHBACK-3**: 5% e 60 dias por padrão (faixas 1–15% e 30–90 dias).
- **SUPOSIÇÃO-CASHBACK-4**: um benefício por pedido (cupom OU saldo) e piso de R$ 1,00 em dinheiro nos itens.
- **SUPOSIÇÃO-CASHBACK-5**: sem módulo pago na V1.
- **SUPOSIÇÃO-CASHBACK-6**: pedido de total zero por cupom continua sem taxa; o cashback nunca zera o pedido.

## Pendências antes de qualquer produção
Ver a seção "Pendências" do relatório (`docs/superpowers/plans/2026-10-27-cashback-relatorio.md`): menor valor aceito pelo Mercado Pago com comissão de R$ 0,99 e piso de R$ 1,00; primeira NFC-e com desconto; parecer do contador e sobre CDC; risco de chargeback sem tratamento automático; reconciliação das versões de migration no staging; migração futura da API de Payments do Mercado Pago.
