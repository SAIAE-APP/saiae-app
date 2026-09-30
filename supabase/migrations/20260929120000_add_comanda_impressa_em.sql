-- Impressão automática da comanda de TODO pedido (inclusive cardápio digital/
-- Pix, criado no servidor). Vários aparelhos da mesma barraca podem ter
-- impressora habilitada e ouvir o mesmo pedido pelo Realtime; pra sair UMA
-- comanda só, o aparelho "reivindica" o pedido antes de imprimir: o primeiro
-- UPDATE atômico ganha, os outros recebem false.
alter table public.pedidos
  add column if not exists comanda_impressa_em timestamptz;

-- Ganhou (true): este aparelho imprime. Já reivindicado / sem acesso (false).
create or replace function public.reivindicar_impressao_comanda(p_pedido_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_barraca uuid;
  v_ganhou boolean;
begin
  select barraca_id into v_barraca from public.pedidos where id = p_pedido_id;
  if v_barraca is null or not public.usuario_tem_acesso_barraca(v_barraca) then
    return false;
  end if;

  update public.pedidos
  set comanda_impressa_em = now()
  where id = p_pedido_id and comanda_impressa_em is null
  returning true into v_ganhou;

  return coalesce(v_ganhou, false);
end;
$$;

-- Impressão falhou depois de reivindicar: libera pra outro aparelho/retry.
create or replace function public.liberar_impressao_comanda(p_pedido_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_barraca uuid;
begin
  select barraca_id into v_barraca from public.pedidos where id = p_pedido_id;
  if v_barraca is null or not public.usuario_tem_acesso_barraca(v_barraca) then
    return;
  end if;
  update public.pedidos set comanda_impressa_em = null where id = p_pedido_id;
end;
$$;

revoke all on function public.reivindicar_impressao_comanda(uuid) from public, anon;
revoke all on function public.liberar_impressao_comanda(uuid) from public, anon;
grant execute on function public.reivindicar_impressao_comanda(uuid) to authenticated;
grant execute on function public.liberar_impressao_comanda(uuid) to authenticated;
