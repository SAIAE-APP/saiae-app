# Roteiro de teste: campanhas e avaliação pelo WhatsApp (fase 3)

Loja de teste: `jmal`, em **staging**. Plano: `docs/superpowers/plans/2026-10-24-whatsapp-disparos-fase3.md`. Contrato: `docs/contrato/v1/whatsapp-disparos.md`.

## Pré-requisitos

1. Staging com as migrations `20261101100000` e `20261101110000` e as functions `whatsapp-disparos` e `integracao-v1` publicadas (feito pela trilha do app).
2. CRM de staging com a branch das campanhas publicada e o WhatsApp da `jmal` conectado (Ajustes > Avisos). Opcional: secret `CRM_WHATSAPP_DISPAROS_URL` no Sai aê; sem ele a URL é derivada de `CRM_WHATSAPP_CONEXAO_URL`.
3. Liberar os módulos na `jmal`: ative `whatsapp_avisos` e depois `whatsapp_disparos` pelo painel de admin (Admin > loja > Módulos pagos, informando a versão do termo; ver `docs/roteiro-modulos.md`), ou pelas funções `admin_modulo_definir` no SQL do staging como superadmin. O update direto em `barracas.whatsapp_disparos_habilitado` não funciona mais: o trigger recusa com `disparos_use_a_tela`. Disparos exige avisos ativo.
4. Ter 2 ou 3 clientes de teste em Ajustes > Cardápio & Operação > Clientes de entrega, com o seu número e o de outro celular, marcados como "aceita contato comercial" (importar com o 2º checkbox, ou cadastrar por um pedido de entrega do cardápio com o consentimento marcado). Para "reativar", o cliente precisa estar sem pedido há mais dias do que o seletor (ajuste `criado_em` por SQL no staging se for preciso).
5. O app aberto com a loja já com os módulos ativos (passo 3); não há mais variável de ambiente para mostrar a seção.

## Passos

1. **Seção visível.** Ajustes > Avisos mostra "Campanhas e avaliação" logo abaixo do WhatsApp. Suspenda o módulo `whatsapp_disparos` pelo painel de admin e confira que a seção some (suspender `whatsapp_avisos` também a derruba).
2. **Avaliação.** Ligue "Avaliação após a entrega", deixe o texto em branco e salve. A prévia mostra o texto padrão. Salve um texto de 501 caracteres: o campo não deixa passar de 500.
3. **Avaliação ponta a ponta.** Faça um pedido com telefone seu, leve até Entregue. Esperado: cerca de 30 minutos depois chega o pedido de nota (dentro do horário 9h às 20h). Responda "5": agradecimento, nota no histórico do app e aviso ao WhatsApp do dono. Responda "2" em outro pedido: aviso ao dono com "ATENÇÃO:".
4. **Avaliação não ambígua.** Com um pedido aguardando nota, mande "Quero 2 pizzas": não vira nota. Mande "10" e "0": não viram nota. Responda "5" duas vezes: só a primeira vale.
5. **Reativação.** Em Campanhas, escolha "Reativar quem sumiu", 30 dias. A prévia diz "Vai para N clientes que aceitaram receber ofertas". Toque num texto sugerido, confira a prévia (sem "Olá !") e o contador. Toque em Enviar: o diálogo repete N, avisa do limite de uma mensagem por dia e do rodapé SAIR. Confirme. Esperado: a campanha aparece em "Últimas campanhas" como Em andamento e as mensagens chegam aos poucos.
6. **Promoção.** Depois de a anterior terminar, repita com "Promoção do dia". Quem já recebeu hoje não recebe de novo (teto de 1 mensagem de campanha por dia por cliente).
7. **SAIR.** Responda "SAIR" a uma campanha. Crie outra campanha no dia seguinte (ou por SQL ajuste os envios): esse cliente não recebe mais e a prévia continua contando por consentimento do app.
8. **Tetos.** Tente criar uma segunda campanha com a primeira em andamento: o app avisa e o botão fica desabilitado. Crie 3 campanhas em 24 h: a terceira volta "Limite de 2 campanhas por dia".
9. **Cancelar.** Com uma campanha em andamento, toque em Cancelar e confirme. Esperado: estado Cancelada e as mensagens pendentes não saem.
10. **WhatsApp desconectado.** Desconecte o WhatsApp da loja: o botão Enviar fica desabilitado com o aviso para conectar.
11. **Funcionário.** Entre com um usuário que não é dono: vê a prévia e o histórico, mas Enviar e Cancelar são recusados (403).

## Limites conhecidos

- A avaliação e os disparos só saem entre 9h e 20h (America/Sao_Paulo); fora disso o item espera.
- Campanha não enviada em 24 h expira.
- Baileys é conexão não oficial: risco de bloqueio do número permanece, mesmo com tetos e pausas.
- Sem registro de reclamação no Sai aê: a avaliação só deixa de ir quando o pedido tem aviso de cancelamento.
- O botão Enviar usa o status da conexão consultado a cada 15 s; a seção faz uma segunda consulta própria (as duas leem a mesma function).
