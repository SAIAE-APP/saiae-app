-- Gestão por IA (MCP): trava pelo módulo pago `ia_gestao`. Depende de 20261103100000/110000 e 20261127100000.
-- Só o superadmin ativa o módulo (admin_modulo_definir). Sem módulo vigente a edge function responde 403.
--
-- Rollback: restaurar mcp_token_validar de 20261127100000, modulos_definir_interno e admin_modulos_listar de
--   20261103110000, e recriar a constraint sem 'ia_gestao' (antes, apagar linhas modulo = 'ia_gestao').

alter table public.modulos_barraca drop constraint if exists modulos_barraca_modulo_check;
alter table public.modulos_barraca add constraint modulos_barraca_modulo_check
  check (modulo in ('whatsapp_avisos', 'whatsapp_disparos', 'whatsapp_bot', 'fiscal', 'ia_gestao'));

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
  if p_modulo is null or p_modulo not in ('whatsapp_avisos', 'whatsapp_disparos', 'whatsapp_bot', 'fiscal', 'ia_gestao')
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
    case when v_liga then coalesce(p_termo_versao, m.termo_versao) else m.termo_versao end,
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
    from (values ('whatsapp_avisos'), ('whatsapp_disparos'), ('whatsapp_bot'), ('fiscal'), ('ia_gestao')) as v(modulo)
    left join public.modulos_barraca m on m.barraca_id = p_barraca_id and m.modulo = v.modulo
   where public.sou_superadmin();
$$;
revoke all on function public.admin_modulos_listar(uuid) from public, anon;
grant execute on function public.admin_modulos_listar(uuid) to authenticated;

-- Token válido mas módulo fora de vigência: {estado: 'modulo_desligado'} (a function responde 403).
create or replace function public.mcp_token_validar(p_hash text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_token public.mcp_tokens%rowtype;
begin
  select t.* into v_token
  from public.mcp_tokens t
  where t.token_hash = p_hash and t.revogado_em is null
    and exists (
      select 1 from public.usuarios_barracas ub
      where ub.barraca_id = t.barraca_id and ub.usuario_id = t.criado_por and ub.papel = 'dono'
    );
  if not found then
    return null;
  end if;
  if not public.modulo_ativo(v_token.barraca_id, 'ia_gestao') then
    return jsonb_build_object('estado', 'modulo_desligado');
  end if;
  if v_token.ultimo_uso_em is null or v_token.ultimo_uso_em < now() - interval '1 minute' then
    update public.mcp_tokens set ultimo_uso_em = now() where id = v_token.id;
  end if;
  return jsonb_build_object('barraca_id', v_token.barraca_id, 'token_id', v_token.id);
end;
$$;
revoke all on function public.mcp_token_validar(text) from public, anon, authenticated;
grant execute on function public.mcp_token_validar(text) to service_role;
