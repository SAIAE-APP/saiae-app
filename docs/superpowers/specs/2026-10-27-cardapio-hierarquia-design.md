# Cardápio público com hierarquia e pedido em todas as seções — documento de design

Data: 2026-10-27. Projeto 2. Dono da decisão: João. Este documento é só design: nenhum código de produto foi escrito.

Legenda usada abaixo:

- **[Decisão do dono]**: foi decidido pelo João e deve ser tratado como decidido.
- **[Escolha do assistente]**: decisão técnica ou de detalhe tomada ao escrever este documento. O João deve conferir; se discordar, muda.
- Fatos do código trazem arquivo e linha (linhas de `src/pages/CardapioPublico.tsx`, conferidas em 2026-10-27, podem deslocar).

## 1. Intenção e porquê

**[Decisão do dono]** O cliente deve chegar ao pedido de forma tão natural que peça quase sem perceber. Hoje o cardápio público está correto, mas não conduz: tudo tem o mesmo peso, os botões de pedir são discretos (só contorno) e nada diz ao cliente por onde começar. O sucesso é medido em mais pedidos por semana por barraca, antes e depois (seção 7); não há contagem de visitas.

Em uma frase: transformar o cardápio de "catálogo" em "caminho", sem esconder nada e sem empurrar o cliente.

## 2. Metas, não-metas e anti-metas

### Metas **[Decisão do dono]**

- Ordem hierárquica, de cima para baixo, em uma única rolagem: (1) capa, logo e informações da barraca; (2) banner do dono; (3) bloco DESTAQUE novo; (4) "Mais pedidos"; (5) "Populares"; (6) categorias com a lista completa; (7) carrinho fixo na base, acompanhando toda a rolagem.
- A ação de pedir fica visível, no mesmo padrão, em todo card de item de Mais pedidos, Populares, categorias e destaque.
- Destaque na versão leve: o dono escolhe em Ajustes UM item já existente; sem combo, sem preço próprio.

### Não-metas **[Decisão do dono]**

- Combo com preço próprio ou regra de preço de combo.
- Mudar checkout, pagamento, taxa, Pix/cartão ou cupom.
- Mudar o modelo de pedido, o estoque ou a NFC-e.
- Reescrever o cardápio do zero.

### Anti-metas **[Decisão do dono]**

- Virar uma parede de botões ou esconder informação (preço, esgotado, horário).
- Empurrar o cliente de modo enganoso (padrão escuro): o cliente sempre pode ver o total e remover itens.
- Quebrar o cardápio de barracas sem banner, sem capa, sem destaque ou sem popular. Tudo isso é opcional e deve degradar bem.
- Quebrar acessibilidade: área de toque de pelo menos 44px, contraste, `aria-label`.

## 3. Restrições

**[Decisão do dono]**

- Mobile-first.
- Sem migration obrigatória, se der (avaliado na seção 6: não dá para o destaque; a opção mais leve exige uma migration aditiva pequena).
- Tem de funcionar com pagamento online desligado, com os modos Retirada e Entrega, e com itens esgotados.

**Regras do projeto que valem aqui** (CLAUDE.md, "Regras de tema" e "Cardápio Digital"):

- Mostarda `#FFC21A` e tinta `#18171C` são as únicas cores de marca; texto sobre mostarda é sempre tinta, nunca branco.
- "Um primário por tela": só a ação principal da tela é mostarda. A seção 5.2 trata da tensão com esta decisão.
- Canto balão (`--radius-mesa-balao`) em selos, etiquetas e contadores estáticos; controles interativos continuam em pílula; cartões usam `rounded-mesa-xl`; botões usam `--radius-mesa-btn`.
- Números sempre em `font-mesa-display`.
- Ícones só do subset da fonte própria. Ícone novo exige acrescentar o nome em `src/assets/fonts/icones.txt` e rodar `node scripts/gerar-fonte-icones.mjs` (precisa de internet); `tests/icones.test.ts` falha se faltar. Este projeto não deve precisar de ícone novo: `add`, `remove`, `arrow_forward`, `star`, `check_circle`, `schedule`, `shopping_bag` e `local_fire_department` já estão na lista.
- A tela pública lê dados por funções `SECURITY DEFINER` liberadas para `anon`, nunca por RLS pública em `barracas` (a tabela guarda `taxa_debito_bps` e `taxa_credito_bps`, dado privado do dono).

