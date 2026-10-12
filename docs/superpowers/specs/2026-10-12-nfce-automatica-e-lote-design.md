# NFC-e automática e em lote — spec

Estado: **PROPOSTA — só documento, nada implementado. Aguarda decisões do dono (seção 14).**
Origem: pedido do dono (2026-10-12). Base: `emitir-nfce` com trava e reconciliação (#171), CORS (#181), plano de cifra dos tokens (#180, em andamento).

## 0. Pré-requisito (bloqueia TUDO deste documento)

**Nada daqui deve ser implementado antes da PRIMEIRA nota real em homologação funcionar de ponta a ponta.** Hoje não funcionou: a FocusNFe respondeu *"Empresa ainda não habilitada para emissão de NFCe"* (a empresa precisa estar habilitada para NFC-e na conta da FocusNFe, com certificado e dados da SEFAZ; é configuração do lado do dono/FocusNFe, não do app). Critérios de saída para começar o PR 1:

1. Uma nota em homologação chega a `autorizado` pelo botão manual do Histórico, com chave, protocolo e QR gravados.
2. O cupom fiscal sai impresso com a faixa "homologação · sem valor fiscal".
3. Os campos que o app ainda **supõe** da resposta da FocusNFe (`serie`, `protocolo`/`numero_protocolo`, `qrcode_url`; CLAUDE.md "Ressalva") foram conferidos contra a resposta real.
4. Pelo menos um caso de erro real foi visto (ex.: NCM inválido) e a mensagem apareceu legível no card.

Razão: automatizar e fazer em lote multiplica qualquer erro de payload. Uma nota autorizada em produção **não se desfaz** (só se cancela dentro de prazo e regras da SEFAZ). Sem uma emissão real inspecionada, a automação seria escrita às cegas.

## 1. Problema e objetivo

Hoje a nota só sai manualmente, **um pedido por vez**, no botão "Emitir nota fiscal" do card do Histórico (`BotaoEmitirNota` → edge function `emitir-nfce`). O dono quer:

1. **Emissão automática**, opcional, **padrão desligada** (Ajustes > Fiscal): quando o pedido é entregue/concluído, a nota é emitida em segundo plano; se falhar, o pedido fica marcado e visível para nova tentativa.
2. **Emissão em lote** no Histórico: "Emitir notas do período" para os pedidos sem nota, em fila, com progresso (X de N, Y com erro) e "tentar de novo os que falharam".

Fora de escopo: contingência offline da NFC-e (emissão sem internet), cancelamento/inutilização de nota, NF-e, envio da nota por e-mail/WhatsApp, CPF por pedido na automática (ver 4.5).

## 2. Como é hoje (fatos do código)

- `emitir-nfce` (`supabase/functions/emitir-nfce/handler.ts`): autentica o JWT, lê o pedido, confere acesso em `usuarios_barracas` (**qualquer papel**; o suporte não está nessa tabela, então não emite), devolve cedo se `autorizado`, valida `fiscal_habilitado`, CNPJ, token do ambiente, itens, pedido grátis (422), `na_entrega` sem forma definida (422), forma de pagamento mapeável (dinheiro, débito, crédito, Pix), NCM/CFOP/unidade por item, e então: consulta a ref na FocusNFe (reconciliação), **reivindica o pedido** com `UPDATE … nfce_status = 'processando_autorizacao', nfce_trava_em = agora` condicionado a trava ausente ou vencida (2 min, `TRAVA_NFCE_MS`), envia `POST /nfce?ref=<pedido_id>`, consulta até 4 vezes se ficar processando, grava `autorizado`/`erro`. Chamada concorrente leva 409 ou 202.
- `ref` = id do pedido: a FocusNFe é idempotente por ref.
- **Lacuna encontrada ao escrever esta spec:** o servidor **não recusa pedido `cancelado`**; só a tela esconde o botão (`!cancelado`). Para automação isso tem que virar regra do servidor (PR 1, seção 12).
- Taxa de entrega fica **fora** da nota por decisão do dono (2026-10-05): a nota de pedido com entrega vale menos que o cobrado. Pedido grátis (total R$ 0,00 após cupom) nunca emite.
- `corrigir_metodo_pagamento` só deixa corrigir a forma antes da nota (`nfce_chave` vazia). **Consequência para a automática:** quanto mais cedo a nota sai, menos tempo o dono tem para corrigir a forma de pagamento. Isso pesa no desenho (seção 4.2).
- Status do pedido: `a_fazer`, `pronto`, `saiu_entrega`, `entregue`, `cancelado`. `nfce_status`: `null`, `processando_autorizacao`, `autorizado`, `erro` (e `erro_autorizacao` quando a SEFAZ rejeita). Colunas: `nfce_chave/numero/serie/protocolo/qrcode_url/ambiente/mensagem/emitida_em/cpf_consumidor/tributos_centavos/trava_em`.
- Há padrão pronto de fila assíncrona no banco: `eventos_saida` (trigger grava na fila na mesma transação; `pg_cron` + `pg_net` chamam a edge function; tolerante a falta de extensão) e `expirar_pagamentos_pendentes_job`.

## 3. Decisões de arquitetura (com alternativas)

### 3.1 Onde nasce o gatilho

| Alternativa | Prós | Contras | Veredito |
|---|---|---|---|
| **A. Front** (o app, ao marcar "Entregue", chama `emitir-nfce`) | Nenhuma infra nova | Só roda com o app aberto e online; vários aparelhos podem disparar o mesmo pedido; pedido entregue pelo link do motoboy (`entregador_confirmar`) **nem passa pelo app**; fila offline reordena | **Descartada** |
| **B. Trigger no banco chamando a edge function direto** (`pg_net` por pedido) | Imediato, sem fila própria | Rajada (evento com centenas de pedidos) vira rajada contra a FocusNFe; sem recuo nem reordenação; falha de rede perde o aviso | Descartada |
| **C. Fila no banco + trabalhador (worker) acionado por `pg_cron`** | Sobrevive a app fechado/offline; um só ponto controla ritmo e recuo; serve igual à automática e ao lote; progresso é só ler a fila; auditável | Mais peças (tabela, RPCs, worker) | **Recomendada** |

Recomendação: **C**. O gatilho de banco só **enfileira** (barato, sem rede, na mesma transação do `UPDATE` do pedido); o worker faz a emissão.

### 3.2 Peças (visão geral)

1. `barracas.nfce_automatica boolean default false` e `barracas.nfce_automatica_atraso_min int` (seção 4.2). Um interruptor global de emergência por variável de ambiente do worker (`NFCE_FILA_ATIVA=0` pausa tudo).
2. Tabela `nfce_fila` (uma linha por pedido): `pedido_id` (único), `barraca_id`, `origem` (`auto` | `lote`), `lote_id` (uuid, agrupa um clique de "Emitir notas do período"), `estado` (`pendente` | `em_andamento` | `concluido` | `erro` | `ignorado`), `motivo` (código curto: `dados_fiscais`, `forma_pagamento`, `rejeitada_sefaz`, `rede`…), `mensagem`, `tentativas`, `proxima_tentativa_em`, `reivindicado_ate`, `criado_em/atualizado_em`. RLS ligada, **sem policy de escrita**; leitura só do dono da barraca (nem funcionário, nem suporte).
3. Trigger em `pedidos`: ao virar `entregue` (ou ao ter `metodo_pagamento` definido depois de `entregue`, caso do "pagar na entrega"), se `barracas.nfce_automatica` e o pedido é elegível pelas regras baratas do banco, **insere** na fila com `proxima_tentativa_em = agora + atraso`. Idempotente (`on conflict (pedido_id) do nothing`).
4. RPC `nfce_lote_enfileirar(p_barraca_id, p_de, p_ate)` (SECURITY DEFINER, só `authenticated`, **papel dono**, revoga de `anon`/`public`): seleciona os elegíveis do período e insere na fila com um `lote_id`; devolve contagem de elegíveis e de não elegíveis por motivo (a "prévia" da seção 7). Outra RPC `nfce_lote_progresso(lote_id)` e `nfce_lote_retentar(lote_id)` e `nfce_lote_cancelar(lote_id)` (só o que ainda está `pendente`).
5. **Worker** = edge function `processar-fila-nfce`, chamada por `pg_cron` a cada minuto via `pg_net` (mesmo padrão do `eventos_saida`; se não houver `pg_cron`, cai para um agendador externo). Pega um pequeno número de itens vencidos (`proxima_tentativa_em <= agora`, `estado = pendente`) com `FOR UPDATE SKIP LOCKED`, dá um *lease* (`reivindicado_ate = agora + 3 min`) e emite um por vez.
6. **Núcleo de emissão compartilhado.** Hoje a lógica vive dentro do handler HTTP (que mistura autenticação e emissão). PR 1 extrai `emitirNotaDoPedido(pedidoId, { origem })` (sem JWT, sem CORS), usado pelo handler manual e pelo worker. O handler manual continua exigindo usuário e acesso; o worker confia na fila (que só é escrita por trigger/RPC do dono).

### 3.3 Quem reivindica cada pedido (exclusão mútua)

Duas camadas, de fora para dentro:

1. **Fila:** `SKIP LOCKED` + `reivindicado_ate` impede dois workers de pegarem o mesmo item. Lease vencido (worker morreu) libera o item.
2. **Pedido:** a **trava atômica que já existe** (`nfce_status = processando_autorizacao` + `nfce_trava_em`, vence em 2 min) continua sendo a verdade final, para qualquer origem: manual, automática, lote, dois workers. O worker só considera o item "feito" quando o núcleo devolve `autorizado`. Se o núcleo responder "em andamento" (409/202), o item volta à fila com `proxima_tentativa_em = agora + 30 s` **sem gastar tentativa**. Se a nota já existe na FocusNFe (reconciliação por ref), o núcleo grava `autorizado` e o item vira `concluido`; nunca se envia um segundo `POST` para o mesmo pedido.

Idempotência: `ref = pedido_id` na FocusNFe + trava no pedido + `pedido_id` único na fila. Reprocessar qualquer etapa é seguro.

### 3.4 Concorrência com a emissão manual

- Botão manual continua existindo e **vence**: pedido que está `pendente` na fila e é emitido à mão passa por trava e reconciliação como hoje; quando o worker chegar, vê `autorizado` e fecha o item como `concluido` sem chamar a FocusNFe.
- Se o worker está emitindo e o dono clica, o dono recebe a mensagem atual de "emissão em andamento".
- Item `erro` na fila e emissão manual bem-sucedida depois: o manual grava `autorizado` no pedido; o item é reconciliado como `concluido` na próxima passada (ou ao abrir o lote).

## 4. Regras de elegibilidade

### 4.1 Tabela: entra e não entra

| Situação do pedido | Entra? | O que acontece |
|---|---|---|
| `entregue`, forma definida (dinheiro/débito/crédito/Pix), total > 0, sem nota | **Sim** | Fila |
| Já `autorizado` | Não | Ignorado (idempotente); vira `concluido` se estava na fila |
| `nfce_chave` preenchida mas status `erro`/`processando` (nota pode existir na SEFAZ) | Não emite novo envio | **Reconciliar primeiro** (consulta a ref); só reenvia se a FocusNFe responder que não existe |
| `cancelado` | **Nunca** | Regra no servidor (hoje só a tela esconde) |
| Pedido grátis (`gratis`, total após cupom = 0) | **Nunca** | `ignorado`, motivo `pedido_gratis` (o servidor já responde 422) |
| `na_entrega` / "A receber" sem forma definida | **Espera** | Não entra no lote; a automática o enfileira **quando a forma for definida** (trigger também reage a `metodo_pagamento`) |
| Forma não suportada (vale, etc.) | Não | `ignorado`, motivo `forma_pagamento`, visível |
| Algum item ativo sem NCM, CFOP ou unidade | Não | `erro` com `dados_fiscais` e lista dos itens; **não é retentado sozinho** (retentar só adianta depois de cadastrar); o lote mostra "N pedidos com dados fiscais incompletos" antes de começar |
| Barraca sem `fiscal_habilitado`, CNPJ ou token do ambiente | Nada entra | Toggle da automática nem liga (seção 6) |
| Taxa de entrega | Não bloqueia | Fica fora da nota (decisão de 2026-10-05); a prévia avisa que a nota vale menos que o cobrado |
| Pedido **muito antigo** | Limitado | Ver 4.3 |
| Pedido que já tem nota de **outro ambiente** (homologação) e a barraca agora está em produção | Não reaproveita | Tratar como sem nota? **Decisão do dono** (seção 14): nota de homologação não vale; sugerir NÃO reemitir pedidos antigos em massa |

### 4.2 Atraso antes de emitir (janela de correção)

A forma de pagamento só pode ser corrigida **antes** da nota. Emitir no instante em que o pedido é entregue tira essa janela do dono (ex.: operador marcou "Crédito" e foi "Pix"). Proposta: a automática espera um **atraso configurável** (padrão sugerido **15 min**, opções: imediato, 15 min, 1 h, "só ao fechar o caixa") antes de a linha ficar elegível. Decisão do dono (seção 14).

### 4.3 Pedido antigo

NFC-e é, por natureza, emitida no momento da venda; emitir dias depois pode ter implicação fiscal que **o contador do dono precisa validar** (esta spec não afirma prazo legal). Proposta técnica conservadora, ajustável: **automática** só para pedidos entregues **depois** de ligar (nunca retroativa); **lote** com limite de idade padrão **7 dias** (configurável até o máximo que o contador autorizar), com confirmação explícita ("Esses pedidos são de dias atrás") e a data da venda mostrada na prévia.

### 4.4 Ambiente

Homologação e produção têm tokens e comportamentos diferentes. Em homologação a automática pode ser ligada para teste (nota sem valor fiscal, selo no card). **Trocar para produção com a automática ligada exige confirmação nova** (a tela explica que, a partir dali, cada pedido entregue gera nota real e custo).

### 4.5 CPF na nota

O CPF é digitado no ato da emissão manual. Na automática e no lote **não há CPF** (consumidor não identificado), a menos que se crie um campo de CPF no pedido (fora de escopo). O card avisa: "Para colocar CPF, emita a nota manualmente antes do prazo".

## 5. Limite de taxa, recuo e custo operacional

- **Limite oficial da FocusNFe não verificado.** Uma busca pública não achou os números; esta spec NÃO inventa um. Pré-requisito do PR 3: confirmar com a documentação/suporte da FocusNFe o limite de requisições (por minuto e por empresa) e se existe resposta 429.
- Ritmo padrão, **conservador e configurável por env do worker**: no máximo **1 emissão em andamento por loja**, intervalo mínimo de **~2 s** entre emissões da mesma loja, no máximo **5 lojas em paralelo** no worker. Um lote de 200 notas leva então ~7 min por loja: aceitável (é segundo plano) e mostra progresso.
- A autorização na SEFAZ é assíncrona: o núcleo já consulta a ref até 4 vezes; se continuar `processando_autorizacao`, o item volta à fila (30 s) e **não gasta tentativa**.
- **Recuo exponencial com variação aleatória** para falhas transitórias (rede, timeout, 429, 5xx): 30 s, 2 min, 10 min, 30 min, 2 h; no máximo **5 tentativas automáticas**; depois `erro` visível com botão de tentar de novo. Erros de **validação** (4xx de dados, rejeição da SEFAZ, NCM inválido) **não** são retentados sozinhos: viram `erro` com a mensagem da FocusNFe.
- Timeout de rede **não** é prova de falha: antes de reenviar o núcleo sempre reconcilia a ref (isso já existe), evitando nota duplicada.
- Teto de segurança: o worker emite no máximo N notas por loja por passada (padrão 30) e por dia (padrão 2.000), para um defeito não gerar milhares de notas e custo antes de alguém perceber. Estourou o teto: pausa e avisa o dono.

## 6. Custo para o dono e avisos na tela

A FocusNFe **cobra por nota** (conforme o plano contratado; o app não conhece o valor). Portanto:

- Ao ligar a automática em **produção**, um modal obrigatório: "A FocusNFe cobra por nota emitida, conforme o seu plano. Com isso ligado, **cada pedido entregue** gera uma nota e um custo. Você pode desligar quando quiser; notas já emitidas não são desfeitas." + checkbox "Entendi" para habilitar o botão. Em homologação, aviso curto (sem custo, sem valor fiscal).
- No lote, a prévia mostra **a quantidade** de notas a emitir ("Vai emitir 87 notas") e o mesmo aviso de custo; o app não calcula R$ (não sabe o preço do plano).
- Em Ajustes > Fiscal, contador "Notas emitidas neste mês" (leitura de `pedidos.nfce_emitida_em`) ajuda o dono a conferir a fatura.

## 7. Experiência (resumo das telas)

**Ajustes > Fiscal** (só dono): interruptor "Emitir nota automaticamente quando o pedido for entregue" (padrão desligado); só habilita com fiscal ligado, CNPJ, token do ambiente e **zero itens ativos sem dados fiscais** (se houver, lista e atalho para corrigir); seletor de atraso; texto do custo (seção 6).

**Card do pedido (Histórico/Detalhe):** estados novos: "Nota na fila" (com horário previsto), "Emitindo nota…", "Nota com erro: <motivo>" + "Tentar de novo". O botão manual continua.

**Histórico > "Emitir notas do período"** (só dono): 1) escolhe o período (dentro do limite de idade); 2) **prévia**: "87 prontos para emitir · 5 sem forma de pagamento definida (A receber) · 3 com dados fiscais incompletos · 2 grátis (não emitem) · 4 cancelados" + aviso de custo/ambiente + "A taxa de entrega fica fora da nota"; 3) confirmar; 4) **progresso** "32 de 87 · 2 com erro" (atualiza a cada ~3 s lendo `nfce_lote_progresso`, pode sair da tela e voltar); 5) ao terminar, "Tentar de novo os que falharam" (só os retentáveis) e lista dos erros com motivo; "Cancelar" interrompe o que ainda não começou.

