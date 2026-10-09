# Onboarding de configuração inicial — design

Data: 2026-10-08. Fonte: pedido do orquestrador/João (referência de ideia: o assistente inicial da Brendi; **não** copiar marca, mascote nem texto). Status: **só especificação, aguardando revisão do dono do produto. Nenhum código.**

## Objetivo
Quem cria a conta (por e-mail ou Google) é levado a configurar, em passos curtos e um por tela, o básico que sempre fica "para depois": nome da marca com link do cardápio, CNPJ, endereço, horário, pagamento e modos de atendimento. Cada passo salva na hora, tem barra de progresso e voltar/avançar. O essencial não se pula; o resto pode ficar para depois, mas vira checklist com porcentagem no Hub até completar.

## Estado atual (auditado em origin/main)
- `Onboarding.tsx` (rota `/onboarding`): carrossel de **4 telas ilustrativas** mostrado só no 1º acesso do aparelho (`onboardingJaVisto()` em localStorage, decidido pelo `Dispatcher` **antes do login**). Não configura nada.
- `SelecionarBarraca.tsx`: quem não tem barraca vê "Vamos criar sua barraca" com nome + slug (`gerarSlug`, editável) e chama `criar_barraca(p_nome, p_slug)`, que valida o formato do slug, recusa duplicado ("Esse endereço já está em uso") e cria a barraca com `metodos_pagamento_ativos = [dinheiro, debito, credito, pix]` e o dono em `usuarios_barracas`. Depois cai direto no Hub.
- Tudo o mais é configurado em **Ajustes**, espalhado: CNPJ (`cnpj`, seção Fiscal), horários (`SecaoHorarioFuncionamento` sobre a tabela `horarios_funcionamento`: um registro por dia 0–6 com `aberto`, `hora_abertura`, `hora_fechamento`), métodos (`metodos_pagamento_ativos`), modos (`modos_atendimento`, `SecaoModosAtendimento`), taxa de entrega (`taxa_entrega_*` e `taxas_entrega_bairro`), Pix online (`SecaoPagamentoOnline`: exige token do provedor, em RPC fechada) e "Pagar na entrega" (`whatsapp_pedidos`).
- **Não existe** endereço da loja próprio (hoje só `emitente_endereco`/`procon_endereco`, textos livres do fiscal), categoria do negócio nem origem ("como conheceu").
- Hub (`Dashboard.tsx`) tem um `TourGuiado` de dicas; não tem checklist de pendências.

## Decisões propostas (a confirmar com o dono)
| # | Proposta |
|---|---|
| 1 | O assistente roda **depois do login e da criação da barraca**, uma vez por barraca, e funciona igual para quem entrou por e-mail ou Google. |
| 2 | O carrossel de 4 telas **continua** como "boas-vindas" pré-login (curto, só ilustra); o assistente é outra coisa, pós-login. Sem unificar nesta fase. |
| 3 | A barraca nasce no **passo 3** (nome + link), não antes: até lá o dono ainda não tem barraca e os passos 1–2 gravam no usuário. |
| 4 | Obrigatórios (não têm "fazer depois"): **nome/link, horário, formas de pagamento, modos de atendimento**. Opcionais: origem, categoria, CNPJ, endereço, taxa, Pix online. |
| 5 | Progresso salvo a cada passo; fechar o app e voltar retoma do passo certo. |
| 6 | Pendências viram **checklist no Hub com % concluída** até 100%. |

## Fluxo e passos
Barra de progresso no topo ("Passo 4 de 10"), botão principal mostarda "Continuar" (um primário por tela), "Voltar" ghost, "Fazer depois" ghost só nos opcionais. Identidade Sai aê (mostarda e tinta, canto balão em selos, toque ≥ 44 px, mobile-first; desktop em coluna central). Texto simples, sem jargão.

