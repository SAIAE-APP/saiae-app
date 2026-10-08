-- Limites de pedir código por IP relaxados (feira: dezenas de clientes saem do mesmo wifi/NAT).
-- Os valores deixam de ficar no SQL: vêm da function (constantes em _shared/clienteCodigo.ts), num lugar só.
-- O que protege o custo da Meta é o teto diário da loja e o limite por telefone, não o IP.
-- Troca a assinatura: remove a versão da 20261017110000 (valores fixos) e cria a com limites por parâmetro.

drop function if exists public.cliente_reservar_codigo(uuid, text, text, timestamptz, text, text);

create or replace function public.cliente_reservar_codigo(
  p_barraca_id uuid, p_telefone text, p_codigo_hash text, p_expira_em timestamptz,
  p_ip_hash text, p_ip_hash_global text,
  p_limite_telefone integer, p_limite_ip integer, p_limite_ip_global integer
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_teto integer;
  v_id uuid;
  v_ultimo timestamptz;
  v_tel integer;
  v_ip integer;
  v_ipg integer;
  v_loja integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_barraca_id::text || ':' || p_telefone, 0));

  select codigos_dia_max into v_teto from public.barracas where id = p_barraca_id;
  if v_teto is null then
    return jsonb_build_object('decisao', 'loja_inexistente');
  end if;

  select max(criado_em) into v_ultimo from public.cliente_codigos where barraca_id = p_barraca_id and telefone = p_telefone;
  select count(*) into v_tel from public.cliente_codigos where barraca_id = p_barraca_id and telefone = p_telefone and criado_em >= now() - interval '1 hour';
  select count(*) into v_ip from public.cliente_codigos where barraca_id = p_barraca_id and ip_hash = p_ip_hash and criado_em >= now() - interval '1 hour';
  select count(*) into v_ipg from public.cliente_codigos where ip_hash_global = p_ip_hash_global and criado_em >= now() - interval '1 hour';
  select count(*) into v_loja from public.cliente_codigos where barraca_id = p_barraca_id and criado_em >= now() - interval '24 hours';

  if v_teto <= 0 or v_loja >= v_teto then
    return jsonb_build_object('decisao', 'limite_loja', 'enviosLoja24h', v_loja);
  end if;
  if v_ultimo is not null and v_ultimo > now() - interval '60 seconds' then
    return jsonb_build_object('decisao', 'muito_cedo');
  end if;
  if v_tel >= p_limite_telefone then
    return jsonb_build_object('decisao', 'limite_telefone');
  end if;
  if v_ip >= p_limite_ip or v_ipg >= p_limite_ip_global then
    return jsonb_build_object('decisao', 'limite_ip');
  end if;

  insert into public.cliente_codigos (barraca_id, telefone, codigo_hash, expira_em, ip_hash, ip_hash_global)
  values (p_barraca_id, p_telefone, p_codigo_hash, p_expira_em, p_ip_hash, p_ip_hash_global)
  returning id into v_id;
  return jsonb_build_object('decisao', 'ok', 'id', v_id);
end;
$$;

revoke all on function public.cliente_reservar_codigo(uuid, text, text, timestamptz, text, text, integer, integer, integer) from public, anon, authenticated;
grant execute on function public.cliente_reservar_codigo(uuid, text, text, timestamptz, text, text, integer, integer, integer) to service_role;