## 4. Estado atual (o que já existe)

Tudo em `src/pages/CardapioPublico.tsx`, salvo indicação.

**Carregamento de dados.** `cardapio_publico(slug)` é chamada em l.682 e devolve uma linha por item (`LinhaCardapioPublico`, l.44-69), com `item_popular`, `item_esgotado`, `pedidos_30d` e dados da barraca repetidos em cada linha. As opções vêm de `opcoes_publicas(slug)` (l.722); itens que têm grupos de opções ganham `com_opcoes: true`, preço "a partir de" e podem virar `item_esgotado` quando nenhuma combinação é pedível (l.860-874). O último `create or replace` da função é `supabase/migrations/20261022110000_valor_livre_preco_aberto.sql` (que oculta itens de preço aberto). Como as colunas de retorno mudam, as migrations anteriores da função fizeram `drop function` antes de recriar.

**Hero (capa, logo, nome, horário).** l.1547-1596. Capa opcional (`barraca_imagem_capa_url`), logo sobreposto, nome, subtítulo ("Monte seu pedido e pague com Pix direto por aqui" ou "Monte sua lista aqui e finalize no caixa", conforme `podeComprar`, l.1570), link de perfil e selo "Aberto agora / Fechado — abre às Xh" (l.1583-1594, calculado por `statusFuncionamento`, l.876). Os modos Retirada/Entrega aparecem em `EscolhaModo` (l.558, usado em l.1598) quando há mais de um. **Atenção:** a taxa de entrega NÃO aparece no topo hoje; ela só é conhecida depois que o cliente informa o bairro, dentro do checkout. O brief do João a citava como "já existente"; não existe antes do checkout (ver seção 5.1).

**Banner.** `CarrosselBanners` (l.347-432): avança sozinho a cada 3 s, pausa 4 s após toque, usa banners padrão da marca quando a barraca não tem os seus (l.312-331). Renderizado em l.1602, só fora de busca.

**Mais pedido e Populares.** Dois blocos de rolagem horizontal com `CardItemHorizontal` (l.495-555): Populares (l.1604-1621, curadoria manual, `itens.popular`) vem ANTES de Mais pedido (l.1623-1640, algorítmico, `pedidos_30d`, no máximo `MAXIMO_MAIS_PEDIDOS = 8`, l.126). Isso é o inverso da ordem decidida pelo dono. Ambos somem durante a busca.

**Lista completa.** Campo de busca (l.1642), chips "Todos" e uma por categoria (l.1654-1672) e uma lista plana de `CardItemPublico` (l.244-306, renderizada em l.1674-1698). Em "Todos" a lista é plana, sem títulos de categoria; o chip filtra.

**Botões de pedir hoje.**
- `BotaoAdicionar` (l.160-242): esgotado → `Button outline` desabilitado "Esgotado"; `com_opcoes` → `Button outline` "Escolher" (ou "Escolher (N)"); item simples sem quantidade → `Button outline` "Adicionar"; com quantidade → stepper "− N +" com botões de 44px de área de toque (`size-11 -m-2`, l.207, 221). O tamanho `sm` do `Button` tem `h-9` (36px, `src/components/ui/Button.tsx`), abaixo de 44px.
- `BotaoAdicionarCompacto` (l.438-489), usado nos cards horizontais: um botão redondo "+" de 32px, só com contorno (l.484), e um stepper com botões de 20px (`size-5`, l.460, 470). Os dois estão abaixo de 44px.
- Clicar em item com `com_opcoes` abre `SeletorOpcoes` (l.1749); itens simples chamam `adicionarAoCarrinho` (l.1134). `quantidadeDoItem` (l.1120) soma o carrinho simples e as linhas com opções, então o mesmo item em várias seções mostra a mesma quantidade.

