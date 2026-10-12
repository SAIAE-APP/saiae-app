-- Auditoria M5: anti-abuso dos endpoints públicos do cardápio, atômico e com teto por loja.
--
-- Antes: criar-pagamento-pix e criar-pedido-cardapio faziam `count` e depois `insert` em
-- duas idas; uma rajada paralela passava do teto. Não existia teto por loja (um botnet com
-- IPs distintos gerava cobranças ilimitadas com o token Mercado Pago do dono).
--
-- cardapio_registrar_tentativa conta e grava na MESMA transação, serializada por loja
-- (advisory lock), e devolve:
--   'ok'             tentativa registrada
--   'limite_ip'      o hash do IP já tem >= p_limite_ip na janela (nada gravado)
--   'limite_barraca' a loja já tem >= p_limite_barraca na janela (nada gravado)
--   'invalido'       argumento inválido (nada gravado)
-- A janela vale para as duas funções (Pix e "pagar na entrega" dividem a tabela; o hash do
-- IP já carrega o escopo de cada uma, então os tetos por IP continuam independentes).
--
-- Só service_role (edge functions). Aditiva e reexecutável. Aplicar ANTES do deploy das
-- edge functions que a chamam.

create or replace function public.cardapio_registrar_tentativa(
  p_barraca_id uuid,
  p_ip_hash text,
  p_client_uuid text,
  p_limite_ip integer,
  p_limite_barraca integer,
  p_janela_segundos integer
) returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_desde timestamptz;
  v_ip integer;
  v_barraca integer;
begin
  if p_barraca_id is null or p_ip_hash is null or p_ip_hash = ''
     or coalesce(p_limite_ip, 0) < 1 or coalesce(p_limite_barraca, 0) < 1
     or coalesce(p_janela_segundos, 0) < 1 then
    return 'invalido';
  end if;

  v_desde := now() - make_interval(secs => p_janela_segundos);

  perform pg_advisory_xact_lock(hashtextextended('cardapio_tentativa:' || p_barraca_id::text, 0));

  select count(*) filter (where ip_hash = p_ip_hash), count(*)
    into v_ip, v_barraca
    from public.cardapio_pedidos_log
   where barraca_id = p_barraca_id and criado_em >= v_desde;

  if v_ip >= p_limite_ip then
    return 'limite_ip';
  end if;
  if v_barraca >= p_limite_barraca then
    return 'limite_barraca';
  end if;

  insert into public.cardapio_pedidos_log (barraca_id, ip_hash, client_uuid)
  values (p_barraca_id, p_ip_hash, p_client_uuid);
  return 'ok';
end;
$$;

revoke all on function public.cardapio_registrar_tentativa(uuid, text, text, integer, integer, integer)
  from public, anon, authenticated;
grant execute on function public.cardapio_registrar_tentativa(uuid, text, text, integer, integer, integer)
  to service_role;
