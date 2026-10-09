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
pareada no Android e "Imprimir teste". Os gatilhos vieram depois: comanda
automática + botão na Cozinha, e cupom fiscal no Histórico (ver abaixo).
Só funciona no app Android instalado, nunca no PWA/
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

**Gatilho da comanda decidido** (pedido do João, 2026-09-29): com a
impressora habilitada e um dispositivo configurado, a **comanda de
cozinha é impressa automaticamente** quando o pedido enviado no aparelho
recebe a senha do servidor (`useImpressaoAutomatica`, em LayoutBarraca,
ouve `aoCriarPedidoLocal` emitido por `useSincronizacao`). Imprime na
sincronização, não no toque, porque a senha só existe depois do sync —
offline imprime quando a fila sobe, nunca com senha provisória. Roda em
segundo plano (não bloqueia o envio); falha vira toast tocável
"Reimprimir" com a causa técnica do plugin; idempotente por
`client_uuid` (localStorage + Set em memória). Pedido 100% entrega
direta não imprime (não passa pela cozinha). Texto sai sem acento
(`semAcento`): térmicas genéricas não têm a codepage e imprimiam "?".
Revisão 2026-09-29 (a automática não imprimiu no aparelho do primeiro
cliente, causa não reproduzida): a config da impressora é relida do
servidor na hora de imprimir quando a barraca em memória/cache não tem
impressora pronta, o ouvinte é registrado uma vez só (toast via ref), e
o disparo agora é VISÍVEL — toast "Imprimindo comanda N...", depois
"impressa" ou erro com causa; impressora habilitada sem dispositivo
também avisa, nunca desiste em silêncio. Botão manual **"Imprimir
comanda"** no card da Cozinha (só Android com impressora pronta, sem
mostarda, `dadosComandaDoPedido`) serve de reimpressão/fallback — e é
por ele que pedidos do cardápio digital (Pix) podem ser impressos hoje.
**Pedidos do cardápio digital (Pix) JÁ imprimem sozinhos** (revisado
2026-10-06): `useImpressaoAutomatica` tem dois caminhos — (a) pedido criado
neste aparelho, ao receber a senha; (b) pedido novo que chega pelo Realtime
(INSERT em `pedidos`), que cobre cardápio/Pix. UMA via por APARELHO (Sprint 6, 2026-10-07, PR #26): cada aparelho com
impressora habilitada imprime a sua via de cada pedido, uma vez só; com 2
aparelhos ligados saem 2 vias. NÃO existe mais trava global entre aparelhos:
`reivindicar_impressao_comanda` virou só telemetria (grava
`pedidos.comanda_impressa_em` depois de imprimir, resposta ignorada; a RPC e a
coluna continuam no banco). A idempotência é POR APARELHO, pelo id E pelo
`client_uuid` do pedido (Set em memória + localStorage), então o caminho (a),
o Realtime (b) e reconexões nunca imprimem duas vezes no mesmo aparelho. Os
dois celulares do cliente dividem a MESMA impressora Bluetooth (SPP aceita uma
conexão por vez): erro de conexão/ocupada tenta de novo até 4 vezes, esperando
1–3 s aleatórios (`src/lib/politicaImpressao.ts`, testes em `npm test`) antes
do toast "Toque para reimprimir"; vale também para o botão manual da Cozinha.
RISCO NÃO VALIDADO EM APARELHO: se o plugin mantiver o socket aberto depois de
imprimir, o 2º celular falha mesmo com as retentativas (a correção seria o
plugin desconectar após cada impressão). Plugin só fala SPP clássico;
impressoras só-BLE não são suportadas.
A COMANDA impressa (não fiscal) também leva o rodapé "PROCON 151" + "Sede:
<barracas.procon_endereco>" (sem toggle; sem endereço cadastrado sai só o 151),
por exigência da autuação do PROCON (decisão do João, 2026-10-07, PR #37): o
cliente imprime a comanda, não só o cupom fiscal. Texto sem acento, quebrado na
largura do papel (32 colunas no 58mm, 48 no 80mm) em `src/lib/rodapeProcon.ts`,
usado também pelo cupom fiscal. A impressão automática relê a barraca do
servidor se o cache não tiver `procon_endereco` (`carregarConfigImpressora`).

**Fichas antigas (2026-10-04, relato do cliente: aparelho antigo imprimiu
senha 32 estando na 50):** causa mais provável era operação velha da fila
(`criar_pedido` reexecutado, servidor devolve a senha antiga por
idempotência de `client_uuid`) disparando a impressão automática. Agora a
impressão automática só roda se o pedido foi ENVIADO há menos de 5 min
(`PedidoCriadoLocal.enviadoEm` = `op.criadoEm`); mais velho que isso não
imprime sozinho, marca como tratado e mostra aviso tocável "Toque para
imprimir" (nunca em silêncio). É hipótese, não foi reproduzida nem testada
no aparelho.

**Android / Bluetooth (2026-10-04; atualizado em 2026-10-07).** O repo já
tem, em `main`, `minSdkVersion = 24` (não dá pra descer: o Cordova que o
`@capacitor/android` 8 traz exige 24), permissões `BLUETOOTH`/
`BLUETOOTH_ADMIN` (até o Android 11) e `BLUETOOTH_CONNECT` no manifest, e o
patch do plugin térmico (`patches/@devlas+capacitor-thermal-printer+0.8.0.patch`,
`bluetoothConcedido()`: antes do Android 12 conta como concedido — sem isso
`list`/`print` davam sempre `permission_denied` em Android 7–11). Decisão do
dono do produto (2026-10-05): o APK/AAB em produção ficou como estava até a
build 1.9. **Build 1.9 (2026-10-07)**: `versionName 1.9`; o `.aab` versionCode 11
abriu em TELA BRANCA e foi descartado; o versionCode 12 corrigiu e abre
(teste fechado na Play Console). A impressão por aparelho e o Bluetooth em
Android 7–11 e 12+ continuam SEM validação em aparelho.

**Build Android: o `.env` de produção é obrigatório (PR #35).** O Vite grava
`VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` dentro do JS no momento do build e
`src/lib/supabase.ts` lança erro ao carregar se faltarem: um build numa cópia
limpa do `main` (sem `.env`, que não vai pro git) gera um app que abre em tela
branca. `npm run android:sync` agora roda `scripts/verificar-env-build.mjs` e
aborta se a URL (`https://<ref>.supabase.co`) ou a chave faltarem. Para gerar
o `.aab`: copiar o env de PRODUÇÃO para `.env.local` na pasta do build (o
projeto de produção é `vimjwzumjggrlvlxdejr`; cuidado com env antigo apontando
para outro projeto), `npm run android:sync`, conferir que `dist/assets/index-*.js`
contém a URL de produção, e `gradlew bundleRelease` assinado com a MESMA chave
de upload da Play (`keystore.properties` fora do git). A Play não aceita
repetir `versionCode`: subir a cada build. Validar em aparelho Android 7–11 e
12+ antes de liberar ao cliente.

## Regras de produto
- Senha sequencial por pedido, reinicia todo dia
- Tipo de atendimento (2026-10-04, backlog PDV Sprint 2): Mesa, Balcão,
  Retirada (antigo "Viagem") e Entrega, ligados/desligados por barraca em
  Ajustes > Cardápio & Operação (`barracas.modos_atendimento`, ao menos um
  ativo, padrão Mesa+Balcão+Retirada = o que existia). Lançar Pedido mostra
  só os ativos (um só = sem seletor). `pedidos.tipo_atendimento` é o dado
  novo; `pedidos.viagem` continua e significa "não consome no local"
  (Retirada OU Entrega), então relatórios/Cozinha antigos seguem valendo —
  Relatório/Faturamento e Histórico (2026-10-05) já SEPARAM Retirada de
  Entrega ("Tipo de atendimento", filtros e coluna "Tipo" na planilha).
  Cardápio digital PÚBLICO (2026-10-07, PR #38): só oferece Retirada e Entrega ao
  consumidor (Mesa/Balcão saíram da UI pública; o servidor segue aceitando os
  tipos antigos). Respeita o que a barraca ligou: Retirada se ligada; Entrega se
  ligada E finalizável (WhatsApp do dono ou pagamento online); nenhum dos dois =>
  Retirada (`modosDoCardapioPublico`). Com 2 modos aparece o bloco grande
  "Como você quer receber?" no topo (`EscolhaModo`); com 1 só, o resumo do
  carrinho mostra "Só entrega"/"Só retirada".
  `tipo_atendimento` NULL (pedido antigo, cardápio digital) é
  derivado de mesa/viagem (`tipoDoPedido`, `src/lib/atendimento.ts`).
  Cardápio digital público (2026-10-05) só oferece os modos que a barraca
  ligou (Entrega com endereço e taxa por bairro desde 2026-10-07, ver "Taxa por
  bairro e Entrega no cardápio"): `cardapio_publico` devolve
  `barraca_modos_atendimento` e `modosDoCardapioPublico` trata resposta
  antiga ou barraca só com Entrega como modos padrão.
  Comanda impressa traz `*** RETIRADA ***`/`*** ENTREGA ***` em 2x logo
  abaixo da senha. Mesa só pede número no modo Mesa. A migration
  `20261004120000_modos_atendimento.sql` PRECISA estar aplicada antes do
  deploy do app: o front manda `p_tipo_atendimento` no `criar_pedido`.
- Lançar Pedido: chip "Mais pedidos" removido (2026-10-04); "Todos" agrupa os
  itens por categoria com o nome como cabeçalho de seção. O selo "Top N"
  nos cards continua.
- Entrega (2026-10-04, backlog PDV Sprint 3): no modo Entrega,
  Confirmar Pedido pede nome, telefone, rua, número e bairro (referência
  opcional) — `FormularioEntrega`, obrigatórios validados em
  `validarDadosEntrega` (`src/lib/entrega.ts`). Os dados ficam COPIADOS no
  pedido (`pedidos.entrega_*`), não só referenciados: apagar o cadastro do
  cliente não muda comanda antiga. Pedido de Entrega NUNCA é "entregar
  direto no balcão" (checkbox e botão somem, e a marcação herdada é
  ignorada no envio): precisa passar pela cozinha e imprimir comanda.
  Na tela da senha, "Chamar entregador" (`ChamarEntregador`, em
  `LancarPedido.tsx`) abre `https://wa.me/?text=` SEM número, o operador
  escolhe o contato; sem integração com API do WhatsApp, com aviso se não
  abrir e "Copiar mensagem". A comanda impressa leva faixa `*** ENTREGA ***`,
  bloco "ENTREGAR PARA" (nome, telefone, endereço) e a linha "Taxa de
  entrega" separada do total.
- Taxa de entrega (2026-10-04): cobrada do cliente final, entra no total do
  pedido (`pedidos.taxa_entrega_centavos`). Configurável em Ajustes
  (`SecaoTaxaEntrega`: liga/desliga, valor padrão, editável ou não no
  pedido; `barracas.taxa_entrega_*`, desligada por padrão). Sem controle do
  que se paga ao motoboy (fora do escopo). Taxa padrão por barraca + taxa por BAIRRO (2026-10-07, ver "Taxa por bairro e
  Entrega no cardápio"); por distância não existe.
  **Decisão do dono do produto (2026-10-05): a taxa fica POR FORA da
  NFC-e** — não entra em `emitir-nfce` nem em `montarCupomFiscal`, de
  propósito. Consequência assumida: nota de pedido com entrega sai com
  valor menor que o cobrado. Relatório/Faturamento e Histórico mostram a
  taxa À PARTE (linha "Taxas de entrega", coluna na planilha, linha no
  card), nunca somada aos valores dos itens nem ao faturamento.
- Link do entregador (2026-10-06, migration `20261006150000`): pedido de
  Entrega nasce com `pedidos.entrega_token` (64 hex, gerado por trigger no
  servidor; NULL nos antigos) e `entrega_confirmada_em`. Rota pública
  `/e/:token` (`Entregador.tsx`, fora do layout da barraca, sem login): o
  motoboy vê cliente/telefone/endereço/itens/taxa/total, escolhe como o
  cliente pagou (dinheiro/Pix/débito/crédito, SEM troco) e confirma. O link é montado por `urlPublica` (`src/lib/linkEntregador.ts`, PR #36): no app Android nativo `window.location.origin` é `https://localhost`, então NUNCA monte link público com origin (use `urlPublica`: no nativo vira `VITE_PUBLIC_APP_URL` ou https://app.saiae.com.br). RPCs
  SECURITY DEFINER liberadas pra `anon`: `entregador_pedido(p_token)` e
  `entregador_confirmar(p_token, p_metodo)`, que devolvem `estado` (ok,
  ja_confirmado, cancelado, expirado, invalido, bloqueado...). O método só
  é gravado quando o pedido está em `na_entrega` (cardápio digital); qualquer
  outro método já definido não muda. Confirmar é idempotente e grava status
  `entregue`, `entregue_em` e `entrega_confirmada_em` (Realtime leva ao app;
  Histórico/Relatório/Caixa já contam `metodo_pagamento`). Link expira ao
  confirmar ou 24h após criar o pedido; token inválido repetido (20/10min
  por IP) bloqueia. Operador: "Enviar link ao entregador" (WhatsApp sem
  número) + "Copiar link" na tela da senha, no card da Cozinha e no do
  Histórico (`BotoesLinkEntregador`, só com token). Política de Privacidade
  (seção 4) descreve o link.
- Taxa por bairro e Entrega no cardápio (2026-10-07, Sprint 2 Story 1,
  migration `20261007120000`): tabela `taxas_entrega_bairro` (bairro,
  `bairro_normalizado` por trigger via `normalizar_bairro`: minúsculo, sem
  acento, espaços colapsados; único por barraca; RLS como `categorias`) e
  `barracas.entrega_bairro_nao_listado` ('taxa_padrao' = padrão | 'bloquear').
  Regra única, no SQL `taxa_entrega_do_bairro(p_barraca_id, p_bairro)` →
  (`permitido`, `taxa_centavos`, `origem`: bairro | padrao | bloqueado |
  sem_taxa), executável só pelas edge functions; espelhada no front em
  `src/lib/bairros.ts` (`taxaDoBairro`, só preview — o servidor SEMPRE
  recalcula). Bairro ativo cadastrado vale mesmo com a taxa padrão desligada.
  `bairros_entrega_publicos(slug)` (anon) devolve os bairros ativos + política
  + taxa padrão (uma linha com bairro NULL se não há bairros). Ajustes:
  `SecaoBairrosEntrega` (um por um, "Colar lista" `Bairro; 5,00`, ativar,
  remover, regra do bairro não listado, tudo por botão). App do operador:
  bairro do `FormularioEntrega` sugere os cadastrados (pode digitar outro), a
  taxa preenche pelo bairro e segue editável se `taxa_entrega_editavel`; lista
  em cache no aparelho (`useBairrosEntrega`), sem lista = taxa padrão; o
  operador NUNCA é bloqueado (bairro "bloqueado" só avisa). Cardápio público:
  modo Entrega aparece se a barraca ligou Entrega E ("Pagar na entrega" ou
  pagamento online); formulário com nome, telefone, rua, número, bairro,
  referência, consentimento LGPD e resumo itens + taxa = total; finaliza só
  por "Pagar na entrega" (Pix com Entrega = "em breve", Story 2: nunca gerar
  Pix sem a taxa). `criar-pedido-cardapio` aceita `entrega` estruturada
  (+ `consentimento_lgpd`), calcula a taxa no servidor, bairro bloqueado =
  422 "Não entregamos nesse bairro.", passa `p_entrega`/`p_taxa_entrega_centavos`
  ao `criar_pedido` e faz upsert best-effort em `clientes_finais`
  (`origem='cardapio'`, `consentimento_lgpd_em`). Sem `entrega` segue o modo
  antigo (nome/telefone/endereço livre). A taxa continua FORA da NFC-e.
- Bairros no cardápio público (correção 2026-10-09): a lista de bairros é buscada
  de novo sempre que o checkout ou o formulário de Entrega abrem, o modo muda, a
  aba volta ao foco e no "Tentar de novo" (antes só no load, e ficava velha se o dono
  cadastrasse o bairro com a aba aberta: o campo caía em texto livre com a taxa
  padrão). Falha ao buscar não é mais silenciosa (console.warn + aviso "valor final
  confirmado ao enviar"). O "Pagar na entrega" estruturado agora manda
  `total_esperado_centavos` e o servidor devolve 409 com o novo total se a taxa
  divergir (Pix já fazia); a prévia passa a usar o valor do servidor. Regras puras de
  bairro em `src/lib/bairrosTaxa.ts` (testadas em `tests/bairros.test.ts`, `npm test`).
- Provedores de Pix (2026-10-09, Sprint 5 Story A, migration
  `20261009120000`): o Pix online passa por uma interface `ProvedorPix`
  (`supabase/functions/_shared/pagamento/`: `tipos.ts`, `registro.ts`,
  `token.ts`, um arquivo por provedor, hoje só `mercadopago.ts`) usada por
  `criar-pagamento-pix` e `webhook-mercadopago`. NENHUM comportamento do
  Mercado Pago mudou; só foi movido pra trás da interface. Provedor da barraca
  = `barracas.pagamento_provedor` (padrão 'mercadopago', CHECK em mercadopago,
  pagbank, asaas, woovi, abacatepay); a cobrança grava o provedor em
  `pagamentos_pendentes.provedor`, então trocar depois não afeta cobranças já
  emitidas. Token: `barracas_pagamento_token` agora é (barraca_id, provedor)
  com PK composta; as linhas do Mercado Pago migram sozinhas (default), as RPCs
  `definir_token_pagamento`/`token_pagamento_configurado` ganharam
  `p_provedor` com default 'mercadopago' (chamada antiga continua valendo) e o
  token continua sem policy de select. O webhook segue UM endpoint
  (`webhook-mercadopago`, nome histórico mantido de propósito: URLs já emitidas
  apontam pra ele; sem alias novo pra não precisar de outro deploy): a URL de
  notificação agora é `?pendente=<id>&p=<provedor>` e, SEM `p`, vale Mercado
  Pago. O webhook usa o provedor da URL, exige que seja o do pendente, consulta o
  provedor de volta com o token da barraca, confere referência (id do
  pendente) e valor em centavos inteiros = itens + taxa do snapshot, e só então
  chama `criar_pedido` (idempotente por `client_uuid`). Erro de rede até o
  provedor devolve 500 (ele reenvia); resposta de erro do provedor devolve 200.
  A coluna `mercadopago_order_id` guarda o id externo de QUALQUER provedor
  (nome histórico). As functions leem `pagamento_provedor`/`provedor` de forma
  tolerante (linha sem a coluna = Mercado Pago), então subir antes da migration
  não quebra. Ajustes (`SecaoPagamentoOnline`) lê o provedor de
  `src/lib/provedoresPix.ts`: só o Mercado Pago está publicado (seletor
  aparece sozinho quando houver mais de um); PagBank, Asaas e Woovi vêm nas
  próximas stories, uma por PR. Testes das funções puras (status, centavos,
  notificação, token):
  `node --experimental-strip-types supabase/functions/_shared/pagamento/pagamento.test.ts`.
- Avisar cliente "pedido pronto" (2026-10-08, Sprint 3, migration
  `20261008120000`): campo OPCIONAL "WhatsApp do cliente" em Confirmar Pedido
  (Mesa/Balcão/Retirada; na Entrega vale o telefone do formulário) e no
  checkout Pix do cardápio (fora da Entrega). `pedidos.cliente_telefone`
  (só dígitos, sem o 55; CHECK 8–15 + trigger que normaliza/zera o inválido)
  e `cliente_avisado_em`; `criar_pedido` v8 = v7 + `p_cliente_telefone` (12
  args, o 12º com default); `pagamentos_pendentes.cliente_telefone` guarda o
  snapshot do Pix e o webhook só repassa o arg quando existe (pedido sem
  telefone = chamada idêntica à de antes). Sem a v8 no banco a fila reenvia sem
  o telefone (PGRST202). Botão "Avisar cliente" (`BotaoAvisarCliente`) só com
  telefone (`telefoneDoCliente`: `cliente_telefone` ou `entrega_telefone`),
  pedido PRONTO e o aviso ligado: no card da coluna Pronto e no Histórico;
  abre `wa.me/55<tel>?text=` (sem API, o operador toca em enviar), grava
  `cliente_avisado_em` pela fila (best-effort, nunca bloqueia) e mostra
  "Avisado às HH:MM" (dá pra avisar de novo). Mensagens por barraca em Ajustes
  (`SecaoAvisoPronto`: `msg_pedido_pronto`, `msg_pedido_pronto_entrega`,
  `aviso_pronto_habilitado`; variáveis {nome} {senha} {barraca}, variável sem
  valor some da frase). LGPD: o telefone serve SÓ pra esse aviso, NÃO alimenta
  `clientes_finais` nem o export de prospecção; a comanda não o imprime.
  `criar-pedido-cardapio` (só Entrega) não mudou: o telefone dali já é o da
  entrega.
- Exportar clientes de entrega (2026-10-07, Story 3, migration
  `20261007140000`): botão "Exportar" em `SecaoClientesEntrega` (XLSX via
  `exceljs` por import dinâmico, ou CSV UTF-8 com BOM e `;`), mesma regra de
  plano do Histórico (Essencial desabilitado; trial e Pro liberam). Colunas:
  nome, telefone (formatado e só dígitos), endereço, nº de pedidos, último
  pedido, ticket médio dos itens (sem a taxa), origem, cadastro e "aceita
  contato comercial" (`src/lib/exportarClientes.ts`: 2 consultas paginadas,
  sem N+1; pedido cancelado não conta). LGPD: o consentimento de cadastro
  cobre só a entrega; contato comercial é um checkbox OPCIONAL e separado
  no formulário de Entrega do cardápio (`clientes_finais.consentimento_marketing_em`,
  gravado por `criar-pedido-cardapio` só quando marcado; NULL = "não
  informado" para cadastros antigos e do operador). O export padrão inclui só
  quem aceitou; "todos" mostra aviso de LGPD. Células que começam com = + - @
  recebem apóstrofo (sem injeção de fórmula). O app não envia mensagem em massa.
  Política de Privacidade (seção 4) descreve finalidade, revogação e exclusão.
- Importar clientes de entrega (2026-10-07, PR #39, migration
  `20261012100000_importar_clientes_finais.sql`): botão "Importar" em
  `SecaoClientesEntrega` (`ImportarClientesSheet`; .csv/.xlsx, mesmo formato do
  export, 1ª aba; prévia com erros por linha; máx. 2000 linhas e 5 MB; lotes de
  200). RPC `importar_clientes_finais(p_barraca_id, p_clientes, p_marketing)`,
  SECURITY DEFINER, só `authenticated` com `usuario_tem_acesso_barraca` (anon sem
  execute); estados `ok`, `nao_autenticado`, `sem_acesso`, `dados_invalidos`,
  `lote_grande` (>500 por chamada). Telefone normalizado (só dígitos, sem o 55,
  10–15 dígitos), nome vazio/telefone inválido = linha ignorada, telefone repetido
  no lote vale a 1ª ocorrência. DEDUPE por (barraca, telefone): cliente existente
  NUNCA é sobrescrito, só completa campos VAZIOS; repetir o lote é idempotente
  (0 inseridos/0 atualizados). Validado no banco real com rollback. LGPD: checkbox
  OBRIGATÓRIO de autorização do dono; contatos novos entram com origem
  'importacao' e SEM consentimento de marketing, salvo 2º checkbox (grava
  `consentimento_marketing_em` só nas linhas NOVAS, nunca altera cadastro
  existente); `consentimento_lgpd_em` fica NULL (é do próprio cliente, a
  importação não inventa). Funções puras em `src/lib/importarClientes.ts`.
- Clientes de entrega (2026-10-04): tabela `clientes_finais` (um endereço
  por cliente, único por `barraca_id`+`telefone`, RLS por
  `usuario_tem_acesso_barraca` com WITH CHECK). Salvo/atualizado em segundo
  plano pela fila de sincronização DEPOIS do `criar_pedido` confirmar
  (nunca bloqueia o envio; falha só vai pro console). Busca por telefone ou
  nome no formulário de entrega (`useBuscaClienteFinal`). LGPD: o dono vê e
  EXCLUI o cadastro em Ajustes > Cardápio & Operação > "Clientes de entrega"
  (`SecaoClientesEntrega`, só aparece com Entrega ligada ou cliente já
  salvo); excluir apaga o cadastro, não os pedidos antigos (só "Apagar
  período" ou excluir a barraca). Política de Privacidade (seção 4) e
  Excluir conta já descrevem isso. Telefone guardado só com dígitos e SEM o
  55 do país (`normalizarTelefone`: tira o 55 só com 12/13 dígitos, porque
  com 10/11 o 55 é o DDD de Santa Maria/RS), no app e por trigger no banco.
- Nome do cliente (2026-10-06): campo OPCIONAL "Nome do cliente" em
  Confirmar Pedido nos modos Mesa/Balcão/Retirada (na Entrega vale o nome
  do formulário). `pedidos.cliente_nome` (nullable); aparece na comanda
  impressa (`Cliente: ...`), card da Cozinha/Detalhe, Chamada, Histórico
  (e na busca). `nomeDoCliente` (`src/lib/atendimento.ts`) cai em
  `entrega_nome` p/ pedido de Entrega da v6. `criar_pedido` v7 (migration
  `20261006120000`) = v6 + `p_cliente_nome text default null` (11 args,
  chamada antiga de 10 resolve pelo default); sem a v7 no banco a fila
  reenvia sem o nome (PGRST202), nunca trava.
- `criar_pedido` está na v6 (migration `20261004140000`): 10 args, os 3
  últimos opcionais (`p_tipo_atendimento`, `p_entrega`,
  `p_taxa_entrega_centavos`) — a v7 acima só soma o 11º. Cada versão derruba a assinatura anterior pra
  não ficar sobrecarga ambígua; arquivo-fonte em
  `supabase/functions/criar_pedido.sql`. Fila (`useSincronizacao`): se o
  banco não conhece os args novos (PGRST202), pedido comum reenvia sem eles,
  e pedido de Entrega fica ADIADO na fila (`OperacaoAdiadaError`) sem travar
  os outros — não entra sem endereço/taxa.
- "Pagar na entrega" lançado pelo operador (2026-10-07, PR #23): no modo
  Entrega, Confirmar Pedido ganha a opção "Pagar na entrega"
  (`metodo_pagamento = 'na_entrega'`); fora da Entrega ela não existe. A forma
  real (dinheiro/débito/crédito/Pix) é definida depois, pelo entregador no link
  (`entregador_confirmar`) ou pelo operador (próximo item). Sem migration (o
  CHECK `pedidos_metodo_pagamento_check` aceita `na_entrega` desde a migration
  `20261006160000`). Relatório/Faturamento mostram linha própria "A definir
  na entrega"; o Caixa só soma `metodo_pagamento = 'dinheiro'`, então pedido
  "a definir" NÃO entra como dinheiro no caixa. `emitir-nfce` recusa pedido
  "a definir": só emitir depois de definir a forma.
- Definir a forma de pagamento (2026-10-07, PR #25, migration
  `20261010100000_definir_metodo_pagamento.sql`): botão "Definir forma de
  pagamento" no card do Histórico para pedido "A definir na entrega" (entregador
  que não abriu o link, ou link expirado em 24 h). RPC SECURITY DEFINER
  `definir_metodo_pagamento(p_pedido_id, p_metodo)`, só `authenticated`
  (anon sem acesso), exige `usuario_tem_acesso_barraca`; devolve JSON com
  `estado`: `ok` (idempotente para o mesmo método), `ja_definido` (NUNCA
  sobrescreve método já definido), `cancelado`, `metodo_invalido`,
  `sem_acesso`, `nao_autenticado`. Grava `metodo_definido_em`/`_por`.
  Online-only por decisão (ação de gestão): sem internet mostra "Sem internet".
  `entregador_confirmar` também só grava quando o método atual é `na_entrega`.
  O Caixa conta pelo método vigente no momento da consulta (igual ao link do
  entregador).
- Estoque por item com baixa automática (2026-10-07, PR #29, migration
  `20261010110000_estoque_por_item.sql`; REVERTE a decisão de 2026-09-26 "só o
  toggle esgotado"). Decisões do dono: controle POR ITEM e opcional
  (`itens.estoque_qtd`, NULL = não controla, comportamento de sempre); ESGOTA
  sozinho quando o saldo chega a 0 (`esgotado = true` + `estoque_esgotado_auto`);
  PODE NEGATIVAR (venda além do saldo, p.ex. operador offline; só é
  bloqueada se o dono ligar o bloqueio opcional, ver abaixo: erro de contabilidade vira WARNING e o pedido segue); DEVOLVE ao
  cancelar o pedido ou remover o item. A baixa vive no BANCO (triggers
  SECURITY DEFINER em `itens_do_pedido`/`pedidos`), então vale para o app
  online/offline, cardápio digital e Pix (todos passam por `criar_pedido`).
  Histórico e idempotência em `movimentos_estoque` (venda/cancelamento/
  remocao/ajuste; índice único parcial por `(item_pedido_id, motivo)`, nunca
  devolve duas vezes). "Esgotado" marcado à mão (auto = false) NUNCA é
  desmarcado pelo sistema. "Apagar período" não devolve estoque. Pedido feito
  antes de ligar o controle no item não baixa nada.
  Ajustes: controle, saldo inicial, repor/ajustar (RPC `ajustar_estoque`, só
  `authenticated`) e últimas movimentações; Lançar Pedido mostra "Restam N"
  com N <= 5. NÃO há Realtime de itens: o saldo é relido ao voltar para o app,
  ao sincronizar um pedido e a cada 60 s (dois operadores podem vender o
  último item quase juntos e o saldo fica negativo, como combinado). Vale para
  todos os planos (não gatear por Essencial/Pro).
  BLOQUEIO OPCIONAL (2026-10-07, PR #31, migration
  `20261011100000_estoque_bloqueia.sql`): o dono escolhe em Ajustes > Estoque
  ("Bloquear venda acima do estoque", `barracas.estoque_bloqueia`, padrão
  false). DESLIGADO (padrão): vende além do saldo como antes, mas AVISA ("Passa
  do estoque: restam N", toast ao tocar no + e aviso fixo no card). LIGADO:
  Lançar Pedido não passa do saldo conhecido pelo aparelho (+ para em "Restam
  N"/"Sem estoque") e barra o envio se o carrinho passou do saldo; o cardápio
  digital recusa no SERVIDOR (422 "Sem estoque suficiente", em
  `criar-pedido-cardapio` e `criar-pagamento-pix`, soma por item). REGRA DE
  OURO: o bloqueio só vale na hora de adicionar/enviar; pedido já criado, na
  fila offline, retry de Pix já emitido e pagamento aprovado no webhook NUNCA
  são recusados por estoque (a venda já aconteceu; o saldo negativa). Nenhuma
  função do banco mudou: `criar_pedido` e os triggers do #29 seguem iguais.
  Limite conhecido: com o bloqueio ligado, dois operadores ainda podem vender o
  último item quase juntos (saldo só atualiza ao voltar ao app, ao sincronizar
  ou a cada 60 s).
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
- Cabeçalho do card de pedido (Cozinha/Detalhe da Comanda) mostra
  cronômetro (tempo decorrido) por padrão, ou horário de envio pra
  cozinha (`criado_em`) se a barraca configurar isso em Ajustes >
  Faixas de tempo (`barracas.mostrar_horario_pedido`, pedido de
  produto 2026-09-28). Só troca o TEXTO — a cor do semáforo
  (`corPorTempo`) continua sempre calculada por tempo decorrido, nunca
  personalizável, mesmo com essa config ligada.
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
- Campos de texto/número de Ajustes salvam por botão "Salvar"
  explícito (`BotaoSalvarCampo`, outline, habilitado só com alteração),
  nunca no onBlur (2026-09-29, pedido do dono do produto, depois do CNPJ
  "sumir" ao reabrir o app). Estado do campo vem de `useRascunho`
  (`src/hooks/useSalvarBarraca.ts`): sem edição mostra sempre o valor
  mais fresco da barraca, nada é gravado sem o usuário editar. Save via
  `useSalvarBarraca`: erro real na tela, offline avisa "Sem internet.
  Não foi salvo.", update que não afeta linha (RLS) conta como erro, e
  o cache local da barraca (`atualizarBarracaCache` em `useBarraca.ts`)
  só atualiza depois da confirmação do banco. Toggles/chips continuam
  salvando na hora, mas revertem e mostram erro se falhar. Exceção
  deliberada: listas densas (nome de categoria, título de banner) ainda
  salvam ao sair do campo, com toast de erro. Itens do cardápio NÃO
  entram mais nessa exceção (2026-09-29): a lista em Ajustes é só
  leitura (linha tocável: foto, nome, categoria, selos, preço) e criar/
  editar item é um formulário único (`BottomSheetItem`, aberto por
  "Novo item" ou tocando na linha) com foto, nome, preço, categoria,
  descrição, Ativo/Esgotado/Popular, dados fiscais e "Apagar item";
  tudo grava de uma vez no botão Salvar/Adicionar.
- IA e CRM escondidos (decisão do João, 2026-10-09: produto focado em um app redondo; a integração app + CRM é fase futura):
  em Ajustes, "Atendente IA" só aparece se a barraca já tem `ia_habilitada` (ou `VITE_MOSTRAR_ATENDENTE_IA=1`) e "Integração
  com o CRM" só se a barraca já está conectada (URL/segredo/envio ligado em `integracao_crm_estado`) ou
  `VITE_MOSTRAR_INTEGRACAO_CRM=1` (`src/lib/visibilidadeIaCrm.ts`). Só a TELA some: backend, eventos SAI-001, RPCs e
  functions não mudam e as mensagens automáticas de status (aviso de pedido pronto etc., enviadas pelo CRM)
  continuam. O onboarding e o checklist do Hub não oferecem nem citam IA/CRM.
- Cupons por código (v2, 2026-10-08/09; spec `docs/superpowers/specs/2026-10-08-cupons-design.md`,
  plano `docs/superpowers/plans/2026-10-08-cupons-comanda.md`). Só no CARDÁPIO DIGITAL (operador no balcão
  não digita cupom). Flag por loja `barracas.cupons_habilitado` (nasce desligada; RPC pública
  `cupom_config(slug)` devolve só o booleano). O app envia SÓ o código (`cupom_codigo`); o desconto é
  sempre calculado no banco (`cupom_regras`/`cupom_avaliar`/`cupom_reservar`, só papel de serviço).
  Tipo percentual (1–100, floor em centavos) ou fixo; limites: validade, limite total, uma vez por cliente
  (exige sessão do perfil; só uso CONFIRMADO conta e refazer o checkout libera a reserva anterior do mesmo
  cliente) e pedido mínimo. DECISÕES DO DONO: desconto só sobre os ITENS (a taxa de entrega nunca é
  descontada); o desconto pode zerar os itens (cupom de 100% = PEDIDO GRÁTIS, decisão do dono 2026-10-19, ver abaixo; antes havia piso de R$ 1,00); um cupom por pedido;
  o cupom só conta como USADO com o pagamento confirmado — durante o Pix aberto fica RESERVADO até o
  vencimento (reserva vencida é ignorada na contagem, sem cron) e é liberado se o Pix expira/é rejeitado;
  "pagar na entrega" reserva e confirma direto. Reserva atômica (`for update` na linha do cupom: dois
  clientes disputando o último uso, exatamente um vence). Pagamento aprovado NUNCA é recusado: o webhook
  confirma o uso mesmo com a reserva vencida/liberada e mesmo se o cupom foi pausado ou venceu. Uma linha de
  `cupom_usos` por cobrança (índice único): trocar o cupom da mesma cobrança reaproveita a linha.
  Fluxo do Pix: `criar-pagamento-pix` avalia, confere `total_esperado_centavos` já descontado (409 com o
  novo total), reserva com `reservado_ate` = vencimento do Pix e grava `cupom_id/desconto_cupom_centavos/
  cupom_uso_id` no pendente; o webhook compara o valor pago com itens − desconto + taxa e chama
  `cupom_confirmar` ANTES de marcar o pendente aprovado (falha = 500 e o provedor reenvia).
  `cupom-validar` (sem JWT) só consulta, nunca reserva; tentativas INVÁLIDAS limitadas (15/h por IP+loja,
  100/h por loja; `cupom_registrar_tentativa`, `ip_hash`). O pedido guarda cópia de `cupom_codigo` e
  `desconto_cupom_centavos` (editar/apagar o cupom depois não muda pedido antigo); cupom com uso não se
  apaga, só pausa (`cupom_apagar` só sem uso). O desconto fica À PARTE dos itens: Histórico/Detalhe mostram
  "Cupom X: −R$ Y"; Relatório/Faturamento tem a seção "Descontos de cupom" e "Recebido nos itens"
  (faturamento continua a soma dos itens; `src/lib/descontosCupom.ts`). NFC-e: o desconto é rateado entre
  os itens (`_shared/descontoNfce.ts`) e vai no campo `valor_desconto` POR ITEM da FocusNFe (confirmado na
  doc oficial; a requisição não tem desconto no nível da nota); a nota vale itens − desconto e a taxa segue
  fora. NENHUMA nota com desconto foi emitida: conferir a primeira em homologação. Evento para o CRM leva
  `cupom_codigo` e `desconto_cupom_centavos` (opcionais) e, com cupom, `total_centavos` é o PAGO.
  RISCO CONHECIDO (aceito pelo dono): quem gera dois Pix com o mesmo cupom e paga os DOIS leva o desconto duas
  vezes (cada Pix foi cobrado pelo valor que o cliente viu). Apagar os dados do cliente (LGPD) zera
  `cupom_usos.cliente_id`: o uso continua contando no limite total, e o "uma vez por cliente" daquele telefone
  deixa de valer. Também aceito: um Pix pago depois de a reserva expirar confirma o cupom mesmo que o último
  uso já tenha sido de outra pessoa (pode passar de `limite_usos` em +1; pagamento aprovado nunca é recusado).
  Revisão independente (2026-10-08) corrigida: tentativas de adivinhar código contam nos endpoints de pedido
  (resultado real); excluir barraca/conta limpa cupons e usos; refazer o checkout libera a reserva antiga
  (`pendente_anterior_id`, `cupom_liberar_abandonadas`); retry da mesma cobrança reavalia o desconto; "pagar na
  entrega" cria o pedido e confirma o cupom na MESMA transação (`criar_pedido_com_cupom`). PEDIDO GRÁTIS (total cobrado = itens − desconto + taxa = 0): NÃO chama o provedor Pix. `criar-pagamento-pix` reserva o cupom, cria o pedido na MESMA transação que confirma o uso (`criar_pedido_com_cupom`, método novo `gratis`, migration `20261019140000`; `cupom_regras` sem o piso na `20261019130000`), marca o pendente aprovado e responde `{pedido_gratis:true, senha, pedido_id}`; retry do mesmo `client_uuid` devolve o mesmo pedido. Exige WhatsApp informado (422 `telefone_obrigatorio`; perfil confirmado quando a loja usa perfil, limite por IP e "uma vez por cliente" seguem valendo). Com taxa de entrega > 0 o total não é zero: Pix só da taxa. "Pagar na entrega" com total 0 também vira `gratis`. `emitir-nfce` NÃO emite nota de total R$ 0,00 (422 `pedido_gratis`, sem chamar a FocusNFe). Front: botão "Finalizar pedido grátis", senha sem QR; Relatório/Faturamento mostra o método "Grátis (cupom)" em linha própria e o desconto à parte. Aplicar as migrations `…130000` e `…140000` ANTES do deploy das functions. Testes de banco/functions contra o staging: `tests/cupons*.staging.mjs` (rodar com as
  variáveis do cabeçalho de cada script); o teste real do Pix fica para um Pix de valor baixo na loja de teste.

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
  Exceção no `Chip` (2026-09-29, pedido do dono do produto): o chip
  SELECIONADO é mostarda com canto balão (mesma assinatura do selo
  "Popular"); o não selecionado é cinza neutro em pílula uniforme. Sem
  `variant` explícito, a cor vem de `checked` (`src/components/ui/
  Chip.tsx`) — nunca deixar todos os chips de um seletor em mostarda.
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
- Ícones: fonte PRÓPRIA (2026-10-06): subset de Material Symbols Rounded em `src/assets/fonts/material-symbols-rounded.ttf` (~29KB; FILL 0..1, wght 400..700, opsz 20..48), declarada em `src/index.css` e precacheada pelo service worker. Antes vinha do Google Fonts (1,2MB, `display=block`) e o ícone ficava invisível ~1s — NÃO era o Supabase. Ícone NOVO fora do subset aparece como texto (ex.: LOCATION_ON). A lista fica em `src/assets/fonts/icones.txt`; acrescente o nome lá e rode `node scripts/gerar-fonte-icones.mjs` (precisa de internet). `npm test` (tests/icones.test.ts) FALHA se um ícone usado em `nome=`/`icone=`/`icon=` não estiver na lista. Estilo: Material Symbols Rounded, peso 500, preenchido = estado
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
- Texto visível pro usuário sobre desbloqueio biométrico usa o termo
  genérico "biometria" (2026-09-28, pedido de produto — dono reparou
  que "Face ID" soava só-de-iPhone pra quem usa Android). A
  funcionalidade (`src/lib/faceId.ts`, `src/components/GateFaceId.tsx`)
  usa WebAuthn de verdade multiplataforma (Face ID/Touch ID no iPhone,
  impressão digital/reconhecimento facial no Android, Windows Hello no
  Windows) — só o texto do toggle em Ajustes e da tela de bloqueio
  mudou pra "biometria"; nomes de arquivo/componente/variável
  (`faceId`, `GateFaceId`) continuam como estão, de propósito, não
  vale o risco de renomear sem necessidade. A política de privacidade
  (`Privacidade.tsx`, seção "Biometria") já listava os termos das três
  plataformas lado a lado, não precisou mudar.
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
  `BarraNavegacao` some em telas estreitas (`apenasDesktop`). Caixa
  (abrir/fechar com conferência automática e sangria/suprimento,
  `src/components/SecaoCaixa.tsx`) nasceu embutido em `Desktop.tsx`
  junto de Faturamento, mas em 2026-09-27 virou rota própria
  (`/:slug/caixa`, `src/pages/Caixa.tsx`) — pedido de produto inspirado
  num print de concorrente onde "Caixa" é item de nav separado de
  "Faturamento". `Desktop.tsx` agora só tem Faturamento/Relatório.
  Navegação do hub desktop é `src/components/SidebarDesktop.tsx` (painel
  lateral fixo, só `md:` pra cima, substitui a `BarraNavegacao` inferior
  nessas rotas — Lançar Pedido/Cozinha/Chamada continuam só com
  `BarraNavegacao` em qualquer largura). Reorganizado em grupos com
  rótulo em 2026-09-27 (pedido de produto, inspirado num print de
  concorrente): "Operação" (Dashboard, Caixa), "Gestão" (Histórico,
  Faturamento), "Conta" (Ajustes) — só reagrupou os itens que já
  existiam (Caixa incluído, pela mudança acima), sem copiar item novo
  do concorrente (Mesas/Entregadores/Estoque não existem aqui).
  - Exceção pontual em 2026-09-27 (pedido explícito do dono do
    produto, via print de preview quebrado em tela larga): Lançar
    Pedido (`src/pages/LancarPedido.tsx`) ganhou tratamento de
    desktop na visualização em grade do cardápio — mais colunas
    (`md:grid-cols-3`/`xl:grid-cols-4`, eram só 2 fixas) e o conteúdo
    da tela (busca, chips, grid) mais a barra fixa do carrinho passam
    a caber num container de largura máxima (`max-w-5xl`)
    centralizado em vez de esticar borda a borda. Continua usando
    `BarraNavegacao` normalmente, sem virar rota tipo `Desktop.tsx`
    nem ganhar `SidebarDesktop`. Confirmar Pedido
    (`src/pages/ConfirmarPedido.tsx`) entrou na mesma exceção em
    2026-09-29 (pedido do dono do produto): container `max-w-5xl`
    centralizado e duas colunas a partir de `md:` (itens/observação/
    total à esquerda, pagamento/botões à direita); mobile inalterado.
    Cozinha/Chamada **não** entram nessa exceção — continuam
    mobile-only sem nenhum tratamento de tela larga, regra de cima
    inalterada pra elas.
  - Ajustes (`src/pages/Ajustes.tsx`) split em duas categorias, só no
    desktop (pedido do dono do produto, 2026-09-27: a página tinha
    crescido demais — 11 seções empilhadas numa rolagem só). **Conta**
    (`/:slug/ajustes`): Assinatura, Identidade, Pagamento (taxas de
    maquininha), Fiscal, Pagamento online. **Cardápio & Operação**
    (`/:slug/ajustes/cardapio`): Cardápio, Banners, Horário de
    funcionamento, Faixas (kanban), Impressora, Aparência. "Segurança
    e operador" (trocar senha/Face ID/sair) ficou em Conta. As duas
    rotas renderizam o MESMO componente `Ajustes` (prop `categoria`) —
    as 11 seções continuam todas montadas na mesma ordem de sempre,
    cada uma dentro de um wrapper `display: contents` que só ganha
    `md:hidden` quando não é da categoria da rota atual. Isso existe
    pra preservar a ordem exata do mobile (que continua numa página só
    com tudo, igual sempre foi) sem duplicar nenhuma seção — não é
    duas páginas de verdade, é uma view filtrada por CSS a partir de
    md. `LayoutBarraca.tsx` trata as duas rotas como "em Ajustes" pra
    decidir sidebar (`endsWith('/ajustes') || endsWith('/ajustes/
    cardapio')`). `SidebarDesktop.tsx`: item "Conta" continua no grupo
    "Conta"; item novo "Cardápio" entrou no grupo "Gestão" (ao lado de
    Histórico/Faturamento) em vez de virar grupo próprio só com 1
    item. Um par de abas (`Conta`/`Cardápio & Operação`) aparece só no
    desktop logo abaixo do título "Ajustes", pra trocar de categoria
    sem precisar voltar pra sidebar.
  - Tour guiado do Hub (`TourGuiado.tsx`, usado em `Dashboard.tsx`)
    ganhou uma versão desktop em 2026-09-27: a sidebar (Operação/
    Gestão/Conta) mudou o caminho de verdade no desktop, então os
    passos do mobile (apontam pro ícone de Ajustes e pros cards de
    Caixa/Cozinha do Hub mobile) não faziam mais sentido lá. Passos
    desktop apontam pros 3 grupos da `SidebarDesktop` em vez de
    elementos do Hub. Chave de "já visto" separada por breakpoint
    (`hub-desktop` vs `hub`, `tourJaVisto`/`marcarTourVisto` em
    `TourGuiado.tsx`) — são experiências diferentes, cada uma aparece
    uma vez, independente da outra. Detecção de breakpoint via novo
    `useEhDesktop()` (`src/hooks/useEhDesktop.ts`, `window.matchMedia`
    no mesmo `md` de 768px do Tailwind) — necessário porque
    `SidebarDesktop` é só CSS (`hidden md:flex`), então uma ref pra ela
    continua "existindo" mesmo com a sidebar escondida; sem essa
    checagem o tour desktop apontaria um spotlight pro nada em telas
    estreitas. Como `SidebarDesktop` é componente irmão (não filho) de
    `Dashboard.tsx`, os alvos dos passos desktop são achados por
    `id` (`sidebar-grupo-operacao`/`-gestao`/`-conta`) via
    `document.getElementById` em vez de `ref={}` direto.
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
    unidade por item do cardápio. **Aviso de homologação** (2026-10-07, PR #22,
    migration `20261008130000_nfce_ambiente.sql`): `emitir-nfce` grava
    `pedidos.nfce_ambiente` (o ambiente USADO na chamada) e o cupom imprime
    "EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL" no topo e antes do
    corte; o Histórico mostra o selo "Homologação · sem valor fiscal". Vale o
    ambiente GRAVADO na nota, nunca o `fiscal_ambiente` atual da barraca. Nota
    antiga (coluna NULL): conta como produção só se a barraca está HOJE em
    produção, senão homologação (`ambienteDaNota` em `src/lib/fiscal.ts`; em
    dúvida avisa a mais). `emitir-nfce` devolve cedo se o pedido já está
    autorizado: testar produção exige pedido novo. **Emissão de verdade implementada e
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

    **Modelo de impressão do cupom fiscal implementado** (2026-09-27,
    `montarCupomFiscal`/`imprimirCupomFiscal` em `impressoraTermica.ts`,
    mesmo padrão de bytes ESC/POS de `imprimirTeste`) — layout baseado num
    cupom real de NFC-e (referência: McDonald's), sem NCM/CFOP por item
    (fica em `itens`, não em `itens_do_pedido`, e cupom de consumidor
    normalmente não precisa). Pré-requisito resolvido nessa
    implementação: `emitir-nfce` só salvava `nfce_status/chave/numero/
    mensagem`, descartando o resto da resposta da FocusNFe — agora também
    salva `nfce_serie`, `nfce_protocolo` e `nfce_qrcode_url` (novas
    colunas em `pedidos`), usados pra imprimir o QR code de consulta no
    cupom. **Ressalva**: os nomes desses 3 campos na resposta da FocusNFe
    vieram de pesquisa na documentação (não dá pra montar essa URL de QR
    sozinhos — o padrão nacional de NFC-e exige o CSC da SEFAZ, que fica
    só com a FocusNFe, nunca com o Sai aê), não de uma emissão real
    inspecionada — confirmar contra o `resultado` bruto na primeira
    emissão de verdade, já que isso ainda não aconteceu.
    **Fiscal/PROCON (2026-10-06, Frente A do sprint):** nomes conferidos na
    doc oficial da FocusNFe (`serie`, `protocolo`/`numero_protocolo`,
    `qrcode_url`, `url_consulta_nf`), ainda sem emissão real inspecionada.
    Botão **"Imprimir cupom fiscal"** no `CardHistorico` (só NFC-e
    autorizada + Android com impressora pronta; relê o pedido do servidor
    antes de imprimir). CPF do consumidor é OPCIONAL (campo sempre visível
    ao emitir; `cpf_destinatario` na FocusNFe; `pedidos.nfce_cpf_consumidor`;
    cupom mostra "CONSUMIDOR NAO IDENTIFICADO" sem CPF). Emitente em Ajustes
    > Fiscal (`EmitenteFiscal`): `barracas.emitente_razao_social/
    inscricao_estadual/telefone/endereco` e `procon_endereco` (texto livre).
    PROCON: o cupom sempre traz "PROCON 151" (fixo, `TELEFONE_PROCON`) + o
    endereço da sede. Tributos (Lei 12.741): a FocusNFe NÃO calcula IBPT, então
    o dono informa a alíquota (`barracas.tributos_aprox_bps`), o valor por
    item vai em `valor_total_tributos` e o total fica em
    `pedidos.nfce_tributos_centavos`; o cupom marca "Fonte: aliquota informada
    pelo emitente". `emitir-nfce` recusa pedido com `metodo_pagamento =
    'na_entrega'` (método real só existe depois que o entregador confirma) e
    consulta a ref se a nota ficar `processando_autorizacao`. Dados do cliente
    de entrega NUNCA entram na NFC-e. Migration
    `20261006130000_fiscal_emitente_procon.sql` precisa estar aplicada antes
    do front e do deploy de `emitir-nfce`.
    **Taxa de entrega fica fora da nota** (decisão de 2026-10-05, ver
    "Taxa de entrega" em Regras de produto): `emitir-nfce` e
    `montarCupomFiscal` seguem somando só os itens, nunca
    `pedidos.taxa_entrega_centavos`.
  - Estoque: ver "Estoque por item com baixa automática" em Regras de
    produto (2026-10-07). A decisão de 2026-09-26 ("só o toggle esgotado, sem
    baixa por venda") foi REVERTIDA pelo dono do produto; o toggle `esgotado`
    continua existindo e convive com o controle por quantidade.
  - WhatsApp pra leads (o concorrente tem, manda mensagem automática
    pro cliente): envio AUTOMÁTICO continua fora de escopo (exigiria a API
    oficial do WhatsApp Business: custo por mensagem, templates aprovados,
    opt-in). Existe só o botão MANUAL "Avisar cliente" (wa.me, o operador
    toca em enviar) — ver "Avisar cliente".
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
  - Imagem de capa e horário de funcionamento (2026-09-27, pedido de
    produto inspirado num print de Configurações de concorrente,
    feature nova do zero — nada disso existia antes). Capa:
    `barracas.imagem_capa_url`, upload em Ajustes (dentro de
    `SecaoIdentidade`, junto do logo), mesmo bucket `cardapio-fotos`
    dos banners (`src/lib/capaBarraca.ts`, 1200px). Aparece no topo do
    cardápio público como hero, com o logo sobrepondo a borda de baixo
    (efeito capa de perfil) — sem capa cadastrada, layout volta a ser
    só o header centralizado de antes. Horário: tabela nova
    `horarios_funcionamento` (uma linha por dia 0-6, `aberto` +
    `hora_abertura`/`hora_fechamento`), gerida em Ajustes por
    `SecaoHorarioFuncionamento` (sempre mostra as 7 linhas Domingo–
    Sábado via upsert, dia sem registro = fechado). Exposto no
    cardápio público via `horarios_publicos(slug)` SECURITY DEFINER
    (mesmo padrão de `banners_publicos`); "Aberto agora"/"Fechado —
    abre às Xh" é calculado no client a partir da hora do visitante
    (`statusFuncionamento`, função pura em `src/lib/horarioFuncionamento.ts`).
    Desde 2026-10-06 trata janela que cruza a meia-noite (18h–02h; de
    madrugada olha a janela do dia anterior; fechamento <= abertura = vira
    o dia).
  - "Pagar na entrega" (2026-10-06): opção extra no checkout do cardápio,
    só aparece se o dono salvou o WhatsApp (`barracas.whatsapp_pedidos`, só
    dígitos) E ligou `pagar_na_entrega_habilitado` (Ajustes > Cardápio &
    Operação, `SecaoPagarNaEntrega`); `cardapio_publico` só devolve o número
    com a opção ligada. O cliente informa nome, telefone e endereço
    (opcional); a edge function PÚBLICA `criar-pedido-cardapio` resolve
    preço/disponibilidade no servidor (nunca do cliente), tem só um teto anti-bot
    por IP (hash, 120 pedidos/5min, em `cardapio_pedidos_log`; SEM limite por
    barraca, porque evento tem centenas de pedidos e IP compartilhado),
    honeypot oculto e rejeita envio < 2s após abrir o formulário, é idempotente por `client_uuid` e chama `criar_pedido` com método
    `na_entrega`, tipo Entrega, `p_entrega` só com nome/telefone/referência
    (sem rua: o endereço livre vai em `entrega_referencia`, a comanda mostra
    "ENTREGAR PARA" mesmo sem rua e a observação do card da Cozinha repete
    nome, telefone e endereço). O pedido
    cai na Cozinha/imprime pelo Realtime e o celular do cliente abre
    `wa.me/<dono>?text=<resumo>` (se o pop-up for bloqueado, botão "Avisar
    no WhatsApp"). Método `na_entrega` aparece como "A definir na entrega"
    (Histórico, comanda, Relatório/Faturamento em linha própria); o método
    real é definido depois (frente F, link do entregador).
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
- Reportar bug (2026-09-27, pedido de produto): botão em Ajustes >
  Conta > "Ajuda e suporte" (`SecaoAjudaSuporte`, antes do Rodape)
  abre um formulário (descrição obrigatória + "o que esperava que
  acontecesse" opcional) e chama a edge function `reportar-bug`, que
  manda e-mail pro time via Resend API (`reply_to` = e-mail de quem
  reportou, contexto de barraca/user agent no corpo). Exige os
  secrets `RESEND_API_KEY` e `BUG_REPORT_EMAIL_DESTINO` na function —
  sem eles, responde erro em vez de falhar quieto. `EMAIL_DE` (from)
  fica hardcoded no código (`bugs@saiae.com.br`, mesmo domínio já
  verificado no Resend pelo SMTP do Supabase Auth), não é secret por
  não ser sensível.

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