**Selos.** "Top 1" e "Popular" (mostarda, canto balão) nos cards (l.267-272, 520-525); "Esgotado" como camada sobre a foto.

**Carrinho fixo.** l.1707-1728: aparece quando há itens e o checkout está fechado, `fixed bottom-4`, tinta (`bg-mesa-neutral-900`), mostra "N itens" e o total, com um pill mostarda "Ver pedido →" dentro. Abre o `BottomSheet` "Seu pedido" (l.1760), onde há `Diminuir`/`Aumentar` por item (l.1777, 1790), então o cliente já pode ver o total e remover. A lista tem `pb-24` (l.1674) para a barra não cobrir o último card.

**Pagamento online desligado.** Diferente do que o brief descreve ("botão Em breve"): hoje os botões de adicionar funcionam normalmente (`podeAdicionar={!podeComprar || preço > 0}`, l.295). O aviso aparece só ao finalizar, em `BottomSheetFinalizarBalcao` ("Finalize no caixa", l.132-154, acionado em l.1975). O texto "Em breve" que existe no CLAUDE.md descreve a Fase 1 e já está marcado como desatualizado lá. Conclusão: neste projeto, "pagamento online desligado" mantém o comportamento atual (adicionar funciona, finalizar mostra o aviso do caixa).

**Fora do horário.** O cardápio não bloqueia nada: só mostra o selo. Bloquear pedido fora do horário é opcional por barraca (`barracas.bloquear_fora_do_horario`, migration `20261014130000_horario_servidor.sql`) e é recusado no servidor com 422 no checkout. O cliente não recebe esse flag, então hoje os botões de pedir continuam ativos com a barraca fechada. Este projeto passa a desabilitá-los na tela (seção 5.8); o servidor não muda.

**Ajustes.** Toggle "Popular" por item em `src/pages/Ajustes.tsx` l.547-554 (some para item de preço aberto). A seção "Cardápio digital" está em `SecaoCardapioDigital` (l.1411) e hoje só tem o link de compartilhar. Banners têm sua própria seção, `SecaoBanners` (`src/components/SecaoBanners.tsx`).

## 5. Mudanças propostas por bloco

### 5.1 Blocos 1 e 2: topo e banner

**[Decisão do dono]** Capa, logo, nome, horário aberto/fechado, modos e carrossel de banners continuam como estão.

**[Escolha do assistente]** Nenhuma mudança funcional. A taxa de entrega não vai para o topo neste projeto: ela depende do bairro (tabela de bairros, política "não listado") e mostrá-la antes do checkout seria um número que pode estar errado. Fica de fora; se o João quiser "a partir de R$ X" no topo, é projeto à parte.

### 5.2 Bloco 3: Destaque (novo)

**[Decisão do dono]** Um card herói em mostarda mostra o item escolhido pelo dono, com o preço normal dele e um botão de pedir. Sem item escolhido, ou item esgotado/inativo, o bloco some e a tela começa em "Mais pedidos".

**[Escolha do assistente]** Detalhes:

- **Conteúdo do card:** rótulo curto no topo (por exemplo "Destaque da casa"; microcopy fica com o construtor), foto grande do item (ou ícone `image` quando não há foto), nome, descrição em até 2 linhas, preço (com "a partir de" quando o item tem variação, igual aos outros cards) e o botão de pedir. Fundo `mesa-orange-500`, todo texto em tinta.
- **Botão no card mostarda:** um botão mostarda sobre fundo mostarda não aparece. Por isso o botão do herói é **tinta com texto claro** (`Button variant="confirm"`, tamanho `md` ou `lg`). Nos outros cards o botão é mostarda (ver 5.3).
- **Comportamento do botão:** o mesmo padrão dos outros cards: item simples adiciona direto e o botão vira o contador "− N +"; item com `com_opcoes` mostra "Escolher" e abre `SeletorOpcoes`. Reaproveitar `BotaoAdicionar`, sem duplicar a lógica.
- **Quando some:** sem escolha em Ajustes; item inativo, esgotado (inclusive o esgotado derivado das opções, l.871) ou de preço aberto; durante a busca (mesma regra de banner/populares/mais pedido). O cálculo parte de `linhas` (já com as opções aplicadas), então a regra de "esgotado" é uma só.
- **Repetição:** o item do destaque continua aparecendo também em "Mais pedidos", "Populares" e na lista, se couber em cada regra. Não vamos remover item de outras seções: "Top 1" é um fato algorítmico, e tirar o item dali esconderia informação. A quantidade é a mesma em todos os cards (já é assim hoje).
- **Selo:** nenhum selo "Popular/Top 1" dentro do herói (ele já é o destaque).
- **Acessibilidade:** a região é uma `section` com `aria-labelledby` apontando para o rótulo; a imagem é decorativa (`alt=""`), porque o nome está no texto; contraste tinta sobre mostarda é o mesmo do `Button primary` já existente.

