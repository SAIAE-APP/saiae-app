# Especificação: comanda aberta na Mesa, taxa de serviço e nomes dos tipos de pedido

Data: 2026-10-23. Estado: **rascunho para aprovação do João** (nada foi implementado).
Origem: conversa de brainstorming com o João em 2026-10-23. Complementa
`2026-10-08-pagar-depois-e-dividido-design.md` (que deixou Mesa e Balcão fora de escopo) e
`2026-10-08-onboarding-configuracao-design.md`.

## 1. O problema, nas palavras do João

1. **Os nomes dos tipos de pedido confundem o caixa.** Os tipos são Mesa, Balcão, Retirada e Entrega. Quem opera o caixa
   escolhe "Retirada" sem entender que significa "para viagem". A cozinha prepara para comer no local, entrega do jeito
   errado e a última etapa precisa ser refeita. O erro é de nomenclatura, não de dados: o banco já distingue
   "consome no local" de "não consome no local" (`pedidos.viagem`).
2. **O sistema cobra no ato do pedido, mas a maioria dos restaurantes trabalha com comanda aberta na mesa.** O cliente
   pede várias vezes e só paga quando pede para fechar a conta. Hoje cada pedido é independente (senha e
   `metodo_pagamento` próprios) e a Mesa é só um campo de texto. Não existe uma comanda que reúna vários pedidos.
3. **Não existe taxa de serviço (os 10% do garçom)**, que é o costume nesses restaurantes.

## 2. Objetivo, não objetivos e anti-objetivos

**Objetivos**
- O caixa escolhe o tipo certo sem pensar: nomes que dizem o que a cozinha faz e quando se paga.
- Restaurante que trabalha com comanda aberta consegue: abrir uma mesa, adicionar itens em rodadas pelo celular do
  garçom, fechar a comanda no final e registrar a forma de pagamento, com a taxa de serviço opcional.
- O restaurante diz como trabalha no cadastro (assistente de configuração) e o sistema se ajusta.

**Não objetivos (nesta entrega)**
- Login, papel ou área por garçom (decisão do João: um acesso só; muitos clientes não têm processo, e controle por
  pessoa viraria gargalo). Consequência assumida: o app não sabe qual garçom lançou o quê.
- Divisão de conta entre pessoas e pagamento dividido em várias formas (Fase 2 da spec de 2026-10-08, continua
  separada). *Decisão minha; o João liberou rever o que estava fora de escopo mas só pediu a taxa de serviço.*
- Rateio da taxa de serviço por garçom (consequência do ponto acima: o app mostra o total do período e o restaurante
  divide como já faz).
- Processar cartão ou integrar maquininha: o app só **registra** a forma de pagamento, como hoje.
- Mudar Balcão, Para viagem e Entrega: continuam pagando na hora (e Retirada/Entrega mantêm "Pagar depois", já existente).

**Anti-objetivos (seria fracasso mesmo funcionando)**
- Quebrar restaurante que já usa o app: com a opção desligada, o comportamento tem de ser exatamente o de hoje.
- Perder pedido ou duplicá-lo por causa de rede ruim ou duplo toque.
- Adicionar passos ao fluxo do caixa dos clientes que não usam comanda aberta.

## 3. Decisões já tomadas pelo João

1. **Nomes (opção C do mockup):** os botões ficam Mesa, Balcão, Para viagem e Entrega, cada um com uma frase de ajuda
   (ex.: "Comer aqui · conta aberta, paga no fim", "Embalado · paga agora"). Depois de escolher, o caixa vê o que a
   cozinha vai receber (ex.: "PARA VIAGEM (embalar)").
2. **Comanda aberta é configurável por restaurante.** Nem todo restaurante a usa; o restaurante que prefere pagar no
   ato continua assim.
3. **O garçom lança pelo celular.** Quando a mesa já tem comanda aberta, o lançamento oferece
   **"Adicionar à comanda da Mesa X"** (texto do botão a refinar na interface).
4. **Quem fecha e cobra é flexível:** o garçom pelo celular (com maquininha de cartão ao lado) **ou** o caixa, conforme
   o fluxo do cliente.
5. **O assistente de configuração (onboarding) pergunta como o restaurante cobra a Mesa** e configura o sistema de
   acordo.
6. **Um acesso só**, sem área de garçom (ver não objetivos).
7. **Taxa de serviço:** opção por restaurante, **10% como padrão (percentual editável, decisão minha)**, **já marcada
   na hora de fechar a comanda; o garçom ou o caixa pode desmarcar** naquela comanda.

## 4. Decisões minhas (o João pode reverter)

- Rótulo "Retirada" vira "Para viagem" **para o operador** (seletor, card da Cozinha, comanda impressa). No cardápio
  público, o cliente continua vendo "Retirada" ("Você busca no local"), que faz sentido para quem busca o pedido.
  O valor interno `retirada` não muda (constraints, eventos e relatórios intactos).
- A taxa de serviço aparece **à parte** em Histórico, Relatório e Faturamento, nunca somada ao faturamento dos itens
  (mesmo tratamento da taxa de entrega).
- A taxa de serviço só se aplica ao **fechamento de comanda aberta** da Mesa. Mesa que paga na hora, Balcão, Para
  viagem e Entrega não cobram taxa de serviço.
