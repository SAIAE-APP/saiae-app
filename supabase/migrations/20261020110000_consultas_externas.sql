-- Onboarding PR 6: limite de consultas a serviços externos (CNPJ na BrasilAPI, CEP no ViaCEP) por usuário.
-- ADITIVA e reexecutável. A tabela guarda só (usuário, tipo, hora): NUNCA o CNPJ ou o CEP consultado.

create table if not exists public.consultas_externas_log (
  id bigint generated always as identity primary key,
  usuario_id uuid not null references auth.users(id) on delete cascade,
  tipo text not null check (tipo in ('cnpj', 'cep')),
  criado_em timestamptz not null default now()
);
create index if not exists consultas_externas_log_busca on public.consultas_externas_log (usuario_id, tipo, criado_em);
alter table public.consultas_externas_log enable row level security;
revoke all on table public.consultas_externas_log from anon, authenticated;

-- Registra a consulta e diz se ainda cabe no limite da última hora. Só o papel de serviço (as edge functions
-- identificam o usuário pelo JWT e passam o id). Tentativa acima do limite NÃO é gravada.
create or replace function public.consulta_externa_registrar(p_usuario_id uuid, p_tipo text, p_limite integer)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_qtd integer;
begin
  if p_usuario_id is null or p_tipo not in ('cnpj', 'cep') then
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
