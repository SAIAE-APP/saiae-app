-- Expõe imagem de capa e horário de funcionamento no cardápio público —
-- mesmo padrão de cardapio_publico/banners_publicos: função dedicada
-- liberada pra `anon`, nunca RLS pública direto na tabela de config.
drop function if exists public.cardapio_publico(text);

create function public.cardapio_publico(p_slug text)
returns table(
  barraca_id uuid,
  barraca_nome text,
  barraca_logo_url text,
  barraca_imagem_capa_url text,
  pagamento_online_habilitado boolean,
  item_id uuid,
  item_nome text,
  item_descricao text,
  item_foto_url text,
  item_preco_centavos int,
  item_esgotado boolean,
  item_popular boolean,
  categoria_nome text,
  categoria_ordem int,
  item_ordem int,
  pedidos_30d int
)
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select
    b.id,
    b.nome,
    b.logo_url,
    b.imagem_capa_url,
    b.pagamento_online_habilitado,
    i.id,
    i.nome,
    i.descricao,
    i.foto_url,
    i.preco_centavos,
    i.esgotado,
    i.popular,
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

-- Horário de "aberto agora"/"fechado, abre às Xh" é calculado no client
-- (data/hora atual do visitante) — a função só devolve as 7 linhas cruas.
create function public.horarios_publicos(p_slug text)
returns table(
  dia_semana smallint,
  aberto boolean,
  hora_abertura time,
  hora_fechamento time
)
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select h.dia_semana, h.aberto, h.hora_abertura, h.hora_fechamento
  from horarios_funcionamento h
  join barracas b on b.id = h.barraca_id
  where b.slug = p_slug
  order by h.dia_semana;
$$;

grant execute on function public.horarios_publicos(text) to anon, authenticated;
