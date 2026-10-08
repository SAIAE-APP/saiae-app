-- Expiração do Pix configurável por barraca + cron que expira cobranças vencidas.
--
-- Limites: o Mercado Pago exige `date_of_expiration` entre 30 min e 30 dias depois
-- da criação do pagamento; o código já usava 35 min (30 + folga de relógio), que
-- vira o MÍNIMO e o PADRÃO. Máximo 60 min: pedido de balcão, QR que dura dias não
-- faz sentido. As edge functions também limitam (clamp) o valor lido.
--
-- ADITIVA: coluna com default (= comportamento de hoje), coluna nullable no
-- pendente (linhas antigas sem `expira_em` são ignoradas pelo cron) e uma função
-- nova. Nenhuma função existente é alterada.

alter table public.barracas
  add column if not exists pix_expiracao_minutos integer not null default 35;

alter table public.barracas
  drop constraint if exists barracas_pix_expiracao_valida;
alter table public.barracas
  add constraint barracas_pix_expiracao_valida
  check (pix_expiracao_minutos between 35 and 60);

alter table public.pagamentos_pendentes
  add column if not exists expira_em timestamptz;

-- Backfill: pendentes ainda abertos vencem 35 min depois de criados.
update public.pagamentos_pendentes
   set expira_em = criado_em + interval '35 minutes'
 where status = 'pendente' and expira_em is null;

create index if not exists pagamentos_pendentes_expira_idx
  on public.pagamentos_pendentes (expira_em)
  where status = 'pendente';

-- Marca como 'expirado' o pendente vencido. A tolerância de 2 min cobre a demora
-- da notificação do provedor. 'expirado' NÃO é final: pagamento aprovado depois
-- ainda vira pedido pelo webhook (ver pagamentos_conciliacao). Só mexe em status;
-- o QR vence sozinho no provedor, pois `expira_em` é o mesmo `date_of_expiration`
-- enviado na cobrança.
create or replace function public.expirar_pagamentos_pendentes_job()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_qtd integer;
begin
  update public.pagamentos_pendentes
     set status = 'expirado'
   where status = 'pendente'
     and expira_em is not null
     and expira_em < now() - interval '2 minutes';
  get diagnostics v_qtd = row_count;
  return v_qtd;
end;
$$;

revoke all on function public.expirar_pagamentos_pendentes_job() from public, anon, authenticated;

-- Agenda a cada 5 min com pg_cron. Idempotente e compatível com `supabase db push`
-- (o papel de login da CLI não tem permissão em cron.job, então nada de `delete from
-- cron.job`: usa cron.unschedule). Tolerante: sem pg_cron no plano, ou sem permissão
-- para agendar, só avisa e a migration segue. Nesse caso agende por fora:
--   select cron.schedule('expirar-pix-pendentes', '*/5 * * * *',
--     'select public.expirar_pagamentos_pendentes_job()');
-- O resto continua valendo; só o status 'pendente' vencido não seria limpo.
do $$
begin
  create extension if not exists pg_cron with schema extensions;

  begin
    perform cron.unschedule('expirar-pix-pendentes');
  exception when others then
    null; -- ainda não existia
  end;

  perform cron.schedule(
    'expirar-pix-pendentes',
    '*/5 * * * *',
    'select public.expirar_pagamentos_pendentes_job()'
  );
exception when others then
  raise warning 'expirar-pix-pendentes não agendado (%): agende expirar_pagamentos_pendentes_job() por fora', sqlerrm;
end;
$$;
