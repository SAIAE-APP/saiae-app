-- Rollback: reaplicar as definições anteriores: montar_evento_saida (20261030100000), integracao_cardapio (20261031120000),
--           ia_ligar (20261019150000), whatsapp_avaliacao_salvar e integracao_avaliacao_config e disparos_publico
--           (20261101120000), registrar_contato_marketing (20261102100000), ia_contexto (20261019150000).
-- Módulos pagos, tarefa 3: as funções do servidor que liam as flags antigas passam a exigir modulo_ativo (20261103100000).
-- Só o gate muda; assinaturas, grants, security mode e search_path são os das últimas definições. ADITIVA (create or replace).
--   * integracao_avaliacao_config: ativo = avaliacao_ativa e avisos vigente (não depende mais de disparos).
--   * whatsapp_avaliacao_salvar: exige avisos.   * disparos_publico (e a contagem, que a chama) e registrar_contato_marketing: exigem disparos.
--   * montar_evento_saida: sem avisos vigente, order.* sai com os cinco avisos ativo:false (ausente = ativo no CRM).
--   * integracao_cardapio: ia_habilitada só com o bot vigente.
--   * ia_ligar: ligar sem o módulo bot levanta modulo_desligado; desligar continua permitido.

-- montar_evento_saida: definição de 20261030100000, trocando só a leitura de v_avisos.
CREATE OR REPLACE FUNCTION public.montar_evento_saida(p_evento_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
  v_barraca_nome text;
  v_desconto integer;
  v_avisos jsonb;
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

  select nome, whatsapp_avisos into v_barraca_nome, v_avisos from public.barracas where id = p.barraca_id;
  -- Sem o módulo de avisos vigente: o CRM trata data.avisos ausente como tudo ativo, então o evento order.* sai com os
  -- cinco avisos explicitamente desligados (ativo:false, texto null). O evento continua sendo emitido; só o aviso não sai.
  if not public.modulo_ativo(p.barraca_id, 'whatsapp_avisos') then
    v_avisos := jsonb_build_object(
      'recebido', jsonb_build_object('ativo', false, 'texto', null),
      'pronto', jsonb_build_object('ativo', false, 'texto', null),
      'saiu_entrega', jsonb_build_object('ativo', false, 'texto', null),
      'entregue', jsonb_build_object('ativo', false, 'texto', null),
      'cancelado', jsonb_build_object('ativo', false, 'texto', null));
  end if;
  v_taxa := coalesce(p.taxa_entrega_centavos, 0);
  v_desconto := coalesce(p.desconto_cupom_centavos, 0);
  v_nome := nullif(btrim(coalesce(p.cliente_nome, p.entrega_nome, (select c.nome from public.clientes_finais c where c.id = p.cliente_id), '')), '');
  v_tel := coalesce(p.cliente_telefone, p.entrega_telefone, (select c.telefone from public.clientes_finais c where c.id = p.cliente_id));
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
      'barraca_nome', v_barraca_nome,
      'senha', p.senha,
      'status', e.status_pedido,
      'tipo_atendimento', coalesce(
        p.tipo_atendimento,
        case when p.viagem then 'retirada' when coalesce(p.mesa, '') <> '' then 'mesa' else 'balcao' end
      ),
      'itens', v_itens,
      'taxa_entrega_centavos', v_taxa,
      -- Com cupom, o total é o que o cliente pagou (itens − desconto + taxa). Sem cupom, a conta de sempre.
      'total_centavos', v_soma - v_desconto + v_taxa,
      'cupom_codigo', case when v_desconto > 0 then p.cupom_codigo end,
      'desconto_cupom_centavos', case when v_desconto > 0 then v_desconto end,
      'metodo_pagamento', p.metodo_pagamento,
      'cliente', case when v_cliente = '{}'::jsonb then null else v_cliente end
    )) || case
      when e.tipo like 'order.%' and v_avisos is not null then jsonb_build_object('avisos', v_avisos)
      else '{}'::jsonb
    end
  );
end;
$function$;

