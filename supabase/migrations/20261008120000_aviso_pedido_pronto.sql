-- Aviso "pedido pronto" por WhatsApp (Sprint 3). ADITIVO e retrocompatível.
--
-- Constraints/colunas consultadas antes: `pedidos` só tem CHECKs de tipo
-- (inclui 'entrega'), taxa >= 0 e método (inclui 'pix' e 'na_entrega'); nada
-- toca as colunas novas. `pagamentos_pendentes` só restringe status/tipo/taxa.
--
-- LGPD: `cliente_telefone` serve SÓ pra avisar aquele pedido. NÃO alimenta
-- `clientes_finais` nem a exportação de prospecção.

-- 1) Telefone normalizado: só dígitos, sem o 55 do país quando sobram 12/13
-- dígitos (mesma regra de clientes_finais); fora de 8–15 dígitos vira NULL.
create or replace function public.normalizar_telefone_aviso(p_telefone text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select case
    when d = '' then null
    when length(d) in (12, 13) and left(d, 2) = '55' then
      case when length(substr(d, 3)) between 8 and 15 then substr(d, 3) end
    when length(d) between 8 and 15 then d
    else null
  end
  from (select regexp_replace(coalesce(p_telefone, ''), '\D', '', 'g') as d) t;
$$;

-- 2) Colunas novas.
alter table public.pedidos
  add column if not exists cliente_telefone text,
  add column if not exists cliente_avisado_em timestamptz;

alter table public.pedidos
  drop constraint if exists pedidos_cliente_telefone_valido;
alter table public.pedidos
  add constraint pedidos_cliente_telefone_valido
  check (cliente_telefone is null or cliente_telefone ~ '^[0-9]{8,15}$');

-- Rede de segurança: qualquer escrita direta normaliza (ou zera) o telefone
-- antes do CHECK, então um valor ruim nunca derruba um UPDATE/INSERT.
create or replace function public.pedidos_normalizar_cliente_telefone()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.cliente_telefone := public.normalizar_telefone_aviso(new.cliente_telefone);
  return new;
end;
$$;

drop trigger if exists pedidos_normalizar_cliente_telefone on public.pedidos;
create trigger pedidos_normalizar_cliente_telefone
  before insert or update of cliente_telefone on public.pedidos
  for each row execute function public.pedidos_normalizar_cliente_telefone();

alter table public.barracas
  add column if not exists msg_pedido_pronto text,
  add column if not exists msg_pedido_pronto_entrega text,
  add column if not exists aviso_pronto_habilitado boolean not null default true;

alter table public.pagamentos_pendentes
  add column if not exists cliente_telefone text;

-- 3) criar_pedido v8 = v7 + p_cliente_telefone (default null). A assinatura de
-- 11 args sai pra não sobrar sobrecarga ambígua; chamadas com 7 a 11 args
-- continuam resolvendo na nova (os extras têm default). Sem SECURITY DEFINER
-- (igual à v7): a RLS segue valendo.
drop function if exists public.criar_pedido(uuid, text, boolean, text, text, text, jsonb, text, jsonb, integer, text);

create or replace function public.criar_pedido(
  p_barraca_id uuid,
  p_mesa text,
  p_viagem boolean,
  p_observacao text,
  p_client_uuid text,
  p_metodo_pagamento text,
  p_itens jsonb,
  p_tipo_atendimento text default null,
  p_entrega jsonb default null,
  p_taxa_entrega_centavos integer default 0,
  p_cliente_nome text default null,
  p_cliente_telefone text default null
)
RETURNS TABLE(pedido_id uuid, senha integer)
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
declare
  v_id uuid;
  v_senha int;
  v_item jsonb;
  v_entrega_direta boolean;
  v_total_itens int;
  v_itens_entrega_direta int;
  v_pedido_todo_entrega_direta boolean;
  v_telefone text := public.normalizar_telefone_aviso(p_cliente_telefone);
begin
  -- Idempotência via client_uuid (protege contra duplo toque)
  select p.id, p.senha into v_id, v_senha
    from pedidos p
   where p.client_uuid = p_client_uuid;
  if found then
    return query select v_id, v_senha;
    return;
  end if;

  -- Descobre se TODOS os itens são entrega direta
  select
    count(*)::int,
    count(*) filter (where coalesce((elem->>'entrega_direta')::boolean, false))::int
  into v_total_itens, v_itens_entrega_direta
  from jsonb_array_elements(p_itens) as elem;

  v_pedido_todo_entrega_direta := (v_total_itens > 0 and v_itens_entrega_direta = v_total_itens);

  insert into pedidos (
    barraca_id,
    mesa,
    viagem,
    tipo_atendimento,
    entrega_nome,
    entrega_telefone,
    entrega_rua,
    entrega_numero,
    entrega_bairro,
    entrega_referencia,
    taxa_entrega_centavos,
    cliente_nome,
    cliente_telefone,
    observacao,
    client_uuid,
    metodo_pagamento,
    status,
    pronto_em,
    entregue_em
  )
  values (
    p_barraca_id,
    p_mesa,
    p_viagem,
    p_tipo_atendimento,
    nullif(trim(p_entrega->>'nome'), ''),
    nullif(regexp_replace(coalesce(p_entrega->>'telefone', ''), '[^0-9]', '', 'g'), ''),
    nullif(trim(p_entrega->>'rua'), ''),
    nullif(trim(p_entrega->>'numero'), ''),
    nullif(trim(p_entrega->>'bairro'), ''),
    nullif(trim(p_entrega->>'referencia'), ''),
    greatest(coalesce(p_taxa_entrega_centavos, 0), 0),
    -- Nome opcional em qualquer modo; na Entrega cai no nome do formulário.
    coalesce(nullif(trim(p_cliente_nome), ''), nullif(trim(p_entrega->>'nome'), '')),
    -- Telefone opcional só pra avisar "pedido pronto"; inválido vira NULL (nunca derruba o pedido).
    v_telefone,
    p_observacao,
    p_client_uuid,
    p_metodo_pagamento,
    case when v_pedido_todo_entrega_direta then 'entregue' else 'a_fazer' end,
    case when v_pedido_todo_entrega_direta then now() else null end,
    case when v_pedido_todo_entrega_direta then now() else null end
  )
  returning id, pedidos.senha into v_id, v_senha;

  for v_item in select * from jsonb_array_elements(p_itens)
  loop
    v_entrega_direta := coalesce((v_item->>'entrega_direta')::boolean, false);

    insert into itens_do_pedido (
      pedido_id,
      barraca_id,
      item_id,
      nome_item,
      quantidade,
      preco_centavos_unitario,
      entrega_direta,
      entregue,
      entregue_em,
      observacao
    )
    values (
      v_id,
      p_barraca_id,
      (v_item->>'item_id')::uuid,
      v_item->>'nome_item',
      (v_item->>'quantidade')::int,
      coalesce((v_item->>'preco_centavos_unitario')::int, 0),
      v_entrega_direta,
      v_entrega_direta,
      case when v_entrega_direta then now() else null end,
      nullif(v_item->>'observacao', '')
    );
  end loop;

  return query select v_id, v_senha;
end;
$$;

-- Grants: nenhuma migration anterior restringiu criar_pedido (vale o padrão do
-- Postgres: execute pra todos os papéis). Recriar a função reaplica esse padrão.
-- Conferir depois de aplicar: select grantee, privilege_type from
-- information_schema.routine_privileges where routine_name = 'criar_pedido';
