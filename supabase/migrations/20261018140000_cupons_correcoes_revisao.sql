-- Cupons v2 — correções da revisão independente (aorus-19).
--
--  B2  excluir conta/barraca com cupons: cupom_usos.cupom_id era RESTRICT. Agora cascade (a trava de
--      cupom_apagar já protege o dono; só a exclusão da barraca inteira apaga cupom com uso) e as FKs de
--      pagamentos_pendentes viram set null. excluir_dados_conta também limpa cupom_tentativas_log.
--  I1  cupom_liberar_abandonadas: ao refazer o checkout, as reservas abertas do cliente (e a do Pix anterior,
--      se o front informar) são liberadas ANTES de avaliar, para o cupom não "esgotar" contra a própria reserva.
--  I2  cupom_reservar: retry da mesma cobrança reavalia com o subtotal atual (antes devolvia o desconto velho).
--  I3  criar_pedido_com_cupom: cria o pedido e confirma o uso do cupom na MESMA transação.
--  S2  cupom_registrar_tentativa sem DELETE na linha quente; limpeza por cron diário + índice.
-- Rollback: recriar as funções da 20261018111000/20261018110000 e as FKs originais.

-- ---------------------------------------------------------------- B2
alter table public.cupom_usos drop constraint if exists cupom_usos_cupom_id_fkey;
alter table public.cupom_usos
  add constraint cupom_usos_cupom_id_fkey foreign key (cupom_id) references public.cupons(id) on delete cascade;

alter table public.pagamentos_pendentes drop constraint if exists pagamentos_pendentes_cupom_id_fkey;
alter table public.pagamentos_pendentes
  add constraint pagamentos_pendentes_cupom_id_fkey foreign key (cupom_id) references public.cupons(id) on delete set null;

alter table public.pagamentos_pendentes drop constraint if exists pagamentos_pendentes_cupom_uso_id_fkey;
alter table public.pagamentos_pendentes
  add constraint pagamentos_pendentes_cupom_uso_id_fkey foreign key (cupom_uso_id) references public.cupom_usos(id) on delete set null;

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