-- integracao_cardapio: definição de 20261031120000.
create or replace function public.integracao_cardapio(p_barraca_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
declare
  b public.barracas%rowtype;
  v_horarios jsonb;
  v_itens jsonb;
begin
  select * into b from public.barracas where id = p_barraca_id;
  if not found then
    return null;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'dia_semana', h.dia_semana, 'aberto', h.aberto,
           'hora_abertura', h.hora_abertura, 'hora_fechamento', h.hora_fechamento) order by h.dia_semana), '[]'::jsonb)
    into v_horarios
    from public.horarios_funcionamento h
   where h.barraca_id = p_barraca_id;

  select coalesce(jsonb_agg(jsonb_build_object(
           'item_id', i.id,
           'nome', i.nome,
           'descricao', i.descricao,
           'preco_centavos', i.preco_centavos,
           'categoria', c.nome,
           'esgotado', i.esgotado,
           'grupos', case when b.opcoes_habilitado then coalesce((
              select jsonb_agg(jsonb_build_object(
                       'grupo_id', g.id,
                       'nome', g.nome,
                       'tipo', g.tipo,
                       'minimo', g.min_escolhas,
                       'maximo', g.max_escolhas,
                       'opcoes', coalesce((
                          select jsonb_agg(jsonb_build_object(
                                   'opcao_id', o.id,
                                   'nome', o.nome,
                                   'preco_adicional_centavos',
                                     case when g.tipo = 'variacao' then o.preco_centavos - i.preco_centavos else o.preco_centavos end,
                                   'esgotado', o.esgotado) order by o.ordem, o.nome)
                            from public.opcoes o
                           where o.grupo_id = g.id and o.barraca_id = g.barraca_id and o.ativo), '[]'::jsonb)
                     ) order by ig.ordem, g.ordem, g.nome)
                from public.itens_grupos ig
                join public.grupos_opcoes g on g.id = ig.grupo_id and g.barraca_id = ig.barraca_id
               where ig.item_id = i.id and g.ativo), '[]'::jsonb) else '[]'::jsonb end
         ) order by coalesce(c.ordem, 0), i.ordem, i.nome), '[]'::jsonb)
    into v_itens
    from public.itens i
    left join public.categorias c on c.id = i.categoria_id
   where i.barraca_id = p_barraca_id and i.ativo and not coalesce(i.preco_aberto, false);

  return jsonb_build_object(
    'loja', jsonb_build_object(
      'nome', b.nome,
      'slug', b.slug,
      'modos_atendimento', to_jsonb(b.modos_atendimento),
      'pagar_na_entrega_habilitado', b.pagar_na_entrega_habilitado,
      'pagamento_online_habilitado', b.pagamento_online_habilitado,
      'perfil_cliente_obrigatorio', b.perfil_cliente_obrigatorio,
      'ia_habilitada', b.ia_habilitada and public.modulo_ativo(p_barraca_id, 'whatsapp_bot'),
      'ia_whatsapp_dono', case when b.ia_whatsapp_dono_confirmado_em is not null then b.ia_whatsapp_dono end,
      'ia_whatsapp_dono_confirmado_em', b.ia_whatsapp_dono_confirmado_em,
      'bloquear_fora_do_horario', b.bloquear_fora_do_horario,
      'fuso', b.fuso),
    'horarios', v_horarios,
    'itens', v_itens);
end;
$fn$;

revoke all on function public.integracao_cardapio(uuid) from public, anon, authenticated;
grant execute on function public.integracao_cardapio(uuid) to service_role;

-- ia_ligar: definição de 20261019150000.
create or replace function public.ia_ligar(p_barraca_id uuid, p_habilitada boolean)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  b public.barracas%rowtype;
  v_codigo text;
begin
  if auth.uid() is null or p_barraca_id is null or not public.usuario_tem_acesso_barraca(p_barraca_id) then
    raise exception 'sem acesso a esta barraca';
  end if;

  select * into b from public.barracas where id = p_barraca_id for update;
  if not found then
    raise exception 'sem acesso a esta barraca';
  end if;

  if coalesce(p_habilitada, false) and not public.modulo_ativo(p_barraca_id, 'whatsapp_bot') then
    raise exception 'modulo_desligado';
  end if;
  if p_habilitada and b.ia_whatsapp_dono is null then
    raise exception 'ia_sem_whatsapp_dono';
  end if;
  if p_habilitada and b.ia_whatsapp_dono_confirmado_em is null then
    raise exception 'ia_dono_nao_confirmado';
  end if;

  v_codigo := b.ia_codigo;
  if p_habilitada and v_codigo is null then
    v_codigo := public.ia_gerar_codigo();
  end if;

  update public.barracas
     set ia_habilitada = coalesce(p_habilitada, false), ia_codigo = v_codigo
   where id = p_barraca_id;

  return jsonb_build_object('ia_habilitada', coalesce(p_habilitada, false), 'ia_codigo', v_codigo);
