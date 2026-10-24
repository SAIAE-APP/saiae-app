-- Avisos de pedido pelo WhatsApp sem configurar a "Integração com o CRM" à parte.
--
-- Antes, o evento do pedido só era gravado (e enviado) para barraca com `integracao_crm` ativa, com URL e segredo próprios.
-- Quem só conectava o WhatsApp na aba "WhatsApp e Automação" nunca gerava evento, então nenhum aviso saía.
--
-- Agora uma barraca com o WhatsApp já conectado alguma vez (`barracas.whatsapp_status` preenchido pelo CRM) também entra
-- na fila. Se ela não tem integração própria, o worker (`enviar-eventos-saida`) assina com o segredo de plataforma
-- (WHATSAPP_CONEXAO_SEGREDO) e envia para a URL de eventos do CRM: `reservar_eventos_saida` devolve url e segredo NULOS
-- para esse caso e o worker preenche. Integração própria ativa continua valendo e tem prioridade.
--
-- Só redefine duas funções (sem tabela nova, sem coluna nova); reaplicar é seguro.

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
  ) and not exists (
    select 1 from public.barracas where id = v_barraca and whatsapp_status is not null
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
      left join public.integracao_crm c
        on c.barraca_id = e.barraca_id and c.ativo and c.url is not null and c.segredo is not null
      left join public.barracas b
        on b.id = e.barraca_id and b.whatsapp_status is not null
     where e.estado = 'pendente'
       and e.proxima_tentativa_em <= now()
       and (c.barraca_id is not null or b.id is not null)
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
  -- url e segredo NULOS = barraca sem integração própria: o worker usa o segredo e a URL de plataforma.
  select a.id, c.url, c.segredo, public.montar_evento_saida(a.id)
    from alugados a
    left join public.integracao_crm c
      on c.barraca_id = a.barraca_id and c.ativo and c.url is not null and c.segredo is not null;
end;
$$;

revoke all on function public.reservar_eventos_saida(integer) from public, anon, authenticated;
grant execute on function public.reservar_eventos_saida(integer) to service_role;
