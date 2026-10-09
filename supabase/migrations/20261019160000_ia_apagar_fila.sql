-- IA no WhatsApp: apagar a conversa da IA no CRM quando o cliente apaga os dados (LGPD) ou o dono exclui a conta.
-- ADITIVA; depende de 20261019100000 (barracas.ia_codigo), 20261017110000 (cliente_apagar_dados) e
-- 20261018140000 (excluir_dados_conta).
--
-- O CRM guarda as conversas da IA por (código da loja, telefone). Apagar na Comanda NUNCA pode depender do CRM:
--   * cliente_apagar_dados e excluir_dados_conta apenas ENFILEIRAM o pedido de apagamento (mesma transação do
--     apagamento local: se o local desfaz, a fila também; se o local vale, o pedido existe mesmo que a function caia);
--   * o envio ao CRM (rota assinada ia-apagar-conversas) é feito por functions, com retentativa e backoff;
--   * a fila guarda só código da loja + telefone, e a linha SOME quando o CRM confirma ou depois de 14 dias.
-- Loja sem código da IA (nunca ligou) não enfileira nada.
--
-- Rollback: recriar cliente_apagar_dados (20261017110000) e excluir_dados_conta (20261018140000); depois
--   drop function ia_apagar_enfileirar, ia_apagar_enfileirar_loja, ia_apagar_pegar, ia_apagar_concluir; drop table ia_apagar_fila.

create table if not exists public.ia_apagar_fila (
  id uuid primary key default gen_random_uuid(),
  codigo_loja text not null check (codigo_loja ~ '^[A-Z0-9]{6}$'),
  -- Null = apagar todas as conversas da loja (exclusão de conta).
  telefone text check (telefone is null or telefone ~ '^[0-9]{10,13}$'),
  criado_em timestamptz not null default now(),
  tentativas integer not null default 0,
  proxima_em timestamptz not null default now()
);
create unique index if not exists ia_apagar_fila_unico on public.ia_apagar_fila (codigo_loja, coalesce(telefone, ''));
create index if not exists ia_apagar_fila_proxima on public.ia_apagar_fila (proxima_em);
alter table public.ia_apagar_fila enable row level security;
revoke all on public.ia_apagar_fila from anon, authenticated;

