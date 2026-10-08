-- Segredo de assinatura do webhook (x-signature) guardado junto do token da barraca.
-- OPCIONAL: sem segredo o webhook segue só com a consulta de volta ao provedor
-- (como hoje). Com segredo, notificação com assinatura presente e inválida é
-- rejeitada (401).
--
-- ADITIVA: coluna nullable + duas RPCs novas. Mesmo padrão do token: SECURITY
-- DEFINER, exige acesso à barraca, o valor nunca volta para o client (a tabela
-- não tem policy de select).

alter table public.barracas_pagamento_token
  add column if not exists segredo_webhook text;

create or replace function public.definir_segredo_webhook_pagamento(
  p_barraca_id uuid,
  p_segredo text,
  p_provedor text default 'mercadopago'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not usuario_tem_acesso_barraca(p_barraca_id) then
    raise exception 'sem acesso a esta barraca';
  end if;
  if p_provedor not in ('mercadopago', 'pagbank', 'asaas', 'woovi', 'abacatepay') then
    raise exception 'provedor de pagamento inválido';
  end if;

  update barracas_pagamento_token
     set segredo_webhook = nullif(trim(p_segredo), ''),
         atualizado_em = now()
   where barraca_id = p_barraca_id and provedor = p_provedor;

  if not found then
    raise exception 'defina o token do provedor antes do segredo';
  end if;
end;
$$;

create or replace function public.segredo_webhook_configurado(
  p_barraca_id uuid,
  p_provedor text default 'mercadopago'
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
     where barraca_id = p_barraca_id and provedor = p_provedor
       and segredo_webhook is not null
  );
end;
$$;

revoke all on function public.definir_segredo_webhook_pagamento(uuid, text, text) from public, anon;
revoke all on function public.segredo_webhook_configurado(uuid, text) from public, anon;
grant execute on function public.definir_segredo_webhook_pagamento(uuid, text, text) to authenticated;
grant execute on function public.segredo_webhook_configurado(uuid, text) to authenticated;
