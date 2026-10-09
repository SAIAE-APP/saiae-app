# Kits iniciais por tipo de negócio — design

Data: 2026-10-09. Fonte: pedido do orquestrador (lacunas L11 e L12 de `AUDITORIA-LACUNAS-POR-NEGOCIO.md`, seções 3 a 5). Status: **especificação para aprovação. Nenhum código ainda. PR só documento.**
Base lida: `origin/main` em `33069f5` (#132). Depende do assistente de configuração (`2026-10-08-onboarding-configuracao-design.md`, PRs 1 a 6 já na main, atrás de `VITE_ONBOARDING_CONFIG`).

## Objetivo
Quem cria a conta e escolhe o tipo de negócio sai do assistente com um **cardápio de exemplo montado**: categorias, itens, grupos de opções (Tamanho, Adicionais, Ponto da carne, Mistura etc.), modos de atendimento e horário típicos do tipo. Meta: **primeira venda em 10 minutos**, sem o dono montar tudo do zero e sem descobrir sozinho que existe "Opções" (L12). O kit é um **ponto de partida honesto**: nada nele pode ser vendido por engano, e o dono completa os preços antes de ativar.

## Fora de escopo
Preços reais (o app não sabe o preço de ninguém); fotos; formas de pagamento (continuam no passo 7); meio a meio, quantidade por opção, opções que mudam com o tamanho, venda por peso, ficha/saldo, cardápio do dia, combo com estoque (lacunas L1 a L10 da auditoria, ficam para suas próprias specs); tipos sem kit (Oriental, Bebidas, Churrasco: vazio por enquanto); recriar ou atualizar o kit depois de aplicado; kit para barraca existente.

## Estado atual (provas no código)
- O passo 2 do assistente só grava `categoria_negocio` (10 valores, `CATEGORIAS` em `src/lib/onboardingConfig.ts`). Nada é criado ✔ (auditoria 1, linha "Onboarding").
- Estrutura que o kit preenche (todas com RLS por `usuario_tem_acesso_barraca`): `categorias` (nome, ordem), `itens` (nome, `preco_centavos`, `ativo`, `categoria_id`, `descricao`, `ordem`…), `grupos_opcoes` (`tipo` variacao|adicional, `min_escolhas`, `max_escolhas`, `ordem`, `ativo`), `opcoes` (`preco_centavos`, `ativo`, `esgotado`, `ordem`), `itens_grupos` (liga item e grupo). Migration `20261015100000_opcoes_schema_resolver.sql`.
- Regras do banco que o kit precisa respeitar: **variação** é no máximo uma por item, sempre `min = max = 1`, preço **absoluto** que substitui o do item; **adicional** tem min/max livres (0 a 20, max vazio = sem limite); nome de grupo e de opção até 60 letras; preço da opção de 0 a 99.999.999.
- Item só chega ao cardápio público se `itens.ativo = true` (todas as versões de `cardapio_publico` têm `join itens ... and i.ativo = true`). Grupo obrigatório sem nenhuma opção disponível deixa o item **não pedível** (`docs/opcoes.md`).
- `opcoes_habilitado` nasce `false` e hoje só o dono liga, em Ajustes › Opções (`SecaoOpcoes.tsx`). Nada no onboarding o liga (L12 ✔).
- Reaproveitar sem mudar: `MODELOS_DE_GRUPO` (`tamanho` = Pequeno/Médio/Grande; `adicionais` = Queijo extra/Bacon/Ovo), `rascunhoVazio`, `opcaoVazia`, `validarRascunho`, `limitesDoGrupo` (`src/lib/opcoesCadastro.ts`), `MODELOS_HORARIO`/`aplicarModelo` (`onboardingConfig.ts`), `TODOS_OS_MODOS` (`atendimento.ts`).

## Decisões propostas (a confirmar com o João)
| # | Proposta | Por quê |
|---|---|---|
| K1 | **O kit nunca cria nada vendável.** Itens nascem `ativo = false` e com preço 0. Opções de **variação** nascem `ativo = false`. Opções de adicional que custam dinheiro (Bacon, Borda, Extras) também. Só ficam ativas as opções de preço 0 por natureza (Ponto da carne, Mistura, Acompanhamentos grátis). | Preço 0 em variação **substitui** o preço do item (cobraria R$ 0,00) e item ativo com preço 0 apareceria no cardápio público. Inativo = invisível e seguro. Variação sem opção ativa deixa o item não pedível, mais uma trava. |
| K2 | O dono completa na tela **"Revisar cardápio de exemplo"**: lista os itens e opções do kit com campo de preço e um "usar este item" por linha; salvar ativa só o que ele marcou e preencheu. Item que ele não quer, ele apaga ou deixa desligado. | O kit é rascunho; a ativação é um ato do dono. |
| K3 | **Horário e modos viram sugestão pré-selecionada** nos passos 6 e 8 (que continuam obrigatórios e só gravam quando o dono toca "Continuar"). O kit **não grava** horário nem modos por conta própria. | Respeita a regra "o obrigatório é confirmado pelo dono" e nunca sobrescreve nada. Se o dono já gravou o passo (retomada), vale o que está no banco. |
| K4 | O **catálogo dos kits vive no app** (`src/lib/kitsIniciais.ts`), montado com os mesmos tipos do cadastro de opções. O banco recebe o conteúdo em JSON, **valida o formato e os tetos** e grava; ele não guarda o catálogo. | Um lugar só para editar texto de kit; sem duplicar em SQL. O pior que um JSON adulterado faz é encher o próprio cardápio do dono, dentro dos tetos. |
| K5 | O kit é escolhido **no passo 2** (depois da categoria) e **aplicado ao fim do passo 3**, logo depois de a barraca ser criada. Sem número de passo novo. | Não mexe na numeração de `PASSOS`, nos CHECKs de `onboarding_etapa`/`onboarding_eventos` (1 a 10) nem na lógica de retomada por número. A barraca só existe a partir do passo 3. |
| K6 | O banco **liga `opcoes_habilitado` junto, só se o kit tiver ao menos um grupo** e só se a barraca ainda o tem desligado. Kit sem grupos (Feira, Quermesse) não liga. | Pedido do orquestrador (L12). Ver risco R1. |
| K7 | Corrige a auditoria: **"Tamanho (opcional)" não existe como variação** (variação é sempre obrigatória). Lanchonete não leva variação; Hamburgueria usa a variação "Carnes" (Simples/Duplo), obrigatória. | Regra do banco acima. |
| K8 | Um modelo de horário novo em `MODELOS_HORARIO`: `tarde_noite` (todos os dias, 12:00 a 22:00, para o açaí). Quermesse usa "Fim de semana" e o passo 6 avisa que dá para mudar. | O passo 6 exige pelo menos um dia aberto; "sem horário fixo" não é possível hoje. |

## O assistente com o kit (sem passo novo)
1. **Passo 2 (categoria).** Depois de escolher a categoria, uma segunda faixa na mesma tela: **"Quer começar com um cardápio de exemplo?"** Chips com os kits sugeridos para a categoria (tabela abaixo), mais **"Ver outros modelos"** (todos os 8) e **"Começar do zero"**. Cada chip tem uma linha explicando o que vem ("Lanches, porções e bebidas, com adicionais. Preços em branco."). Grava `perfis_usuario.kit_inicial` (id do kit, ou `nenhum`). Opcional como o resto do passo.
2. **Passo 3 (nome e link).** Ao tocar "Continuar", cria a barraca (como hoje). **Em seguida**, se há kit escolhido, chama `onboarding_aplicar_kit`. Falha nunca trava: toast "Não deu para montar o cardápio de exemplo agora. Você faz isso depois no Hub." e segue. Sucesso mostra "Montamos um cardápio de exemplo. Você completa os preços no final."
3. **Passos 6 e 8.** Abrem com horário e modos do kit **pré-selecionados e marcados como "sugestão do seu modelo"**. Se o banco já tem valores gravados, mostra os do banco. Marcar Entrega abre o passo 9 como hoje.
4. **Tela final (10).** Com kit aplicado e itens por ativar, o botão secundário "Cadastrar meus itens" vira **"Completar preços do cardápio"** (abre K2). "Ir para o Hub" continua primário.
5. **Hub.** O cartão "Falta pouco para vender" ganha o item **"Completar os preços do cardápio de exemplo"** (K2) enquanto houver itens do kit sem preço, e o item opcional **"Montar um cardápio de exemplo"** para quem pulou o kit, tem a barraca ainda vazia e não escolheu "Começar do zero". Ambos só existem para barracas **elegíveis** (regra abaixo): barraca antiga não vê nada disso e a porcentagem dela não muda.

### Categoria do onboarding → kits sugeridos
| Categoria (passo 2) | Kits sugeridos |
|---|---|
| Lanches | Lanchonete · Hamburgueria |
| Pizza | Pizzaria |
| Marmita / PF | PF / marmita |
| Açaí | Açaí |
| Pastel e salgados | Pastelaria · Feira |
| Doces e bolos | Feira |
| Outra | Quermesse · Feira |
| Oriental, Bebidas, Churrasco | nenhum sugerido (só "Ver outros modelos" e "Começar do zero") |

## Biblioteca de modelos de opções
Pedido do João: variações e adicionais devem cobrir **todos os tipos de foodservice**, não só os 8 kits. Os kits passam a ser **receitas que apontam para modelos da biblioteca** (`{ modelo, ajustes }`), e o dono usa os mesmos modelos sozinho em **Ajustes › Opções › "Usar modelo"**.

**Onde vive.** `src/lib/modelosDeOpcoes.ts`, no app (K4). Expande `MODELOS_DE_GRUPO` de `opcoesCadastro.ts`; os ids `tamanho` e `adicionais` e o comportamento atual continuam (a lista antiga é reexportada). Cada modelo é um `RascunhoGrupo` mais metadados: `id`, `titulo`, `descricao`, `negocios[]` (ids dos kits/categorias a que pertence) e `precisaPreco` por opção.

**Como o dono usa.**
- **Ajustes › Opções › "Usar modelo":** abre a lista com os modelos do **tipo de negócio da barraca** primeiro (`categoria_negocio` ou `kit_aplicado`) e "Ver todos" com busca por nome. Tocar abre o **formulário de grupo já preenchido** (comportamento de hoje); nada é gravado até ele salvar, e opções (P) vêm sem preço, como os modelos atuais. Depois ele escolhe a quais itens ligar.
- **Kit no onboarding:** o servidor recebe o mesmo JSON de sempre (K4); a montagem a partir dos modelos acontece no app.
- Modelos não criam nada sozinhos e nunca alteram grupo existente (sempre grupo novo; o nome repetido ganha " (2)").

**Convenções.** *Variação* = obrigatória, escolha única (min = max = 1), preço da opção **substitui** o do item. *Adicional* = preço soma. Obrigatório = `min 1`. "máx N" = limite de escolhas. **(P)** = opção com preço a preencher (nasce inativa no kit, K1). Sem (P) = preço 0 por natureza. Negócios: FE feira, QU quermesse, LA lanchonete, AÇ açaí, HB hamburgueria, PZ pizzaria, PA pastelaria, PF PF/marmita; mais categorias sem kit: OR oriental, BE bebidas/cafeteria, CH churrasco, DO doces e bolos.

### Variações (tamanho e porte)
| Id | Nome do grupo | Opções padrão | Negócios |
|---|---|---|---|
| `tamanho` (existe) | Tamanho | Pequeno, Médio, Grande (P) | todos |
| `tamanho_pizza` | Tamanho | Broto, Média, Grande, Gigante (P) | PZ |
| `tamanho_ml` | Tamanho | 300 ml, 500 ml, 700 ml (P) | AÇ, BE, LA |
| `tamanho_marmita` | Tamanho | P, M, G (P) | PF |
| `tamanho_pastel` | Tamanho | Comum, Gigante (P) | PA, FE, QU |
| `carnes` | Carnes | Simples, Duplo, Triplo (P) | HB, LA |
| `porcao` | Porção | Meia, Inteira (P) | LA, HB, CH |
| `dose_copo` | Copo | Pequeno 300 ml, Grande 500 ml, Litro (P) | BE, FE, QU |

### Adicionais de escolha obrigatória (min 1, máx 1, preço 0)
| Id | Nome do grupo | Opções padrão | Negócios |
|---|---|---|---|
| `ponto_carne` | Ponto da carne | Mal passado, Ao ponto, Bem passado | HB, LA, CH |
| `tipo_pao` | Tipo de pão | Tradicional, Australiano, Sem glúten (P) | HB, LA |
| `mistura_pf` | Mistura | Frango grelhado, Carne de panela, Peixe frito | PF |
| `bebida_combo` | Bebida do combo | Refrigerante, Suco, Água | HB, LA, PF, PA |
| `acompanhamento_combo` | Acompanhamento do combo | Batata frita, Salada, Arroz | HB, LA |
| `temperatura` | Temperatura | Gelado, Natural | BE, FE, QU, AÇ |
| `sabor_suco` | Sabor do suco | Laranja, Limão, Maracujá, Abacaxi | BE, PF, LA, FE |
| `sabor_doce` | Sabor | Chocolate, Cenoura, Fubá | DO, FE, QU |
| `leite` | Leite | Integral, Desnatado, Vegetal (P) | BE |

### Adicionais opcionais
| Id | Nome do grupo | Regra | Opções padrão | Negócios |
|---|---|---|---|---|
| `adicionais` (existe) | Adicionais | sem limite | Queijo extra, Bacon, Ovo (P) | todos |
| `adicionais_lanche` | Adicionais | sem limite | Bacon, Cheddar, Ovo, Cebola caramelizada (P) | HB, LA |
| `borda` | Borda | máx 1 | Catupiry, Cheddar, Chocolate (P) | PZ |
| `molhos` | Molhos | máx 3 | Ketchup, Maionese, Mostarda, Barbecue, Molho verde | LA, HB, PA, FE, QU |
| `acompanhamentos_pf` | Acompanhamentos | máx 4 | Arroz, Feijão, Farofa, Salada | PF, CH |
| `bebida_opcional` | Bebida | máx 1 | Suco, Refrigerante (P) | PF, LA, PA |
| `acompanhamentos_acai` | Acompanhamentos | máx 3 | Leite em pó, Granola, Banana, Paçoca | AÇ |
| `coberturas_acai` | Coberturas | máx 2 | Leite condensado, Calda de chocolate, Calda de morango | AÇ |
| `extras_acai` | Extras | sem limite | Nutella, Morango, Ovomaltine (P) | AÇ |
| `preferencias_bebida` | Preferências | máx 2 | Sem gelo, Pouco gelo, Sem açúcar | BE, FE, QU, AÇ |
| `extras_oriental` | Extras | sem limite | Shoyu extra, Wasabi, Gengibre, Hashi | OR |
| `acompanhamentos_churrasco` | Acompanhamentos | máx 3 | Vinagrete, Farofa, Pão de alho | CH |
| `embalagem_presente` | Embalagem | máx 1 | Caixa de presente (P), Sacola de papel (P) | DO |

**Contagem:** 8 variações e 22 adicionais, 30 modelos. Todo modelo passa por `validarRascunho`; nomes e opções até 60 letras; opções do kit que são (P) nascem inativas (K1).

### O que a biblioteca **não** resolve com o modelo atual (fase seguinte)
| Lacuna | Por quê não dá | O que o modelo faz hoje |
|---|---|---|
| **Meio a meio / vários sabores com preço pelo maior** (pizza, pastel misto) (L1) | O preço do adicional soma; não existe "pegar o maior" | Nada. Não há modelo "Sabores de pizza": um grupo que soma seria enganoso |
| **Quantidade por opção** ("2 bacons", "3 pastéis do mesmo sabor") (L2) | O snapshot reserva o campo, fixo em 1 | Repetir a opção com outro nome ("Bacon extra") |
| **Opções que mudam com o tamanho** (nº de sabores, preço da borda ou do extra por tamanho) (L3) | Preço do adicional é único e só há 1 variação por item | Itens duplicados por tamanho |
| **"Primeiros N grátis, o resto pago"** no mesmo grupo | Grupo tem um só preço por opção | Dois grupos (Acompanhamentos grátis + Extras), como no açaí |
| **Mínimo maior que 1 no formulário** ("escolha 3 sabores", combo de 3) | O banco aceita `min` até 20, mas `RascunhoGrupo` só tem "obrigatório" (min 1) | Ajuste **pequeno** (P): campo "mínimo" no formulário. Modelo `sabores_combo` (min = máx = N, sem repetir sabor) entra junto desse ajuste |
| **Estoque por opção / combo com baixa dos componentes** (L7) | Estoque é por item | Escolha de bebida sem baixa |
| **Preço de adicional por tamanho** (L3) | Idem | Não há |
| **Remover ingrediente com desconto** | Não existe opção negativa | Observação por item, sem desconto |

## Os 8 kits
Os kits abaixo são combinações dos modelos acima (mesmos nomes e opções; onde o kit renomeia ou reduz opções, é um `ajuste` do modelo). Onde um kit usa um grupo que a biblioteca nomeia diferente, vale a biblioteca.
Convenções: **(P)** = nasce inativo com preço 0, o dono completa. Opção sem (P) nasce ativa com preço 0. "Obrigatório" = `min = 1`. Nenhum item recebe descrição nem foto. Todo kit é validado pelo mesmo `validarRascunho` do cadastro de opções.

Grupos reaproveitam os modelos existentes: `Tamanho` = `MODELOS_DE_GRUPO[tamanho]` (com as opções trocadas quando indicado) e `Adicionais` = `MODELOS_DE_GRUPO[adicionais]`.

### 1. Feira (`feira`)
- **Categorias:** Salgados, Doces, Bebidas.
- **Itens (P):** Pastel de carne, Pastel de queijo (Salgados) · Bolo (fatia) (Doces) · Caldo de cana, Refrigerante (Bebidas).
- **Grupos:** nenhum. `opcoes_habilitado` **não** é ligado.
- **Modos sugeridos:** Balcão. **Horário sugerido:** Fim de semana.

### 2. Quermesse (`quermesse`)
- **Categorias:** Fichas, Salgados, Doces, Bebidas.
- **Itens (P):** Ficha (Fichas) · Pastel (Salgados) · Bolo (fatia) (Doces) · Refrigerante, Suco (Bebidas).
- **Grupos:** nenhum.
- **Modos:** Balcão. **Horário:** Fim de semana.
- **Aviso na escolha do kit:** "A Ficha aqui é um item comum. Saldo de ficha e visão do evento ainda não existem." (L9, L10)

### 3. Lanchonete (`lanchonete`)
- **Categorias:** Lanches, Porções, Bebidas, Sobremesas.
- **Itens (P):** X-Burger, X-Salada (Lanches) · Batata frita (Porções) · Refrigerante, Suco (Bebidas) · Pudim (Sobremesas).
- **Grupos:** **Adicionais** (adicional, opcional, sem limite): Queijo extra (P), Bacon (P), Ovo (P). Ligado a X-Burger e X-Salada.
- **Modos:** Mesa, Balcão, Retirada. **Horário:** Almoço.

### 4. Açaí (`acai`)
- **Categorias:** Açaí, Cremes, Bebidas.
- **Itens (P):** Açaí no copo (Açaí) · Creme de cupuaçu (Cremes) · Refrigerante (Bebidas).
- **Grupos:**
  - **Tamanho** (variação): 300 ml (P), 500 ml (P), 700 ml (P).
  - **Acompanhamentos** (adicional, opcional, máximo 3): Leite em pó, Granola, Banana, Paçoca (grátis).
  - **Coberturas** (adicional, opcional, máximo 2): Leite condensado, Calda de chocolate, Calda de morango (grátis).
  - **Extras** (adicional, opcional, sem limite): Nutella (P), Morango (P), Ovomaltine (P).
  - Açaí no copo: os quatro. Creme de cupuaçu: Tamanho, Coberturas e Extras.
- **Modos:** Balcão, Entrega. **Horário:** `tarde_noite` (novo, 12h às 22h).
- **Aviso:** "Venda por peso ainda não existe. Para açaí no quilo, use o valor livre quando ele chegar." (L4)

### 5. Hamburgueria (`hamburgueria`)
- **Categorias:** Hambúrgueres, Combos, Porções, Bebidas.
- **Itens (P):** Burger clássico, Burger bacon (Hambúrgueres) · Combo clássico (Combos) · Batata frita (Porções) · Refrigerante (Bebidas).
- **Grupos:**
  - **Carnes** (variação): Simples (P), Duplo (P).
  - **Ponto da carne** (adicional, obrigatório, máximo 1): Mal passado, Ao ponto, Bem passado (grátis).
  - **Adicionais** (adicional, opcional, sem limite): Bacon (P), Cheddar (P), Ovo (P), Cebola caramelizada (P).
  - **Bebida do combo** (adicional, obrigatório, máximo 1): Refrigerante, Suco (grátis).
  - Burger clássico e Burger bacon: Carnes, Ponto da carne e Adicionais. Combo clássico: Ponto da carne, Adicionais e Bebida do combo (o preço do combo é o preço do item).
- **Modos:** Mesa, Balcão, Entrega. **Horário:** Jantar.
- **Aviso:** "O combo escolhe a bebida, mas não baixa o estoque dos componentes." (L7)

### 6. Pizzaria (`pizzaria`)
- **Categorias:** Pizzas salgadas, Pizzas doces, Bebidas. (A borda é um grupo de opções, não uma categoria: corrige a auditoria.)
- **Itens (P):** Calabresa, Mussarela, Frango com catupiry (Pizzas salgadas) · Chocolate (Pizzas doces) · Refrigerante 2 L (Bebidas).
- **Grupos:**
  - **Tamanho** (variação): Broto (P), Média (P), Grande (P).
  - **Borda** (adicional, opcional, máximo 1): Catupiry (P), Cheddar (P), Chocolate (P).
  - Pizzas salgadas: Tamanho e Borda. Chocolate: Tamanho e Borda.
- **Modos:** Mesa, Balcão, Retirada, Entrega. **Horário:** Jantar.
- **Aviso na escolha do kit:** "Meio a meio e preço da borda por tamanho ainda não existem. O kit não inventa um contorno para isso." (L1, L3)

### 7. Pastelaria (`pastelaria`)
- **Categorias:** Pastéis salgados, Pastéis doces, Bebidas.
- **Itens (P):** Pastel de carne, Pastel de queijo, Pastel de frango com catupiry, Pastel de pizza (salgados) · Pastel de chocolate (doces) · Caldo de cana, Refrigerante (Bebidas).
- **Grupos:** **Tamanho** (variação): Comum (P), Gigante (P). Ligado a todos os pastéis.
- **Modos:** Balcão, Retirada. **Horário:** Fim de semana.
- **Aviso:** "Combo de 3 pastéis com sabores repetidos e pastel meio a meio ainda não existem." (L1, L2)

### 8. PF / marmita (`pf`)
- **Categorias:** Pratos do dia, Marmitas, Bebidas, Sobremesas.
- **Itens (P):** Prato feito (Pratos do dia) · Marmita (Marmitas) · Suco, Refrigerante (Bebidas) · Sobremesa do dia (Sobremesas).
- **Grupos:**
  - **Tamanho** (variação): P (P), M (P), G (P).
  - **Mistura** (adicional, obrigatório, máximo 1): Frango grelhado, Carne de panela, Peixe frito (grátis).
  - **Acompanhamentos** (adicional, opcional, máximo 3): Arroz, Feijão, Farofa, Salada (grátis).
  - **Bebida** (adicional, opcional, máximo 1): Suco (P), Refrigerante (P).
  - Marmita: Tamanho, Mistura, Acompanhamentos e Bebida. Prato feito: Mistura, Acompanhamentos e Bebida.
- **Modos:** Balcão, Retirada, Entrega. **Horário:** Almoço.
- **Aviso:** "Cardápio do dia e venda por quilo ainda não existem. Para mudar a mistura do dia, edite o grupo Mistura." (L4, L6)

Totais por kit (todos abaixo dos tetos da seção seguinte): até 4 categorias, 7 itens, 4 grupos e 4 opções por grupo.

## Regras
1. **Barraca antiga nunca recebe kit.** Coluna `barracas.kit_elegivel boolean not null default true`, e a própria migration faz `update barracas set kit_elegivel = false` nas linhas que existem naquele momento. Barraca criada depois nasce elegível, sem tocar em `criar_barraca`. A RPC recusa com `nao_elegivel` quando for `false`.
2. **Nunca sobrescreve nem mistura.** A RPC só **insere** e só roda com o catálogo **vazio**: zero categorias, zero itens e zero grupos na barraca. Se há qualquer coisa, devolve `catalogo_nao_vazio` e não grava nada. Não existe modo "mesclar".
3. **Idempotente.** Uma vez aplicado, `kit_aplicado_em` fica preenchido e uma segunda chamada devolve `ja_aplicado` (sem erro e sem duplicar). Duas chamadas ao mesmo tempo são serializadas por `pg_advisory_xact_lock` da barraca.
4. **Atômico.** Tudo numa transação: se qualquer parte do JSON for inválida, nada é gravado.
5. **"Pular kit"** (`nenhum`): a barraca nasce vazia como hoje, e o Hub não insiste. Quem apenas pulou o passo 2 (`kit_inicial` vazio) ainda vê "Montar um cardápio de exemplo" no Hub; quem escolheu "Começar do zero" (`nenhum`) não vê a oferta.
6. **Só o dono** aplica (mesma checagem `usuario_tem_acesso_barraca` + papel dono do `onboarding_salvar_passo`; funcionário não).
7. **Sem texto livre do usuário no kit.** O conteúdo vem do catálogo do app; o banco limpa espaços, recusa nome vazio e corta no limite.

## Dados e RPC (tudo aditivo; uma migration, versão maior que `20261020120000`)
- `perfis_usuario.kit_inicial text null` com CHECK na lista (`feira`, `quermesse`, `lanchonete`, `acai`, `hamburgueria`, `pizzaria`, `pastelaria`, `pf`, `nenhum`). Gravado pelo passo 2 por `onboarding_salvar_origem` (ganha o parâmetro opcional `p_kit`, com default, então a chamada atual continua valendo).
- `barracas.kit_elegivel boolean not null default true` (+ backfill `false` das existentes), `barracas.kit_aplicado text null`, `barracas.kit_aplicado_em timestamptz null`.
- `itens.kit_exemplo boolean not null default false`: marca o que veio do kit (coluna com default, sem reescrever a tabela). "Pendente de preço" = `kit_exemplo and (preco_centavos = 0 or not ativo)`.
- `onboarding_aplicar_kit(p_barraca_id uuid, p_kit text, p_conteudo jsonb) returns jsonb`, SECURITY DEFINER, `set search_path = public, pg_temp`, só `authenticated`:
  - formato do `p_conteudo`: `{ categorias: [{ chave, nome }], grupos: [{ chave, nome, tipo, obrigatorio, maximo, opcoes: [{ nome, precisaPreco }] }], itens: [{ nome, categoria, grupos: [chave] }], opcoes_habilitado: boolean }`;
  - **tetos:** até 8 categorias, 30 itens, 6 grupos, 12 opções por grupo, nomes até 60 letras (item e categoria também), `maximo` de 1 a 20, no máximo uma variação por item, variação sempre 1/1;
  - grava na ordem do JSON (`ordem` crescente), com `kit_exemplo = true` nos itens, `ativo = false` e preço 0 nos itens, `ativo = false` nas opções `precisaPreco` e em toda opção de variação;
  - liga `opcoes_habilitado` só se `opcoes_habilitado` do JSON for verdadeiro **e** houver grupos (e só se estava `false`);
  - devolve `{ estado: 'ok' | 'ja_aplicado' | 'nao_elegivel' | 'catalogo_nao_vazio' | 'dados_invalidos' | 'sem_acesso' | 'nao_autenticado', itens, grupos }`.
- `onboarding_progresso` ganha duas chaves **só booleanas/contagem**: `kit_precos_pendentes` (inteiro) e `kit_oferta` (booleano: elegível, catálogo vazio, kit não aplicado e `kit_inicial` diferente de `nenhum`). `calcularChecklist` ganha os dois itens com `aplica`, então a porcentagem de quem não tem kit não muda. O item "Cadastrar o primeiro item" passa a ignorar item de kit sem preço (`not (kit_exemplo and preco_centavos = 0)`), só para o caso novo.
- Exclusão de conta: as colunas novas estão na própria barraca e em `perfis_usuario`, que já são apagadas (barraca por `excluir_dados_conta`, perfil por `on delete cascade`). Nenhum dado pessoal no kit; a Política de Privacidade não muda.

## Tela "Revisar cardápio de exemplo" (K2)
Lista simples por categoria. Cada item: nome (editável), campo de preço (teclado numérico, `filtrarEntradaPreco`), caixa "Usar este item". Dentro, as opções que precisam de preço (variação e extras), cada uma com o seu campo. Salvar: um item marcado e com preço > 0 fica `ativo = true`; uma variação só fica ativa com preço > 0; item marcado **sem** preço mostra o erro na linha e não salva essa linha. Item de variação cujas opções continuam todas inativas permanece não pedível (e a tela diz isso). Usa as escritas que o cadastro já tem (update em `itens`, `opcoes`); não precisa de RPC nova. Offline: o kit exige internet (é ação de gestão): "Sem internet" e tenta de novo.

## Riscos
- **R1 (Opções ligadas).** `docs/opcoes.md` manda ligar `opcoes_habilitado` só com a Cozinha mostrando as opções (SAI-010b, já na main) e com os aparelhos no build novo. **Decidido pelo João (2026-10-09):** vale só no app novo; ele vai gerar a versão nativa nova do Android, e o 1.9 não é alvo.
- **R2 (Item sem preço ativo).** Coberto por K1 (nasce inativo) e pelo teste que tenta pedir cada item/opção do kit recém-aplicado pelo `resolver_carrinho` e espera recusa.
- **R3 (Expectativa).** O kit não resolve pizza meio a meio, açaí por peso, etc. Mitigação: o aviso de uma linha em cada kit, no chip de escolha.
- **R4 (Editar o catálogo depois).** Mudar texto de kit só vale para contas novas; quem já aplicou não muda (de propósito).
- **R5 (Dono fecha o app entre o passo 3 e a aplicação).** O kit fica escolhido em `perfis_usuario`; na retomada, o assistente tenta aplicar de novo (a RPC é idempotente) antes de mostrar o passo seguinte.

## A confirmar na implementação (não consegui provar só lendo o repo)
- `itens.preco_centavos` aceita 0 e não tem CHECK de preço mínimo (a tabela `itens` é anterior às migrations e não está nelas).
- Lançar Pedido (operador) não mostra item `ativo = false` e o Realtime de itens respeita isso.
- Categoria sem item visível não aparece no cardápio público nem no Lançar Pedido (as categorias de exemplo ficam vazias até o dono ativar itens).
- A policy de `insert` em `grupos_opcoes`/`opcoes`/`itens_grupos` não atrapalha uma função SECURITY DEFINER (não deve; confirmar em staging).
- `TODOS_OS_MODOS` usa as chaves `mesa`, `balcao`, `retirada`, `entrega`.

## Plano de testes
**Unidade (Node, `npm test`)** em `tests/kitsIniciais.test.ts`: os 8 kits passam em `validarRascunho` (grupo a grupo); nenhum item vem ativo e nenhuma opção de variação vem ativa; opção de adicional com preço (P) vem inativa; nenhuma variação tem mais de uma por item; ligações só apontam grupos que existem; nomes até 60 letras e sem duplicata na mesma lista; tetos respeitados; `opcoes_habilitado` só em kit com grupo; categoria → kits sugeridos conforme a tabela; kit referenciado por `horario` existe em `MODELOS_HORARIO` (inclui `tarde_noite`); `calcularChecklist` não muda para progresso sem as chaves novas.
**Banco (staging)**, script `tests/kitsIniciais.staging.mjs` no mesmo molde de `onboardingBanco.staging.mjs` (usuários `.invalid`, aborta fora do staging): aplica cada um dos 8 kits em barraca nova; segunda chamada devolve `ja_aplicado` sem duplicar; barraca com 1 categoria ou 1 item devolve `catalogo_nao_vazio` e nada muda; barraca anterior à migration devolve `nao_elegivel`; usuário B não aplica na barraca do A (`sem_acesso`); funcionário recusado; JSON com 9 categorias, nome de 61 letras, duas variações no mesmo item ou grupo inexistente devolve `dados_invalidos` e **nada** é gravado (atomicidade); `opcoes_habilitado` fica `true` só nos kits com grupos; `resolver_carrinho` recusa todo item/opção do kit recém-aplicado e `cardapio_publico` não devolve nenhum item; depois de preencher e ativar um item pelo caminho do cadastro, ele é pedível com o preço certo; duas chamadas simultâneas gravam uma vez.
**Fluxo (navegador, 375 px e desktop):** ver roteiro abaixo; o `docs/onboarding-roteiro-e2e.md` ganha um bloco "Kits" no PR 5.
**Regressão:** conta sem kit igual a hoje; `criar_barraca`, passos 1 a 10 e checklist sem mudança; barraca antiga sem oferta de kit e com a mesma porcentagem; carrossel inalterado; Ajustes › Opções continua editando tudo o que o kit criou.

## Roteiro E2E do kit (para o PR 5)
1. Conta nova → passo 2 → "Lanches" → chips Lanchonete e Hamburgueria aparecem; "Ver outros modelos" mostra os 8; escolha Hamburgueria.
2. Passo 3 com nome e link → Continuar: cria a barraca e aplica o kit (aviso de sucesso). Falha simulada (kit com internet cortada): o assistente segue e o Hub mostra "Montar um cardápio de exemplo".
3. Passos 6 e 8 já vêm com Jantar e Mesa/Balcão/Entrega marcados como sugestão; Continuar grava; mudar um deles antes de continuar vale o que o dono escolheu.
4. Tela final → "Completar preços do cardápio": preencher o Burger clássico e as duas opções de Carnes, marcar "Usar este item", salvar. O cardápio público mostra só esse item, com Simples/Duplo e Ponto da carne.
5. Hub: o item "Completar os preços do cardápio de exemplo" mostra o que falta; a porcentagem sobe sozinha.
6. Outra conta: "Começar do zero" → barraca vazia e **sem** oferta no Hub. Outra conta: pular o passo 2 → oferta aparece no Hub e funciona.
7. Barraca antiga (seed): nenhum chip, nenhuma oferta, mesma porcentagem de antes.
8. Em Ajustes › Opções, os grupos do kit aparecem e podem ser editados; apagar um item do kit não quebra o resto.

## Plano de PRs (sempre staging, atrás de flag, sem mesclar)
Flag nova `VITE_ONBOARDING_KITS=1` (além da `VITE_ONBOARDING_CONFIG`): sem ela o passo 2 e a tela final ficam como hoje. Cada PR pequeno, base `main`:
1. **PR 1: banco (aditivo).** Migration com as colunas, o backfill de `kit_elegivel`, `onboarding_aplicar_kit`, o parâmetro `p_kit` em `onboarding_salvar_origem` e as chaves novas de `onboarding_progresso`. Teste estático da migration e `tests/kitsIniciais.staging.mjs`. **Antes do app.**
2. **PR 2: lógica pura.** `src/lib/modelosDeOpcoes.ts` (os 30 modelos, `MODELOS_DE_GRUPO` reexportado) e `src/lib/kitsIniciais.ts` (os 8 kits, categoria → kits, montagem do JSON a partir dos modelos de grupo, horário/modos sugeridos), `tarde_noite` em `MODELOS_HORARIO`, itens novos do checklist em `calcularChecklist`, testes de unidade. Sem UI.
3. **PR 3: Ajustes › Opções › "Usar modelo".** Lista os modelos do tipo de negócio da barraca primeiro, "Ver todos" com busca, abre o formulário pré-preenchido. Inclui o campo "mínimo" no formulário de grupo (e o modelo `sabores_combo`). Atrás de `VITE_ONBOARDING_KITS`.
4. **PR 4: assistente.** Faixa de kit no passo 2, aplicação ao fim do passo 3 (com retomada), sugestões nos passos 6 e 8, botão da tela final.
5. **PR 5: "Revisar cardápio de exemplo" e Hub.** A tela de preços, o item do checklist e a oferta "Montar um cardápio de exemplo".
6. **PR 6: documentação.** Bloco "Kits" no roteiro E2E, `CLAUDE.md` e uma linha em `docs/opcoes.md`.
Ordem de deploy: migration (staging, depois produção só com ordem do João e fora do horário de uso) → app com as duas flags desligadas → ligar no staging e rodar o roteiro → só então produção, primeiro numa conta de teste.

## Decisões do João (aprovadas em 2026-10-09)
1. **K1 aprovada:** itens e variações nascem **inativos** até o dono pôr o preço.
2. **K3 aprovada:** horário e modos são **sugestão** nos passos 6 e 8, não gravados pelo kit.
3. **K5 aprovada:** sem passo novo; kit escolhido no passo 2 e aplicado ao fim do passo 3.
4. **R1 resolvida:** o João vai gerar uma versão nativa nova do Android. Os kits (e as opções) **só valem no app novo**; o Android 1.9 não é alvo. Registrar no roteiro e no `CLAUDE.md` (PR 6) e conferir o número da versão antes de ligar `VITE_ONBOARDING_KITS` em produção.
5. Ainda aberto (sem bloqueio): Oriental, Bebidas e Churrasco ficam sem kit sugerido por enquanto; Quermesse e Feira entram com o aviso de que ficha e evento não existem.
