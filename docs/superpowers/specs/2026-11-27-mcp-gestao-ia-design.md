# Gestão por IA (MCP) — design

Data: 2026-11-27. Status: implementado no repositório (nada commitado nem publicado). Este documento descreve o desenho que foi de fato construído, que mudou em relação ao rascunho inicial.

## Objetivo
O dono conecta o ChatGPT ou o Claude ao Sai aê e gerencia a barraca por áudio, texto ou foto: muda preço, marca esgotado, ajusta estoque, cria cupom, põe foto em item e monta o cardápio a partir da foto do cardápio de papel. A IA só PROPÕE; quem decide é o dono, dentro do app.

## Decisões que diferem do rascunho
- Autenticação: **token por barraca** gerado em Ajustes (`SecaoGestaoIA`), guardado só como hash, com validade e revogação. O OAuth 2.1 ficou de fora (não foi validado que o Claude e o ChatGPT aceitam o fluxo).
- Confirmação: em vez de `confirmar: boolean` na própria chamada, vale o fluxo **proposta → aprovação do dono no app → aplicar**. A IA nunca consegue aprovar: `mcp_proposta_decidir` só aceita o dono logado (`authenticated`, papel `dono`).
- Módulo: `ia_gestao` em `modulos_barraca`, atrás de `modulo_ativo`; só o superadmin ativa. Sem módulo a function responde 403 `modulo_desligado` e o token não valida.
- A function usa a **service role**, mas a barraca vem SÓ do token (nunca do argumento) e toda RPC filtra por `barraca_id`. A RLS não é usada na function; a defesa está nas RPCs `SECURITY DEFINER`, liberadas só para `service_role`.

## Ferramentas

| Ferramenta | Escreve? | Como |
|---|---|---|
| `listar_itens` | não | leitura de `itens` filtrada pela barraca do token |
| `alterar_preco_item` | proposta | tipo `preco` |
| `marcar_esgotado` | proposta | tipo `esgotado` (esgotado manual, `estoque_esgotado_auto = false`) |
| `ajustar_estoque` | proposta | tipo `estoque` (delta, usa o saldo do item) |
| `criar_cupom` | proposta | tipo `cupom` |
| `definir_foto_item` | proposta | tipo `foto` |
| `importar_cardapio_de_foto` | proposta | tipo `cardapio` |

Cada ferramenta de escrita tem dois tempos: chamada com os dados cria a proposta (nada muda); depois que o dono aprova no app, a mesma ferramenta, chamada só com `proposta_id`, aplica. A aplicação confere o tipo esperado (`tipo_incorreto` se a proposta é de outra ferramenta), o prazo, o token e o dono (travas `FOR SHARE`), e é idempotente (`ja_aplicada`). Chamada no formato antigo (sem tipo esperado) só vale para preço, esgotado e estoque.

Fora de escopo, de propósito: apagar qualquer dado, pagamento e estorno, fiscal, senha/PIN, acesso do suporte, cancelar pedido, cupom ligado direto, ajuste de estoque absoluto.

### Cupom
- Entrada: `codigo` (3 a 20 letras, números, `-` ou `_`), UM entre `percentual` (1 a 100) e `valor_fixo_centavos`, e opcionais `valido_de`, `valido_ate` (AAAA-MM-DD), `limite_usos` e `pedido_minimo_centavos`.
- Reaproveita as regras de `public.cupons` (mesmas restrições de tabela) e de `src/lib/cupons.ts`: janela de validade do dia inteiro no **fuso da barraca** (com o mesmo fallback do painel, `America/Sao_Paulo`, para fuso vazio ou desconhecido), código único por barraca sem diferenciar maiúscula.
- O cupom nasce **PAUSADO** (`ativo = false`). O dono liga em Ajustes > Cupons. Se `barracas.cupons_habilitado` está desligado, a resposta avisa que os cupons estão desligados.
- "Uma vez por cliente" ficou de fora: é decisão do dono no painel.
- Validade vencida entre a proposta e a aplicação: `cupom_vencido`. Código criado pelo painel no meio do caminho: `codigo_existe` (a restrição única decide; a proposta segue aprovada).

