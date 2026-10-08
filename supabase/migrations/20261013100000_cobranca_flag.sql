-- Chave global de cobrança (decisão do dono, 2026-10-07: ninguém paga ainda).
--
-- `app_config.cobranca_ativa = false` DESLIGA a cobrança sem remover nada:
--   * acesso sempre liberado (assinatura_tem_acesso / barraca_assinatura_ativa);
--   * plano efetivo 'pro' (sem limite de barraca em criar_barraca; o front lê
--     plano 'pro' em assinatura_da_barraca, então some o corte de histórico/exportar);
--   * sem contagem de trial: assinatura_da_barraca devolve status 'active' neutro.
--
-- NÃO muda: trigger criar_assinatura_trial (continua criando o trial e a regra
-- de 1 trial por e-mail), tabelas, ofertas Kirvano, Stripe e webhooks. Eles seguem
-- gravando o status real em `assinaturas`; a chave só decide se ele é APLICADO.
--
-- Religar: update public.app_config set valor = 'true'::jsonb where chave = 'cobranca_ativa';
-- Detalhes e desfazer completo: docs/cobranca.md.
--
-- Falha segura: só o valor JSON `false` desliga. Linha ausente, apagada ou com
-- qualquer outro valor = cobrança ATIVA (comportamento de antes desta migration).
--
-- ADITIVA e reversível. Assinatura de assinatura_da_barraca ganha 1 coluna de
-- retorno (cobranca_ativa): clientes antigos ignoram o campo extra.

-- 1) Configuração global (sem policy: ninguém lê nem escreve pela API; só funções
-- SECURITY DEFINER e o dono do banco).
create table if not exists public.app_config (
  chave text primary key,
  valor jsonb not null,
  atualizado_em timestamptz not null default now()
);

alter table public.app_config enable row level security;

insert into public.app_config (chave, valor)
values ('cobranca_ativa', 'false'::jsonb)
on conflict (chave) do nothing;

create or replace function public.cobranca_ativa()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((select valor <> 'false'::jsonb from public.app_config where chave = 'cobranca_ativa'), true);
$$;

-- 2) Acesso: com a cobrança desligada, sempre liberado. O resto é o CASE de antes.
create or replace function public.assinatura_tem_acesso(
  p_assinatura public.assinaturas,
  p_now timestamptz default now()
)
returns boolean
language sql
stable
set search_path = public, pg_temp
as $$
  select not public.cobranca_ativa() or case p_assinatura.status
    when 'trialing' then p_assinatura.trial_ends_at is not null and p_now < p_assinatura.trial_ends_at
    when 'active'   then true
    when 'past_due' then p_assinatura.grace_until is not null and p_now < p_assinatura.grace_until
    when 'canceled' then p_assinatura.current_period_end is not null and p_now < p_assinatura.current_period_end
    else false
  end;
$$;

-- Usada nas policies de pedidos. Dono sem linha em `assinaturas` dava false; com a
-- cobrança desligada também libera.
create or replace function public.barraca_assinatura_ativa(p_barraca_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select not public.cobranca_ativa() or coalesce(
    (
      select public.assinatura_tem_acesso(a, now())
      from public.usuarios_barracas ub
      join public.assinaturas a on a.usuario_id = ub.usuario_id
      where ub.barraca_id = p_barraca_id
        and ub.papel = 'dono'
      limit 1
    ),
    false
  );
$$;

-- 3) Status que o app lê. Com a cobrança desligada devolve um estado neutro
-- (active/pro, sem trial nem período) e cobranca_ativa = false. O retorno ganha uma
-- coluna, então é preciso recriar a função.
drop function if exists public.assinatura_da_barraca(text);

create or replace function public.assinatura_da_barraca(p_slug text)
returns table(
  status text,
  plano text,
  ciclo text,
  tem_acesso boolean,
  dias_restantes_trial integer,
  trial_ends_at timestamptz,
  current_period_end timestamptz,
  eh_dono boolean,
  cobranca_ativa boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_barraca_id uuid;
  v_dono_id uuid;
  v_assinatura public.assinaturas;
  v_cobranca boolean := public.cobranca_ativa();
begin
  select id into v_barraca_id from public.barracas where slug = p_slug;
  if v_barraca_id is null then
    raise exception 'Barraca não encontrada';
  end if;

  if not public.usuario_tem_acesso_barraca(v_barraca_id) then
    raise exception 'Sem acesso a esta barraca';
  end if;

  select ub.usuario_id into v_dono_id
    from public.usuarios_barracas ub
   where ub.barraca_id = v_barraca_id and ub.papel = 'dono'
   limit 1;

  if v_dono_id is null then
    return query select 'active'::text, 'pro'::text, null::text, true, null::integer,
      null::timestamptz, null::timestamptz, false, v_cobranca;
    return;
  end if;

  if not v_cobranca then
    return query select 'active'::text, 'pro'::text, null::text, true, null::integer,
      null::timestamptz, null::timestamptz, (v_dono_id = auth.uid()), false;
    return;
  end if;

  select * into v_assinatura from public.assinaturas where usuario_id = v_dono_id;

  return query select
    v_assinatura.status,
    v_assinatura.plan,
    v_assinatura.cycle,
    public.assinatura_tem_acesso(v_assinatura, now()),
    case
      when v_assinatura.status = 'trialing' and v_assinatura.trial_ends_at is not null
        then greatest(0, ceil(extract(epoch from (v_assinatura.trial_ends_at - now())) / 86400))::integer
      else null
    end,
    v_assinatura.trial_ends_at,
    v_assinatura.current_period_end,
    (v_dono_id = auth.uid()),
    true;
end;
$$;

grant execute on function public.assinatura_da_barraca(text) to authenticated;

-- 4) Limite de 1 barraca do Essencial só vale com a cobrança ativa.
create or replace function public.criar_barraca(p_nome text, p_slug text)
returns public.barracas
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nome text := trim(p_nome);
  v_slug text := trim(p_slug);
  v_barraca public.barracas;
  v_plano text;
begin
  if auth.uid() is null then
    raise exception 'Não autenticado';
  end if;

  select plan into v_plano from public.assinaturas where usuario_id = auth.uid();

  if public.cobranca_ativa() and v_plano = 'essencial' and exists (
    select 1 from public.usuarios_barracas where usuario_id = auth.uid() and papel = 'dono'
  ) then
    raise exception 'O plano Essencial permite só 1 barraca. Faça upgrade para o Pro pra criar mais.';
  end if;

  if v_nome = '' then
    raise exception 'Nome da barraca não pode ser vazio';
  end if;

  if v_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then
    raise exception 'Endereço inválido — use só letras minúsculas, números e hífen';
  end if;

  if exists (select 1 from public.barracas where slug = v_slug) then
    raise exception 'Esse endereço já está em uso';
  end if;

  insert into public.barracas (
    nome, slug, modo, verde_ate, amarelo_ate, metodos_pagamento_ativos
  )
  values (
    v_nome, v_slug, 'claro', 15, 30,
    '["dinheiro", "debito", "credito", "pix"]'::jsonb
  )
  returning * into v_barraca;

  insert into public.usuarios_barracas (usuario_id, barraca_id, papel)
  values (auth.uid(), v_barraca.id, 'dono');

  return v_barraca;
end;
$$;
