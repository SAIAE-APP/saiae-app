# Cashback do cardápio digital: proposta de design (Projeto 3)

Data: 2026-10-27. Status: **proposta para o João aprovar ou corrigir. Nenhum código, migration ou deploy foi feito.**

Como ler as marcações deste documento:

- **Decisão do dono:** nenhuma ainda. O João pediu para pular as perguntas e receber uma proposta. Tudo o que está abaixo é proposta até ele aprovar.
- **[Escolha minha]:** decisão pequena que tomei para o documento fechar. O João pode trocar sem desmontar o resto.
- **[Suposição]:** algo que parece verdadeiro mas não foi confirmado (no código, no Mercado Pago, com contador ou advogado). Precisa de confirmação antes de virar regra.
- **[Fato do repo]:** conferido no código ou nas migrations em 2026-10-27.

## 1. Intenção e porquê

O cardápio digital já vende, cobra Pix e cartão e entrega cupom. Falta um motivo para o cliente voltar sem a barraca ter de lançar um cupom novo a cada semana. Cashback resolve isso de um jeito que o dono entende: "o cliente pagou R$ 40, ganhou R$ 2 para usar no próximo pedido".

A barraca é quem decide se quer, quanto dá e por quanto tempo. O Sai aê só entrega a ferramenta, mantém o saldo correto e mostra o custo com clareza. O Sai aê não vira banco, não guarda dinheiro de ninguém e não promete nada em nome da barraca.

## 2. Metas, não-metas e anti-metas

**Metas**

1. O cliente identificado (telefone confirmado) que pagou online vê, na hora, quanto ganhou e até quando vale.
2. No pedido seguinte ele usa o saldo com dois toques.
3. O dono liga, escolhe o percentual e enxerga em um relatório quanto concedeu, quanto foi usado, quanto venceu e quanto ainda deve.
4. O saldo nunca fica errado: crédito e uso são idempotentes, reversíveis e auditáveis.
5. Nada quebra as decisões já fechadas (seção 5).

**Não-metas (nesta proposta)**

- Cashback para pedido lançado no balcão, na mesa ou "pagar na entrega" (ver V2).
- Saque em dinheiro, transferência de saldo entre clientes ou entre lojas.
- Pontos, selos, níveis, assinatura ou clube.
- Cashback financiado pelo Sai aê.
- Campanhas segmentadas e aviso de saldo por WhatsApp (V2).

**Anti-metas (o que o cashback NÃO pode virar)**

- **Mecanismo de fraude:** crédito sem pagamento confirmado, crédito que sobrevive a um estorno, saldo que uma pessoa multiplica com várias contas.
- **Lavagem de promoção:** cupom e cashback empilhados de forma que o cliente pague menos do que a barraca aprovou, ou saldo usado para gerar mais saldo em círculo.
- **Promessa sem aprovação da barraca:** o percentual, a validade e o teto são sempre escolhidos pelo dono. O padrão só vale depois que o dono liga a função.
- **Cadastro invasivo:** nada de CPF, data de nascimento ou e-mail. Reaproveita o perfil que já existe (nome e telefone confirmado).
- **Dinheiro do Sai aê escondido:** o cashback não altera a taxa de R$ 0,99 nem a conta que a barraca recebe do Mercado Pago de forma surpreendente.

## 3. O que o mercado faz

Pesquisa feita em 2026-10-27, busca web e leitura de páginas oficiais quando abriram. A confiança vem junto de cada achado. **Lacuna importante:** não encontrei a regra oficial de iFood, Rappi, 99Food e Keeta sobre quem paga o cupom do restaurante, e não existe fonte independente que isole o efeito do cashback no ticket e na recompra. Não inventei esses números.

