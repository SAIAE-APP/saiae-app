-- Estoque por item com baixa automática (Sprint 6, Story 2).
--
-- Decisões do João: controle POR ITEM (opcional); ESGOTAR sozinho quando o saldo
-- chega a zero; PODE NEGATIVAR (vender além do saldo não é bloqueado, só avisa);
-- DEVOLVER ao cancelar pedido ou remover item. Isto REVERTE a decisão de
-- 2026-09-26 ("só o toggle esgotado, sem baixa por venda").
--
-- A baixa vive no BANCO (triggers), a fonte da verdade: vale para o operador
-- online ou offline (a fila sobe e o criar_pedido insere os itens), para o
-- cardápio digital e para o Pix (o webhook chama a mesma criar_pedido).
-- Nada aqui bloqueia a venda: erro na contabilidade de estoque vira WARNING e o
-- pedido segue.
--
-- ADITIVA: 2 colunas em itens (nullable/default), 1 tabela nova, funções e
-- triggers novos. NENHUMA função existente (criar_pedido etc.) é alterada.
-- Consultado antes: itens_do_pedido tem barraca_id/item_id/quantidade/removido;
-- pedidos.status aceita 'cancelado'; usuario_tem_acesso_barraca(uuid) existe.

-- 1) Saldo por item. NULL = não controla estoque (comportamento de sempre).
alter table public.itens
  add column if not exists estoque_qtd integer,
  -- true quando o `esgotado` foi ligado PELO SISTEMA (saldo <= 0). Esgotado
  -- marcado à mão pelo dono (auto = false) nunca é desmarcado automaticamente.
  add column if not exists estoque_esgotado_auto boolean not null default false;

alter table public.itens drop constraint if exists itens_estoque_qtd_faixa;
alter table public.itens
  add constraint itens_estoque_qtd_faixa check (estoque_qtd is null or estoque_qtd between -1000000 and 1000000);

-- 2) Movimentos (histórico + idempotência). Sem FK em item_pedido_id/pedido_id de
-- propósito: "Apagar período" apaga pedidos/itens do histórico fisicamente e NÃO
-- devolve estoque. Apagar a barraca ou o item leva os movimentos junto (cascade).
create table if not exists public.movimentos_estoque (
  id uuid primary key default gen_random_uuid(),
  barraca_id uuid not null references public.barracas(id) on delete cascade,
  item_id uuid not null references public.itens(id) on delete cascade,
  item_pedido_id uuid,
  pedido_id uuid,
  delta integer not null,
  motivo text not null check (motivo in ('venda', 'cancelamento', 'remocao', 'ajuste')),
  saldo_apos integer,
  observacao text,
  criado_por uuid,
  criado_em timestamptz not null default now()
);

create index if not exists movimentos_estoque_item_idx
  on public.movimentos_estoque (item_id, criado_em desc);
create index if not exists movimentos_estoque_barraca_idx
  on public.movimentos_estoque (barraca_id, criado_em desc);

-- Idempotência: uma venda, uma devolução por cancelamento e uma por remoção, no máximo,
-- por linha de pedido.
create unique index if not exists movimentos_estoque_idem
  on public.movimentos_estoque (item_pedido_id, motivo)
  where motivo in ('venda', 'cancelamento', 'remocao');

-- RLS: o dono/equipe da barraca LÊ o histórico. Escrita só pelas funções abaixo
-- (SECURITY DEFINER); sem policy de insert/update/delete para o client, ninguém
-- forja movimento.
alter table public.movimentos_estoque enable row level security;

drop policy if exists "usuarios veem movimentos de estoque de suas barracas" on public.movimentos_estoque;
create policy "usuarios veem movimentos de estoque de suas barracas"
on public.movimentos_estoque for select to authenticated
using (usuario_tem_acesso_barraca(barraca_id));