### 5.3 Pedir em todas as seções (blocos 3 a 6)

**[Decisão do dono]** O padrão é igual em todo card: "+" adiciona direto ao carrinho e depois vira "− N +" no próprio card; item com opções mostra "Escolher" e abre o seletor. A decisão de passar a ação de pedir para preenchida em mostarda com texto tinta também é do dono (aprovou a recomendação do assistente).

**[Escolha do assistente]** Como aplicar:

1. **Lista completa (`CardItemPublico`):** trocar `variant="outline"` por `variant="primary"` em `BotaoAdicionar`, com tamanho `md` (h-11 = 44px) para cumprir o toque mínimo. Hoje é `sm` (36px). O card ganha uns 8px de altura; o construtor ajusta o espaçamento. Rótulos: "Adicionar" e "Escolher" (com "(N)" quando já há linhas com opções no carrinho, como hoje).
2. **Cards horizontais (`CardItemHorizontal`, Mais pedidos e Populares):** hoje o "+" redondo de 32px com contorno fica ao lado do preço. Para ter o mesmo padrão e 44px, o botão passa para uma linha própria, abaixo do preço, com largura total do card (144px), mesmo texto "Adicionar" / "Escolher" e mesmo stepper. O card cresce uns 44px. `BotaoAdicionarCompacto` deixa de existir como componente separado, ou fica só como casca fina sobre `BotaoAdicionar` (decisão do construtor, desde que haja uma lógica de estado de botão só).
3. **Esgotado:** continua `Button` desabilitado, em estilo neutro/contorno, com a palavra "Esgotado", e o selo sobre a foto. Esgotado NÃO é mostarda: a cor só vale para o que dá para pedir.
4. **Stepper "− N +":** continua neutro (cinza claro com botões tinta), igual ao de `BotaoAdicionar` hoje; os botões dele já têm 44px de área de toque. Nos cards horizontais, o stepper de 20px (`size-5`) é substituído pelo mesmo do card grande, na largura do card.
5. **Preço zero / "Sob consulta":** continua desabilitado quando o pagamento online está ligado (`podeAdicionar`, l.295), sem mudança.

**Como isso convive com "um primário por tela" (avaliação pedida pelo dono).** A regra do CLAUDE.md diz que só a ação principal de cada tela é mostarda. Dezenas de botões "Adicionar" mostarda numa rolagem não são "um primário" na letra da regra. Há duas leituras:

- *Leitura A (escolhida):* a tela do cardápio tem UM papel principal, "pedir"; todo botão que cumpre esse papel é mostarda, e é a mesma ação repetida, não ações concorrentes. Para isso funcionar, nada mais compete com ele: o carrinho fixo passa a ser **tinta com o pill "Ver pedido" claro** (hoje o pill é mostarda dentro da barra tinta, l.1722), o herói do destaque é um bloco mostarda com botão tinta, e os chips selecionados seguem a regra própria deles (mostarda com canto balão, "Regras de tema"). A hierarquia visual vira: botões de pedir (mostarda) > carrinho (tinta, grande, fixo) > resto.
- *Leitura B (descartada):* manter os botões dos cards em tinta ou contorno e deixar mostarda só para o carrinho. Não atende o que o dono aprovou ("ponto mais forte do card").

