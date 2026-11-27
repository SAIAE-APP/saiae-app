-- Gestão por IA (MCP), fatia 4: três ações novas pelo MESMO fluxo de proposta (a IA propõe, o dono aprova no app, a IA
-- aplica) e proteção da própria API: `cupom` (criar_cupom), `foto` (definir_foto_item) e `cardapio`
-- (importar_cardapio_de_foto); limite de chamadas por token e purga da auditoria.
-- Depende de 20261128100000_mcp_propostas_tipos.sql. ADITIVA para os dados; troca a assinatura de mcp_proposta_aplicar.
--
-- ORDEM DE DEPLOY: esta migration -> edge function mcp-saiae -> app. A function ANTIGA chama mcp_proposta_aplicar com
-- 2 argumentos; a assinatura nova tem o 3o (`p_tipo_esperado`) com default null, então a chamada antiga continua valendo
-- (sem a trava de tipo). A function NOVA exige esta migration (usa mcp_limite_registrar e as funções de foto).
--
-- Rollback (só funciona sem propostas dos tipos novos; apague-as antes):
--   delete from public.mcp_propostas where tipo in ('cupom', 'foto', 'cardapio');
--   drop function if exists public.mcp_limite_registrar(uuid, integer, integer);
--   drop function if exists public.mcp_auditoria_purgar(integer);
--   drop function if exists public.mcp_foto_preparar(uuid, uuid);
--   drop function if exists public.mcp_fotos_limpar_listar(uuid);
--   drop function if exists public.mcp_fotos_limpar_marcar(uuid, uuid[]);
--   drop function if exists public._mcp_cardapio_resumo(uuid, jsonb);
--   drop function if exists public._mcp_cardapio_a_criar(uuid, jsonb);
--   drop function if exists public._mcp_data_valida(text);
--   drop function if exists public._mcp_fuso(uuid);
--   drop function if exists public._mcp_chave_nome(text);
--   drop table if exists public.mcp_uso;
--   alter table public.mcp_propostas drop constraint mcp_propostas_tipo_check; alter column item_id set not null;
--   e recrie a constraint, _mcp_ferramenta_do_tipo, mcp_proposta_criar/_aplicar/_listar pela migration 20261128100000.
--
-- Decisões (registradas no spec): cupom nasce PAUSADO (ativo = false) mesmo depois de aprovado, e o dono liga em
-- Ajustes > Cupons; "uma vez por cliente" não é oferecido (depende do perfil do cliente). Itens importados nascem
-- ativos, como na planilha, mas só depois de o dono ver a lista e aprovar. A foto antiga só é devolvida para apagar
-- se nenhum outro item usa a mesma URL.

-- ---------------------------------------------------------------------------------------------------------------------
-- 1) Tabela de propostas: item opcional e três tipos novos
-- ---------------------------------------------------------------------------------------------------------------------
alter table public.mcp_propostas alter column item_id drop not null;

alter table public.mcp_propostas drop constraint if exists mcp_propostas_tipo_check;
alter table public.mcp_propostas add constraint mcp_propostas_tipo_check check ((
  (tipo = 'preco' and item_id is not null and preco_de >= 0 and preco_para between 1 and 10000000)
  or (tipo = 'esgotado' and item_id is not null and preco_de is null and preco_para is null
      and jsonb_typeof(payload -> 'de') = 'boolean' and jsonb_typeof(payload -> 'para') = 'boolean'
      and jsonb_typeof(payload -> 'de_auto') = 'boolean')
  or (tipo = 'estoque' and item_id is not null and preco_de is null and preco_para is null
      and jsonb_typeof(payload -> 'delta') = 'number' and jsonb_typeof(payload -> 'controla') = 'boolean')
  or (tipo = 'cupom' and item_id is null and preco_de is null and preco_para is null
      and jsonb_typeof(payload -> 'codigo') = 'string' and jsonb_typeof(payload -> 'tipo_desconto') = 'string'
      and jsonb_typeof(payload -> 'valor') = 'number')
  or (tipo = 'foto' and item_id is not null and preco_de is null and preco_para is null
      and jsonb_typeof(payload -> 'pendente') = 'string' and jsonb_typeof(payload -> 'destino') = 'string'
      and jsonb_typeof(payload -> 'destino_url') = 'string')
  or (tipo = 'cardapio' and item_id is null and preco_de is null and preco_para is null
      and jsonb_typeof(payload -> 'itens') = 'array')
) is true);

