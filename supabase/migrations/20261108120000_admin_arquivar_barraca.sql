-- Painel do superadmin: arquivar, restaurar (até 30 dias) e apagar de vez (depois de 30 dias) uma barraca.
-- Reversível enquanto nada for apagado (rollback comentado no fim).
--
-- Barraca arquivada (`barracas.arquivada_em` preenchida):
--   * `usuario_tem_acesso_barraca` devolve false para todos (dono e funcionários). É a função usada pelas
--     policies de RLS e pela maioria das RPCs do app. Sete RPCs de escrita do dono conferem
--     `usuarios_barracas` direto e ganham a mesma recusa no fim deste arquivo (apagar_barraca,
--     suporte_gerar_codigo, barraca_trocar_slug, onboarding_aplicar_kit, onboarding_salvar_passo,
--     onboarding_ocultar_checklist, whatsapp_avaliacao_salvar). Ficam de fora de propósito: leituras do
--     admin (admin_barraca_ajustes, acessos_admin_da_barraca), suporte_encerrar_acesso (encerrar acesso
--     tem que continuar funcionando) e criar_barraca (não recebe barraca existente).
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
-- A função grava em `admin_acoes_log` a ação `apagar_barraca_definitivo` (admin_id nulo = sistema) na mesma transação.

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
  v_nome text;
begin
  select b.arquivada_em, b.nome into v_arquivada, v_nome from public.barracas b where b.id = p_barraca_id for update;
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
  -- Única ação irreversível: o registro entra na mesma transação do delete. admin_id nulo = ação do sistema.
  insert into public.admin_acoes_log (admin_id, acao, alvo_tipo, alvo_id, detalhes)
  values (null, 'apagar_barraca_definitivo', 'barraca', p_barraca_id,
          jsonb_build_object('nome', v_nome, 'arquivada_em', v_arquivada));
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

-- RPCs de escrita do dono que conferem usuarios_barracas direto (sem usuario_tem_acesso_barraca).
-- Corpos de produção (pg_get_functiondef, 2026-11-05; iguais às migrations citadas) mais a recusa de barraca
-- arquivada, com a mesma resposta que já dão para quem não tem acesso. create or replace mantém os grants.