Risco da leitura A: o chip selecionado (mostarda) e o herói (mostarda) também estarão na tela. Para o chip, a regra já existe e é de propósito. Se o resultado ficar "amarelo demais" ao testar no celular, o primeiro ajuste é reduzir o herói (borda mostarda em vez de fundo cheio), não tirar a cor dos botões. O PR de construção deve atualizar a frase "Um primário por tela" em `CLAUDE.md` para registrar a leitura A para o cardápio público.

### 5.4 Bloco 4 e 5: ordem de "Mais pedidos" e "Populares"

**[Decisão do dono]** Mais pedidos vem antes de Populares.

**[Escolha do assistente]** Trocar a ordem dos dois blocos em JSX (hoje é o inverso, l.1604 e l.1623). Nada mais muda nas regras: Mais pedidos continua algorítmico (`pedidos_30d > 0`, máximo 8) e Populares continua curadoria manual. Ambos continuam opcionais e somem quando vazios ou durante a busca.

### 5.5 Bloco 6: categorias com a lista completa

**[Escolha do assistente]** Sem mudança estrutural. Busca, chips e a lista continuam como estão (chip "Todos" com lista plana). Não vamos acrescentar títulos de categoria em "Todos": é uma mudança maior do que o pedido e muda a navegação para quem já usa os chips. Mudança que sim entra: o botão de pedir mostarda e de 44px (5.3).

### 5.6 Bloco 7: carrinho fixo

**[Decisão do dono]** Carrinho fixo na base acompanhando toda a rolagem.

**[Escolha do assistente]** O comportamento atual já cumpre isso (l.1707-1728: fixo, aparece quando há itens, mostra quantidade e total). Mudanças:

- Pill "Ver pedido" deixa de ser mostarda e passa a ser claro sobre a barra tinta (e o inverso no modo escuro), para a seção 5.3 funcionar. Texto continua com contraste suficiente.
- Total sempre visível na barra e remoção sempre possível: na barra pelo toque que abre o "Seu pedido" (já tem Diminuir/Aumentar por item) e nos próprios cards pelo stepper. Isso atende a anti-meta de não empurrar o cliente.
- A barra não aparece com carrinho vazio, como hoje. O espaço no fim da página (`pb-24`) continua para ela não cobrir o último card.
- O cliente não é levado ao checkout por nada novo: nenhum botão de pedir abre o carrinho sozinho nem rola a página.

### 5.7 Situações obrigatórias

| Situação | Comportamento |
|---|---|
| Sem capa | Igual a hoje (header centralizado, l.1553-1558). |
| Sem banner próprio | Banners padrão da marca (l.348-349), igual a hoje. |
| Sem destaque, ou destaque esgotado/inativo | Bloco 3 não é renderizado; a tela começa em Mais pedidos. |
| Sem mais pedidos (barraca nova) | Bloco 4 não é renderizado; pula para Populares ou para a lista. |
| Sem populares | Bloco 5 não é renderizado. |
| Pagamento online desligado | Botões de pedir funcionam; finalizar mostra "Finalize no caixa" (inalterado). |
| Retirada e Entrega | Seletor de modo acima do destaque, como hoje; nada muda. |
| Item esgotado | "Esgotado" desabilitado e neutro, em qualquer seção. |
| Busca ativa | Sem banner, destaque, mais pedidos e populares (regra atual estendida ao destaque); só a lista filtrada, com os mesmos botões. |
| Fora do horário | **[Decisão do dono]** Botões de pedir desabilitados com o texto do estado (5.8); preço e itens continuam visíveis. |
| Sem horário cadastrado | Sempre aberta; botões ativos, sem selo (comportamento atual). |

### 5.8 Fora do horário: botões desabilitados

**[Decisão do dono]** O cardápio segue os horários cadastrados em Ajustes (`horarios_funcionamento`). Com a loja fechada, os botões de pedir ficam desabilitados e mostram o texto do estado (por exemplo "Fechado · abre hoje às 18:00"), sem esconder preço nem itens. Usar o que já existe: `horarios_publicos(slug)` e `statusFuncionamento`.

**Fatos conferidos:**