create or replace function public._mcp_ferramenta_do_tipo(p_tipo text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select case p_tipo
    when 'preco' then 'alterar_preco_item' when 'esgotado' then 'marcar_esgotado' when 'estoque' then 'ajustar_estoque'
    when 'cupom' then 'criar_cupom' when 'foto' then 'definir_foto_item' when 'cardapio' then 'importar_cardapio_de_foto'
  end;
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 2) Auxiliares internas
-- ---------------------------------------------------------------------------------------------------------------------
-- Nome comparável: sem acento (português), minúsculo, espaços colapsados. Mesma ideia de chaveNome() em
-- src/lib/importarCardapio.ts e de normalizar_bairro; as maiúsculas acentuadas entram no translate porque o lower() do
-- banco pode estar em locale "C".
create or replace function public._mcp_chave_nome(p_texto text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  -- NFD separa a letra do acento (serve para texto composto e decomposto); depois tira as marcas e minúsculas, como o app.
  select btrim(regexp_replace(lower(regexp_replace(normalize(coalesce(p_texto, ''), NFD), '[\u0300-\u036f]', '', 'g')), '\s+', ' ', 'g'));
$$;

-- Fuso da barraca com o mesmo fallback do painel (src/lib/cupons.ts, fusoDaLoja): vazio ou desconhecido = America/Sao_Paulo.
create or replace function public._mcp_fuso(p_barraca uuid)
returns text
language sql
stable
set search_path = public, pg_temp
as $$
  select coalesce((select b.fuso from public.barracas b
                    where b.id = p_barraca and b.fuso is not null and exists (select 1 from pg_timezone_names z where z.name = b.fuso)),
                  'America/Sao_Paulo');
$$;

-- 'AAAA-MM-DD' válido (calendário real) entre 2020 e 2100, senão null.
create or replace function public._mcp_data_valida(p_texto text)
returns date
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  d date;
begin
  if p_texto is null or p_texto !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    return null;
  end if;
  d := p_texto::date;
  if to_char(d, 'YYYY-MM-DD') <> p_texto or d < date '2020-01-01' or d > date '2100-12-31' then
    return null;
  end if;
  return d;
exception when others then
  return null;
end;
$$;

-- Itens que a importação realmente criaria AGORA: tira o repetido dentro da lista (vale o primeiro) e o que a barraca já
-- tem (mesma categoria + mesmo nome, comparados pela chave). É a regra única usada na proposta, na prévia do dono e na
-- aplicação, então os três sempre concordam. Entrada: itens já limpos [{categoria, nome, preco_centavos, descricao}].
create or replace function public._mcp_cardapio_a_criar(p_barraca uuid, p_itens jsonb)
returns table (ord bigint, categoria text, cat_chave text, nome text, preco integer, descricao text)
language sql
stable
set search_path = public, pg_temp
as $$
  with x as (
    select t.ord,
           nullif(btrim(t.e ->> 'categoria'), '') as categoria,
           case when public._mcp_chave_nome(t.e ->> 'categoria') in ('', 'sem categoria') then ''
                else public._mcp_chave_nome(t.e ->> 'categoria') end as cat_chave,
           btrim(t.e ->> 'nome') as nome,
           public._mcp_chave_nome(t.e ->> 'nome') as nome_chave,
           (t.e ->> 'preco_centavos')::integer as preco,
           nullif(btrim(t.e ->> 'descricao'), '') as descricao
      from jsonb_array_elements(p_itens) with ordinality as t(e, ord)
  ), d as (
    select distinct on (cat_chave, nome_chave) * from x order by cat_chave, nome_chave, ord
  )
  select d.ord, case when d.cat_chave = '' then null else d.categoria end, d.cat_chave, d.nome, d.preco, d.descricao
    from d
   where not exists (
     select 1
       from public.itens i
       left join public.categorias c on c.id = i.categoria_id
      where i.barraca_id = p_barraca
        and public._mcp_chave_nome(i.nome) = d.nome_chave
        and (case when i.categoria_id is null then '' else coalesce(public._mcp_chave_nome(c.nome), '') end) = d.cat_chave
   )
   order by d.ord;
$$;

-- Resumo para o dono e para a IA: totais, categorias que seriam criadas e a lista completa (no máximo 300) do que entraria.
create or replace function public._mcp_cardapio_resumo(p_barraca uuid, p_payload jsonb)
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
  with novos as (select * from public._mcp_cardapio_a_criar(p_barraca, p_payload -> 'itens'))
  select jsonb_build_object(
    'total', coalesce((p_payload ->> 'enviados')::integer, jsonb_array_length(p_payload -> 'itens')),
    'a_criar', (select count(*) from novos),
    'categorias_novas', coalesce((
      select jsonb_agg(n.categoria order by n.primeiro)
        from (select (array_agg(nv.categoria order by nv.ord))[1] as categoria, min(nv.ord) as primeiro
                from novos nv
               where nv.cat_chave <> ''
                 and not exists (select 1 from public.categorias c
                                  where c.barraca_id = p_barraca and public._mcp_chave_nome(c.nome) = nv.cat_chave)
               group by nv.cat_chave) n), '[]'::jsonb),
    'amostra', coalesce((
      select jsonb_agg(jsonb_build_object('categoria', a.categoria, 'nome', a.nome, 'preco_centavos', a.preco, 'descricao', a.descricao)
                       order by a.ord)
        from novos a), '[]'::jsonb));
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 3) Criar proposta (mesma assinatura; agora com cupom, foto e cardápio)
-- ---------------------------------------------------------------------------------------------------------------------
-- p_dados: preco = {"para"}; esgotado = {"para"}; estoque = {"delta","motivo"};
--   cupom = {"codigo","tipo_desconto":"percentual|fixo","valor","valido_de","valido_ate","limite_usos","pedido_minimo_centavos"};
--   foto = {"pendente","destino","destino_url","bytes","largura","altura"} (o arquivo já está no bucket, em pendente/);
--   cardapio = {"itens":[{"categoria","nome","preco_centavos","descricao"}]}. p_item_id só vale para preco/esgotado/estoque/foto.
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
  v_nome text;
  v_codigo text;
  v_tdesc text;
  v_valor bigint;
  v_limite integer;
  v_minimo integer;
  v_de date;
  v_ate date;
  v_hoje date;
  v_fuso text;
  v_pend text;
  v_dest text;
  v_url text;
  v_bytes bigint;
  v_larg integer;
  v_alt integer;
  v_itens jsonb;
  v_limpos jsonb;
  v_n integer;
  v_resumo jsonb;
