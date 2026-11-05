# Roteiro de teste: módulos pagos

Spec: `docs/superpowers/specs/2026-10-24-modulos-pagos-design.md`. Os módulos são `whatsapp_avisos`, `whatsapp_disparos`, `whatsapp_bot` e `fiscal`. Só o superadmin (João) ativa, suspende ou cancela; o dono da loja nunca liga um módulo sozinho.

## Pré-requisitos

1. **Staging** com a ordem de deploy cumprida: migrations `20261103100000`, `20261103110000` e `20261103120000`; depois as functions `emitir-nfce`, `whatsapp-disparos`, `whatsapp-conexao` e `salvar-credencial`; por último o app.
2. Duas sessões: uma como **superadmin** (acessa o painel de admin) e outra como **dono** da loja de teste (outro navegador ou janela anônima).
3. Loja de teste: `qa-teste-varredura`. O backfill da migration `20261103100000` deu a ela os quatro módulos como cortesia (termo `legado-2026-10-24`). Para os passos de ativar do zero, suspenda antes o módulo em questão (passo 2) ou use outra loja de teste sem módulos.
4. O painel fica em Admin > loja (`AdminBarracaLeitura`) > seção "Módulos pagos" (`AdminModulos`). Cada módulo tem os botões "Ativar cortesia", ativar como pago (exige `pago_ate`), teste, suspender e cancelar; o campo "Versão do termo aceito" aparece em fiscal e disparos.
5. Para conferir o estado direto no banco (SQL Editor do staging, como superadmin): `select modulo, estado, origem, pago_ate, teste_ate, termo_versao from modulos_barraca where barraca_id = (select id from barracas where slug = 'qa-teste-varredura');` e `select modulo_ativo(id, 'fiscal') from barracas where slug = 'qa-teste-varredura';`.

## Parte A: ativar e suspender pelo admin

1. **Estado inicial.** Entre como dono em `qa-teste-varredura`. Esperado: em Ajustes > Avisos aparecem "WhatsApp e Automação" e "Campanhas e avaliação"; em Ajustes > Conta aparece a seção Fiscal; o Histórico mostra o botão de emitir nota nos pedidos elegíveis.
2. **Suspender todos.** Como superadmin, suspenda `whatsapp_avisos`, `whatsapp_disparos`, `whatsapp_bot` e `fiscal` (botão suspender de cada um). Esperado: cada ação responde ok e `modulos_eventos` ganha uma linha por mudança. No dono, depois de recarregar (ou de voltar ao app): somem a aba de WhatsApp e Campanhas em Avisos, a seção Fiscal e o botão de emitir nota. O cache local só vale até a próxima leitura; sem resposta do servidor o app fecha por padrão.
3. **Ativar `whatsapp_avisos`.** Ative como cortesia. Esperado: ao recarregar o dono, "WhatsApp e Automação" volta (QR Code, cinco avisos, histórico). "Campanhas e avaliação" ainda não aparece (depende de disparos).
4. **Ativar `whatsapp_disparos`.** Informe uma versão do termo (por exemplo `teste-staging`) e ative como cortesia. Esperado: "Campanhas e avaliação" aparece para o dono.
5. **Ativar `whatsapp_bot`.** Ative como cortesia. Esperado: o estado do bot fica disponível; `select ia_habilitada from barracas where slug = 'qa-teste-varredura'` não muda sozinho para true (o espelho só desliga, nunca liga; quem liga a IA é o dono pela tela do bot).
6. **Ativar `fiscal` sem termo (recusa).** Com `fiscal` suspenso e a linha sem termo gravado (use uma loja de teste sem módulos, ou apague o termo por SQL no staging antes), tente ativar sem preencher a versão do termo. Esperado: o painel mostra a mensagem de termo obrigatório (estado `termo_obrigatorio`) e `modulo_ativo(id, 'fiscal')` continua `false`. Depois preencha a versão do termo e ative: responde ok.
7. **Pacote WhatsApp.** Suspenda os três de WhatsApp e use "Ativar pacote". Esperado: as três linhas ficam ativas de uma vez; se uma falhar, nenhuma é gravada (tudo ou nada).
8. **Suspender avisos derruba disparos.** Com os três de WhatsApp ativos, suspenda só `whatsapp_avisos`. Esperado: `modulo_ativo(id, 'whatsapp_disparos')` passa a `false` mesmo com a linha de disparos ativa, e "Campanhas e avaliação" some para o dono. Tente ativar disparos com avisos suspenso: o painel recusa por dependência (`dependencia`). Reative avisos: disparos volta sozinho.

