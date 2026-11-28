-- Gestão por IA (MCP), fatia 2: aprovação do dono fora do chat e aplicação transacional.
-- Depende de 20261127100000_mcp_gestao.sql. ADITIVA.
--
-- Rollback:
--   drop function if exists public.mcp_proposta_criar(uuid, uuid, integer);
--   drop function if exists public.mcp_proposta_aplicar(uuid, uuid);
--   drop function if exists public.mcp_proposta_listar(uuid);
--   drop function if exists public.mcp_proposta_decidir(uuid, boolean);
--   drop table if exists public.mcp_propostas;
--
-- Fluxo: a IA PROPÕE (mcp_proposta_criar); o dono APROVA no app, logado (mcp_proposta_decidir); a IA pede para
-- APLICAR (mcp_proposta_aplicar). O aplicar valida token, titularidade, aprovação, validade e preço, grava o preço,
-- fecha a proposta e registra a auditoria na MESMA transação: se qualquer passo falha, nada muda.

create table if not exists public.mcp_propostas (
  id uuid primary key default gen_random_uuid(),
  barraca_id uuid not null references public.barracas(id) on delete cascade,
  token_id uuid not null references public.mcp_tokens(id) on delete cascade,
  item_id uuid not null references public.itens(id) on delete cascade,
  preco_de integer not null,
  preco_para integer not null,
  estado text not null default 'pendente',
  criado_em timestamptz not null default now(),
  expira_em timestamptz not null default now() + interval '15 minutes',
  decidido_em timestamptz,
  decidido_por uuid,
  aplicado_em timestamptz,
  constraint mcp_propostas_estado_check check (estado in ('pendente', 'aprovada', 'recusada', 'aplicada', 'expirada')),
  constraint mcp_propostas_preco_check check (preco_de >= 0 and preco_para between 1 and 10000000)
);
create index if not exists mcp_propostas_barraca_idx on public.mcp_propostas (barraca_id, estado, criado_em desc);

alter table public.mcp_propostas enable row level security;
revoke all on table public.mcp_propostas from public, anon, authenticated;

-- Só a edge function (service role). Valida o token na hora e cria a proposta; no máximo 10 pendentes por barraca.
create or replace function public.mcp_proposta_criar(p_token_id uuid, p_item_id uuid, p_para integer)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_t public.mcp_tokens%rowtype;
  v_item public.itens%rowtype;
  v_id uuid;
begin
  select t.* into v_t from public.mcp_tokens t
  where t.id = p_token_id and t.revogado_em is null
    and exists (select 1 from public.usuarios_barracas ub
                where ub.barraca_id = t.barraca_id and ub.usuario_id = t.criado_por and ub.papel = 'dono');
  if not found then
    return jsonb_build_object('estado', 'token_invalido');
  end if;
  if p_para is null or p_para < 1 or p_para > 10000000 then
    return jsonb_build_object('estado', 'preco_invalido');
  end if;
  select * into v_item from public.itens where id = p_item_id and barraca_id = v_t.barraca_id;
  if not found then
    return jsonb_build_object('estado', 'item_nao_encontrado');
  end if;
  if v_item.preco_aberto then
    return jsonb_build_object('estado', 'preco_aberto');
  end if;
  if v_item.preco_centavos = p_para then
    return jsonb_build_object('estado', 'sem_mudanca', 'nome', v_item.nome);
  end if;
  update public.mcp_propostas set estado = 'expirada'
    where barraca_id = v_t.barraca_id and estado in ('pendente', 'aprovada') and expira_em < now();
  if (select count(*) from public.mcp_propostas where barraca_id = v_t.barraca_id and estado = 'pendente') >= 10 then
    return jsonb_build_object('estado', 'muitas_pendentes');
  end if;

  insert into public.mcp_propostas (barraca_id, token_id, item_id, preco_de, preco_para)
  values (v_t.barraca_id, v_t.id, v_item.id, v_item.preco_centavos, p_para)
  returning id into v_id;
  insert into public.mcp_auditoria (barraca_id, token_id, ferramenta, argumentos, resultado)
  values (v_t.barraca_id, v_t.id, 'alterar_preco_item',
          jsonb_build_object('proposta_id', v_id, 'item_id', v_item.id, 'de', v_item.preco_centavos, 'para', p_para),
          'proposta criada: ' || v_item.nome);
  return jsonb_build_object('estado', 'ok', 'proposta_id', v_id, 'nome', v_item.nome,
                            'de', v_item.preco_centavos, 'para', p_para);
end;
$$;

