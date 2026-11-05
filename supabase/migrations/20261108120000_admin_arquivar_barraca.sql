-- Painel do superadmin: arquivar, restaurar (até 30 dias) e apagar de vez (depois de 30 dias) uma barraca.
-- Reversível enquanto nada for apagado (rollback comentado no fim).
--
-- Barraca arquivada (`barracas.arquivada_em` preenchida):
--   * `usuario_tem_acesso_barraca` devolve false para todos (dono e funcionários). É a função usada pelas
--     policies de RLS e pelas RPCs do app, então a regra fica num lugar só.
--   * `cardapio_publico` não a encontra (mesma resposta de slug inexistente: zero linhas).
--   * `resolver_carrinho` a recusa ('barraca_invalida'): é por onde passam os pedidos públicos
--     (criar-pedido-cardapio, criar-pagamento-pix, cupom-validar), então nenhum pedido novo entra.
--   * Arquivar NÃO mexe na assinatura do dono (ele pode ter outras barracas).
--   * O acesso de suporte (`acesso_suporte_ativo`) é separado e continua valendo enquanto não expira.
--
-- Corpos de partida conferidos em produção (pg_get_functiondef, 2026-11-05): `usuario_tem_acesso_barraca`
-- (não versionada em migrations), `cardapio_publico` e `resolver_carrinho` (iguais à 20261022110000).
--
-- Apagamento definitivo: `apagar_dados_barraca` (só service_role), chamada pela edge function diária
-- `apagar-barracas-arquivadas` (tarefa 4), que também limpa o Storage. Quase tudo sai por
-- `on delete cascade` a partir de `barracas`; os deletes explícitos abaixo cobrem só o que o cascade
-- não alcança (FK sem cascade ou tabela sem FK).

alter table public.barracas add column if not exists arquivada_em timestamptz;
create index if not exists barracas_arquivada_em_idx on public.barracas (arquivada_em) where arquivada_em is not null;

-- Acesso: igual ao de produção, mais a barraca não arquivada (busca pela PK, barata dentro do RLS).
create or replace function public.usuario_tem_acesso_barraca(p_barraca_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from usuarios_barracas ub
    join barracas b on b.id = ub.barraca_id
    where ub.usuario_id = auth.uid()
      and ub.barraca_id = p_barraca_id
      and b.arquivada_em is null
  );
$$;

