-- Cobrança do módulo fiscal (NFC-e) por CNPJ: tabela fiscal_assinaturas, flag de contratação e validador de CNPJ.
-- ADITIVA. O acesso ao fiscal continua em modulos_barraca/modulo_ativo (desacoplado do plano); esta tabela só
-- registra a cobrança Stripe (escrita só pelo backend com service_role, que também chama modulos_definir_interno).
--   * Um CNPJ e uma barraca só podem ter UMA cobrança "que ocupa": pendente, active, past_due OU canceled ainda dentro do
--     período já pago (cancel_at_period_end grava canceled, mas o cliente segue pagando até o fim). Os índices únicos
--     parciais cobrem os três primeiros; o canceled vigente depende de now(), que índice não aceita, então um trigger
--     (com advisory lock por cnpj e por barraca) recusa a segunda com unique_violation (23505), igual ao índice.
--     Depois de expired, ou de canceled com o período vencido, dá para contratar de novo.
--   * fiscal_contratacao_aberta() nasce FALSE: enquanto a emissão real não for homologada, nenhuma contratação.
--   * cnpj_valido(text): só a função. NÃO há trigger em barracas.cnpj de propósito: a tela Ajustes aceita qualquer
--     CNPJ de 14 números e um trigger faria o salvamento falhar com erro genérico, além de poder pegar linhas
--     legadas formatadas. A validação no checkout é feita pelo backend (TS) e pode chamar esta função.
-- Rollback: drop table if exists public.fiscal_assinaturas; drop function if exists public.fiscal_assinaturas_unica_viva();
--           drop function if exists public.fiscal_assinatura_ocupa(text, timestamptz); drop function if exists public.fiscal_contratacao_aberta();
--           drop function if exists public.cnpj_valido(text);
--           delete from public.app_config where chave = 'fiscal_contratacao_aberta';

create table if not exists public.fiscal_assinaturas (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references auth.users(id) on delete cascade,
  barraca_id uuid not null references public.barracas(id) on delete cascade,
  cnpj text not null check (cnpj ~ '^[0-9]{14}$'),
  status text not null check (status in ('pendente', 'active', 'past_due', 'canceled', 'expired')),
  stripe_customer_id text,
  stripe_subscription_id text unique,
  stripe_checkout_session_id text unique,
  current_period_end timestamptz,
  grace_until timestamptz,
  canceled_at timestamptz,
  stripe_evento_em timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists fiscal_assinaturas_cnpj_viva
  on public.fiscal_assinaturas (cnpj) where status in ('pendente', 'active', 'past_due');
create unique index if not exists fiscal_assinaturas_barraca_viva
  on public.fiscal_assinaturas (barraca_id) where status in ('pendente', 'active', 'past_due');
-- "Ocupa" o CNPJ/barraca: status vivo, ou cancelada dentro do período pago.
create or replace function public.fiscal_assinatura_ocupa(p_status text, p_fim timestamptz)
returns boolean
language sql
stable
set search_path = public, pg_temp
as $$
  select p_status in ('pendente', 'active', 'past_due')
      or (p_status = 'canceled' and p_fim is not null and p_fim > now());
$$;

create or replace function public.fiscal_assinaturas_unica_viva()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if not public.fiscal_assinatura_ocupa(new.status, new.current_period_end) then
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtext('fiscal_cnpj:' || new.cnpj));
  perform pg_advisory_xact_lock(hashtext('fiscal_barraca:' || new.barraca_id::text));
  if exists (
    select 1 from public.fiscal_assinaturas o
     where o.id <> new.id
       and (o.cnpj = new.cnpj or o.barraca_id = new.barraca_id)
       and public.fiscal_assinatura_ocupa(o.status, o.current_period_end)
  ) then
    raise exception 'fiscal_assinatura_viva: já existe assinatura fiscal vigente para este CNPJ ou barraca'
      using errcode = '23505';
  end if;
  return new;
end;
$$;

drop trigger if exists fiscal_assinaturas_unica_viva on public.fiscal_assinaturas;
create trigger fiscal_assinaturas_unica_viva
  before insert or update of status, cnpj, barraca_id, current_period_end on public.fiscal_assinaturas
  for each row execute function public.fiscal_assinaturas_unica_viva();

create index if not exists fiscal_assinaturas_usuario_idx on public.fiscal_assinaturas (usuario_id);

alter table public.fiscal_assinaturas enable row level security;
revoke all on table public.fiscal_assinaturas from public, anon, authenticated;
grant select on table public.fiscal_assinaturas to authenticated;
drop policy if exists fiscal_assinaturas_select on public.fiscal_assinaturas;
create policy fiscal_assinaturas_select on public.fiscal_assinaturas
  for select to authenticated using (usuario_id = auth.uid());
-- sem policy de escrita: só o service_role (backend) grava.

-- Flag de contratação. Falha segura: só o valor JSON true abre; linha ausente ou qualquer outro valor = fechado.
insert into public.app_config (chave, valor)
values ('fiscal_contratacao_aberta', 'false'::jsonb)
on conflict (chave) do nothing;

create or replace function public.fiscal_contratacao_aberta()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((select valor = 'true'::jsonb from public.app_config where chave = 'fiscal_contratacao_aberta'), false);
$$;
revoke all on function public.fiscal_contratacao_aberta() from public;
grant execute on function public.fiscal_contratacao_aberta() to anon, authenticated;

-- CNPJ com dígitos verificadores válidos. Aceita formatado (só compara os dígitos; nunca reescreve dados).
-- Mesma regra de cnpjValido em src/lib/onboardingConfig.ts: 14 dígitos, não todos iguais.
create or replace function public.cnpj_valido(p_cnpj text)
returns boolean
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  d text := regexp_replace(coalesce(p_cnpj, ''), '\D', '', 'g');
  pesos1 int[] := array[5,4,3,2,9,8,7,6,5,4,3,2];
  pesos2 int[] := array[6,5,4,3,2,9,8,7,6,5,4,3,2];
  soma int;
  r int;
  d1 int;
  d2 int;
begin
  if length(d) <> 14 or d ~ '^(.)\1+$' then
    return false;
  end if;
  soma := 0;
  for i in 1..12 loop
    soma := soma + substr(d, i, 1)::int * pesos1[i];
  end loop;
  r := soma % 11;
  d1 := case when r < 2 then 0 else 11 - r end;
  soma := 0;
  for i in 1..13 loop
    soma := soma + substr(substr(d, 1, 12) || d1::text, i, 1)::int * pesos2[i];
  end loop;
  r := soma % 11;
  d2 := case when r < 2 then 0 else 11 - r end;
  return d1 = substr(d, 13, 1)::int and d2 = substr(d, 14, 1)::int;
end;
$$;
revoke all on function public.cnpj_valido(text) from public;
grant execute on function public.cnpj_valido(text) to anon, authenticated;