1. **Como conheceu o Sai aê** (opcional). Chips: Anúncio, Instagram, TikTok, YouTube, Google, Indicação, Panfleto, Outro (com campo curto se "Outro"/"Indicação: quem?"). Grava `origem` do usuário (ver Dados). Passo do **usuário**, antes de existir barraca.
2. **Categoria principal** (opcional). Cards: Lanches, Pizza, Marmita/PF, Oriental, Açaí, Doces e bolos, Pastel/salgados, Bebidas, Churrasco, Outra. Grava `categoria_negocio` (1 valor). Serve só para personalizar dicas e segmentar depois; não muda comportamento do app.
3. **Nome da marca e link do cardápio** (obrigatório). Campo nome → **gera o slug** sem acento, minúsculo, só `a-z0-9-` (reaproveita `gerarSlug`), mostrando em tempo real o link final `app.saiae.com.br/<slug>` (via `urlPublica`) com botão "copiar". Checagem de disponibilidade **ao digitar** (RPC pública `slug_disponivel(p_slug)`, sem expor outros dados) e sugestões quando ocupado (`<slug>-2`, `<slug>-<bairro>` quando houver). O slug é editável uma vez aqui, com aviso "depois de divulgar o link, trocar quebra os links antigos". Reservados (`login`, `cadastro`, `onboarding`, `ajustes`, `e`, `selecionar-barraca`, etc.) são recusados com a mesma lista usada pelas rotas. Cria a barraca (`criar_barraca`). Resolve o "restaurante-paulo" porque o dono vê e confirma o link **antes** de seguir.
4. **CNPJ** (opcional, liga o fiscal). Campo com máscara; ao completar 14 dígitos, **consulta automática** do nome empresarial/fantasia, situação e endereço. Escolha: edge function `consultar-cnpj` (servidor chama BrasilAPI/ReceitaWS; o navegador **não** chama terceiros e o CNPJ não vai para log) com cache curto. Resultado preenche `cnpj`, `emitente_razao_social` e **sugere** o endereço do passo 5. Alternativa explícita "Sou MEI / ainda não tenho CNPJ" (grava `sem_cnpj = true`, pendência opcional "Adicionar CNPJ" no checklist). Não habilita fiscal sozinho: só preenche; ativar NFC-e continua em Ajustes › Fiscal (token da FocusNFe).
5. **Endereço da loja** (opcional, campo próprio novo). Busca por endereço (CEP → ViaCEP via edge function, ou texto livre) preenchendo rua, número, bairro, cidade, UF, complemento. Grava colunas próprias (ver Dados). Alimenta: cardápio público (rodapé/"Como chegar"), Procon da comanda (`procon_endereco` pode ser sugerido a partir dele) e emitente da NFC-e (sugestão, com confirmação).
6. **Horário de funcionamento** (obrigatório, mas com padrão sugerido). **Modelos**: Almoço (11–15h), Jantar (18–23h), Almoço e Jantar (dois turnos? **v1: um intervalo por dia**, ver Fora de escopo), Fim de semana (sáb–dom), mais "Personalizado". Lista dos 7 dias com toggle aberto/fechado e dois horários; botão **"Igual ao dia anterior"** por dia. Grava em `horarios_funcionamento` (mesma tabela e mesma tela de Ajustes, que continua editando). Mostra "Aberto agora/Fechado" como prévia.
7. **Formas de pagamento** (obrigatório ≥ 1). Aceitas no balcão/entrega/retirada: Dinheiro, Débito, Crédito (o app já suporta; valem para `metodos_pagamento_ativos`). **Vales (refeição/alimentação)**: fora da v1 (exigiria novo método no CHECK de `pedidos` e relatórios); o passo oferece "Outras formas" só como texto informativo no cardápio, sem alterar contas. Abaixo, **Pix online** como cartão separado e opcional: explica o benefício e leva para o passo guiado de Pagamento online (token do provedor colado **só** no campo seguro de Ajustes; nada de segredo no assistente). "Fazer depois" cria pendência "Ativar Pix online".
8. **Modos de atendimento** (obrigatório ≥ 1): Mesa, Balcão, Retirada, Entrega (cards com explicação de uma linha). Grava `modos_atendimento` (mesma regra de "ao menos um ativo"). Marcar Entrega abre o passo 9.
9. **Entrega: taxa** (só se Entrega; opcional com "fazer depois"). Hoje existe taxa fixa/padrão (`taxa_entrega_*`) e **por bairro** (`taxas_entrega_bairro`, com "colar lista"). O passo oferece: "Taxa única" (valor) ou "Por bairro" (adiciona bairros; ou cola a lista). **Raio/rota não existem**; não aparecem (anotar como evolução). Sem taxa definida, o checklist mantém "Definir taxa de entrega" (o cardápio público já exige Entrega finalizável).
10. **Tela final "Preparando a cozinha…"**: animação curta (2–3 s, reduzida com `prefers-reduced-motion`), resumo do que foi feito, o **link do cardápio** com copiar/compartilhar e dois botões: "Ir para o Hub" (primário) e "Cadastrar meus itens". Marca o assistente como concluído.

