-- Cardápio público: item em destaque escolhido pelo dono (spec 2026-10-27-cardapio-hierarquia).
-- Aditiva: nasce nula, nenhuma barraca muda de comportamento até o dono escolher.
-- Rollback: drop function public.destaque_publico(text); alter table public.barracas drop column item_destaque_id;

alter table public.barracas
  add column if not exists item_destaque_id uuid references public.itens(id) on delete set null;

-- Devolve só o id do item, e só se for da mesma barraca, ativo e de preço fechado.
-- Esgotado não filtra aqui: depende das opções e quem decide é o cliente.
create or replace function public.destaque_publico(p_slug text)
returns table(item_id uuid)
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select i.id
  from barracas b
  join itens i on i.id = b.item_destaque_id
    and i.barraca_id = b.id
    and i.ativo
    and not i.preco_aberto
  where b.slug = p_slug;
$$;

grant execute on function public.destaque_publico(text) to anon, authenticated;
