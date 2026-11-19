-- Oferta nova: plano 'ponto' (assinatura base, 1 ponto de venda, mensal ou anual) e plano 'fiscal'
-- (módulo NFC-e, sempre mensal). ADITIVA: essencial/pro, legados, trial, preços e ciclos não mudam.
--   * NÃO insere linhas em assinatura_ofertas: os price IDs reais da Stripe entram na implantação.
--   * 'fiscal' vive só em assinatura_ofertas; assinaturas.plan NÃO aceita 'fiscal' (o módulo é cobrado em
--     fiscal_assinaturas e o acesso continua em modulos_barraca/modulo_ativo).
--   * 'ponto' conta como plano pago normal: acesso por status (assinatura_tem_acesso não enumera plano) e
--     assinatura_da_barraca devolve a.plan como está. Os gates Pro (histórico, exportar, equipe) são só de UI
--     por plano==='essencial', então 'ponto' passa como Pro; o backend não tem enforcement.
--   * criar_barraca: 'ponto' passa a ter limite de 1 barraca (como o essencial). 'pro', legado, trial e barracas
--     já existentes não mudam (o limite só barra criação nova).
-- Rollback: voltar os CHECKs para ('essencial','pro'), recriar criar_barraca/admin_definir_plano/admin_listar_barracas
--   a partir de 20261020100000, 20261108110000 e 20261108130000, e apagar a linha 'ponto' de ia_limites_plano.

-- 1) CHECKs. Localiza por tabela + coluna + definição esperada, nunca por nome nem só por texto: só cai o CHECK de UMA coluna
-- (conkey = a coluna) cuja definição lista 'essencial' e 'pro' (o CHECK antigo do plano). Qualquer outro CHECK da tabela,
-- ou da mesma coluna com outra definição, é preservado.
do $$
declare
  alvo record;
  r record;
begin
  for alvo in
    select * from (values ('public.assinaturas'::regclass, 'plan'), ('public.assinatura_ofertas'::regclass, 'plano')) as t(tabela, coluna)
  loop
    for r in
      select c.conname
        from pg_constraint c
       where c.contype = 'c'
         and c.conrelid = alvo.tabela
         and c.conkey = array[(select a.attnum from pg_attribute a where a.attrelid = alvo.tabela and a.attname = alvo.coluna)]
         and pg_get_constraintdef(c.oid) like '%''essencial''%'
         and pg_get_constraintdef(c.oid) like '%''pro''%'
    loop
      execute format('alter table %s drop constraint %I', alvo.tabela, r.conname);
    end loop;
  end loop;
end $$;

alter table public.assinaturas drop constraint if exists assinaturas_plan_check;
alter table public.assinaturas
  add constraint assinaturas_plan_check check (plan in ('essencial', 'pro', 'ponto'));
alter table public.assinatura_ofertas drop constraint if exists assinatura_ofertas_plano_check;
alter table public.assinatura_ofertas drop constraint if exists assinatura_ofertas_fiscal_so_mensal;
alter table public.assinatura_ofertas
  add constraint assinatura_ofertas_plano_check check (plano in ('essencial', 'pro', 'ponto', 'fiscal'));
alter table public.assinatura_ofertas
  add constraint assinatura_ofertas_fiscal_so_mensal check (plano <> 'fiscal' or ciclo = 'mensal');

-- 2) Limite de conversas da IA: 'ponto' com os mesmos limites do 'pro'. A tabela nasce vazia; sem linha do pro,
-- nada é inserido (ia_contexto já usa o padrão quando falta a linha).
insert into public.ia_limites_plano (plano, conversas_mes)
select 'ponto', l.conversas_mes from public.ia_limites_plano l where l.plano = 'pro'
on conflict (plano) do nothing;

-- 3) criar_barraca: igual à versão de 20261020100000, só muda o limite (essencial e ponto).
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

  if public.cobranca_ativa() and v_plano in ('essencial', 'ponto') and exists (
    select 1 from public.usuarios_barracas where usuario_id = auth.uid() and papel = 'dono'
  ) then
    if v_plano = 'ponto' then
      raise exception 'Sua assinatura cobre um ponto de venda. Para adicionar outro ponto, fale com o suporte.';
    end if;
    raise exception 'O plano Essencial permite só 1 barraca. Faça upgrade para o Pro pra criar mais.';
  end if;

  if v_nome = '' then
    raise exception 'Nome da barraca não pode ser vazio';
  end if;

  if v_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then
    raise exception 'Endereço inválido — use só letras minúsculas, números e hífen';
  end if;

  if public.slug_reservado(v_slug) then
    raise exception 'Esse endereço já está em uso';
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
grant execute on function public.criar_barraca(text, text) to authenticated;