## Obrigatório x opcional e retomada
- O dono **não consegue sair** dos 4 obrigatórios sem preenchê-los: o botão fica desabilitado com a explicação do que falta. Fechar o app no meio é permitido (nada se perde); ao voltar, o `Dispatcher` manda para o passo pendente enquanto os obrigatórios não estiverem completos. A barraca já existe depois do passo 3, então o sistema não fica numa "casca": se o dono abandonar entre os passos 3 e 8, ao reabrir cai de volta no assistente.
- Barraca **existente** (criada antes desta feature) **não** passa pelo assistente forçado: recebe o **checklist** no Hub com o que estiver faltando (calculado, ver abaixo) e pode abrir o assistente por "Configurar o que falta".
- Quem tem várias barracas: o assistente é por barraca; novas barracas passam por ele.

## Checklist de pendências no Hub (Dashboard)
Cartão "Falta pouco para vender" com barra e **% concluída**, visível até 100% (some sozinho; há "ocultar" por 7 dias). Itens e peso:

| Item | Critério de concluído (calculado, não digitado) | Peso |
|---|---|---|
| Nome e link do cardápio | barraca existe | obrigatório (sempre feito aqui) |
| Horário | ≥ 1 dia `aberto` em `horarios_funcionamento` | 15 |
| Formas de pagamento | `metodos_pagamento_ativos` não vazio | 10 |
| Modos de atendimento | `modos_atendimento` não vazio | 10 |
| Primeiro item no cardápio | ≥ 1 linha em `itens` | 20 |
| Endereço da loja | colunas de endereço preenchidas | 10 |
| CNPJ (ou "sem CNPJ") | `cnpj` preenchido ou `sem_cnpj` | 10 |
| Taxa de entrega | se Entrega ligada: taxa padrão > 0 ou ≥ 1 bairro ativo | 10 |
| Pix online | `pagamento_online_habilitado` e token configurado | 10 |
| Logo (opcional, sugestão) | `logo_url` | 5 |
Cada item aberto leva direto à tela certa (assistente no passo ou seção de Ajustes). Pesos ajustáveis; a % é só uma conta no cliente a partir de dados que já existem (RPC `onboarding_progresso(p_barraca_id)` para evitar 8 consultas).

## Dados a gravar (tudo aditivo; migration única, versão ≥ a mais nova da main)
- **Usuário** (origem e estado do assistente do dono, **não** da barraca, porque o passo 1 vem antes da barraca): tabela nova `perfis_usuario` (`usuario_id` PK → `auth.users on delete cascade`, `origem_aquisicao text` com CHECK da lista, `origem_detalhe text` ≤ 60, `criado_em`). RLS: o próprio usuário lê/insere/atualiza o seu.
- **Barraca** (colunas novas, todas nullable ou com default):
  - `categoria_negocio text` (CHECK da lista);
  - `endereco_cep`, `endereco_rua`, `endereco_numero`, `endereco_complemento`, `endereco_bairro`, `endereco_cidade`, `endereco_uf` (tamanhos limitados; UF com CHECK de 2 letras);
  - `sem_cnpj boolean not null default false`;
  - `onboarding_etapa smallint not null default 0` (último passo concluído), `onboarding_concluido_em timestamptz null`, `checklist_oculto_ate timestamptz null`.
  Barraca existente fica com `onboarding_concluido_em = null` mas **não** é forçada ao assistente (regra acima baseada em `criada_em` anterior à migration → backfill `onboarding_concluido_em = criada_em`).
- **RPCs** (SECURITY DEFINER, checam `usuario_tem_acesso_barraca`): `slug_disponivel(p_slug)` (só booleano, para autenticado), `onboarding_salvar_passo(p_barraca_id, p_etapa, p_dados jsonb)` (valida e grava só campos conhecidos daquele passo; idempotente), `onboarding_progresso(p_barraca_id)`.
- **Edge functions**: `consultar-cnpj` e `buscar-cep` (JWT do usuário; limite por usuário/hora; sem guardar o CNPJ/CEP consultado em log; timeout curto; falha de terceiro = "Não deu para buscar; preencha à mão").
- **Reaproveita sem mudar**: `criar_barraca`, `horarios_funcionamento`, `metodos_pagamento_ativos`, `modos_atendimento`, `taxa_entrega_*`/`taxas_entrega_bairro`, `cnpj`/`emitente_*`, `SecaoPagamentoOnline`. Para reaproveitar **os componentes** das seções de Ajustes (hoje acoplados à página): extrair "campo + salvar" para componentes reutilizáveis (`CampoHorarioDia`, `SeletorModos`, `SeletorMetodos`) usados pelo assistente e por Ajustes, sem duplicar regra.

