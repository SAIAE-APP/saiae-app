-- Rollback: drop function if exists public.whatsapp_avaliacao_salvar(uuid, boolean, text);
--           drop trigger if exists barracas_disparos_proteger on public.barracas;
--           drop function if exists public.barracas_disparos_proteger();
--           alter table public.barracas drop constraint if exists barracas_avaliacao_texto_tamanho,
--             drop column if exists whatsapp_disparos_habilitado, drop column if exists avaliacao_ativa, drop column if exists avaliacao_texto;
-- WhatsApp disparos (fase 3), parte 1: colunas, proteção de escrita e RPC da avaliação. ADITIVA.
--   * whatsapp_disparos_habilitado = módulo pago: só a plataforma (service_role / SQL) liga, como ia_habilitada.
--   * avaliacao_ativa e avaliacao_texto só mudam por whatsapp_avaliacao_salvar (valida e exige o módulo ligado).
alter table public.barracas
  add column if not exists whatsapp_disparos_habilitado boolean not null default false,
  add column if not exists avaliacao_ativa boolean not null default false,
  add column if not exists avaliacao_texto text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'barracas_avaliacao_texto_tamanho') then
    alter table public.barracas
      add constraint barracas_avaliacao_texto_tamanho
      check (avaliacao_texto is null or (char_length(avaliacao_texto) <= 500 and btrim(avaliacao_texto) <> ''));
  end if;
end $$;

create or replace function public.barracas_disparos_proteger()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if current_user in ('authenticated', 'anon') then
    if tg_op = 'INSERT' then
      if new.whatsapp_disparos_habilitado or new.avaliacao_ativa or new.avaliacao_texto is not null then
        raise exception 'disparos_use_a_tela';
      end if;
    elsif new.whatsapp_disparos_habilitado is distinct from old.whatsapp_disparos_habilitado
       or new.avaliacao_ativa is distinct from old.avaliacao_ativa
       or new.avaliacao_texto is distinct from old.avaliacao_texto then
      raise exception 'disparos_use_a_tela';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists barracas_disparos_proteger on public.barracas;
create trigger barracas_disparos_proteger
  before insert or update on public.barracas
  for each row execute function public.barracas_disparos_proteger();

create or replace function public.whatsapp_avaliacao_salvar(p_barraca_id uuid, p_ativa boolean, p_texto text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_habilitado boolean;
begin
  if auth.uid() is null then
    return jsonb_build_object('estado', 'nao_autenticado');
  end if;
  if not public.usuario_tem_acesso_barraca(p_barraca_id) then
    return jsonb_build_object('estado', 'sem_acesso');
  end if;
  select whatsapp_disparos_habilitado into v_habilitado from public.barracas where id = p_barraca_id;
  if not coalesce(v_habilitado, false) then
    return jsonb_build_object('estado', 'modulo_desligado');
  end if;
  -- texto null = texto padrão; vazio, só espaços ou acima de 500 é inválido.
  if p_ativa is null or (p_texto is not null and (btrim(p_texto) = '' or char_length(p_texto) > 500)) then
    return jsonb_build_object('estado', 'dados_invalidos');
  end if;
  update public.barracas set avaliacao_ativa = p_ativa, avaliacao_texto = p_texto where id = p_barraca_id;
  return jsonb_build_object('estado', 'ok');
end;
$fn$;

revoke all on function public.whatsapp_avaliacao_salvar(uuid, boolean, text) from public, anon;
grant execute on function public.whatsapp_avaliacao_salvar(uuid, boolean, text) to authenticated;
