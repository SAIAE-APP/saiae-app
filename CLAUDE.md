# Sai aê (ex-MesaAgil)

Sistema de comanda digital para barracas de feira e food service.
Primeiro cliente: Sabor Kawashima (comida japonesa). Segundo cliente
em prospecção: restaurante de PF.

## O que o sistema é
Substituto do papel espetado no espeto de ferro. Operador lança o
pedido, a cozinha vê em kanban, o cliente é chamado pela senha.

## O que o sistema NÃO é (hoje)
Não processa pagamento do pedido em comanda — a maquininha do
cliente já faz isso melhor nesse fluxo (operador lança, cozinha
prepara, cliente é chamado). O pagamento tem uma ressalva: ver
"Roadmap de produto" abaixo, já existe uma direção decidida que muda
essa regra mais pra frente.

PDV, controle de estoque e caixa (abertura/fechamento) **deixaram de
ser proibidos** em 2026-09-26 — reversão explícita da regra antiga
("nunca sugira PDV ou controle de estoque"), decisão do dono do
produto depois de ver um concorrente (MesaAgil-para-restaurante)
implementar essas três áreas. Direção nova: separar em duas
superfícies — uma versão **desktop web** completa (estoque, caixa,
faturamento, fiscal, configurações) pro dono da barraca gerenciar, e
a versão **mobile enxuta atual** (lançar/cozinha/chamada) focada só
no operacional de balcão + maquininha. Escopo de estoque e caixa
definido com o dono do produto em 2026-09-26 — ver "Roadmap de
produto".

Impressão de comprovante/nota continua fora de escopo standalone —
decisão revertida em 2026-09-19 (a decisão de 2026-09-17 de
implementar já tinha sido revertida): a primeira versão
(src/lib/impressao.ts, cupom via window.print) foi removida por
completo, junto do botão "Reimprimir último cupom" no Hub e do
disparo automático em Confirmar e enviar/Entregar. Motivo:
impressoras térmicas variam de tamanho (58mm/80mm) e o cupom precisa
de uma aba de configuração de impressora pra escolher isso. Ela
passa a fazer sentido junto do módulo Fiscal (ver Roadmap) em vez de
standalone, já que a NFC-e emitida ali normalmente precisa ser
impressa.

A aba de configuração que faltava foi **implementada em 2026-09-26**
(`SecaoImpressora`, em Ajustes) — habilitar impressora, escolher
largura de papel (58mm/80mm), selecionar impressora Bluetooth já
pareada no Android e "Imprimir teste". Ainda **nenhum botão imprime
cupom de pedido ou nota fiscal de verdade** — só a conexão/teste,
decisão de produto de qual gatilho usar (Fiscal, Comanda, ou os dois)
fica pra depois. Só funciona no app Android instalado, nunca no PWA/
navegador: Web Bluetooth só fala BLE, e a maioria das térmicas
baratas do mercado (Elgin, Bematech, Diebold, genéricas) usa
Bluetooth clássico (SPP), que exige plugin nativo
(`@devlas/capacitor-thermal-printer`, transporte Bluetooth SPP já
validado em hardware real pelo autor). Bytes ESC/POS montados no app
com `@point-of-sale/receipt-printer-encoder` (sucessor não-deprecado
do `esc-pos-encoder`) — o plugin só transporta bytes crus, não
formata nada. Colunas novas em `barracas`: `impressora_habilitada`,
`impressora_endereco`, `impressora_nome`, `impressora_largura_papel`.
Sem raspagem de mercado necessária: só existem dois tamanhos de papel
relevantes no Brasil, 58mm e 80mm, já cobertos.