### Foto do item
- `definir_foto_item(item_id, imagem_url)`. O servidor baixa a imagem, só https na porta 443, sem credenciais na URL, recusa nomes `localhost`/`.local`/`.internal`/sem ponto/numéricos; resolve o DNS (A e AAAA) e exige que TODOS os endereços sejam públicos (bloqueia loopback, privados, CGNAT, link-local, metadata de nuvem, multicast, IPv6 ULA/link-local/mapeado/6to4/Teredo/documentação); segue no máximo 3 redirects, cada um revalidado do zero; limite de 5 MB lido em streaming; confere os bytes (png, jpg, webp), nunca o `Content-Type`; limita os lados a 8000 px. Falha na resolução de qualquer das famílias (que não seja "sem registro") recusa o download.
- A imagem vai para `{barraca_id}/pendente/{uuid}.{ext}` no bucket `cardapio-fotos`; a proposta guarda os caminhos. O dono vê a foto atual e a nova no app e aprova.
- Ao aplicar: copia `pendente → {barraca_id}/{item}-{hex}.{ext}`, o banco confere que a foto do item ainda é a mesma de quando a proposta foi criada e só então troca `itens.foto_url`. Depois apaga o pendente e a foto antiga (somente se for foto de ITEM desta barraca e nenhum outro item a usa; banner e capa nunca são apagados).
- Se a aplicação é recusada, o destino copiado NÃO é apagado na hora (outra chamada da mesma proposta pode tê-lo aplicado). Sobras (pendente de proposta recusada ou vencida há mais de 10 minutos, destino de proposta não aplicada que nenhum item usa, foto antiga de proposta aplicada) são removidas por `mcp_fotos_limpar_listar`/`marcar`, que a function chama a cada nova proposta de foto e ao repetir uma aplicação; falha do Storage não marca como limpo, então tenta de novo.
- Sem redimensionamento: não há biblioteca de imagem disponível na function sem dependência pesada. A foto fica como enviada, limitada a 5 MB e 8000 px. O redimensionamento do app (1200 px) continua só no envio pelo navegador.
- Risco residual: **DNS rebinding**. O `fetch` do Deno resolve o nome de novo ao conectar; um nome que muda de resposta entre a nossa checagem e a conexão contornaria a validação. Não há como fixar o IP no `fetch` do Deno. Mitigações: o corpo só é guardado depois de a imagem ser validada pelos bytes, a function não devolve o conteúdo ao chamador e não há segredo na rede interna da Edge Function. Fechar de vez exige um proxy de saída.

### Cardápio por foto
- A IA lê a foto e manda a lista estruturada `itens: [{categoria, nome, preco, descricao}]` (preço como texto, ex.: "8,50"). O servidor valida com a **mesma regra da planilha** (`supabase/functions/_shared/cardapioImportacao.ts`, cópia literal de `src/lib/importarCardapio.ts`, com teste que garante que as duas não divergem): máx. 300 itens, preço ambíguo ("1.234") recusado, preço com mais de 30 caracteres recusado (em vez de cortar), nome repetido no envio ou já existente pulado, sem acento e sem diferenciar maiúscula.
- A prévia mostra o que será criado (lista completa, até 300), as categorias novas e o que foi recusado, com o motivo por linha.
- A proposta guarda **só o que seria criado**. Na aplicação o servidor recalcula contra o cardápio de agora e apenas TIRA linhas que passaram a existir; nunca inclui uma linha que o dono não viu.
- Itens nascem **ativos**, na mesma ordem e com os mesmos campos que a planilha cria (campos fiscais e estoque vazios, foto vazia). Só insere; nunca apaga nem sobrescreve; é repetível.
- Normalização de nome: o SQL usa `normalize(..., NFD)` e remove as marcas, igual ao app.

