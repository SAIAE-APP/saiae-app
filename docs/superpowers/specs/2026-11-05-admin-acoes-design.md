# Painel /admin: ações do superadmin e melhorias de uso

Data: 2026-11-05. Dono da decisão: João Marcos. Branch de trabalho: `feat/painel-admin`.

## Intenção e porquê

Hoje o `/admin` só lê: lista barracas com plano e prazo e abre uma barraca em modo somente leitura. O João,
como dono do sistema, precisa agir sem entrar no banco à mão: cortar o acesso de uma conta, cuidar das contas Pro
que existem desde antes dos planos Essencial e Pro, e remover barracas. A tela também ficou pesada de usar: a lista
de barracas, que é o que ele mais consulta, aparece depois de cinco blocos de resumo.

## Decisões do João (como ele decidiu)

- **Ambiente:** tudo direto em PRODUÇÃO (`vimjwzumjggrlvlxdejr`), sem staging. Autorização dada em 2026-11-05.
- **Bloquear/desbloquear:** corta o acesso da CONTA INTEIRA (dono e funcionários). Não é liberar/retirar recursos
  de um plano.
- **Admin total** sobre as contas, inclusive as que já estavam no Pro antes de existirem os planos.
- **Excluir barraca:** arquivar, com 30 dias para desfazer. Só depois disso o apagamento definitivo.
- Melhorar UX/UI do `/admin` e o uso no dia a dia.

## Objetivos

1. Bloquear e desbloquear uma conta pelo admin, com motivo opcional. O bloqueio vale na hora, em todo o app.
2. Trocar o plano (`essencial`/`pro`) e estender o vencimento de uma conta pelo admin.
3. Identificar e filtrar as contas Pro anteriores aos planos (legado).
4. Arquivar barraca, restaurar em até 30 dias, apagar de vez depois disso.
5. Registrar toda ação do admin (quem, quando, o quê, motivo) numa trilha que o João consulta.
6. Tela mais rápida de usar: busca, ordenação, contagens nos filtros, ações no próprio card, lista primeiro.

## Fora do escopo

- Liberar/retirar recursos individuais de um plano (feature flags por conta).
- Editar dados internos da barraca (cardápio, pedidos) pelo admin além do que o acesso de suporte já faz.
- Mexer na cobrança do Stripe (reembolso, cancelamento da assinatura). O bloqueio não cancela cobrança.
- Novas funcionalidades de observabilidade.

## Anti-objetivos (seria falha mesmo funcionando)

- Um bloqueio ou troca de plano que o webhook do Stripe, o cron de expiração ou o trial desfaça sozinho.
- Apagar dado de uma barraca sem passar pelos 30 dias, ou sem confirmação explícita digitando o nome.
- Quebrar o acesso das barracas que NÃO foram tocadas: `assinatura_tem_acesso` é usada pelo app todo.
- Qualquer ação do admin sem rastro no log.
- Abrir ação de escrita para quem não é superadmin: toda função confere `superadmins` por conta própria.

## Restrições

- Segurança no banco, não só na tela: cada RPC nova é `security definer`, confere `superadmins` com
  `auth.uid()` (mesmo padrão de `admin_listar_barracas`), `revoke ... from public, anon`, grant só a `authenticated`.
- `assinatura_tem_acesso(assinaturas, timestamptz)` mantém a assinatura (nome e parâmetros). Muda só o corpo.
- Migration nova segue a numeração depois de `20261107110000_consentimento_marketing_purchase.sql`, a última em origin/main; a última
  aplicada em produção. As migrations 20261028100000 a 20261028150000 já estão aplicadas em produção.
- Como vai direto para produção: antes de aplicar, rodar tsc, lint e a suíte de testes locais; aplicar a migration
  em uma transação; conferir pelo SQL que as contas existentes continuam com o mesmo `tem_acesso` antes e depois.
- Suíte hoje: 1415 testes, tsc e lint limpos. Não regredir.

## Desenho (parte decidida e parte minha, marcada)

### Bloqueio (decisão do João; colunas são escolha minha)

- Colunas novas em `assinaturas`: `bloqueada_admin boolean not null default false`, `bloqueio_motivo text`,
  `bloqueada_em timestamptz`.
- `assinatura_tem_acesso` devolve `false` quando `bloqueada_admin` é verdadeiro, antes de olhar o status.
  `barraca_assinatura_ativa` e `assinatura_da_barraca` já usam essa função, então dono e funcionários caem no
  paywall existente. O builder confere se `assinatura_da_barraca` precisa devolver um campo `bloqueada` para o
  paywall mostrar "conta bloqueada, fale com o suporte" em vez de "assine".
