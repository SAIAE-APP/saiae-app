-- Rollback: drop function public.whatsapp_status_gravar(uuid, text, timestamptz);
--           alter table public.barracas drop column if exists whatsapp_status, drop column if exists whatsapp_status_em;
-- Estado da conexão do WhatsApp da barraca, avisado pelo CRM (edge function crm-evento-sessao, contrato v1 §3).
-- `whatsapp_status_gravar` só grava evento MAIS NOVO que o já gravado: evento atrasado e replay (mesmo occurred_at)
-- voltam 'ignorado' e nada muda. Barraca inexistente também volta 'ignorado' (a rota não revela se a loja existe).
alter table public.barracas
  add column if not exists whatsapp_status text,
  add column if not exists whatsapp_status_em timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'barracas_whatsapp_status_valido') then
    alter table public.barracas
      add constraint barracas_whatsapp_status_valido
      check (whatsapp_status is null or whatsapp_status in ('conectado', 'desconectado', 'caiu'));
  end if;
end $$;

create or replace function public.whatsapp_status_gravar(p_barraca_id uuid, p_estado text, p_em timestamptz)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
begin
  if p_estado is null or p_estado not in ('conectado', 'desconectado', 'caiu') then
    raise exception 'estado inválido';
  end if;
  update public.barracas
     set whatsapp_status = p_estado, whatsapp_status_em = p_em
   where id = p_barraca_id
     and (whatsapp_status_em is null or p_em > whatsapp_status_em);
  return case when found then 'ok' else 'ignorado' end;
end;
$fn$;

revoke all on function public.whatsapp_status_gravar(uuid, text, timestamptz) from public, anon, authenticated;
grant execute on function public.whatsapp_status_gravar(uuid, text, timestamptz) to service_role;
