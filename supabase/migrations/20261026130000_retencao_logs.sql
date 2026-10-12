-- Auditoria M7: retenção de logs e dados pessoais (LGPD).
--
-- Nada limpava cardapio_pedidos_log, cliente_verificacoes_log (guarda o telefone em claro,
-- janela de uso de 1 hora) e cliente_codigos. O crescimento sem fim também degrada os
-- `count(*)` dos limites anti-abuso (M5).
--
-- Janelas que ainda leem esses dados: cardapio_pedidos_log 5 min; cliente_verificacoes_log
-- 1 h; cliente_codigos 24 h (teto diário da loja, só linhas de até 1 dia). Retenção de 2
-- dias nos logs cobre todas com folga; códigos só saem depois de 7 dias E (usados ou
-- vencidos), então um código ainda válido nunca é apagado.
--
-- limpar_logs_antigos() é só para o job (pg_cron roda como dono do job). Agendamento
-- tolerante: sem pg_cron no plano, ou sem permissão para agendar, só avisa; nesse caso
-- agende por fora:
--   select cron.schedule('limpar-logs-antigos', '15 3 * * *', 'select public.limpar_logs_antigos()');
-- Aditiva e reexecutável.

create or replace function public.limpar_logs_antigos()
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  delete from public.cardapio_pedidos_log where criado_em < now() - interval '2 days';
  delete from public.cliente_verificacoes_log where criado_em < now() - interval '2 days';
  delete from public.cliente_codigos
   where criado_em < now() - interval '7 days'
     and (usado_em is not null or expira_em < now());
$$;

revoke all on function public.limpar_logs_antigos() from public, anon, authenticated;

do $$
begin
  create extension if not exists pg_cron with schema extensions;

  begin
    perform cron.unschedule('limpar-logs-antigos');
  exception when others then
    null; -- ainda não existia
  end;

  perform cron.schedule(
    'limpar-logs-antigos',
    '15 3 * * *',
    'select public.limpar_logs_antigos()'
  );
exception when others then
  raise warning 'limpar-logs-antigos não agendado (%): agende limpar_logs_antigos() por fora', sqlerrm;
end;
$$;
