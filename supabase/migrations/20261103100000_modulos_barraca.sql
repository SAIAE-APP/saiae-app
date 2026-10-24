-- Rollback: drop trigger if exists barracas_fiscal_proteger on public.barracas;
--           drop function if exists public.barracas_fiscal_proteger();
--           drop trigger if exists modulos_sincronizar_flags on public.modulos_barraca;
--           drop function if exists public.modulos_sincronizar_flags();
--           drop function if exists public.modulos_ativos(uuid);
--           drop function if exists public.modulo_ativo(uuid, text);
--           drop table if exists public.modulos_eventos; drop table if exists public.modulos_barraca;
--           (as colunas antigas de barracas ficam como estão: o espelho só as preenchia)
-- Módulos pagos, tarefa 1: tabela por loja, vigência, espelho das flags antigas e proteção. ADITIVA.
--   * modulos_barraca é a única fonte da verdade; só o superadmin escreve (funções da tarefa 2), nunca o dono.
--   * modulo_ativo(barraca, modulo) decide a vigência na hora da consulta (sem cron): pago vale até pago_ate + 7 dias
--     (limite inclusivo), cortesia ativa vale sempre, teste vale enquanto teste_ate > now().
--   * fiscal_habilitado, whatsapp_disparos_habilitado e ia_habilitada viram ESPELHO mantido por trigger, para o CRM e
--     as functions em produção não quebrarem. O espelho pode ficar velho quando uma data vence: a verdade é modulo_ativo.
--   * O espelho nunca liga ia_habilitada (a regra do dono confirmado de 20261019150000 continua valendo); só desliga.

create table if not exists public.modulos_barraca (
  barraca_id uuid not null references public.barracas(id) on delete cascade,
  modulo text not null,
  estado text not null,
  origem text not null,
  teste_ate timestamptz,
  pago_ate timestamptz,
  ativado_em timestamptz,
  termo_versao text,
  termo_aceito_em timestamptz,
  ativacao_cobrada_em timestamptz,
  primary key (barraca_id, modulo),
  constraint modulos_barraca_modulo_check
    check (modulo in ('whatsapp_avisos', 'whatsapp_disparos', 'whatsapp_bot', 'fiscal')),
  constraint modulos_barraca_estado_check check (estado in ('teste', 'ativo', 'suspenso', 'cancelado')),
  constraint modulos_barraca_origem_check check (origem in ('cortesia', 'pago')),
  constraint modulos_barraca_pago_exige_data
    check (not (estado = 'ativo' and origem = 'pago') or pago_ate is not null)
);

alter table public.modulos_barraca enable row level security;
revoke all on table public.modulos_barraca from public, anon, authenticated;
grant select on table public.modulos_barraca to authenticated;
drop policy if exists modulos_barraca_select on public.modulos_barraca;
create policy modulos_barraca_select on public.modulos_barraca
  for select to authenticated using (public.usuario_tem_acesso_barraca(barraca_id));

-- Histórico de mudanças; escrito pelas funções do superadmin (tarefa 2). Sem policy: ninguém lê direto.
create table if not exists public.modulos_eventos (
  id bigint generated always as identity primary key,
  barraca_id uuid not null,
  modulo text not null,
  ator uuid,
  de jsonb,
  para jsonb,
  criado_em timestamptz not null default now()
);
alter table public.modulos_eventos enable row level security;
revoke all on table public.modulos_eventos from public, anon, authenticated;

create or replace function public.modulo_ativo(p_barraca_id uuid, p_modulo text)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  m public.modulos_barraca%rowtype;
  v_vigente boolean;
begin
  select * into m from public.modulos_barraca where barraca_id = p_barraca_id and modulo = p_modulo;
  if not found then
    return false;
  end if;
  v_vigente := case m.estado
    when 'teste' then coalesce(m.teste_ate > now(), false)
    when 'ativo' then m.origem = 'cortesia'
      or coalesce(now() <= m.pago_ate + interval '7 days', false)
    else false
  end;
  -- disparos só vale com avisos vigente na mesma loja
  if v_vigente and p_modulo = 'whatsapp_disparos' then
    return public.modulo_ativo(p_barraca_id, 'whatsapp_avisos');
  end if;
  return v_vigente;
end;
$$;
revoke all on function public.modulo_ativo(uuid, text) from public, anon;
grant execute on function public.modulo_ativo(uuid, text) to authenticated, service_role;

