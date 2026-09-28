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
- Identidade visual atual é a IDV "Sai aê" (rebrand fechado em
  2026-09-26, substitui o redesign anterior "Speed Bento POS" de
  2026-09-18 por completo — âmbar/esmeralda saíram). Fonte da
  verdade: `redesign_ux_ui_app/saiae/DESIGN.md`, aplicada em
  `src/styles/tokens.css` (cabeçalho do arquivo aponta pro mesmo
  documento). Paleta: mostarda `#FFC21A` (hover `#FFCA33`, token
  `mesa-orange-*`, nome mantido de propósito pra não precisar tocar
  em cada componente) + tinta `#18171C` (`mesa-neutral-900`) — só
  duas cores de marca, teal/esmeralda saiu do app inteiro. Texto
  sobre mostarda é SEMPRE tinta, nunca branco (mostarda não sustenta
  contraste com branco). "Um primário por tela": só a ação principal
  de cada tela é mostarda, o resto usa tinta/outline/ghost. Cada
  barraca define apenas logo, nome e modo claro/escuro — cor
  primária por barraca continua eliminada, não sugerir customização
  de cor.
- Tema aplicado por CSS custom properties em runtime
  (src/styles/tokens.css) — nenhuma cor escrita direto no componente
- As cores do kanban (verde/amarelo/vermelho) NUNCA são
  personalizáveis — são sinal operacional, realinhadas na IDV Sai aê
  pro mesmo verde/laranja/vermelho das cores operacionais (No
  prazo/Atenção/Atrasado)
