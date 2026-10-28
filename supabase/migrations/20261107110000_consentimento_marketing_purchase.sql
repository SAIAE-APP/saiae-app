-- Purchase pelo servidor (Meta Conversions API + GA4 Measurement Protocol): só para quem consentiu.
-- Aditiva. O app grava o consentimento ('sx_consent' = 'granted') e os identificadores de navegador (_fbp, _fbc, _ga)
-- no login; o webhook da Stripe só envia a compra se consentimento_marketing = true. Sem consentimento, nada sai.
-- purchase_enviado_em é a trava de "só a PRIMEIRA cobrança paga": o webhook a preenche antes de enviar (renovação e
-- reentrega de webhook não repetem). Nenhum e-mail/telefone é guardado aqui (o e-mail vai em hash SHA-256 na hora do envio).
-- O app tolera a migration ainda não aplicada (função inexistente = ignora).
-- Rollback: drop function public.registrar_consentimento_marketing(boolean, text, text, text);
--           alter table public.assinaturas drop column consentimento_marketing, ... (as 6 colunas abaixo).

alter table public.assinaturas
  add column if not exists consentimento_marketing boolean not null default false,
  add column if not exists consentimento_marketing_em timestamptz,
  add column if not exists fbp text,
  add column if not exists fbc text,
  add column if not exists ga_client_id text,
  add column if not exists purchase_enviado_em timestamptz;

create or replace function public.registrar_consentimento_marketing(
  p_consentimento boolean,
  p_fbp text default null,
  p_fbc text default null,
  p_ga_client_id text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    return;
  end if;

  -- Sem consentimento: grava false e APAGA os identificadores (o aceite pode ser retirado a qualquer momento).
  update public.assinaturas
     set consentimento_marketing = coalesce(p_consentimento, false),
         consentimento_marketing_em = now(),
         fbp = case when p_consentimento then left(nullif(btrim(p_fbp), ''), 200) end,
         fbc = case when p_consentimento then left(nullif(btrim(p_fbc), ''), 300) end,
         ga_client_id = case when p_consentimento then left(nullif(btrim(p_ga_client_id), ''), 100) end
   where usuario_id = auth.uid();
end;
$$;

revoke all on function public.registrar_consentimento_marketing(boolean, text, text, text) from public, anon;
grant execute on function public.registrar_consentimento_marketing(boolean, text, text, text) to authenticated;