## Regras de produto
- Senha sequencial por pedido, reinicia todo dia
- Mesa é campo opcional; toggle "Viagem" desabilita a mesa
- Observação existe em DOIS níveis (regra mudou em 2026-09-18,
  decisão do dono do produto): `pedidos.observacao` é o recado geral
  do pedido inteiro (ex.: "cliente com pressa"), e
  `itens_do_pedido.observacao` é específica de um item (ex.: "sem
  cebola") — cada item do carrinho em Lançar Pedido tem seu próprio
  campo de observação, mostrado depois em Confirmar Pedido e Cozinha
  (como alerta de atenção)
- Item do cardápio pode ter foto e descrição (`itens.foto_url`,
  `itens.descricao`) — cadastradas em Ajustes, mostradas em Lançar
  Pedido. Foto sobe pro bucket de Storage `cardapio-fotos` (público
  pra leitura, redimensionada/comprimida no navegador antes do
  upload). Mesmos campos previstos pra reaproveitar no cardápio
  digital do roadmap
- Kanban com 2 colunas: A Fazer e Pronto
- Ordem FIFO: pedido mais antigo no topo
- Cor por tempo desde a entrada do pedido. Congela ao entrar em
  Pronto.
- Em Pronto, botões explícitos "Voltar" e "Entregue"
- Itens podem ser removidos de comanda já lançada por REMOÇÃO
  LÓGICA: a linha permanece no banco marcada como removida, nunca
  DELETE. Exceção confirmada: "Apagar período" em Histórico é uma
  ação de admin pra purgar histórico antigo por completo (DELETE
  físico mesmo) — não é a mesma coisa que remover um item de uma
  comanda ativa, e foi confirmada como intencional pelo dono do
  produto em 2026-09-17.
- Multi-tenant: toda tabela tem barraca_id, toda query filtra por
  ele

## Regras de tema
- Cor de marca é fixa do MesaAgil — desde o redesign "Speed Bento
  POS" (2026-09-18) é âmbar para comando (`mesa-orange-*`, antes
  laranja) e esmeralda para confirmação (`mesa-teal-*`, antes teal).
  Mesmos papéis semânticos de sempre, só a cor mudou — os nomes de
  token (`mesa-orange-*`/`mesa-teal-*`) ficaram os mesmos de
  propósito, pra não precisar tocar em cada componente. Cada barraca
  define apenas logo, nome e modo claro/escuro — cor primária por
  barraca continua eliminada, não sugerir customização de cor.
- Tema aplicado por CSS custom properties em runtime
  (src/styles/tokens.css) — nenhuma cor escrita direto no componente
- As cores do kanban (verde/amarelo/vermelho) NUNCA são
  personalizáveis — são sinal operacional. Realinhadas no redesign
  pras mesmas cores de emerald/amber/red usadas no resto do app
