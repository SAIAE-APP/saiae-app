# Módulos pagos do Sai aê — design

Data: 2026-10-24. Autor da decisão: João. Status: implementado (aguardando staging e produção).

## Intenção

O Sai aê passa a vender recursos extras como módulos pagos, ativados por loja. Hoje cada recurso é uma flag solta em `barracas` ou uma lista fixa de slugs no código, e o dono liga e desliga sozinho. O João quer ser o único que decide quem tem cada módulo, cobrar por ele e acompanhar tudo em um só lugar.

## Decisão central (do João)

**O dono nunca liga ou desliga um módulo.** O módulo aparece para a loja, já pronto para configurar, somente quando o João o ativa no painel de admin. Sem módulo ativo, a loja não vê o recurso. As flags de módulo que hoje o dono controla (`fiscal_habilitado`, `ia_habilitada`, `whatsapp_disparos_habilitado` e a lista de slugs em `visibilidadeIaCrm.ts`) deixam de ser interruptores do dono.

Dentro de um módulo ativo o dono continua configurando o que é uso do recurso: textos dos avisos, quais avisos enviar, avaliação ligada ou desligada, campanhas, ambiente fiscal. Isso é configuração, não contratação. (Decisão minha, a confirmar: a chave de avaliação continua do dono, como um ajuste dentro do módulo de avisos.)

## Módulos e preços (decididos)

| Módulo | Preço/mês | Franquia | Excedente |
|---|---|---|---|
| `whatsapp_avisos` (avisos de pedido + avaliação) | R$ 39,90 | sem limite, dentro dos tetos anti-ban do CRM | — |
| `whatsapp_disparos` (promoções) | R$ 39,90 | 500 mensagens | R$ 9,90 por 250 (palpite) |
| `whatsapp_bot` (atendimento e pedidos) | R$ 69,90 | 300 conversas (padrão do código) | R$ 19,90 por 100 (palpite) |
| `fiscal` (NFC-e) | R$ 69,90 | 300 notas | R$ 0,30 por nota |
| Pacote WhatsApp completo | R$ 139,90 | as de cada módulo | as de cada módulo |

Taxa de ativação do fiscal: **R$ 99, cobrança única** (cadastro da empresa, certificado e termo). `whatsapp_disparos` exige `whatsapp_avisos` ativo. Os preços do bot e do excedente só se confirmam depois de medir o custo real de uma conversa na `sai-ae-uma-barraca` (regra: margem de pelo menos 2x o custo).

## Nota fiscal: conta mestre

O João contrata a FocusNFe uma vez e cadastra cada loja como empresa na conta dele. O cliente não cria conta na Focus, não vê token nem certificado, e o app não cita o prestador. Fase 1 é manual: o João cadastra a empresa no painel da Focus (certificado A1 enviado direto ao painel, nunca guardado no Sai aê) e grava os tokens de produção e homologação da loja no admin, pelo caminho cifrado que já existe em `salvar-credencial`. A criação da empresa pela API da Focus fica para a fase 2 e depende das condições de revenda, que o João ainda precisa pedir à Focus. A seção Fiscal do dono deixa de pedir token e certificado e passa a mostrar apenas o estado e o ambiente.

O termo de aceite é obrigatório antes de ligar fiscal e disparos: autorização para emitir no CNPJ do cliente, existência de prestador parceiro, uso do certificado, responsabilidade pelo conteúdo fiscal, revogação e renovação do A1. O texto do termo será redigido à parte e revisado por um advogado; a versão aceita e a data ficam gravadas.

## Banco

Tabela `modulos_barraca`, chave `(barraca_id, modulo)`:

- `modulo`: `whatsapp_avisos`, `whatsapp_disparos`, `whatsapp_bot`, `fiscal`.
- `estado`: `teste`, `ativo`, `suspenso`, `cancelado`.
- `origem`: `cortesia` ou `pago`.
- `teste_ate`, `pago_ate`, `ativado_em`.
- `termo_versao`, `termo_aceito_em`.
- `ativacao_cobrada_em` (só fiscal).

Função `modulo_ativo(barraca_id, modulo)`: verdadeira com `estado = ativo`, ou `teste` dentro de `teste_ate`; com `pago_ate` vencido há mais de 7 dias vale como suspenso, sem cron. Tabela `modulos_eventos` registra cada mudança (quem, quando, de, para, termo). RLS: o dono lê só os módulos da própria loja; toda escrita passa por funções que conferem `sou_superadmin()`. A função que ativa fiscal ou disparos recusa se o termo não estiver registrado.

## Quem confere

O servidor decide; o app só esconde ou mostra. `emitir-nfce`, `whatsapp-disparos`, `whatsapp-conexao`, as funções de configuração lidas pelo CRM (`integracao_avaliacao_config` e as do bot) e o `bot_habilitado` do cardápio passam a exigir `modulo_ativo`. O app recebe a lista de módulos ativos da loja e a usa no lugar de `SLUGS_COM_IA_E_CRM` e das flags de módulo. Módulo suspenso ou vencido nunca bloqueia a operação: avisos não saem, a nota não emite e o pedido segue normal, com um aviso claro na tela do dono. As colunas antigas (`fiscal_habilitado`, `ia_habilitada`, `whatsapp_disparos_habilitado`) continuam existindo durante a transição e são preenchidas a partir de `modulos_barraca`, para o CRM e as functions em produção não quebrarem; a migração dos consumidores é por etapas.