- Os dados já chegam à tela: `horarios_publicos(slug)` (`CardapioPublico.tsx` l.801) alimenta `statusFuncionamento` (`src/lib/horarioFuncionamento.ts`, usado em l.876). A função devolve "Aberto agora · fecha às HH:MM", "Fechado · abre hoje às HH:MM", "Fechado · abre amanhã/<dia> às HH:MM" ou "Fechado". Trata janela que cruza a meia-noite, inclusive de madrugada (olha a janela do dia anterior).
- **Sem horário cadastrado, ou com todos os dias desmarcados, a função devolve `null`** (primeira linha dela) e a tela não mostra selo. Decisão: `null` significa sempre aberta, botões ativos. O servidor tem a mesma regra (`supabase/functions/_shared/horario.ts`, `horarios.length === 0 || todos fechados` = aberto).
- **O servidor já recusa pedido com loja fechada, mas só se o dono ligar `bloquear_fora_do_horario`** (padrão desligado, migration `20261014130000`): `criar-pagamento-pix` (nova cobrança, 422 `fechado`) e `criar-pedido-cardapio` (422 `fechado`). Retry de cobrança ou pedido já criado e o webhook nunca são recusados. Esse bloqueio também usa o fuso da barraca (`barracas.fuso`), enquanto a tela usa o relógio do visitante.
- Portanto, nesta versão o bloqueio é **só na tela**. **[Escolha do assistente, a confirmar com o João]** Não mudar o servidor (checkout é não-meta); o risco está na seção 8.

**[Escolha do assistente] Como fica:**

- Uma condição "aberta" calculada uma vez (`status === null || status.aberto`) e passada a `BotaoAdicionar`, ao herói do destaque e à barra do carrinho. "Fechada" vira mais um estado do botão, ao lado de esgotado.
- Botão fechado: desabilitado, neutro (não mostarda). Nos cards pequenos o texto completo não cabe; o botão mostra "Fechado" e o horário de abertura aparece no selo do topo e no herói do destaque. O `aria-label` do botão traz o estado completo.
- O cliente sempre pode remover: o stepper "− N +" de itens já no carrinho continua permitindo diminuir; aumentar fica desabilitado. A barra do carrinho continua visível e HABILITADA com o total e "· Fechado" na linha dos itens; "Ver pedido" abre o "Seu pedido", onde o cliente revisa e remove itens (inclusive os com opções). **Ruling do dono-delegado (2026-10-27, no lugar do texto antigo "Ver pedido fica desabilitado"):** com a loja fechada o cliente SEMPRE pode remover itens; só o avanço ao pagamento/envio fica desabilitado, com o aviso de estado ("Fechado · abre ... Você ainda pode revisar e tirar itens do pedido").
- O estado é recalculado ao abrir a página e quando a aba volta ao foco.
- Preço, itens e descrição nunca somem.

## 6. Dados e Ajustes necessários para o destaque

**Onde guardar (avaliação).** Três opções:

1. Flag em `itens` (`itens.destaque boolean`), igual a `popular`. Para chegar ao cliente exige recriar `cardapio_publico` (`drop function` + `create`, porque muda o retorno) e garantir "um só destaque por barraca" com índice único parcial. A função já foi recriada em várias migrations e é o ponto mais crítico do cardápio; mexer nela amplia o risco.
2. Coluna em `barracas` e acrescentar ao retorno de `cardapio_publico`: mesmo custo de recriar a função.
3. **Coluna em `barracas` e uma função nova pequena (opção mais leve).**

**[Escolha do assistente]** Opção 3:

