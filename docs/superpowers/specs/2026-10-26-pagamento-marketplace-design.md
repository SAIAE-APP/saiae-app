# Pagamento online no cardápio digital: Mercado Pago marketplace, Pix e cartão, taxa Sai aê

Documento de design. Nada aqui está implementado. Origem: conversa com o dono do produto em 2026-10-26.
Este é o projeto 1 de 3 (ver "Fora deste projeto").

## Intenção e por quê

O cardápio digital hoje só recebe Pix online (Mercado Pago, com o token colado pelo dono da barraca) ou "pagar na entrega". O dono quer o cardápio com cara de grande operação de food service, como o iFood: pagar com cartão sem sair do cardápio e uma taxa de serviço do Sai aê cobrada do cliente em cada pedido pago online.

Para cobrar essa taxa, o Sai aê precisa fazer parte da cobrança. Isso só é possível no modelo de split do provedor: o cliente paga, o provedor separa a comissão do Sai aê e o resto vai direto para a conta da barraca. O Sai aê nunca recebe o dinheiro das barracas em conta própria (regra já presente em `supabase/functions/_shared/pagamento/tipos.ts`).

O dono do produto pensou em trocar de provedor porque achava que o Mercado Pago não faria isso. Pesquisa feita nesta conversa: o Mercado Pago em modo marketplace faz Pix e cartão com split (comissão no parâmetro `application_fee`, e `marketplace_fee` no Checkout Pro), com cada vendedor conectado por OAuth. Por isso o provedor continua sendo o Mercado Pago. Asaas, Pagar.me e Stripe Connect foram avaliados e descartados: Pix fixo de R$ 1,99 no Asaas pesa em pedido pequeno, Pagar.me exige contrato PSP, e o Stripe tem restrições para plataforma estrangeira e taxas de Pix inconsistentes. Os números de taxa vieram de fontes de qualidade variada e não foram confirmados nos sites oficiais.

## Decisões do dono (valem como ditas)

1. Provedor: Mercado Pago, em modo marketplace/split.
2. Meios: Pix e cartão de crédito.
3. Taxa do Sai aê: R$ 0,99 por pedido pago online, cobrada do cliente, em Pix e em cartão.
4. O restante do pagamento vai para a conta Mercado Pago da barraca. O dono da barraca paga as taxas do Mercado Pago (banco/operadora).
5. Cartão: o cliente digita os dados dentro do cardápio, na tela do Sai aê, com só o campo do cartão fornecido pelo Mercado Pago. Não há redirecionamento para página do Mercado Pago.
6. Só cartão à vista (1x). Sem parcelamento.
7. Toda barraca precisa conectar a conta Mercado Pago por OAuth para receber pagamento online (Pix ou cartão). O token colado deixa de valer.
8. Estorno: os R$ 0,99 são devolvidos ao cliente junto com o valor do pedido. Contestação de cartão (chargeback) é responsabilidade da barraca, porque o dinheiro cai na conta dela. Este último ponto é palpite do dono do produto a confirmar nas regras do Mercado Pago.

## Metas

- Cartão e Pix online no cardápio com a mesma experiência (checkout dentro da tela do Sai aê).
- Split correto em todo pagamento: R$ 0,99 para o Sai aê, o resto para a barraca.
- Nenhum pedido novo nasce sem pagamento aprovado e confirmado no servidor (regra atual, não muda).
- Barraca entende o que precisa fazer para conectar e quando o dinheiro cai.

## Não metas

- Parcelamento.
- Outros provedores (Asaas, PagBank, Woovi, AbacatePay ficam como estão no CHECK do banco, sem código novo).
- Débito, boleto, carteiras digitais.
- Cashback, promoções e redesenho do cardápio (projetos 2 e 3).
- Mudar o fluxo de "pagar na entrega".

## Antimetas (falha mesmo que "funcione")

- Pedido criado sem pagamento confirmado, ou pago a menos do que o servidor calculou.
- Dados de cartão passando pelo servidor do Sai aê ou sendo gravados em qualquer lugar. Só o token de cartão do Mercado Pago pode trafegar.
- Barraca perder pedido ou recebimento de um dia para o outro por causa da troca do token pelo OAuth, sem aviso.
- Os R$ 0,99 entrarem como faturamento, imposto ou nota fiscal da barraca.
- Cobrar o cliente duas vezes por retry ou notificação repetida.

## Estado atual relevante (do repositório SAIAE-APP/saiae-app, commit 9fe6760, 2026-10-24)