begin
  select t.* into v_t from public.mcp_tokens t
  where t.id = p_token_id and t.revogado_em is null
    and exists (select 1 from public.usuarios_barracas ub
                where ub.barraca_id = t.barraca_id and ub.usuario_id = t.criado_por and ub.papel = 'dono');
  if not found then
    return jsonb_build_object('estado', 'token_invalido');
  end if;
  if p_tipo is null or p_tipo not in ('preco', 'esgotado', 'estoque', 'cupom', 'foto', 'cardapio')
     or jsonb_typeof(p_dados) is distinct from 'object' then
    return jsonb_build_object('estado', 'tipo_invalido');
  end if;
  if p_tipo in ('preco', 'esgotado', 'estoque', 'foto') then
    select * into v_item from public.itens where id = p_item_id and barraca_id = v_t.barraca_id;
    if not found then
      return jsonb_build_object('estado', 'item_nao_encontrado');
    end if;
    v_nome := v_item.nome;
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
  elsif p_tipo = 'cupom' then
    -- Mesmas regras de public.cupons e do formulário do app (src/lib/cupons.ts): código A-Z0-9_- de 3 a 20, percentual
    -- 1..100 ou fixo em centavos, limite de usos 1..1.000.000, mínimo em centavos, janela por dia no fuso da barraca.
    if jsonb_typeof(p_dados -> 'codigo') is distinct from 'string' then
      return jsonb_build_object('estado', 'codigo_invalido');
    end if;
    v_codigo := upper(btrim(p_dados ->> 'codigo'));
    if v_codigo !~ '^[A-Z0-9_-]{3,20}$' then
      return jsonb_build_object('estado', 'codigo_invalido');
    end if;
    v_tdesc := p_dados ->> 'tipo_desconto';
    if jsonb_typeof(p_dados -> 'tipo_desconto') is distinct from 'string' or v_tdesc not in ('percentual', 'fixo') then
      return jsonb_build_object('estado', 'dados_invalidos');
    end if;
    if jsonb_typeof(p_dados -> 'valor') is distinct from 'number' or (p_dados ->> 'valor') !~ '^[0-9]{1,8}$' then
      return jsonb_build_object('estado', 'valor_invalido');
    end if;
    v_valor := (p_dados ->> 'valor')::bigint;
    if v_valor < 1 or (v_tdesc = 'percentual' and v_valor > 100) or (v_tdesc = 'fixo' and v_valor > 99999999) then
      return jsonb_build_object('estado', 'valor_invalido');
    end if;
    if coalesce(jsonb_typeof(p_dados -> 'limite_usos'), 'null') <> 'null' then
      if jsonb_typeof(p_dados -> 'limite_usos') <> 'number' or (p_dados ->> 'limite_usos') !~ '^[0-9]{1,7}$'
         or (p_dados ->> 'limite_usos')::integer not between 1 and 1000000 then
        return jsonb_build_object('estado', 'limite_invalido');
      end if;
      v_limite := (p_dados ->> 'limite_usos')::integer;
    end if;
    v_minimo := 0;
    if coalesce(jsonb_typeof(p_dados -> 'pedido_minimo_centavos'), 'null') <> 'null' then
      if jsonb_typeof(p_dados -> 'pedido_minimo_centavos') <> 'number' or (p_dados ->> 'pedido_minimo_centavos') !~ '^[0-9]{1,8}$' then
        return jsonb_build_object('estado', 'minimo_invalido');
      end if;
      v_minimo := (p_dados ->> 'pedido_minimo_centavos')::integer;
    end if;
    v_fuso := public._mcp_fuso(v_t.barraca_id);
    v_hoje := (now() at time zone v_fuso)::date;
    if coalesce(jsonb_typeof(p_dados -> 'valido_de'), 'null') <> 'null' then
      v_de := case when jsonb_typeof(p_dados -> 'valido_de') = 'string' then public._mcp_data_valida(p_dados ->> 'valido_de') end;
      if v_de is null then
        return jsonb_build_object('estado', 'data_invalida');
      end if;
    end if;
    if coalesce(jsonb_typeof(p_dados -> 'valido_ate'), 'null') <> 'null' then
      v_ate := case when jsonb_typeof(p_dados -> 'valido_ate') = 'string' then public._mcp_data_valida(p_dados ->> 'valido_ate') end;
      if v_ate is null or v_ate < v_hoje then
        return jsonb_build_object('estado', 'data_invalida');
      end if;
    end if;
    if v_de is not null and v_ate is not null and v_de > v_ate then
      return jsonb_build_object('estado', 'janela_invalida');
    end if;
    if exists (select 1 from public.cupons where barraca_id = v_t.barraca_id and codigo = v_codigo) then
      return jsonb_build_object('estado', 'codigo_existe', 'nome', v_codigo);
    end if;
    v_nome := v_codigo;
    v_payload := jsonb_build_object('codigo', v_codigo, 'tipo_desconto', v_tdesc, 'valor', v_valor, 'valido_de', v_de,
                                    'valido_ate', v_ate, 'limite_usos', v_limite, 'pedido_minimo_centavos', v_minimo);
    v_args := v_payload;
  elsif p_tipo = 'foto' then
    -- O arquivo já foi baixado e conferido pela edge function e está em {barraca}/pendente/; aqui só se confere que os
    -- caminhos são desta barraca e deste item (um erro da function nunca aponta para arquivo de outra barraca).
    v_pend := p_dados ->> 'pendente';
    v_dest := p_dados ->> 'destino';
    v_url := p_dados ->> 'destino_url';
    if jsonb_typeof(p_dados -> 'pendente') is distinct from 'string' or jsonb_typeof(p_dados -> 'destino') is distinct from 'string'
       or jsonb_typeof(p_dados -> 'destino_url') is distinct from 'string'
       or v_pend !~ ('^' || v_t.barraca_id::text || '/pendente/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$')
       or v_dest !~ ('^' || v_t.barraca_id::text || '/' || v_item.id::text || '-[0-9a-f]{16}\.(jpg|png|webp)$')
       or substring(v_pend from '\.([a-z]+)$') <> substring(v_dest from '\.([a-z]+)$')
       or char_length(v_url) > 600 or v_url !~ '^https://[^[:space:]]+$'
       or right(v_url, 16 + char_length(v_dest)) <> '/cardapio-fotos/' || v_dest then
      return jsonb_build_object('estado', 'dados_invalidos');
    end if;
    if jsonb_typeof(p_dados -> 'bytes') is distinct from 'number' or (p_dados ->> 'bytes') !~ '^[0-9]{1,8}$'
       or (p_dados ->> 'bytes')::bigint not between 1 and 5242880
       or jsonb_typeof(p_dados -> 'largura') is distinct from 'number' or (p_dados ->> 'largura') !~ '^[0-9]{1,5}$'
       or jsonb_typeof(p_dados -> 'altura') is distinct from 'number' or (p_dados ->> 'altura') !~ '^[0-9]{1,5}$' then
      return jsonb_build_object('estado', 'dados_invalidos');
    end if;
    v_bytes := (p_dados ->> 'bytes')::bigint;
    v_larg := (p_dados ->> 'largura')::integer;
    v_alt := (p_dados ->> 'altura')::integer;
    if v_larg not between 1 and 8000 or v_alt not between 1 and 8000 then
      return jsonb_build_object('estado', 'dados_invalidos');
    end if;
    v_payload := jsonb_build_object('pendente', v_pend, 'destino', v_dest, 'destino_url', v_url, 'bytes', v_bytes,
                                    'largura', v_larg, 'altura', v_alt, 'foto_antiga_url', v_item.foto_url);
    v_args := (v_payload - 'foto_antiga_url') || jsonb_build_object('item_id', v_item.id, 'tinha_foto', v_item.foto_url is not null);
  elsif p_tipo = 'cardapio' then
    v_itens := p_dados -> 'itens';
    if jsonb_typeof(v_itens) is distinct from 'array' or jsonb_array_length(v_itens) not between 1 and 300 then
      return jsonb_build_object('estado', 'dados_invalidos');
    end if;
    select count(*) into v_n
      from jsonb_array_elements(v_itens) e
     where jsonb_typeof(e) <> 'object'
        or jsonb_typeof(e -> 'nome') is distinct from 'string' or char_length(btrim(e ->> 'nome')) not between 1 and 80
        or coalesce(jsonb_typeof(e -> 'categoria'), 'null') not in ('string', 'null') or char_length(coalesce(e ->> 'categoria', '')) > 60
        or coalesce(jsonb_typeof(e -> 'descricao'), 'null') not in ('string', 'null') or char_length(coalesce(e ->> 'descricao', '')) > 300
        or jsonb_typeof(e -> 'preco_centavos') is distinct from 'number'
        or (case when (e ->> 'preco_centavos') ~ '^[0-9]{1,8}$' then (e ->> 'preco_centavos')::integer < 1 else true end);
    if v_n > 0 then
      return jsonb_build_object('estado', 'dados_invalidos');
    end if;
    -- Só os campos conhecidos, já aparados; o resto que a function mandar é descartado.
    select jsonb_agg(jsonb_build_object(
             'categoria', nullif(btrim(e ->> 'categoria'), ''), 'nome', btrim(e ->> 'nome'),
             'preco_centavos', (e ->> 'preco_centavos')::integer, 'descricao', nullif(btrim(e ->> 'descricao'), '')) order by o)
      into v_limpos
      from jsonb_array_elements(v_itens) with ordinality as t(e, o);
    v_resumo := public._mcp_cardapio_resumo(v_t.barraca_id, jsonb_build_object('itens', v_limpos));
    if (v_resumo ->> 'a_criar')::integer = 0 then
      return jsonb_build_object('estado', 'sem_mudanca', 'nome', 'Cardápio', 'total', v_resumo -> 'total');
    end if;
    v_nome := 'Cardápio';
    -- Guarda SÓ o que seria criado: a aplicação só pode tirar linhas que passaram a existir, nunca incluir uma que o dono não viu.
    select jsonb_agg(jsonb_build_object('categoria', c.categoria, 'nome', c.nome, 'preco_centavos', c.preco, 'descricao', c.descricao) order by c.ord)
      into v_limpos
      from public._mcp_cardapio_a_criar(v_t.barraca_id, v_limpos) c;
    v_payload := jsonb_build_object('itens', v_limpos, 'enviados', (v_resumo ->> 'total')::integer);
    v_args := v_resumo - 'amostra';
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
    values (v_t.barraca_id, v_t.id, case when p_tipo in ('cupom', 'cardapio') then null else v_item.id end, p_tipo, v_payload)
    returning id into v_id;
  end if;
  insert into public.mcp_auditoria (barraca_id, token_id, ferramenta, argumentos, resultado)
  values (v_t.barraca_id, v_t.id, public._mcp_ferramenta_do_tipo(p_tipo),
          jsonb_build_object('proposta_id', v_id) || v_args, 'proposta criada: ' || v_nome);
  return jsonb_build_object('estado', 'ok', 'proposta_id', v_id, 'tipo', p_tipo, 'nome', v_nome)
         || case when p_tipo = 'cardapio' then v_resumo else (v_args - 'item_id') end;
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 4) Aplicar proposta (assinatura nova: 3o argumento = tipo que a ferramenta chamadora espera)
-- ---------------------------------------------------------------------------------------------------------------------
drop function if exists public.mcp_proposta_aplicar(uuid, uuid);

