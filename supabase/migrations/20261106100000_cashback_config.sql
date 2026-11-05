-- Cashback do cardápio digital, M1: configuração por barraca e cashback_config.
-- Spec: docs/superpowers/specs/2026-10-27-cashback-design.md (seções 7.2 e 15).
-- ADITIVA: colunas novas em barracas (desligado por padrão) e uma função pública de leitura.
-- A barraca financia o cashback; application_fee e a taxa Sai aê de R$ 0,99 não mudam.
-- Rollback: drop function public.cashback_config(text); alter table public.barracas drop column cashback_*.

-- SUPOSIÇÃO-CASHBACK-2 (spec §20.2): nasce desligado e só liga depois do termo aceito.
-- SUPOSIÇÃO-CASHBACK-3 (spec §20.3): padrão de 5% (500 bp), 60 dias e teto de uso de 50% dos itens.
alter table public.barracas
  add column if not exists cashback_habilitado boolean not null default false,
  add column if not exists cashback_percentual_bp integer not null default 500,
  add column if not exists cashback_validade_dias integer not null default 60,
  add column if not exists cashback_teto_uso_pct integer not null default 50,
  add column if not exists cashback_termo_aceito_em timestamptz;

alter table public.barracas drop constraint if exists barracas_cashback_percentual_bp_check;
alter table public.barracas
  add constraint barracas_cashback_percentual_bp_check check (cashback_percentual_bp between 100 and 1500);

alter table public.barracas drop constraint if exists barracas_cashback_validade_dias_check;
alter table public.barracas
  add constraint barracas_cashback_validade_dias_check check (cashback_validade_dias between 30 and 90);

alter table public.barracas drop constraint if exists barracas_cashback_teto_uso_pct_check;
alter table public.barracas
  add constraint barracas_cashback_teto_uso_pct_check check (cashback_teto_uso_pct between 10 and 90);

-- Só liga depois de o dono aceitar o aviso fiscal e de passivo (spec §4 e §10).
alter table public.barracas drop constraint if exists barracas_cashback_termo_check;
alter table public.barracas
  add constraint barracas_cashback_termo_check check (not cashback_habilitado or cashback_termo_aceito_em is not null);

-- Pública, como cupom_config: devolve só o necessário para o front mostrar a oferta. Slug inexistente = nenhuma linha.
create or replace function public.cashback_config(p_slug text)
returns table (habilitado boolean, percentual_bp integer, teto_uso_pct integer, validade_dias integer)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select b.cashback_habilitado, b.cashback_percentual_bp, b.cashback_teto_uso_pct, b.cashback_validade_dias
    from public.barracas b
   where b.slug = p_slug;
$$;
revoke all on function public.cashback_config(text) from public;
grant execute on function public.cashback_config(text) to anon, authenticated;