- Regra revista no redesign do card de pedido da Cozinha (IDV "Sai
  aê", 2026-09-26): mostarda agora aparece de propósito ali — botão
  de ação principal do card (Pronto/Entregue) e número de quantidade
  de cada item. Antes a regra era "cor de marca nunca aparece na
  Cozinha"; virou "um só acento de marca por card, no botão
  principal", mesmo espírito de "um primário por tela" do Button. As
  cores operacionais do cronômetro (verde/laranja/vermelho do
  cabeçalho do card) continuam não-personalizáveis, sinal
  operacional, nunca mostarda
- Canto balão (`--radius-mesa-balao`, `20px 20px 20px 4px`) é a
  assinatura da marca — 3 cantos arredondados + 1 quase reto, nunca
  um radius uniforme. Escopo alargado em 2026-09-27 (antes só
  toast/senha/tooltip/etiqueta): todo `Badge` e toda etiqueta/selo/
  contador estático do app usa canto balão agora — "Top 1"/"Popular"
  no cardápio e no Lançar Pedido, contador de itens (Cozinha,
  Confirmar Pedido, barra inferior, Dashboard), tag de método de
  pagamento (Histórico), "×N" de quantidade (detalhe da comanda),
  selo de plano ("Mais completo"), pill de status ("Enviado pra
  cozinha", "Gerando a senha..."). Fica de fora — continua pílula
  uniforme (`rounded-mesa-full`) — tudo que é controle interativo ou
  avatar: `Chip` (filtro/segmentado), toggle, radio, barra de
  progresso, avatar/ícone circular, botão de CTA (mesmo quando
  redondo, ex. "Ver pedido"/"Ver nota"/link de navegação) — mesma
  distinção que o site faz (`.chip`/`.cyc button`/`.btn--pill`
  continuam pílula, só badge/tag/selo vira balão).
- Cartões (`Card.tsx` e cartões de produto) usam cantos 20–24px
  (`rounded-mesa-xl`/`2xl`); botões usam `--radius-mesa-btn` (14px,
  `Button.tsx`) — escalas diferentes de
  propósito, não confundir as duas
- Números (preço, senha, contadores) sempre em `font-mesa-display`
  (Outfit) com tabular-nums — a regra tabular entra uma vez em
  `src/index.css` na classe `.font-mesa-display`, não repetida por
  call site. Exceção: o cronômetro/timer chip mm:ss do card de
  pedido da Cozinha (`Cozinha.tsx`, `DetalheComanda.tsx`) usa
  `font-mesa-mono` (JetBrains Mono) — confirmado em 2026-09-27 que o
  site (saiae.com.br) nunca tirou essa fonte, só reduziu a um acento
  técnico pontual (`.timer`, `.step .n`); o app replica o caso do
  timer, que é o único com equivalente na UI do app. Não é uma volta
  geral da Mono — todo o resto continua Outfit.
- Ícones: Material Symbols Rounded, peso 500, preenchido = estado
  ativo (ver `src/components/ui/Icone.tsx`)
- Onboarding (`src/pages/Onboarding.tsx`): carrossel de 4 telas
  mostrado só no primeiro acesso do aparelho (antes do login,
  `Dispatcher.tsx` decide via `onboardingJaVisto()`/localStorage,
  nunca usado pra decidir acesso de verdade). Destaque de
  palavra-chave em títulos = fundo mostarda atrás da palavra
  (componente `Destaque`), mesmo padrão do site saiae.com.br.
- Login (2026-09-27): foto real de uma dona de barraca (feira, banca
  de fruta/verdura, celular na mão) humaniza a tela — acima do
  formulário no mobile, ao lado (não acima) no desktop, mesmo espírito
  do onboarding (foto real em vez de ilustração). Arquivo em
  `public/login/feirante.webp`, comprimido com sharp (1400px de
  largura, qualidade 76 — 213KB, mais leve que o da tela de
  onboarding).
- Sem glow/gradiente atmosférico de fundo (decisão revertida em
  2026-09-27, mesmo dia em que foi documentado como "pronto" aqui):
  o `--mesa-gradient-atmosphere` (glow mostarda/pêssego no canto
  superior direito das telas de entrada/gestão, claro e escuro) e o
  brilho extra do Login foram removidos por completo a pedido do
  dono do produto — via print, ficou claro em uso real que o efeito
  lia como "blur" indesejado no fundo, não como brilho de marca.
  Fundo dessas telas agora é sólido (`bg-mesa-bg-base`). Não
  reintroduzir glow/gradiente atmosférico sem confirmar de novo.
- Tipografia (rebrand "Sai aê", 2026-09-26): Figtree no corpo
  (`font-mesa-sans`), Outfit em h1/h2/h3 e números
  (`font-mesa-display`), carregadas via Google Fonts (index.html) com
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
  Navegação do hub desktop é `src/components/SidebarDesktop.tsx` (painel
  lateral fixo, só `md:` pra cima, substitui a `BarraNavegacao` inferior
  nessas rotas — Lançar Pedido/Cozinha/Chamada continuam só com
  `BarraNavegacao` em qualquer largura). Reorganizado em grupos com
  rótulo em 2026-09-27 (pedido de produto, inspirado num print de
  concorrente): "Operação" (Dashboard), "Gestão" (Histórico,
  Faturamento), "Conta" (Ajustes) — só reagrupou os 4 itens que já
  existiam, sem copiar item novo do concorrente (Mesas/Entregadores/
  Estoque não existem aqui).
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
  uso do app): **implementada** (migration
  `20260922120000_add_assinaturas_kirvano.sql`) — isso é billing SaaS
  Sai aê→cliente, problema completamente diferente do pagamento de
  pedido cliente-final→barraca citado acima, não confundir os dois.
  Trial de 7 dias nasce no cadastro (trigger em `auth.users`, não na
  criação da barraca), 1 trial por e-mail pra sempre (mesmo se a
  conta for excluída e recriada). Fonte da verdade do acesso é
  sempre o banco (`assinatura_tem_acesso()`), nunca o relógio do
  celular nem o retorno do checkout — só o webhook da Kirvano (ou o
  cron de segurança horário) muda o status. Contas cadastradas
  **antes** dessa migration (22/09/2026, inclui a Sabor Kawashima)
  receberam backfill direto pra `active`/`pro` sem data de expiração
  — não passaram pelo trial, ficaram com acesso liberado até alguém
  mudar isso manualmente no banco. Assinatura é por **dono**
  (`usuario_id`), não por barraca — funcionário nunca vê/paga,
  só é liberado/bloqueado pelo status do dono.
  Planos hoje (`src/lib/planos.ts`, cópia local da landing page):
  Essencial R$57,90/mês e Pro R$87,90/mês. As diferenças de feature
  entre os dois eram só texto de marketing até 2026-09-26 — nenhuma
  era aplicada no código. Fechado nessa data: **limite de 1 barraca
  no Essencial** (`criar_barraca`, RPC, bloqueia a 2ª barraca por
  dono no plano Essencial — trial e Pro continuam sem limite, trial
  sempre nasce com `plan='pro'`) e **histórico de 7 dias + sem
  exportar no Essencial** (`Historico.tsx`, só front-end — esconde
  Mês/Período e desabilita o botão Exportar). Ainda **não** aplicado
  de propósito: "Custo do dia, lucro e taxas da maquininha" (feature
  nem existe ainda, ver TODO no topo de `Ajustes.tsx`) e "Senha de
  operador e senha administrativa" — essa por decisão consciente,
  não lacuna: é segurança universal (`GateSenhaAdmin`) em toda
  barraca hoje, gatear por plano tiraria segurança de quem paga
  menos; a copy de marketing está desalinhada da arquitetura, não o
  código.
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
    bug esquecido. **Nota (2026-09-27): esta descrição está
    desatualizada** — Fase 2 (montar pedido) e Fase 3 (pagamento
    Pix via `criar-pagamento-pix`/`webhook-mercadopago`) já foram
    implementadas depois desta entrada e estão em produção quando
    `barracas.pagamento_online_habilitado` está ligado (ver
    `SecaoPagamentoOnline` em Ajustes); o aviso "Em breve" só
    aparece quando esse toggle está desligado. Entrada mantida como
    está por ora — não reescrita retroativamente — só para não
    confundir leitura futura.
  - Topo do cardápio (2026-09-27, referência visual: app de delivery
    estilo KFC, adaptado ao design system Sai aê — mostarda/tinta,
    nunca a paleta vermelho/preto da referência): carrossel de
    banners configurável pelo dono em Ajustes (`SecaoBanners`,
    tabela `banners_cardapio`, imagem sobe pro bucket
    `cardapio-fotos` já existente em `{barraca_id}/banners/...`,
    dados públicos via `banners_publicos(slug)` SECURITY DEFINER,
    mesmo padrão de `cardapio_publico`) — não é conteúdo fixo do
    app. Fileira de categorias com fotinhas circulares da referência
    foi explicitamente descartada — categorias continuam só chips de
    texto (`Chip`), sem foto. Duas seções horizontais acima do
    cardápio filtrável: "Populares" (curadoria manual do dono —
    `itens.popular`, toggle em Ajustes ao lado de "Esgotado" —
    diferente de "Mais pedido", que é algorítmico) e "Mais pedido"
    (já existia como card de destaque único + chip de filtro;
    virou seção de cards horizontais, o chip "Mais Pedidos" saiu da
    lista de filtros por virar redundante com a seção). Filtro de
    categoria por chip default voltou a ser "Todos" (antes priorizava
    "Mais Pedidos" quando havia histórico).
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
Desde o rebrand "Sai aê" (2026-09-26, substitui "Speed Bento POS" de
2026-09-18 por completo): mostarda/tinta/papel + neutros (ver Regras
de tema), Outfit + Figtree, sombras tonais rasas (cards têm borda
nítida de 1px + sombra leve, botões sólidos têm um realce tátil sutil
no topo). Cantos 20–24px em cards, 16px em botões, canto balão em
toasts/etiquetas. Mobile-first — o uso real é em celular, em pé, com
uma mão só — isso não mudou.
