-- Correções da revisão do perfil do cliente final (PR #71). ADITIVA e idempotente: só `create or replace`
-- e colunas/tabelas novas; roda por cima da 20261017100000 (já aplicada no staging).
--
--  B1  tentativa de código ATÔMICA (cliente_tentar_codigo) + log de verificações (limite por telefone/IP)
--  I1  "apagar meus dados" apaga PII também em pagamentos_pendentes e nos pedidos da mesma loja+telefone
--  I2  limites de pedir código atômicos (cliente_reservar_codigo, sob lock) e IP também global
--  I3  falha de envio ao CRM não apaga a linha: `falhou_em` (continua contando nos limites)
--  S2  promoções só mudam quando informadas explicitamente (p_aceita_promocoes null = não mexe)
--  S3  endereços: novo/padrão/excluir transacionais

alter table public.cliente_codigos
  add column if not exists ip_hash_global text,
  add column if not exists falhou_em timestamptz;
create index if not exists cliente_codigos_ip_global_idx on public.cliente_codigos (ip_hash_global, criado_em desc);

-- Log das tentativas de verificar (um registro por chamada). Sem policy: só service role.
create table if not exists public.cliente_verificacoes_log (
  id bigint generated always as identity primary key,
  barraca_id uuid not null references public.barracas(id) on delete cascade,
  telefone text not null,
  ip_hash text,
  criado_em timestamptz not null default now()
);
create index if not exists cliente_verificacoes_tel_idx on public.cliente_verificacoes_log (barraca_id, telefone, criado_em desc);
create index if not exists cliente_verificacoes_ip_idx on public.cliente_verificacoes_log (ip_hash, criado_em desc);
alter table public.cliente_verificacoes_log enable row level security;
revoke all on table public.cliente_verificacoes_log from anon, authenticated;

-- B1) Conta a tentativa ANTES de comparar o código. Uma só instrução: rajada paralela não burla o limite
-- de 5 (o UPDATE trava a linha). Sem linha devolvida => código inexistente, já usado ou esgotado.
create or replace function public.cliente_tentar_codigo(p_id uuid)
returns table (tentativas integer, codigo_hash text, expira_em timestamptz)
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.cliente_codigos c
     set tentativas = c.tentativas + 1
   where c.id = p_id and c.usado_em is null and c.tentativas < 5
  returning c.tentativas, c.codigo_hash, c.expira_em;
$$;

-- I2/I3) Reserva do código: conta e insere sob lock por (loja, telefone). Devolve a decisão.
-- Linhas com `falhou_em` continuam contando (quem força falha de envio também gasta o limite).
-- Limites: reenvio 60 s; 3/telefone/h; 10/IP/h por loja; 30/IP/h global; teto diário da loja.
create or replace function public.cliente_reservar_codigo(
  p_barraca_id uuid, p_telefone text, p_codigo_hash text, p_expira_em timestamptz,
  p_ip_hash text, p_ip_hash_global text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_teto integer;
  v_id uuid;
  v_ultimo timestamptz;
  v_tel integer;
  v_ip integer;
  v_ipg integer;
  v_loja integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_barraca_id::text || ':' || p_telefone, 0));

  select codigos_dia_max into v_teto from public.barracas where id = p_barraca_id;
  if v_teto is null then
    return jsonb_build_object('decisao', 'loja_inexistente');
  end if;

  select max(criado_em) into v_ultimo from public.cliente_codigos where barraca_id = p_barraca_id and telefone = p_telefone;
  select count(*) into v_tel from public.cliente_codigos where barraca_id = p_barraca_id and telefone = p_telefone and criado_em >= now() - interval '1 hour';
  select count(*) into v_ip from public.cliente_codigos where barraca_id = p_barraca_id and ip_hash = p_ip_hash and criado_em >= now() - interval '1 hour';
  select count(*) into v_ipg from public.cliente_codigos where ip_hash_global = p_ip_hash_global and criado_em >= now() - interval '1 hour';
  select count(*) into v_loja from public.cliente_codigos where barraca_id = p_barraca_id and criado_em >= now() - interval '24 hours';

  if v_teto <= 0 or v_loja >= v_teto then
    return jsonb_build_object('decisao', 'limite_loja', 'enviosLoja24h', v_loja);
  end if;
  if v_ultimo is not null and v_ultimo > now() - interval '60 seconds' then
    return jsonb_build_object('decisao', 'muito_cedo');
  end if;
  if v_tel >= 3 then
    return jsonb_build_object('decisao', 'limite_telefone');
  end if;
  if v_ip >= 10 or v_ipg >= 30 then
    return jsonb_build_object('decisao', 'limite_ip');
  end if;

  insert into public.cliente_codigos (barraca_id, telefone, codigo_hash, expira_em, ip_hash, ip_hash_global)
  values (p_barraca_id, p_telefone, p_codigo_hash, p_expira_em, p_ip_hash, p_ip_hash_global)
  returning id into v_id;
  return jsonb_build_object('decisao', 'ok', 'id', v_id);
