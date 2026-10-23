-- Rollback: drop trigger if exists barracas_whatsapp_proteger on public.barracas;
--           drop function if exists public.barracas_whatsapp_proteger();
--           e reaplicar a definição de whatsapp_avisos_salvar de 20261030100000_whatsapp_avisos.sql.
-- Revisão final dos avisos de WhatsApp. ADITIVA; depende de 20261030100000 e 20261030110000.
--   1. whatsapp_avisos_salvar recusa texto vazio ou só com espaços (null continua = texto padrão).
--   2. A RLS de `barracas` deixa o usuário editar colunas direto; sem isto ele gravaria config fora da validação da RPC
--      (chave desconhecida, texto gigante que segue em todo evento order.*) ou adiantaria whatsapp_status_em para
--      silenciar para sempre os avisos de queda do CRM. Quem chega com o login do usuário (authenticated/anon) não muda
--      as três colunas; o papel de serviço e as funções SECURITY DEFINER (current_user = dono da função) continuam podendo.

create or replace function public.whatsapp_avisos_salvar(p_barraca_id uuid, p_avisos jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_chave text;
  v_valor jsonb;
  v_campo text;
begin
  if auth.uid() is null then
    return jsonb_build_object('estado', 'nao_autenticado');
  end if;
  if not public.usuario_tem_acesso_barraca(p_barraca_id) then
    return jsonb_build_object('estado', 'sem_acesso');
  end if;
  if p_avisos is null or jsonb_typeof(p_avisos) <> 'object' then
    return jsonb_build_object('estado', 'dados_invalidos');
  end if;
  for v_chave, v_valor in select * from jsonb_each(p_avisos) loop
    if v_chave not in ('recebido', 'pronto', 'saiu_entrega', 'entregue', 'cancelado')
       or jsonb_typeof(v_valor) <> 'object'
       or jsonb_typeof(v_valor -> 'ativo') is distinct from 'boolean'
       or coalesce(jsonb_typeof(v_valor -> 'texto'), 'null') not in ('null', 'string')
       or char_length(coalesce(v_valor ->> 'texto', '')) > 500
       or (v_valor ->> 'texto' is not null and btrim(v_valor ->> 'texto') = '') then
      return jsonb_build_object('estado', 'dados_invalidos');
    end if;
    for v_campo in select jsonb_object_keys(v_valor) loop
      if v_campo not in ('ativo', 'texto') then
        return jsonb_build_object('estado', 'dados_invalidos');
      end if;
    end loop;
  end loop;
  update public.barracas set whatsapp_avisos = p_avisos where id = p_barraca_id;
  return jsonb_build_object('estado', 'ok');
end;
$fn$;

revoke all on function public.whatsapp_avisos_salvar(uuid, jsonb) from public, anon;
grant execute on function public.whatsapp_avisos_salvar(uuid, jsonb) to authenticated;

create or replace function public.barracas_whatsapp_proteger()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if current_user in ('authenticated', 'anon') then
    if tg_op = 'INSERT' then
      if new.whatsapp_avisos is not null or new.whatsapp_status is not null or new.whatsapp_status_em is not null then
        raise exception 'whatsapp_use_a_tela';
      end if;
    elsif new.whatsapp_avisos is distinct from old.whatsapp_avisos
       or new.whatsapp_status is distinct from old.whatsapp_status
       or new.whatsapp_status_em is distinct from old.whatsapp_status_em then
      raise exception 'whatsapp_use_a_tela';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists barracas_whatsapp_proteger on public.barracas;
create trigger barracas_whatsapp_proteger
  before insert or update on public.barracas
  for each row execute function public.barracas_whatsapp_proteger();