-- Só a edge function. Tudo ou nada: valida token, titularidade, aprovação, validade e o estado atual, grava, fecha a
-- proposta e audita na MESMA transação. `p_tipo_esperado` impede que uma ferramenta aplique proposta de OUTRA (por
-- exemplo, alterar_preco_item aplicar uma foto sem o arquivo ter sido movido); null = sem a trava (chamadas antigas).
create or replace function public.mcp_proposta_aplicar(p_token_id uuid, p_proposta_id uuid, p_tipo_esperado text default null)
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
  v_nome text;
  v_fuso text;
  v_antiga text;
  v_cat_ordem integer;
  v_item_ordem integer;
  v_cats integer;
  v_criados integer;
  v_total integer;
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
  -- Sem tipo esperado (chamada no formato antigo, de uma versão anterior da function) só vale para os três tipos antigos:
  -- foto, cupom e cardápio exigem a ferramenta própria (foto precisa do arquivo copiado antes).
  if (p_tipo_esperado is not null and p_tipo_esperado <> v_p.tipo)
     or (p_tipo_esperado is null and v_p.tipo not in ('preco', 'esgotado', 'estoque')) then
    return jsonb_build_object('estado', 'tipo_incorreto', 'tipo', v_p.tipo);
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
  if v_p.item_id is not null then
    select * into v_item from public.itens where id = v_p.item_id and barraca_id = v_p.barraca_id for update;
    if not found or (v_p.tipo = 'preco' and v_item.preco_aberto) then
      return jsonb_build_object('estado', 'item_invalido', 'tipo', v_p.tipo);
    end if;
  end if;
  -- Depois de todos os locks, com o relógio real (now() é o início da transação e pode estar velho).
  if v_p.expira_em < clock_timestamp() then
    update public.mcp_propostas set estado = 'expirada' where id = v_p.id;
    return jsonb_build_object('estado', 'expirada', 'tipo', v_p.tipo);
  end if;
  v_nome := v_item.nome;

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
  elsif v_p.tipo = 'cupom' then
    -- A espera pela trava pode passar do prazo: revalida o relógio e a validade do cupom (dia no fuso da barraca) depois dela.
    perform pg_advisory_xact_lock(hashtextextended('mcp_cupom:' || v_p.barraca_id::text, 0));
    if v_p.expira_em < clock_timestamp() then
      update public.mcp_propostas set estado = 'expirada' where id = v_p.id;
      return jsonb_build_object('estado', 'expirada', 'tipo', v_p.tipo);
    end if;
    v_fuso := public._mcp_fuso(v_p.barraca_id);
    if v_p.payload ->> 'valido_ate' is not null and (v_p.payload ->> 'valido_ate')::date < (clock_timestamp() at time zone v_fuso)::date then
      return jsonb_build_object('estado', 'cupom_vencido', 'tipo', v_p.tipo);
    end if;
    -- Pausado até o dono ligar em Ajustes > Cupons; a janela vai do início do 1o dia ao último instante do dia final (fuso da barraca).
    insert into public.cupons (barraca_id, codigo, tipo, valor, inicio_em, fim_em, limite_usos, uma_por_cliente, pedido_minimo_centavos, ativo)
    values (
      v_p.barraca_id, v_p.payload ->> 'codigo', v_p.payload ->> 'tipo_desconto', (v_p.payload ->> 'valor')::integer,
      case when v_p.payload ->> 'valido_de' is not null then (v_p.payload ->> 'valido_de')::date::timestamp at time zone v_fuso end,
      case when v_p.payload ->> 'valido_ate' is not null
           then ((v_p.payload ->> 'valido_ate')::date + 1)::timestamp at time zone v_fuso - interval '1 millisecond' end,
      (v_p.payload ->> 'limite_usos')::integer, false, coalesce((v_p.payload ->> 'pedido_minimo_centavos')::integer, 0), false)
    -- O painel também insere cupons: se o código apareceu agora, a restrição única decide e a proposta segue aprovada.
    on conflict on constraint cupons_barraca_codigo_unico do nothing;
    get diagnostics v_criados = row_count;
    if v_criados = 0 then
      return jsonb_build_object('estado', 'codigo_existe', 'tipo', v_p.tipo, 'nome', v_p.payload ->> 'codigo');
    end if;
    v_nome := v_p.payload ->> 'codigo';
    v_args := v_p.payload || jsonb_build_object('ativo', false,
      'cupons_habilitado', coalesce((select b.cupons_habilitado from public.barracas b where b.id = v_p.barraca_id), false));
  elsif v_p.tipo = 'foto' then
    -- O arquivo já foi movido para `destino` pela function antes desta chamada. Se o item ganhou outra foto nesse meio
    -- tempo, a proposta não vale mais.
    if v_item.foto_url is distinct from (v_p.payload ->> 'foto_antiga_url') then
      return jsonb_build_object('estado', 'item_mudou', 'tipo', v_p.tipo);
    end if;
    update public.itens set foto_url = v_p.payload ->> 'destino_url' where id = v_item.id;
    -- A foto antiga só é devolvida para apagar se nenhum outro item da barraca ainda a usa.
    v_antiga := case when v_item.foto_url is not null
                      and not exists (select 1 from public.itens o where o.barraca_id = v_p.barraca_id and o.id <> v_item.id and o.foto_url = v_item.foto_url)
                     then v_item.foto_url end;
    v_args := jsonb_build_object('destino', v_p.payload ->> 'destino', 'destino_url', v_p.payload ->> 'destino_url',
                                 'pendente', v_p.payload ->> 'pendente', 'foto_antiga_url', v_antiga);
  elsif v_p.tipo = 'cardapio' then
    -- Recalcula contra o cardápio de AGORA (o dono pode ter cadastrado itens depois da proposta): só insere o que falta,
    -- nunca apaga nem sobrescreve, e aplicar duas vezes não duplica nada (a 2a já volta como ja_aplicada).
    perform pg_advisory_xact_lock(hashtextextended('mcp_cardapio:' || v_p.barraca_id::text, 0));
    if v_p.expira_em < clock_timestamp() then
      update public.mcp_propostas set estado = 'expirada' where id = v_p.id;
      return jsonb_build_object('estado', 'expirada', 'tipo', v_p.tipo);
    end if;
    v_total := jsonb_array_length(v_p.payload -> 'itens');
    select coalesce(max(ordem), 0) into v_cat_ordem from public.categorias where barraca_id = v_p.barraca_id;
    with novos as (select * from public._mcp_cardapio_a_criar(v_p.barraca_id, v_p.payload -> 'itens')),
    novas as (
      select nv.cat_chave, (array_agg(nv.categoria order by nv.ord))[1] as nome, min(nv.ord) as primeiro
        from novos nv
       where nv.cat_chave <> ''
         and not exists (select 1 from public.categorias c where c.barraca_id = v_p.barraca_id and public._mcp_chave_nome(c.nome) = nv.cat_chave)
       group by nv.cat_chave)
    insert into public.categorias (barraca_id, nome, ordem)
    select v_p.barraca_id, n.nome, v_cat_ordem + row_number() over (order by n.primeiro) from novas n;
    get diagnostics v_cats = row_count;
    select coalesce(max(ordem), 0) into v_item_ordem from public.itens where barraca_id = v_p.barraca_id;
    insert into public.itens (barraca_id, nome, preco_centavos, categoria_id, descricao, ativo, ordem)
    select v_p.barraca_id, nv.nome, nv.preco,
           (select c.id from public.categorias c
             where c.barraca_id = v_p.barraca_id and nv.cat_chave <> '' and public._mcp_chave_nome(c.nome) = nv.cat_chave
             order by c.ordem, c.id limit 1),
           nv.descricao, true, v_item_ordem + row_number() over (order by nv.ord)
      from public._mcp_cardapio_a_criar(v_p.barraca_id, v_p.payload -> 'itens') nv order by nv.ord;
    get diagnostics v_criados = row_count;
    v_nome := 'Cardápio';
    v_args := jsonb_build_object('criados', v_criados, 'categorias_criadas', v_cats, 'pulados', v_total - v_criados, 'total', v_total);
  else
    return jsonb_build_object('estado', 'tipo_invalido', 'tipo', v_p.tipo);
  end if;

  update public.mcp_propostas set estado = 'aplicada', aplicado_em = now() where id = v_p.id;
  insert into public.mcp_auditoria (barraca_id, token_id, ferramenta, argumentos, resultado)
  values (v_p.barraca_id, p_token_id, public._mcp_ferramenta_do_tipo(v_p.tipo),
          jsonb_build_object('proposta_id', v_p.id, 'item_id', v_p.item_id) || v_args, 'ok: ' || v_nome);
  return jsonb_build_object('estado', 'ok', 'tipo', v_p.tipo, 'nome', v_nome) || v_args;
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 5) Foto: preparar (somente leitura) e limpeza dos arquivos pendentes
-- ---------------------------------------------------------------------------------------------------------------------
-- Antes de mover o arquivo, a function pergunta se a proposta de foto está APROVADA e dentro do prazo. O aplicar volta a
-- conferir tudo dentro da transação; esta só evita copiar arquivo à toa.
create or replace function public.mcp_foto_preparar(p_token_id uuid, p_proposta_id uuid)
returns jsonb
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
declare
  v_p public.mcp_propostas%rowtype;
