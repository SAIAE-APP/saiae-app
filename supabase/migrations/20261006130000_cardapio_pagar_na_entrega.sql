-- "Pagar na entrega" no cardápio digital: o pedido entra na Cozinha na hora e o
-- cliente avisa o dono por WhatsApp (wa.me). Tudo ADITIVO e retrocompatível:
-- colunas novas com default, tabela nova, e cardapio_publico ganha UMA coluna
-- no fim (o front antigo ignora; o front novo trata a ausência como "desligado").

alter table public.barracas
  add column if not exists whatsapp_pedidos text,
  add column if not exists pagar_na_entrega_habilitado boolean not null default false;

-- Só dígitos (com DDD), igual ao telefone do cliente de entrega.
alter table public.barracas
  drop constraint if exists barracas_whatsapp_pedidos_digitos;
alter table public.barracas
  add constraint barracas_whatsapp_pedidos_digitos
  check (whatsapp_pedidos is null or whatsapp_pedidos ~ '^[0-9]{10,15}$');

-- Registro de tentativas da edge function pública `criar-pedido-cardapio`
-- (anti-spam por IP/barraca numa janela de tempo). Guarda só o HASH do IP.
-- RLS ligada e SEM policy: só a service role (edge function) lê/escreve.
create table if not exists public.cardapio_pedidos_log (
  id bigint generated always as identity primary key,
  barraca_id uuid not null references public.barracas(id) on delete cascade,
  ip_hash text not null,
  client_uuid text,
  criado_em timestamptz not null default now()
);
alter table public.cardapio_pedidos_log enable row level security;
create index if not exists cardapio_pedidos_log_ip_idx
  on public.cardapio_pedidos_log (ip_hash, criado_em desc);
create index if not exists cardapio_pedidos_log_barraca_idx
  on public.cardapio_pedidos_log (barraca_id, criado_em desc);

drop function if exists public.cardapio_publico(text);

create function public.cardapio_publico(p_slug text)
returns table(
  barraca_id uuid,
  barraca_nome text,
  barraca_logo_url text,
  barraca_imagem_capa_url text,
  pagamento_online_habilitado boolean,
  barraca_modos_atendimento text[],
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
  pedidos_30d int,
  barraca_whatsapp_pedidos text
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
    b.modos_atendimento,
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
    coalesce(pop.total, 0)::int,
    -- Só expõe o número se o dono ligou "Pagar na entrega".
    case when b.pagar_na_entrega_habilitado then b.whatsapp_pedidos else null end
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
