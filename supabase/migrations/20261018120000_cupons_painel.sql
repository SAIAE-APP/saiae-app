-- Cupons, Task 7: números do painel do dono. ADITIVA; depende de 20261018100000_cupons.sql.
--
-- `cupom_usos` não tem policy de leitura (o público nunca a vê), então o painel lê só o AGREGADO por esta função:
-- por cupom da loja, quantos usos estão CONFIRMADOS (pagamento aprovado ou pagar na entrega) e quanto de desconto já
-- foi dado. Reserva (Pix aberto) não conta aqui: só vira uso quando o pagamento é confirmado. O limite total, que
-- considera as reservas vigentes, é decidido pelo banco na hora de aplicar o cupom, não por este número.
--
-- Só `authenticated` com acesso à barraca; `anon` e o público não executam. Cupom sem uso aparece com zeros.
--
-- Rollback: drop function if exists public.cupons_resumo(uuid);

create or replace function public.cupons_resumo(p_barraca_id uuid)
returns table (cupom_id uuid, usos_confirmados integer, desconto_total_centavos bigint)
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
begin
  if not public.usuario_tem_acesso_barraca(p_barraca_id) then
    raise exception 'sem acesso a esta barraca';
  end if;

  return query
    select c.id,
           coalesce(count(u.id) filter (where u.estado = 'confirmado'), 0)::integer,
           coalesce(sum(u.desconto_centavos) filter (where u.estado = 'confirmado'), 0)::bigint
      from public.cupons c
      left join public.cupom_usos u on u.cupom_id = c.id
     where c.barraca_id = p_barraca_id
     group by c.id;
end;
$$;

revoke all on function public.cupons_resumo(uuid) from public, anon;
grant execute on function public.cupons_resumo(uuid) to authenticated;