- `supabase/functions/_shared/pagamento/`: interface `ProvedorPix` (`tipos.ts`), adaptador `mercadopago.ts` usando `POST /v1/payments` com `payment_method_id: 'pix'`, `registro.ts`, `token.ts`, `conciliacao.ts`, `corrida.ts`, `expiracao.ts` e testes (`pagamento.test.ts`).
- `criar-pagamento-pix` (594 linhas): resolve preço e taxa de entrega no servidor, aplica cupom (reserva), grava o pendente e cria a cobrança com o token da barraca.
- `webhook-mercadopago` (364 linhas): único endpoint de notificação para todos os provedores. Consulta o pagamento de volta com o token da barraca, confere referência e valor (itens − desconto de cupom + taxa de entrega) e só então chama `criar_pedido` (idempotente por `client_uuid`).
- Token: tabela `barracas_pagamento_token` (PK barraca_id + provedor, sem policy de select), RPCs `definir_token_pagamento` e `token_pagamento_configurado`.
- Flags e colunas: `barracas.pagamento_online_habilitado`, `barracas.pagamento_provedor`, `pagamentos_pendentes.provedor`, `pagamentos_pendentes.mercadopago_order_id` (id externo, nome histórico).
- Ajustes: `SecaoPagamentoOnline` em `src/pages/Ajustes.tsx`; lista de provedores em `src/lib/provedoresPix.ts`.
- Cupons: desconto só sobre itens, cupom de 100% gera pedido grátis, uso confirmado só com pagamento aprovado.
- O cardápio é `src/pages/CardapioPublico.tsx` (2130 linhas).
- Regras do `CLAUDE.md` do repositório sobre dinheiro (centavos inteiros, valor sempre calculado no servidor) continuam valendo e devem ser lidas antes de implementar.

## Comportamento desejado

### Conexão da barraca (OAuth)

- Em Ajustes, a barraca vê "Conectar Mercado Pago" no lugar do campo de token. O fluxo é OAuth do Mercado Pago; o Sai aê guarda o token de acesso e o de renovação da barraca, cifrados, do mesmo modo que guarda o token hoje (sem policy de leitura no front).
- O token de acesso do OAuth expira e precisa ser renovado. A renovação é parte do escopo: falha de renovação marca a barraca como "desconectada" e o cardápio cai para "pagar na entrega" com aviso ao dono.
- O dono pode desconectar e reconectar.
- `pagamento_online_habilitado` só pode ficar ligado com conexão OAuth ativa.

### Migração das barracas atuais

- Decisão do dono: todas precisam conectar por OAuth. Sem conexão, o cardápio da barraca oferece só "pagar na entrega".
- Escolha do documento (a confirmar com o dono ao ler): antes do corte, as barracas com token antigo ficam um período de aviso (banner em Ajustes e no painel, e aviso do suporte), e o corte é por data. O tamanho do período fica para o dono definir; sugestão: 14 dias.
- Pix já emitido com o token antigo e ainda não pago deve continuar sendo confirmado pelo webhook até expirar, usando o token antigo daquele pendente. Cobranças novas só com OAuth depois do corte.

### Checkout do cliente

- O resumo mostra uma linha separada, "Taxa de serviço Sai aê: R$ 0,99", somada ao total, em Pix e cartão. Em "pagar na entrega" não há essa taxa.
- Cartão: o cardápio carrega o campo seguro de cartão do Mercado Pago (Bricks ou equivalente; o implementador confirma na documentação oficial qual componente e qual chave pública usar no modo marketplace). O navegador obtém um token do cartão direto com o Mercado Pago. O Sai aê só recebe esse token.
- Cartão à vista: parcelas fixas em 1, sem seletor.
- Aprovação, recusa e pagamento em análise têm mensagem clara e o cliente pode tentar de novo ou trocar para Pix.
- Cupom continua igual: desconto só sobre os itens, a taxa de entrega e a taxa de serviço nunca são descontadas.

### Servidor

- Nova chamada de cobrança por cartão no adaptador do Mercado Pago, com `application_fee` = 99 centavos (ver nota sobre unidade: a API recebe decimal, então 0.99) e o token OAuth da barraca. O Pix passa a usar o token OAuth e também `application_fee`.
- O valor total cobrado = itens − desconto de cupom + taxa de entrega + 0,99. O servidor recalcula; o cliente envia `total_esperado_centavos` e recebe 409 com o novo total se divergir (mecanismo existente).
- O webhook confere o valor pago contra o mesmo total e confere também que a comissão registrada no pagamento é de R$ 0,99. Divergência não cria pedido e gera alerta.
- A interface `ProvedorPix` hoje só trata Pix. Ela deve ser estendida ou generalizada para cartão sem quebrar o Pix; como (renomear, nova interface irmã) fica a cargo de quem implementa.
- Pedido grátis por cupom de 100% não passa por pagamento online e não leva a taxa de R$ 0,99. Este é um chute do documento, a confirmar.

