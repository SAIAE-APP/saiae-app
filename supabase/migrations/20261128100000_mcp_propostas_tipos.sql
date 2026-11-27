-- Gestão por IA (MCP), fatia 3: propostas de mais de um tipo de ação. Depende de 20261127110000_mcp_aprovacao.sql.
-- ADITIVA: o tipo 'preco' continua usando preco_de/preco_para; os tipos novos guardam o resto em `payload`.
--
-- Tipos: 'preco' (alterar_preco_item), 'esgotado' (marcar_esgotado) e 'estoque' (ajustar_estoque).
-- payload: esgotado = {"de": bool, "de_auto": bool, "para": bool}; estoque = {"delta": int, "motivo": text|null, "controla": bool}.
-- ORDEM DE DEPLOY: esta migration derruba a assinatura antiga de mcp_proposta_criar; aplique-a e publique a edge
-- function mcp-saiae juntas (a versão antiga da function não consegue mais criar proposta de preço).
--
-- Rollback (só funciona se não houver proposta dos tipos novos; apague-as antes):
--   drop function if exists public.mcp_proposta_criar(uuid, text, uuid, jsonb);
--   drop function if exists public.mcp_estoque_ajustar(uuid, uuid, uuid, integer, text);
--   drop function if exists public.mcp_resumo_vendas(uuid, date);
--   drop function if exists public._mcp_ferramenta_do_tipo(text);
--   delete from public.mcp_propostas where tipo <> 'preco';
--   alter table public.mcp_propostas drop constraint mcp_propostas_tipo_check, drop column payload, drop column tipo;
--   alter table public.mcp_propostas alter column preco_de set not null, alter column preco_para set not null;
--   e recrie mcp_proposta_criar(uuid, uuid, integer), mcp_proposta_aplicar, _listar e _decidir pela migration 20261127110000.

alter table public.mcp_propostas
  add column if not exists tipo text not null default 'preco',
  add column if not exists payload jsonb;

alter table public.mcp_propostas alter column preco_de drop not null;
alter table public.mcp_propostas alter column preco_para drop not null;

alter table public.mcp_propostas drop constraint if exists mcp_propostas_preco_check;
alter table public.mcp_propostas drop constraint if exists mcp_propostas_tipo_check;
alter table public.mcp_propostas add constraint mcp_propostas_tipo_check check ((
  (tipo = 'preco' and preco_de >= 0 and preco_para between 1 and 10000000)
  or (tipo = 'esgotado' and preco_de is null and preco_para is null
      and jsonb_typeof(payload -> 'de') = 'boolean' and jsonb_typeof(payload -> 'para') = 'boolean'
      and jsonb_typeof(payload -> 'de_auto') = 'boolean')
  or (tipo = 'estoque' and preco_de is null and preco_para is null
      and jsonb_typeof(payload -> 'delta') = 'number' and jsonb_typeof(payload -> 'controla') = 'boolean')
) is true);