-- apagar_barraca: base apagar_barraca.sql
create or replace function public.apagar_barraca(p_barraca_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Não autenticado';
  end if;

  if not exists (
    select 1 from public.usuarios_barracas
    where barraca_id = p_barraca_id
      and usuario_id = auth.uid()
      and papel = 'dono'
  ) then
    raise exception 'Só o dono da barraca pode apagá-la';
  end if;
  if exists (select 1 from public.barracas where id = p_barraca_id and arquivada_em is not null) then
    raise exception 'Só o dono da barraca pode apagá-la'; -- barraca arquivada
  end if;

  delete from public.itens_do_pedido
  where pedido_id in (select id from public.pedidos where barraca_id = p_barraca_id);

  delete from public.pedidos where barraca_id = p_barraca_id;
  delete from public.itens where barraca_id = p_barraca_id;
  delete from public.categorias where barraca_id = p_barraca_id;
  delete from public.custos_diarios where barraca_id = p_barraca_id;
  delete from public.barracas_senha_admin where barraca_id = p_barraca_id;
  delete from public.usuarios_barracas where barraca_id = p_barraca_id;
  delete from public.barracas where id = p_barraca_id;
end;
$$;

-- suporte_gerar_codigo: base 20261023100000_acesso_suporte.sql
create or replace function public.suporte_gerar_codigo(p_barraca_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  -- Mesmo alfabeto de ia_gerar_codigo (migration 20261019100000_ia_atendente.sql):
  -- sem 0/O/1/I/L pra não confundir quem digita à mão. 31 caracteres — não
  -- divide 256 exatamente, por isso a amostragem por rejeição abaixo (não um
  -- "% length(alfabeto)" direto, que teria viés: os 8 primeiros caracteres
  -- sairiam com probabilidade 9/256 e o resto com 8/256).
  alfabeto constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  v_tam constant integer := length(alfabeto);
  v_limite constant integer := (256 / v_tam) * v_tam; -- maior múltiplo de v_tam que cabe em 0..255
  v_codigo text;
  v_byte integer;
  v_expira timestamptz := now() + interval '24 hours';
begin
  if auth.uid() is null then
    return jsonb_build_object('estado', 'nao_autenticado');
  end if;

  if not exists (
    select 1 from public.usuarios_barracas
    where barraca_id = p_barraca_id and usuario_id = auth.uid() and papel = 'dono'
  ) then
    return jsonb_build_object('estado', 'sem_acesso');
  end if;
  if exists (select 1 from public.barracas where id = p_barraca_id and arquivada_em is not null) then
    return jsonb_build_object('estado', 'sem_acesso'); -- barraca arquivada
  end if;

  -- Byte aleatório criptográfico (não random(), que não é CSPRNG); descarta
  -- e sorteia de novo quando o byte cai fora do maior múltiplo de v_tam —
  -- sem isso, o módulo enviesaria os primeiros caracteres do alfabeto.
  v_codigo := '';
  for i in 1..8 loop
    loop
      v_byte := get_byte(gen_random_bytes(1), 0);
      exit when v_byte < v_limite;
    end loop;
    v_codigo := v_codigo || substr(alfabeto, 1 + (v_byte % v_tam), 1);
  end loop;

  insert into public.codigos_suporte (barraca_id, codigo_hash, expira_em, criado_por)
  values (p_barraca_id, encode(digest(v_codigo, 'sha256'), 'hex'), v_expira, auth.uid());

  return jsonb_build_object('estado', 'ok', 'codigo', v_codigo, 'expira_em', v_expira);
end;
$$;

-- barraca_trocar_slug: base 20261020120000_slug_apelidos.sql
create or replace function public.barraca_trocar_slug(p_barraca_id uuid, p_novo text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_novo text := lower(btrim(coalesce(p_novo, '')));
  b public.barracas%rowtype;
  v_proprio boolean;
begin
  if auth.uid() is null then
    return jsonb_build_object('estado', 'nao_autenticado');
  end if;

  select * into b from public.barracas where id = p_barraca_id for update;
  -- Mesma resposta para "não existe" e "não é o dono": não revela barraca de outra conta.
  if not found or b.arquivada_em is not null or not exists (
    select 1 from public.usuarios_barracas ub
     where ub.usuario_id = auth.uid() and ub.barraca_id = b.id and ub.papel = 'dono'
  ) then
    return jsonb_build_object('estado', 'sem_acesso');
  end if;

  if v_novo = b.slug then
    return jsonb_build_object('estado', 'ok', 'slug', b.slug);
  end if;

  if v_novo !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or char_length(v_novo) < 3 or char_length(v_novo) > 40 then
    return jsonb_build_object('estado', 'invalido');
  end if;
  if public.slug_reservado(v_novo) then
    return jsonb_build_object('estado', 'reservado');
  end if;

  select exists (select 1 from public.barracas_slugs_antigos a where a.slug = v_novo and a.barraca_id = b.id) into v_proprio;
  if exists (select 1 from public.barracas x where x.slug = v_novo and x.id <> b.id)
     or exists (select 1 from public.barracas_slugs_antigos a where a.slug = v_novo and a.barraca_id <> b.id) then
    return jsonb_build_object('estado', 'em_uso');
  end if;

  if b.slug_trocado_em is not null and b.slug_trocado_em > now() - interval '24 hours' then
    return jsonb_build_object('estado', 'muito_cedo');
  end if;
  if not v_proprio and (select count(*) from public.barracas_slugs_antigos a where a.barraca_id = b.id) >= 10 then
    return jsonb_build_object('estado', 'limite_apelidos');
  end if;

  -- Voltar a um apelido próprio: ele deixa de ser apelido (passa a ser o atual) e o atual vira apelido.
  delete from public.barracas_slugs_antigos where slug = v_novo and barraca_id = b.id;
  insert into public.barracas_slugs_antigos (slug, barraca_id) values (b.slug, b.id) on conflict (slug) do nothing;
  update public.barracas set slug = v_novo, slug_trocado_em = now() where id = b.id;

  return jsonb_build_object('estado', 'ok', 'slug', v_novo);
end;
$$;

-- onboarding_aplicar_kit: base 20261021110000_kits_iniciais.sql
create or replace function public.onboarding_aplicar_kit(p_barraca_id uuid, p_kit text, p_conteudo jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  c jsonb := coalesce(p_conteudo, '{}'::jsonb);
  b public.barracas;
  e jsonb;
  o jsonb;
  g jsonb;
  i jsonb;
  v_chaves text[];
  v_chave text;
  v_nome text;
  v_tipo text;
  v_min integer;
  v_max integer;
  v_texto text;
  v_var integer;
  v_cat_ids jsonb := '{}'::jsonb;
  v_grupo_ids jsonb := '{}'::jsonb;
  v_id uuid;
  v_ordem integer;
  v_ordem_o integer;
  v_item_id uuid;
  v_n_itens integer := 0;
  v_n_grupos integer := 0;
  v_liga boolean;
begin
  if auth.uid() is null then
    return jsonb_build_object('estado', 'nao_autenticado');
  end if;
  if not exists (
    select 1 from public.usuarios_barracas where usuario_id = auth.uid() and barraca_id = p_barraca_id and papel = 'dono'
  ) then
    return jsonb_build_object('estado', 'sem_acesso');
  end if;

  -- Uma aplicação por vez por barraca (duas chamadas simultâneas gravam uma vez só).
  perform pg_advisory_xact_lock(hashtextextended('kit:' || p_barraca_id::text, 0));
  select * into b from public.barracas where id = p_barraca_id for update;
  if not found or b.arquivada_em is not null then
    return jsonb_build_object('estado', 'sem_acesso');
  end if;

  if b.kit_aplicado_em is not null then
    return jsonb_build_object('estado', 'ja_aplicado');
  end if;
  if not b.kit_elegivel then
    return jsonb_build_object('estado', 'nao_elegivel');
  end if;
  if exists (select 1 from public.categorias where barraca_id = p_barraca_id)
     or exists (select 1 from public.itens where barraca_id = p_barraca_id)
     or exists (select 1 from public.grupos_opcoes where barraca_id = p_barraca_id) then
    return jsonb_build_object('estado', 'catalogo_nao_vazio');
  end if;

  -- ---- validação (sem gravar nada)
  if p_kit is null or p_kit not in ('feira', 'quermesse', 'lanchonete', 'acai', 'hamburgueria', 'pizzaria', 'pastelaria', 'pf')
     or jsonb_typeof(c) <> 'object'
     or jsonb_typeof(c -> 'categorias') is distinct from 'array'
     or jsonb_typeof(c -> 'itens') is distinct from 'array'
     or jsonb_typeof(c -> 'grupos') is distinct from 'array'
     or jsonb_array_length(c -> 'categorias') > 8
     or jsonb_array_length(c -> 'itens') not between 1 and 30
     or jsonb_array_length(c -> 'grupos') > 6 then
    return jsonb_build_object('estado', 'dados_invalidos');
  end if;

  -- categorias
  v_chaves := '{}';
  for e in select * from jsonb_array_elements(c -> 'categorias') loop
    v_chave := e ->> 'chave';
    v_nome := btrim(coalesce(e ->> 'nome', ''));
    if jsonb_typeof(e) <> 'object' or v_chave is null or v_chave !~ '^[a-z0-9_]{1,30}$' or v_chave = any (v_chaves)
       or v_nome = '' or char_length(v_nome) > 60 then
      return jsonb_build_object('estado', 'dados_invalidos');
    end if;
    v_chaves := v_chaves || v_chave;
  end loop;
  -- grupos
  v_chaves := '{}';
  for g in select * from jsonb_array_elements(c -> 'grupos') loop
    v_chave := g ->> 'chave';
    v_nome := btrim(coalesce(g ->> 'nome', ''));
    v_tipo := g ->> 'tipo';
    if jsonb_typeof(g) <> 'object' or v_chave is null or v_chave !~ '^[a-z0-9_]{1,30}$' or v_chave = any (v_chaves)
       or v_nome = '' or char_length(v_nome) > 60 or v_tipo not in ('variacao', 'adicional')
       or jsonb_typeof(g -> 'opcoes') is distinct from 'array'
       or jsonb_array_length(g -> 'opcoes') not between 1 and 12 then
      return jsonb_build_object('estado', 'dados_invalidos');
    end if;
    v_chaves := v_chaves || v_chave;
    v_texto := g ->> 'maximo';
    if v_texto is not null and (v_texto !~ '^[0-9]{1,2}$' or v_texto::integer not between 1 and 20) then
      return jsonb_build_object('estado', 'dados_invalidos');
    end if;
    if v_tipo = 'adicional' and coalesce(g ->> 'obrigatorio', 'false') not in ('true', 'false') then
      return jsonb_build_object('estado', 'dados_invalidos');
    end if;
    if v_tipo = 'adicional' and v_texto is not null and (case when g ->> 'obrigatorio' = 'true' then 1 else 0 end) > v_texto::integer then
      return jsonb_build_object('estado', 'dados_invalidos');
    end if;
    for o in select * from jsonb_array_elements(g -> 'opcoes') loop
      v_nome := btrim(coalesce(o ->> 'nome', ''));
      if jsonb_typeof(o) <> 'object' or v_nome = '' or char_length(v_nome) > 60
         or coalesce(o ->> 'precisaPreco', 'false') not in ('true', 'false') then
        return jsonb_build_object('estado', 'dados_invalidos');
      end if;
    end loop;
  end loop;

  -- itens: categoria existente, grupos existentes, no máximo uma variação por item
  for i in select * from jsonb_array_elements(c -> 'itens') loop
    v_nome := btrim(coalesce(i ->> 'nome', ''));
    if jsonb_typeof(i) <> 'object' or v_nome = '' or char_length(v_nome) > 60 then
      return jsonb_build_object('estado', 'dados_invalidos');
    end if;
    if not exists (
      select 1 from jsonb_array_elements(c -> 'categorias') x where x ->> 'chave' = i ->> 'categoria'
    ) then
      return jsonb_build_object('estado', 'dados_invalidos');
    end if;
    if i ? 'grupos' then
      if jsonb_typeof(i -> 'grupos') <> 'array' or jsonb_array_length(i -> 'grupos') > 6 then
        return jsonb_build_object('estado', 'dados_invalidos');
      end if;
      v_var := 0;
      for v_chave in select jsonb_array_elements_text(i -> 'grupos') loop
        select x ->> 'tipo' into v_tipo from jsonb_array_elements(c -> 'grupos') x where x ->> 'chave' = v_chave;
        if v_tipo is null then
          return jsonb_build_object('estado', 'dados_invalidos');
        end if;
        if v_tipo = 'variacao' then
          v_var := v_var + 1;
        end if;
      end loop;
      if v_var > 1 or (select count(distinct t) from jsonb_array_elements_text(i -> 'grupos') t) <> jsonb_array_length(i -> 'grupos') then
        return jsonb_build_object('estado', 'dados_invalidos');
      end if;
    end if;
  end loop;

  -- ---- gravação
  v_ordem := 0;
  for e in select * from jsonb_array_elements(c -> 'categorias') loop
    v_ordem := v_ordem + 1;
    insert into public.categorias (barraca_id, nome, ordem)
    values (p_barraca_id, btrim(e ->> 'nome'), v_ordem)
    returning id into v_id;
    v_cat_ids := v_cat_ids || jsonb_build_object(e ->> 'chave', v_id);
  end loop;

  v_ordem := 0;
  for g in select * from jsonb_array_elements(c -> 'grupos') loop
    v_ordem := v_ordem + 1;
    v_tipo := g ->> 'tipo';
    if v_tipo = 'variacao' then
      v_min := 1;
      v_max := 1;
    else
      v_min := case when g ->> 'obrigatorio' = 'true' then 1 else 0 end;
      v_max := (g ->> 'maximo')::integer;
    end if;
    insert into public.grupos_opcoes (barraca_id, nome, tipo, min_escolhas, max_escolhas, ordem, ativo)
    values (p_barraca_id, btrim(g ->> 'nome'), v_tipo, v_min, v_max, v_ordem, true)
    returning id into v_id;
    v_grupo_ids := v_grupo_ids || jsonb_build_object(g ->> 'chave', v_id);
    v_n_grupos := v_n_grupos + 1;
    v_ordem_o := 0;
    for o in select * from jsonb_array_elements(g -> 'opcoes') loop
      v_ordem_o := v_ordem_o + 1;
      -- Nada que custe dinheiro (ou substitua o preço do item) nasce ativo: o dono preenche e ativa.
      insert into public.opcoes (grupo_id, barraca_id, nome, preco_centavos, ordem, ativo, esgotado)
      values (
        v_id, p_barraca_id, btrim(o ->> 'nome'), 0, v_ordem_o,
        not (v_tipo = 'variacao' or coalesce(o ->> 'precisaPreco', 'false') = 'true'),
        false
      );
    end loop;
  end loop;

  v_ordem := 0;
  for i in select * from jsonb_array_elements(c -> 'itens') loop
    v_ordem := v_ordem + 1;
    insert into public.itens (barraca_id, nome, preco_centavos, ativo, ordem, categoria_id, kit_exemplo)
    values (
      p_barraca_id, btrim(i ->> 'nome'), 0, false, v_ordem,
      (v_cat_ids ->> (i ->> 'categoria'))::uuid, true
    )
    returning id into v_item_id;
    v_n_itens := v_n_itens + 1;
    v_ordem_o := 0;
    if i ? 'grupos' then
      for v_chave in select jsonb_array_elements_text(i -> 'grupos') loop
        v_ordem_o := v_ordem_o + 1;
        insert into public.itens_grupos (item_id, grupo_id, barraca_id, ordem)
        values (v_item_id, (v_grupo_ids ->> v_chave)::uuid, p_barraca_id, v_ordem_o);
      end loop;
    end if;
  end loop;

  -- Liga "Opções" só se o kit usa grupos (e só se a loja ainda não tinha ligado).
  v_liga := coalesce(c ->> 'opcoes_habilitado', 'false') = 'true' and v_n_grupos > 0;
  update public.barracas
     set kit_aplicado = p_kit,
         kit_aplicado_em = now(),
         opcoes_habilitado = opcoes_habilitado or v_liga
   where id = p_barraca_id;

  return jsonb_build_object('estado', 'ok', 'itens', v_n_itens, 'grupos', v_n_grupos, 'opcoes_habilitado', v_liga);
end;
$$;

-- onboarding_salvar_passo: base 20261029120000_onboarding_comanda.sql
create or replace function public.onboarding_salvar_passo(p_barraca_id uuid, p_etapa integer, p_dados jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  d jsonb := coalesce(p_dados, '{}'::jsonb);
  v_lista text[];
  v_item jsonb;
  v_dia integer;
  v_aberto boolean;
  v_abre time;
  v_fecha time;
  v_algum_aberto boolean := false;
  v_concluido timestamptz;
  v_comanda boolean;
begin
  if auth.uid() is null then
    raise exception 'Não autenticado';
  end if;
  if not exists (
    select 1 from public.usuarios_barracas where usuario_id = auth.uid() and barraca_id = p_barraca_id and papel = 'dono'
  ) then
    raise exception 'sem acesso a esta barraca';
  end if;
  if exists (select 1 from public.barracas where id = p_barraca_id and arquivada_em is not null) then
    raise exception 'sem acesso a esta barraca'; -- barraca arquivada
  end if;
  if p_etapa is null or p_etapa not between 3 and 10 then
    raise exception 'etapa_invalida';
  end if;
  if jsonb_typeof(d) <> 'object' then
    raise exception 'dados_invalidos';
  end if;

  if p_etapa = 3 then
    -- A barraca acabou de nascer: leva a categoria escolhida no passo 2 (que ficou no usuário).
    update public.barracas b
       set categoria_negocio = coalesce(b.categoria_negocio, (select p.categoria_negocio from public.perfis_usuario p where p.usuario_id = auth.uid()))
     where b.id = p_barraca_id;

  elsif p_etapa = 4 then
    if d ? 'cnpj' and d->>'cnpj' is not null and d->>'cnpj' !~ '^[0-9]{14}$' then
      raise exception 'cnpj_invalido';
    end if;
    update public.barracas set
      cnpj = case when d ? 'cnpj' then nullif(d->>'cnpj', '') else cnpj end,
      sem_cnpj = case when d ? 'sem_cnpj' then coalesce((d->>'sem_cnpj')::boolean, false) else sem_cnpj end,
      emitente_razao_social = case when d ? 'razao_social' then nullif(left(btrim(d->>'razao_social'), 120), '') else emitente_razao_social end
    where id = p_barraca_id;

  elsif p_etapa = 5 then
    update public.barracas set
      endereco_cep = case when d ? 'cep' then nullif(regexp_replace(coalesce(d->>'cep', ''), '\D', '', 'g'), '') else endereco_cep end,
      endereco_rua = case when d ? 'rua' then nullif(left(btrim(d->>'rua'), 120), '') else endereco_rua end,
      endereco_numero = case when d ? 'numero' then nullif(left(btrim(d->>'numero'), 20), '') else endereco_numero end,
      endereco_complemento = case when d ? 'complemento' then nullif(left(btrim(d->>'complemento'), 80), '') else endereco_complemento end,
      endereco_bairro = case when d ? 'bairro' then nullif(left(btrim(d->>'bairro'), 80), '') else endereco_bairro end,
      endereco_cidade = case when d ? 'cidade' then nullif(left(btrim(d->>'cidade'), 80), '') else endereco_cidade end,
      endereco_uf = case when d ? 'uf' then nullif(upper(btrim(d->>'uf')), '') else endereco_uf end
    where id = p_barraca_id;

  elsif p_etapa = 6 then
    if coalesce(jsonb_typeof(d->'horarios'), '') <> 'array' or jsonb_array_length(d->'horarios') not between 1 and 7 then
      raise exception 'horarios_invalidos';
    end if;
    for v_item in select * from jsonb_array_elements(d->'horarios') loop
      v_dia := (v_item->>'dia')::integer;
      v_aberto := coalesce((v_item->>'aberto')::boolean, false);
      if v_dia is null or v_dia not between 0 and 6 then
        raise exception 'horarios_invalidos';
      end if;
      if v_aberto then
        v_abre := (v_item->>'abre')::time;
        v_fecha := (v_item->>'fecha')::time;
        if v_abre is null or v_fecha is null then
          raise exception 'horarios_invalidos';
        end if;
        v_algum_aberto := true;
      else
        v_abre := null;
        v_fecha := null;
      end if;
      insert into public.horarios_funcionamento (barraca_id, dia_semana, aberto, hora_abertura, hora_fechamento)
      values (p_barraca_id, v_dia, v_aberto, v_abre, v_fecha)
      on conflict (barraca_id, dia_semana) do update
        set aberto = excluded.aberto, hora_abertura = excluded.hora_abertura, hora_fechamento = excluded.hora_fechamento;
    end loop;
    -- Obrigatório: ao menos um dia aberto no conjunto final (não só neste envio).
    if not exists (select 1 from public.horarios_funcionamento where barraca_id = p_barraca_id and aberto) then
      raise exception 'horario_vazio';
    end if;

  elsif p_etapa = 7 then
    if coalesce(jsonb_typeof(d->'metodos'), '') <> 'array' then
      raise exception 'metodos_invalidos';
    end if;
    select coalesce(array_agg(distinct x), '{}') into v_lista from jsonb_array_elements_text(d->'metodos') x;
    if cardinality(v_lista) < 1 or not (v_lista <@ array['dinheiro', 'debito', 'credito', 'pix']::text[]) then
      raise exception 'metodos_invalidos';
    end if;
    update public.barracas set metodos_pagamento_ativos = to_jsonb(v_lista) where id = p_barraca_id;

  elsif p_etapa = 8 then
    if coalesce(jsonb_typeof(d->'modos'), '') <> 'array' then
      raise exception 'modos_invalidos';
    end if;
    select coalesce(array_agg(distinct x), '{}') into v_lista from jsonb_array_elements_text(d->'modos') x;
    if cardinality(v_lista) < 1 or not (v_lista <@ array['mesa', 'balcao', 'retirada', 'entrega']::text[]) then
      raise exception 'modos_invalidos';
    end if;
    update public.barracas set modos_atendimento = v_lista where id = p_barraca_id;
    -- Comanda aberta: só com a chave presente (sem resposta nada muda). Sem Mesa nunca liga; taxa só com comanda.
    if d ? 'comanda_aberta_habilitada' then
      v_comanda := coalesce((d->>'comanda_aberta_habilitada')::boolean, false) and 'mesa' = any(v_lista);
      update public.barracas set
        comanda_aberta_habilitada = v_comanda,
        taxa_servico_habilitada = case when d ? 'taxa_servico_habilitada'
          then coalesce((d->>'taxa_servico_habilitada')::boolean, false) and v_comanda
          else taxa_servico_habilitada end
      where id = p_barraca_id;
    end if;

  elsif p_etapa = 9 then
    update public.barracas set
      taxa_entrega_habilitada = case when d ? 'habilitada' then coalesce((d->>'habilitada')::boolean, false) else taxa_entrega_habilitada end,
      taxa_entrega_centavos = case when d ? 'centavos' then least(greatest(coalesce((d->>'centavos')::integer, 0), 0), 99999999) else taxa_entrega_centavos end
    where id = p_barraca_id;

  elsif p_etapa = 10 then
    -- Conclui só se os 4 obrigatórios estão de fato preenchidos (conferido no banco, não no cliente).
    if not exists (select 1 from public.horarios_funcionamento where barraca_id = p_barraca_id and aberto)
       or not exists (select 1 from public.barracas where id = p_barraca_id and jsonb_array_length(coalesce(metodos_pagamento_ativos, '[]'::jsonb)) >= 1 and cardinality(modos_atendimento) >= 1) then
      raise exception 'obrigatorios_pendentes';
    end if;
    update public.barracas set onboarding_concluido_em = coalesce(onboarding_concluido_em, now()) where id = p_barraca_id;
  end if;

  update public.barracas set onboarding_etapa = greatest(onboarding_etapa, p_etapa::smallint) where id = p_barraca_id;
  select onboarding_concluido_em into v_concluido from public.barracas where id = p_barraca_id;
  return jsonb_build_object('etapa', p_etapa, 'concluido', v_concluido is not null);
end;
$$;

-- onboarding_ocultar_checklist: base 20261020100000_onboarding_config.sql
create or replace function public.onboarding_ocultar_checklist(p_barraca_id uuid) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'Não autenticado';
  end if;
  update public.barracas set checklist_oculto_ate = now() + interval '7 days'
   where id = p_barraca_id
     and arquivada_em is null
     and exists (select 1 from public.usuarios_barracas where usuario_id = auth.uid() and barraca_id = p_barraca_id and papel = 'dono');
  if not found then
    raise exception 'sem acesso a esta barraca';
  end if;
end;
$$;

-- whatsapp_avaliacao_salvar: base 20261103120000_modulos_consumidores.sql
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
  if exists (select 1 from public.barracas where id = p_barraca_id and arquivada_em is not null) then
    return jsonb_build_object('estado', 'sem_acesso'); -- barraca arquivada
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

-- ROLLBACK (rodar manualmente; só desfaz enquanto nenhuma barraca tiver sido apagada):
-- Recriar as sete RPCs do dono acima a partir das bases citadas em cada uma (supabase/functions/apagar_barraca.sql,
-- 20261023100000, 20261020120000, 20261021110000, 20261029120000, 20261020100000, 20261103120000).
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
