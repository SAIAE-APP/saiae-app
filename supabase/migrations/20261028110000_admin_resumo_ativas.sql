-- Painel do dono do sistema, funcionalidade 2: barracas ativas agora e cartões de resumo
-- (docs/roadmap-admin-e-observabilidade.md). Aditiva: só um índice e uma função nova.
-- Devolve contagens e nomes de barraca; nenhum dado de cliente final sai daqui.
--
-- "Ativa agora" = ao menos um pedido não cancelado criado nas últimas `p_janela_horas` horas
-- (parâmetro, padrão 2). "Vendia e parou" = pedidos em pelo menos 5 dos 7 dias que vão de 9 a 3
-- dias atrás (contando hoje como dia 0) e nenhum pedido nos últimos 3 dias (hoje e os 2 anteriores).
--
-- shortcut: "hoje" e "dia" usam America/Sao_Paulo para todas as barracas; usar `barracas.fuso`
-- por barraca quando houver cliente fora desse fuso.

-- Os índices atuais de `pedidos` começam por barraca_id; o painel olha todas as barracas por
-- janela de tempo, então precisa de um por criado_em.
create index if not exists pedidos_criado_em_idx on public.pedidos (criado_em desc);

create or replace function public.admin_resumo_ativas(p_janela_horas integer default 2)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  c_fuso constant text := 'America/Sao_Paulo';
  c_dias_vendia constant integer := 5;
  v_janela integer := greatest(1, least(coalesce(p_janela_horas, 2), 72));
  v_hoje date := (now() at time zone c_fuso)::date;
  v_inicio_hoje timestamptz := (v_hoje::timestamp at time zone c_fuso);
  v_resultado jsonb;
begin
  if not exists (select 1 from public.superadmins s where s.usuario_id = auth.uid()) then
    raise exception 'acesso negado' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'janela_horas', v_janela,
    'ativas_agora', (
      select count(distinct p.barraca_id)
        from public.pedidos p
       where p.criado_em >= now() - make_interval(hours => v_janela)
         and p.cancelado_em is null),
    'pedidos_hoje', (
      select count(*)
        from public.pedidos p
       where p.criado_em >= v_inicio_hoje and p.cancelado_em is null),
    'pedidos_hoje_por_barraca', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'barraca_id', t.id, 'nome', t.nome, 'slug', t.slug, 'pedidos', t.n
             ) order by t.n desc, t.nome), '[]'::jsonb)
        from (select b.id, b.nome, b.slug, count(*) as n
                from public.pedidos p
                join public.barracas b on b.id = p.barraca_id
               where p.criado_em >= v_inicio_hoje and p.cancelado_em is null
               group by b.id, b.nome, b.slug
               order by n desc, b.nome
               limit 10) t),
    'barracas_novas_7d', (
      select count(*) from public.barracas b where b.criada_em >= now() - interval '7 days'),
    'trials_acabando_7d', (
      select count(*)
        from public.assinaturas a
       where a.status = 'trialing'
         and a.trial_ends_at between now() and now() + interval '7 days'),
    'pararam', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'barraca_id', t.id, 'nome', t.nome, 'slug', t.slug, 'ultimo_pedido_em', t.ultimo
             ) order by t.ultimo desc, t.nome), '[]'::jsonb)
        from (select b.id, b.nome, b.slug, max(p.criado_em) as ultimo
                from public.barracas b
                join public.pedidos p on p.barraca_id = b.id and p.cancelado_em is null
               where p.criado_em >= ((v_hoje - 9)::timestamp at time zone c_fuso)
               group by b.id, b.nome, b.slug
              having count(distinct (p.criado_em at time zone c_fuso)::date) filter (
                       where (p.criado_em at time zone c_fuso)::date <= v_hoje - 3) >= c_dias_vendia
                 and count(*) filter (
                       where (p.criado_em at time zone c_fuso)::date >= v_hoje - 2) = 0
               order by ultimo desc, b.nome
               limit 50) t),
    'pedidos_por_dia', (
      select jsonb_agg(jsonb_build_object('dia', d.dia, 'pedidos', coalesce(c.n, 0)) order by d.dia)
        from generate_series(v_hoje - 13, v_hoje, interval '1 day') as g(dia_ts)
        cross join lateral (select g.dia_ts::date as dia) d
        left join (select (p.criado_em at time zone c_fuso)::date as dia, count(*) as n
                     from public.pedidos p
                    where p.criado_em >= ((v_hoje - 13)::timestamp at time zone c_fuso)
                      and p.cancelado_em is null
                    group by 1) c on c.dia = d.dia)
  ) into v_resultado;

  return v_resultado;
end;
$$;

revoke all on function public.admin_resumo_ativas(integer) from public, anon;
grant execute on function public.admin_resumo_ativas(integer) to authenticated;
