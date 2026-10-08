-- Perfil do cliente final por loja (spec 2026-10-08). ADITIVA: colunas nullable ou com default,
-- tabelas novas, funções novas. App e functions antigas ignoram tudo isto.

-- 1) Flags por barraca (nascem desligadas).
alter table public.barracas
  add column if not exists perfil_cliente_obrigatorio boolean not null default false,
  add column if not exists codigos_dia_max integer not null default 100;
alter table public.barracas drop constraint if exists barracas_codigos_dia_max_valido;
alter table public.barracas
  add constraint barracas_codigos_dia_max_valido check (codigos_dia_max between 0 and 5000);

-- 2) clientes_finais vira o perfil. Endereço deixa de ser obrigatório (retirada não tem).
alter table public.clientes_finais
  add column if not exists telefone_confirmado_em timestamptz,
  add column if not exists aceita_avisos_pedido boolean not null default true;
alter table public.clientes_finais
  alter column rua drop not null,
  alter column numero drop not null,
  alter column bairro drop not null;

-- 3) Endereços (vários por cliente).
create table if not exists public.cliente_enderecos (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references public.clientes_finais(id) on delete cascade,
  barraca_id uuid not null references public.barracas(id) on delete cascade,
  apelido text not null default 'Casa' check (char_length(apelido) between 1 and 30),
  rua text not null check (char_length(rua) between 1 and 120),
  numero text not null check (char_length(numero) between 1 and 20),
  bairro text not null check (char_length(bairro) between 1 and 80),
  referencia text check (referencia is null or char_length(referencia) <= 120),
  padrao boolean not null default false,
  criado_em timestamptz not null default now()
);
create unique index if not exists cliente_enderecos_um_padrao on public.cliente_enderecos (cliente_id) where padrao;
create index if not exists cliente_enderecos_cliente_idx on public.cliente_enderecos (cliente_id);
alter table public.cliente_enderecos enable row level security;
drop policy if exists "dono ve enderecos dos clientes da barraca" on public.cliente_enderecos;
create policy "dono ve enderecos dos clientes da barraca"
  on public.cliente_enderecos for select to authenticated
  using (usuario_tem_acesso_barraca(barraca_id));

-- Backfill: o endereço único que já existe vira o endereço padrão.
insert into public.cliente_enderecos (cliente_id, barraca_id, apelido, rua, numero, bairro, referencia, padrao)
select c.id, c.barraca_id, 'Casa', c.rua, c.numero, c.bairro, c.referencia, true
  from public.clientes_finais c
 where coalesce(c.rua, '') <> '' and coalesce(c.numero, '') <> '' and coalesce(c.bairro, '') <> ''
   and not exists (select 1 from public.cliente_enderecos e where e.cliente_id = c.id);

-- 4) Códigos de verificação (só hash; sem policy: só service role).
create table if not exists public.cliente_codigos (
  id uuid primary key default gen_random_uuid(),
  barraca_id uuid not null references public.barracas(id) on delete cascade,
  telefone text not null check (telefone ~ '^[0-9]{10,11}$'),
  codigo_hash text not null,
  expira_em timestamptz not null,
  usado_em timestamptz,
  tentativas integer not null default 0,
  ip_hash text,
  criado_em timestamptz not null default now()
);
create index if not exists cliente_codigos_telefone_idx on public.cliente_codigos (barraca_id, telefone, criado_em desc);
create index if not exists cliente_codigos_ip_idx on public.cliente_codigos (ip_hash, criado_em desc);
create index if not exists cliente_codigos_loja_idx on public.cliente_codigos (barraca_id, criado_em desc);
alter table public.cliente_codigos enable row level security;
revoke all on table public.cliente_codigos from anon, authenticated;