## Parte B: nota fiscal e token Focus

1. **Seção Fiscal do dono.** Com `fiscal` ativo, em Ajustes > Conta > Fiscal. Esperado: não existe campo de token nem interruptor de habilitar; só estado, regime, ambiente e dados fiscais. O app não cita o prestador.
2. **Sem token.** Com nenhum token gravado, o estado mostra "Aguardando cadastro", e emitir nota volta erro claro (`emitir-nfce` valida o token antes de chamar o prestador).
3. **Gravar os tokens pelo admin.** Como superadmin, no bloco "Nota fiscal: conta mestre", cole o token de homologação em "Token Focus (homologação)" e salve; repita para "Token Focus (produção)". Esperado: cada gravação confirma sucesso (via `salvar-credencial`, cifrado); o token nunca volta para a tela.
4. **Dono vê o estado.** Recarregue o dono, com o ambiente em Homologação. Esperado: Ajustes > Conta > Fiscal mostra "Pronto para emitir". Troque o ambiente para Produção: também "Pronto para emitir" (token de produção gravado). Se apagar um dos tokens por SQL no staging, o ambiente correspondente deixa de mostrar o texto.
5. **Taxa de ativação.** No mesmo bloco, "Registrar taxa de ativação" grava `ativacao_cobrada_em`; repetir não duplica nem dá erro.
6. **Emissão com módulo ativo.** Emita uma nota de homologação em um pedido novo de `qa-teste-varredura`. Esperado: nota autorizada com selo de homologação.
7. **Nota autorizada com o módulo desligado.** Suspenda `fiscal` e abra o Histórico daquele pedido. Esperado: a nota continua visível, com status e botão "Imprimir cupom fiscal" (reimpressão); some apenas o botão de emitir nota nova. Chame `emitir-nfce` para outro pedido: responde 403 `modulo_desligado`.

## Parte C: o dono não consegue ligar sozinho

Faça no SQL Editor do staging simulando o dono (papel `authenticated` com o JWT do dono), ou por uma chamada REST autenticada com o token do dono (`PATCH /rest/v1/barracas?slug=eq.qa-teste-varredura`). Com o módulo suspenso em cada caso:

1. `update barracas set fiscal_habilitado = true where slug = 'qa-teste-varredura'`. Esperado: erro `fiscal_use_o_modulo`.
2. `update barracas set whatsapp_disparos_habilitado = true where slug = 'qa-teste-varredura'`. Esperado: erro `disparos_use_a_tela`.
3. `update barracas set ia_habilitada = true where slug = 'qa-teste-varredura'`. Esperado: recusado pela proteção que já existia (`ia_ligar` é o único caminho); a RPC `ia_ligar(id, true)` com o bot suspenso levanta `modulo_desligado`. Desligar (`ia_ligar(id, false)`) continua permitido.
4. `select * from admin_modulos_listar('<id da loja>')` pelo dono: devolve conjunto vazio. `select admin_modulo_definir(...)` pelo dono: responde `nao_autorizado`.
5. Lendo `modulos_barraca` como dono: só aparecem as linhas da própria loja.

Observação: rodar o SQL Editor como dono do banco (papel `postgres`) não exercita a proteção, que só vale para `authenticated` e `anon`. Por isso use o JWT do dono.

## Parte D: WhatsApp (conexão, desconectar, eventos)