begin
  select p.* into v_p from public.mcp_propostas p
  where p.id = p_proposta_id and p.token_id = p_token_id
    and exists (select 1 from public.mcp_tokens t
                 join public.usuarios_barracas ub on ub.barraca_id = t.barraca_id and ub.usuario_id = t.criado_por and ub.papel = 'dono'
                where t.id = p_token_id and t.revogado_em is null and t.barraca_id = p.barraca_id);
  if not found then
    return jsonb_build_object('estado', 'nao_encontrada');
  end if;
  if v_p.tipo <> 'foto' then
    return jsonb_build_object('estado', 'tipo_incorreto', 'tipo', v_p.tipo);
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
  if v_p.expira_em < clock_timestamp() then
    return jsonb_build_object('estado', 'expirada', 'tipo', v_p.tipo);
  end if;
  return jsonb_build_object('estado', 'ok', 'tipo', v_p.tipo, 'barraca_id', v_p.barraca_id, 'item_id', v_p.item_id,
                            'pendente', v_p.payload ->> 'pendente', 'destino', v_p.payload ->> 'destino');
end;
$$;

-- Arquivos pendentes que já não servem (proposta recusada, vencida ou aplicada) e ainda não foram apagados: no máximo 20
-- por chamada. Quem apaga do bucket é a edge function (a API de storage); depois ela marca com mcp_fotos_limpar_marcar.
create or replace function public.mcp_fotos_limpar_listar(p_token_id uuid)
returns jsonb
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
declare
  v_barraca uuid;