## Limites e retenção
- **Limite por token**: 60 chamadas por minuto e 2000 por dia, contadas no banco (`mcp_uso`, RPC `mcp_limite_registrar`), só para `tools/call` de ferramenta conhecida. Passou do limite: HTTP 429 com `Retry-After`. Se a contagem falha, a function responde 503 e não executa (fecha por padrão); token revogado depois da validação inicial dá 401.
- **Corpo**: acima de 1.000.000 de caracteres, HTTP 413 antes de decodificar o JSON.
- **Purga**: `mcp_auditoria_purgar(p_dias default 90)` (só `service_role`, mínimo de 30 dias) apaga auditoria antiga, propostas já decididas (exceto foto ainda não limpa) e contadores de uso com mais de 2 dias. **Não há agendamento criado.** Para agendar: no painel do Supabase, Integrations > Cron, uma tarefa diária de SQL `select public.mcp_auditoria_purgar(90);`; ou, com `pg_cron` habilitado, `select cron.schedule('mcp-auditoria-purgar', '17 3 * * *', 'select public.mcp_auditoria_purgar(90)');`.

## Banco (migrations)
`20261127100000_mcp_gestao`, `20261127110000_mcp_aprovacao`, `20261128100000_mcp_propostas_tipos`, `20261128110000_mcp_modulo_ia_gestao`, `20261129100000_mcp_cupom_foto_cardapio` (aditivas, em ordem). A última cria os tipos `cupom`, `foto` e `cardapio`, os auxiliares (`_mcp_chave_nome`, `_mcp_fuso`, `_mcp_data_valida`, `_mcp_cardapio_*`), `mcp_foto_preparar`, `mcp_fotos_limpar_*`, `mcp_uso`, `mcp_limite_registrar` e `mcp_auditoria_purgar`, e troca `mcp_proposta_criar`, `mcp_proposta_aplicar` (agora com o 3º argumento `p_tipo_esperado`) e `mcp_proposta_listar`. O rollback está no cabeçalho do arquivo.

## App
Ajustes > Gestão por IA (`SecaoGestaoIA`): URL do conector, token, propostas pendentes para aprovar ou recusar (com foto atual e nova lado a lado, lista completa do cardápio e dados do cupom), histórico e botão Desconectar.

## Segurança
- Prompt injection: texto de nome/descrição de item pode chegar à IA; por isso tudo que escreve passa por aprovação do dono, não há ferramenta destrutiva e há limite de itens por chamada.
- Sem segredo nem dado de cliente final nas respostas das ferramentas; o endereço interno do Storage (`pendente`) não é mostrado à IA.
- Revisão adversarial feita com o Codex a cada ferramenta; achados e o que ficou sem correção estão no relatório da entrega.

## Ordem de deploy
1. Migrations, na ordem acima.
2. Function `mcp-saiae` com `--no-verify-jwt`.
3. App.

## Ficou de fora
- `criar_link_upload_foto` (link de uso único para foto tirada no celular) e `resumo_vendas_dia`.
- OAuth 2.1 com a conta do dono.
- Cupom "uma vez por cliente" e cupom já ativo.
- Redimensionamento no servidor e proxy de saída contra DNS rebinding.
- Aprovação presa à lista exibida no cardápio: a lista do dono é recalculada contra o cardápio de agora e a aplicação usa o que foi guardado na proposta (só o que seria criado). Se o dono cadastrar um item igual entre a proposta e a tela, e apagá-lo depois de aprovar, o item da IA entra ativo mesmo sem ter aparecido na lista. Janela pequena, aceita e registrada.
- Unicidade no banco para itens e categorias por nome normalizado: a planilha e o cadastro manual também não têm, então uma aplicação da IA no mesmo instante em que o dono cadastra o mesmo nome pode duplicar.

## Não validado
OAuth no Claude/ChatGPT (não usado), comportamento real de cópia/remoção do Supabase Storage, `fetch` e `Deno.resolveDns` reais na Edge Function, DNS rebinding, limites de tamanho de imagem de cada cliente de IA, leitura de cardápio manuscrito, concorrência real entre a aplicação da IA e o cadastro manual, e qualquer execução contra banco real (tudo foi testado em PGlite e com simulações).