- Coluna separada do `status` de propósito: webhook Stripe, `trial-avisos` e o cron de expiração escrevem em
  `status`; nenhum deles toca em `bloqueada_admin`.
- Desbloquear zera as três colunas. Plano e prazo ficam como estavam.

### Plano e vencimento (decisão do João: admin total; detalhes meus)

- RPC `admin_definir_plano(p_usuario_id, p_plano)` e `admin_estender_vencimento(p_usuario_id, p_dias)`.
- Conta com Stripe ativo: trocar o plano à mão pode divergir do que o Stripe cobra. A tela avisa antes de
  confirmar. A divergência é aceita porque o João pediu controle total; fica registrada no log.

### Legado (palpite meu, marcado)

- Marcar como legado as assinaturas com `plan = 'pro'` criadas antes de `20261022130000` (quando o trial passou a
  nascer Essencial). A marca é uma coluna `origem_plano text` (`'legado'`, `'trial'`, `'pago'`), preenchida uma vez
  na migration. O builder escolhe a regra exata para separar o legado de um Pro pago normal, olhando
  `stripe_subscription_id` e as datas, e valida com a lista das contas atuais antes de aplicar.
- Filtro "Legado" na lista e selo no card.

### Arquivar barraca (decisão do João: 30 dias para desfazer; mecânica minha)

- Coluna `barracas.arquivada_em timestamptz`.
- Arquivada: some da lista normal do admin (aparece no filtro "Arquivadas"), perde o acesso para todos os
  usuários, e o cardápio público sai do ar. O builder localiza o ponto único de checagem de acesso (família
  `usuario_tem_acesso_barraca`) e o do cardápio público, para a regra ficar em um lugar só.
- Restaurar: zera `arquivada_em` em até 30 dias.
- Apagamento definitivo: depois de 30 dias, um job diário (pg_cron, como `expirar-pix-pendentes`) apaga os dados
  da barraca com a mesma lista de tabelas de `excluir_dados_conta`. A limpeza do Storage (`cardapio-fotos` e
  `logo-barraca`, pasta `{barraca_id}/`) exige service role, então o job chama uma edge function nos moldes de
  `excluir-conta`. Escolha minha, sujeita ao builder.
- Confirmação para arquivar: o admin digita o nome da barraca.
- Arquivar não mexe na assinatura do dono (ele pode ter outras barracas).

### Log de ações (escolha minha)

- Tabela `admin_acoes_log (id, admin_id, acao, alvo_tipo, alvo_id, detalhes jsonb, criado_em)`, RLS ligada sem
  policy, lida por RPC `admin_listar_acoes` só de superadmin. Toda RPC de escrita insere uma linha na mesma
  transação.
- Tela: aba/seção "Histórico de ações" no admin, mais recentes primeiro.

### Tela (palpite meu; o João corrige)

- Uma lista única e compacta. Cada linha traz o que hoje está em "Saúde por barraca" (pedidos, queda, erros,
  versão), eliminando o bloco duplicado.
- Busca por nome, slug ou e-mail do dono (parâmetro novo em `admin_listar_barracas`).
- Ordenação: vencimento (atual), nome, última atividade, nova.
- Filtros com contagem: Todas, Vence em 7 dias, Trial acabando, Vencidas, Bloqueadas, Legado, Arquivadas.
- Ações no card: Bloquear/Desbloquear, Trocar plano, Estender, Arquivar, Abrir (leitura). Cada ação pede
  confirmação; as destrutivas (bloquear, arquivar) mostram o efeito em palavras simples.
- Alertas e resumo ficam no topo mas recolhidos e curtos; a lista aparece sem rolar.
- Erros com botão "Tentar de novo". Desktop: tabela densa a partir de uma largura mínima, cards no celular.
- Acessibilidade mantida: foco, rótulos, `role="alert"`, contraste dos selos.

## Deixado para quem for construir

- Nomes de colunas, índices e forma exata das RPCs.
- A regra que separa legado de Pro pago.
- O ponto de checagem de acesso e de cardápio público para barraca arquivada.
- Texto exato do paywall de conta bloqueada.
- Testes: unitários das funções de `lib/adminBarracas`, testes de componente das ações e uma verificação SQL
  antes/depois da migration (nenhuma conta existente muda de `tem_acesso`).

## Riscos que o João precisa saber

- Tudo vai direto para produção. Um erro em `assinatura_tem_acesso` bloqueia ou libera contas reais. Mitigação:
  transação, comparação antes/depois e rollback escrito junto com a migration.
- Bloquear conta com assinatura Stripe ativa não para a cobrança. O dono continua pagando sem acesso até o João
  cancelar no Stripe.
- Apagamento definitivo é irreversível. Por isso os 30 dias e a confirmação com o nome.