begin
  select t.barraca_id into v_barraca from public.mcp_tokens t where t.id = p_token_id and t.revogado_em is null;
  if v_barraca is null then
    return '[]'::jsonb;
  end if;
  return coalesce((
    -- destino: cópia que sobrou de uma proposta que NÃO foi aplicada e que nenhum item usa; antiga: foto trocada que nenhum item usa mais.
    -- Nunca devolve o destino de proposta aplicada nem arquivo ainda referenciado por um item da barraca.
    select jsonb_agg(jsonb_build_object('id', x.id, 'pendente', x.pendente, 'destino', x.destino, 'antiga', x.antiga))
      from (select p.id, p.payload ->> 'pendente' as pendente,
                   case when p.estado <> 'aplicada' and not exists (
                          select 1 from public.itens i where i.barraca_id = v_barraca and strpos(coalesce(i.foto_url, ''), p.payload ->> 'destino') > 0)
                        then p.payload ->> 'destino' end as destino,
                   case when p.estado = 'aplicada' and not exists (
                          select 1 from public.itens i where i.barraca_id = v_barraca and i.foto_url is not distinct from (p.payload ->> 'foto_antiga_url'))
                        then p.payload ->> 'foto_antiga_url' end as antiga
              from public.mcp_propostas p
             where p.barraca_id = v_barraca and p.tipo = 'foto' and not (p.payload ? 'limpo_em')
               and (p.estado in ('recusada', 'expirada', 'aplicada')
                    -- 10 min de folga: uma aplicação que passou pela checagem de prazo pode ainda não ter dado commit
                    or (p.estado in ('pendente', 'aprovada') and p.expira_em < clock_timestamp() - interval '10 minutes'))
             order by p.criado_em limit 20) x), '[]'::jsonb);
