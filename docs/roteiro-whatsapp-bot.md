# Roteiro de teste: bot de pedidos pelo WhatsApp (fase 2)

Loja de teste: `jmal`, em **staging**. Plano: `docs/superpowers/plans/2026-10-24-whatsapp-bot-fase2.md`. Contrato: `docs/contrato/v1/integracao-v1-bot.md`.

## Pré-requisitos (feitos pelo João)

1. Function `integracao-v1` publicada no staging (feito em 2026-10-24) e migration `20261031100000_integracao_v1_bot.sql` aplicada (feito).
2. CRM staging (Railway, serviço `refreshing-education`) com as variáveis:
   - `SAIAE_INTEGRACAO_V1_URL` = `https://qzcqwovbbylqxljcrqhk.supabase.co/functions/v1/integracao-v1`
   - `COMANDA_WHATSAPP_SEGREDO` igual ao `WHATSAPP_CONEXAO_SEGREDO` do Sai aê (já existe desde a fase 1)
   - `ANTHROPIC_API_KEY` e `IA_MODELO` (ou `IA_MODELO_BOT`); opcional `BOT_FRANQUIA_CONVERSAS` (padrão 300 por mês)
3. Loja: `ia_habilitada = true` (já ligado na `jmal` com WhatsApp do dono fictício `5511900000000`; troque pelo número real do dono para testar `chamar_dono`), `pagar_na_entrega_habilitado = true`, sessão do WhatsApp conectada, **sem** agente do salão e **sem** regras de autoresposta (o bot fica calado nessas lojas).
4. Para o Pix: token do Mercado Pago de teste cadastrado na `jmal` (Ajustes > Conta > Pagamento online) e `pagamento_online_habilitado = true`. Sem isso o bot oferece só "pagar na retirada".
5. Opcional: secret `URL_APP_PUBLICA` na function para o link do cardápio apontar para o app de staging (sem ele o link usa `https://app.saiae.com.br`).

## Passos (de outro celular para o número conectado da loja)

1. "oi". Esperado: saudação curta com o link do cardápio, sem modelo.
2. "quero 2 yakisoba". Esperado: resumo com itens, total e forma de pagamento, valores iguais aos do cardápio.
3. "sim". Esperado: pedido criado (senha na resposta), aviso "recebido" do fase 1 chega em seguida.
4. Mandar "sim" de novo. Esperado: nenhum pedido novo.
5. "quero 1 pizza" (item que não existe). Esperado: "não achei" e link do cardápio.
6. Pedir algo e responder "talvez" ao resumo. Esperado: nenhum pedido.
7. Pedir para falar com o dono. Esperado: dono recebe aviso curto no WhatsApp, a conversa pausa 12 h e o cliente recebe o link.
8. Pedido com Pix (loja com token de teste). Esperado: "copia e cola" no chat, sem pagar.
9. "SAIR". Esperado: opt-out confirmado pelo CRM e o bot não responde mais.
10. Loja com `ia_habilitada = false`. Esperado: bot calado; só os avisos da fase 1.
11. Pedir entrega por mensagem. Esperado: link do cardápio ou `chamar_dono` (por mensagem só Retirada).

## Limites conhecidos

- Pausa de 12 h, resumo pendente e deduplicação ficam em memória do CRM e se perdem se ele reiniciar.
- Mensagem sem texto (áudio, mídia) é ignorada.
- Teto global diário de respostas (`IA_MAX_RESPOSTAS_DIA`) não vale para o bot; vale a franquia mensal por loja.
- Baileys é conexão não oficial: risco de bloqueio do número permanece.
