-- Rollback: drop function if exists public.disparos_publico(uuid, text, integer);
--           drop function if exists public.disparos_publico_contagem(uuid, text, integer);
--           drop function if exists public.integracao_avaliacao_config(uuid);
-- WhatsApp disparos (fase 3), parte 2: público das campanhas e configuração da avaliação. ADITIVA; depende de 20261101100000.
-- Só service_role chama (edge functions). Público = clientes_finais com consentimento de marketing. O pedido é
-- casado com o cliente pelo mesmo critério de montar_evento_saida: cliente_id, ou telefone do pedido
-- (cliente_telefone / entrega_telefone) igual ao do cadastro. Pedido cancelado não conta como atividade.
-- Reativação: última atividade (maior entre o último pedido e o cadastro) mais antiga que p_dias. Mais recentes primeiro.
-- Sem limite interno: a edge function corta em 500.

create or replace function public.disparos_publico(p_barraca_id uuid, p_tipo text, p_dias integer)
returns table (telefone text, nome text)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
begin
  if p_tipo not in ('promocao', 'reativacao') then
    raise exception 'tipo_invalido';
  end if;
  if p_tipo = 'reativacao' and (p_dias is null or p_dias < 1) then
    raise exception 'dias_invalido';
  end if;
  return query
  select c.telefone, c.nome
    from public.clientes_finais c
    cross join lateral (
      select greatest(c.criado_em, coalesce(max(p.criado_em), c.criado_em)) as ultima
        from public.pedidos p
       where p.barraca_id = c.barraca_id
         and p.status <> 'cancelado'
         and (p.cliente_id = c.id or coalesce(p.cliente_telefone, p.entrega_telefone) = c.telefone)
    ) a
   where c.barraca_id = p_barraca_id
     and c.consentimento_marketing_em is not null
     and (p_tipo = 'promocao' or a.ultima < now() - make_interval(days => p_dias))
   order by a.ultima desc, c.telefone;
end;
$fn$;

create or replace function public.disparos_publico_contagem(p_barraca_id uuid, p_tipo text, p_dias integer)
returns integer
language sql
stable
security definer
set search_path = public, pg_temp
as $$ select count(*)::integer from public.disparos_publico(p_barraca_id, p_tipo, p_dias) $$;

create or replace function public.integracao_avaliacao_config(p_barraca_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'ativo', b.whatsapp_disparos_habilitado and b.avaliacao_ativa,
    'texto', b.avaliacao_texto,
    'whatsapp_dono', nullif(regexp_replace(coalesce(b.ia_whatsapp_dono, b.whatsapp_pedidos, ''), '\D', '', 'g'), ''),
    'barraca_nome', b.nome
  )
  from public.barracas b where b.id = p_barraca_id
$$;

revoke all on function public.disparos_publico(uuid, text, integer) from public, anon, authenticated;
revoke all on function public.disparos_publico_contagem(uuid, text, integer) from public, anon, authenticated;
revoke all on function public.integracao_avaliacao_config(uuid) from public, anon, authenticated;
grant execute on function public.disparos_publico(uuid, text, integer) to service_role;
grant execute on function public.disparos_publico_contagem(uuid, text, integer) to service_role;
grant execute on function public.integracao_avaliacao_config(uuid) to service_role;
