-- Cardápio Digital Fase 2+3: o cliente agora monta o carrinho e paga
-- direto por aqui, então a função pública precisa devolver barraca_id
-- (pra chamar a edge function criar-pagamento-pix), se o pagamento
-- online está habilitado (pra saber se mostra "Adicionar" de verdade ou
-- o aviso "fale com o balcão") e se o item está esgotado (mesma regra
-- de Lançar Pedido: mostra mas bloqueia adicionar).
--
-- drop antes do create: mudança no tipo de retorno.
drop function if exists public.cardapio_publico(text);

create function public.cardapio_publico(p_slug text)
returns table(
  barraca_id uuid,
  barraca_nome text,
  barraca_logo_url text,
  pagamento_online_habilitado boolean,
  item_id uuid,
  item_nome text,
  item_descricao text,
  item_foto_url text,
  item_preco_centavos int,
  item_esgotado boolean,
  categoria_nome text,
  categoria_ordem int,
  item_ordem int,
  pedidos_30d int
)
language sql
security definer
set search_path = public
stable
as $$
  select
    b.id,
    b.nome,
    b.logo_url,
    b.pagamento_online_habilitado,
    i.id,
    i.nome,
    i.descricao,
    i.foto_url,
    i.preco_centavos,
    i.esgotado,
    c.nome,
    c.ordem,
    i.ordem,
    coalesce(pop.total, 0)::int
  from barracas b
  join itens i on i.barraca_id = b.id and i.ativo = true
  left join categorias c on c.id = i.categoria_id
  left join (
    select ip.item_id, sum(ip.quantidade) as total
    from itens_do_pedido ip
    join pedidos p on p.id = ip.pedido_id
    where p.barraca_id = (select id from barracas where slug = p_slug)
      and p.status != 'cancelado'
      and p.criado_em >= now() - interval '30 days'
      and ip.removido = false
    group by ip.item_id
  ) pop on pop.item_id = i.id
  where b.slug = p_slug
  order by c.ordem nulls last, i.ordem;
$$;

grant execute on function public.cardapio_publico(text) to anon, authenticated;