end;
$$;

-- I1) Apagar de verdade: perfil, endereços, sessões, códigos E a PII em pedidos/cobranças da mesma
-- loja+telefone (mantém valor, itens e datas, que a loja precisa para contabilidade/nota fiscal).
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
   where cliente_id = p_cliente_id
      or (barraca_id = v_barraca and (cliente_telefone = v_telefone or entrega_telefone = v_telefone));

  update public.pagamentos_pendentes
     set cliente_id = null, cliente_nome = null, cliente_telefone = null, entrega = null
   where cliente_id = p_cliente_id
      or (barraca_id = v_barraca and (cliente_telefone = v_telefone or entrega ->> 'telefone' = v_telefone));

  delete from public.cliente_codigos where barraca_id = v_barraca and telefone = v_telefone;
  delete from public.cliente_verificacoes_log where barraca_id = v_barraca and telefone = v_telefone;
  delete from public.clientes_finais where id = p_cliente_id; -- sessões e endereços saem em cascata
end;
$$;

-- S2) p_aceita_promocoes null = não mexe no consentimento de promoções.
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
    (p_barraca_id, left(trim(p_nome), 80), p_telefone, now(), now(), case when p_aceita_promocoes is true then now() end)
  on conflict (barraca_id, telefone) do update set
    nome = left(trim(excluded.nome), 80),
    telefone_confirmado_em = now(),
    consentimento_lgpd_em = coalesce(public.clientes_finais.consentimento_lgpd_em, now()),
    consentimento_marketing_em = case
      when p_aceita_promocoes is null then public.clientes_finais.consentimento_marketing_em
      when p_aceita_promocoes then coalesce(public.clientes_finais.consentimento_marketing_em, now())
      else null end,
    atualizado_em = now()
  returning id into v_id;
  return v_id;
end;
$$;

-- S3) Endereços transacionais (trava a linha do cliente: dois cliques não passam do máximo nem
-- deixam dois padrões).
create or replace function public.cliente_endereco_novo(
  p_cliente_id uuid, p_apelido text, p_rua text, p_numero text, p_bairro text, p_referencia text, p_max integer
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_barraca uuid;
  v_qtd integer;
  v_id uuid;
begin
  select barraca_id into v_barraca from public.clientes_finais where id = p_cliente_id for update;
  if not found then
    raise exception 'cliente_inexistente';
  end if;
  select count(*) into v_qtd from public.cliente_enderecos where cliente_id = p_cliente_id;
  if v_qtd >= p_max then
    raise exception 'limite_enderecos';
  end if;
  insert into public.cliente_enderecos (cliente_id, barraca_id, apelido, rua, numero, bairro, referencia, padrao)
  values (p_cliente_id, v_barraca, p_apelido, p_rua, p_numero, p_bairro, p_referencia, v_qtd = 0)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.cliente_endereco_padrao(p_cliente_id uuid, p_endereco_id uuid) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform 1 from public.clientes_finais where id = p_cliente_id for update;
  if not exists (select 1 from public.cliente_enderecos where id = p_endereco_id and cliente_id = p_cliente_id) then
    return false;
  end if;
  update public.cliente_enderecos set padrao = false where cliente_id = p_cliente_id and padrao;
  update public.cliente_enderecos set padrao = true where id = p_endereco_id;
  return true;
end;
$$;

-- Ao excluir o padrão, o endereço mais antigo que sobrar vira o padrão.
create or replace function public.cliente_endereco_excluir(p_cliente_id uuid, p_endereco_id uuid) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_era_padrao boolean;
begin
  perform 1 from public.clientes_finais where id = p_cliente_id for update;
  delete from public.cliente_enderecos where id = p_endereco_id and cliente_id = p_cliente_id returning padrao into v_era_padrao;
  if coalesce(v_era_padrao, false) then
    update public.cliente_enderecos set padrao = true
     where id = (select id from public.cliente_enderecos where cliente_id = p_cliente_id order by criado_em limit 1);
  end if;
end;
$$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'cliente_tentar_codigo(uuid)',
    'cliente_reservar_codigo(uuid, text, text, timestamptz, text, text)',
    'cliente_endereco_novo(uuid, text, text, text, text, text, integer)',
    'cliente_endereco_padrao(uuid, uuid)',
    'cliente_endereco_excluir(uuid, uuid)'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end;
$$;
