-- Tokens das lojas cifrados em repouso (plano docs/superpowers/plans/2026-10-12-criptografar-tokens-em-repouso.md),
-- FASE 1: só colunas novas e "configurado" olhando as duas formas. ADITIVA: nada é apagado nem reescrito, e sem as
-- colunas preenchidas o comportamento é o de hoje. O texto antigo continua onde está (a remoção é a Fase 3, outra migration).
--
-- Formato do valor cifrado: v<versão>.<iv>.<cifrado> (AES-256-GCM, feito pelas Edge Functions; a chave NUNCA fica no banco).
-- `cifrado_em` / `cifrado_chave`: metadados para o backfill e a rotação (qual versão de chave cifrou a linha).

alter table public.barracas_fiscal_token
  add column if not exists token_homologacao_cifrado text,
  add column if not exists token_producao_cifrado text,
  add column if not exists cifrado_em timestamptz,
  add column if not exists cifrado_chave text;

alter table public.barracas_pagamento_token
  add column if not exists access_token_cifrado text,
  add column if not exists segredo_webhook_cifrado text,
  add column if not exists cifrado_em timestamptz,
  add column if not exists cifrado_chave text;

-- A partir da Fase 2 o token pode existir só cifrado: o texto precisa aceitar NULL (no-op se já aceita).
alter table public.barracas_fiscal_token alter column token_homologacao drop not null;
alter table public.barracas_pagamento_token alter column access_token drop not null;

-- "Configurado" = existe em texto OU cifrado. Mesmas assinaturas e permissões (create or replace preserva os grants).
create or replace function token_fiscal_configurado(p_barraca_id uuid)
returns table (homologacao boolean, producao boolean)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not usuario_tem_acesso_barraca(p_barraca_id) then
    raise exception 'sem acesso a esta barraca';
  end if;

  return query
    select
      coalesce((select token_homologacao is not null or token_homologacao_cifrado is not null
                  from barracas_fiscal_token where barraca_id = p_barraca_id), false),
      coalesce((select token_producao is not null or token_producao_cifrado is not null
                  from barracas_fiscal_token where barraca_id = p_barraca_id), false);
end;
$$;

create or replace function public.token_pagamento_configurado(
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
       and (access_token is not null or access_token_cifrado is not null)
  );
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
       and (segredo_webhook is not null or segredo_webhook_cifrado is not null)
  );
end;
$$;
