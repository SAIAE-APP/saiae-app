-- IA no WhatsApp: CONFIRMAR o WhatsApp do dono antes de ligar a IA (blocker da revisão aorus-19). ADITIVA; depende de
-- 20261019100000, 20261019110000 e 20261019120000.
--
-- Problema: qualquer dono podia cadastrar o número de um terceiro e a plataforma mandava a ele o aviso da IA.
-- Agora o número só vale depois que a PESSOA dona dele responde "CONFIRMAR #CODIGO" no WhatsApp:
--   * barracas.ia_whatsapp_dono_confirmado_em: preenchido só pela rota assinada ia-dono-confirmar (papel de serviço);
--     o dono (authenticated) nunca escreve nele;
--   * mudar ia_whatsapp_dono zera a confirmação e o pedido pendente, e DESLIGA a IA (precisa confirmar de novo);
--   * ligar a IA (ia_ligar ou qualquer outro caminho) exige a confirmação: 'ia_dono_nao_confirmado';
--   * ia_dono_pedir_preparar: gera o código da loja (se faltar), aplica intervalo mínimo entre pedidos e devolve
--     código + telefone para a function pedir ao CRM o envio; ia_dono_confirmar: grava a confirmação se o telefone
--     que respondeu é o cadastrado (compara DDD + 8 últimos dígitos: o WhatsApp às vezes entrega sem o 9º dígito);
--   * ia_contexto devolve ia.dono_confirmado e, sem linha do plano em ia_limites_plano, plano_limite_conversas = 200.
-- Lojas que já estavam com a IA ligada (só a de teste) seguem ligadas sem confirmação até alguém mudar o número.
--
-- Rollback: recriar ia_contexto/ia_ligar/barracas_ia_proteger das migrations anteriores; drop function
--   ia_dono_pedir_preparar, ia_dono_confirmar, ia_telefone_chave; drop das duas colunas novas.

alter table public.barracas
  add column if not exists ia_whatsapp_dono_confirmado_em timestamptz,
  add column if not exists ia_dono_confirmacao_pedida_em timestamptz;

-- Chave de comparação do telefone: sem o 55 do país, DDD + 8 últimos dígitos. Null se curto demais.
create or replace function public.ia_telefone_chave(p_telefone text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select case
    when n is null or length(n) < 10 then null
    else left(n, 2) || right(n, 8)
  end
  from (
    select case
      when length(d) in (12, 13) and left(d, 2) = '55' then substr(d, 3)
      else d
    end as n
    from (select regexp_replace(coalesce(p_telefone, ''), '[^0-9]', '', 'g') as d) x
  ) y
$$;
revoke all on function public.ia_telefone_chave(text) from public, anon, authenticated;
grant execute on function public.ia_telefone_chave(text) to service_role;

create or replace function public.barracas_ia_proteger()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if current_user in ('authenticated', 'anon') then
    if tg_op = 'INSERT' then
      if coalesce(new.ia_habilitada, false) or new.ia_codigo is not null
         or new.ia_whatsapp_dono_confirmado_em is not null or new.ia_dono_confirmacao_pedida_em is not null then
        raise exception 'ia_use_a_tela';
      end if;
    elsif new.ia_habilitada is distinct from old.ia_habilitada or new.ia_codigo is distinct from old.ia_codigo
       or new.ia_whatsapp_dono_confirmado_em is distinct from old.ia_whatsapp_dono_confirmado_em
       or new.ia_dono_confirmacao_pedida_em is distinct from old.ia_dono_confirmacao_pedida_em then
      raise exception 'ia_use_a_tela';
    end if;
  end if;

  -- Trocar o número invalida a confirmação (e o pedido em aberto) e desliga a IA: o novo número precisa confirmar.
  if tg_op = 'UPDATE' and new.ia_whatsapp_dono is distinct from old.ia_whatsapp_dono then
    new.ia_whatsapp_dono_confirmado_em := null;
    new.ia_dono_confirmacao_pedida_em := null;
    new.ia_habilitada := false;
  end if;

  if new.ia_habilitada and new.ia_whatsapp_dono is null then
    raise exception 'ia_sem_whatsapp_dono';
  end if;

  -- LIGAR (não "continuar ligada") exige o número confirmado.
  if new.ia_habilitada and new.ia_whatsapp_dono_confirmado_em is null
     and (tg_op = 'INSERT' or not coalesce(old.ia_habilitada, false)) then
    raise exception 'ia_dono_nao_confirmado';
  end if;

  return new;
end;
$$;

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

-- Pedido de confirmação (chamado pela function com JWT depois de conferir o acesso do usuário à loja).
-- Estados: ok (devolve codigo e telefone), sem_whatsapp, ja_confirmado, aguarde (menos de 60 s do último pedido).
create or replace function public.ia_dono_pedir_preparar(p_barraca_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  b public.barracas%rowtype;
  v_codigo text;
begin
  select * into b from public.barracas where id = p_barraca_id for update;
  if not found then
    return jsonb_build_object('estado', 'loja_inexistente');
  end if;
  if b.ia_whatsapp_dono is null then
    return jsonb_build_object('estado', 'sem_whatsapp');
  end if;
  if b.ia_whatsapp_dono_confirmado_em is not null then
    return jsonb_build_object('estado', 'ja_confirmado');
  end if;
  if b.ia_dono_confirmacao_pedida_em is not null and b.ia_dono_confirmacao_pedida_em > now() - interval '60 seconds' then
    return jsonb_build_object('estado', 'aguarde');
  end if;
  v_codigo := coalesce(b.ia_codigo, public.ia_gerar_codigo());
  update public.barracas
     set ia_codigo = v_codigo, ia_dono_confirmacao_pedida_em = now()
   where id = p_barraca_id;
  return jsonb_build_object('estado', 'ok', 'codigo', v_codigo, 'telefone', b.ia_whatsapp_dono);
end;
$$;
revoke all on function public.ia_dono_pedir_preparar(uuid) from public, anon, authenticated;
grant execute on function public.ia_dono_pedir_preparar(uuid) to service_role;

-- Confirmação vinda do CRM (rota assinada): só grava se o telefone que respondeu é o cadastrado.
create or replace function public.ia_dono_confirmar(p_codigo text, p_telefone text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  b public.barracas%rowtype;
begin
  select * into b from public.barracas where ia_codigo = upper(btrim(coalesce(p_codigo, ''))) for update;
  if not found then
    return jsonb_build_object('estado', 'loja_inexistente');
  end if;
  if b.ia_whatsapp_dono is null
     or public.ia_telefone_chave(p_telefone) is null
     or public.ia_telefone_chave(b.ia_whatsapp_dono) is distinct from public.ia_telefone_chave(p_telefone) then
    return jsonb_build_object('estado', 'numero_diferente');
  end if;
  if b.ia_whatsapp_dono_confirmado_em is not null then
    return jsonb_build_object('estado', 'ja_confirmado');
  end if;
  update public.barracas
     set ia_whatsapp_dono_confirmado_em = now(), ia_dono_confirmacao_pedida_em = null
   where id = b.id;
  return jsonb_build_object('estado', 'ok');
end;
$$;
revoke all on function public.ia_dono_confirmar(text, text) from public, anon, authenticated;
grant execute on function public.ia_dono_confirmar(text, text) to service_role;

-- ia_contexto: igual à 20261019100000, mais ia.dono_confirmado e o limite padrão de 200 conversas.
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

  select * into b from public.barracas where ia_codigo = v_codigo and ia_habilitada;
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