- Regra revista no redesign do card de pedido da Cozinha (IDV "Sai
  aê", 2026-09-26): mostarda agora aparece de propósito ali — botão
  de ação principal do card (Pronto/Entregue) e número de quantidade
  de cada item. Antes a regra era "cor de marca nunca aparece na
  Cozinha"; virou "um só acento de marca por card, no botão
  principal", mesmo espírito de "um primário por tela" do Button. As
  cores operacionais do cronômetro (verde/laranja/vermelho do
  cabeçalho do card) continuam não-personalizáveis, sinal
  operacional, nunca mostarda
- Tipografia (redesign 2026-09-18): Hanken Grotesk no corpo, Space
  Grotesk em h1/h2/h3, carregadas via Google Fonts (index.html) com
  runtimeCaching no service worker pra funcionar offline. Isso
  substitui a referência antiga de "fonte do sistema" — ver Estilo
  abaixo
- Redesign fonte: pasta `redesign_ux_ui_app/` na raiz do projeto tem
  os mockups (.svg) e specs de design (DESIGN.md) que guiam o v3.
  Controle de estoque e atalho de Suprimento/Sangria de caixa
  deixaram de estar banidos em 2026-09-26 (ver "O que o sistema NÃO é
  (hoje)" e "Roadmap de produto") — podem ser usados como referência
  visual quando essas áreas forem implementadas. Leitor de código de
  barras continua sem decisão tomada, não implementar a partir dos
  mockups até isso ser discutido explicitamente

## Roadmap de produto (decidido, mas não é pra agora)
Direção combinada com o dono do produto em 2026-09-17 — não iniciar
nenhum item daqui sozinho, só quando for pedido explicitamente.
- Split desktop/mobile (decidido em 2026-09-26, inspirado num
  concorrente que já lançou "MesaAgil pra restaurante" com essas
  áreas): mobile continua enxuto — só lançar pedido, cozinha, chamada
  de senha e ajustes básicos, "mais ou menos o que temos hoje".
  Faturamento/Relatório sai do Histórico mobile e vira exclusivo de
  uma versão **desktop web** nova, que também reúne Estoque, Caixa e
  Fiscal. Decisão de arquitetura confirmada em 2026-09-26: estender o
  mesmo app React/Supabase com uma rota nova (`/:slug/desktop`, hub
  desktop-only), não criar um segundo app. Diferente do padrão de
  Cozinha.tsx (mesma rota, mobile vira abas/desktop vira grid): aqui a
  rota em si só existe de fato em telas largas — em mobile mostra um
  aviso "abra num desktop" (conteúdo de tabela/gráfico não foi
  desenhado pra caber ali). Implementado em `src/pages/Desktop.tsx`,
  com o painel de Faturamento/Relatório (`PainelRelatorio`) movido de
  dentro do Histórico pra lá; a lista de comandas continua em
  `/:slug/historico` no mobile. Item "Faturamento" na
  `BarraNavegacao` some em telas estreitas (`apenasDesktop`). Caixa já
  implementado nesse hub também (abrir/fechar com conferência
  automática e sangria/suprimento, `src/components/SecaoCaixa.tsx`).
  - Fiscal / NFC-e: em vez de integração direta com a SEFAZ (que foi
    o motivo original de tirar isso de escopo), usar um provedor
    fiscal-as-a-service (ex.: FocusNFe, como o concorrente fez) — o
    dono da barraca cria a própria conta no provedor, sobe o
    certificado digital lá (custódia fica com o provedor, nunca com o
    Sai aê). Pesquisa na documentação real da FocusNFe (2026-09-26)
    confirmou que o CSC não entra nas chamadas de emissão — só o
    **token** da empresa precisa ser colado nas configurações do
    Sai aê. Regimes tributários alvo: Simples Nacional (regime do
    primeiro cliente, Sabor Kawashima) **e MEI**, comum entre donos de
    barraca de feira. **Configuração implementada** em Ajustes
    (`SecaoFiscal`): token guardado em `barracas_fiscal_token` (RLS
    sem policy de select, só via função SECURITY DEFINER — mesmo
    padrão de `barracas_senha_admin`/PIN admin), regime, ambiente
    (Homologação/Produção, default Homologação) e campos NCM/CFOP/
    unidade por item do cardápio. **Emissão de verdade implementada e
    no ar** (2026-09-26): Edge Function `emitir-nfce` (deployada via
    `supabase functions deploy`, usa a service role key, nunca a
    anon) valida fiscal habilitado → CNPJ → token → itens com NCM/
    CFOP/unidade → forma de pagamento suportada, monta o payload
    (idempotente por `pedido_id` como `ref`) e chama a FocusNFe,
    respeitando sempre `barraca.fiscal_ambiente` (nunca força
    produção). Tabela de forma de pagamento confirmada na doc real
    da FocusNFe, incluindo Pix = código 17 (Nota Técnica 2020.006).
    Grava resultado em `pedidos.nfce_*` (nova coluna `barracas.cnpj`
    também, gap descoberto na implementação — campo obrigatório no
    payload que não existia em lugar nenhum do schema). Botão "Emitir
    nota fiscal" em `CardHistorico` (Histórico). Testado com uma
    chamada de smoke test (pedido inexistente, retornou erro
    esperado) — **nenhuma nota foi emitida de verdade ainda**, uso
    real por uma barraca ainda não validado ponta a ponta.
  - Estoque: item mais delicado por reverter a regra mais antiga do
    projeto. **Implementado** o mais simples definido em 2026-09-26 —
    toggle "esgotado" por item (`itens.esgotado`, editável em Ajustes,
    Lançar Pedido bloqueia adicionar item esgotado) — em vez de
    controle completo com baixa automática por venda.
  - WhatsApp pra leads (o concorrente tem, manda mensagem automática
    pro cliente): fora de escopo por enquanto, avaliar depois que o
    resto acima estiver de pé.
- Cadastro self-service e múltiplas barracas por conta: já
  implementado (v2) — qualquer usuário autenticado pode criar sua
  própria barraca e trocar entre as que tem acesso.
- Impressão de comprovante/nota: removida de novo, aguardando a aba
  de configuração de impressora térmica (varia por tamanho) — ver "O
  que o sistema NÃO é (hoje)" no topo deste arquivo.
- Cobrança de assinatura do Sai aê (o dono da barraca paga pelo
  uso do app): só depois que o produto estiver 100% pronto/estável.
  Isso é billing SaaS Sai aê→cliente, problema completamente
  diferente do pagamento de pedido cliente-final→barraca citado
  acima — não misturar os dois ao planejar.
- Cardápio Digital: tela pública (fora do app, sem login, um link
  por barraca — `/:slug/cardapio`) onde o cliente final navega o
  cardápio da mesa — usa os mesmos itens.foto_url/descricao já
  cadastrados em Ajustes. Botão "Compartilhar cardápio" em Ajustes
  (dentro de Identidade da barraca) copia/compartilha esse link.
  Dados vêm da função `cardapio_publico(slug)` (SECURITY DEFINER,
  liberada pra `anon`) em vez de abrir RLS pública em `barracas` —
  essa tabela carrega taxa_debito_bps/taxa_credito_bps, dado privado
  do dono, que não pode vazar pra quem só está vendo o cardápio.
  Em construção em fases, por decisão do dono do produto em
  2026-09-18:
  - Fase 1 (implementada em 2026-09-21): só navegação/visualização
    do cardápio. O botão de adicionar item mostra um aviso "Em
    breve" e não tem função de verdade ainda — de propósito, não é
    bug esquecido.
  - Fase 2 (futura): cliente monta pedido e ele cai direto na
    Cozinha, mas o pagamento continua fora do app (maquininha/Pix na
    mesa, como já funciona hoje) — só tira a fila de atendimento,
    não mexe em pagamento ainda.
  - Fase 3 (futura): integração de pagamento online — só depois de
    confirmado o pagamento o pedido vai pra cozinha. Essa fase VAI
    exigir processar pagamento de pedido, contradizendo a regra "não
    processa pagamento" acima — intencional, decisão consciente do
    dono do produto, não um erro a corrigir de volta quando chegar a
    vez de implementar.

## Regras técnicas invioláveis
- Telas de lançar pedido e cozinha funcionam offline
- Enviar pedido é idempotente (duplo toque não cria dois pedidos)
- Nada bloqueia a operação esperando rede
- Áreas de toque de no mínimo 44px

## Stack
React + Vite + TypeScript, Tailwind CSS v4 (configuração via @theme
block no CSS, não há tailwind.config.js), Supabase (Postgres, Auth,
Realtime), deploy em Cloudflare Pages.

## Estilo
Desde o redesign "Speed Bento POS" (2026-09-18): âmbar/esmeralda/
slate, Hanken Grotesk + Space Grotesk (ver Regras de tema), sombras
tonais rasas (não mais "quase imperceptíveis" — cards têm borda
nítida de 1px + sombra leve, botões sólidos têm um realce tátil sutil
no topo). Cantos ~16px continuam. Mobile-first — o uso real é em
celular, em pé, com uma mão só — isso não mudou.