-- Nome da ferramenta que gravou a proposta, para a auditoria.
create or replace function public._mcp_ferramenta_do_tipo(p_tipo text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select case p_tipo when 'preco' then 'alterar_preco_item' when 'esgotado' then 'marcar_esgotado' when 'estoque' then 'ajustar_estoque' end;
$$;

-- Ajuste de estoque pela IA (só service_role, depois do dono aprovar). Faz o mesmo que public.ajustar_estoque
-- (liga o controle com saldo 0 se o item ainda não controla, aplica o delta por _estoque_aplicar, que mexe no
-- esgotado automático, e grava o movimento 'ajuste'), mas sem auth.uid(): quem responde é o dono que aprovou.
-- Chamada de dentro de mcp_proposta_aplicar, então roda na MESMA transação da proposta.
create or replace function public.mcp_estoque_ajustar(
  p_barraca_id uuid, p_item_id uuid, p_criado_por uuid, p_delta integer, p_motivo text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_item public.itens%rowtype;
  v_saldo integer;
begin
  if p_delta is null or p_delta = 0 or abs(p_delta) > 1000000 then
    return jsonb_build_object('estado', 'delta_invalido');
  end if;
  select * into v_item from public.itens where id = p_item_id and barraca_id = p_barraca_id for update;
  if not found then
    return jsonb_build_object('estado', 'item_invalido');
  end if;
  -- O saldo tem faixa de ±1.000.000 (check da tabela): recusa antes em vez de estourar a constraint.
  if abs(coalesce(v_item.estoque_qtd, 0) + p_delta) > 1000000 then
    return jsonb_build_object('estado', 'fora_da_faixa');
  end if;
  if v_item.estoque_qtd is null then
    update public.itens set estoque_qtd = 0 where id = v_item.id;
  end if;
  v_saldo := public._estoque_aplicar(v_item.id, p_delta);
  insert into public.movimentos_estoque (barraca_id, item_id, delta, motivo, saldo_apos, observacao, criado_por)
  values (v_item.barraca_id, v_item.id, p_delta, 'ajuste', v_saldo, nullif(left(trim(coalesce(p_motivo, '')), 200), ''), p_criado_por);
  return jsonb_build_object('estado', 'ok', 'estoque_qtd', v_saldo);
end;
$$;

-- A assinatura antiga (uuid, uuid, integer) sai para não sobrar sobrecarga ambígua.
drop function if exists public.mcp_proposta_criar(uuid, uuid, integer);

-- Só a edge function (service role). Valida o token na hora e cria a proposta; no máximo 10 pendentes por barraca.
-- p_dados: preco = {"para": int}; esgotado = {"para": bool}; estoque = {"delta": int, "motivo": text}.
create or replace function public.mcp_proposta_criar(p_token_id uuid, p_tipo text, p_item_id uuid, p_dados jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_t public.mcp_tokens%rowtype;
  v_item public.itens%rowtype;
  v_id uuid;
  v_para integer;
  v_para_esg boolean;
  v_delta integer;
  v_motivo text;
  v_args jsonb;
  v_payload jsonb;
begin
  select t.* into v_t from public.mcp_tokens t
  where t.id = p_token_id and t.revogado_em is null
    and exists (select 1 from public.usuarios_barracas ub
                where ub.barraca_id = t.barraca_id and ub.usuario_id = t.criado_por and ub.papel = 'dono');
  if not found then
    return jsonb_build_object('estado', 'token_invalido');
  end if;
  if p_tipo is null or p_tipo not in ('preco', 'esgotado', 'estoque') or jsonb_typeof(p_dados) is distinct from 'object' then
    return jsonb_build_object('estado', 'tipo_invalido');
  end if;
  select * into v_item from public.itens where id = p_item_id and barraca_id = v_t.barraca_id;
  if not found then
    return jsonb_build_object('estado', 'item_nao_encontrado');
  end if;

  if p_tipo = 'preco' then
    if jsonb_typeof(p_dados -> 'para') is distinct from 'number' or (p_dados ->> 'para') !~ '^[0-9]{1,8}$' then
      return jsonb_build_object('estado', 'preco_invalido');
    end if;
    v_para := (p_dados ->> 'para')::integer;
    if v_para < 1 or v_para > 10000000 then
      return jsonb_build_object('estado', 'preco_invalido');
    end if;
    if v_item.preco_aberto then
      return jsonb_build_object('estado', 'preco_aberto');
    end if;
    if v_item.preco_centavos = v_para then
      return jsonb_build_object('estado', 'sem_mudanca', 'nome', v_item.nome);
    end if;
    v_args := jsonb_build_object('item_id', v_item.id, 'de', v_item.preco_centavos, 'para', v_para);
  elsif p_tipo = 'esgotado' then
    if jsonb_typeof(p_dados -> 'para') is distinct from 'boolean' then
      return jsonb_build_object('estado', 'dados_invalidos');
    end if;
    v_para_esg := (p_dados ->> 'para')::boolean;
    -- Esgotado ligado pelo sistema (saldo <= 0) vira manual quando o dono pede para marcar; o resto já está como pedido.
    if v_item.esgotado = v_para_esg and not (v_para_esg and v_item.estoque_esgotado_auto) then
      return jsonb_build_object('estado', 'sem_mudanca', 'nome', v_item.nome, 'esgotado', v_item.esgotado);
    end if;
    v_args := jsonb_build_object('item_id', v_item.id, 'de', v_item.esgotado, 'de_auto', v_item.estoque_esgotado_auto, 'para', v_para_esg);
    v_payload := v_args - 'item_id';
  elsif p_tipo = 'estoque' then
    if jsonb_typeof(p_dados -> 'delta') is distinct from 'number' or (p_dados ->> 'delta') !~ '^-?[0-9]{1,7}$' then
      return jsonb_build_object('estado', 'delta_invalido');
    end if;
    v_delta := (p_dados ->> 'delta')::integer;
    if v_delta = 0 or abs(v_delta) > 1000000 then
      return jsonb_build_object('estado', 'delta_invalido');
    end if;
    if abs(coalesce(v_item.estoque_qtd, 0) + v_delta) > 1000000 then
      return jsonb_build_object('estado', 'fora_da_faixa');
    end if;
    if p_dados ? 'motivo' and jsonb_typeof(p_dados -> 'motivo') not in ('string', 'null') then
      return jsonb_build_object('estado', 'dados_invalidos');
    end if;
    v_motivo := nullif(left(trim(coalesce(p_dados ->> 'motivo', '')), 200), '');
    -- 'controla' guarda se o item já controlava estoque: o dono aprovou ESSE efeito (repor/baixar, ou ligar o controle).
    v_payload := jsonb_build_object('delta', v_delta, 'motivo', v_motivo, 'controla', v_item.estoque_qtd is not null);
    v_args := v_payload || jsonb_build_object('item_id', v_item.id, 'estoque_atual', v_item.estoque_qtd);
  else
    return jsonb_build_object('estado', 'tipo_invalido');
  end if;

  -- Serializa a criação por barraca: sem a trava, duas chamadas contariam o mesmo número de pendentes e passariam do limite.
  perform pg_advisory_xact_lock(hashtextextended('mcp_proposta:' || v_t.barraca_id::text, 0));
  update public.mcp_propostas set estado = 'expirada'
    where barraca_id = v_t.barraca_id and estado in ('pendente', 'aprovada') and expira_em < now();
  if (select count(*) from public.mcp_propostas where barraca_id = v_t.barraca_id and estado = 'pendente') >= 10 then
    return jsonb_build_object('estado', 'muitas_pendentes');
  end if;

  if p_tipo = 'preco' then
    insert into public.mcp_propostas (barraca_id, token_id, item_id, tipo, preco_de, preco_para)
    values (v_t.barraca_id, v_t.id, v_item.id, 'preco', v_item.preco_centavos, v_para)
    returning id into v_id;
  else
    insert into public.mcp_propostas (barraca_id, token_id, item_id, tipo, payload)
    values (v_t.barraca_id, v_t.id, v_item.id, p_tipo, v_payload)
    returning id into v_id;
  end if;
  insert into public.mcp_auditoria (barraca_id, token_id, ferramenta, argumentos, resultado)
  values (v_t.barraca_id, v_t.id, public._mcp_ferramenta_do_tipo(p_tipo),
          jsonb_build_object('proposta_id', v_id) || v_args, 'proposta criada: ' || v_item.nome);
  return jsonb_build_object('estado', 'ok', 'proposta_id', v_id, 'tipo', p_tipo, 'nome', v_item.nome) || (v_args - 'item_id');
end;
$$;

-- Só a edge function. Tudo ou nada: valida token, titularidade, aprovação, validade e o estado atual do item,
-- grava, fecha a proposta e audita na MESMA transação.
create or replace function public.mcp_proposta_aplicar(p_token_id uuid, p_proposta_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_p public.mcp_propostas%rowtype;
  v_item public.itens%rowtype;
  v_args jsonb;
  v_res jsonb;
begin
  select * into v_p from public.mcp_propostas where id = p_proposta_id and token_id = p_token_id for update;
  if not found then
    return jsonb_build_object('estado', 'nao_encontrada');
  end if;
  -- FOR SHARE: revogar o token ou tirar o dono espera esta transação terminar (e vice-versa), sem janela entre conferir e gravar.
  perform 1
  from public.mcp_tokens t
  join public.usuarios_barracas ub
    on ub.barraca_id = t.barraca_id and ub.usuario_id = t.criado_por and ub.papel = 'dono'
  where t.id = p_token_id and t.revogado_em is null and t.barraca_id = v_p.barraca_id
  for share of t, ub;
  if not found then
    return jsonb_build_object('estado', 'token_invalido');
  end if;
  if v_p.estado = 'aplicada' then
    return jsonb_build_object('estado', 'ja_aplicada', 'tipo', v_p.tipo);
  end if;
  if v_p.estado = 'pendente' then
    return jsonb_build_object('estado', 'aguardando_aprovacao', 'tipo', v_p.tipo);
  end if;
  if v_p.estado <> 'aprovada' then
    return jsonb_build_object('estado', v_p.estado, 'tipo', v_p.tipo);
  end if;
  select * into v_item from public.itens where id = v_p.item_id and barraca_id = v_p.barraca_id for update;
  if not found or (v_p.tipo = 'preco' and v_item.preco_aberto) then
    return jsonb_build_object('estado', 'item_invalido', 'tipo', v_p.tipo);
  end if;
  -- Depois de todos os locks, com o relógio real (now() é o início da transação e pode estar velho).
  if v_p.expira_em < clock_timestamp() then
    update public.mcp_propostas set estado = 'expirada' where id = v_p.id;
    return jsonb_build_object('estado', 'expirada', 'tipo', v_p.tipo);
  end if;

  if v_p.tipo = 'preco' then
    if v_item.preco_centavos <> v_p.preco_de then
      return jsonb_build_object('estado', 'preco_mudou', 'tipo', v_p.tipo);
    end if;
    update public.itens set preco_centavos = v_p.preco_para where id = v_item.id;
    v_args := jsonb_build_object('de', v_p.preco_de, 'para', v_p.preco_para);
  elsif v_p.tipo = 'esgotado' then
    -- Compara também se o esgotado era automático: o dono pode ter marcado à mão depois da proposta, e isso vale mais.
    if v_item.esgotado is distinct from (v_p.payload ->> 'de')::boolean
       or v_item.estoque_esgotado_auto is distinct from (v_p.payload ->> 'de_auto')::boolean then
      return jsonb_build_object('estado', 'item_mudou', 'tipo', v_p.tipo);
    end if;
    -- Manual: estoque_esgotado_auto = false, então o sistema nunca desmarca sozinho (regra do estoque por item).
    update public.itens set esgotado = (v_p.payload ->> 'para')::boolean, estoque_esgotado_auto = false where id = v_item.id;
    v_args := v_p.payload;
  elsif v_p.tipo = 'estoque' then
    -- Se o dono desligou (ou ligou) o controle depois da aprovação, o efeito aprovado já não é o mesmo.
    if (v_item.estoque_qtd is not null) is distinct from (v_p.payload ->> 'controla')::boolean then
      return jsonb_build_object('estado', 'item_mudou', 'tipo', v_p.tipo);
    end if;
    -- Mesma transação: se o ajuste falhar, nada acima foi gravado e a proposta continua aprovada.
    v_res := public.mcp_estoque_ajustar(
      v_p.barraca_id, v_item.id, v_p.decidido_por, (v_p.payload ->> 'delta')::integer,
      'Gestão por IA' || coalesce(': ' || (v_p.payload ->> 'motivo'), ''));
    if v_res ->> 'estado' <> 'ok' then
      return jsonb_build_object('estado', v_res ->> 'estado', 'tipo', v_p.tipo);
    end if;
    v_args := v_p.payload || jsonb_build_object('estoque_qtd', v_res -> 'estoque_qtd');
  else
    return jsonb_build_object('estado', 'tipo_invalido', 'tipo', v_p.tipo);
  end if;

  update public.mcp_propostas set estado = 'aplicada', aplicado_em = now() where id = v_p.id;
  insert into public.mcp_auditoria (barraca_id, token_id, ferramenta, argumentos, resultado)
  values (v_p.barraca_id, p_token_id, public._mcp_ferramenta_do_tipo(v_p.tipo),
          jsonb_build_object('proposta_id', v_p.id, 'item_id', v_item.id) || v_args, 'ok: ' || v_item.nome);
  return jsonb_build_object('estado', 'ok', 'tipo', v_p.tipo, 'nome', v_item.nome) || v_args;
end;
$$;

-- Dono logado: propostas esperando decisão (agora com tipo e dados de cada tipo). Mesma assinatura, retorno jsonb.
create or replace function public.mcp_proposta_listar(p_barraca_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or not exists (
    select 1 from public.usuarios_barracas
    where barraca_id = p_barraca_id and usuario_id = auth.uid() and papel = 'dono'
  ) then
    return '[]'::jsonb;
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', p.id, 'tipo', p.tipo, 'item_nome', i.nome, 'preco_de', p.preco_de, 'preco_para', p.preco_para,
      'payload', p.payload, 'estoque_atual', i.estoque_qtd,
      'token_nome', t.nome, 'criado_em', p.criado_em, 'expira_em', p.expira_em
    ) order by p.criado_em desc)
    from public.mcp_propostas p
    join public.itens i on i.id = p.item_id
    join public.mcp_tokens t on t.id = p.token_id
    where p.barraca_id = p_barraca_id and p.estado = 'pendente' and p.expira_em >= now()
  ), '[]'::jsonb);
end;
$$;

-- Dono logado aprova ou recusa. Só proposta pendente e dentro do prazo.
create or replace function public.mcp_proposta_decidir(p_proposta_id uuid, p_aprovar boolean)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_p public.mcp_propostas%rowtype;
begin
  if auth.uid() is null then
    return jsonb_build_object('estado', 'nao_autenticado');
  end if;
  select * into v_p from public.mcp_propostas where id = p_proposta_id for update;
  if not found or not exists (
    select 1 from public.usuarios_barracas
    where barraca_id = v_p.barraca_id and usuario_id = auth.uid() and papel = 'dono'
  ) then
    return jsonb_build_object('estado', 'sem_acesso');
  end if;
  if v_p.estado <> 'pendente' then
    return jsonb_build_object('estado', 'ja_decidida');
  end if;
  if v_p.expira_em < clock_timestamp() then
    update public.mcp_propostas set estado = 'expirada' where id = v_p.id;
    return jsonb_build_object('estado', 'expirada');
  end if;
  update public.mcp_propostas
    set estado = case when coalesce(p_aprovar, false) then 'aprovada' else 'recusada' end,
        decidido_em = now(), decidido_por = auth.uid()
    where id = v_p.id;
  insert into public.mcp_auditoria (barraca_id, token_id, ferramenta, argumentos, resultado)
  values (v_p.barraca_id, v_p.token_id, public._mcp_ferramenta_do_tipo(v_p.tipo), jsonb_build_object('proposta_id', v_p.id),
          case when coalesce(p_aprovar, false) then 'dono aprovou' else 'dono recusou' end);
  return jsonb_build_object('estado', 'ok');
end;
$$;

-- Leitura: resumo de vendas de UM dia no fuso da barraca (só service_role). Mesmas regras do app: pedido cancelado
-- fora, item removido fora, e a taxa de entrega e o desconto de cupom aparecem À PARTE do valor dos itens.
create or replace function public.mcp_resumo_vendas(p_token_id uuid, p_data date default null)
returns jsonb
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
declare
  v_t public.mcp_tokens%rowtype;
  v_fuso text;
  v_hoje date;
  v_data date;
  v_ini timestamptz;
  v_fim timestamptz;
  v_ped record;
  v_itens bigint;
  v_top jsonb;
begin
  select t.* into v_t from public.mcp_tokens t
  where t.id = p_token_id and t.revogado_em is null
    and exists (select 1 from public.usuarios_barracas ub
                where ub.barraca_id = t.barraca_id and ub.usuario_id = t.criado_por and ub.papel = 'dono');
  if not found then
    return jsonb_build_object('estado', 'token_invalido');
  end if;
  select coalesce(b.fuso, 'America/Sao_Paulo') into v_fuso from public.barracas b where b.id = v_t.barraca_id;
  v_hoje := (now() at time zone v_fuso)::date;
  v_data := coalesce(p_data, v_hoje);
  if v_data > v_hoje or v_data < v_hoje - 366 then
    return jsonb_build_object('estado', 'data_invalida');
  end if;
  v_ini := v_data::timestamp at time zone v_fuso;
  v_fim := (v_data + 1)::timestamp at time zone v_fuso;

  select count(*) as pedidos,
         coalesce(sum(coalesce(p.taxa_entrega_centavos, 0)), 0) as taxa,
         coalesce(sum(coalesce(p.desconto_cupom_centavos, 0)), 0) as desconto
    into v_ped
    from public.pedidos p
   where p.barraca_id = v_t.barraca_id and p.status <> 'cancelado' and p.criado_em >= v_ini and p.criado_em < v_fim;

  select coalesce(sum(i.preco_centavos_unitario::bigint * i.quantidade), 0) into v_itens
    from public.itens_do_pedido i
    join public.pedidos p on p.id = i.pedido_id
   where p.barraca_id = v_t.barraca_id and p.status <> 'cancelado' and not i.removido
     and p.criado_em >= v_ini and p.criado_em < v_fim;

  select coalesce(jsonb_agg(jsonb_build_object('nome', x.nome, 'quantidade', x.qtd) order by x.qtd desc, x.nome), '[]'::jsonb) into v_top
    from (select i.nome, sum(i.quantidade)::int as qtd
            from public.itens_do_pedido i
            join public.pedidos p on p.id = i.pedido_id
           where p.barraca_id = v_t.barraca_id and p.status <> 'cancelado' and not i.removido
             and p.criado_em >= v_ini and p.criado_em < v_fim
           group by i.nome order by sum(i.quantidade) desc, i.nome limit 5) x;

  return jsonb_build_object(
    'estado', 'ok', 'data', v_data, 'pedidos', v_ped.pedidos,
    'itens_centavos', v_itens, 'taxa_entrega_centavos', v_ped.taxa, 'desconto_cupom_centavos', v_ped.desconto,
    'ticket_medio_itens_centavos', case when v_ped.pedidos > 0 then (v_itens / v_ped.pedidos) else 0 end,
    'mais_vendidos', v_top);
end;
$$;

revoke all on function public._mcp_ferramenta_do_tipo(text) from public, anon, authenticated;
revoke all on function public.mcp_estoque_ajustar(uuid, uuid, uuid, integer, text) from public, anon, authenticated;
revoke all on function public.mcp_resumo_vendas(uuid, date) from public, anon, authenticated;
revoke all on function public.mcp_proposta_criar(uuid, text, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.mcp_proposta_aplicar(uuid, uuid) from public, anon, authenticated;
revoke all on function public.mcp_proposta_listar(uuid) from public, anon;
revoke all on function public.mcp_proposta_decidir(uuid, boolean) from public, anon;
grant execute on function public.mcp_estoque_ajustar(uuid, uuid, uuid, integer, text) to service_role;
grant execute on function public.mcp_resumo_vendas(uuid, date) to service_role;
grant execute on function public.mcp_proposta_criar(uuid, text, uuid, jsonb) to service_role;
grant execute on function public.mcp_proposta_aplicar(uuid, uuid) to service_role;
grant execute on function public.mcp_proposta_listar(uuid) to authenticated;
grant execute on function public.mcp_proposta_decidir(uuid, boolean) to authenticated;
