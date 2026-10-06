-- Consentimento de contato comercial (WhatsApp) do cliente de entrega, SEPARADO
-- do consentimento de cadastro (consentimento_lgpd_em, que cobre só a entrega).
-- NULL = não informado (cadastros antigos e os feitos pelo operador).
-- Aditiva: o app e as functions antigas ignoram a coluna.
alter table public.clientes_finais
  add column if not exists consentimento_marketing_em timestamptz;
