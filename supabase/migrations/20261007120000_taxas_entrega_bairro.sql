-- Taxa de entrega por bairro (Sprint 2, Story 1). ADITIVO e retrocompatível:
-- tabela nova, colunas novas com default, funções novas. Nada do que o app
-- v1.8/v1.9 usa muda. Constraints existentes consultadas antes: em `pedidos`
-- só valem pedidos_tipo_atendimento_valido (inclui 'entrega'),
-- pedidos_taxa_entrega_centavos_valida (>= 0) e pedidos_metodo_pagamento_check
-- (já aceita 'na_entrega'); em `clientes_finais`, telefone só dígitos 8-15 e
-- unique (barraca_id, telefone) — o cardápio manda telefone normalizado.

-- 1) Normalização de bairro: minúsculo, sem acento, espaços colapsados.
-- translate() em vez de unaccent pra não depender de extensão.
create or replace function public.normalizar_bairro(p_bairro text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select btrim(regexp_replace(
    translate(
      lower(coalesce(p_bairro, '')),
      'áàâãäéèêëíìîïóòôõöúùûüçñ',
      'aaaaaeeeeiiiiooooouuuucn'
    ),
    '\s+', ' ', 'g'
  ));
$$;

-- 2) Bairros atendidos e valor da taxa de cada um.
create table if not exists public.taxas_entrega_bairro (
  id uuid primary key default gen_random_uuid(),
  barraca_id uuid not null references public.barracas(id) on delete cascade,
  bairro text not null,
  bairro_normalizado text not null,
  valor_centavos integer not null check (valor_centavos >= 0 and valor_centavos <= 99999999),
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  constraint taxas_entrega_bairro_unico unique (barraca_id, bairro_normalizado),
  constraint taxas_entrega_bairro_nome_valido check (btrim(bairro) <> '' and bairro_normalizado <> '')
);

-- BEFORE INSERT/UPDATE: a coluna normalizada sempre acompanha o nome digitado,
-- e roda antes do ON CONFLICT do upsert (colar lista atualiza valor existente).
create or replace function public.taxas_entrega_bairro_normalizar()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.bairro := btrim(regexp_replace(coalesce(new.bairro, ''), '\s+', ' ', 'g'));
  new.bairro_normalizado := public.normalizar_bairro(new.bairro);
  return new;
end;
$$;

drop trigger if exists taxas_entrega_bairro_normalizar on public.taxas_entrega_bairro;
create trigger taxas_entrega_bairro_normalizar
  before insert or update of bairro on public.taxas_entrega_bairro
  for each row execute function public.taxas_entrega_bairro_normalizar();

alter table public.taxas_entrega_bairro enable row level security;

create policy "usuarios veem taxas de bairro de suas barracas"
on public.taxas_entrega_bairro for select
to authenticated
using (usuario_tem_acesso_barraca(barraca_id));

create policy "usuarios inserem taxas de bairro em suas barracas"
on public.taxas_entrega_bairro for insert
to authenticated
with check (usuario_tem_acesso_barraca(barraca_id));

create policy "usuarios editam taxas de bairro de suas barracas"
on public.taxas_entrega_bairro for update
to authenticated
using (usuario_tem_acesso_barraca(barraca_id))
with check (usuario_tem_acesso_barraca(barraca_id));

create policy "usuarios deletam taxas de bairro de suas barracas"
on public.taxas_entrega_bairro for delete
to authenticated
using (usuario_tem_acesso_barraca(barraca_id));

-- 3) Política de bairro não listado (padrão = comportamento atual: taxa padrão).
alter table public.barracas
  add column if not exists entrega_bairro_nao_listado text not null default 'taxa_padrao';
alter table public.barracas
  drop constraint if exists barracas_entrega_bairro_nao_listado_valido;
alter table public.barracas
  add constraint barracas_entrega_bairro_nao_listado_valido
  check (entrega_bairro_nao_listado in ('taxa_padrao', 'bloquear'));

-- 4) Origem e consentimento LGPD do cadastro de cliente final.
alter table public.clientes_finais
  add column if not exists origem text,
  add column if not exists consentimento_lgpd_em timestamptz;

-- 5) Taxa de um bairro, calculada NO SERVIDOR (edge functions, service role).
-- origem: 'bairro' | 'padrao' | 'bloqueado' | 'sem_taxa'.
create or replace function public.taxa_entrega_do_bairro(p_barraca_id uuid, p_bairro text)
returns table(permitido boolean, taxa_centavos integer, origem text)
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
declare
  v_barraca public.barracas%rowtype;
  v_valor integer;
begin
  select * into v_barraca from public.barracas where id = p_barraca_id;
  if not found then
    return query select false, 0, 'bloqueado'::text;
    return;
  end if;

  select t.valor_centavos into v_valor
    from public.taxas_entrega_bairro t
   where t.barraca_id = p_barraca_id
     and t.ativo
     and t.bairro_normalizado = public.normalizar_bairro(p_bairro);
  if found then
    return query select true, v_valor, 'bairro'::text;
    return;
  end if;

  if v_barraca.entrega_bairro_nao_listado = 'bloquear' then
    return query select false, 0, 'bloqueado'::text;
    return;
  end if;

  if v_barraca.taxa_entrega_habilitada then
    return query select true, v_barraca.taxa_entrega_centavos, 'padrao'::text;
  else
    return query select true, 0, 'sem_taxa'::text;
  end if;
end;
$$;

revoke all on function public.taxa_entrega_do_bairro(uuid, text) from public, anon, authenticated;
grant execute on function public.taxa_entrega_do_bairro(uuid, text) to service_role;

-- 6) Lista pública pro formulário do cardápio. Uma linha por bairro ativo; se a
-- barraca não tem nenhum, devolve UMA linha com bairro NULL pra o front ainda
-- ler a política (nao_listado) e a taxa padrão. Nada mais da barraca é exposto.
create or replace function public.bairros_entrega_publicos(p_slug text)
returns table(
  bairro text,
  valor_centavos integer,
  nao_listado text,
  taxa_padrao_centavos integer,
  taxa_habilitada boolean
)
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select
    t.bairro,
    t.valor_centavos,
    b.entrega_bairro_nao_listado,
    b.taxa_entrega_centavos,
    b.taxa_entrega_habilitada
  from public.barracas b
  left join public.taxas_entrega_bairro t on t.barraca_id = b.id and t.ativo
  where b.slug = p_slug
  order by t.bairro_normalizado nulls last;
$$;

revoke all on function public.bairros_entrega_publicos(text) from public;
grant execute on function public.bairros_entrega_publicos(text) to anon, authenticated;