end;
$$;

create or replace function public.mcp_fotos_limpar_marcar(p_token_id uuid, p_ids uuid[])
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.mcp_propostas p
     set payload = p.payload || jsonb_build_object('limpo_em', now())
   where p.id = any (coalesce(p_ids, '{}')) and p.tipo = 'foto'
     and p.barraca_id = (select t.barraca_id from public.mcp_tokens t where t.id = p_token_id and t.revogado_em is null);
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 6) Dono logado: listagem com os tipos novos (cardápio devolve só o resumo, nunca os 300 itens)
-- ---------------------------------------------------------------------------------------------------------------------
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
      'payload', case when p.tipo = 'cardapio' then public._mcp_cardapio_resumo(p.barraca_id, p.payload)
                      else p.payload - 'foto_antiga_url' end,
      'foto_atual_url', case when p.tipo = 'foto' then i.foto_url end,
      'estoque_atual', i.estoque_qtd,
      'token_nome', t.nome, 'criado_em', p.criado_em, 'expira_em', p.expira_em
    ) order by p.criado_em desc)
    from public.mcp_propostas p
    left join public.itens i on i.id = p.item_id
    join public.mcp_tokens t on t.id = p.token_id
    where p.barraca_id = p_barraca_id and p.estado = 'pendente' and p.expira_em >= now()
  ), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 7) Limite de chamadas por token e purga da auditoria
-- ---------------------------------------------------------------------------------------------------------------------
create table if not exists public.mcp_uso (
  token_id uuid not null references public.mcp_tokens(id) on delete cascade,
  tipo text not null check (tipo in ('min', 'dia')),
  janela timestamptz not null,
  n integer not null default 0,
  primary key (token_id, tipo, janela)
);
alter table public.mcp_uso enable row level security;
revoke all on table public.mcp_uso from public, anon, authenticated;