-- 4) admin_definir_plano: aceita 'ponto'. Corpo igual a 20261108110000.
create or replace function public.admin_definir_plano(p_usuario_id uuid, p_plano text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_anterior text;
begin
  if not exists (select 1 from public.superadmins s where s.usuario_id = auth.uid()) then
    raise exception 'acesso negado' using errcode = '42501';
  end if;
  if p_plano is null or p_plano not in ('essencial', 'pro', 'ponto') then
    raise exception 'plano inválido' using errcode = '22023';
  end if;

  select a.plan into v_anterior from public.assinaturas a where a.usuario_id = p_usuario_id for update;
  if not found then
    raise exception 'conta sem assinatura' using errcode = '22023';
  end if;
  if v_anterior is not distinct from p_plano then
    return; -- mesmo plano: sem erro e sem log duplicado
  end if;

  update public.assinaturas set plan = p_plano, updated_at = now() where usuario_id = p_usuario_id;
  perform public.admin_registrar_acao('definir_plano', 'usuario', p_usuario_id,
    jsonb_build_object('plano', p_plano, 'plano_anterior', v_anterior));
end;
$$;
revoke all on function public.admin_definir_plano(uuid, text) from public, anon;
grant execute on function public.admin_definir_plano(uuid, text) to authenticated;

-- 5) admin_listar_barracas: corpo igual a 20261108130000; só o filtro de plano passa a aceitar 'ponto'.
-- (create or replace: a assinatura de retorno não muda, então as permissões e o admin_contar_filtros seguem valendo.)
create or replace function public.admin_listar_barracas(
  p_filtro text default null,
  p_plano text default null,
  p_limite integer default 50,
  p_offset integer default 0,
  p_busca text default null,
  p_ordem text default 'vencimento'
)
returns table (
  barraca_id uuid,
  nome text,
  slug text,
  email_dono text,
  plano text,
  estado text,
  tem_acesso boolean,
  inicio_em timestamptz,
  vencimento_em timestamptz,
  dias_restantes integer,
  origem_cobranca text,
  ultimo_pagamento_em timestamptz,
  total bigint,
  usuario_id uuid,
  bloqueada boolean,
  bloqueio_motivo text,
  origem_plano text,
  arquivada_em timestamptz,
  pedidos_7d bigint,
  pedidos_semana_anterior bigint,
  erros_24h bigint,
  versao_app text,
  plataforma text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_busca text := nullif(lower(btrim(p_busca)), '');
  v_ordem text := coalesce(p_ordem, 'vencimento');
begin
  if not exists (select 1 from public.superadmins s where s.usuario_id = auth.uid()) then
    raise exception 'acesso negado' using errcode = '42501';
  end if;
  if p_filtro is not null
     and p_filtro not in ('vence_7d', 'trial_acabando', 'vencida', 'bloqueada', 'legado', 'arquivada') then
    raise exception 'filtro invalido' using errcode = '22023';
  end if;
  if p_plano is not null and p_plano not in ('essencial', 'pro', 'ponto') then
    raise exception 'plano invalido' using errcode = '22023';
  end if;
  if v_ordem not in ('vencimento', 'nome', 'atividade', 'nova') then
    raise exception 'ordem invalida' using errcode = '22023';
  end if;

  return query
  with pedidos_agg as (
    select p.barraca_id as bid,
           count(*) filter (where p.criado_em >= now() - interval '7 days') as p7,
           count(*) filter (where p.criado_em >= now() - interval '14 days'
                              and p.criado_em < now() - interval '7 days') as p_ant,
           max(p.criado_em) as ultimo
      from public.pedidos p
     where p.cancelado_em is null
     group by p.barraca_id
  ),
  erros_agg as (
    select e.barraca_id as bid, count(*) as n
      from public.eventos_erro e
     where e.criado_em >= now() - interval '24 hours'
     group by e.barraca_id
  ),
  base as (
    select
      b.id as barraca_id,
      b.nome,
      b.slug,
      u.email::text as email_dono,
      ub.usuario_id,
      a.plan as plano,
      case
        when a.usuario_id is null then 'vencida'
        when a.status = 'trialing' and a.trial_ends_at is not null and now() < a.trial_ends_at then 'trial'
        when a.status = 'active' then 'ativa'
        when a.status = 'canceled' then 'cancelada'
        else 'vencida'
      end as estado,
      case when a.usuario_id is null then false else public.assinatura_tem_acesso(a) end as tem_acesso,
      coalesce(b.criada_em, a.updated_at) as inicio_em,
      case a.status
        when 'trialing' then a.trial_ends_at
        when 'past_due' then coalesce(a.grace_until, a.current_period_end)
        else a.current_period_end
      end as vencimento_em,
      case when a.stripe_subscription_id is not null then 'stripe' end as origem_cobranca,
      (select max(e.received_at)
         from public.eventos_webhook_stripe e
        where e.subscription_id = a.stripe_subscription_id
          and e.event = 'invoice.paid'
          and e.error is null) as ultimo_pagamento_em,
      coalesce(a.bloqueada_admin, false) as bloqueada,
      a.bloqueio_motivo,
      a.origem_plano,
      b.arquivada_em,
      coalesce(pa.p7, 0) as pedidos_7d,
      coalesce(pa.p_ant, 0) as pedidos_semana_anterior,
      coalesce(ea.n, 0) as erros_24h,
      v.versao_app,
      v.plataforma,
      pa.ultimo as ultimo_pedido_em
    from public.barracas b
    join public.usuarios_barracas ub on ub.barraca_id = b.id and ub.papel = 'dono'
    join auth.users u on u.id = ub.usuario_id
    left join public.assinaturas a on a.usuario_id = ub.usuario_id
    left join pedidos_agg pa on pa.bid = b.id
    left join erros_agg ea on ea.bid = b.id
    left join public.barracas_versao_app v on v.barraca_id = b.id
  ),
  filtrada as (
    select base.*
      from base
     where (p_plano is null or base.plano = p_plano)
       and (coalesce(p_filtro = 'arquivada', false) = (base.arquivada_em is not null))
       and (v_busca is null
         or strpos(lower(base.nome), v_busca) > 0
         or strpos(lower(base.slug), v_busca) > 0
         or strpos(lower(base.email_dono), v_busca) > 0)
       and (p_filtro is null or p_filtro = 'arquivada'
         or (p_filtro = 'vence_7d'
             and base.vencimento_em between now() and now() + interval '7 days')
         or (p_filtro = 'trial_acabando'
             and base.estado = 'trial'
             and base.vencimento_em <= now() + interval '7 days')
         or (p_filtro = 'vencida' and base.estado = 'vencida')
         or (p_filtro = 'bloqueada' and base.bloqueada)
         or (p_filtro = 'legado' and base.origem_plano = 'legado'))
  )
  select
    f.barraca_id, f.nome, f.slug, f.email_dono, f.plano, f.estado, f.tem_acesso,
    f.inicio_em, f.vencimento_em,
    case when f.vencimento_em is null then null
         else ceil(extract(epoch from (f.vencimento_em - now())) / 86400)::integer end,
    f.origem_cobranca, f.ultimo_pagamento_em,
    count(*) over (),
    f.usuario_id, f.bloqueada, f.bloqueio_motivo, f.origem_plano, f.arquivada_em,
    f.pedidos_7d, f.pedidos_semana_anterior, f.erros_24h, f.versao_app, f.plataforma
  from filtrada f
  order by
    case when v_ordem = 'nome' then f.nome end asc,
    case when v_ordem = 'nova' then f.inicio_em end desc nulls last,
    case when v_ordem = 'atividade' then f.ultimo_pedido_em end desc nulls last,
    case when v_ordem = 'vencimento' then f.vencimento_em end asc nulls last,
    f.nome, f.barraca_id
  limit greatest(1, least(coalesce(p_limite, 50), 200))
  offset greatest(0, coalesce(p_offset, 0));
end;
$$;

revoke all on function public.admin_listar_barracas(text, text, integer, integer, text, text) from public, anon;
grant execute on function public.admin_listar_barracas(text, text, integer, integer, text, text) to authenticated;