| Concorrente ou referência | O que faz | Quem financia | Confiança |
|---|---|---|---|
| **Suitable** (app de pedidos, produto de terceiro) | Configurações do dono: percentual sobre o total do pedido (exemplo da própria página: 10% de R$ 50 vira R$ 5), resgate máximo por pedido, validade do saldo em dias, lojas onde vale, formas de pagamento que acumulam, opção de não dar cashback em combos e em promoções. O cliente vê o cashback ao finalizar e escolhe usar agora ou depois. O saldo só aparece depois que o pedido que o gerou é pago. A página não cita valor mínimo nem estorno. [Fonte](https://intercom.help/suitableapp/pt-BR/articles/11087877-cashback) | A loja (configura tudo) | Alta para o que descreve |
| **Goomer** | Fidelidade por número de pedidos, não cashback: o dono define quantos pedidos, prazo em dias, valor mínimo por pedido (sugere um pouco acima do ticket médio) e o desconto de prêmio, com data para usar. Só em planos pagos. [Fonte](https://goomer.com.br/blog/goomer-programa-de-fidelidade) | A loja | Alta; sem número de impacto na página |
| **Anota AI** | Fidelidade com mais opções: escolhe produtos e categorias que contam, e o prêmio pode ser desconto, prato ou frete. [Fonte](https://anota.ai/blog/goomer/) | A loja | Média (li só o resumo da busca) |
| **Saipos** | Páginas descrevem pontos por real, selo ("a cada 10 pedidos, 1 grátis") e cashback via empresa parceira que devolve parte do valor ao cliente. Sem percentual, sem validade, sem resultado numérico. [Fonte](https://saipos.com/sistema/restaurante/programa-de-fidelidade-para-restaurante) | Loja ou parceiro | Alta para a descrição; nenhuma para números |
| **Toast** | O dono escolhe acumular por dólar gasto ou por visita; recompensa de item grátis até "cash back"; o resgate é dado como desconto no pedido. [Fonte](https://support.toasttab.com/en/article/Redeeming-Points-with-Toast-Loyalty) | O restaurante | Média (conteúdo de marketing e ajuda) |
| **Square Loyalty** | Pontos expiram no fim do mês após 6 meses da data em que foram ganhos, ou nunca, conforme o vendedor; o cliente recebe SMS 14 dias antes de vencer. [Fonte](https://sellercommunity.com/t5/Product-Updates/Set-an-Expiration-Date-for-your-Loyalty-Points/ba-p/100616) | O vendedor | Média (post de comunidade, pode estar datado) |
| **Méliuz** | Saldo nasce "pendente" e só vira "confirmado" quando a loja confirma a venda; saque por Pix a partir de R$ 20; prazo de confirmação depende da loja, de 48 horas até cerca de 90 dias; fontes divergem sobre a validade. [Fonte](https://www.meliuz.com.br/blog/prazos-do-meliuz/) | O anunciante (loja) paga ao Méliuz; o Méliuz repassa parte (inferência, a fonte não detalha) | Média |
| **Rappi (RappiCréditos)** | Créditos entram depois que o pedido é concluído, vencem em data fixa e têm exclusões de serviço. Em campanhas de 2019/2020, o cashback era pago pelo parceiro da campanha (ex.: Sodexo). [Fonte](https://tecnoblog.net/responde/como-usar-rappicreditos-para-pagar-pedidos-e-fretes/) e [Fonte](https://tiinside.com.br/en/02/08/2019/Sodexo-launches-cashback-promotion-with-Rappi/) | Parceiro da campanha | Baixa a média (dados antigos) |
| **iFood** | O "cashback do iFood" que aparece nas buscas é, em geral, de bancos e carteiras que vendem crédito/gift card do iFood, com percentuais de 1% a 10% e validade típica de 90 dias; não é cashback da loja do restaurante. O Clube iFood é assinatura com cupons sobre itens, sem a taxa de entrega, segundo fonte de terceiros. [Fonte](https://www.melhorescartoes.com.br/ifood-cashback-picpay-inter.html) e [Fonte](https://tecnoblog.net/noticias/clube-ifood-troca-cupons-em-pedidos-por-desconto-na-entrega/) | Banco ou carteira; no Clube, o iFood | Baixa a média (fontes antigas e de terceiros) |
| **99Food e Keeta** | Não encontrei regra de cashback nem de quem paga o cupom. Só a notícia de cupons agressivos e uma disputa no Cade sobre contratos com restaurantes. [Fonte](https://mercadoeconsumo.com.br/01/04/2026/foodservice/secretaria-geral-do-cade-abre-investigacao-sobre-99food-a-pedido-da-keeta/) | Não confirmado | Baixa |
| **Mercado Pago (blog para lojistas)** | Prazos de 30 a 90 dias são os mais usados no varejo, segundo o resumo da busca (a página bloqueou a leitura direta). | Loja | Baixa a média |

**Impacto em ticket e recompra.** As únicas cifras que achei são de fornecedores: +40% de visitas repetidas em três meses e clientes fiéis gastando 67% mais por visita (blog de um fornecedor, sem metodologia), e +30% de frequência com +38% de gasto numa campanha de pagamento com uma rede de fast food (estudo de caso do próprio fornecedor). Comparar cliente fiel com cliente novo não prova que o programa causou a diferença. **Confiança baixa. Não use esses números para prometer resultado ao dono.** [Fonte](https://www.dineopen.com/blog/restaurant-loyalty-program-guide) e [Fonte](https://blog.paylead.fr/creating-repeat-buyers-with-a-leading-quick-service-restaurant/)

**Padrões que se repetem (e que a proposta adota):**

1. Quem faz cashback "da loja" deixa a loja pagar e configurar.
2. O saldo só existe depois do pagamento confirmado.
3. O resgate vem como desconto no pedido seguinte, com teto.
4. A validade é curta (30 a 90 dias é o intervalo que aparece) e o cliente é avisado antes de vencer.
5. Combos e promoções às vezes ficam de fora, para o cashback não empilhar sobre desconto.
6. O cliente vê o benefício no momento de finalizar o pedido, não só depois.

## 4. Fiscal e tributário: só um alerta

Não é parecer fiscal. As fontes que li são opiniões de advogados e artigos escritos antes da reforma tributária, e divergem: uns tratam o crédito para compra futura como desconto condicional ou bonificação (com risco de incidência de tributo), outros destacam que o desconto incondicional lançado na nota não integra a base. Em comum: o resultado depende de como o benefício aparece na nota e na contabilidade. ([IBET](https://www.ibet.com.br/orientacoes-da-receita-sobre-cashback-favorecem-contribuinte/), [artigo sobre cashback privado e reforma](https://www.reformatributaria.com/opiniao/cashback-privado-na-reforma-tributaria-bonificacao-em-dinheiro-no-novo-modelo/).) Confiança: baixa. **O dono precisa confirmar com o contador antes de ligar a função.** O texto de ativação no app deve dizer isso (seção 10).

## 5. Restrições do repo que o cashback não pode quebrar

Todas conferidas no `CLAUDE.md`, nas specs e nas functions em 2026-10-27.

- **[Fato do repo]** O Sai aê cobra R$ 0,99 do cliente em todo pagamento online. É uma constante no servidor (`taxaPlataforma.ts`), copiada para `pagamentos_pendentes.taxa_plataforma_centavos` e para o pedido. A cobrança usa o token OAuth da barraca com `application_fee` = R$ 0,99. O dinheiro vai direto para a conta Mercado Pago da barraca; só a taxa fica com o Sai aê.
- **[Fato do repo]** O dono da barraca paga as taxas do Mercado Pago.
- **[Fato do repo]** O webhook confere o valor pago contra o gravado no pendente: itens − cupom + entrega + taxa. Divergência não cria pedido. Também confere a comissão devolvida pelo Mercado Pago.
- **[Fato do repo]** Estorno é total (itens, entrega e R$ 0,99), disparado só pelo dono, via `estornar-pagamento`. Sem estorno parcial. Saldo insuficiente da barraca mostra erro e vai para o suporte.
- **[Fato do repo]** Cupom v2: um por pedido, desconto só sobre os itens (nunca na entrega nem na taxa), reserva durante o Pix aberto, confirmação só com pagamento aprovado, e "pagamento aprovado nunca é recusado" (o webhook confirma o uso mesmo com reserva vencida). Uma linha de `cupom_usos` por cobrança, com índice único.
- **[Fato do repo]** Pedido de total zero por cupom não chama o provedor, não cobra a taxa (isso ainda é "a confirmar" com o dono) e não emite NFC-e.
- **[Fato do repo]** NFC-e: o desconto do cupom é rateado entre os itens (`descontoNfce.ts`) e a nota vale itens − desconto; a taxa de entrega e a taxa Sai aê ficam fora.
- **[Fato do repo]** Cartão é tokenizado no navegador com a chave pública da vendedora. Nada do cashback toca em dado de cartão.
- **[Fato do repo]** Perfil do cliente é por loja, chave `barraca_id` + telefone, com código por WhatsApp (`cliente-pedir-codigo`, `cliente-verificar-codigo`, `cliente-sessao`). Só aparece nas lojas em que o dono ligou `perfil_cliente_obrigatorio`. "Apagar meus dados" (`cliente_apagar_dados`) apaga perfil, endereços, sessões e códigos e anonimiza pedidos; `cupom_usos.cliente_id` vira nulo.
- **[Fato do repo]** Módulos pagos: quatro módulos hoje, ativados só pelo superadmin, cobrança manual. Cashback ainda não é módulo.

## 6. Quem financia: recomendação e alternativas

### 6.1 Como o dinheiro anda hoje (e por que isso decide a pergunta)

Num pedido online de itens R$ 40, entrega R$ 5, taxa Sai aê R$ 0,99, o cliente paga R$ 45,99. O Mercado Pago desconta a taxa dele da barraca, separa R$ 0,99 para o Sai aê e deposita o restante na conta da barraca. A barraca nunca recebe os R$ 0,99, e o Sai aê nunca encosta no resto.

Quando o cliente usa saldo de cashback, ele paga menos no Mercado Pago. Logo, **a barraca recebe menos dinheiro de verdade, na própria conta**, e o Sai aê continua com os mesmos R$ 0,99. Isso é automático: não existe outro lugar de onde o desconto possa sair, a não ser que o Sai aê pague a diferença por fora do split.

### 6.2 As três opções

| | A. Barraca financia (recomendada) | B. Sai aê financia | C. Dividido |
|---|---|---|---|
| Quem concede | Barraca, com o percentual que ela escolher | Sai aê | Parte cada um |
| `application_fee` | Continua R$ 0,99. Sem mudança | Só poderia **reduzir** (no máximo zerar a taxa), nunca ser negativo. Reduzir fere a decisão fechada de cobrar R$ 0,99 em todo pagamento online | Igual a A, mais um acerto por fora |
| Valor líquido da barraca | Menor no pedido em que o saldo é usado, exatamente pelo valor usado. É o custo escolhido por ela | Para a barraca receber o pedido cheio, o Sai aê teria de pagar a diferença **fora** do Mercado Pago (Pix manual, abatimento em mensalidade de módulo) | A barraca recebe o pedido menos a parte dela; o Sai aê paga a outra parte por fora |
| Conciliação | Simples: o relatório da barraca mostra "desconto de cashback" ao lado de "desconto de cupom" | Complexa: novo fluxo de repasse e de cobrança, que hoje é manual (o João registra `pago_ate` à mão) | Complexa, igual a B |
| Risco financeiro do Sai aê | Nenhum | Alto. Em um pedido de R$ 40 com 5% de cashback, o Sai aê concederia R$ 2,00 e receberia R$ 0,99 (valor ilustrativo, ticket suposto). O programa perde dinheiro por pedido | Médio |
| Incentivo | A barraca só liga se valer a pena para ela, e calibra o percentual ao próprio ticket e margem | A barraca sempre liga e não calibra | Mistura |

### 6.3 Recomendação: A, a barraca financia

Argumentos, em ordem:

1. **É a única opção que cabe no modelo de split que já está pronto e aprovado.** Nada muda no `application_fee`, no webhook nem na constante de R$ 0,99.
2. **Não cria dívida entre Sai aê e barraca.** Hoje o Sai aê não toca no dinheiro da barraca. B e C obrigariam a criar um repasse manual, com risco de erro e de disputa.
3. **A conta do Sai aê fecha.** Com R$ 0,99 por pedido, o Sai aê não tem margem para pagar um percentual do ticket.
4. **Alinha o incentivo.** Quem paga é quem decide percentual e validade. O mercado faz assim (seção 3).
5. **Coerente com o cupom.** O desconto de cupom já sai do bolso da barraca. O cashback é um desconto adiado.

Consequência que o dono da barraca precisa entender: o saldo que o cliente ganha é uma **dívida da barraca com o cliente**, em forma de desconto futuro. Ela só "paga" quando o cliente usa. Saldo vencido deixa de ser dívida (seção 10).

Onde o Sai aê pode ajudar no futuro (V2, não agora): campanha de boas-vindas ou de reativação financiada pelo Sai aê **por fora do split**, com teto de orçamento e contrato claro, depois que o repasse manual existir.

## 7. Proposta recomendada: V1 mínima

Resumo: cashback da barraca, só no cardápio digital, só em pedido pago online (Pix ou cartão) por cliente com telefone confirmado, resgate como desconto nos itens do pedido seguinte.

### 7.1 Onde vale

- **Acúmulo e resgate:** só no cardápio digital público, em pedidos que passam por `criar-pagamento-pix` (Pix e cartão) com cliente identificado. **[Escolha minha]**
- **Fora na V1:** "pagar na entrega" (o pagamento não é confirmado pelo sistema), Caixa e Mesa (operador no balcão não tem sessão do cliente) e pedido grátis. Razão: a regra "só crédito com pagamento confirmado" e a antifraude ficam simples e verificáveis. **[Escolha minha]**
- Só funciona em lojas que **ligaram o perfil do cliente** (`perfil_cliente_obrigatorio`). Sem perfil, o botão não aparece. **[Fato do repo + escolha minha]**

### 7.2 Configuração da barraca

Nova seção em Ajustes, "Cashback", desligada por padrão, com um botão Salvar explícito (padrão do app). Campos: **[Escolha minha]**

| Campo | Padrão sugerido | Faixa | Observação |
|---|---|---|---|
| Ligar cashback | Desligado | liga/desliga | Só liga depois de mostrar o aviso fiscal (seção 4) e o resumo do compromisso (seção 10) |
| Percentual de volta | 5% | 1% a 15% | Sobre a base de cálculo (7.3). Padrão é palpite meu: o Suitable dá 10% como exemplo, mas isso é só ilustração, não pesquisa. **[Suposição]** |
| Validade do saldo | 60 dias | 30 a 90 dias | A faixa segue o que o mercado mostra (seção 3) |
| Teto de uso por pedido | 50% dos itens | 10% a 90% | Evita que um pedido seja quase todo pago com saldo |

Constantes no servidor, fora da configuração da barraca na V1: crédito máximo de **R$ 20,00 por pedido**, piso de **R$ 1,00** pago em dinheiro nos itens (7.5). **[Escolha minha]**

### 7.3 Base de cálculo (o que gera cashback)

`crédito = floor(itens_líquidos × percentual)`, em centavos inteiros, onde:

- `itens_líquidos` = soma dos itens − desconto de cupom − saldo de cashback usado no mesmo pedido (como só um dos dois existe por pedido, é sempre "itens − o benefício que houver"). Pedido que usou saldo **gera crédito** sobre o valor dos itens realmente pago em dinheiro, nunca sobre a parte paga com saldo; por isso não há círculo de saldo gerando saldo. **[Escolha minha]**
- **Fora da base:** taxa de entrega, taxa Sai aê de R$ 0,99, taxa de serviço da barraca (`nfce_taxa_servico_centavos`) e adicionais que o app já trate como taxa.
- Pedido com cupom **ganha** cashback, mas só sobre o que foi de fato pago nos itens. **[Escolha minha]** Isso evita empilhar benefício sobre o mesmo real e não exclui o cliente que usou cupom.
- Sem exclusão de combos e promoções na V1 (o Suitable oferece essa opção). **[Escolha minha]** O cupom já reduz a base, e filtrar por tipo de item exigiria um campo novo no cardápio.

### 7.4 Quando credita e quando libera

- **Credita** quando o webhook confirma o pagamento aprovado e o pedido é criado. Nunca na criação do Pix, nunca com Pix pendente, rejeitado ou expirado.
- **Libera para uso** na mesma hora, para o **pedido seguinte** (não o mesmo). **[Escolha minha]** Sem carência extra: a perda possível é pequena e a reversão por estorno cobre o caso comum (7.7). Para cartão, o risco de contestação (chargeback) fica com a barraca, como já está na spec do pagamento marketplace. **[Suposição]** a confirmar com as regras do Mercado Pago.
- Idempotência: o crédito é gravado por RPC com índice único por pedido. Webhook repetido não duplica.

### 7.5 Resgate

- **Como:** no checkout, o cliente com saldo vê "Usar meu saldo: R$ X". O resgate é um desconto nos itens, igual ao cupom.
- **Quanto:** `resgate = min(saldo vigente, teto_percentual × itens_líquidos_antes_do_saldo, itens_líquidos_antes_do_saldo − R$ 1,00)`.
  - Parcial por padrão: se o saldo é maior que o teto, usa o teto; se menor, usa tudo.
  - O cliente pode escolher não usar. O app não força.
- **Nunca abate** entrega, taxa Sai aê ou taxa de serviço. Assim o cliente sempre paga no mínimo R$ 1,00 de item mais R$ 0,99 mais a entrega. O cashback **nunca zera o pedido**. Isso tira da conta o problema do "pedido grátis" (que o cupom já tem) e a dúvida da taxa de R$ 0,99 em pedido de total zero. **[Escolha minha]**
- **[Suposição]** O piso de R$ 1,00 nos itens também protege contra o Mercado Pago recusar uma cobrança em que a comissão (R$ 0,99) é quase todo o valor. Precisa ser testado no sandbox com o token OAuth da barraca antes de fixar o número.
- **Interação com cupom:** **um benefício por pedido: cupom OU saldo, nunca os dois.** **[Escolha minha]** É a mesma regra do "um cupom por pedido", fica fácil de explicar e fecha a porta da soma de benefícios. Alternativa (somar com teto): mais generosa e mais difícil de auditar; fica para a V2 se o dono quiser.
- **Reserva e confirmação, igual ao cupom:** o saldo é reservado quando o Pix é gerado, fica preso até o vencimento do Pix, volta se o Pix expira ou é rejeitado e só é consumido quando o webhook confirma. Pagamento aprovado nunca é recusado: se a reserva venceu mas o cliente pagou, o webhook consome o saldo mesmo assim. Se o saldo já foi gasto em outro pedido, vale a regra de 7.8: o saldo trunca em zero, o pedido guarda em `cashback_usado_centavos` o valor **realmente descontado do que o cliente pagou**, e a diferença vira lançamento de `ajuste` pago pela barraca. O saldo do razão nunca fica negativo.

### 7.6 Validade

- Regra simples **[Escolha minha]**: o saldo inteiro vence N dias depois do **último crédito**. Cada novo crédito renova o prazo do saldo todo. Resgatar não renova.
- Vantagem sobre vencimento por lote (como a Square faz): é fácil de explicar ("compre a cada 60 dias e seu saldo não vence") e não exige cálculo por lote.
- Desvantagem: o saldo mais antigo pode viver além do prazo se o cliente comprar sempre. Aceitável: ele está comprando.
- A expiração é calculada na leitura (sem cron), como os módulos pagos. O lançamento de expiração é gravado no próximo acesso que mexer no saldo. **[Escolha minha]**
- A tela do saldo sempre diz "vence em DD/MM".
- **Mudar a validade ou o percentual depois não altera saldos já concedidos.** Cada crédito guarda o prazo com que nasceu.

### 7.7 Estorno e cancelamento

- **Estorno total do pagamento online** (única forma que existe hoje): dentro da mesma operação,
  1. se o pedido gerou crédito, cria um lançamento de reversão pelo menos até o saldo atual do cliente (não cobra além do que ele tem). O que já foi gasto é perdido pela barraca. **[Escolha minha]** Cobrar de volta com saldo negativo traria discussão com o cliente por pouco dinheiro, e o estorno é ação do dono.
  2. se o pedido usou saldo, devolve o saldo ao cliente, com validade renovada a partir do estorno. **[Escolha minha]**
- **Cancelamento sem estorno:** o `CLAUDE.md` indica que o estorno também vale para pedidos já cancelados, então cancelar sem estornar existe. Regra: **o crédito e o saldo devolvido acompanham o dinheiro.** Cancelou mas não estornou: o dinheiro ficou com a barraca, então o crédito permanece e o saldo usado não volta; a reversão só dispara no estorno (`estornar-pagamento`). **[Escolha minha]** Um único gatilho, uma única RPC idempotente. O builder confirma no código que não há outro caminho que devolva dinheiro.
- **Chargeback:** o webhook atual não trata contestação. Na V1, o crédito **não** é revertido automaticamente. O dono pode ver o caso no Mercado Pago e usar o ajuste manual do suporte. Risco aceito e listado na seção 14.

### 7.8 Casos de borda

- Saldo negativo: só pode surgir no pagamento aprovado fora da reserva (7.5). Tratamento: o saldo vai a zero e o excedente é perdido pela barraca, com lançamento de ajuste.
- Pedido grátis por cupom (itens líquidos zero): crédito zero, não há lançamento.
- Desligar o cashback: novos créditos param; **saldos já concedidos continuam utilizáveis até o vencimento** (7.6), para a barraca não frustrar o cliente. **[Escolha minha]** Essa regra é de proteção ao consumidor e precisa de confirmação de quem entende de CDC. **[Suposição]**
- Troca do percentual pelo dono: vale só para pedidos novos.

## 8. Identificação do cliente e antifraude

**Quem recebe saldo:** o `clientes_finais.id` com `telefone_confirmado_em` preenchido, na loja onde ele pediu. O saldo é **por loja**, igual ao perfil. **[Fato do repo + escolha minha]** Sem login, sem saldo: o cliente que não confirmou o telefone simplesmente não vê a oferta de cashback.

Por que o telefone confirmado basta como identidade:

- Para ganhar R$ 1, o cliente precisa **pagar** online. Criar contas para ganhar saldo sai caro para o fraudador.
- O código por WhatsApp já tem limites por telefone, por IP e por loja (spec do perfil).
- O saldo é pequeno e por loja, o que limita o ganho de quem abusa.

Controles antifraude da V1:

1. Crédito só com pagamento confirmado pelo webhook, com valor conferido (a verificação que já existe).
2. Teto de crédito de R$ 20,00 por pedido.
3. Estorno reverte o crédito (7.7).
4. Crédito idempotente por pedido, resgate idempotente por cobrança.
5. Um benefício por pedido.
6. Registro auditável: todo lançamento tem tipo, pedido, cobrança e hora; ninguém apaga linha.
7. Limite de resgate por pedido (teto percentual e piso de R$ 1,00).

Riscos conhecidos e aceitos: número de telefone reciclado herda o saldo; sessão do cliente roubada permite gastar o saldo daquele cliente. Em ambos os casos o valor é pequeno e a barraca é quem financia. **[Suposição]** aceitável. O João decide se quer mais (por exemplo, pedir o código de novo para gastar saldo acima de um valor). Fica registrado como risco, sem construir isso agora.

## 9. LGPD, consentimento e Política de Privacidade

- **O que se guarda:** o que já existe (nome, telefone, endereço) mais o razão de lançamentos do saldo. Não entra dado novo sobre o cliente.
- **Base legal e consentimento:** o saldo é parte do serviço e não depende do consentimento de marketing. Mas **avisar o cliente do saldo por WhatsApp é marketing** e só pode ser feito para quem aceitou promoções (`consentimento_marketing`). Na V1 não há aviso ativo; o cliente vê o saldo ao abrir o app. **[Escolha minha]** A V2 do aviso de vencimento usa o consentimento que já existe.
- **Política de Privacidade (`src/pages/Privacidade.tsx`):** precisa de um parágrafo sobre o saldo de cashback (o que é, por loja, vencimento, o que acontece ao apagar os dados). O texto da política do cliente final ainda era pendência na spec do perfil; o builder deve verificar o estado atual da página antes de editar. **[Suposição]**
- **"Apagar meus dados":** apaga o perfil e, junto, o **saldo de cashback**. A tela de confirmação avisa o valor que será perdido. O razão de lançamentos fica **anonimizado** (`cliente_id` nulo), porque a barraca precisa dele para a contabilidade e não identifica ninguém. **[Escolha minha]**
- **Exclusão de loja ou de conta:** apaga o razão de lançamentos junto (mesmo comportamento de cupons e usos).

## 10. O saldo é uma dívida da barraca (comunicação ao dono)

O dono precisa entender, antes de ligar, em linguagem simples:

> Cada real de cashback que você dá é um desconto que você deve ao cliente. O dinheiro não sai da sua conta agora; ele sai menos quando o cliente voltar e usar. Saldo que vence deixa de ser dívida. Se você desligar, os saldos já dados continuam valendo até vencer.

Isso aparece (a) no aviso ao ligar, em Ajustes, e (b) no relatório. Na contabilidade da barraca, o saldo em aberto é um passivo; quem decide como lançar é o contador dela. O Sai aê mostra os números, não faz a contabilidade. **[Escolha minha]**

## 11. Onde cada pessoa vê o quê

**Cliente (cardápio público)**

1. No carrinho, uma linha discreta: "Você ganha R$ X de volta neste pedido" (calculada no servidor, mostrada só para cliente identificado e quando não está usando saldo). É o momento em que o cliente "sente" o benefício, como nos concorrentes (seção 3).
2. No checkout, "Usar meu saldo (R$ Y)" com opção desmarcada se a barraca ou o cliente preferir. O total muda na hora, com o resumo mostrando: itens, cupom ou saldo, entrega, taxa de serviço Sai aê.
3. Na confirmação do pedido: "Você ganhou R$ X. Vale até DD/MM."
4. Em "Meu perfil": saldo, validade e os últimos 20 lançamentos.

**Dono (app)**

- Ajustes > Cashback: liga/desliga, percentual, validade, teto, aviso fiscal, resumo "saldo em aberto: R$ Z".
- Histórico e detalhe do pedido: "Cashback usado: −R$ A" e "Cashback gerado: R$ B", à parte dos itens, como o cupom já é mostrado.
- Relatório (seção 12).
- Clientes: coluna "saldo".

## 12. Relatórios e conciliação

No Relatório, uma seção "Cashback" no período escolhido: **[Escolha minha]**

| Linha | Significado |
|---|---|
| Concedido | Soma dos créditos |
| Usado | Soma dos resgates confirmados (é o desconto dado) |
| Vencido | Soma dos saldos que expiraram |
| Estornado | Créditos revertidos e saldos devolvidos |
| Saldo em aberto hoje | O que a barraca ainda deve em desconto futuro |

- O **faturamento** continua a soma dos itens, e o "Recebido nos itens" passa a descontar cupom **e** saldo usado, como a seção de descontos já faz para cupom (`src/lib/descontosCupom.ts`).
- Conciliação com o Mercado Pago: valor recebido por pedido = valor pago − taxa do Mercado Pago − R$ 0,99. O valor pago já considera o saldo usado, então a barraca consegue explicar a diferença para o preço cheio olhando "Cashback usado".
- A tela de pedido mostra a decomposição completa.

## 13. Impacto fiscal e NFC-e

- **Resgate** é tratado como o cupom: o valor é rateado entre os itens e vai no campo de desconto por item da FocusNFe (`_shared/descontoNfce.ts`). A nota vale itens − desconto (cupom ou cashback), e as taxas ficam fora. **[Escolha minha]** Como só um benefício por pedido, não há soma.
- **Concessão** do cashback não aparece na nota. **[Suposição]** A fonte divergente da seção 4 diz que há risco quando o benefício vira crédito futuro. **Alerta ao dono:** confirmar com o contador antes de ligar.
- Pedido sem itens líquidos (zero) continua sem NFC-e (`pedido_gratis`).
- A primeira NFC-e com desconto ainda não foi emitida em homologação (`CLAUDE.md`). O builder deve emitir uma com resgate de cashback no teste.

## 14. Riscos

1. **Compromisso financeiro do dono mal entendido.** Mitigação: aviso ao ligar e relatório de saldo em aberto.
2. **Chargeback de cartão** depois de o cliente já ter gastado o saldo. Sem tratamento automático na V1.
3. **Mercado Pago pode recusar cobrança** em que a comissão é quase todo o valor ([Suposição], testar no sandbox).
4. **API de Payments do Mercado Pago será descontinuada** (risco já registrado no `CLAUDE.md`). O cashback não depende da API, só do webhook, mas o mesmo trabalho de migração vai tocar os mesmos pontos.
5. **Dupla cobrança do mesmo cupom** (risco aceito do cupom) se repete: dois Pix com saldo reservado, pagando os dois. Mesma mitigação do cupom: cada Pix foi cobrado pelo valor que o cliente viu. O saldo reservado em um Pix é consumido uma vez; o segundo Pix recalcula na reserva. O builder deve garantir que a segunda reserva não deixe o saldo negativo.
6. **Fiscal e consumidor.** Seção 4 e 7.8.
7. **Cliente descobre que o telefone é compartilhado** (família, número reciclado). Aceito.
8. **Poucos dados.** Hoje parecem existir poucas barracas ativas com pagamento online **[Suposição, confirmar com o João]**; medir efeito do cashback terá pouco poder estatístico (seção 17).

## 15. Modelo de dados provisório

Provisório: o builder ajusta nomes e tipos. Segue o padrão de cupons (RLS, funções `security definer`, só papel de serviço escreve).

**Colunas novas em `barracas`:** `cashback_habilitado boolean not null default false`, `cashback_percentual_bp integer` (pontos-base: 500 = 5%; check 100 a 1500), `cashback_validade_dias integer` (30 a 90), `cashback_teto_uso_pct integer` (10 a 90), `cashback_termo_aceito_em timestamptz` (quando o dono viu o aviso fiscal e de passivo). Escolha: colunas na `barracas`, como `cupons_habilitado`. **[Escolha minha]**

**`cashback_lancamentos`** (razão, só inserção):

| Coluna | Observação |
|---|---|
| `id uuid pk` | |
| `barraca_id uuid not null` → `barracas(id) on delete cascade` | |
| `cliente_id uuid` → `clientes_finais(id) on delete set null` | Nulo após "apagar meus dados" |
| `tipo text not null` | `credito`, `resgate`, `estorno_credito`, `estorno_resgate`, `expiracao`, `ajuste` (a reserva NÃO entra no razão; ver `cashback_resgates`) |
| `valor_centavos integer not null` | Com sinal: crédito positivo, uso e expiração negativos |
| `pedido_id uuid` → `pedidos(id) on delete set null` | |
| `pagamento_pendente_id uuid` → `pagamentos_pendentes(id) on delete set null` | |
| `expira_em timestamptz` | Só em `credito` |
| `motivo text` | Obrigatório em `ajuste` |
| `criado_em timestamptz not null default now()` | |

**Índices únicos de idempotência:**

- `(pedido_id) where tipo = 'credito'`: um crédito por pedido.
- Em `cashback_resgates` (abaixo): `(pagamento_pendente_id)` único, uma linha por cobrança.
- No razão: `(pagamento_pendente_id) where tipo = 'resgate'` único, para o consumo não duplicar.
- `(pedido_id, tipo) where tipo in ('estorno_credito','estorno_resgate')`: estorno não duplica.
- Índice de consulta `(barraca_id, cliente_id, criado_em desc)`.

**`cashback_resgates`** (mesmo desenho de `cupom_usos`) **[Escolha minha]**: `id`, `barraca_id`, `cliente_id`, `pagamento_pendente_id` (único), `pedido_id`, `estado` (`reservado`, `confirmado`, `liberado`), `valor_centavos`, `reservado_ate`, `criado_em`. Saldo disponível = saldo do razão − resgates `reservado` ainda não vencidos. Ao confirmar, grava o lançamento `resgate` no razão. Reserva vencida é ignorada na contagem, sem cron, como no cupom.

**Saldo:** calculado por função `cashback_saldo(barraca_id, cliente_id)` que soma os lançamentos vigentes. Sem coluna de saldo para não divergir; se ficar lento, materializar depois. **[Escolha minha]**

**RLS:** ligada. O dono lê os lançamentos da própria loja por `usuario_tem_acesso_barraca`; nenhuma policy de escrita para `authenticated` e `anon`; escrita só por RPC de serviço. O cliente lê o próprio saldo e extrato **somente** pela edge function `cliente-sessao` (token → `cliente_id`), nunca direto.

**Colunas novas em `pagamentos_pendentes` e `pedidos`:** `cashback_usado_centavos integer not null default 0`, `cashback_gerado_centavos integer not null default 0` (pedido). Cópia, para o histórico não mudar se a configuração mudar (mesmo padrão de `desconto_cupom_centavos`).

## 16. Efeitos em criar_pedido, criar-pagamento-pix e webhook

**`criar-pagamento-pix`**

- Novo campo opcional `usar_cashback: boolean` no corpo. Sem sessão de cliente confirmada ou com cupom no pedido, o campo é recusado (422) com mensagem clara.
- Calcula o resgate no servidor com a fórmula de 7.5, reserva (idempotente por cobrança) e grava `cashback_usado_centavos` e a reserva no pendente.
- Total esperado = itens − cupom ou saldo + entrega + taxa Sai aê. O `total_esperado_centavos` do cliente continua conferido (409 se divergir, como hoje).
- `taxa_plataforma_centavos` e `application_fee` não mudam.
- Se a cobrança é recriada, libera a reserva anterior, como `cupom_liberar` faz.
- Pix expirado ou rejeitado: libera a reserva.

**`webhook-mercadopago`**

- Confere o valor pago contra o gravado no pendente, agora com saldo usado.
- Antes de marcar o pendente aprovado: confirma o resgate (RPC análoga a `cupom_confirmar`); falha devolve 500 e o provedor reenvia.
- Depois de criado o pedido: chama a RPC de crédito, que calcula `itens_líquidos`, aplica percentual e teto, e grava o crédito idempotente. Falha no crédito **não** impede o pedido (pagamento aprovado nunca é recusado) e fica em alerta para reprocesso. **[Escolha minha]**

**`criar_pedido`**

- Nenhuma mudança na assinatura. As colunas novas do pedido são preenchidas pelo webhook com os valores do pendente (padrão do cupom). O builder avalia se cabe em `criar_pedido_com_cupom` ou em RPC nova.

**`estornar-pagamento`**

- Após o estorno aceito pelo Mercado Pago, chama a RPC de reversão (7.7). Idempotente por pedido.

**`cliente-sessao`**

- Nova ação `cashback` (saldo, validade, últimos lançamentos). A ação `apagar` zera o saldo (9).

**`emitir-nfce`**

- Trata `cashback_usado_centavos` junto com o desconto de cupom no rateio. Ver 13.

## 17. Como medir sucesso

Sem infraestrutura nova. Consultas por barraca e por semana, ao lado dos relatórios:

1. **Pedidos recorrentes por semana por barraca:** clientes com ao menos dois pedidos pagos online em 30 dias, comparado com as quatro semanas anteriores à ativação. Caveat: poucas barracas em produção, então é leitura de tendência, não prova.
2. **Taxa de resgate:** pedidos com saldo usado ÷ pedidos de clientes com saldo disponível.
3. **Saldo em aberto ÷ concedido** e **vencido ÷ concedido:** mostra se o percentual é calibrado ou se está só enchendo uma dívida que ninguém usa.
4. **Ticket médio dos pedidos com resgate** versus sem, sabendo que isso é correlação.

Meta de aprendizado, não de promessa: depois de 8 semanas com pelo menos uma barraca com volume, o João decide continuar, ajustar o padrão (5%/60 dias) ou desligar. **[Escolha minha]**

## 18. V2 futura (não construir agora)

1. Cashback no Caixa e Mesa, identificando o cliente pelo telefone com código.
2. "Pagar na entrega" com crédito liberado só quando o operador marcar como pago.
3. Aviso por WhatsApp de saldo prestes a vencer, só para quem aceitou promoções (a Square faz isso aos 14 dias; ver seção 3). Depende do módulo de WhatsApp.
4. Cupom e saldo somados com teto.
5. Campanhas: bônus de boas-vindas e de reativação, financiadas pela barraca; e, só depois de existir repasse manual do Sai aê, campanha financiada pelo Sai aê.
6. Ajuste manual de saldo pelo dono, com motivo, no app.
7. Reversão automática por chargeback (depende de tratar contestação no webhook).
8. Vencimento por lote, caso a regra de renovação (7.6) mostre abuso.
9. Exclusão de combos e promoções da base de cálculo.
10. Cobrar o cashback como módulo pago (decisão do João, abaixo).

## 19. O que fica para o construtor

- Desenhar o SQL final, nomes e tipos, e ordem das migrations (aditivas, staging antes de produção).
- Decidir se o resgate reaproveita `cupom_usos`/`cupom_reservar` ou usa tabela própria. A recomendação é copiar o padrão, não misturar.
- Confirmar no sandbox do Mercado Pago o menor valor aceito com comissão de R$ 0,99 e fixar o piso conforme o resultado. O sandbox de cartão com token OAuth já devolveu HTTP 500 (`CLAUDE.md`): se continuar quebrado, o piso fica como constante única de R$ 1,00 no servidor, o restante é entregue e a validação ponta a ponta (Pix de valor baixo na loja de teste) vira pendência explícita antes de ligar em produção. **[Escolha minha]**
- Taxa de serviço da barraca: só existe na Mesa/comanda, que está fora da V1; o cardápio público não a cobra, então não entra na base. Se o builder encontrar outra taxa no pedido do cardápio, exclui da base.
- Evento para o CRM: contrato inalterado na V1 (`total_centavos` continua sendo o valor pago, já com o saldo abatido). O saldo usado não vai ao CRM; campo opcional aditivo fica para a V2. **[Escolha minha]**
- Sem módulo pago e sem feature flag de front na V1: a função nasce desligada por barraca (`cashback_habilitado`), editável pelo dono como `cupons_habilitado`. Se virar módulo (decisão 5), o gate passa para `modulo_ativo` e a coluna ganha proteção como `fiscal_habilitado`. **[Escolha minha]**
- Telas: seção em Ajustes, linha no carrinho, bloco no checkout, bloco no perfil, seção no relatório. Seguir a identidade Sai aê (um primário por tela, toque mínimo de 44 px).
- Parágrafo da Política de Privacidade.
- Testes: puros do cálculo (crédito, resgate, piso, arredondamento, validade), banco (idempotência, corrida de duas reservas, RLS), staging no estilo de `tests/cupons*.staging.mjs`, e a primeira NFC-e com desconto de cashback em homologação.
- Ordem de deploy: migrations → functions → front, como nos projetos anteriores.
- Checar o que o cancelamento de pedido pago faz hoje com o dinheiro (7.7).

## 20. Decisões que só o João pode tomar

Ordem de importância. Cada uma traz a recomendação.

1. **Quem financia?** Recomendo **a barraca**, sem mexer na taxa de R$ 0,99 nem no split (seção 6). Alternativas B e C exigem repasse por fora do Mercado Pago e dão prejuízo por pedido ao Sai aê.
2. **Cashback entra sozinho para todas as barracas ou só quando o dono liga?** Recomendo **desligado por padrão**, com aviso de compromisso e de contador no ato de ligar, e **saldos já concedidos honrados até vencer** se o dono desligar (7.8).
3. **Percentual e validade padrão:** recomendo **5% e 60 dias**, faixa de 1% a 15% e 30 a 90 dias. É palpite meu; o mercado não dá número único.
4. **Cupom e saldo no mesmo pedido?** Recomendo **um benefício por pedido** (cupom OU saldo), como o cupom já é hoje, e **cashback nunca zera o pedido** (piso de R$ 1,00 nos itens; a taxa Sai aê e a entrega sempre são pagas).
5. **Cashback será vendido como módulo pago** (como fiscal e WhatsApp) **ou incluído no Sai aê?** Recomendo **incluir na V1 sem cobrança** para ter uso real e aprendizado, e decidir preço depois de 8 semanas.
6. **Pedido de total zero por cupom e a taxa de R$ 0,99:** a decisão que ficou "a confirmar". O cashback desta proposta contorna o caso (nunca zera), mas o cupom de 100% ainda pergunta: **cobra a taxa ou não?** Recomendo manter **sem taxa** (como já está implementado), porque o cliente não pagou nada e o Mercado Pago nem é chamado.