-- 3) Aplica um delta no saldo de forma ATÔMICA e mexe no esgotado:
--    saldo <= 0   -> esgotado = true (e marca auto se não estava esgotado);
--    saldo  > 0 e o esgotado era automático -> esgotado = false, auto = false;
--    esgotado manual (auto = false) nunca é desligado aqui.
-- Devolve o novo saldo, ou NULL se o item não controla estoque (nada muda).
-- Interna: ninguém chama pelo client.
create or replace function public._estoque_aplicar(p_item_id uuid, p_delta integer)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_saldo integer;
begin
  -- Num UPDATE todas as expressões leem a linha ANTIGA, então os CASE abaixo
  -- enxergam o esgotado/auto de antes desta atualização.
  update public.itens i
     set estoque_qtd = i.estoque_qtd + p_delta,
         esgotado = case
           when i.estoque_qtd + p_delta <= 0 then true
           when i.estoque_esgotado_auto then false
           else i.esgotado
         end,
         estoque_esgotado_auto = case
           when i.estoque_qtd + p_delta <= 0 then (i.estoque_esgotado_auto or not i.esgotado)
           when i.estoque_esgotado_auto then false
           else i.estoque_esgotado_auto
         end
   where i.id = p_item_id
     and i.estoque_qtd is not null
  returning i.estoque_qtd into v_saldo;

  return v_saldo;
end;
$$;

-- 4) Devolve ao estoque o que uma linha de pedido tinha baixado, UMA vez só
-- (remoção OU cancelamento, nunca os dois). Só devolve se houve venda
-- registrada: item que passou a controlar estoque depois da venda não "ganha"
-- saldo no cancelamento. Trava por linha para duas devoluções simultâneas.
create or replace function public._estoque_devolver(p_item_pedido_id uuid, p_motivo text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_venda public.movimentos_estoque%rowtype;
  v_qtd integer;
  v_saldo integer;
begin
  begin
    perform pg_advisory_xact_lock(hashtextextended(p_item_pedido_id::text, 0));

    select * into v_venda
      from public.movimentos_estoque
     where item_pedido_id = p_item_pedido_id and motivo = 'venda';
    if not found then
      return;
    end if;

    if exists (
      select 1 from public.movimentos_estoque
       where item_pedido_id = p_item_pedido_id and motivo in ('remocao', 'cancelamento')
    ) then
      return;
    end if;

    v_qtd := -v_venda.delta;
    if v_qtd <= 0 then
      return;
    end if;

    v_saldo := public._estoque_aplicar(v_venda.item_id, v_qtd);
    if v_saldo is null then
      return; -- o dono desligou o controle depois da venda: nada a devolver
    end if;

    insert into public.movimentos_estoque
      (barraca_id, item_id, item_pedido_id, pedido_id, delta, motivo, saldo_apos)
    values
      (v_venda.barraca_id, v_venda.item_id, p_item_pedido_id, v_venda.pedido_id, v_qtd, p_motivo, v_saldo)
    on conflict (item_pedido_id, motivo) where motivo in ('venda', 'cancelamento', 'remocao') do nothing;
  exception when others then
    -- Contabilidade de estoque nunca pode travar cancelar/remover.
    raise warning 'estoque: devolução do item_pedido % falhou: %', p_item_pedido_id, sqlerrm;
  end;
end;
$$;

-- 5) Triggers.
create or replace function public._trg_estoque_venda()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_saldo integer;
begin
  if new.item_id is null or coalesce(new.quantidade, 0) <= 0 then
    return new;
  end if;

  begin
    v_saldo := public._estoque_aplicar(new.item_id, -new.quantidade);
    if v_saldo is not null then
      insert into public.movimentos_estoque
        (barraca_id, item_id, item_pedido_id, pedido_id, delta, motivo, saldo_apos)
      values
        (coalesce(new.barraca_id, (select i.barraca_id from public.itens i where i.id = new.item_id)), new.item_id, new.id, new.pedido_id, -new.quantidade, 'venda', v_saldo)
      on conflict (item_pedido_id, motivo) where motivo in ('venda', 'cancelamento', 'remocao') do nothing;
    end if;
  exception when others then
    -- Nunca bloqueia a venda (operador offline pode vender além do saldo; erro
    -- inesperado aqui não pode derrubar o pedido).
    raise warning 'estoque: baixa do item_pedido % falhou: %', new.id, sqlerrm;
  end;

  return new;
