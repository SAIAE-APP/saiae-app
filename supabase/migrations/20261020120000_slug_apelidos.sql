-- Endereço do cardápio (slug) editável, com apelidos (H7). ADITIVA. Spec: docs/superpowers/specs/2026-10-19-slug-cardapio-apelidos-design.md.
-- Depende de 20261020100000_onboarding_config.sql (public.slug_reservado).
--
--  * barracas_slugs_antigos: o endereço antigo continua valendo PARA SEMPRE (QR e links impressos não quebram) e nunca
--    é reaproveitado por outra barraca. RLS ligado e sem policy: só as funções abaixo leem.
--  * barraca_trocar_slug(p_barraca_id, p_novo): só o DONO; formato (3 a 40, ^[a-z0-9]+(-[a-z0-9]+)*$), fora da lista de
--    reservados, não pode ser slug nem apelido de OUTRA barraca; no máximo 1 troca por 24 h e 10 apelidos por barraca;
--    voltar a um apelido da própria barraca é permitido; repetir o slug atual é ok. Guarda o slug velho como apelido.
--  * barraca_slug_atual(p_slug): público (anon); devolve o slug ATUAL se p_slug é o atual ou um apelido; senão null.
--    Só devolve o slug (nada da loja).
--  * Gatilho em barracas: quem chega pela API (authenticated/anon) não troca o slug direto ('slug_use_a_tela'), e nenhum
--    papel pode criar/mudar o slug para um apelido de outra barraca ('Esse endereço já está em uso', a mesma frase de
--    criar_barraca). Índice único em barracas.slug (se já houver duplicado, só avisa e segue).
--  * slug_disponivel (onboarding), se existir, passa a considerar os apelidos.
--
-- Rollback: drop trigger barracas_slug_proteger on barracas; drop function barracas_slug_proteger(), barraca_trocar_slug(uuid,
--   text), barraca_slug_atual(text); drop table barracas_slugs_antigos; alter table barracas drop column slug_trocado_em.

alter table public.barracas
  add column if not exists slug_trocado_em timestamptz;

create table if not exists public.barracas_slugs_antigos (
  slug text primary key check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  barraca_id uuid not null references public.barracas(id) on delete cascade,
  criado_em timestamptz not null default now()
);
create index if not exists barracas_slugs_antigos_barraca on public.barracas_slugs_antigos (barraca_id);
alter table public.barracas_slugs_antigos enable row level security;
revoke all on public.barracas_slugs_antigos from anon, authenticated;

do $$
begin
  create unique index if not exists barracas_slug_unico on public.barracas (slug);
exception when others then
  raise warning 'barracas_slug_unico não criado (%): há slug duplicado; a unicidade segue só pelas funções', sqlerrm;
end;
$$;

-- Gatilho: nada de trocar o slug direto pela API, e ninguém usa o apelido de outra barraca.
create or replace function public.barracas_slug_proteger()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'UPDATE' and new.slug is distinct from old.slug and current_user in ('authenticated', 'anon') then
    raise exception 'slug_use_a_tela';
  end if;
  if exists (
    select 1 from public.barracas_slugs_antigos a where a.slug = new.slug and a.barraca_id is distinct from new.id
  ) then
    raise exception 'Esse endereço já está em uso';
  end if;
  return new;
end;
$$;

drop trigger if exists barracas_slug_proteger on public.barracas;
create trigger barracas_slug_proteger
  before insert or update of slug on public.barracas
  for each row execute function public.barracas_slug_proteger();

create or replace function public.barraca_slug_atual(p_slug text)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select b.slug from public.barracas b where b.slug = lower(btrim(p_slug))),
    (select b.slug from public.barracas_slugs_antigos a join public.barracas b on b.id = a.barraca_id where a.slug = lower(btrim(p_slug)))
  )
$$;
revoke all on function public.barraca_slug_atual(text) from public;
grant execute on function public.barraca_slug_atual(text) to anon, authenticated;

create or replace function public.barraca_trocar_slug(p_barraca_id uuid, p_novo text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_novo text := lower(btrim(coalesce(p_novo, '')));
  b public.barracas%rowtype;
  v_proprio boolean;
begin
  if auth.uid() is null then
    return jsonb_build_object('estado', 'nao_autenticado');
  end if;

  select * into b from public.barracas where id = p_barraca_id for update;
  -- Mesma resposta para "não existe" e "não é o dono": não revela barraca de outra conta.
  if not found or not exists (
    select 1 from public.usuarios_barracas ub
     where ub.usuario_id = auth.uid() and ub.barraca_id = b.id and ub.papel = 'dono'
  ) then
    return jsonb_build_object('estado', 'sem_acesso');
  end if;

  if v_novo = b.slug then
    return jsonb_build_object('estado', 'ok', 'slug', b.slug);
  end if;

  if v_novo !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or char_length(v_novo) < 3 or char_length(v_novo) > 40 then
    return jsonb_build_object('estado', 'invalido');
  end if;
  if public.slug_reservado(v_novo) then
    return jsonb_build_object('estado', 'reservado');
  end if;

  select exists (select 1 from public.barracas_slugs_antigos a where a.slug = v_novo and a.barraca_id = b.id) into v_proprio;
  if exists (select 1 from public.barracas x where x.slug = v_novo and x.id <> b.id)
     or exists (select 1 from public.barracas_slugs_antigos a where a.slug = v_novo and a.barraca_id <> b.id) then
    return jsonb_build_object('estado', 'em_uso');
  end if;

  if b.slug_trocado_em is not null and b.slug_trocado_em > now() - interval '24 hours' then
    return jsonb_build_object('estado', 'muito_cedo');
  end if;
  if not v_proprio and (select count(*) from public.barracas_slugs_antigos a where a.barraca_id = b.id) >= 10 then
    return jsonb_build_object('estado', 'limite_apelidos');
  end if;

  -- Voltar a um apelido próprio: ele deixa de ser apelido (passa a ser o atual) e o atual vira apelido.
  delete from public.barracas_slugs_antigos where slug = v_novo and barraca_id = b.id;
  insert into public.barracas_slugs_antigos (slug, barraca_id) values (b.slug, b.id) on conflict (slug) do nothing;
  update public.barracas set slug = v_novo, slug_trocado_em = now() where id = b.id;

  return jsonb_build_object('estado', 'ok', 'slug', v_novo);
end;
$$;
revoke all on function public.barraca_trocar_slug(uuid, text) from public, anon;
grant execute on function public.barraca_trocar_slug(uuid, text) to authenticated;

-- slug_disponivel (assistente de configuração): apelido de qualquer barraca também está ocupado.
do $outer$
begin
  if to_regprocedure('public.slug_disponivel(text)') is not null then
    execute $f$
      create or replace function public.slug_disponivel(p_slug text) returns boolean
      language plpgsql
      stable
      security definer
      set search_path = public, pg_temp
      as $body$
      declare
        v_slug text := btrim(coalesce(p_slug, ''));
      begin
        if auth.uid() is null then
          raise exception 'Não autenticado';
        end if;
        if v_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or char_length(v_slug) > 40 or public.slug_reservado(v_slug) then
          return false;
        end if;
        return not exists (select 1 from public.barracas where slug = v_slug)
           and not exists (select 1 from public.barracas_slugs_antigos where slug = v_slug);
      end;
      $body$
    $f$;
  end if;
end;
$outer$;
