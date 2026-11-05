-- Rollback: reaplicar as definições de whatsapp_avaliacao_salvar (20261101100000) e de disparos_publico e
--           integracao_avaliacao_config (20261101110000); drop index if exists pedidos_disparos_cliente_idx, pedidos_disparos_telefone_idx,
--           clientes_finais_disparos_idx.
-- Correções da revisão dos disparos (fase 3). ADITIVA (create or replace); depende de 20261101100000 e 20261101110000.
--   1. whatsapp_avaliacao_salvar: só o dono; o texto só pode ter {nome} {senha} {barraca}.
--   2. integracao_avaliacao_config: whatsapp_dono só com 8 a 15 dígitos; o número da IA só vale se confirmado, senão cai no
--      WhatsApp de pedidos.
--   3. disparos_publico: sem `or` no join (duas agregações por pedido), promoção não calcula atividade, reativação traz
--      os mais antigos primeiro (os que mais sumiram).

create index if not exists pedidos_disparos_cliente_idx
  on public.pedidos (barraca_id, cliente_id, criado_em) where cliente_id is not null and status <> 'cancelado';
create index if not exists pedidos_disparos_telefone_idx
  on public.pedidos (barraca_id, (coalesce(cliente_telefone, entrega_telefone)), criado_em)
  where coalesce(cliente_telefone, entrega_telefone) is not null and status <> 'cancelado';
create index if not exists clientes_finais_disparos_idx
  on public.clientes_finais (barraca_id, criado_em) where consentimento_marketing_em is not null;

create or replace function public.whatsapp_avaliacao_salvar(p_barraca_id uuid, p_ativa boolean, p_texto text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_habilitado boolean;
begin
  if auth.uid() is null then
    return jsonb_build_object('estado', 'nao_autenticado');
  end if;
  -- Só o dono muda a mensagem que vai aos clientes da loja.
  if not exists (
    select 1 from public.usuarios_barracas
     where barraca_id = p_barraca_id and usuario_id = auth.uid() and papel = 'dono'
  ) then
    return jsonb_build_object('estado', 'sem_acesso');
  end if;
  select whatsapp_disparos_habilitado into v_habilitado from public.barracas where id = p_barraca_id;
  if not coalesce(v_habilitado, false) then
    return jsonb_build_object('estado', 'modulo_desligado');
  end if;
  if p_ativa is null
     or (p_texto is not null and (
       btrim(p_texto) = ''
       or char_length(p_texto) > 500
       or exists (
         select 1 from regexp_matches(p_texto, '\{[^{}]*\}', 'g') m
          where m[1] not in ('{nome}', '{senha}', '{barraca}')
       )
     )) then
    return jsonb_build_object('estado', 'dados_invalidos');
  end if;
  update public.barracas set avaliacao_ativa = p_ativa, avaliacao_texto = p_texto where id = p_barraca_id;
  return jsonb_build_object('estado', 'ok');
end;
$fn$;

revoke all on function public.whatsapp_avaliacao_salvar(uuid, boolean, text) from public, anon;
grant execute on function public.whatsapp_avaliacao_salvar(uuid, boolean, text) to authenticated;

create or replace function public.integracao_avaliacao_config(p_barraca_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'ativo', b.whatsapp_disparos_habilitado and b.avaliacao_ativa,
    'texto', b.avaliacao_texto,
    'whatsapp_dono', (
      select d from (
        select case when b.ia_whatsapp_dono_confirmado_em is not null then regexp_replace(coalesce(b.ia_whatsapp_dono, ''), '\D', '', 'g') end as d
        union all
        select regexp_replace(coalesce(b.whatsapp_pedidos, ''), '\D', '', 'g')
      ) x where d ~ '^[0-9]{8,15}$' limit 1
    ),
    'barraca_nome', b.nome
  )
  from public.barracas b where b.id = p_barraca_id
$$;

revoke all on function public.integracao_avaliacao_config(uuid) from public, anon, authenticated;
grant execute on function public.integracao_avaliacao_config(uuid) to service_role;

create or replace function public.disparos_publico(p_barraca_id uuid, p_tipo text, p_dias integer)
returns table (telefone text, nome text)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
begin
  if p_tipo not in ('promocao', 'reativacao') then
    raise exception 'tipo_invalido';
  end if;
  if p_tipo = 'reativacao' and (p_dias is null or p_dias < 1) then
    raise exception 'dias_invalido';
  end if;
  if p_tipo = 'promocao' then
    -- Todos os consentidos; sem calcular atividade. Cadastros mais recentes primeiro.
    return query
    select c.telefone, c.nome
      from public.clientes_finais c
     where c.barraca_id = p_barraca_id and c.consentimento_marketing_em is not null
     order by c.criado_em desc, c.telefone;
    return;
  end if;
  -- Reativação: última atividade = maior entre o cadastro e o último pedido não cancelado, casado por cliente_id OU
  -- pelo telefone do pedido (duas agregações, sem `or` no join). Mais antigos primeiro.
  return query
  with por_cliente as (
    select p.cliente_id as cid, max(p.criado_em) as m
      from public.pedidos p
     where p.barraca_id = p_barraca_id and p.status <> 'cancelado' and p.cliente_id is not null
     group by p.cliente_id
  ), por_telefone as (
    select coalesce(p.cliente_telefone, p.entrega_telefone) as tel, max(p.criado_em) as m
      from public.pedidos p
     where p.barraca_id = p_barraca_id and p.status <> 'cancelado'
       and coalesce(p.cliente_telefone, p.entrega_telefone) is not null
     group by 1
  ), base as (
    select c.telefone as t, c.nome as n,
           greatest(c.criado_em, pc.m, pt.m) as ultima
      from public.clientes_finais c
      left join por_cliente pc on pc.cid = c.id
      left join por_telefone pt on pt.tel = c.telefone
     where c.barraca_id = p_barraca_id and c.consentimento_marketing_em is not null
  )
  select b.t, b.n from base b
   where b.ultima < now() - make_interval(days => p_dias)
   order by b.ultima asc, b.t;
end;
$fn$;

revoke all on function public.disparos_publico(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.disparos_publico(uuid, text, integer) to service_role;