- Migration **aditiva**: `alter table public.barracas add column if not exists item_destaque_id uuid references public.itens(id) on delete set null`. Nasce nula: nenhuma barraca muda de comportamento até o dono escolher. `on delete set null` evita destaque apontando para item apagado.
- Função nova `public.destaque_publico(p_slug text)` `SECURITY DEFINER`, `stable`, `set search_path = public, pg_temp`, liberada para `anon, authenticated`, no mesmo padrão de `banners_publicos` e `horarios_publicos`. Devolve só `item_id` e apenas se o item for da mesma barraca (`i.barraca_id = b.id`), `ativo` e não `preco_aberto`. O esgotado é decidido no cliente, a partir de `linhas`, porque ele depende das opções.
- `cardapio_publico` **não é tocada**. Ganhamos: nenhum risco de regressão na função mais usada, e o cardápio degrada sozinho se a migration ainda não estiver aplicada (a chamada falha e o destaque simplesmente não aparece, como já acontece com `opcoes_publicas`, l.722-730).
- O front chama `destaque_publico` ao lado das outras chamadas de carga (uma request a mais, paralela, sem bloquear a tela) e cruza o `item_id` com `linhas`.
- **Segurança:** o dono só consegue escolher item da própria barraca porque o seletor em Ajustes só lista os itens dela; mesmo que alguém grave um `item_id` de outra barraca por chamada direta, a função filtra por barraca e devolve nada. O construtor deve conferir que a RLS atual de `barracas` permite ao dono atualizar essa coluna pelo mesmo caminho dos outros campos (hook `useSalvarBarraca`) e deve acrescentar a coluna a `src/types/database.ts`.
- **Rollback:** `drop function public.destaque_publico(text); alter table public.barracas drop column item_destaque_id;`. Sem dependência de dados.
- **Ordem de deploy:** migration → app. App novo com migration ausente funciona (sem destaque).

**Ajustes. [Escolha do assistente]** Em `SecaoCardapioDigital` (`Ajustes.tsx` l.1411), logo abaixo do link de compartilhar, um campo "Item em destaque" com um seletor dos itens da barraca que estão ativos, não esgotados e não de preço aberto, mais a opção "Nenhum". Salva na hora, como os outros campos de barraca. Uma só escolha por barraca por construção (é uma coluna, não uma flag por item). Texto de apoio curto: mostra o item no topo do cardápio com o preço normal dele; se ele esgotar, o destaque some sozinho. Preferimos isto a um toggle dentro do formulário do item (como "Popular"), porque o toggle por item obrigaria a desligar o anterior a cada troca.

## 7. Como medir o sucesso

**[Decisão do dono]** O objetivo é mais pedidos. A métrica é **número de pedidos por semana por barraca, antes e depois** do lançamento. Sem contador de visitas e sem alterar a Política de Privacidade; "pedidos por visita" não será medido.

**Estado da telemetria (conferido).** Não existe contagem de visitas ao cardápio: a Política de Privacidade afirma que o app não usa ferramentas de analytics nem rastreamento de comportamento (`src/pages/Privacidade.tsx` l.432), e a busca por código de analytics/pageview em `src/` e nas funções não encontrou nada. A telemetria que existe é a do assistente de configuração (`onboarding_eventos`), que não serve para isto. `cardapio_pedidos_log` guarda só tentativas de pedido, com retenção de 2 dias (`20261026130000_retencao_logs.sql`), então também não serve como histórico. Não confirmei uma coluna de "origem" em pedidos que separe pedido do cardápio público de pedido do balcão.

**[Escolha do assistente]** Como medir com o que existe: comparar as 2 a 4 semanas antes e depois do lançamento, sempre por barraca, em barracas de movimento estável. O construtor entrega uma consulta que conta os pedidos originados no cardápio público (por exemplo, pedidos cujo pagamento passou por `criar-pagamento-pix` ou `criar-pedido-cardapio`), ou declara por escrito que não há fonte confiável. Observação qualitativa em 2 ou 3 barracas, abrindo o cardápio com o João e vendo se o cliente toca no destaque e nos botões, complementa os números.

## 8. Riscos