## Impacto no `Onboarding.tsx` e no roteamento
- `Onboarding.tsx` (carrossel) **não muda** nesta fase; segue como boas-vindas pré-login. O texto da última tela passa a apontar para "Criar conta".
- Nova rota `/configurar` (protegida, fora do layout de barraca até existir barraca) com o assistente; o `Dispatcher` ganha: sem barraca → assistente passo 1; com barraca e obrigatórios incompletos (e `onboarding_concluido_em` nulo) → `/configurar` no passo pendente; caso contrário, fluxo atual.
- `SelecionarBarraca` deixa de ser a porta de entrada da **primeira** barraca (o passo 3 a substitui); continua para quem tem 2+ barracas ("Nova barraca" abre o assistente a partir do passo 3).
- Google: o retorno do OAuth cai no `Dispatcher` como hoje e entra no mesmo fluxo (sem passo extra); o trial de 7 dias já nasceu no trigger.

## Telemetria mínima (sem dado pessoal)
Eventos em tabela `onboarding_eventos` (barraca_id/usuario_id, `passo`, `acao` = visto|concluido|pulado|abandonou, `criado_em`; sem texto livre): conversão por passo, onde abandonam, % de lojas com checklist completo em 7 dias. A origem e a categoria já são o dado de marketing. Nada de IP, CNPJ ou endereço na telemetria. Painel interno por consulta SQL (fora do app).

## LGPD
- Coletamos: origem (marketing do próprio Sai aê, sem identificar além do usuário), categoria, endereço comercial (dado da empresa, não pessoal), CNPJ (dado público de empresa; MEI pode ser pessoa física: tratar como dado do titular, uso só fiscal/identificação da loja). Finalidade e base legal (execução do contrato/legítimo interesse) entram na Política de Privacidade (seção 2) — atualizar junto.
- Consulta de CNPJ/CEP por terceiros: informar na política; o servidor, não o navegador, faz a chamada; sem guardar a resposta além do que o dono confirmar.
- "Excluir conta" apaga `perfis_usuario`, as colunas na barraca (a barraca é apagada) e `onboarding_eventos` do usuário/barraca.
- Telemetria sem identificadores diretos; opt-out não necessário por não conter dados pessoais (confirmar com o dono).

## Plano de testes
**Unidade (Node):** geração de slug (acentos, espaços, símbolos, tamanho, só hífens, reservados); sugestões de slug; máscara/validação de CNPJ (dígitos verificadores); modelos de horário → 7 registros e "igual ao dia anterior"; validação de intervalo (fecha depois de abre; virada de meia-noite herda a regra atual); cálculo da % do checklist (pesos, itens que dependem de Entrega); mapeamento passo → retomada.
**Banco (staging):** RLS (usuário A não lê/escreve `perfis_usuario`/passos de B nem de barraca alheia); `slug_disponivel` não vaza dados; `onboarding_salvar_passo` rejeita campo desconhecido e é idempotente; backfill das barracas antigas; CHECKs (categoria, UF).
**Fluxo (navegador, 375 px e desktop):** conta nova por e-mail e por Google → passos 1–10 → cardápio público abre no slug gerado; abandonar no passo 5 e voltar (retoma); recusar slug ocupado e aceitar sugestão; CNPJ válido com consulta fora do ar (preenchimento manual); "fazer depois" nos opcionais e conferência do checklist/% no Hub; barraca antiga vê só o checklist; segunda barraca; modo escuro; toque ≥ 44 px; leitor de tela nos chips e na barra de progresso.
**Segurança:** edge functions exigem JWT e respeitam limite; nenhuma chamada de terceiro parte do navegador; slug reservado não passa; segredos do Pix nunca passam pelo assistente.
**Regressão:** `criar_barraca` e Ajustes continuam funcionando sem o assistente; carrossel inalterado; trial e assinatura inalterados.

## Fora de escopo
Vales como método real; dois turnos por dia no horário (v1: um intervalo por dia; "Almoço e Jantar" aparece como modelo de **um intervalo contínuo 11–23h** com aviso, ou fica para a v2 se o dono quiser turnos); raio/rota de entrega; cadastro de itens dentro do assistente (vai ao Hub/Ajustes); importação de cardápio; assistente para funcionários; multilíngue.

## Perguntas em aberto
1. **Dois turnos por dia** ("Almoço e Jantar" de verdade) entram já ou na v2 (exige mudar `horarios_funcionamento` para várias faixas por dia)?
2. O assistente deve ser **obrigatório para barracas antigas** também (hoje: só checklist)?
3. Aceita a consulta de CNPJ/CEP por **terceiros gratuitos** (BrasilAPI/ViaCEP) ou prefere outro provedor?
4. Pesos do checklist e quais itens contam para os 100%.
5. Vales: vale a pena já neste ciclo, mesmo exigindo mexer em métodos de pagamento e relatórios?