### Dados

- O pedido e o pendente guardam `taxa_plataforma_centavos` (0 em "pagar na entrega"), à parte dos itens e da taxa de entrega, como o desconto de cupom já é guardado.
- A taxa Sai aê não entra em faturamento da barraca, em NFC-e nem na taxa de serviço da própria barraca (`nfce_taxa_servico_centavos`). O nome na interface e no banco deve evitar confusão com essa taxa.
- Estorno devolve itens, taxa de entrega e os R$ 0,99. O adaptador precisa de operação de estorno; não existe hoje.

### Liberação do dinheiro

- Pix cai na conta da barraca assim que aprovado; cartão cai depois da liquidação (em fontes de terceiros, cerca de D+30; não confirmado oficialmente). Ajustes e a tela de conexão devem explicar isso ao dono em linguagem simples.

## Restrições

- Valores em centavos inteiros no código e no banco; a API do Mercado Pago recebe decimal, converter só na borda (como `centavosParaDecimal` já faz).
- Toda regra de preço, desconto e taxa roda no servidor.
- Segredos cifrados, nunca no front, nunca em log.
- Migrações aditivas; `criar_pedido`, políticas de RLS atuais e o fluxo offline não são quebrados.
- Segurança do webhook: o corpo da notificação nunca é confiável; sempre consultar de volta (regra atual).

## Viabilidade checada na documentação oficial do Mercado Pago (2026-10-26)