- **Excesso de mostarda / parede de botões.** Mais de uma dezena de botões mostarda visíveis por tela contraria o espírito de "um primário". Mitigação: leitura A (5.3), esgotado neutro, carrinho em tinta; testar em celular real; plano de recuo descrito em 5.3.
- **Cards horizontais maiores.** O botão de largura total dentro do card de 144px aumenta a altura; as rolagens ocupam mais da primeira tela e o "Mais pedidos" pode ficar abaixo da dobra. Mitigação: manter o destaque compacto e conferir se a primeira tela ainda mostra o destaque e o início de Mais pedidos num celular de 360 a 390px de largura.
- **Alvo de toque.** Hoje há botões de 32px e 20px nos cards horizontais; a troca precisa levar tudo para pelo menos 44px.
- **Dependência da migration.** Sem a migration, não há destaque (degrada bem); com a migration e sem RLS correta, o dono não consegue salvar. Cobrir com teste no ambiente de staging.
- **Item repetido em várias seções.** O mesmo item pode aparecer em destaque, Mais pedidos, Populares e lista. O contador é o mesmo, então não há inconsistência, mas o cliente pode achar repetitivo. Aceito de propósito (5.2).
- **Fora do horário: bloqueio só na tela.** O servidor só recusa pedido com loja fechada quando o dono liga `bloquear_fora_do_horario` (padrão desligado). Com a decisão do João a tela desabilita os botões, mas o servidor continua aceitando pedido por chamada direta se o dono não ligou o bloqueio. Aceito nesta versão (5.8). Além disso, a tela calcula "aberto/fechado" no relógio do visitante e o servidor usa o fuso da barraca; um visitante em outro fuso pode ver o estado errado. Barraca sem horário (ou com todos os dias fechados) conta como sempre aberta.
- **Dark pattern.** O cliente nunca é levado ao checkout sem tocar; total e remoção permanecem visíveis. Não há contadores de urgência, escassez falsa nem pré-seleção de itens.
- **Regra de tema.** O CLAUDE.md precisa ser atualizado para registrar a leitura A de "um primário por tela" no cardápio público; sem isso, a próxima revisão pode "corrigir" de volta.

## 9. O que fica para o construtor

**[Decisão do dono]** Layout fino, espaçamentos, microcopy do botão do destaque e animações.

Além disso, ficam com o construtor (sem precisar de nova decisão do João):

- Texto do rótulo do herói e do texto de apoio em Ajustes.
- Proporção da foto no herói e o que fazer sem foto.
- Se `BotaoAdicionarCompacto` é removido ou vira uma casca de `BotaoAdicionar`.
- Mecânica exata do seletor de Ajustes (componente de seleção já existente no projeto).
- Nome e timestamp da migration (depois da mais recente, `20261103110000_modulos_admin.sql`).
- Testes: componente de estado do botão (simples, com opções, esgotado, com quantidade), regra de quando o destaque aparece (extrair em função pura, testável), e `tests/icones.test.ts` continua verde.
- Atualização do trecho "Cardápio Digital" e da regra "um primário por tela" no `CLAUDE.md` junto do PR de construção.

## 10. Decisões complementares e perguntas abertas (resultado da checagem do construtor)

### Escolhas do assistente (tomadas depois da checagem)

- **Lançamento sem flag.** A mudança vai para todas as barracas de uma vez: não há dado novo obrigatório, tudo degrada sem destaque, e manter dois caminhos de renderização dobraria testes. Por isso a comparação "antes e depois" (seção 7) é feita no tempo, por barraca, e não entre barracas com e sem a mudança. Plano de recuo: reverter o PR de interface; a migration é aditiva e pode ficar.
- **Portão de aceite visual.** Antes de mesclar, o João confere o cardápio num celular real, em pelo menos uma barraca com destaque, banner, mais pedidos e populares. Se ficar "amarelo demais", aplica-se o recuo da seção 5.3 (herói com borda mostarda). A decisão final do visual é do João.
- **Definição de pronto do layout.** Num celular de 360 px de largura, a primeira tela deve mostrar o selo/horário, o destaque (quando existir) ou o início de Mais pedidos, sem que os botões de pedir fiquem abaixo de 44 px. Se não couber, o construtor reduz a foto do herói e esconde a descrição dos cards horizontais antes de mexer em qualquer regra de produto.
- **Fonte da métrica.** Critério de aceite: o construtor entrega uma consulta que conta pedidos originados no cardápio público por semana e por barraca, ou declara por escrito que não há fonte confiável.

### Perguntas abertas

Nenhuma. As duas perguntas que restavam foram respondidas pelo João e estão registradas nas seções 5.8 (fora do horário) e 7 (métrica).
