-- Sprint 5, Story D: provedor Asaas (QR Code Pix estático). ADITIVA.
--
-- 'asaas' já está nos CHECKs de provedor (barracas_pagamento_provedor_valido,
-- barracas_pagamento_token_provedor_valido, pagamentos_pendentes_provedor_valido),
-- então nenhum CHECK muda. Só entram:
--   * barracas_pagamento_token.chave_pix: a chave Pix do dono cadastrada no Asaas
--     (addressKey do QR estático). Guardada como o token: RLS sem policy de select,
--     só via função SECURITY DEFINER; nunca volta pro client (só um boolean).
--   * pagamentos_pendentes.qr_payload: o QR emitido, pra provedor que não devolve o QR
--     de uma cobrança já emitida (retry do mesmo client_uuid).

alter table public.barracas_pagamento_token
  add column if not exists chave_pix text;

alter table public.pagamentos_pendentes
  add column if not exists qr_payload jsonb;

create or replace function public.definir_chave_pix_pagamento(
  p_barraca_id uuid,
  p_provedor text,
  p_chave text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_chave text := nullif(btrim(p_chave), '');
begin
  if not usuario_tem_acesso_barraca(p_barraca_id) then
    raise exception 'sem acesso a esta barraca';
  end if;
  if p_provedor not in ('mercadopago', 'pagbank', 'asaas', 'woovi', 'abacatepay') then
    raise exception 'provedor de pagamento inválido';
  end if;
  if v_chave is null or length(v_chave) > 140 then
    raise exception 'chave Pix inválida';
  end if;

  -- A chave só existe junto do token do mesmo provedor (a linha nasce em
  -- definir_token_pagamento); sem token, avisa em vez de criar linha incompleta.
  update barracas_pagamento_token
     set chave_pix = v_chave, atualizado_em = now()
   where barraca_id = p_barraca_id and provedor = p_provedor;
  if not found then
    raise exception 'defina primeiro o token deste provedor';
  end if;
end;
$$;

create or replace function public.chave_pix_pagamento_configurada(
  p_barraca_id uuid,
  p_provedor text default 'asaas'
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not usuario_tem_acesso_barraca(p_barraca_id) then
    raise exception 'sem acesso a esta barraca';
  end if;

  return exists (
    select 1 from barracas_pagamento_token
     where barraca_id = p_barraca_id and provedor = p_provedor and chave_pix is not null
  );
end;
$$;
