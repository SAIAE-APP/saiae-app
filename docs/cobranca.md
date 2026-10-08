# Cobrança desligável (`app_config.cobranca_ativa`)

Decisão do dono (2026-10-07): ninguém paga ainda. A cobrança e o trial ficam **desativados sem remover nada**. Migration: `supabase/migrations/20261013100000_cobranca_flag.sql`.

## O que a chave faz

`public.app_config` guarda a chave global `cobranca_ativa` (jsonb). A função `public.cobranca_ativa()` a lê. **Só o valor `false` desliga**; linha ausente, apagada ou com outro valor = cobrança ativa (o comportamento de antes).

| Com `cobranca_ativa = false` | Onde |
|---|---|
| Acesso sempre liberado, também para trial vencido, `expired`, `past_due` e `canceled` | `assinatura_tem_acesso()`, `barraca_assinatura_ativa()` (policies RESTRICTIVE de `pedidos`/`itens_do_pedido`) |
| Plano efetivo `pro`: sem limite de barraca, sem corte de histórico, exportação liberada | `criar_barraca()` e `assinatura_da_barraca()` (o app lê `plano = 'pro'`) |
| Sem contagem de trial: o app recebe `status = 'active'`, `plano = 'pro'`, sem `trial_ends_at` e sem `dias_restantes_trial` | `assinatura_da_barraca()` |
| Sem banner de trial, sem bloqueio, tela "Minha assinatura" e Ajustes mostram "cobrança desativada" | `src/lib/cobranca.ts`, `LayoutBarraca`, `Assinatura`, `Ajustes` |

**Não muda:** `criar_assinatura_trial` e o trigger em `auth.users` (continuam criando o trial de 30 dias e a regra de 1 trial por e-mail), as tabelas, as ofertas Kirvano, Stripe, os webhooks e o cron `expirar_assinaturas_job`. Eles seguem gravando o status real em `assinaturas`; a chave só decide se ele é aplicado. A tela **Planos / Assinar** continua acessível.

## Religar a cobrança

```sql
update public.app_config
   set valor = 'true'::jsonb, atualizado_em = now()
 where chave = 'cobranca_ativa';
```

Vale na hora, sem deploy. Para desligar de novo: `valor = 'false'::jsonb`. Conferir: `select public.cobranca_ativa();`

### Antes de religar: decida o que fazer com os trials

Durante o período desligado o trial **continua correndo** desde o cadastro (30 dias) e o cron continua marcando `expired`. Ao religar:

- contas criadas há mais de 30 dias estarão `expired` e **serão bloqueadas na hora**;
- quem não pagou volta a ser limitado conforme o plano gravado (`essencial` = 1 barraca, 7 dias de histórico, sem exportar).

Se o dono quiser dar um trial novo a quem ainda não pagou, rode **antes** de religar (não faz parte da migration):

```sql
update public.assinaturas
   set status = 'trialing',
       trial_ends_at = now() + interval '30 days',
       updated_at = now()
 where status in ('trialing', 'expired')
   and kirvano_sale_id is null
   and stripe_subscription_id is null;
```

O `where` exclui quem já tem venda Kirvano ou assinatura Stripe (pagantes não são tocados); confira o resultado com um `select` antes.

## Desfazer a migration por completo

O jeito prático de "voltar" é religar (`true`): o comportamento fica idêntico ao de antes. Para remover tudo (restaura as 4 funções originais, na versão anterior a esta migration):

```sql
drop function if exists public.assinatura_da_barraca(text);
-- recriar assinatura_da_barraca com as 8 colunas originais:
-- ver supabase/migrations/20260922120000_add_assinaturas_kirvano.sql (função assinatura_da_barraca)
-- e dar: grant execute on function public.assinatura_da_barraca(text) to authenticated;

-- assinatura_tem_acesso e barraca_assinatura_ativa: recriar a partir de
-- 20260922120000_add_assinaturas_kirvano.sql (assinatura_tem_acesso com
-- `set search_path = public, pg_temp`, como em 20260927150100_fix_function_search_path.sql)
-- criar_barraca: recriar a partir de 20260926200000_limite_barraca_essencial.sql

drop function if exists public.cobranca_ativa();
drop table if exists public.app_config;
```

Atenção à ordem: recriar as funções antes de apagar `cobranca_ativa()` e `app_config`, porque as versões novas dependem delas. O front novo continua funcionando sem a coluna `cobranca_ativa` (campo ausente = cobrança ativa).

## Ordem de deploy

Qualquer ordem é segura. Front antes da migration: o servidor ainda não manda `cobranca_ativa`, o app trata como ativa (igual a hoje). Migration antes do front: o servidor já devolve o estado neutro, então mesmo o app antigo não mostra trial nem bloqueio.

## Testes

- `npm test` → `tests/cobranca.test.ts` (regras puras do front: banner, bloqueio, campo ausente).
- A migration foi exercitada num Postgres descartável (PGlite) com o schema de assinaturas real e stubs de `auth`/barracas: acesso antes/depois, flag `true` = comportamento original, `criar_barraca` do Essencial, trial e 1 trial por e-mail, falha segura e RLS de `app_config`. Não foi aplicada em staging nem em produção.