1. **Sem nenhum módulo de WhatsApp.** Suspenda os três. Como dono, chame a `whatsapp-conexao` com ação `iniciar` (botão "Conectar WhatsApp" se ainda estiver visível pelo cache, ou chamada direta). Esperado: 403 `modulo_desligado`, nenhum QR.
2. **Qualquer um dos três basta.** Ative só `whatsapp_bot` e tente `iniciar`. Esperado: o QR é gerado.
3. **Desconectar continua livre.** Com a sessão conectada, suspenda os três módulos e chame `desconectar` (e consulte status e histórico). Esperado: todos funcionam; só `iniciar` é bloqueado.
4. **Cancelar campanha continua livre.** Com uma campanha em andamento, suspenda disparos e cancele a campanha. Esperado: cancela. Criar ou enviar campanha nova responde `modulo_desligado`.
5. **Eventos de pedido sem avisos.** Com `whatsapp_avisos` suspenso, lance e avance um pedido e leia o evento gerado (tabela da fila de eventos de saída, ou `select montar_evento_saida(...)` conforme o roteiro de integração). Esperado: o evento `order.*` leva `data.avisos` com os cinco avisos (recebido, pronto, saiu_entrega, entregue, cancelado) todos com `ativo: false`. Reative avisos e gere novo evento: os avisos voltam com a configuração da loja.
6. **Avaliação.** Com avisos suspenso, `integracao_avaliacao_config` devolve `ativo = false`; com avisos ativo e avaliação ligada, devolve `ativo = true` (não depende mais de disparos).
7. **Campanhas e registro de contato.** Com disparos suspenso, `disparos_publico` e `registrar_contato_marketing` recusam (módulo desligado); com disparos e avisos ativos, funcionam.
8. **Cardápio e bot.** Com `whatsapp_bot` suspenso, `integracao_cardapio` devolve `ia_habilitada = false` mesmo que a coluna esteja true.

## Parte E: vigência e carência de 7 dias

Use SQL de superadmin no staging para ajustar datas (a função decide na hora da consulta, sem cron). Faça com `whatsapp_avisos` da loja de teste.

1. **Pago dentro do prazo.** `update modulos_barraca set estado='ativo', origem='pago', pago_ate = now() + interval '1 day' where barraca_id = '<id>' and modulo='whatsapp_avisos';` Esperado: `modulo_ativo` = `true`.
2. **Vencido, dentro da carência.** `pago_ate = now() - interval '6 days'`. Esperado: `true`.
3. **Fronteira.** `pago_ate = now() - interval '7 days' + interval '1 minute'`: `true`. `pago_ate = now() - interval '7 days' - interval '1 minute'`: `false`. O limite é `pago_ate + 7 dias`, inclusivo.
4. **Pago sem `pago_ate`.** `pago_ate = null` com origem pago: `false` (pago exige data).
5. **Cortesia indefinida.** `origem='cortesia', pago_ate = null`: `true`, sem carência nem fim.
6. **Teste.** `estado='teste', teste_ate = now() + interval '1 day'`: `true`; com `teste_ate` no passado: `false`.
7. **Efeito no app.** Com o módulo vencido além da carência, o dono perde a tela após recarregar e o evento de pedido volta a sair com os avisos `ativo: false`; o pedido em si segue normal (módulo suspenso nunca bloqueia lançar, cozinha ou fechar pedido). Atenção: as colunas espelho (`fiscal_habilitado` etc.) podem ficar velhas quando uma data vence sem ninguém mexer na linha; a verdade é sempre `modulo_ativo`.

Ao terminar, devolva a loja ao estado do backfill (os quatro módulos como cortesia ativa, sem `pago_ate`).

## Parte F: o que não é testado aqui

Cobrança automática, criação de empresa na Focus pela API, texto final do termo e contagem de franquias (500 mensagens, 300 conversas, 300 notas) estão fora desta entrega. As franquias são só informação de preço.