end;
$$;

create or replace function public._trg_estoque_remocao()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public._estoque_devolver(new.id, 'remocao');
  return new;
end;
$$;

create or replace function public._trg_estoque_cancelamento()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_linha record;
begin
  for v_linha in
    select id from public.itens_do_pedido where pedido_id = new.id and removido = false
  loop
    perform public._estoque_devolver(v_linha.id, 'cancelamento');
  end loop;
  return new;
end;
$$;

drop trigger if exists trg_estoque_venda on public.itens_do_pedido;
create trigger trg_estoque_venda
  after insert on public.itens_do_pedido
  for each row execute function public._trg_estoque_venda();

drop trigger if exists trg_estoque_remocao on public.itens_do_pedido;
create trigger trg_estoque_remocao
  after update of removido on public.itens_do_pedido
  for each row
  when (old.removido is distinct from true and new.removido = true)
  execute function public._trg_estoque_remocao();

drop trigger if exists trg_estoque_cancelamento on public.pedidos;
create trigger trg_estoque_cancelamento
  after update of status on public.pedidos
  for each row
  when (old.status is distinct from 'cancelado' and new.status = 'cancelado')
  execute function public._trg_estoque_cancelamento();

-- 6) Repor/ajustar (e LIGAR o controle): delta positivo repõe, negativo baixa
-- (perda, quebra). Item ainda sem controle: o primeiro ajuste liga o controle com
-- saldo inicial = delta. Grava o movimento 'ajuste' com quem fez e o motivo livre.
create or replace function public.ajustar_estoque(p_item_id uuid, p_delta integer, p_motivo text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_item public.itens%rowtype;
  v_saldo integer;
begin
  if auth.uid() is null then
    return jsonb_build_object('estado', 'nao_autenticado');
  end if;
  if p_delta is null or p_delta = 0 or abs(p_delta) > 1000000 then
    return jsonb_build_object('estado', 'delta_invalido');
  end if;

  select * into v_item from public.itens where id = p_item_id for update;
  if not found or not public.usuario_tem_acesso_barraca(v_item.barraca_id) then
    return jsonb_build_object('estado', 'sem_acesso');
  end if;

  if v_item.estoque_qtd is null then
    update public.itens set estoque_qtd = 0 where id = v_item.id;
  end if;

  v_saldo := public._estoque_aplicar(v_item.id, p_delta);

  insert into public.movimentos_estoque
    (barraca_id, item_id, delta, motivo, saldo_apos, observacao, criado_por)
  values
    (v_item.barraca_id, v_item.id, p_delta, 'ajuste', v_saldo, nullif(left(trim(coalesce(p_motivo, '')), 200), ''), auth.uid());

  return jsonb_build_object('estado', 'ok', 'estoque_qtd', v_saldo);
end;
$$;

-- Privilégios: o Supabase concede execute a anon por padrão em função nova do
-- schema public, então revoga explícito. Internas: ninguém (só triggers/funções
-- do próprio banco). ajustar_estoque: só usuário autenticado.
revoke all on function public._estoque_aplicar(uuid, integer) from public, anon, authenticated;
revoke all on function public._estoque_devolver(uuid, text) from public, anon, authenticated;
revoke all on function public._trg_estoque_venda() from public, anon, authenticated;
revoke all on function public._trg_estoque_remocao() from public, anon, authenticated;
revoke all on function public._trg_estoque_cancelamento() from public, anon, authenticated;
revoke all on function public.ajustar_estoque(uuid, integer, text) from public, anon;
grant execute on function public.ajustar_estoque(uuid, integer, text) to authenticated;
