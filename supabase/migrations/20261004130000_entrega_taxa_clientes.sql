-- Sprint 3 do backlog PDV: fluxo de entrega, taxa de entrega e cadastro de
-- clientes finais por barraca.
--
-- NÃO mexe em criar_pedido: gravar os dados de entrega junto do pedido exige
-- uma v6 da função (parte de tela do Sprint 3), a partir da v5 de 8 args de
-- 20261004120000_modos_atendimento.sql.

-- 1) Taxa de entrega configurável por barraca (cobrada do cliente final).
alter table public.barracas
  add column if not exists taxa_entrega_habilitada boolean not null default false,
  add column if not exists taxa_entrega_centavos integer not null default 0,
  add column if not exists taxa_entrega_editavel boolean not null default true;

alter table public.barracas
  drop constraint if exists barracas_taxa_entrega_centavos_valida;
alter table public.barracas
  add constraint barracas_taxa_entrega_centavos_valida check (
    taxa_entrega_centavos >= 0 and taxa_entrega_centavos <= 99999999
  );

-- 2) Clientes finais da barraca (nome, telefone, endereço). Um endereço por
-- cliente; telefone guardado só com dígitos pra busca e unicidade por barraca.
-- LGPD: só o necessário pra entregar, e o lojista pode excluir o cadastro.
create table if not exists public.clientes_finais (
  id uuid primary key default gen_random_uuid(),
  barraca_id uuid not null references public.barracas(id) on delete cascade,
  nome text not null,
  telefone text not null,
  rua text not null,
  numero text not null,
  bairro text not null,
  referencia text,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  constraint clientes_finais_telefone_digitos check (telefone ~ '^[0-9]{8,15}$'),
  constraint clientes_finais_barraca_telefone_unico unique (barraca_id, telefone)
);

create index if not exists clientes_finais_barraca_nome_idx
  on public.clientes_finais (barraca_id, lower(nome));

alter table public.clientes_finais enable row level security;

create policy "usuarios veem clientes finais de suas barracas"
on public.clientes_finais for select
to authenticated
using (usuario_tem_acesso_barraca(barraca_id));

create policy "usuarios inserem clientes finais em suas barracas"
on public.clientes_finais for insert
to authenticated
with check (usuario_tem_acesso_barraca(barraca_id));

create policy "usuarios editam clientes finais de suas barracas"
on public.clientes_finais for update
to authenticated
using (usuario_tem_acesso_barraca(barraca_id))
with check (usuario_tem_acesso_barraca(barraca_id));

create policy "usuarios deletam clientes finais de suas barracas"
on public.clientes_finais for delete
to authenticated
using (usuario_tem_acesso_barraca(barraca_id));

create or replace function public.clientes_finais_toca_atualizado_em()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.atualizado_em = now();
  return new;
end;
$$;

drop trigger if exists clientes_finais_atualizado_em on public.clientes_finais;
create trigger clientes_finais_atualizado_em
before update on public.clientes_finais
for each row execute function public.clientes_finais_toca_atualizado_em();

-- 3) Dados de entrega e taxa cobrada no pedido. Snapshot no pedido (não só FK)
-- pra comanda/recibo não mudarem se o cliente editar ou excluir o cadastro.
alter table public.pedidos
  add column if not exists entrega_nome text,
  add column if not exists entrega_telefone text,
  add column if not exists entrega_rua text,
  add column if not exists entrega_numero text,
  add column if not exists entrega_bairro text,
  add column if not exists entrega_referencia text,
  add column if not exists taxa_entrega_centavos integer not null default 0,
  add column if not exists cliente_final_id uuid
    references public.clientes_finais(id) on delete set null;

alter table public.pedidos
  drop constraint if exists pedidos_taxa_entrega_centavos_valida;
alter table public.pedidos
  add constraint pedidos_taxa_entrega_centavos_valida check (taxa_entrega_centavos >= 0);
