-- Painel do dono do sistema, funcionalidade 3: abrir uma barraca pelo painel, SÓ LEITURA
-- (docs/roadmap-admin-e-observabilidade.md). Aditiva: não altera `usuario_tem_acesso_barraca`,
-- policies nem RPCs existentes.
--
-- Como é somente leitura DE VERDADE: o superadmin não ganha linha em `usuarios_barracas` nem policy
-- nova em nenhuma tabela. Tudo que ele vê passa pelas funções abaixo, que só fazem SELECT (e gravam
-- apenas no log de acesso). Não existe caminho de escrita em pedido, caixa, cardápio nem ajustes,
-- então tentar gravar falha no banco e não só na tela.
--
-- Cada abertura grava uma linha em `acessos_admin_log` (quem, barraca, quando, modo, duração, quantas
-- revelações). Toda função de leitura exige um `acesso_id` aberto pelo próprio superadmin e ainda
-- válido (2 horas), conferindo a allowlist de novo a cada chamada. O dono da barraca vê a lista em
-- Ajustes > Conta (`acessos_admin_da_barraca`).
--
-- Dado de cliente final: nome só o primeiro, telefone com os 4 últimos dígitos; endereço não sai
-- na lista. Ver completo é `admin_barraca_revelar_cliente`, um pedido por vez, e cada revelação
-- entra em `acessos_admin_revelacoes`. Páginas de no máximo 50 linhas e nenhuma exportação.
--
-- Edição (cardápio) segue o mecanismo do suporte (migration 20261028150000_superadmin_vira_suporte.sql, que só
-- pode entrar depois de 20261023100000_acesso_suporte.sql).

create table if not exists public.acessos_admin_log (
  id uuid primary key default gen_random_uuid(),
  superadmin_id uuid references auth.users(id) on delete set null,
  barraca_id uuid not null references public.barracas(id) on delete cascade,
  modo text not null default 'leitura' check (modo in ('leitura')),
  aberto_em timestamptz not null default now(),
  ultimo_uso_em timestamptz not null default now(),
  revelacoes integer not null default 0
);
create index if not exists acessos_admin_log_barraca_idx on public.acessos_admin_log (barraca_id, aberto_em desc);
alter table public.acessos_admin_log enable row level security;
revoke all on table public.acessos_admin_log from public, anon, authenticated;

create table if not exists public.acessos_admin_revelacoes (
  id uuid primary key default gen_random_uuid(),
  acesso_id uuid not null references public.acessos_admin_log(id) on delete cascade,
  pedido_id uuid not null,
  em timestamptz not null default now()
);
alter table public.acessos_admin_revelacoes enable row level security;
revoke all on table public.acessos_admin_revelacoes from public, anon, authenticated;

