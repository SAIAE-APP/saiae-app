-- Cardápio Digital: seção "Populares" (curadoria manual do dono, decisão
-- de produto 2026-09-27) — diferente de "Mais pedido" (algorítmico, já
-- existe via pedidos_30d em cardapio_publico). Mesmo padrão de
-- `itens.esgotado`: toggle simples, editável em Ajustes.
alter table public.itens
  add column popular boolean not null default false;

-- Carrossel de banners do cardápio público (topo da tela), configurável
-- pelo dono da barraca em Ajustes — não é conteúdo fixo do app. RLS
-- espelha exatamente o padrão de `categorias` (usuario_tem_acesso_barraca).
create table public.banners_cardapio (
  id uuid primary key default gen_random_uuid(),
  barraca_id uuid not null references public.barracas(id) on delete cascade,
  imagem_url text not null,
  titulo text,
  cta_texto text,
  ordem integer not null default 0,
  ativo boolean not null default true,
  criado_em timestamptz not null default now()
);

alter table public.banners_cardapio enable row level security;

create policy "usuarios veem banners de suas barracas"
on public.banners_cardapio for select
to authenticated
using (usuario_tem_acesso_barraca(barraca_id));

create policy "usuarios inserem banners em suas barracas"
on public.banners_cardapio for insert
to authenticated
with check (usuario_tem_acesso_barraca(barraca_id));

create policy "usuarios editam banners de suas barracas"
on public.banners_cardapio for update
to authenticated
using (usuario_tem_acesso_barraca(barraca_id))
with check (usuario_tem_acesso_barraca(barraca_id));

create policy "usuarios deletam banners de suas barracas"
on public.banners_cardapio for delete
to authenticated
using (usuario_tem_acesso_barraca(barraca_id));

-- Imagem sobe pro bucket `cardapio-fotos` já existente (público pra
-- leitura), path {barraca_id}/banners/{...} — mesmo primeiro segmento
-- barraca_id que as policies de storage já checam, então nenhuma policy
-- nova de storage é necessária (ver 20260918120000_add_foto_descricao_itens.sql).