end;
$$;
revoke all on function public.ia_ligar(uuid, boolean) from public, anon;
grant execute on function public.ia_ligar(uuid, boolean) to authenticated;

-- whatsapp_avaliacao_salvar, integracao_avaliacao_config, disparos_publico: definições de 20261101120000.
create or replace function public.whatsapp_avaliacao_salvar(p_barraca_id uuid, p_ativa boolean, p_texto text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
begin
  if auth.uid() is null then
    return jsonb_build_object('estado', 'nao_autenticado');
  end if;
  -- Só o dono muda a mensagem que vai aos clientes da loja.
  if not exists (
    select 1 from public.usuarios_barracas
     where barraca_id = p_barraca_id and usuario_id = auth.uid() and papel = 'dono'
  ) then
    return jsonb_build_object('estado', 'sem_acesso');
  end if;
  if not public.modulo_ativo(p_barraca_id, 'whatsapp_avisos') then
    return jsonb_build_object('estado', 'modulo_desligado');
  end if;
  if p_ativa is null
     or (p_texto is not null and (
       btrim(p_texto) = ''
       or char_length(p_texto) > 500
       or exists (
         select 1 from regexp_matches(p_texto, '\{[^{}]*\}', 'g') m
          where m[1] not in ('{nome}', '{senha}', '{barraca}')
       )
     )) then
    return jsonb_build_object('estado', 'dados_invalidos');
  end if;
  update public.barracas set avaliacao_ativa = p_ativa, avaliacao_texto = p_texto where id = p_barraca_id;
  return jsonb_build_object('estado', 'ok');
end;
$fn$;

revoke all on function public.whatsapp_avaliacao_salvar(uuid, boolean, text) from public, anon;
grant execute on function public.whatsapp_avaliacao_salvar(uuid, boolean, text) to authenticated;

create or replace function public.integracao_avaliacao_config(p_barraca_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'ativo', b.avaliacao_ativa and public.modulo_ativo(b.id, 'whatsapp_avisos'),
    'texto', b.avaliacao_texto,
    'whatsapp_dono', (
      select d from (
        select case when b.ia_whatsapp_dono_confirmado_em is not null then regexp_replace(coalesce(b.ia_whatsapp_dono, ''), '\D', '', 'g') end as d
        union all
        select regexp_replace(coalesce(b.whatsapp_pedidos, ''), '\D', '', 'g')
      ) x where d ~ '^[0-9]{8,15}$' limit 1
    ),
    'barraca_nome', b.nome
  )
  from public.barracas b where b.id = p_barraca_id
$$;

revoke all on function public.integracao_avaliacao_config(uuid) from public, anon, authenticated;
grant execute on function public.integracao_avaliacao_config(uuid) to service_role;

create or replace function public.disparos_publico(p_barraca_id uuid, p_tipo text, p_dias integer)
returns table (telefone text, nome text)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
begin
  if not public.modulo_ativo(p_barraca_id, 'whatsapp_disparos') then
    raise exception 'modulo_desligado';
  end if;
  if p_tipo not in ('promocao', 'reativacao') then
    raise exception 'tipo_invalido';
  end if;
  if p_tipo = 'reativacao' and (p_dias is null or p_dias < 1) then
    raise exception 'dias_invalido';
  end if;
  if p_tipo = 'promocao' then
    -- Todos os consentidos; sem calcular atividade. Cadastros mais recentes primeiro.
    return query
    select c.telefone, c.nome
      from public.clientes_finais c
     where c.barraca_id = p_barraca_id and c.consentimento_marketing_em is not null
     order by c.criado_em desc, c.telefone;
    return;
  end if;
  -- Reativação: última atividade = maior entre o cadastro e o último pedido não cancelado, casado por cliente_id OU
  -- pelo telefone do pedido (duas agregações, sem `or` no join). Mais antigos primeiro.
  return query
  with por_cliente as (
    select p.cliente_id as cid, max(p.criado_em) as m
      from public.pedidos p
     where p.barraca_id = p_barraca_id and p.status <> 'cancelado' and p.cliente_id is not null
     group by p.cliente_id
  ), por_telefone as (
    select coalesce(p.cliente_telefone, p.entrega_telefone) as tel, max(p.criado_em) as m
      from public.pedidos p
     where p.barraca_id = p_barraca_id and p.status <> 'cancelado'
       and coalesce(p.cliente_telefone, p.entrega_telefone) is not null
     group by 1
  ), base as (
    select c.telefone as t, c.nome as n,
           greatest(c.criado_em, pc.m, pt.m) as ultima
      from public.clientes_finais c
      left join por_cliente pc on pc.cid = c.id
      left join por_telefone pt on pt.tel = c.telefone
     where c.barraca_id = p_barraca_id and c.consentimento_marketing_em is not null
  )
  select b.t, b.n from base b
   where b.ultima < now() - make_interval(days => p_dias)
   order by b.ultima asc, b.t;
end;
$fn$;

revoke all on function public.disparos_publico(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.disparos_publico(uuid, text, integer) to service_role;

-- disparos_publico_contagem: definição de 20261101110000 (chama disparos_publico, então herda o gate).
create or replace function public.disparos_publico_contagem(p_barraca_id uuid, p_tipo text, p_dias integer)
returns integer
language sql
stable
security definer
set search_path = public, pg_temp
as $$ select count(*)::integer from public.disparos_publico(p_barraca_id, p_tipo, p_dias) $$;

-- registrar_contato_marketing: definição de 20261102100000.
create or replace function public.registrar_contato_marketing(p_barraca_id uuid, p_telefone text, p_nome text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_tel text := regexp_replace(coalesce(p_telefone, ''), '\D', '', 'g');
  v_nome text := nullif(btrim(coalesce(p_nome, '')), '');
begin
  if auth.uid() is null then
    return jsonb_build_object('estado', 'nao_autenticado');
  end if;
  if not public.usuario_tem_acesso_barraca(p_barraca_id) then
    return jsonb_build_object('estado', 'sem_acesso');
  end if;
  if not public.modulo_ativo(p_barraca_id, 'whatsapp_disparos') then
    return jsonb_build_object('estado', 'modulo_desligado');
  end if;
  if v_tel !~ '^[0-9]{8,15}$' then
    return jsonb_build_object('estado', 'dados_invalidos');
  end if;
  if v_nome is not null and char_length(v_nome) > 60 then
    v_nome := left(v_nome, 60);
  end if;

  insert into public.clientes_finais (barraca_id, nome, telefone, origem, consentimento_marketing_em)
  values (p_barraca_id, coalesce(v_nome, 'Cliente ' || right(v_tel, 4)), v_tel, 'balcao', now())
  on conflict (barraca_id, telefone) do update
    set consentimento_marketing_em = coalesce(public.clientes_finais.consentimento_marketing_em, now()),
        atualizado_em = now();
  return jsonb_build_object('estado', 'ok');
end;
$fn$;

revoke all on function public.registrar_contato_marketing(uuid, text, text) from public, anon;
grant execute on function public.registrar_contato_marketing(uuid, text, text) to authenticated;

-- ia_contexto: definição de 20261019150000, só somando o módulo bot vigente ao filtro da loja (a flag ia_habilitada pode estar velha depois de uma data vencer).
create or replace function public.ia_contexto(p_codigo text, p_telefone text)
returns jsonb
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
declare
  c_alfabeto_ok constant text := '^[A-Z0-9]{6}$';
  v_codigo text := upper(btrim(coalesce(p_codigo, '')));
  v_tel text := public.normalizar_telefone_aviso(p_telefone);
  b public.barracas%rowtype;
  v_fuso text;
  v_agora timestamp;
  v_dow integer;
  v_hora time;
  v_tem_horario boolean;
  v_aberta boolean;
  v_horarios jsonb;
  v_modos jsonb;
  v_pagamentos jsonb;
  v_bairros jsonb;
  v_itens jsonb;
  v_total_itens integer;
  v_cliente jsonb := null;
  v_cli record;
  v_plano text;
  v_limite integer;
begin
  if v_codigo !~ c_alfabeto_ok then
    return jsonb_build_object('ativa', false);
  end if;

  select * into b from public.barracas where ia_codigo = v_codigo and ia_habilitada and public.modulo_ativo(id, 'whatsapp_bot');
  if not found then
    return jsonb_build_object('ativa', false);
  end if;

  -- Horário e "aberta agora" no fuso da loja (null quando a loja não cadastrou horário nenhum).
  v_fuso := coalesce(b.fuso, 'America/Sao_Paulo');
  begin
    v_agora := (now() at time zone v_fuso);
  exception when others then
    v_fuso := 'America/Sao_Paulo';
    v_agora := (now() at time zone v_fuso);
  end;
  v_dow := extract(dow from v_agora)::integer;
  v_hora := v_agora::time;
  select exists (select 1 from public.horarios_funcionamento h where h.barraca_id = b.id) into v_tem_horario;
  if v_tem_horario then
    select exists (
      select 1 from public.horarios_funcionamento h
       where h.barraca_id = b.id and h.aberto and h.hora_abertura is not null and h.hora_fechamento is not null
         and (
           -- hoje: janela normal, ou janela que vira a noite (fecha de madrugada) e já abriu
           (h.dia_semana = v_dow and (
              (h.hora_fechamento > h.hora_abertura and v_hora >= h.hora_abertura and v_hora < h.hora_fechamento)
              or (h.hora_fechamento <= h.hora_abertura and v_hora >= h.hora_abertura)))
           -- ontem: janela que vira a noite e ainda não fechou
           or (h.dia_semana = (v_dow + 6) % 7 and h.hora_fechamento <= h.hora_abertura and v_hora < h.hora_fechamento)
         )
    ) into v_aberta;
  else
    v_aberta := null;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'dia', h.dia_semana, 'aberto', h.aberto,
           'abre', to_char(h.hora_abertura, 'HH24:MI'), 'fecha', to_char(h.hora_fechamento, 'HH24:MI')
         ) order by h.dia_semana), '[]'::jsonb)
    into v_horarios
    from public.horarios_funcionamento h where h.barraca_id = b.id;

  v_modos := to_jsonb(coalesce(b.modos_atendimento, array['mesa', 'balcao', 'retirada']::text[]));

  v_pagamentos := coalesce(to_jsonb(b.metodos_pagamento_ativos), '[]'::jsonb);
  if b.pagamento_online_habilitado then
    v_pagamentos := v_pagamentos || to_jsonb('pix_online'::text);
  end if;
  if b.pagar_na_entrega_habilitado then
    v_pagamentos := v_pagamentos || to_jsonb('pagar_na_entrega'::text);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('bairro', t.bairro, 'taxa_centavos', t.valor_centavos) order by t.bairro_normalizado), '[]'::jsonb)
    into v_bairros
    from (select * from public.taxas_entrega_bairro where barraca_id = b.id and ativo order by bairro_normalizado limit 100) t;

  -- Cardápio: só itens ativos, no máximo 200 (truncado explícito).
  select count(*) into v_total_itens from public.itens i where i.barraca_id = b.id and i.ativo;
  select coalesce(jsonb_agg(item order by ord_cat, ord_item), '[]'::jsonb)
    into v_itens
    from (
      select jsonb_build_object(
               'nome', i.nome,
               'descricao', i.descricao,
               'categoria', coalesce(cat.nome, 'Outros'),
               'preco_centavos', i.preco_centavos,
               'esgotado', i.esgotado,
               'adicionais', case when b.opcoes_habilitado then coalesce((
                    select jsonb_agg(jsonb_build_object(
                             'grupo', g.nome, 'tipo', g.tipo, 'obrigatorio', g.min_escolhas >= 1,
                             'opcoes', (select coalesce(jsonb_agg(jsonb_build_object('nome', o.nome, 'preco_centavos', o.preco_centavos) order by o.ordem, o.id), '[]'::jsonb)
                                          from public.opcoes o where o.grupo_id = g.id and o.ativo and not o.esgotado))
                           order by ig.ordem, g.ordem, g.id)
                      from public.itens_grupos ig
                      join public.grupos_opcoes g on g.id = ig.grupo_id and g.barraca_id = ig.barraca_id and g.ativo
                     where ig.item_id = i.id), '[]'::jsonb) else '[]'::jsonb end
             ) as item,
             coalesce(cat.ordem, 2147483647) as ord_cat,
             i.ordem as ord_item
        from public.itens i
        left join public.categorias cat on cat.id = i.categoria_id
       where i.barraca_id = b.id and i.ativo
       order by coalesce(cat.ordem, 2147483647), i.ordem
       limit 200
    ) x;

  -- Cliente: SÓ do mesmo telefone, NA MESMA loja, e SÓ com telefone confirmado. Senão null.
  if v_tel is not null then
    select cf.id, cf.nome into v_cli
      from public.clientes_finais cf
     where cf.barraca_id = b.id and cf.telefone = v_tel and cf.telefone_confirmado_em is not null
     limit 1;
    if found then
      v_cliente := jsonb_build_object(
        'primeiro_nome', nullif(split_part(btrim(coalesce(v_cli.nome, '')), ' ', 1), ''),
        'ultimos_pedidos', coalesce((
          select jsonb_agg(jsonb_build_object('itens', itens) order by criado_em desc)
            from (
              select p.criado_em,
                     coalesce((select jsonb_agg(ip.nome_item order by ip.nome_item)
                                 from public.itens_do_pedido ip
                                where ip.pedido_id = p.id and not coalesce(ip.removido, false)), '[]'::jsonb) as itens
                from public.pedidos p
               where p.barraca_id = b.id and p.cliente_id = v_cli.id and p.status <> 'cancelado'
               order by p.criado_em desc
               limit 3
            ) ult
        ), '[]'::jsonb)
      );
    end if;
  end if;

  -- Limite mensal do plano do dono (cobrança desligada = plano pro). Sem linha na tabela = sem limite definido.
  select a.plan into v_plano
    from public.usuarios_barracas ub
    join public.assinaturas a on a.usuario_id = ub.usuario_id
   where ub.barraca_id = b.id and ub.papel = 'dono'
   limit 1;
  if not public.cobranca_ativa() then
    v_plano := 'pro';
  end if;
  select l.conversas_mes into v_limite from public.ia_limites_plano l where l.plano = v_plano;
  -- Plano sem linha na tabela: padrão seguro de 200 conversas por mês (nunca "sem limite").
  v_limite := coalesce(v_limite, 200);

  return jsonb_build_object(
    'ativa', true,
    'loja', jsonb_build_object(
      'nome', b.nome,
      'endereco', coalesce(nullif(btrim(b.procon_endereco), ''), nullif(btrim(b.emitente_endereco), '')),
      'aberta_agora', v_aberta,
      'horarios', v_horarios,
      'modos', v_modos,
      'pagamentos', v_pagamentos,
      'taxa_entrega', jsonb_build_object(
        'habilitada', coalesce(b.taxa_entrega_habilitada, false),
        'padrao_centavos', case when coalesce(b.taxa_entrega_habilitada, false) then b.taxa_entrega_centavos else null end,
        'bairro_nao_listado', coalesce(b.entrega_bairro_nao_listado, 'taxa_padrao'),
        'bairros', v_bairros
      ),
      'link_cardapio', 'https://app.saiae.com.br/' || b.slug || '/cardapio'
    ),
    'cardapio', jsonb_build_object('truncado', v_total_itens > 200, 'itens', v_itens),
    'cliente', v_cliente,
    'ia', jsonb_build_object(
      'texto_livre', nullif(btrim(coalesce(b.ia_texto_livre, '')), ''),
      'whatsapp_dono', b.ia_whatsapp_dono,
      'dono_confirmado', b.ia_whatsapp_dono_confirmado_em is not null,
      'plano_limite_conversas', v_limite
    )
  );
end;
$$;

revoke all on function public.ia_contexto(text, text) from public, anon, authenticated;
grant execute on function public.ia_contexto(text, text) to service_role;
