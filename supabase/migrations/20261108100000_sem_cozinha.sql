-- Barraca sem cozinha: barracas.usa_cozinha (padrão true = comportamento de sempre).
-- Com usa_cozinha = false o pedido nasce 'entregue' (a senha continua sendo gerada), então nunca fica preso em
-- "A fazer", e o app esconde Cozinha e Chamada. O nome 'zz_...' faz o gatilho rodar DEPOIS do que gera a senha
-- (gatilhos BEFORE disparam em ordem alfabética; o gerador de senha pula a senha quando o status já nasce 'entregue').
-- Rollback: drop trigger zz_pedidos_sem_cozinha on public.pedidos; drop function public._trg_pedidos_sem_cozinha();
--           alter table public.barracas drop column usa_cozinha;

alter table public.barracas add column if not exists usa_cozinha boolean not null default true;

create or replace function public._trg_pedidos_sem_cozinha()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.status = 'a_fazer'
     and exists (select 1 from public.barracas b where b.id = new.barraca_id and b.usa_cozinha = false) then
    new.status := 'entregue';
    new.pronto_em := coalesce(new.pronto_em, now());
    new.entregue_em := coalesce(new.entregue_em, now());
  end if;
  return new;
end;
$$;

revoke all on function public._trg_pedidos_sem_cozinha() from public, anon, authenticated;

drop trigger if exists zz_pedidos_sem_cozinha on public.pedidos;
create trigger zz_pedidos_sem_cozinha
  before insert on public.pedidos
  for each row execute function public._trg_pedidos_sem_cozinha();