-- 5) Sessões do cliente (só hash do token; sem policy).
create table if not exists public.cliente_sessoes (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references public.clientes_finais(id) on delete cascade,
  barraca_id uuid not null references public.barracas(id) on delete cascade,
  token_hash text not null,
  aparelho text check (aparelho is null or char_length(aparelho) <= 80),
  expira_em timestamptz not null,
  ultimo_uso_em timestamptz not null default now(),
  revogada_em timestamptz,
  criado_em timestamptz not null default now()
);
create unique index if not exists cliente_sessoes_token_idx on public.cliente_sessoes (token_hash);
create index if not exists cliente_sessoes_cliente_idx on public.cliente_sessoes (cliente_id);
alter table public.cliente_sessoes enable row level security;
revoke all on table public.cliente_sessoes from anon, authenticated;

-- 6) Vínculo do pedido com o cliente (histórico = consulta por cliente_id).
alter table public.pedidos add column if not exists cliente_id uuid references public.clientes_finais(id) on delete set null;
create index if not exists pedidos_cliente_idx on public.pedidos (cliente_id, criado_em desc) where cliente_id is not null;
alter table public.pagamentos_pendentes add column if not exists cliente_id uuid references public.clientes_finais(id) on delete set null;

-- 7) Criar/atualizar o perfil depois do código certo. Assume o cadastro de entrega que já existe.
create or replace function public.cliente_registrar_verificado(
  p_barraca_id uuid, p_telefone text, p_nome text, p_aceita_promocoes boolean
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  insert into public.clientes_finais
    (barraca_id, nome, telefone, telefone_confirmado_em, consentimento_lgpd_em, consentimento_marketing_em)
  values
    (p_barraca_id, left(trim(p_nome), 80), p_telefone, now(), now(), case when p_aceita_promocoes then now() end)
  on conflict (barraca_id, telefone) do update set
    nome = left(trim(excluded.nome), 80),
    telefone_confirmado_em = now(),
    consentimento_lgpd_em = coalesce(public.clientes_finais.consentimento_lgpd_em, now()),
    consentimento_marketing_em = case
      when p_aceita_promocoes then coalesce(public.clientes_finais.consentimento_marketing_em, now())
      else null end,
    atualizado_em = now()
  returning id into v_id;
  return v_id;
end;
$$;

-- 8) "Apagar meus dados": apaga perfil, endereços, sessões e códigos; anonimiza os pedidos.
create or replace function public.cliente_apagar_dados(p_cliente_id uuid) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_barraca uuid;
  v_telefone text;
begin
  select barraca_id, telefone into v_barraca, v_telefone from public.clientes_finais where id = p_cliente_id;
  if not found then
    return;
  end if;
  update public.pedidos
     set cliente_id = null, cliente_nome = null, cliente_telefone = null,
         entrega_nome = null, entrega_telefone = null, entrega_rua = null,
         entrega_numero = null, entrega_bairro = null, entrega_referencia = null
   where cliente_id = p_cliente_id;
  update public.pagamentos_pendentes set cliente_id = null where cliente_id = p_cliente_id;
  delete from public.cliente_codigos where barraca_id = v_barraca and telefone = v_telefone;
  delete from public.clientes_finais where id = p_cliente_id; -- sessões e endereços saem em cascata
end;
$$;

-- 9) O cardápio descobre se o perfil é obrigatório sem mudar `cardapio_publico`.
create or replace function public.perfil_cliente_config(p_slug text)
returns table (obrigatorio boolean)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select b.perfil_cliente_obrigatorio from public.barracas b where b.slug = p_slug limit 1;
$$;

revoke all on function public.cliente_registrar_verificado(uuid, text, text, boolean) from public, anon, authenticated;
grant execute on function public.cliente_registrar_verificado(uuid, text, text, boolean) to service_role;
revoke all on function public.cliente_apagar_dados(uuid) from public, anon, authenticated;
grant execute on function public.cliente_apagar_dados(uuid) to service_role;
revoke all on function public.perfil_cliente_config(text) from public;
grant execute on function public.perfil_cliente_config(text) to anon, authenticated;