create or replace function public.admin_arquivar_barraca(p_barraca_id uuid, p_nome_confirmado text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_nome text;
  v_arquivada timestamptz;
begin
  if not exists (select 1 from public.superadmins s where s.usuario_id = auth.uid()) then
    raise exception 'acesso negado' using errcode = '42501';
  end if;

  select b.nome, b.arquivada_em into v_nome, v_arquivada from public.barracas b where b.id = p_barraca_id for update;
  if not found then
    raise exception 'barraca não encontrada' using errcode = '22023';
  end if;
  if p_nome_confirmado is null or btrim(p_nome_confirmado) is distinct from btrim(v_nome) then
    raise exception 'o nome digitado não confere com o nome da barraca' using errcode = '22023';
  end if;
  if v_arquivada is not null then
    return; -- já arquivada: sem erro e sem log duplicado
  end if;

  update public.barracas set arquivada_em = now() where id = p_barraca_id;
  perform public.admin_registrar_acao('arquivar_barraca', 'barraca', p_barraca_id, jsonb_build_object('nome', v_nome));
end;
$$;

create or replace function public.admin_restaurar_barraca(p_barraca_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_arquivada timestamptz;
begin
  if not exists (select 1 from public.superadmins s where s.usuario_id = auth.uid()) then
    raise exception 'acesso negado' using errcode = '42501';
  end if;

  select b.arquivada_em into v_arquivada from public.barracas b where b.id = p_barraca_id for update;
  if not found then
    raise exception 'barraca não encontrada' using errcode = '22023';
  end if;
  if v_arquivada is null then
    return; -- não estava arquivada: sem erro e sem log
  end if;
  if v_arquivada < now() - interval '30 days' then
    raise exception 'o prazo de 30 dias para restaurar esta barraca já passou' using errcode = '22023';
  end if;

  update public.barracas set arquivada_em = null where id = p_barraca_id;
  perform public.admin_registrar_acao('restaurar_barraca', 'barraca', p_barraca_id,
    jsonb_build_object('arquivada_em', v_arquivada));
end;
$$;

revoke all on function public.admin_arquivar_barraca(uuid, text) from public, anon;
revoke all on function public.admin_restaurar_barraca(uuid) from public, anon;
grant execute on function public.admin_arquivar_barraca(uuid, text) to authenticated;
grant execute on function public.admin_restaurar_barraca(uuid) to authenticated;

-- Arquivadas há mais de 30 dias (a mesma fronteira do restaurar: quando restaurar é recusado, apagar é aceito).
create or replace function public.barracas_para_apagar()
returns table (barraca_id uuid)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select b.id from public.barracas b
   where b.arquivada_em < now() - interval '30 days'
   order by b.arquivada_em;
$$;

-- Tabelas com barraca_id em produção (2026-11-05): todas têm FK para barracas com on delete cascade, exceto
-- as tratadas aqui. Sem cascade: itens_do_pedido.barraca_id, pagamentos_pendentes (barraca_id e pedido_id),
-- pedidos -> comandas, acessos_suporte -> codigos_suporte. Sem FK: modulos_eventos, cupom_tentativas_log.
-- modulos_barraca sai antes porque o trigger dele atualiza a própria barraca.
create or replace function public.apagar_dados_barraca(p_barraca_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_arquivada timestamptz;
begin
  select b.arquivada_em into v_arquivada from public.barracas b where b.id = p_barraca_id for update;
  if not found then
    raise exception 'barraca não encontrada' using errcode = '22023';
  end if;
  if v_arquivada is null or v_arquivada >= now() - interval '30 days' then
    raise exception 'só apaga barraca arquivada há mais de 30 dias' using errcode = '22023';
  end if;

  delete from public.pagamentos_pendentes where barraca_id = p_barraca_id
     or pedido_id in (select id from public.pedidos where barraca_id = p_barraca_id);
  delete from public.itens_do_pedido where barraca_id = p_barraca_id
     or pedido_id in (select id from public.pedidos where barraca_id = p_barraca_id);
  delete from public.pedidos where barraca_id = p_barraca_id;
  delete from public.acessos_suporte where barraca_id = p_barraca_id;
  delete from public.modulos_barraca where barraca_id = p_barraca_id;
  delete from public.modulos_eventos where barraca_id = p_barraca_id;
  delete from public.cupom_tentativas_log where barraca_id = p_barraca_id;
  delete from public.barracas where id = p_barraca_id; -- o resto sai por on delete cascade
end;
$$;

revoke all on function public.barracas_para_apagar() from public, anon, authenticated;
revoke all on function public.apagar_dados_barraca(uuid) from public, anon, authenticated;
grant execute on function public.barracas_para_apagar() to service_role;
grant execute on function public.apagar_dados_barraca(uuid) to service_role;

-- Job diário: chama a edge function de apagamento (URL e segredo em app_config, chaves
-- `apagar_barracas_url` e `apagar_barracas_secret`). Sem as chaves, ou sem nada para apagar, não faz nada.
create or replace function public.disparar_worker_apagar_barracas()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_url text;
  v_segredo text;
begin
  select valor #>> '{}' into v_url from public.app_config where chave = 'apagar_barracas_url';
  select valor #>> '{}' into v_segredo from public.app_config where chave = 'apagar_barracas_secret';
  if v_url is null or v_segredo is null then
    return;
  end if;
  if not exists (select 1 from public.barracas_para_apagar()) then
    return;
  end if;

  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-worker-secret', v_segredo),
    body := '{}'::jsonb
  );
exception when others then
  raise warning 'disparar_worker_apagar_barracas: %', sqlerrm;
end;
$$;

revoke all on function public.disparar_worker_apagar_barracas() from public, anon, authenticated;

-- Agenda só se pg_cron e pg_net existirem; senão avisa. Agende por fora:
--   select cron.schedule('apagar-barracas-arquivadas', '0 4 * * *', 'select public.disparar_worker_apagar_barracas()');
do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron')
     or not exists (select 1 from pg_extension where extname = 'pg_net') then
    raise warning 'apagar-barracas-arquivadas não agendado: pg_cron/pg_net ausentes';
    return;
  end if;

  begin
    perform cron.unschedule('apagar-barracas-arquivadas');
  exception when others then
    null;
  end;

  perform cron.schedule('apagar-barracas-arquivadas', '0 4 * * *', 'select public.disparar_worker_apagar_barracas()');
exception when others then
  raise warning 'apagar-barracas-arquivadas não agendado (%): agende por fora', sqlerrm;
end;
$$;

-- cardapio_publico: igual à 20261022110000 (= produção), mais "and b.arquivada_em is null".
create or replace function public.cardapio_publico(p_slug text)
returns table(
  barraca_id uuid,
  barraca_nome text,
  barraca_logo_url text,
  barraca_imagem_capa_url text,
  pagamento_online_habilitado boolean,
  barraca_modos_atendimento text[],
  item_id uuid,
  item_nome text,
  item_descricao text,
  item_foto_url text,
  item_preco_centavos int,
  item_esgotado boolean,
  item_popular boolean,
  categoria_nome text,
  categoria_ordem int,
  item_ordem int,
  pedidos_30d int,
  barraca_whatsapp_pedidos text
)
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select
    b.id,
    b.nome,
    b.logo_url,
    b.imagem_capa_url,
    b.pagamento_online_habilitado,
    b.modos_atendimento,
    i.id,
    i.nome,
    i.descricao,
    i.foto_url,
    i.preco_centavos,
    i.esgotado,
    i.popular,
    c.nome,
    c.ordem,
    i.ordem,
    coalesce(pop.total, 0)::int,
    case when b.pagar_na_entrega_habilitado then b.whatsapp_pedidos else null end
  from barracas b
  join itens i on i.barraca_id = b.id and i.ativo = true and not i.preco_aberto
  left join categorias c on c.id = i.categoria_id
  left join (
    select ip.item_id, sum(ip.quantidade) as total
    from itens_do_pedido ip
    join pedidos p on p.id = ip.pedido_id
    where p.barraca_id = (select id from barracas where slug = p_slug)
      and p.status != 'cancelado'
      and p.criado_em >= now() - interval '30 days'
      and ip.removido = false
    group by ip.item_id
  ) pop on pop.item_id = i.id
  where b.slug = p_slug
    and b.arquivada_em is null
  order by c.ordem nulls last, i.ordem;
$$;

grant execute on function public.cardapio_publico(text) to anon, authenticated;

-- resolver_carrinho: igual à 20261022110000 (= produção), mais "and b.arquivada_em is null" na busca da barraca.
create or replace function public.resolver_carrinho(p_barraca_id uuid, p_linhas jsonb)
returns jsonb
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
declare
  c_uuid constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  v_habilitado boolean;
  v_idx integer;
  v_linha jsonb;
  v_item public.itens%rowtype;
  v_item_id uuid;
  v_qtd integer;
  v_ids uuid[];
  v_ids_brutos jsonb;
  v_elem jsonb;
  v_n integer;
  v_vinculadas integer;
  v_disponiveis integer;
  v_opcoes jsonb;
  v_unit bigint;
  v_obs text;
  v_cod text;
  v_msg text;
  g record;
  v_linhas jsonb := '[]'::jsonb;
  v_erros jsonb := '[]'::jsonb;
  v_total bigint := 0;
begin
  if p_linhas is null or jsonb_typeof(p_linhas) <> 'array'
     or jsonb_array_length(p_linhas) = 0 or jsonb_array_length(p_linhas) > 40 then
    return jsonb_build_object('ok', false, 'erros', jsonb_build_array(jsonb_build_object(
      'linha', null, 'item_id', null, 'codigo', 'carrinho_invalido', 'mensagem', 'Carrinho inválido.')));
  end if;

  select b.opcoes_habilitado into v_habilitado from public.barracas b where b.id = p_barraca_id and b.arquivada_em is null;
  if not found then
    return jsonb_build_object('ok', false, 'erros', jsonb_build_array(jsonb_build_object(
      'linha', null, 'item_id', null, 'codigo', 'barraca_invalida', 'mensagem', 'Barraca não encontrada.')));
  end if;

  for v_idx in 0 .. jsonb_array_length(p_linhas) - 1 loop
    v_linha := p_linhas -> v_idx;
    v_cod := null;
    v_msg := null;
    v_item_id := null;
    v_opcoes := '[]'::jsonb;
    v_ids := '{}';

    -- Forma da linha.
    if jsonb_typeof(v_linha) <> 'object' or coalesce(v_linha ->> 'item_id', '') !~ c_uuid then
      v_cod := 'item_invalido'; v_msg := 'Item inválido.';
    else
      v_item_id := (v_linha ->> 'item_id')::uuid;
      if coalesce(v_linha ->> 'quantidade', '') !~ '^[0-9]{1,3}$'
         or (v_linha ->> 'quantidade')::integer not between 1 and 99 then
        v_cod := 'quantidade_invalida'; v_msg := 'Quantidade inválida.';
      else
        v_qtd := (v_linha ->> 'quantidade')::integer;
      end if;
    end if;

    -- opcao_ids: array de uuids distintos, até 20.
    if v_cod is null then
      v_ids_brutos := coalesce(v_linha -> 'opcao_ids', '[]'::jsonb);
      if jsonb_typeof(v_ids_brutos) <> 'array' then
        v_cod := 'opcao_invalida'; v_msg := 'Opções inválidas.';
      elsif jsonb_array_length(v_ids_brutos) > 20 then
        v_cod := 'muitas_opcoes'; v_msg := 'Opções demais neste item.';
      else
        for v_elem in select value from jsonb_array_elements(v_ids_brutos) loop
          if jsonb_typeof(v_elem) <> 'string' or (v_elem #>> '{}') !~ c_uuid then
            v_cod := 'opcao_invalida'; v_msg := 'Opções inválidas.';
            exit;
          end if;
          if (v_elem #>> '{}')::uuid = any(v_ids) then
            v_cod := 'opcao_duplicada'; v_msg := 'Opção repetida.';
            exit;
          end if;
          v_ids := v_ids || (v_elem #>> '{}')::uuid;
        end loop;
      end if;
    end if;

    -- Item do cadastro real, da barraca, ativo e não esgotado.
    if v_cod is null then
      select * into v_item from public.itens i where i.id = v_item_id and i.barraca_id = p_barraca_id;
      if not found or not v_item.ativo or v_item.esgotado then
        v_cod := 'item_indisponivel';
        v_msg := coalesce(v_item.nome, 'Item') || ' está indisponível.';
      elsif v_item.preco_aberto then
        -- Valor livre é só do operador no balcão: o cliente final digitaria o próprio preço.
        v_cod := 'item_indisponivel';
        v_msg := v_item.nome || ' não está disponível no cardápio digital.';
      end if;
    end if;

    if v_cod is null then
      v_n := coalesce(cardinality(v_ids), 0);
      v_unit := v_item.preco_centavos;

      if not v_habilitado then
        if v_n > 0 then
          v_cod := 'opcoes_desabilitadas'; v_msg := 'Esta loja não usa opções nos itens.';
        end if;
      else
        -- Escolhas existem, ligadas ao item por grupo ativo?
        select count(*) into v_vinculadas
          from public.opcoes o
          join public.grupos_opcoes gr on gr.id = o.grupo_id and gr.barraca_id = o.barraca_id
          join public.itens_grupos ig on ig.grupo_id = gr.id and ig.item_id = v_item.id
         where o.id = any(v_ids) and o.barraca_id = p_barraca_id and gr.ativo;
        select count(*) into v_disponiveis
          from public.opcoes o
          join public.grupos_opcoes gr on gr.id = o.grupo_id and gr.barraca_id = o.barraca_id
          join public.itens_grupos ig on ig.grupo_id = gr.id and ig.item_id = v_item.id
         where o.id = any(v_ids) and o.barraca_id = p_barraca_id and gr.ativo and o.ativo and not o.esgotado;

        if v_vinculadas < v_n then
          v_cod := 'opcao_invalida'; v_msg := 'Uma das opções não existe neste item.';
        elsif v_disponiveis < v_n then
          v_cod := 'opcao_indisponivel'; v_msg := 'Uma das opções escolhidas está indisponível.';
        end if;

        -- Regras por grupo (mínimo/máximo, grupo obrigatório sem opção disponível).
        if v_cod is null then
          for g in
            select gr.id, gr.nome, gr.min_escolhas, gr.max_escolhas,
                   (select count(*) from public.opcoes o
                     where o.grupo_id = gr.id and o.ativo and not o.esgotado) as disp,
                   (select count(*) from public.opcoes o
                     where o.grupo_id = gr.id and o.id = any(v_ids)) as escolhidas
              from public.itens_grupos ig
              join public.grupos_opcoes gr on gr.id = ig.grupo_id and gr.barraca_id = ig.barraca_id
             where ig.item_id = v_item.id and gr.ativo
             order by ig.ordem, gr.ordem, gr.id
          loop
            if g.min_escolhas >= 1 and g.disp = 0 then
              v_cod := 'grupo_sem_opcao_disponivel';
              v_msg := v_item.nome || ' está indisponível: "' || g.nome || '" não tem opção disponível.';
              exit;
            elsif g.escolhidas < g.min_escolhas then
              v_cod := 'grupo_minimo';
              v_msg := 'Escolha pelo menos ' || g.min_escolhas || ' em "' || g.nome || '".';
              exit;
            elsif g.max_escolhas is not null and g.escolhidas > g.max_escolhas then
              v_cod := 'grupo_maximo';
              v_msg := 'Escolha no máximo ' || g.max_escolhas || ' em "' || g.nome || '".';
              exit;
            end if;
          end loop;
        end if;

        -- Snapshot e preço: variação substitui o preço base; adicionais somam.
        if v_cod is null and v_n > 0 then
          select jsonb_agg(jsonb_build_object(
                   'grupo_id', gr.id, 'grupo_nome', gr.nome, 'tipo', gr.tipo,
                   'opcao_id', o.id, 'nome', o.nome, 'preco_centavos', o.preco_centavos, 'quantidade', 1)
                 order by ig.ordem, gr.ordem, gr.id, o.ordem, o.id)
            into v_opcoes
            from public.opcoes o
            join public.grupos_opcoes gr on gr.id = o.grupo_id and gr.barraca_id = o.barraca_id
            join public.itens_grupos ig on ig.grupo_id = gr.id and ig.item_id = v_item.id
           where o.id = any(v_ids) and o.barraca_id = p_barraca_id;

          select coalesce(
                   (select (e ->> 'preco_centavos')::bigint
                      from jsonb_array_elements(v_opcoes) e where e ->> 'tipo' = 'variacao' limit 1),
                   v_item.preco_centavos)
                 + coalesce((select sum((e ->> 'preco_centavos')::bigint)
                      from jsonb_array_elements(v_opcoes) e where e ->> 'tipo' = 'adicional'), 0)
            into v_unit;
        end if;
      end if;

      if v_cod is null and (v_unit <= 0 or v_unit > 99999999) then
        v_cod := case when v_unit <= 0 then 'item_indisponivel' else 'preco_invalido' end;
        v_msg := v_item.nome || ' está indisponível.';
      end if;
    end if;

    if v_cod is not null then
      v_erros := v_erros || jsonb_build_object(
        'linha', v_idx, 'item_id', v_item_id, 'codigo', v_cod, 'mensagem', v_msg);
    else
      -- A observação vai para a comanda ESC/POS: sem caracteres de controle nem quebras de linha.
      v_obs := nullif(left(btrim(regexp_replace(
        coalesce(v_linha ->> 'observacao', ''),
        '[[:cntrl:][:space:]' || chr(8232) || chr(8233) || ']+', ' ', 'g')), 120), '');
      v_linhas := v_linhas || jsonb_build_object(
        'item_id', v_item.id,
        'nome_item', v_item.nome,
        'quantidade', v_qtd,
        'preco_centavos_unitario', v_unit,
        'opcoes', v_opcoes,
        'observacao', v_obs);
      v_total := v_total + v_unit * v_qtd;
    end if;
  end loop;

  if jsonb_array_length(v_erros) > 0 then
    return jsonb_build_object('ok', false, 'erros', v_erros);
  end if;
  return jsonb_build_object('ok', true, 'linhas', v_linhas, 'total_centavos', v_total);
end;
$$;

revoke all on function public.resolver_carrinho(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.resolver_carrinho(uuid, jsonb) to service_role;

-- ROLLBACK (rodar manualmente; só desfaz enquanto nenhuma barraca tiver sido apagada):
-- do $$ begin perform cron.unschedule('apagar-barracas-arquivadas'); exception when others then null; end $$;
-- drop function if exists public.disparar_worker_apagar_barracas();
-- drop function if exists public.apagar_dados_barraca(uuid);
-- drop function if exists public.barracas_para_apagar();
-- drop function if exists public.admin_restaurar_barraca(uuid);
-- drop function if exists public.admin_arquivar_barraca(uuid, text);
-- Recriar cardapio_publico(text) e resolver_carrinho(uuid, jsonb) exatamente como em
-- 20261022110000_valor_livre_preco_aberto.sql (copiar os dois create or replace e seus grants/revokes).
-- create or replace function public.usuario_tem_acesso_barraca(p_barraca_id uuid)
--   returns boolean language sql stable security definer set search_path = public, pg_temp as $$
--   select exists (select 1 from usuarios_barracas where usuario_id = auth.uid() and barraca_id = p_barraca_id); $$;
-- drop index if exists public.barracas_arquivada_em_idx;
-- alter table public.barracas drop column if exists arquivada_em;
