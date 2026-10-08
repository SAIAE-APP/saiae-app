-- Cupons v2 — Task 5: liberar uma reserva pelo id do USO (o "pagar na entrega" reserva sem cobrança, então
-- não há pagamento_pendente_id para usar em cupom_liberar). Nunca mexe em uso confirmado.
create or replace function public.cupom_liberar_uso(p_uso_id uuid) returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.cupom_usos set estado = 'liberado' where id = p_uso_id and estado = 'reservado';
$$;

revoke all on function public.cupom_liberar_uso(uuid) from public, anon, authenticated;
grant execute on function public.cupom_liberar_uso(uuid) to service_role;
