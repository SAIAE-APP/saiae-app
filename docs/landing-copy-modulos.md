# Copy da landing page: planos e módulos extras

Documento para o João colar como prompt em outro agente, o que edita a landing page (repositório à parte). Este repositório (o app) não muda por causa dele; o arquivo `src/lib/planos.ts` do app só deve ser atualizado depois, se o João aprovar a nova copy, porque ele é cópia da landing.

## Avisos antes de usar

- Os preços dos módulos de avisos, disparos e nota fiscal estão decididos. O preço do **atendente por WhatsApp (R$ 69,90)** e o das **franquias excedentes** ainda estão **em validação**: o custo real de uma conversa do bot ainda não foi medido (regra: margem de pelo menos 2x o custo). Só publique o bot depois que o João confirmar o preço.
- Os valores de excedente das franquias ainda não foram decididos e **não devem ser publicados agora**. Eles não aparecem na copy proposta.
- Não citar o nome do prestador fiscal em nenhum texto público.
- Não prometer "Google Avaliações": a avaliação de hoje é a nota pedida por WhatsApp depois da entrega, não é integração com o Google.
- Não afirmar que o WhatsApp é a "API oficial": o Sai aê usa a conexão do próprio WhatsApp da loja, ligada por QR Code. Não prometer isenção de bloqueio; as mensagens seguem limites de segurança (por exemplo, no máximo uma mensagem de campanha por dia por cliente).
- Os planos Essencial (R$ 57,90/mês) e Pro (R$ 87,90/mês) **não mudam de preço**.

## Contexto (parágrafo para o agente)

O Sai aê é um sistema de comanda digital para barracas e food service. Hoje a landing vende dois planos, Essencial e Pro. Passamos a vender recursos extras como **módulos contratados à parte**, ativados loja a loja pelo time do Sai aê: WhatsApp (avisos de pedido e avaliação, disparos de promoções e atendente de pedidos) e Nota fiscal (NFC-e). Nenhum desses módulos está incluído no Essencial nem no Pro. A landing precisa deixar isso claro sem mexer no preço nem nas funcionalidades próprias de cada plano.

## Copy atual versus proposta por plano

Fonte da copy atual: `src/lib/planos.ts` do app (cópia da landing; na landing a fonte é `MA_PLANS` em `plans.js`).

### Essencial (R$ 57,90/mês; anual R$ 49,22/mês, 15% OFF)

| Campo | Atual | Proposto |
|---|---|---|
| Descrição | Para quem tem uma barraca e quer largar o papel. | Sem mudança. |
| Itens | 1 barraca; Lançar pedido (mesa, balcão e viagem); Cozinha em tempo real com cronômetro; Chamada de senha com seu logo; Pix, dinheiro, débito e crédito; Relatório do dia; Histórico de 7 dias; Tema claro e escuro | Mesmos oito itens, na mesma ordem, e um nono item de rodapé em tom discreto: "WhatsApp e nota fiscal são módulos extras, contratados à parte." |
| CTA | Começar com o Essencial | Sem mudança. |

### Pro (R$ 87,90/mês; anual R$ 70,32/mês, 20% OFF; selo "MAIS COMPLETO")

| Campo | Atual | Proposto |
|---|---|---|
| Descrição | Para quem quer controle total ou tem mais de um ponto. | Sem mudança. |
| Itens | Tudo do Essencial; Várias barracas na mesma conta; Histórico completo e por período; Exportar relatórios; Custo do dia, lucro e taxas da maquininha; Mais vendidos, ritmo e pontos de atenção; Senha de operador e senha administrativa; Suporte prioritário no WhatsApp | Mesmos oito itens, na mesma ordem, e o mesmo item de rodapé: "WhatsApp e nota fiscal são módulos extras, contratados à parte. Não estão incluídos nem no Pro." |
| CTA | Quero o Pro | Sem mudança. |

Observação para o agente: o item "Suporte prioritário no WhatsApp" do Pro é o atendimento ao cliente do Sai aê, e não tem relação com o módulo de WhatsApp da loja. Se a ambiguidade incomodar na página, sugerir ao João trocar para "Suporte prioritário" e perguntar antes de alterar.

## Nova seção: "Módulos extras"

Posição sugerida: logo abaixo dos cards dos planos e antes das perguntas frequentes. Título sugerido: "Módulos extras". Subtítulo sugerido: "Quer mais? Acrescente só o que você precisa, à parte do seu plano."