- Os restaurantes existentes não mudam: a comanda aberta nasce desligada.
- Reaproveitar o mecanismo "pagar depois" (`na_entrega`, "A receber", `definir_metodo_pagamento`,
  `corrigir_metodo_pagamento`, `pagamento_depois_habilitado`) como base do fechamento, em vez de inventar outro.

## 5. Decisão do João sobre a NFC-e (2026-10-23)

- **Interruptor configurável por restaurante: "incluir as taxas na NFC-e".** O tratamento fiscal da taxa de serviço
  (gorjeta repassada aos empregados, Lei 13.419/2017) e da taxa de entrega (frete cobrado do cliente, que costuma
  entrar na base do ICMS) varia por estado, município e regime tributário. Por isso a regra não é fixa no produto:
  o contador de cada restaurante decide e o sistema segue.
- **Padrão: desligado (taxas fora da nota)**, o que mantém a decisão de 2026-10-05 para a taxa de entrega e não muda
  nenhum restaurante existente. Ligado, o valor da nota inclui as taxas cobradas.
- Fica para quem for construir: se o interruptor é um só para as duas taxas ou um por taxa, como ele altera
  `emitir-nfce` e `montarCupomFiscal` (hoje somam só os itens) e como o valor da nota continua batendo com a soma das
  formas de pagamento. Sugestão (minha): fazer a nota de comanda de Mesa já respeitando o interruptor e tratar a taxa
  de entrega no mesmo interruptor numa fase separada, para não mexer em emissão que já está em uso.
- **Recomendação ao João:** confirmar o tratamento com um contador antes de ligar o interruptor em qualquer cliente.
  Esta spec não é parecer jurídico nem fiscal.

## 6. O que existe hoje e restrições do projeto

(Conferido no `CLAUDE.md` e em `src/lib/atendimento.ts`, `src/lib/pagarDepois.ts`.)
- Tipos e rótulos em `src/lib/atendimento.ts` (`ROTULO_MODO`, `DESCRICAO_MODO`, `ICONE_MODO`, `faixaImpressao`);
  `modos_atendimento` por barraca em `barracas`; `pedidos.tipo_atendimento` e `pedidos.viagem`.
- "Pagar depois" (Fase 1) já implementado só para Retirada e Entrega (`modoPermitePagarDepois`), atrás de
  `barracas.pagamento_depois_habilitado`. Mesa e Balcão estão explicitamente fora dele hoje.
- `criar_pedido` tem várias versões acumuladas (assinatura com muitos argumentos opcionais; cada versão derruba a
  anterior); fila offline em `useSincronizacao`.
- Caixa soma dinheiro por `metodo_pagamento = 'dinheiro'`; pedido "a receber" nunca entra no faturamento nem no
  caixa; `emitir-nfce` recusa pedido sem forma de pagamento definida.
- Estoque baixa por trigger em `itens_do_pedido` (cada rodada baixa normalmente).
- Assistente de configuração em `src/pages/Configurar.tsx` atrás de `VITE_ONBOARDING_CONFIG`; passos 7 (formas de
  pagamento) e 8 (modos de atendimento) são os candidatos para a pergunta nova.
- Regras invioláveis: lançar pedido e cozinha funcionam offline; enviar pedido é idempotente; nada bloqueia a operação
  esperando rede; áreas de toque de no mínimo 44px; multi-tenant (`barraca_id` em toda tabela); item removido de
  comanda ativa é remoção lógica, nunca DELETE.
- Migrations aditivas e aplicadas antes do deploy do app; mudança nova atrás de interruptor por barraca.

## 7. Critérios de aceite

- Com a comanda aberta **desligada**, nada muda além dos nomes novos dos tipos.
- Os nomes: o operador vê "Para viagem" onde via "Retirada"; a cozinha e a comanda impressa mostram a faixa de
  viagem; relatórios e filtros continuam separando os tipos.
- Com a comanda aberta **ligada**: lançar na Mesa X cria a comanda; novo lançamento na Mesa X oferece "Adicionar à
  comanda"; cada rodada chega à cozinha marcada com a mesa; a lista de mesas mostra mesas abertas e o total parcial;
  fechar soma tudo, aplica a taxa de serviço (marcada por padrão, desmarcável), registra a forma de pagamento e libera
  a mesa. Funciona offline e sem duplicar rodada com duplo toque.
- O assistente de configuração pergunta como a Mesa é cobrada e grava a escolha.
- Pedido de Mesa em aberto nunca entra no faturamento nem no caixa de dinheiro antes de fechar.

## 8. O que fica para quem for construir

- Modelagem da comanda (entidade própria que agrupa pedidos, ou agrupamento de pedidos por mesa e estado).
- Como identificar "a mesma mesa" (hoje é texto livre: "5", "05", "mesa 5") e como evitar duas comandas abertas na
  mesma mesa.
- Senha e chamada por rodada na Cozinha/Chamada (a senha hoje é por pedido).
- Quem pode reabrir ou remover item de comanda aberta/fechada (o fluxo atual exige a senha administrativa para
  corrigir a forma de pagamento; avaliar o mesmo critério).
- Impressão da comanda por rodada e da conta no fechamento.
- Texto final dos botões e da pergunta do assistente; ordem de entrega em fases (nomes primeiro é a sugestão, por ser
  pequeno e independente).
