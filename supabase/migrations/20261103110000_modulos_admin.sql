-- Rollback: drop function if exists public.admin_pacote_whatsapp(uuid, text, timestamptz, timestamptz, text);
--           drop function if exists public.admin_modulo_ativacao_cobrada(uuid);
--           drop function if exists public.admin_modulo_definir(uuid, text, text, text, timestamptz, timestamptz, text);
--           drop function if exists public.admin_modulos_listar(uuid);
--           drop function if exists public.modulos_definir_interno(uuid, text, text, text, timestamptz, timestamptz, text);
-- Módulos pagos, tarefa 2: funções do superadmin. ADITIVA (só funções).
--   * Toda escrita em modulos_barraca passa por aqui; cada mudança grava uma linha em modulos_eventos (ator = auth.uid()).
--   * Retorno em jsonb {estado}: ok, nao_autorizado, invalido, termo_obrigatorio, dependencia.
--   * admin_modulos_listar devolve tabela, então o não-superadmin recebe CONJUNTO VAZIO em vez de nao_autorizado.
--   * Termo (fiscal e disparos, ao ligar ou testar) vale se vier agora ou se a linha já tem termo_versao (legado inclusive).
--   * Dependência: ligar ou testar disparos exige avisos vigente agora. Suspender ou cancelar avisos nunca é bloqueado.

