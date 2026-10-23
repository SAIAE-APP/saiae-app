-- Comanda aberta na Mesa (Task 2 do plano). ADITIVA. Spec: docs/superpowers/specs/2026-10-23-comanda-aberta-mesa-design.md.
-- Nome 20261029100000 (e não 20261026100000, como no plano): essa versão já existe (remove_kirvano) e a
-- migration precisa ficar depois de todas as que já estão no repositório.
--
--  * barracas.comanda_aberta_habilitada (padrão false): interruptor por barraca. Desligado, nada muda.
--  * barracas.taxa_servico_habilitada (padrão false) e taxa_servico_bps (padrão 1000 = 10%, 0..3000): usados só
--    no fechamento da comanda (tasks seguintes).
--  * normalizar_mesa(texto): "5", "05", "Mesa 5", "mesa  5" -> '5'; "15" -> '15'; vazio/"Mesa" -> ''.
--  * comandas: uma comanda ABERTA por (barraca, mesa normalizada), garantida por índice único parcial. Só leitura
--    para quem tem acesso à barraca; escrita só pelo trigger abaixo e por RPC security definer (tasks seguintes).
--  * pedidos.comanda_id + trigger BEFORE INSERT pedidos_atribuir_comanda: pedido de Mesa, com mesa preenchida,
--    "a receber" (na_entrega) e barraca com o interruptor ligado entra na comanda aberta da mesa (cria se não
--    existe; on conflict do nothing + releitura resolve dois primeiros lançamentos simultâneos). A idempotência
--    do criar_pedido por client_uuid continua igual: o reenvio devolve o pedido antigo antes do insert, então o
--    trigger nem roda. Desligar o interruptor depois não mexe nas comandas já abertas.
--  * comandas entra na publicação supabase_realtime (se a publicação existir e a tabela ainda não estiver nela).
--
-- Rollback: drop trigger pedidos_atribuir_comanda on public.pedidos; drop function public._trg_pedidos_atribuir_comanda();
--   alter table public.pedidos drop column comanda_id; alter publication supabase_realtime drop table public.comandas;
--   drop table public.comandas; drop function public.normalizar_mesa(text);
--   alter table public.barracas drop column comanda_aberta_habilitada, drop column taxa_servico_habilitada,
--   drop column taxa_servico_bps.

alter table public.barracas
  add column if not exists comanda_aberta_habilitada boolean not null default false,
  add column if not exists taxa_servico_habilitada boolean not null default false,
  add column if not exists taxa_servico_bps integer not null default 1000 check (taxa_servico_bps between 0 and 3000);

-- Mesmo estilo de normalizar_bairro (translate em vez de unaccent, sem extensão).
create or replace function public.normalizar_mesa(p_texto text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select regexp_replace(
    btrim(regexp_replace(
      btrim(regexp_replace(
        translate(lower(coalesce(p_texto, '')), 'áàâãäéèêëíìîïóòôõöúùûüçñ', 'aaaaaeeeeiiiiooooouuuucn'),
        '\s+', ' ', 'g'
      )),
      '^mesa(\M|(?=[0-9]))', ''
    )),
    '^0+([0-9])', '\1'
  );
$$;

create table if not exists public.comandas (
  id uuid primary key default gen_random_uuid(),
  barraca_id uuid not null references public.barracas(id) on delete cascade,
  mesa text not null,
  mesa_normalizada text not null,
  status text not null default 'aberta' check (status in ('aberta', 'fechada')),
  aberta_em timestamptz not null default now(),
  fechada_em timestamptz,
  fechada_por uuid,
  metodo_pagamento text,
  taxa_servico_bps integer,
  taxa_servico_centavos integer not null default 0
);
create unique index if not exists comandas_uma_aberta_por_mesa
  on public.comandas (barraca_id, mesa_normalizada) where status = 'aberta';
create index if not exists comandas_barraca_aberta_em on public.comandas (barraca_id, aberta_em desc);

alter table public.comandas enable row level security;
revoke all on public.comandas from anon;
revoke insert, update, delete on public.comandas from authenticated;
grant select on public.comandas to authenticated;

drop policy if exists "comandas leitura da barraca" on public.comandas;
create policy "comandas leitura da barraca"
  on public.comandas for select
  to authenticated
  using (public.usuario_tem_acesso_barraca(barraca_id));

alter table public.pedidos
  add column if not exists comanda_id uuid references public.comandas(id) on delete set null;
create index if not exists pedidos_comanda_id on public.pedidos (comanda_id) where comanda_id is not null;

create or replace function public._trg_pedidos_atribuir_comanda()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_mesa text := public.normalizar_mesa(new.mesa);
  v_id uuid;
begin
  if new.tipo_atendimento is distinct from 'mesa'
     or v_mesa = ''
     or new.metodo_pagamento is distinct from 'na_entrega'
     or not exists (select 1 from public.barracas b where b.id = new.barraca_id and b.comanda_aberta_habilitada) then
    return new;
  end if;

  select c.id into v_id from public.comandas c
   where c.barraca_id = new.barraca_id and c.mesa_normalizada = v_mesa and c.status = 'aberta';

  if v_id is null then
    insert into public.comandas (barraca_id, mesa, mesa_normalizada)
    values (new.barraca_id, btrim(new.mesa), v_mesa)
    on conflict (barraca_id, mesa_normalizada) where status = 'aberta' do nothing
    returning id into v_id;

    -- Outro lançamento abriu a mesma mesa ao mesmo tempo: o insert esperou o commit dele e não fez nada.
    if v_id is null then
      select c.id into v_id from public.comandas c
       where c.barraca_id = new.barraca_id and c.mesa_normalizada = v_mesa and c.status = 'aberta';
    end if;
  end if;

  new.comanda_id := v_id;
  return new;
end;
$$;

revoke all on function public._trg_pedidos_atribuir_comanda() from public, anon, authenticated;

drop trigger if exists pedidos_atribuir_comanda on public.pedidos;
create trigger pedidos_atribuir_comanda
  before insert on public.pedidos
  for each row execute function public._trg_pedidos_atribuir_comanda();

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'comandas') then
    alter publication supabase_realtime add table public.comandas;
  end if;
end;
$$;
