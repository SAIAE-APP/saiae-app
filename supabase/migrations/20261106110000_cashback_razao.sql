-- Cashback do cardápio digital, M2: razão só-inserção, reservas de resgate, colunas de pedido e RLS.
-- Spec: docs/superpowers/specs/2026-10-27-cashback-design.md (seção 15). Mesmo desenho de cupom_usos.
-- ADITIVA. O razão é escrito só por RPC de serviço (M3 a M5); nenhuma policy de escrita para authenticated/anon.
-- Rollback: drop table public.cashback_resgates, public.cashback_lancamentos; alter table ... drop column cashback_*.

create table if not exists public.cashback_lancamentos (
  id uuid primary key default gen_random_uuid(),
  barraca_id uuid not null references public.barracas(id) on delete cascade,
  -- Nulo depois de "apagar meus dados": o razão fica anonimizado para a contabilidade da barraca.
  cliente_id uuid references public.clientes_finais(id) on delete set null,
  tipo text not null check (tipo in ('credito', 'resgate', 'estorno_credito', 'estorno_resgate', 'expiracao', 'ajuste')),
  valor_centavos integer not null check (valor_centavos <> 0),
  pedido_id uuid references public.pedidos(id) on delete set null,
  pagamento_pendente_id uuid references public.pagamentos_pendentes(id) on delete set null,
  expira_em timestamptz,
  motivo text,
  criado_em timestamptz not null default now(),
  constraint cashback_lancamentos_sinal check (
    (tipo in ('credito', 'estorno_resgate') and valor_centavos > 0)
    or (tipo in ('resgate', 'estorno_credito', 'expiracao') and valor_centavos < 0)
    or tipo = 'ajuste'
  ),
  constraint cashback_lancamentos_ajuste_motivo check (tipo <> 'ajuste' or motivo is not null)
);

-- Idempotência: um crédito por pedido, um resgate por cobrança, um estorno de cada tipo por pedido.
create unique index if not exists cashback_lancamentos_credito_pedido_uq
  on public.cashback_lancamentos (pedido_id) where tipo = 'credito';
create unique index if not exists cashback_lancamentos_resgate_pendente_uq
  on public.cashback_lancamentos (pagamento_pendente_id) where tipo = 'resgate';
create unique index if not exists cashback_lancamentos_estorno_pedido_uq
  on public.cashback_lancamentos (pedido_id, tipo) where tipo in ('estorno_credito', 'estorno_resgate');
create index if not exists cashback_lancamentos_conta
  on public.cashback_lancamentos (barraca_id, cliente_id, criado_em desc);

-- Reserva de saldo durante o Pix aberto. Decisão: o excedente de um resgate pago depois de a reserva vencer
-- (saldo já gasto em outro pedido) fica em excedente_centavos, e não numa linha `ajuste` de valor zero (que o
-- check de valor proíbe). O relatório lê dali. Desvio pequeno e deliberado do texto da spec §7.8.
create table if not exists public.cashback_resgates (
  id uuid primary key default gen_random_uuid(),
  barraca_id uuid not null references public.barracas(id) on delete cascade,
  cliente_id uuid references public.clientes_finais(id) on delete set null,
  pagamento_pendente_id uuid not null unique references public.pagamentos_pendentes(id) on delete cascade,
  pedido_id uuid references public.pedidos(id) on delete set null,
  estado text not null check (estado in ('reservado', 'confirmado', 'liberado')),
  valor_centavos integer not null check (valor_centavos > 0),
  excedente_centavos integer not null default 0 check (excedente_centavos >= 0),
  reservado_ate timestamptz not null,
  criado_em timestamptz not null default now()
);
create index if not exists cashback_resgates_conta
  on public.cashback_resgates (barraca_id, cliente_id, estado);

alter table public.cashback_lancamentos enable row level security;
alter table public.cashback_resgates enable row level security;

-- Dono lê o razão da própria loja. Nenhuma policy de escrita; cashback_resgates não tem policy alguma.
drop policy if exists cashback_lancamentos_dono_select on public.cashback_lancamentos;
create policy cashback_lancamentos_dono_select on public.cashback_lancamentos for select to authenticated
  using (public.usuario_tem_acesso_barraca(barraca_id));

revoke all on table public.cashback_lancamentos from anon, authenticated;
revoke all on table public.cashback_resgates from anon, authenticated;
grant select on table public.cashback_lancamentos to authenticated;

alter table public.pagamentos_pendentes
  add column if not exists cashback_usado_centavos integer not null default 0 check (cashback_usado_centavos >= 0),
  add column if not exists cashback_uso_id uuid;
alter table public.pedidos
  add column if not exists cashback_usado_centavos integer not null default 0 check (cashback_usado_centavos >= 0),
  add column if not exists cashback_gerado_centavos integer not null default 0 check (cashback_gerado_centavos >= 0);
