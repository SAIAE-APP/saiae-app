-- Rollback: drop function if exists public.registrar_contato_marketing(uuid, text, text);
-- Contato de pedido de balcão com consentimento de promoções (WhatsApp disparos, fase 3). ADITIVA.
-- O operador pergunta ao cliente se aceita receber promoções por WhatsApp da loja e marca a caixa em Confirmar Pedido;
-- só então o telefone entra em `clientes_finais` com `consentimento_marketing_em`. Sem a marca, nada é salvo (como antes).
--   * Só quem tem acesso à loja chama (authenticated); exige o módulo `whatsapp_disparos_habilitado` ligado na loja.
--   * Upsert por (barraca, telefone): cliente que já existe NUNCA tem nome ou endereço sobrescritos; só ganha o
--     consentimento se ainda não tinha (a data do primeiro aceite é preservada).
--   * Nome vazio vira "Cliente 1234" (final do telefone), porque `nome` é obrigatório.

create or replace function public.registrar_contato_marketing(p_barraca_id uuid, p_telefone text, p_nome text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_tel text := regexp_replace(coalesce(p_telefone, ''), '\D', '', 'g');
  v_nome text := nullif(btrim(coalesce(p_nome, '')), '');
begin
  if auth.uid() is null then
    return jsonb_build_object('estado', 'nao_autenticado');
  end if;
  if not public.usuario_tem_acesso_barraca(p_barraca_id) then
    return jsonb_build_object('estado', 'sem_acesso');
  end if;
  if not coalesce((select whatsapp_disparos_habilitado from public.barracas where id = p_barraca_id), false) then
    return jsonb_build_object('estado', 'modulo_desligado');
  end if;
  if v_tel !~ '^[0-9]{8,15}$' then
    return jsonb_build_object('estado', 'dados_invalidos');
  end if;
  if v_nome is not null and char_length(v_nome) > 60 then
    v_nome := left(v_nome, 60);
  end if;

  insert into public.clientes_finais (barraca_id, nome, telefone, origem, consentimento_marketing_em)
  values (p_barraca_id, coalesce(v_nome, 'Cliente ' || right(v_tel, 4)), v_tel, 'balcao', now())
  on conflict (barraca_id, telefone) do update
    set consentimento_marketing_em = coalesce(public.clientes_finais.consentimento_marketing_em, now()),
        atualizado_em = now();
  return jsonb_build_object('estado', 'ok');
end;
$fn$;

revoke all on function public.registrar_contato_marketing(uuid, text, text) from public, anon;
grant execute on function public.registrar_contato_marketing(uuid, text, text) to authenticated;