create or replace function public.modulos_ativos(p_barraca_id uuid)
returns text[]
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when p_barraca_id is not null and (public.usuario_tem_acesso_barraca(p_barraca_id) or public.sou_superadmin())
    then coalesce((
      select array_agg(m.modulo order by m.modulo)
        from public.modulos_barraca m
       where m.barraca_id = p_barraca_id and public.modulo_ativo(p_barraca_id, m.modulo)
    ), '{}'::text[])
    else '{}'::text[]
  end;
$$;
revoke all on function public.modulos_ativos(uuid) from public, anon;
grant execute on function public.modulos_ativos(uuid) to authenticated;

-- Espelho: security definer para o dono do banco escrever em barracas sem esbarrar nos triggers de proteção.
create or replace function public.modulos_sincronizar_flags()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid := case when tg_op = 'DELETE' then old.barraca_id else new.barraca_id end;
begin
  update public.barracas b
     set whatsapp_disparos_habilitado = public.modulo_ativo(b.id, 'whatsapp_disparos'),
         fiscal_habilitado = public.modulo_ativo(b.id, 'fiscal'),
         -- só desliga: ligar a IA continua exigindo o dono confirmado
         ia_habilitada = case when public.modulo_ativo(b.id, 'whatsapp_bot') then b.ia_habilitada else false end
   where b.id = v_id;
  return null;
end;
$$;
revoke all on function public.modulos_sincronizar_flags() from public, anon, authenticated;

drop trigger if exists modulos_sincronizar_flags on public.modulos_barraca;
create trigger modulos_sincronizar_flags
  after insert or update or delete on public.modulos_barraca
  for each row execute function public.modulos_sincronizar_flags();

-- Dono nunca liga o fiscal sozinho (mesmo desenho de barracas_disparos_proteger).
create or replace function public.barracas_fiscal_proteger()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if current_user in ('authenticated', 'anon') then
    if tg_op = 'INSERT' then
      if coalesce(new.fiscal_habilitado, false) then
        raise exception 'fiscal_use_o_modulo';
      end if;
    elsif new.fiscal_habilitado is distinct from old.fiscal_habilitado then
      raise exception 'fiscal_use_o_modulo';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists barracas_fiscal_proteger on public.barracas;
create trigger barracas_fiscal_proteger
  before insert or update on public.barracas
  for each row execute function public.barracas_fiscal_proteger();

-- Backfill das lojas atuais (inventário de produção em 2026-10-24), cortesia com o termo provisório.
insert into public.modulos_barraca (barraca_id, modulo, estado, origem, ativado_em, termo_versao, termo_aceito_em)
select b.id, v.modulo, 'ativo', 'cortesia', now(), 'legado-2026-10-24', now()
  from public.barracas b
  join (values
    ('sai-ae-uma-barraca', 'whatsapp_avisos'), ('sai-ae-uma-barraca', 'whatsapp_disparos'), ('sai-ae-uma-barraca', 'whatsapp_bot'),
    ('dhelenarestaurante', 'whatsapp_avisos'), ('dhelenarestaurante', 'whatsapp_disparos'),
    ('qa-teste-varredura', 'whatsapp_avisos'), ('qa-teste-varredura', 'whatsapp_disparos'),
    ('qa-teste-varredura', 'whatsapp_bot'), ('qa-teste-varredura', 'fiscal')
  ) as v(slug, modulo) on v.slug = b.slug
on conflict (barraca_id, modulo) do nothing;

-- Flag antiga ligada sem módulo correspondente (módulo inexistente = desligado) é sobrescrita pelo valor derivado.
update public.barracas b
   set whatsapp_disparos_habilitado = public.modulo_ativo(b.id, 'whatsapp_disparos'),
       fiscal_habilitado = public.modulo_ativo(b.id, 'fiscal'),
       ia_habilitada = case when public.modulo_ativo(b.id, 'whatsapp_bot') then b.ia_habilitada else false end
 where b.whatsapp_disparos_habilitado is distinct from public.modulo_ativo(b.id, 'whatsapp_disparos')
    or b.fiscal_habilitado is distinct from public.modulo_ativo(b.id, 'fiscal')
    or (b.ia_habilitada and not public.modulo_ativo(b.id, 'whatsapp_bot'));