-- Telefone no formato do CRM: só dígitos com o 55 do país (a Comanda guarda sem o 55).
create or replace function public.ia_apagar_telefone_crm(p_telefone text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select case
    when d ~ '^[0-9]{10,11}$' then '55' || d
    when d ~ '^[0-9]{12,13}$' then d
    else null
  end
  from (select regexp_replace(coalesce(p_telefone, ''), '[^0-9]', '', 'g') as d) x
$$;
revoke all on function public.ia_apagar_telefone_crm(text) from public, anon, authenticated;

-- Enfileira o apagamento de UM telefone de uma loja (se a loja tem código da IA e o telefone é válido).
create or replace function public.ia_apagar_enfileirar(p_barraca_id uuid, p_telefone text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_codigo text;
  v_tel text := public.ia_apagar_telefone_crm(p_telefone);
begin
  if v_tel is null then
    return;
  end if;
  select ia_codigo into v_codigo from public.barracas where id = p_barraca_id;
  if v_codigo is null then
    return;
  end if;
  insert into public.ia_apagar_fila (codigo_loja, telefone) values (v_codigo, v_tel)
  on conflict (codigo_loja, coalesce(telefone, '')) do nothing;
end;
$$;
revoke all on function public.ia_apagar_enfileirar(uuid, text) from public, anon, authenticated;
grant execute on function public.ia_apagar_enfileirar(uuid, text) to service_role;

-- Exclusão de conta: a loja inteira. Enfileira o pedido "toda a loja" (telefone nulo) E cada telefone que a Comanda
-- conhece (perfis e pedidos), caso o CRM só aceite apagar por telefone.
create or replace function public.ia_apagar_enfileirar_loja(p_barraca_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_codigo text;
  v_tel text;
begin
  select ia_codigo into v_codigo from public.barracas where id = p_barraca_id;
  if v_codigo is null then
    return;
  end if;
  insert into public.ia_apagar_fila (codigo_loja, telefone) values (v_codigo, null)
  on conflict (codigo_loja, coalesce(telefone, '')) do nothing;
  for v_tel in
    select t from (
      select telefone as t from public.clientes_finais where barraca_id = p_barraca_id
      union select cliente_telefone from public.pedidos where barraca_id = p_barraca_id
      union select entrega_telefone from public.pedidos where barraca_id = p_barraca_id
    ) x where t is not null
  loop
    perform public.ia_apagar_enfileirar(p_barraca_id, v_tel);
  end loop;
end;
$$;
revoke all on function public.ia_apagar_enfileirar_loja(uuid) from public, anon, authenticated;
grant execute on function public.ia_apagar_enfileirar_loja(uuid) to service_role;

-- Pega os pedidos vencidos para enviar ao CRM e já agenda a próxima tentativa (backoff de 15 min × 2^tentativas, no
-- máximo 6 h): quem pegou e caiu não trava a fila. Descarta o que tem mais de 14 dias. Concorrência: skip locked.
create or replace function public.ia_apagar_pegar(p_limite integer default 10)
returns table(id uuid, codigo_loja text, telefone text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  delete from public.ia_apagar_fila f where f.criado_em < now() - interval '14 days';
  return query
  with escolhidos as (
    select f.id from public.ia_apagar_fila f
     where f.proxima_em <= now()
     order by f.proxima_em
     limit greatest(1, least(coalesce(p_limite, 10), 50))
     for update skip locked
  )
  update public.ia_apagar_fila f
     set tentativas = f.tentativas + 1,
         proxima_em = now() + least(interval '6 hours', interval '15 minutes' * power(2, least(f.tentativas, 10))::integer)
    from escolhidos e
   where f.id = e.id
  returning f.id, f.codigo_loja, f.telefone;
end;
$$;
revoke all on function public.ia_apagar_pegar(integer) from public, anon, authenticated;
grant execute on function public.ia_apagar_pegar(integer) to service_role;

create or replace function public.ia_apagar_concluir(p_id uuid)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  delete from public.ia_apagar_fila where id = p_id
$$;
revoke all on function public.ia_apagar_concluir(uuid) from public, anon, authenticated;
grant execute on function public.ia_apagar_concluir(uuid) to service_role;

-- cliente_apagar_dados: igual à 20261017110000, mais o pedido de apagamento da conversa da IA (antes de o cliente sumir).
create or replace function public.cliente_apagar_dados(p_cliente_id uuid) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_barraca uuid;
  v_telefone text;
begin
  select barraca_id, telefone into v_barraca, v_telefone from public.clientes_finais where id = p_cliente_id;
  if not found then
    return;
  end if;

  perform public.ia_apagar_enfileirar(v_barraca, v_telefone);

  update public.pedidos
     set cliente_id = null, cliente_nome = null, cliente_telefone = null,
         entrega_nome = null, entrega_telefone = null, entrega_rua = null,
         entrega_numero = null, entrega_bairro = null, entrega_referencia = null
   where cliente_id = p_cliente_id
      or (barraca_id = v_barraca and (cliente_telefone = v_telefone or entrega_telefone = v_telefone));

  update public.pagamentos_pendentes
     set cliente_id = null, cliente_nome = null, cliente_telefone = null, entrega = null
   where cliente_id = p_cliente_id
      or (barraca_id = v_barraca and (cliente_telefone = v_telefone or entrega ->> 'telefone' = v_telefone));

  delete from public.cliente_codigos where barraca_id = v_barraca and telefone = v_telefone;
  delete from public.cliente_verificacoes_log where barraca_id = v_barraca and telefone = v_telefone;
  delete from public.clientes_finais where id = p_cliente_id; -- sessões e endereços saem em cascata
end;
$$;

-- excluir_dados_conta: igual à 20261018140000, mais o pedido de apagamento das conversas da IA de cada loja
-- (antes de os perfis e pedidos sumirem, que é de onde saem os telefones).
create or replace function public.excluir_dados_conta(p_usuario_id uuid)
returns uuid[]
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_barracas uuid[];
  v_barraca uuid;
begin
  if p_usuario_id is null then
    raise exception 'Usuário obrigatório';
  end if;

  select coalesce(array_agg(ub.barraca_id), '{}')
  into v_barracas
  from public.usuarios_barracas ub
  where ub.usuario_id = p_usuario_id
    and ub.papel = 'dono'
    and not exists (
      select 1 from public.usuarios_barracas outro
      where outro.barraca_id = ub.barraca_id
        and outro.papel = 'dono'
        and outro.usuario_id <> p_usuario_id
    );

  foreach v_barraca in array v_barracas loop
    perform public.ia_apagar_enfileirar_loja(v_barraca);
    delete from public.itens_do_pedido
    where pedido_id in (select id from public.pedidos where barraca_id = v_barraca);
    delete from public.pagamentos_pendentes where barraca_id = v_barraca;
    delete from public.cupom_usos where barraca_id = v_barraca;
    delete from public.cupons where barraca_id = v_barraca;
    delete from public.cupom_tentativas_log where barraca_id = v_barraca;
    delete from public.pedidos where barraca_id = v_barraca;
    delete from public.banners_cardapio where barraca_id = v_barraca;
    delete from public.horarios_funcionamento where barraca_id = v_barraca;
    delete from public.movimentos_caixa where barraca_id = v_barraca;
    delete from public.caixas where barraca_id = v_barraca;
    delete from public.barracas_fiscal_token where barraca_id = v_barraca;
    delete from public.barracas_pagamento_token where barraca_id = v_barraca;
    delete from public.itens where barraca_id = v_barraca;
    delete from public.categorias where barraca_id = v_barraca;
    delete from public.custos_diarios where barraca_id = v_barraca;
    delete from public.barracas_senha_admin where barraca_id = v_barraca;
    delete from public.usuarios_barracas where barraca_id = v_barraca;
    delete from public.barracas where id = v_barraca;
  end loop;

  delete from public.usuarios_barracas where usuario_id = p_usuario_id;
  delete from public.assinaturas where usuario_id = p_usuario_id;

  return v_barracas;
end;
$$;
revoke all on function public.excluir_dados_conta(uuid) from public, anon, authenticated;
grant execute on function public.excluir_dados_conta(uuid) to service_role;
