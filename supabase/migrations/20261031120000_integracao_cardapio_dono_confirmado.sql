-- Rollback: reaplicar a definição de public.integracao_cardapio(uuid) da migration 20261031100000_integracao_v1_bot.sql.
-- O número do dono só sai do banco se ele o confirmou (ia_whatsapp_dono_confirmado_em); antes ia sempre e a function
-- filtrava. Defesa em profundidade: o dado nem trafega sem confirmação. Mesma assinatura e mesmos grants.
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
      'ia_habilitada', b.ia_habilitada,
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