-- Conta UMA chamada de ferramenta (a function chama antes de executar). Janela do minuto: relógio do banco; do dia: UTC.
-- Chamada recusada pelo limite do minuto não gasta a cota do dia. Devolve {estado: ok | limite_minuto | limite_dia, retry_em}.
create or replace function public.mcp_limite_registrar(p_token_id uuid, p_max_min integer default 60, p_max_dia integer default 2000)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_min timestamptz := date_trunc('minute', now());
  v_dia timestamptz := date_trunc('day', now() at time zone 'UTC') at time zone 'UTC';
  v_n integer;
begin
  -- Token revogado depois da validação inicial da chamada: não admite.
  if not exists (select 1 from public.mcp_tokens t where t.id = p_token_id and t.revogado_em is null) then
    return jsonb_build_object('estado', 'token_invalido');
  end if;
  insert into public.mcp_uso (token_id, tipo, janela, n) values (p_token_id, 'min', v_min, 1)
  on conflict (token_id, tipo, janela) do update set n = public.mcp_uso.n + 1
  returning n into v_n;
  if v_n > p_max_min then
    return jsonb_build_object('estado', 'limite_minuto', 'retry_em', greatest(1, ceil(extract(epoch from (v_min + interval '1 minute' - now())))::integer));
  end if;
  insert into public.mcp_uso (token_id, tipo, janela, n) values (p_token_id, 'dia', v_dia, 1)
  on conflict (token_id, tipo, janela) do update set n = public.mcp_uso.n + 1
  returning n into v_n;
  if v_n > p_max_dia then
    return jsonb_build_object('estado', 'limite_dia', 'retry_em', greatest(1, ceil(extract(epoch from (v_dia + interval '1 day' - now())))::integer));
  end if;
  return jsonb_build_object('estado', 'ok');
end;
$$;

-- Purga (só service_role; NÃO agendada aqui): apaga auditoria e propostas já decididas com mais de p_dias (mínimo 30,
-- padrão 90) e a contagem de uso com mais de 2 dias. Proposta de foto com arquivo pendente ainda não apagado fica.
-- Como agendar (um dos dois, a critério do João):
--   a) Supabase Dashboard > Database > Cron: select public.mcp_auditoria_purgar(90);   -- 1x por dia
--   b) pg_cron: select cron.schedule('mcp-purga', '15 3 * * *', $$select public.mcp_auditoria_purgar(90)$$);
create or replace function public.mcp_auditoria_purgar(p_dias integer default 90)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_aud bigint;
  v_prop bigint;
  v_uso bigint;
begin
  if p_dias is null or p_dias < 30 then
    return jsonb_build_object('estado', 'dias_invalido');
  end if;
  delete from public.mcp_auditoria where criado_em < now() - make_interval(days => p_dias);
  get diagnostics v_aud = row_count;
  delete from public.mcp_propostas p
   where p.criado_em < now() - make_interval(days => p_dias) and p.estado in ('aplicada', 'recusada', 'expirada')
     and (p.tipo <> 'foto' or p.payload ? 'limpo_em');
  get diagnostics v_prop = row_count;
  delete from public.mcp_uso where janela < now() - interval '2 days';
  get diagnostics v_uso = row_count;
  return jsonb_build_object('estado', 'ok', 'auditoria', v_aud, 'propostas', v_prop, 'uso', v_uso);
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 8) Permissões
-- ---------------------------------------------------------------------------------------------------------------------
revoke all on function public._mcp_chave_nome(text) from public, anon, authenticated;
revoke all on function public._mcp_data_valida(text) from public, anon, authenticated;
revoke all on function public._mcp_fuso(uuid) from public, anon, authenticated;
revoke all on function public._mcp_cardapio_a_criar(uuid, jsonb) from public, anon, authenticated;
revoke all on function public._mcp_cardapio_resumo(uuid, jsonb) from public, anon, authenticated;
revoke all on function public._mcp_ferramenta_do_tipo(text) from public, anon, authenticated;
revoke all on function public.mcp_proposta_criar(uuid, text, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.mcp_proposta_aplicar(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.mcp_foto_preparar(uuid, uuid) from public, anon, authenticated;
revoke all on function public.mcp_fotos_limpar_listar(uuid) from public, anon, authenticated;
revoke all on function public.mcp_fotos_limpar_marcar(uuid, uuid[]) from public, anon, authenticated;
revoke all on function public.mcp_limite_registrar(uuid, integer, integer) from public, anon, authenticated;
revoke all on function public.mcp_auditoria_purgar(integer) from public, anon, authenticated;
revoke all on function public.mcp_proposta_listar(uuid) from public, anon;
grant execute on function public.mcp_proposta_criar(uuid, text, uuid, jsonb) to service_role;
grant execute on function public.mcp_proposta_aplicar(uuid, uuid, text) to service_role;
grant execute on function public.mcp_foto_preparar(uuid, uuid) to service_role;
grant execute on function public.mcp_fotos_limpar_listar(uuid) to service_role;
grant execute on function public.mcp_fotos_limpar_marcar(uuid, uuid[]) to service_role;
grant execute on function public.mcp_limite_registrar(uuid, integer, integer) to service_role;
grant execute on function public.mcp_auditoria_purgar(integer) to service_role;
grant execute on function public.mcp_proposta_listar(uuid) to authenticated;
