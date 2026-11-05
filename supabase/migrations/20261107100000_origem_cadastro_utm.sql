-- Origem do cadastro (UTM) para medir anúncios. Aditiva: não muda nada que já existe.
--
-- O site saiae.com.br manda o visitante para o app com utm_source/medium/campaign/content/term na URL; o app guarda
-- em localStorage (90 dias) e, na primeira sessão logada, chama registrar_origem_cadastro. A conta vive em
-- public.assinaturas (1 linha por usuário, criada pela trigger de trial no cadastro), então as colunas ficam ali.
--
-- Grava UMA vez (primeira origem vence): se cadastro_origem_em já existe, não sobrescreve. Cadastro sem UTM continua
-- igual (o app nem chama a função). O app tolera a migration ainda não aplicada (função inexistente = ignora).
-- Rollback: drop function public.registrar_origem_cadastro(text, text, text, text, text);
--           alter table public.assinaturas drop column utm_source, ... , drop column cadastro_origem_em;

alter table public.assinaturas
  add column if not exists utm_source text,
  add column if not exists utm_medium text,
  add column if not exists utm_campaign text,
  add column if not exists utm_content text,
  add column if not exists utm_term text,
  add column if not exists cadastro_origem_em timestamptz;

create or replace function public.registrar_origem_cadastro(
  p_utm_source text default null,
  p_utm_medium text default null,
  p_utm_campaign text default null,
  p_utm_content text default null,
  p_utm_term text default null
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_linhas integer;
begin
  if auth.uid() is null then
    return false;
  end if;

  -- Nada de UTM: não há origem a registrar.
  if coalesce(nullif(btrim(p_utm_source), ''), nullif(btrim(p_utm_medium), ''), nullif(btrim(p_utm_campaign), ''),
              nullif(btrim(p_utm_content), ''), nullif(btrim(p_utm_term), '')) is null then
    return false;
  end if;

  update public.assinaturas
     set utm_source = left(nullif(btrim(p_utm_source), ''), 200),
         utm_medium = left(nullif(btrim(p_utm_medium), ''), 200),
         utm_campaign = left(nullif(btrim(p_utm_campaign), ''), 200),
         utm_content = left(nullif(btrim(p_utm_content), ''), 200),
         utm_term = left(nullif(btrim(p_utm_term), ''), 200),
         cadastro_origem_em = now()
   where usuario_id = auth.uid()
     and cadastro_origem_em is null;
  get diagnostics v_linhas = row_count;
  return v_linhas > 0;
end;
$$;

revoke all on function public.registrar_origem_cadastro(text, text, text, text, text) from public, anon;
grant execute on function public.registrar_origem_cadastro(text, text, text, text, text) to authenticated;