## Painel de admin

Seção de módulos em `AdminBarracaLeitura`/`AdminBarracas`, atrás de `sou_superadmin()`: ativar, suspender, cancelar, marcar cortesia ou teste com prazo, registrar `pago_ate`, registrar aceite do termo, registrar a taxa de R$ 99, gravar o token Focus da loja. Para o fiscal, mostrar também o estado do certificado e o vencimento do A1.

## Cobrança

Fase 1, manual: o João cobra fora do sistema (Pix ou link da Stripe) e registra `pago_ate` e a taxa de ativação no painel. Fase 2: itens extras na assinatura Stripe. A assinatura é do dono e o módulo é da loja, então um dono com várias lojas precisa ser tratado antes de automatizar (por loja, não por dono). Fase 2 está fora desta entrega.

## Migração das lojas atuais

Inventário feito em produção em 2026-10-24: só duas lojas têm alguma flag de módulo ligada, e nenhuma loja tem token da Focus gravado (`barracas_fiscal_token` está vazia).

- `sai-ae-uma-barraca` (disparos, IA e WhatsApp conectado): ganha `whatsapp_avisos`, `whatsapp_disparos` e `whatsapp_bot`, como cortesia.
- `dhelenarestaurante` (disparos ligados; `fiscal_habilitado` ligado, mas sem token, então nunca emitiu nota): ganha `whatsapp_avisos` e `whatsapp_disparos`, como cortesia. **Não** ganha `fiscal`: o módulo só nasce quando o João cadastrar a empresa na Focus e gravar o token.
- `qa-teste-varredura` (loja de teste, sem flags): ganha os quatro módulos como cortesia, para continuar vendo as telas.
- Nenhuma outra loja ganha módulo. Uma coluna antiga ligada sem linha em `modulos_barraca` é sobrescrita pelo valor derivado (módulo inexistente = desligado).

A migração grava `termo_versao = 'legado-2026-10-24'` nas cortesias existentes, sem exigir o aceite novo; o termo real é exigido a partir da primeira ativação feita depois que ele existir.

## Decisões do construtor (marcadas como escolha minha)

1. **Atendente IA e Integração com o CRM:** as telas já foram removidas do app. `ia_habilitada` e o bot de pedidos pertencem a `whatsapp_bot`. A "Integração com o CRM" não vira módulo; segue fora do escopo.
2. **Enforcement do CRM:** fica só nas funções do Supabase que o CRM já chama (`integracao_avaliacao_config`, o cardápio `bot_habilitado`, `integracao-v1`, `whatsapp-conexao`, `whatsapp-disparos`). Nenhuma mudança no repositório do CRM nesta entrega.
3. **Dependências entre módulos de WhatsApp:** `whatsapp_disparos` só vale enquanto `whatsapp_avisos` estiver ativo. `whatsapp-conexao` (QR) aceita qualquer um dos três módulos de WhatsApp. O bot não depende de avisos.
4. **Validade:** cortesia com `pago_ate` nulo vale indefinidamente e não tem carência. Módulo `pago` exige `pago_ate`, com carência de 7 dias. `teste_ate` é definido pelo admin na ativação; o padrão sugerido é 30 dias.
5. **Franquias** (500 mensagens, 300 conversas, 300 notas) são só informação de preço nesta entrega. A única contagem que existe é a do bot (`BOT_FRANQUIA_CONVERSAS`, padrão 300 por mês, no CRM) e continua como está.
6. **Pacote WhatsApp completo:** não é um módulo. O admin ganha um botão "Ativar pacote" que cria as três linhas de WhatsApp de uma vez.
7. **Dono com várias lojas:** o app lê os módulos sempre pela loja ativa. Nada a tratar agora.
8. **Token da Focus:** a tabela `barracas_fiscal_token` já tem colunas separadas e cifradas para produção e homologação, então nenhuma mudança de banco é necessária. Como ela está vazia, não há token de dono a migrar.

## Fora de escopo

Fase 2 de cobrança automática, criação de empresa na Focus pela API, texto final do termo, medição de custo do bot, offset para mais de 500 elegíveis nos disparos, Google Avaliações, painel de uso/franquia para o dono.

## Anti-objetivos

Não pode haver caminho em que o dono ative um módulo sozinho. Não pode haver certificado digital ou senha guardados no Sai aê. Módulo suspenso nunca pode impedir o lançamento, a cozinha ou o fechamento de pedido.

## Deixado ao construtor

Nomes das funções e telas do admin, formato do histórico, como o app recebe a lista de módulos (coluna calculada, RPC ou campo em `cardapio_publico`), ordem de migração dos consumidores, estratégia de testes.
