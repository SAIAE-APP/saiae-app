-- Rollback: drop function public.integracao_pix_reservar(uuid, text, jsonb, timestamptz);
--           alter table public.pagamentos_pendentes drop column if exists emissao_iniciada_em;
-- Pix do bot (integracao-v1): reivindica o pendente de um client_uuid ANTES de chamar o provedor, para dois pedidos
-- simultâneos não emitirem duas cobranças. Um lock advisory transacional por client_uuid serializa as chamadas; quem
-- chega com uma emissão em curso (menos de 60 s, sem id externo ainda) recebe 'em_andamento' e tenta de novo depois.
-- `emissao_iniciada_em` marca a reivindicação; o provedor com falha libera (a function zera a coluna).
alter table public.pagamentos_pendentes add column if not exists emissao_iniciada_em timestamptz;

-- Devolve { estado, id? }: reivindicado | emitido | em_andamento | ja_pago | expirado | outra_loja.
-- Só 'reivindicado' autoriza criar a cobrança. Só a service role chama.
create or replace function public.integracao_pix_reservar(
  p_barraca_id uuid,
  p_client_uuid text,
  p_dados jsonb,
  p_expira_em timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v public.pagamentos_pendentes%rowtype;
  v_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended('integracao_pix:' || p_client_uuid, 0));

  select * into v from public.pagamentos_pendentes where client_uuid = p_client_uuid for update;
  if found then
    if v.barraca_id <> p_barraca_id then return jsonb_build_object('estado', 'outra_loja'); end if;
    if v.status = 'aprovado' then return jsonb_build_object('estado', 'ja_pago'); end if;
    if v.status <> 'pendente' or (v.expira_em is not null and v.expira_em <= now()) then
      return jsonb_build_object('estado', 'expirado');
    end if;
    if v.mercadopago_order_id is not null then return jsonb_build_object('estado', 'emitido', 'id', v.id); end if;
    if v.emissao_iniciada_em is not null and v.emissao_iniciada_em > now() - interval '60 seconds' then
      return jsonb_build_object('estado', 'em_andamento');
    end if;
    -- Cobrança anterior sem QR (falha do provedor): reaproveita a linha com o rascunho novo.
    update public.pagamentos_pendentes
       set itens = p_dados -> 'itens',
           cliente_nome = p_dados ->> 'cliente_nome',
           cliente_telefone = p_dados ->> 'cliente_telefone',
           conversa_id = p_dados ->> 'conversa_id',
           provedor = p_dados ->> 'provedor',
           expira_em = p_expira_em,
           emissao_iniciada_em = now()
     where id = v.id;
    return jsonb_build_object('estado', 'reivindicado', 'id', v.id);
  end if;

  insert into public.pagamentos_pendentes
    (barraca_id, client_uuid, mesa, viagem, observacao, itens, tipo_atendimento, cliente_nome, cliente_telefone,
     conversa_id, provedor, expira_em, emissao_iniciada_em)
  values
    (p_barraca_id, p_client_uuid, null, true, null, p_dados -> 'itens', 'retirada', p_dados ->> 'cliente_nome',
     p_dados ->> 'cliente_telefone', p_dados ->> 'conversa_id', p_dados ->> 'provedor', p_expira_em, now())
  on conflict (client_uuid) do nothing
  returning id into v_id;
  -- Conflito de unique (gravador fora do bot): quem chegou depois tenta de novo e cai no fluxo de retry.
  if v_id is null then return jsonb_build_object('estado', 'em_andamento'); end if;
  return jsonb_build_object('estado', 'reivindicado', 'id', v_id);
end;
$fn$;

revoke all on function public.integracao_pix_reservar(uuid, text, jsonb, timestamptz) from public, anon, authenticated;
grant execute on function public.integracao_pix_reservar(uuid, text, jsonb, timestamptz) to service_role;
