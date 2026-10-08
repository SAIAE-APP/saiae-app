-- SAI-013 (lado Comanda): outbox de eventos para o CRM (contrato v1, INTEGRACAO.md §2).
--
-- Pedido criado / mudou de status / foi pago => uma linha em `eventos_saida`. Um worker (edge
-- function `enviar-eventos-saida`, acionada por pg_cron) assina com HMAC e envia ao CRM da barraca,
-- com retry 1 min, 5 min, 30 min, 2 h, 12 h e `sequence` crescente por pedido.
--
-- REGRA DE OURO: nada aqui pode travar ou atrasar um pedido. Todo ponto de emissão tem
-- `exception when others` (vira WARNING), o envio roda fora da transação do pedido e, sem
-- integração ativa na barraca, nada é gravado (zero custo para quem não usa).
--
-- ADITIVA: tabelas e funções novas + 4 triggers (pedidos x3, pagamentos_pendentes x1). Nenhuma
-- função existente é alterada. Rollback: drop dos triggers, das funções e das duas tabelas.
--
-- Depende de 20261015100000 (itens_do_pedido.opcoes). Quem aplica: Supabase do ambiente (staging
-- antes de produção); depois, `enviar-eventos-saida` publicada e as chaves de app_config
-- (`eventos_worker_url`, `eventos_worker_secret`) preenchidas — sem elas o cron não faz nada.

-- 1) Configuração por barraca. Sem policy: ninguém lê nem escreve pela API (o segredo nunca
-- sai do banco); o acesso é só pelas RPCs integracao_crm_* e pelo worker (service role).
create table if not exists public.integracao_crm (
  barraca_id uuid primary key references public.barracas(id) on delete cascade,
  url text,
  segredo text,
  ativo boolean not null default false,
  atualizado_em timestamptz not null default now(),
  constraint integracao_crm_url_https check (url is null or url ~ '^https://[^[:space:]]+$')
);
alter table public.integracao_crm enable row level security;

-- 2) Outbox.
create table if not exists public.eventos_saida (
  id uuid primary key default gen_random_uuid(),
  barraca_id uuid not null references public.barracas(id) on delete cascade,
  pedido_id uuid not null references public.pedidos(id) on delete cascade,
  tipo text not null check (tipo in ('order.created', 'order.paid', 'order.status_changed', 'order.ready', 'order.cancelled')),
  sequence integer not null check (sequence >= 1),
  -- Status do pedido NA HORA do evento (o worker monta o resto com o estado atual).
  status_pedido text not null,
  ocorrido_em timestamptz not null default now(),
  estado text not null default 'pendente' check (estado in ('pendente', 'enviado', 'falhou')),
  tentativas integer not null default 0,
  proxima_tentativa_em timestamptz not null default now(),
  ultimo_erro text,
  enviado_em timestamptz,
  constraint eventos_saida_pedido_sequence_unico unique (pedido_id, sequence)
);
alter table public.eventos_saida enable row level security;

create index if not exists eventos_saida_fila_idx
  on public.eventos_saida (proxima_tentativa_em) where estado = 'pendente';
create index if not exists eventos_saida_barraca_estado_idx
  on public.eventos_saida (barraca_id, estado);

-- 3) Emissão. Número de sequência por pedido sob lock consultivo (dois eventos do mesmo pedido na
-- mesma hora não repetem número).
create or replace function public._emitir_evento_saida(p_pedido_id uuid, p_tipo text, p_status text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_barraca uuid;
  v_seq integer;
begin
  select barraca_id into v_barraca from public.pedidos where id = p_pedido_id;
  if v_barraca is null then
    return;
  end if;
  if not exists (
    select 1 from public.integracao_crm
     where barraca_id = v_barraca and ativo and url is not null and segredo is not null
  ) then
    return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_pedido_id::text, 0));
  select coalesce(max(sequence), 0) + 1 into v_seq from public.eventos_saida where pedido_id = p_pedido_id;

  insert into public.eventos_saida (barraca_id, pedido_id, tipo, sequence, status_pedido)
  values (v_barraca, p_pedido_id, p_tipo, v_seq, p_status);