Fonte: documentação "Integrar o checkout em Split de Pagamentos" do Mercado Pago (https://www.mercadopago.com.br/developers/pt/docs/split-payments/split-1-1/integration-configuration/integrate-marketplace).

- Confirmado: no Checkout Transparente a comissão vai no parâmetro `application_fee` do `POST /v1/payments`, com o access token OAuth do vendedor no cabeçalho `Authorization`.
- Confirmado: a tokenização do cartão no front usa a `public_key` da conta do integrador (do Sai aê), não a do vendedor.
- Não confirmado: a página só exemplifica cartão. Que o Pix aceita `application_fee` em `/v1/payments` precisa ser provado em teste no sandbox antes de planejar o Pix. Se falhar, o Pix precisa de outro desenho.
- Não coberto pela página: habilitação do split na aplicação, homologação, redirect URI e escopos do OAuth. Ver seções de pré-requisitos e OAuth do Mercado Pago.
- Estorno: o valor estornado é dividido proporcionalmente e debitado das contas da barraca e do marketplace. No modelo 1:1, o marketplace não consegue estorno total se a barraca não tiver saldo: devolve a sua parte e o resto é resolvido entre barraca e cliente por outros meios.

## Chamadas do documento (decididas sem o dono; ele pode mudar)

- Quais pedidos levam a taxa: todo pedido que passa por `criar-pagamento-pix` (hoje inclui entrega, retirada e mesa; "Pix com Entrega = em breve" no `CLAUDE.md` está desatualizado, o código já trata entrega).
- A taxa é uma constante no servidor (R$ 0,99), copiada para o pendente e para o pedido no momento da cobrança. O webhook confere contra o valor gravado no pendente, não contra a constante, para mudanças futuras não quebrarem cobranças em aberto. Não é configurável por barraca.
- Estorno na primeira versão: só total, disparado pelo dono ao cancelar um pedido pago online. Se o Mercado Pago recusar por saldo insuficiente da barraca, o app mostra o erro e o caso vai para o suporte. Sem estorno parcial.
- Pontos de código que leem o token e precisam trocar para OAuth: `criar-pagamento-pix`, `webhook-mercadopago`, `supabase/functions/_shared/salvarCredencial.ts` (grava o token), o onboarding (`20261020100000_onboarding_config.sql`) e Ajustes. `integracao-v1` não lê o token (verificado por busca).

## Pendências do dono (a confirmar ao ler)

- Existe uma aplicação do Sai aê no Mercado Pago (client_id, client_secret, redirect URI) com split habilitado? Se não, criá-la e obter essa habilitação é o caminho crítico e bloqueia testes de ponta a ponta. O repositório não tem código OAuth nenhum.
- Quantas barracas usam Pix hoje, e se o corte do token antigo é automático por data ou manual.

- Prazo do período de aviso antes do corte do token antigo (sugestão: 14 dias).
- Pedido grátis por cupom: sem taxa de R$ 0,99 (chute deste documento).
- Responsabilidade por chargeback na barraca (palpite do dono; confirmar nas regras do Mercado Pago).

## O que fica para quem implementa

- Qual componente de cartão do Mercado Pago usar e com qual credencial no modo marketplace (confirmar na documentação oficial).
- Desenho exato da renovação do token OAuth e do estado "desconectada".
- Como estender a interface de provedor para cartão.
- Testes: puros para cálculo de total e comissão; teste do webhook para valor e comissão divergentes; teste de idempotência para notificação repetida e estorno.
- Verificar nos sites oficiais as taxas e o prazo de liberação do cartão antes de mostrá-los ao dono da barraca.

## Resultado do spike (2026-10-26)

Feito com a aplicação "Sai ae Marketplace" criada na conta de teste do marketplace, uma vendedora de teste e uma compradora de teste, por um script local (`scripts/`, sem segredos no repositório).

### Provado
- OAuth completo: a autorização da vendedora de teste e a troca do `code` por token funcionam, e a resposta de `/oauth/token` traz a `public_key` do vendedor. O redirect cadastrado exige correspondência exata (barra final incluída).
- Pix criado com o token OAuth da vendedora e `application_fee` de R$ 0,99: o Mercado Pago aceitou (pagamento pendente), sem o erro 2034 que aparecia quando a aplicação havia sido criada na conta errada.
- A tokenização do cartão só funciona com a chave pública do VENDEDOR (a da aplicação do Sai aê dá erro 2006 "Card Token not found"). Por isso a spec original, que falava da chave do integrador, foi corrigida na implementação: a chave vem do backend.

### Não provado
- Pagamento de cartão com token OAuth: `POST /v1/payments` devolveu HTTP 500 (`internal_error`) no sandbox, com e sem `application_fee`, com o cartão de teste oficial (APRO e OTHE). Hipótese: limite do sandbox para cartão com token OAuth de teste. A implementação segue o contrato documentado.
- O campo da comissão no pagamento: não aparece no pagamento Pix pendente nem no 500 do cartão. O código lê `fee_details[type = 'application_fee']` e trata a ausência como comissão desconhecida (conciliação manual).
- Estorno total com devolução da taxa: só é possível depois de aprovado (HTTP 400 em pendente); não foi exercitado com pagamento aprovado.
- Idempotência da chave de estorno do Mercado Pago e divisão do estorno dos R$ 0,99.

### Risco registrado
- O painel do Mercado Pago avisa que a API de Payments será descontinuada em breve. A API de Orders, a alternativa, hoje recusa `notification_url` por pagamento. Acompanhar o cronograma e planejar a migração do adaptador `mercadopago.ts`.

### Decisões em aberto do dono
- Data do corte do token colado e período de aviso (sugestão: 14 dias de aviso).
- Pedido de total zero por cupom: foi implementado SEM taxa; confirmar.
- Responsabilidade por chargeback na barraca: confirmar nas regras do Mercado Pago.
- Escopo PCI: hoje o número do cartão passa pelo JavaScript da página (SAQ A-EP). Com MP Secure Fields (iframes) seria SAQ A, como esta spec descrevia. Também não enviamos `device_id`, o que pode aumentar recusas do antifraude. Decidir se avalia Secure Fields depois do lançamento.
- Texto sobre o prazo de liberação do cartão: aguardando confirmação com o Mercado Pago antes de mostrar ao dono.
- Quantas barracas usam Pix hoje (define o tamanho do aviso e do corte).

### Pendências de entrega (Task 11 do plano)
- Passo 1 (verificação ponta a ponta no staging): NÃO feito, depende de um ambiente de staging com a migration e as functions publicadas e de contas de teste conectadas.
- Passo 3 (definir com o dono a data do corte e o aviso): NÃO feito, depende do dono.

## Fora deste projeto

- Projeto 2: visual do cardápio (categorias, promoções por item, personalização do item), no estilo iFood.
- Projeto 3: cashback do perfil do cliente. Cashback vira saldo devido ao cliente; quem banca (Sai aê ou barraca) precisa ser decidido antes de qualquer código.
