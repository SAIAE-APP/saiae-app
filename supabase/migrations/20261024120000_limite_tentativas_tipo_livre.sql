-- consulta_externa_registrar: aceita qualquer tipo "nome_de_um_limite" (antes só 'cnpj'/'cep').
-- A tabela e a função viraram o limitador por usuário/hora das edge functions autenticadas; o primeiro novo
-- uso é 'cancelar_assinatura' (cancelar-assinatura-stripe). Comportamento de cnpj/cep inalterado.
--
-- ADITIVA e reexecutável. Aplicar ANTES do deploy de cancelar-assinatura-stripe.

alter table public.consultas_externas_log drop constraint if exists consultas_externas_log_tipo_check;
alter table public.consultas_externas_log
  add constraint consultas_externas_log_tipo_check check (tipo ~ '^[a-z][a-z0-9_]{1,29}$');

create or replace function public.consulta_externa_registrar(p_usuario_id uuid, p_tipo text, p_limite integer)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_qtd integer;
begin
  if p_usuario_id is null or p_tipo is null or p_tipo !~ '^[a-z][a-z0-9_]{1,29}$' then
    return false;
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_usuario_id::text || ':' || p_tipo, 0));
  delete from public.consultas_externas_log where usuario_id = p_usuario_id and criado_em < now() - interval '1 day';
  select count(*) into v_qtd from public.consultas_externas_log
   where usuario_id = p_usuario_id and tipo = p_tipo and criado_em >= now() - interval '1 hour';
  if v_qtd >= greatest(coalesce(p_limite, 30), 1) then
    return false;
  end if;
  insert into public.consultas_externas_log (usuario_id, tipo) values (p_usuario_id, p_tipo);
  return true;
end;
$$;

revoke all on function public.consulta_externa_registrar(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.consulta_externa_registrar(uuid, text, integer) to service_role;
