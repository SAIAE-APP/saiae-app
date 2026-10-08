-- Cupons por código (v2) — Task 1: tabelas, flag por loja e cupom_config.
-- Spec: docs/superpowers/specs/2026-10-08-cupons-design.md. ADITIVA: tabelas e colunas novas, flag desligada.
-- As regras (avaliar/reservar/confirmar/liberar) vêm na 20261018110000.

alter table public.barracas add column if not exists cupons_habilitado boolean not null default false;

create table if not exists public.cupons (
  id uuid primary key default gen_random_uuid(),
  barraca_id uuid not null references public.barracas(id) on delete cascade,
  codigo text not null check (codigo ~ '^[A-Z0-9_-]{3,20}$'),
  tipo text not null check (tipo in ('percentual', 'fixo')),
  valor integer not null check (valor > 0),
  inicio_em timestamptz,
  fim_em timestamptz,
  limite_usos integer check (limite_usos is null or limite_usos > 0),
  uma_por_cliente boolean not null default false,
  pedido_minimo_centavos integer not null default 0 check (pedido_minimo_centavos >= 0),
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  constraint cupons_percentual_ate_100 check (tipo <> 'percentual' or valor <= 100),
  constraint cupons_janela check (fim_em is null or inicio_em is null or fim_em > inicio_em),
  constraint cupons_barraca_codigo_unico unique (barraca_id, codigo)
);
alter table public.cupons enable row level security;

drop policy if exists cupons_dono_select on public.cupons;
create policy cupons_dono_select on public.cupons for select to authenticated
  using (public.usuario_tem_acesso_barraca(barraca_id));
drop policy if exists cupons_dono_insert on public.cupons;
create policy cupons_dono_insert on public.cupons for insert to authenticated
  with check (public.usuario_tem_acesso_barraca(barraca_id));
drop policy if exists cupons_dono_update on public.cupons;
create policy cupons_dono_update on public.cupons for update to authenticated
  using (public.usuario_tem_acesso_barraca(barraca_id))
  with check (public.usuario_tem_acesso_barraca(barraca_id));
-- Sem DELETE direto: cupom com uso só pausa. A exclusão sem uso vai pela RPC `cupom_apagar` (Task 2).
revoke all on table public.cupons from anon;

create table if not exists public.cupom_usos (
  id uuid primary key default gen_random_uuid(),
  cupom_id uuid not null references public.cupons(id) on delete restrict,
  barraca_id uuid not null references public.barracas(id) on delete cascade,
  cliente_id uuid references public.clientes_finais(id) on delete set null,
  pagamento_pendente_id uuid references public.pagamentos_pendentes(id) on delete set null,
  pedido_id uuid references public.pedidos(id) on delete set null,
  estado text not null check (estado in ('reservado', 'confirmado', 'liberado')),
  desconto_centavos integer not null check (desconto_centavos >= 0),
  reservado_ate timestamptz not null,
  criado_em timestamptz not null default now()
);
create unique index if not exists cupom_usos_pendente_uq on public.cupom_usos (pagamento_pendente_id) where pagamento_pendente_id is not null;
create index if not exists cupom_usos_cupom_estado on public.cupom_usos (cupom_id, estado);
create index if not exists cupom_usos_cliente on public.cupom_usos (cupom_id, cliente_id) where cliente_id is not null;
alter table public.cupom_usos enable row level security;
revoke all on table public.cupom_usos from anon, authenticated;

create table if not exists public.cupom_tentativas_log (
  id bigserial primary key,
  barraca_id uuid not null,
  ip_hash text not null,
  valida boolean not null,
  criado_em timestamptz not null default now()
);
create index if not exists cupom_tentativas_busca on public.cupom_tentativas_log (barraca_id, ip_hash, criado_em);
alter table public.cupom_tentativas_log enable row level security;
revoke all on table public.cupom_tentativas_log from anon, authenticated;

alter table public.pagamentos_pendentes
  add column if not exists cupom_id uuid references public.cupons(id),
  add column if not exists desconto_cupom_centavos integer not null default 0,
  add column if not exists cupom_uso_id uuid references public.cupom_usos(id);
alter table public.pedidos
  add column if not exists cupom_id uuid references public.cupons(id) on delete set null,
  add column if not exists cupom_codigo text,
  add column if not exists desconto_cupom_centavos integer not null default 0;

-- Pública: só diz se a loja ligou cupons (o front mostra o campo "Tem cupom?" com ela).
create or replace function public.cupom_config(p_slug text)
returns table (habilitado boolean)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select b.cupons_habilitado from public.barracas b where b.slug = p_slug and b.cupons_habilitado;
$$;
revoke all on function public.cupom_config(text) from public;
grant execute on function public.cupom_config(text) to anon, authenticated;