exception when others then
  -- Nunca derruba o pedido por causa da integração.
  raise warning 'evento de saída não gravado (% / %): %', p_tipo, p_pedido_id, sqlerrm;
end;
$$;

revoke all on function public._emitir_evento_saida(uuid, text, text) from public, anon, authenticated;

-- 3a) Pedido criado.
create or replace function public.trg_pedido_evento_criado()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public._emitir_evento_saida(new.id, 'order.created', new.status::text);
  return null;
exception when others then
  raise warning 'trg_pedido_evento_criado: %', sqlerrm;
  return null;
end;
$$;

drop trigger if exists pedidos_evento_criado on public.pedidos;
create trigger pedidos_evento_criado
  after insert on public.pedidos
  for each row execute function public.trg_pedido_evento_criado();

-- 3b) Mudança de status. `OF status` + `WHEN`: cliente_avisado_em e demais colunas não geram evento.
create or replace function public.trg_pedido_evento_status()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public._emitir_evento_saida(new.id, 'order.status_changed', new.status::text);
  if new.status = 'pronto' then
    perform public._emitir_evento_saida(new.id, 'order.ready', new.status::text);
  elsif new.status = 'cancelado' then
    perform public._emitir_evento_saida(new.id, 'order.cancelled', new.status::text);
  end if;
  return null;
exception when others then
  raise warning 'trg_pedido_evento_status: %', sqlerrm;
  return null;
end;
$$;

drop trigger if exists pedidos_evento_status on public.pedidos;
create trigger pedidos_evento_status
  after update of status on public.pedidos
  for each row
  when (old.status is distinct from new.status)
  execute function public.trg_pedido_evento_status();

-- 3c) Método definido depois (pedido "a definir na entrega": entregador_confirmar ou operador).
create or replace function public.trg_pedido_evento_pago_na_entrega()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public._emitir_evento_saida(new.id, 'order.paid', new.status::text);
  return null;
exception when others then
  raise warning 'trg_pedido_evento_pago_na_entrega: %', sqlerrm;
  return null;
end;
$$;

drop trigger if exists pedidos_evento_pago_na_entrega on public.pedidos;
create trigger pedidos_evento_pago_na_entrega
  after update of metodo_pagamento on public.pedidos
  for each row
  when (old.metodo_pagamento = 'na_entrega'
        and new.metodo_pagamento is not null
        and new.metodo_pagamento <> 'na_entrega')
  execute function public.trg_pedido_evento_pago_na_entrega();

-- 3d) Pix aprovado: o webhook liga a cobrança ao pedido criado (pedido_id deixa de ser nulo).
create or replace function public.trg_pendente_evento_pago()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_status text;
begin
  select status into v_status from public.pedidos where id = new.pedido_id;
  if v_status is not null then
    perform public._emitir_evento_saida(new.pedido_id, 'order.paid', v_status);
  end if;
  return null;
exception when others then
  raise warning 'trg_pendente_evento_pago: %', sqlerrm;
  return null;
end;
$$;

drop trigger if exists pagamentos_pendentes_evento_pago on public.pagamentos_pendentes;
create trigger pagamentos_pendentes_evento_pago
  after update of pedido_id on public.pagamentos_pendentes
  for each row
  when (old.pedido_id is null and new.pedido_id is not null)
  execute function public.trg_pendente_evento_pago();