-- ---------------------------------------------------------------- I1
-- Libera reservas ABERTAS de um checkout abandonado: a do Pix anterior (uuid que o próprio cliente recebeu,
-- só vale na mesma loja) e as do cliente logado na loja. Nunca mexe em uso confirmado.
create or replace function public.cupom_liberar_abandonadas(
  p_barraca_id uuid, p_cliente_id uuid, p_pendente_anterior_id uuid
) returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_n integer;
begin
  update public.cupom_usos
     set estado = 'liberado'
   where barraca_id = p_barraca_id
     and estado = 'reservado'
     and (
       (p_pendente_anterior_id is not null and pagamento_pendente_id = p_pendente_anterior_id)
       or (p_cliente_id is not null and cliente_id = p_cliente_id)
     );
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke all on function public.cupom_liberar_abandonadas(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.cupom_liberar_abandonadas(uuid, uuid, uuid) to service_role;

-- ---------------------------------------------------------------- I2
create or replace function public.cupom_reservar(
  p_barraca_id uuid, p_codigo text, p_subtotal_centavos integer, p_cliente_id uuid,
  p_pendente_id uuid, p_reservado_ate timestamptz
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  c public.cupons;
  v_agora timestamptz := now();
  v_uso uuid;
  v_uso_cupom uuid;
  v_uso_desc integer;
  v_uso_estado text;
  v_res jsonb;
begin
  select * into c from public.cupons
   where barraca_id = p_barraca_id and codigo = upper(btrim(p_codigo))
     and exists (select 1 from public.barracas b where b.id = p_barraca_id and b.cupons_habilitado)
   for update;
  if not found or not c.ativo then
    return jsonb_build_object('ok', false, 'erro', 'invalido');
  end if;

  -- Uma linha de uso por cobrança (índice único).
  --   confirmado -> devolve como está;
  --   reservado/liberado -> REAVALIA com o subtotal atual (a reserva própria não conta contra o limite) e a
  --   MESMA linha passa a refletir o resultado (se inválido, fica liberada e o erro volta).
  if p_pendente_id is not null then
    select id, cupom_id, desconto_centavos, estado into v_uso, v_uso_cupom, v_uso_desc, v_uso_estado
      from public.cupom_usos where pagamento_pendente_id = p_pendente_id for update;
    if v_uso is not null then
      if v_uso_estado = 'confirmado' then
        return jsonb_build_object('ok', true, 'uso_id', v_uso, 'cupom_id', v_uso_cupom, 'codigo', c.codigo, 'desconto_centavos', v_uso_desc);
      end if;
      update public.cupom_usos set estado = 'liberado' where id = v_uso and estado = 'reservado';
    end if;
  end if;

  v_res := public.cupom_regras(c, p_subtotal_centavos, p_cliente_id, v_agora);
  if not (v_res ->> 'ok')::boolean then
    return v_res;
  end if;

  -- Cliente refazendo o checkout: as outras reservas abertas DELE neste cupom são liberadas.
  if p_cliente_id is not null then
    update public.cupom_usos set estado = 'liberado'
     where cupom_id = c.id and cliente_id = p_cliente_id and estado = 'reservado'
       and id is distinct from v_uso;
  end if;

  if v_uso is not null then
    update public.cupom_usos
       set cupom_id = c.id, cliente_id = p_cliente_id, estado = 'reservado',
           desconto_centavos = (v_res ->> 'desconto_centavos')::integer, reservado_ate = p_reservado_ate
     where id = v_uso;
  else
    insert into public.cupom_usos (cupom_id, barraca_id, cliente_id, pagamento_pendente_id, estado, desconto_centavos, reservado_ate)
    values (c.id, p_barraca_id, p_cliente_id, p_pendente_id, 'reservado', (v_res ->> 'desconto_centavos')::integer, p_reservado_ate)
    returning id into v_uso;
  end if;
  return v_res || jsonb_build_object('uso_id', v_uso);
end;
$$;
revoke all on function public.cupom_reservar(uuid, text, integer, uuid, uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.cupom_reservar(uuid, text, integer, uuid, uuid, timestamptz) to service_role;

-- ---------------------------------------------------------------- I3
-- Cria o pedido e confirma o uso do cupom na MESMA transação: ou os dois acontecem ou nenhum, e o evento do
-- CRM nunca sai sem o desconto. Mesmos argumentos de criar_pedido + o id do uso reservado.
create or replace function public.criar_pedido_com_cupom(
  p_uso_id uuid,
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
) returns table(pedido_id uuid, senha integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_pedido uuid;
  v_senha integer;
begin
  select r.pedido_id, r.senha into v_pedido, v_senha
    from public.criar_pedido(
      p_barraca_id, p_mesa, p_viagem, p_observacao, p_client_uuid, p_metodo_pagamento, p_itens,
      p_tipo_atendimento, p_entrega, p_taxa_entrega_centavos, p_cliente_nome, p_cliente_telefone
    ) r;
  perform public.cupom_confirmar(p_uso_id, v_pedido);
  return query select v_pedido, v_senha;
end;
$$;
revoke all on function public.criar_pedido_com_cupom(uuid, uuid, text, boolean, text, text, text, jsonb, text, jsonb, integer, text, text) from public, anon, authenticated;
grant execute on function public.criar_pedido_com_cupom(uuid, uuid, text, boolean, text, text, text, jsonb, text, jsonb, integer, text, text) to service_role;

-- ---------------------------------------------------------------- S2
create index if not exists cupom_tentativas_invalidas
  on public.cupom_tentativas_log (barraca_id, valida, criado_em);

create or replace function public.cupom_registrar_tentativa(p_barraca_id uuid, p_ip_hash text, p_valida boolean)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ip integer;
  v_loja integer;
begin
  insert into public.cupom_tentativas_log (barraca_id, ip_hash, valida) values (p_barraca_id, p_ip_hash, coalesce(p_valida, false));
  select count(*) into v_ip from public.cupom_tentativas_log
   where barraca_id = p_barraca_id and ip_hash = p_ip_hash and not valida and criado_em >= now() - interval '1 hour';
  select count(*) into v_loja from public.cupom_tentativas_log
   where barraca_id = p_barraca_id and not valida and criado_em >= now() - interval '1 hour';
  return v_ip <= 15 and v_loja <= 100;
end;
$$;
revoke all on function public.cupom_registrar_tentativa(uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.cupom_registrar_tentativa(uuid, text, boolean) to service_role;

-- Limpeza diária (pg_cron, tolerante: sem a extensão só a tabela cresce devagar).
do $$
begin
  create extension if not exists pg_cron with schema extensions;
  begin
    perform cron.unschedule('limpar-cupom-tentativas');
  exception when others then null;
  end;
  perform cron.schedule('limpar-cupom-tentativas', '17 3 * * *',
    $cron$delete from public.cupom_tentativas_log where criado_em < now() - interval '2 days'$cron$);
exception when others then
  raise notice 'pg_cron indisponível: limpeza de cupom_tentativas_log não agendada (%).', sqlerrm;
end;
$$;