-- Núcleo sem checagem de permissão: só as funções abaixo o chamam; ninguém mais tem execute.
create or replace function public.modulos_definir_interno(
  p_barraca_id uuid, p_modulo text, p_estado text, p_origem text,
  p_teste_ate timestamptz, p_pago_ate timestamptz, p_termo_versao text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  m public.modulos_barraca%rowtype;
  v_antes jsonb;
  v_depois public.modulos_barraca%rowtype;
  v_liga boolean := p_estado in ('ativo', 'teste');
begin
  if p_modulo is null or p_modulo not in ('whatsapp_avisos', 'whatsapp_disparos', 'whatsapp_bot', 'fiscal')
     or p_estado is null or p_estado not in ('teste', 'ativo', 'suspenso', 'cancelado')
     or p_origem is null or p_origem not in ('cortesia', 'pago')
     or (p_estado = 'ativo' and p_origem = 'pago' and p_pago_ate is null)
     or (p_estado = 'teste' and p_teste_ate is null)
     or not exists (select 1 from public.barracas where id = p_barraca_id) then
    return jsonb_build_object('estado', 'invalido');
  end if;

  select * into m from public.modulos_barraca where barraca_id = p_barraca_id and modulo = p_modulo;
  v_antes := case when found then to_jsonb(m) end;

  if v_liga and p_modulo in ('fiscal', 'whatsapp_disparos')
     and p_termo_versao is null and m.termo_versao is null then
    return jsonb_build_object('estado', 'termo_obrigatorio');
  end if;

  if v_liga and p_modulo = 'whatsapp_disparos' and not public.modulo_ativo(p_barraca_id, 'whatsapp_avisos') then
    return jsonb_build_object('estado', 'dependencia');
  end if;

  insert into public.modulos_barraca as t
    (barraca_id, modulo, estado, origem, teste_ate, pago_ate, ativado_em, termo_versao, termo_aceito_em)
  values (
    p_barraca_id, p_modulo, p_estado, p_origem, p_teste_ate, p_pago_ate,
    case when v_liga then coalesce(m.ativado_em, now()) else m.ativado_em end,
    case when v_liga then coalesce(p_termo_versao, m.termo_versao) else m.termo_versao end, -- suspender/cancelar nunca reescreve o termo
    case when v_liga and p_termo_versao is not null then now() else m.termo_aceito_em end
  )
  on conflict (barraca_id, modulo) do update
    set estado = excluded.estado, origem = excluded.origem, teste_ate = excluded.teste_ate,
        pago_ate = excluded.pago_ate, ativado_em = excluded.ativado_em,
        termo_versao = excluded.termo_versao, termo_aceito_em = excluded.termo_aceito_em
  returning t.* into v_depois;

  insert into public.modulos_eventos (barraca_id, modulo, ator, de, para)
  values (p_barraca_id, p_modulo, auth.uid(), v_antes, to_jsonb(v_depois));

  return jsonb_build_object('estado', 'ok');
end;
$$;
revoke all on function public.modulos_definir_interno(uuid, text, text, text, timestamptz, timestamptz, text)
  from public, anon, authenticated;

create or replace function public.admin_modulos_listar(p_barraca_id uuid)
returns table (
  modulo text, estado text, origem text, teste_ate timestamptz, pago_ate timestamptz, ativado_em timestamptz,
  termo_versao text, termo_aceito_em timestamptz, ativacao_cobrada_em timestamptz, vigente boolean
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select v.modulo, coalesce(m.estado, 'inativo'), m.origem, m.teste_ate, m.pago_ate, m.ativado_em,
         m.termo_versao, m.termo_aceito_em, m.ativacao_cobrada_em, public.modulo_ativo(p_barraca_id, v.modulo)
    from (values ('whatsapp_avisos'), ('whatsapp_disparos'), ('whatsapp_bot'), ('fiscal')) as v(modulo)
    left join public.modulos_barraca m on m.barraca_id = p_barraca_id and m.modulo = v.modulo
   where public.sou_superadmin();
$$;
revoke all on function public.admin_modulos_listar(uuid) from public, anon;
grant execute on function public.admin_modulos_listar(uuid) to authenticated;

create or replace function public.admin_modulo_definir(
  p_barraca_id uuid, p_modulo text, p_estado text, p_origem text,
  p_teste_ate timestamptz, p_pago_ate timestamptz, p_termo_versao text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.sou_superadmin() then
    return jsonb_build_object('estado', 'nao_autorizado');
  end if;
  return public.modulos_definir_interno(p_barraca_id, p_modulo, p_estado, p_origem, p_teste_ate, p_pago_ate, p_termo_versao);
end;
$$;
revoke all on function public.admin_modulo_definir(uuid, text, text, text, timestamptz, timestamptz, text) from public, anon;
grant execute on function public.admin_modulo_definir(uuid, text, text, text, timestamptz, timestamptz, text) to authenticated;

create or replace function public.admin_modulo_ativacao_cobrada(p_barraca_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  m public.modulos_barraca%rowtype;
  v_depois public.modulos_barraca%rowtype;
begin
  if not public.sou_superadmin() then
    return jsonb_build_object('estado', 'nao_autorizado');
  end if;
  select * into m from public.modulos_barraca where barraca_id = p_barraca_id and modulo = 'fiscal';
  if not found then
    return jsonb_build_object('estado', 'invalido');
  end if;
  update public.modulos_barraca set ativacao_cobrada_em = now()
   where barraca_id = p_barraca_id and modulo = 'fiscal' returning * into v_depois;
  insert into public.modulos_eventos (barraca_id, modulo, ator, de, para)
  values (p_barraca_id, 'fiscal', auth.uid(), to_jsonb(m), to_jsonb(v_depois));
  return jsonb_build_object('estado', 'ok');
end;
$$;
revoke all on function public.admin_modulo_ativacao_cobrada(uuid) from public, anon;
grant execute on function public.admin_modulo_ativacao_cobrada(uuid) to authenticated;

-- Tudo ou nada: a falha de um dos três levanta exceção dentro do bloco, que desfaz as gravações anteriores do bloco.
create or replace function public.admin_pacote_whatsapp(
  p_barraca_id uuid, p_origem text, p_teste_ate timestamptz, p_pago_ate timestamptz, p_termo_versao text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_estado text := case when p_teste_ate is null then 'ativo' else 'teste' end;
  v_modulo text;
  v_res jsonb;
begin
  if not public.sou_superadmin() then
    return jsonb_build_object('estado', 'nao_autorizado');
  end if;
  begin
    -- avisos primeiro: disparos depende dele
    foreach v_modulo in array array['whatsapp_avisos', 'whatsapp_disparos', 'whatsapp_bot'] loop
      v_res := public.modulos_definir_interno(
        p_barraca_id, v_modulo, v_estado, p_origem, p_teste_ate, p_pago_ate, p_termo_versao);
      if v_res->>'estado' <> 'ok' then
        raise exception 'pacote:%', v_res->>'estado';
      end if;
    end loop;
  exception when raise_exception then
    if sqlerrm like 'pacote:%' then
      return jsonb_build_object('estado', substr(sqlerrm, 8));
    end if;
    raise;
  end;
  return jsonb_build_object('estado', 'ok');
end;
$$;
revoke all on function public.admin_pacote_whatsapp(uuid, text, timestamptz, timestamptz, text) from public, anon;
grant execute on function public.admin_pacote_whatsapp(uuid, text, timestamptz, timestamptz, text) to authenticated;