| Módulo | Benefício em uma linha | Preço por mês | Franquia | Observação |
|---|---|---|---|---|
| Avisos de pedido e avaliação | Seu cliente recebe no WhatsApp o aviso de cada etapa do pedido e pode avaliar a entrega. | R$ 39,90 | Sem limite, dentro dos limites de segurança de envio | |
| Disparos de promoções | Mande promoções e ofertas para quem já comprou e aceitou receber. | R$ 39,90 | 500 mensagens por mês | Exige o módulo Avisos. |
| Atendente de pedidos por WhatsApp | Um atendente que responde e anota pedidos pelo WhatsApp da sua loja. | R$ 69,90 | 300 conversas por mês | **Preço em validação, não publicar sem OK do João.** |
| Nota fiscal (NFC-e) | Emita a nota fiscal do consumidor direto do pedido. | R$ 69,90 | 300 notas por mês | Mais ativação única de R$ 99 (cadastro da empresa, certificado e termo). |
| Pacote WhatsApp completo | Avisos, disparos e atendente juntos, com desconto sobre a soma. | R$ 139,90 | As de cada módulo | Soma dos três separados: R$ 149,70. Depende do preço do bot. |

Textos de apoio permitidos:

- "Cada módulo é ativado pela nossa equipe na sua loja, depois da contratação."
- "O WhatsApp usado é o da sua loja, conectado por QR Code."
- "Disparos respeitam quem pediu para sair e têm limite diário por cliente."
- "A nota fiscal exige um termo de aceite e o certificado digital da sua empresa. A gente cuida da configuração."

Proibido na copy pública: nome do prestador fiscal, "Google Avaliações", "API oficial do WhatsApp", qualquer valor de excedente, promessa de que o WhatsApp nunca será bloqueado.

## Instruções para o agente da landing

Copie o bloco abaixo como prompt.

```
Você vai editar a landing page do Sai aê (repositório da landing, não o do app).

Contexto: o Sai aê vende dois planos, Essencial (R$ 57,90/mês) e Pro (R$ 87,90/mês), e passa a vender módulos extras contratados à parte: WhatsApp (avisos de pedido e avaliação, disparos de promoções, atendente de pedidos) e Nota fiscal (NFC-e). Nenhum módulo está incluído em nenhum plano.

O que fazer:
1. Abra o arquivo de planos da landing (MA_PLANS, em src/plans.js) e a seção de planos/preços da página. Não altere preços, ciclos, descontos anuais, descrições, CTAs nem os oito itens existentes de cada plano.
2. Em cada plano (Essencial e Pro), acrescente ao final da lista UM item discreto, sem ícone de destaque: no Essencial "WhatsApp e nota fiscal são módulos extras, contratados à parte."; no Pro "WhatsApp e nota fiscal são módulos extras, contratados à parte. Não estão incluídos nem no Pro."
3. Crie a seção "Módulos extras" logo abaixo dos cards dos planos, com os cartões na ordem: Avisos de pedido e avaliação (R$ 39,90/mês, sem limite dentro dos limites de segurança); Disparos de promoções (R$ 39,90/mês, 500 mensagens por mês, exige Avisos); Nota fiscal NFC-e (R$ 69,90/mês, 300 notas por mês, ativação única de R$ 99); Pacote WhatsApp completo (R$ 139,90/mês). NÃO inclua ainda o cartão "Atendente de pedidos por WhatsApp (R$ 69,90, 300 conversas)" nem o preço do Pacote se o João não tiver confirmado o preço do atendente: deixe o cartão pronto no código, escondido por uma constante (por exemplo MOSTRAR_ATENDENTE = false), e o Pacote também escondido pela mesma constante.
4. Mantenha o tom e a voz da copy atual: frases curtas, português do Brasil, direto, sem jargão e sem exagero. Use os mesmos componentes visuais, tokens de cor e tipografia dos cards de plano. Funcione bem no celular, sem rolagem horizontal, com áreas de toque de pelo menos 44px.
5. Regras de conteúdo: não cite o nome do prestador fiscal; não prometa "Google Avaliações"; não diga que usamos a API oficial do WhatsApp (usamos o WhatsApp da própria loja, conectado por QR Code); não prometa que o WhatsApp nunca será bloqueado; não publique valores de excedente nem o nome do prestador fiscal.
6. Os botões dos módulos devem levar ao contato com a equipe (WhatsApp ou formulário que a landing já usa), nunca ao checkout da assinatura, porque a contratação de módulos é manual por enquanto.
7. NÃO publique nem faça deploy. Mostre ao João o resultado (capturas de tela ou o diff) e pergunte se aprova antes de qualquer publicação. Pergunte também se o preço do atendente (R$ 69,90) e do Pacote (R$ 139,90) já foram confirmados.
8. Ao terminar, diga quais arquivos mudaram e lembre o João de que a cópia local `src/lib/planos.ts` do app Sai aê precisa ser atualizada para refletir os itens novos dos planos, se ele aprovar.
```