-- Só a edge function. Tudo ou nada.
create or replace function public.mcp_proposta_aplicar(p_token_id uuid, p_proposta_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_p public.mcp_propostas%rowtype;
  v_item public.itens%rowtype;
begin
  select * into v_p from public.mcp_propostas where id = p_proposta_id and token_id = p_token_id for update;
  if not found then
    return jsonb_build_object('estado', 'nao_encontrada');
  end if;
  -- FOR SHARE: revogar o token ou tirar o dono espera esta transação terminar (e vice-versa), sem janela entre conferir e gravar.
  perform 1
  from public.mcp_tokens t
  join public.usuarios_barracas ub
    on ub.barraca_id = t.barraca_id and ub.usuario_id = t.criado_por and ub.papel = 'dono'
  where t.id = p_token_id and t.revogado_em is null and t.barraca_id = v_p.barraca_id
  for share of t, ub;
  if not found then
    return jsonb_build_object('estado', 'token_invalido');
  end if;
  if v_p.estado = 'aplicada' then
    return jsonb_build_object('estado', 'ja_aplicada');
  end if;
  if v_p.estado = 'pendente' then
    return jsonb_build_object('estado', 'aguardando_aprovacao');
  end if;
  if v_p.estado <> 'aprovada' then
    return jsonb_build_object('estado', v_p.estado);
  end if;
  select * into v_item from public.itens where id = v_p.item_id and barraca_id = v_p.barraca_id for update;
  if not found or v_item.preco_aberto then
    return jsonb_build_object('estado', 'item_invalido');
  end if;
  -- Depois de todos os locks, com o relógio real (now() é o início da transação e pode estar velho).
  if v_p.expira_em < clock_timestamp() then
    update public.mcp_propostas set estado = 'expirada' where id = v_p.id;
    return jsonb_build_object('estado', 'expirada');
  end if;
  if v_item.preco_centavos <> v_p.preco_de then
    return jsonb_build_object('estado', 'preco_mudou');
  end if;

  update public.itens set preco_centavos = v_p.preco_para where id = v_item.id;
  update public.mcp_propostas set estado = 'aplicada', aplicado_em = now() where id = v_p.id;
  insert into public.mcp_auditoria (barraca_id, token_id, ferramenta, argumentos, resultado)
  values (v_p.barraca_id, p_token_id, 'alterar_preco_item',
          jsonb_build_object('proposta_id', v_p.id, 'item_id', v_item.id, 'de', v_p.preco_de, 'para', v_p.preco_para),
          'ok: ' || v_item.nome);
  return jsonb_build_object('estado', 'ok', 'nome', v_item.nome, 'de', v_p.preco_de, 'para', v_p.preco_para);
end;
$$;

-- Dono logado: propostas esperando decisão.
create or replace function public.mcp_proposta_listar(p_barraca_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or not exists (
    select 1 from public.usuarios_barracas
    where barraca_id = p_barraca_id and usuario_id = auth.uid() and papel = 'dono'
  ) then
    return '[]'::jsonb;
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', p.id, 'item_nome', i.nome, 'preco_de', p.preco_de, 'preco_para', p.preco_para,
      'token_nome', t.nome, 'criado_em', p.criado_em, 'expira_em', p.expira_em
    ) order by p.criado_em desc)
    from public.mcp_propostas p
    join public.itens i on i.id = p.item_id
    join public.mcp_tokens t on t.id = p.token_id
    where p.barraca_id = p_barraca_id and p.estado = 'pendente' and p.expira_em >= now()
  ), '[]'::jsonb);
end;
$$;

-- Dono logado aprova ou recusa. Só proposta pendente e dentro do prazo.
create or replace function public.mcp_proposta_decidir(p_proposta_id uuid, p_aprovar boolean)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_p public.mcp_propostas%rowtype;
begin
  if auth.uid() is null then
    return jsonb_build_object('estado', 'nao_autenticado');
  end if;
  select * into v_p from public.mcp_propostas where id = p_proposta_id for update;
  if not found or not exists (
    select 1 from public.usuarios_barracas
    where barraca_id = v_p.barraca_id and usuario_id = auth.uid() and papel = 'dono'
  ) then
    return jsonb_build_object('estado', 'sem_acesso');
  end if;
  if v_p.estado <> 'pendente' then
    return jsonb_build_object('estado', 'ja_decidida');
  end if;
  if v_p.expira_em < clock_timestamp() then
    update public.mcp_propostas set estado = 'expirada' where id = v_p.id;
    return jsonb_build_object('estado', 'expirada');
  end if;
  update public.mcp_propostas
    set estado = case when coalesce(p_aprovar, false) then 'aprovada' else 'recusada' end,
        decidido_em = now(), decidido_por = auth.uid()
    where id = v_p.id;
  insert into public.mcp_auditoria (barraca_id, token_id, ferramenta, argumentos, resultado)
  values (v_p.barraca_id, v_p.token_id, 'alterar_preco_item', jsonb_build_object('proposta_id', v_p.id),
          case when coalesce(p_aprovar, false) then 'dono aprovou' else 'dono recusou' end);
  return jsonb_build_object('estado', 'ok');
end;
$$;

revoke all on function public.mcp_proposta_criar(uuid, uuid, integer) from public, anon, authenticated;
revoke all on function public.mcp_proposta_aplicar(uuid, uuid) from public, anon, authenticated;
revoke all on function public.mcp_proposta_listar(uuid) from public, anon;
revoke all on function public.mcp_proposta_decidir(uuid, boolean) from public, anon;
grant execute on function public.mcp_proposta_criar(uuid, uuid, integer) to service_role;
grant execute on function public.mcp_proposta_aplicar(uuid, uuid) to service_role;
grant execute on function public.mcp_proposta_listar(uuid) to authenticated;
grant execute on function public.mcp_proposta_decidir(uuid, boolean) to authenticated;