-- Valida o acesso e devolve a barraca. Interna: só as funções abaixo (definer) chamam. As que a chamam
-- são VOLATILE de propósito (ela atualiza `ultimo_uso_em`), nunca STABLE.
create or replace function public.admin_acesso_barraca(p_acesso_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_barraca uuid;
begin
  if not exists (select 1 from public.superadmins s where s.usuario_id = auth.uid()) then
    raise exception 'acesso negado' using errcode = '42501';
  end if;
  update public.acessos_admin_log l
     set ultimo_uso_em = now()
   where l.id = p_acesso_id
     and l.superadmin_id = auth.uid()
     and l.aberto_em > now() - interval '2 hours'
  returning l.barraca_id into v_barraca;
  if v_barraca is null then
    raise exception 'acesso negado' using errcode = '42501';
  end if;
  return v_barraca;
end;
$$;

revoke all on function public.admin_acesso_barraca(uuid) from public, anon, authenticated;

create or replace function public.admin_abrir_barraca_leitura(p_barraca_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_acesso uuid;
  v_nome text;
  v_slug text;
begin
  if not exists (select 1 from public.superadmins s where s.usuario_id = auth.uid()) then
    raise exception 'acesso negado' using errcode = '42501';
  end if;
  select b.nome, b.slug into v_nome, v_slug from public.barracas b where b.id = p_barraca_id;
  if v_nome is null then
    raise exception 'barraca nao encontrada' using errcode = 'P0002';
  end if;
  insert into public.acessos_admin_log (superadmin_id, barraca_id)
  values (auth.uid(), p_barraca_id)
  returning id into v_acesso;
  return jsonb_build_object('acesso_id', v_acesso, 'barraca_id', p_barraca_id, 'nome', v_nome, 'slug', v_slug);
end;
$$;

revoke all on function public.admin_abrir_barraca_leitura(uuid) from public, anon;
grant execute on function public.admin_abrir_barraca_leitura(uuid) to authenticated;

-- Pedidos (Histórico e Cozinha). p_filtro: null = todos; 'abertos' = a fazer, pronto e saiu para entrega.
create or replace function public.admin_barraca_pedidos(
  p_acesso_id uuid,
  p_filtro text default null,
  p_limite integer default 30,
  p_offset integer default 0
)
returns table (
  pedido_id uuid,
  senha integer,
  status text,
  criado_em timestamptz,
  tipo_atendimento text,
  metodo_pagamento text,
  cliente_primeiro_nome text,
  telefone_mascarado text,
  total_centavos bigint,
  total bigint
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_barraca uuid;
begin
  v_barraca := public.admin_acesso_barraca(p_acesso_id);
  if p_filtro is not null and p_filtro <> 'abertos' then
    raise exception 'filtro invalido' using errcode = '22023';
  end if;

  return query
  select
    p.id, p.senha, p.status, p.criado_em, p.tipo_atendimento, p.metodo_pagamento,
    nullif(split_part(coalesce(p.cliente_nome, ''), ' ', 1), ''),
    case when coalesce(p.cliente_telefone, '') = '' then null
         else repeat('*', greatest(char_length(p.cliente_telefone) - 4, 0)) || right(p.cliente_telefone, 4) end,
    coalesce((select sum(i.preco_centavos_unitario::bigint * i.quantidade)
                from public.itens_do_pedido i where i.pedido_id = p.id and not i.removido), 0)::bigint,
    count(*) over ()
  from public.pedidos p
  where p.barraca_id = v_barraca
    and (p_filtro is null or p.status in ('a_fazer', 'pronto', 'saiu_entrega'))
  order by p.criado_em desc
  limit greatest(1, least(coalesce(p_limite, 30), 50))
  offset greatest(0, coalesce(p_offset, 0));
end;
$$;

revoke all on function public.admin_barraca_pedidos(uuid, text, integer, integer) from public, anon;
grant execute on function public.admin_barraca_pedidos(uuid, text, integer, integer) to authenticated;

-- Mostrar completo: um pedido por vez, cada chamada fica no log.
create or replace function public.admin_barraca_revelar_cliente(p_acesso_id uuid, p_pedido_id uuid)
returns table (
  cliente_nome text,
  cliente_telefone text,
  entrega_rua text,
  entrega_numero text,
  entrega_bairro text,
  entrega_referencia text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_barraca uuid;
begin
  v_barraca := public.admin_acesso_barraca(p_acesso_id);
  if not exists (select 1 from public.pedidos p where p.id = p_pedido_id and p.barraca_id = v_barraca) then
    raise exception 'acesso negado' using errcode = '42501';
  end if;
  insert into public.acessos_admin_revelacoes (acesso_id, pedido_id) values (p_acesso_id, p_pedido_id);
  update public.acessos_admin_log l set revelacoes = l.revelacoes + 1 where l.id = p_acesso_id;
  return query
  select p.cliente_nome, p.cliente_telefone, p.entrega_rua, p.entrega_numero, p.entrega_bairro, p.entrega_referencia
    from public.pedidos p where p.id = p_pedido_id;
end;
$$;

revoke all on function public.admin_barraca_revelar_cliente(uuid, uuid) from public, anon;
grant execute on function public.admin_barraca_revelar_cliente(uuid, uuid) to authenticated;

-- Faturamento por dia e forma de pagamento (pedido cancelado fora; total = itens não removidos,
-- como em `calcularTotalPedido`). p_dias vai de 1 a 90.
create or replace function public.admin_barraca_faturamento(p_acesso_id uuid, p_dias integer default 14)
returns table (dia date, metodo_pagamento text, pedidos bigint, total_centavos bigint)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_barraca uuid;
  v_dias integer := greatest(1, least(coalesce(p_dias, 14), 90));
begin
  v_barraca := public.admin_acesso_barraca(p_acesso_id);
  return query
  select p.data_operacao, p.metodo_pagamento, count(*),
         coalesce(sum((select sum(i.preco_centavos_unitario::bigint * i.quantidade)
                         from public.itens_do_pedido i where i.pedido_id = p.id and not i.removido)), 0)::bigint
    from public.pedidos p
   where p.barraca_id = v_barraca
     and p.status <> 'cancelado'
     and p.data_operacao >= current_date - (v_dias - 1)
   group by p.data_operacao, p.metodo_pagamento
   order by p.data_operacao desc, p.metodo_pagamento;
end;
$$;

revoke all on function public.admin_barraca_faturamento(uuid, integer) from public, anon;
grant execute on function public.admin_barraca_faturamento(uuid, integer) to authenticated;

create or replace function public.admin_barraca_caixas(p_acesso_id uuid, p_limite integer default 14)
returns table (
  data date,
  status text,
  valor_abertura_centavos integer,
  valor_fechamento_centavos integer,
  valor_esperado_centavos integer,
  diferenca_centavos integer,
  aberto_em timestamptz,
  fechado_em timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_barraca uuid;
begin
  v_barraca := public.admin_acesso_barraca(p_acesso_id);
  return query
  select c.data, c.status, c.valor_abertura_centavos, c.valor_fechamento_centavos,
         c.valor_esperado_centavos, c.diferenca_centavos, c.aberto_em, c.fechado_em
    from public.caixas c
   where c.barraca_id = v_barraca
   order by c.data desc, c.aberto_em desc
   limit greatest(1, least(coalesce(p_limite, 14), 60));
end;
$$;

revoke all on function public.admin_barraca_caixas(uuid, integer) from public, anon;
grant execute on function public.admin_barraca_caixas(uuid, integer) to authenticated;

-- Ajustes: só configuração sem segredo. Fora daqui, de propósito: tokens, PIN, CNPJ e dados do
-- emitente, contatos do dono, pagamento e fiscal além de ligado/desligado.
create or replace function public.admin_barraca_ajustes(p_acesso_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_barraca uuid;
begin
  v_barraca := public.admin_acesso_barraca(p_acesso_id);
  return (
    select jsonb_build_object(
      'nome', b.nome,
      'slug', b.slug,
      'criada_em', b.criada_em,
      'fuso', b.fuso,
      'modos_atendimento', b.modos_atendimento,
      'taxa_entrega_habilitada', b.taxa_entrega_habilitada,
      'taxa_entrega_centavos', b.taxa_entrega_centavos,
      'pagamento_provedor', b.pagamento_provedor,
      'pagamento_online_habilitado', b.pagamento_online_habilitado,
      'pagar_na_entrega_habilitado', b.pagar_na_entrega_habilitado,
      'fiscal_habilitado', b.fiscal_habilitado,
      'impressora_habilitada', b.impressora_habilitada,
      'ia_habilitada', b.ia_habilitada,
      'cupons_habilitado', b.cupons_habilitado,
      'opcoes_habilitado', b.opcoes_habilitado,
      'estoque_bloqueia', b.estoque_bloqueia,
      'bloquear_fora_do_horario', b.bloquear_fora_do_horario,
      'onboarding_concluido_em', b.onboarding_concluido_em,
      'assinatura', (
        select jsonb_build_object('status', a.status, 'plano', a.plan, 'trial_ends_at', a.trial_ends_at,
                                  'current_period_end', a.current_period_end)
          from public.usuarios_barracas ub
          join public.assinaturas a on a.usuario_id = ub.usuario_id
         where ub.barraca_id = b.id and ub.papel = 'dono'
         limit 1)
    )
    from public.barracas b where b.id = v_barraca);
end;
$$;

revoke all on function public.admin_barraca_ajustes(uuid) from public, anon;
grant execute on function public.admin_barraca_ajustes(uuid) to authenticated;

-- O dono vê quem abriu a barraca dele, quando, por quanto tempo e quantas revelações houve.
create or replace function public.acessos_admin_da_barraca(p_barraca_id uuid)
returns table (aberto_em timestamptz, duracao_segundos integer, modo text, revelacoes integer)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (
    select 1 from public.usuarios_barracas ub
     where ub.barraca_id = p_barraca_id and ub.usuario_id = auth.uid() and ub.papel = 'dono'
  ) then
    raise exception 'acesso negado' using errcode = '42501';
  end if;
  return query
  select l.aberto_em, extract(epoch from (l.ultimo_uso_em - l.aberto_em))::integer, l.modo, l.revelacoes
    from public.acessos_admin_log l
   where l.barraca_id = p_barraca_id
   order by l.aberto_em desc
   limit 30;
end;
$$;

revoke all on function public.acessos_admin_da_barraca(uuid) from public, anon;
grant execute on function public.acessos_admin_da_barraca(uuid) to authenticated;
