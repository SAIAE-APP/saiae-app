-- Cashback do cardápio digital, M6: resumo do relatório do dono.
-- Spec: docs/superpowers/specs/2026-10-27-cashback-design.md (§10 e §12).
-- SECURITY INVOKER (sem security definer): lê o razão pela RLS do dono, então quem não é da loja recebe zeros.
-- Rollback: drop function public.cashback_resumo(uuid, timestamptz, timestamptz).

create or replace function public.cashback_resumo(p_barraca_id uuid, p_de timestamptz, p_ate timestamptz)
returns table (
  concedido_centavos bigint,
  usado_centavos bigint,
  vencido_centavos bigint,
  estornado_centavos bigint,
  excedente_centavos bigint,
  saldo_em_aberto_centavos bigint
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with periodo as (
    select tipo, valor_centavos
      from public.cashback_lancamentos
     where barraca_id = p_barraca_id and criado_em >= p_de and criado_em < p_ate
  ),
  -- Saldo por cliente hoje (clientes apagados têm cliente_id nulo e saldo zero, ficam de fora).
  contas as (
    select cliente_id, sum(valor_centavos) as soma, max(expira_em) as vence
      from public.cashback_lancamentos
     where barraca_id = p_barraca_id and cliente_id is not null
     group by cliente_id
  ),
  excedente as (
    -- Desconto cheio dado no pedido menos o que o razão realmente debitou (saldo gasto em outro pedido).
    select coalesce(sum(p.cashback_usado_centavos - coalesce((
      select -sum(l.valor_centavos) from public.cashback_lancamentos l where l.pedido_id = p.id and l.tipo = 'resgate'
    ), 0)), 0) as valor
      from public.pedidos p
     where p.barraca_id = p_barraca_id and p.cashback_usado_centavos > 0
       and p.criado_em >= p_de and p.criado_em < p_ate
       and public.usuario_tem_acesso_barraca(p_barraca_id)
  )
  select
    coalesce((select sum(valor_centavos) from periodo where tipo = 'credito'), 0)::bigint,
    coalesce((select -sum(valor_centavos) from periodo where tipo = 'resgate'), 0)::bigint,
    -- Vencido = expirações já gravadas no período + saldos vencidos ainda não materializados agora.
    (coalesce((select -sum(valor_centavos) from periodo where tipo = 'expiracao'), 0)
      + coalesce((select sum(soma) from contas where vence <= now() and soma > 0), 0))::bigint,
    (coalesce((select -sum(valor_centavos) from periodo where tipo = 'estorno_credito'), 0)
      + coalesce((select sum(valor_centavos) from periodo where tipo = 'estorno_resgate'), 0))::bigint,
    (select valor from excedente)::bigint,
    coalesce((select sum(soma) from contas where vence > now() and soma > 0), 0)::bigint;
$$;

revoke all on function public.cashback_resumo(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.cashback_resumo(uuid, timestamptz, timestamptz) to authenticated;