Ações de gestão são **online-only** (mesmo princípio de "Definir forma de pagamento"): sem internet, "Sem internet" e nada é enfileirado.

## 8. Offline e falhas parciais

- A fila é **do servidor**: pedido entregue offline sincroniza depois, o gatilho dispara no banco e a nota sai mesmo com o aparelho fechado.
- Lote: cada pedido é independente; falha de um não para os demais. Fechar o app não interrompe o lote (continua no servidor); reabrir mostra o progresso.
- Worker caiu no meio: o lease vence (3 min), a trava do pedido vence (2 min) e a reconciliação por ref evita duplicar.
- Erro ao gravar o resultado depois de autorizado (a FocusNFe autorizou, o banco falhou): o núcleo já loga a chave (#171); o item fica `erro` com `mensagem` contendo a chave, e o próximo ciclo reconcilia pela ref e grava.
- FocusNFe indisponível: recuo exponencial; ao passar de 5 tentativas vira `erro` (visível), nunca some em silêncio.

## 9. Segurança

- **Acesso do suporte NÃO emite nota.** O suporte não está em `usuarios_barracas` (por construção, ver "Acesso do suporte" no CLAUDE.md) e não terá policy nem RPC aqui. As RPCs do lote exigem `papel = 'dono'` explicitamente (não usam só `usuario_tem_acesso_barraca`, que várias policies usam sem checar papel). Teste de regressão obrigatório: usuário com acesso de suporte ativo recebe `sem_acesso` em todas as RPCs e não vê `nfce_fila`.
- **Automática e lote só configuráveis pelo dono.** O funcionário continua podendo emitir nota manual como hoje (decisão do dono se isso muda, seção 14).
- `nfce_fila` e as RPCs: RLS sem policy de escrita, `revoke ... from public, anon` (padrão do Pacote 3), leitura só do dono. O worker usa a chave de serviço no servidor, nunca exposta ao navegador.
- A fila **não guarda token nem payload fiscal**: só `pedido_id` e estado. O token continua sendo lido no núcleo, na hora da emissão.
- **Token cifrado (#180, em andamento): não conflitar.** Regra para este trabalho: o núcleo lê o token **somente** por um helper único (hoje inline em `handler.ts`; o plano do #180 centraliza a decifragem). Se o #180 entrar antes, o núcleo usa o helper dele; se entrar depois, o helper vira o único ponto a trocar. O PR 1 (extrair o núcleo) mexe em `handler.ts`: **coordenar a ordem de merge com o #180** (rebasear o que entrar depois) e não tocar nas colunas de token.
- CORS: o worker não é chamado por navegador; `processar-fila-nfce` é chamada só pelo `pg_cron`/`pg_net` com segredo próprio no cabeçalho (comparação em tempo constante), sem `Allow-Origin`.
- Auditoria: `nfce_fila` guarda `origem`, `lote_id` e quem enfileirou o lote (`enfileirado_por`), para responder "quem mandou emitir".
- Retenção: itens `concluido` há mais de 90 dias saem da fila (mesmo padrão de `limpar_logs_antigos`); a nota em si vive em `pedidos`.

## 10. Observabilidade

Painel simples no próprio lote/Fiscal: contagem por estado; log do worker com `pedido_id`, tentativa, motivo, **sem** CPF nem token; alerta (toast no app do dono ao abrir) se houver itens em `erro` há mais de 24 h. Contador diário e teto da seção 5 visíveis.

## 11. Testes previstos

Seguindo o padrão do repo (handlers com `supabase`/`fetch` simulados e PGlite para migrations):

1. **PGlite — fila e RPCs:** trigger enfileira ao virar `entregue` só com automática ligada; reage ao `metodo_pagamento` definido depois; idempotente (2 updates = 1 linha); não enfileira cancelado/grátis/`na_entrega`; RPC do lote conta elegíveis e não elegíveis por motivo; só `dono` (funcionário e **suporte** recebem `sem_acesso`); `anon` sem execute; `FOR UPDATE SKIP LOCKED` não entrega o mesmo item a duas passadas.
2. **Núcleo/worker com FocusNFe simulada:** 2 workers + 1 clique manual no mesmo pedido = **um** `POST`; timeout do `POST` e nova passada reconcilia sem duplicar; "ref já existe" com nota autorizada vira `concluido`; 429/5xx aplicam recuo (tempo fake) e respeitam o máximo de 5; erro de validação não retenta; `processando_autorizacao` não gasta tentativa; ritmo mínimo entre emissões da mesma loja; teto por passada e por dia; pedido cancelado é recusado **no servidor**; update final com erro grava a chave no log.
3. **Elegibilidade pura** (função compartilhada front/servidor para a prévia): tabela da seção 4.1 inteira, incluindo idade máxima e ambiente.
4. **UI (lógica pura):** cálculo de progresso (X de N, Y com erro), prévia por motivo, bloqueio do toggle com item sem NCM, modal de custo exigindo confirmação, troca de ambiente.
5. **Staging com FocusNFe de homologação:** lote real pequeno (5 a 10 pedidos) e um caso de falha provocada (NCM inválido); só depois do pré-requisito da seção 0.

## 12. Plano em PRs pequenos

Cada PR só vai ao ar com ordem do dono; migrations antes das functions; **automática e lote nascem desligados**.

0. **Pré-requisito (não é código do app):** primeira nota em homologação autorizada, campos reais conferidos (seção 0). Atualizar o CLAUDE.md com o resultado.
1. **Núcleo + guardas do servidor:** extrair `emitirNotaDoPedido` de `handler.ts` (sem mudar comportamento), recusar `cancelado` no servidor, helper único de leitura de token (alinhado ao #180). Testes do handler existentes continuam passando + novos.
2. **Banco:** migration `nfce_fila`, colunas em `barracas` (`nfce_automatica` false, atraso), trigger (inativo enquanto `nfce_automatica` = false), RPCs do lote, revogações, testes PGlite.
3. **Worker:** `processar-fila-nfce` + agendamento `pg_cron`/`pg_net` tolerante, recuo, ritmo, tetos, testes. Antes: confirmar limite de taxa da FocusNFe.
4. **Ajustes > Fiscal:** interruptor da automática, atraso, modal de custo, bloqueios (itens sem NCM). Ainda sem lote.
5. **Histórico:** estados novos no card; filtro "Sem nota".
6. **Histórico:** "Emitir notas do período" (prévia, progresso, tentar de novo, cancelar).
7. **Fechamento:** retenção da fila, alerta de erros antigos, roteiro de teste em `docs/` e atualização do CLAUDE.md.

Ordem de ligação em produção (decisão do dono, uma loja piloto primeiro): homologação → loja piloto em produção com atraso longo → demais.

## 13. Riscos

| Risco | Mitigação |
|---|---|
| Nota errada em produção (forma de pagamento, NCM) que não se desfaz | Atraso configurável (4.2), prévia, piloto, automática desligada por padrão, só depois da primeira nota real conferida |
| Custo inesperado (nota por pedido) | Modal de custo, contador mensal, teto diário, aviso ao trocar para produção |
| Duplicar nota | `ref = pedido_id`, trava existente, `SKIP LOCKED`, reconciliação antes de qualquer envio |
| Estourar o limite da FocusNFe/SEFAZ | Ritmo conservador, recuo exponencial, pausa; confirmar limite oficial antes do PR 3 |
| Pedido antigo emitido fora de hora | Limite de idade, confirmação, validação do contador |
| Conflito com a cifra dos tokens (#180) | Helper único de token; ordem de merge combinada; fila nunca guarda token |
| Worker parado sem ninguém notar | Alerta de itens em `erro` há mais de 24 h; kill switch visível; logs sem dado pessoal |
| Mudança de NCM entre a venda e a emissão | A nota usa o cadastro atual do item (como o manual hoje); aceito e documentado |
| Funcionário esvaziando limite/custo | Lote e interruptor só do dono; teto diário |

## 14. O que o dono decide

1. **Atraso** da automática: imediato, 15 min (sugerido), 1 h ou ao fechar o caixa?
2. **Idade máxima** do pedido no lote (sugerido 7 dias) e se a automática é só "daqui para frente" (sugerido: sim); **validar com o contador** a emissão fora do momento da venda.
3. **Quem pode** emitir em lote e ligar a automática: só o dono (sugerido); o funcionário segue emitindo nota manual?
4. **Falha de dados fiscais** (item sem NCM): parar e avisar (sugerido) ou ignorar o pedido e seguir?
5. **Piloto e limites:** qual loja liga primeiro, teto diário de notas (sugerido 2.000) e se pedidos de homologação antigos devem ser reemitidos em produção (sugerido: não).