-- 4) Monta o envelope v1 completo de um evento (docs/contrato/v1/evento.schema.json).
-- `data.status` é o status NA HORA do evento; itens, total e cliente são o estado atual do pedido
-- (os itens entram depois do INSERT do pedido, por isso não vão no trigger).
create or replace function public.montar_evento_saida(p_evento_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  e public.eventos_saida%rowtype;
  p public.pedidos%rowtype;
  v_itens jsonb;
  v_soma bigint;
  v_taxa integer;
  v_tel text;
  v_nome text;
  v_consente boolean;
  v_cliente jsonb;
begin
  select * into e from public.eventos_saida where id = p_evento_id;
  if not found then
    return null;
  end if;
  select * into p from public.pedidos where id = e.pedido_id;
  if not found then
    return null;
  end if;

  select
    coalesce(jsonb_agg(
      jsonb_strip_nulls(jsonb_build_object(
        'nome', i.nome_item,
        'quantidade', i.quantidade,
        'preco_centavos', i.preco_centavos_unitario,
        'observacao', i.observacao,
        'opcoes', case when jsonb_typeof(i.opcoes) = 'array' and jsonb_array_length(i.opcoes) > 0 then i.opcoes else null end
      )) order by i.id
    ), '[]'::jsonb),
    coalesce(sum(i.quantidade::bigint * i.preco_centavos_unitario), 0)
  into v_itens, v_soma
  from public.itens_do_pedido i
  where i.pedido_id = p.id and not i.removido;

  v_taxa := coalesce(p.taxa_entrega_centavos, 0);
  v_nome := nullif(btrim(coalesce(p.cliente_nome, p.entrega_nome, '')), '');
  v_tel := coalesce(p.cliente_telefone, p.entrega_telefone);
  if v_tel is not null and v_tel !~ '^[0-9]{8,15}$' then
    v_tel := null;
  end if;

  v_consente := false;
  if v_tel is not null then
    select exists (
      select 1 from public.clientes_finais c
       where c.barraca_id = p.barraca_id and c.telefone = v_tel and c.consentimento_marketing_em is not null
    ) into v_consente;
  end if;

  v_cliente := jsonb_strip_nulls(jsonb_build_object(
    'nome', v_nome,
    'telefone', v_tel,
    'consentimento_contato', v_consente
  ));

  return jsonb_build_object(
    'id', e.id,
    'type', e.tipo,
    'version', 1,
    'occurred_at', to_char(e.ocorrido_em at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'barraca_id', e.barraca_id,
    'sequence', e.sequence,
    'data', jsonb_strip_nulls(jsonb_build_object(
      'pedido_id', p.id,
      'senha', p.senha,
      'status', e.status_pedido,
      'tipo_atendimento', coalesce(
        p.tipo_atendimento,
        case when p.viagem then 'retirada' when coalesce(p.mesa, '') <> '' then 'mesa' else 'balcao' end
      ),
      'itens', v_itens,
      'taxa_entrega_centavos', v_taxa,
      'total_centavos', v_soma + v_taxa,
      'metodo_pagamento', p.metodo_pagamento,
      'cliente', case when v_cliente = '{}'::jsonb then null else v_cliente end
    ))
  );
end;
$$;

revoke all on function public.montar_evento_saida(uuid) from public, anon, authenticated;

-- 5) API do worker (somente service role).
-- Pega eventos devidos, em ordem por pedido (um evento só sai depois que os anteriores do mesmo
-- pedido foram enviados ou deram falha definitiva), e "aluga" por 3 min: se o worker morrer, o
-- evento volta sozinho. Conta a tentativa na hora de pegar.
create or replace function public.reservar_eventos_saida(p_limite integer default 20)
returns table (evento_id uuid, url text, segredo text, corpo jsonb)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  return query
  with candidatos as (
    select e.id
      from public.eventos_saida e
      join public.integracao_crm c
        on c.barraca_id = e.barraca_id and c.ativo and c.url is not null and c.segredo is not null
     where e.estado = 'pendente'
       and e.proxima_tentativa_em <= now()
       and not exists (
         select 1 from public.eventos_saida a
          where a.pedido_id = e.pedido_id and a.sequence < e.sequence and a.estado = 'pendente'
       )
     order by e.proxima_tentativa_em, e.sequence
     limit greatest(1, least(coalesce(p_limite, 20), 100))
       for update of e skip locked
  ),
  alugados as (
    update public.eventos_saida e
       set tentativas = e.tentativas + 1,
           proxima_tentativa_em = now() + interval '3 minutes'
      from candidatos k
     where e.id = k.id
    returning e.id, e.barraca_id
  )
  select a.id, c.url, c.segredo, public.montar_evento_saida(a.id)
    from alugados a
    join public.integracao_crm c on c.barraca_id = a.barraca_id;
end;
$$;

-- Resultado do envio. Falha agenda o próximo retry (1 min, 5 min, 30 min, 2 h, 12 h); depois da
-- 6ª tentativa o evento vai para a fila de falhas (visível em Ajustes, com "Reenviar").
create or replace function public.concluir_evento_saida(p_evento_id uuid, p_ok boolean, p_erro text default null)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tentativas integer;
  v_atrasos interval[] := array[
    interval '1 minute', interval '5 minutes', interval '30 minutes', interval '2 hours', interval '12 hours'
  ];
begin
  select tentativas into v_tentativas from public.eventos_saida where id = p_evento_id and estado = 'pendente';
  if not found then
    return;
  end if;

  if p_ok then
    update public.eventos_saida
       set estado = 'enviado', enviado_em = now(), ultimo_erro = null
     where id = p_evento_id;
  elsif v_tentativas > array_length(v_atrasos, 1) then
    update public.eventos_saida
       set estado = 'falhou', ultimo_erro = left(coalesce(p_erro, 'erro'), 300)
     where id = p_evento_id;
  else
    update public.eventos_saida
       set proxima_tentativa_em = now() + v_atrasos[greatest(v_tentativas, 1)],
           ultimo_erro = left(coalesce(p_erro, 'erro'), 300)
     where id = p_evento_id;
  end if;
end;
$$;

revoke all on function public.reservar_eventos_saida(integer) from public, anon, authenticated;
revoke all on function public.concluir_evento_saida(uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.reservar_eventos_saida(integer) to service_role;
grant execute on function public.concluir_evento_saida(uuid, boolean, text) to service_role;

-- 6) RPCs de Ajustes (dono/funcionário da barraca). O segredo só aparece uma vez, ao gerar.
create or replace function public.integracao_crm_estado(p_barraca_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  c public.integracao_crm%rowtype;
begin
  if not usuario_tem_acesso_barraca(p_barraca_id) then
    raise exception 'sem acesso a esta barraca';
  end if;
  select * into c from public.integracao_crm where barraca_id = p_barraca_id;
  return jsonb_build_object(
    'url', c.url,
    'ativo', coalesce(c.ativo, false),
    'segredo_configurado', c.segredo is not null,
    'pendentes', (select count(*) from public.eventos_saida where barraca_id = p_barraca_id and estado = 'pendente'),
    'falhos', (select count(*) from public.eventos_saida where barraca_id = p_barraca_id and estado = 'falhou'),
    'ultimo_erro', (select ultimo_erro from public.eventos_saida
                     where barraca_id = p_barraca_id and ultimo_erro is not null
                     order by ocorrido_em desc limit 1),
    'ultimo_envio_em', (select max(enviado_em) from public.eventos_saida where barraca_id = p_barraca_id)
  );
end;
$$;

create or replace function public.integracao_crm_salvar(p_barraca_id uuid, p_url text, p_ativo boolean)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_url text := nullif(btrim(coalesce(p_url, '')), '');
begin
  if not usuario_tem_acesso_barraca(p_barraca_id) then
    raise exception 'sem acesso a esta barraca';
  end if;
  if v_url is not null and v_url !~ '^https://[^[:space:]]+$' then
    raise exception 'a URL do CRM precisa começar com https://';
  end if;

  insert into public.integracao_crm (barraca_id, url, ativo, atualizado_em)
  values (p_barraca_id, v_url, false, now())
  on conflict (barraca_id) do update set url = excluded.url, atualizado_em = now();

  if coalesce(p_ativo, false) then
    if v_url is null or not exists (select 1 from public.integracao_crm where barraca_id = p_barraca_id and segredo is not null) then
      raise exception 'informe a URL e gere o segredo antes de ligar';
    end if;
  end if;
  update public.integracao_crm set ativo = coalesce(p_ativo, false), atualizado_em = now() where barraca_id = p_barraca_id;
end;
$$;

create or replace function public.integracao_crm_novo_segredo(p_barraca_id uuid)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_segredo text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
begin
  if not usuario_tem_acesso_barraca(p_barraca_id) then
    raise exception 'sem acesso a esta barraca';
  end if;
  insert into public.integracao_crm (barraca_id, segredo, atualizado_em)
  values (p_barraca_id, v_segredo, now())
  on conflict (barraca_id) do update set segredo = excluded.segredo, atualizado_em = now();
  return v_segredo;
end;
$$;

create or replace function public.integracao_crm_reenviar_falhos(p_barraca_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_qtd integer;
begin
  if not usuario_tem_acesso_barraca(p_barraca_id) then
    raise exception 'sem acesso a esta barraca';
  end if;
  update public.eventos_saida
     set estado = 'pendente', tentativas = 0, proxima_tentativa_em = now()
   where barraca_id = p_barraca_id and estado = 'falhou';
  get diagnostics v_qtd = row_count;
  return v_qtd;
end;
$$;

revoke all on function public.integracao_crm_estado(uuid) from public, anon;
revoke all on function public.integracao_crm_salvar(uuid, text, boolean) from public, anon;
revoke all on function public.integracao_crm_novo_segredo(uuid) from public, anon;
revoke all on function public.integracao_crm_reenviar_falhos(uuid) from public, anon;
grant execute on function public.integracao_crm_estado(uuid) to authenticated;
grant execute on function public.integracao_crm_salvar(uuid, text, boolean) to authenticated;
grant execute on function public.integracao_crm_novo_segredo(uuid) to authenticated;
grant execute on function public.integracao_crm_reenviar_falhos(uuid) to authenticated;

-- 7) Cron: a cada minuto acorda o worker (edge function) se houver evento devido. Lê a URL e o
-- segredo do worker de app_config (chaves `eventos_worker_url` e `eventos_worker_secret`,
-- preenchidas por quem opera o banco; sem elas não faz nada). Aproveita para apagar eventos
-- enviados há mais de 30 dias.
create or replace function public.disparar_worker_eventos()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_url text;
  v_segredo text;
begin
  delete from public.eventos_saida where estado = 'enviado' and enviado_em < now() - interval '30 days';

  select valor #>> '{}' into v_url from public.app_config where chave = 'eventos_worker_url';
  select valor #>> '{}' into v_segredo from public.app_config where chave = 'eventos_worker_secret';
  if v_url is null or v_segredo is null then
    return;
  end if;
  if not exists (select 1 from public.eventos_saida where estado = 'pendente' and proxima_tentativa_em <= now()) then
    return;
  end if;

  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-worker-secret', v_segredo),
    body := '{}'::jsonb
  );
exception when others then
  raise warning 'disparar_worker_eventos: %', sqlerrm;
end;
$$;

revoke all on function public.disparar_worker_eventos() from public, anon, authenticated;

-- Agenda com pg_cron (mesmo padrão tolerante da expiração do Pix): sem pg_cron/pg_net ou sem
-- permissão, só avisa; agende por fora:
--   select cron.schedule('enviar-eventos-saida', '* * * * *', 'select public.disparar_worker_eventos()');
do $$
begin
  create extension if not exists pg_cron with schema extensions;
  create extension if not exists pg_net with schema extensions;

  begin
    perform cron.unschedule('enviar-eventos-saida');
  exception when others then
    null;
  end;

  perform cron.schedule('enviar-eventos-saida', '* * * * *', 'select public.disparar_worker_eventos()');
exception when others then
  raise warning 'enviar-eventos-saida não agendado (%): agende disparar_worker_eventos() por fora', sqlerrm;
end;
$$;
