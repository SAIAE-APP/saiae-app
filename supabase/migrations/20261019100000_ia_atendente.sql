-- IA no WhatsApp (fase 1), Task 1: dados da loja e a função `ia_contexto` (contrato SAI-002).
-- Spec: docs/superpowers/specs/2026-10-08-ia-whatsapp-design.md. ADITIVA e reversível; nada liga sozinho.
--
-- A IA só LÊ. `ia_contexto` devolve, para UMA loja (achada pelo código do link) e, no máximo, o cliente daquele
-- telefone SE o perfil existir naquela loja com telefone confirmado: dados da loja, cardápio ativo e o campo livre
-- do dono. Nunca devolve dado de outra loja nem de outro cliente. Código inexistente e IA desligada respondem
-- EXATAMENTE o mesmo `{"ativa": false}` (não revela se o código existe).
--
-- Só o papel de serviço executa (a edge function `ia-contexto` valida a assinatura antes de chamar).
--
-- Rollback: drop function if exists public.ia_contexto(text, text), public.ia_gerar_codigo();
--           drop table if exists public.ia_limites_plano;
--           alter table public.barracas drop column if exists ia_habilitada, drop column if exists ia_texto_livre,
--             drop column if exists ia_whatsapp_dono, drop column if exists ia_codigo;

-- 1) Colunas da loja. `ia_codigo` é o código do link (gerado ao ligar, na Task 3); único.
alter table public.barracas
  add column if not exists ia_habilitada boolean not null default false,
  add column if not exists ia_texto_livre text,
  add column if not exists ia_whatsapp_dono text,
  add column if not exists ia_codigo text;

alter table public.barracas drop constraint if exists barracas_ia_texto_livre_tamanho;
alter table public.barracas
  add constraint barracas_ia_texto_livre_tamanho check (ia_texto_livre is null or char_length(ia_texto_livre) <= 2000);

alter table public.barracas drop constraint if exists barracas_ia_whatsapp_dono_digitos;
alter table public.barracas
  add constraint barracas_ia_whatsapp_dono_digitos check (ia_whatsapp_dono is null or ia_whatsapp_dono ~ '^[0-9]{10,13}$');

alter table public.barracas drop constraint if exists barracas_ia_codigo_formato;
alter table public.barracas
  add constraint barracas_ia_codigo_formato check (ia_codigo is null or ia_codigo ~ '^[A-HJKMNP-Z2-9]{6}$');

create unique index if not exists barracas_ia_codigo_unico on public.barracas (ia_codigo) where ia_codigo is not null;

-- 2) Limite de conversas por mês de cada plano. Nasce VAZIA: os números saem da medição de custo real.
create table if not exists public.ia_limites_plano (
  plano text primary key,
  conversas_mes integer not null check (conversas_mes >= 0)
);
alter table public.ia_limites_plano enable row level security;
revoke all on public.ia_limites_plano from anon, authenticated;

-- 3) Código curto do link: 6 caracteres sem ambiguidade (sem I, L, O, 0, 1). Único.
create or replace function public.ia_gerar_codigo()
returns text
language plpgsql
volatile
set search_path = public, pg_temp
as $$
declare
  alfabeto constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  v_codigo text;
  v_tentativas integer := 0;
begin
  loop
    v_codigo := '';
    for i in 1..6 loop
      v_codigo := v_codigo || substr(alfabeto, 1 + floor(random() * length(alfabeto))::integer, 1);
    end loop;
    exit when not exists (select 1 from public.barracas where ia_codigo = v_codigo);
    v_tentativas := v_tentativas + 1;
    if v_tentativas > 20 then
      raise exception 'não foi possível gerar um código único';
    end if;
  end loop;
  return v_codigo;
end;
$$;
revoke all on function public.ia_gerar_codigo() from public, anon, authenticated;
grant execute on function public.ia_gerar_codigo() to service_role;

-- 4) A função de contexto.
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
      'plano_limite_conversas', v_limite
    )
  );
end;
$$;

revoke all on function public.ia_contexto(text, text) from public, anon, authenticated;
grant execute on function public.ia_contexto(text, text) to service_role;
