-- Módulo Fiscal pago: vigência, bloqueios e regras de emissão. ADITIVA (colunas e funções novas; recria 4 funções só
-- para somar uma recusa). Depende de 20261110110000 (fiscal_assinaturas) e de modulos_definir_interno (20261103110000).
--
-- 1) Base paga e vigente: UM predicado (assinatura_base_paga_vigente) usado pelo checkout fiscal (backend) e pela
--    emissão (fiscal_emissao_bloqueio). Vale quando a assinatura base está `active`, não bloqueada e:
--      a) tem assinatura Stripe E já teve um pagamento > 0 (assinaturas.pago_em) E o período não venceu há mais de
--         3 dias (folga para o webhook de renovação). Trial da Stripe (no_payment_required, fatura zero) e cupom de
--         100% NÃO têm pago_em, então não contratam fiscal; ou
--      b) é legado (origem_plano = 'legado', Pro dado antes da cobrança, sem Stripe) em `active`: mantém o direito
--         de hoje. Decisão conservadora: quem já tinha o Pro continua podendo contratar e emitir.
--    Trial do app, past_due, canceled, expired e conta bloqueada pelo admin: não vale.
-- 2) Módulo fiscal ligado pela cobrança (origem 'pago'): fiscal_sincronizar_modulo(barraca) lê o ESTADO FINAL de
--    fiscal_assinaturas sob lock da barraca e põe o módulo no estado certo. Quem roda por último vê a última linha,
--    então um `deleted` mais novo nunca é desfeito por um pagamento atrasado. Só desliga módulo de origem 'pago'
--    (cortesia do admin nunca é tocada) e só quando NENHUMA assinatura fiscal da barraca está vigente (uma
--    assinatura antiga encerrando não desliga a que é a fonte da vigência).
--    Carência única: modulo_ativo concede pago_ate + 7 dias. Para o acesso terminar exatamente onde a cobrança diz:
--      active   -> pago_ate = fim do período (os 7 dias de modulo_ativo cobrem atraso do webhook de renovação)
--      past_due -> pago_ate = grace_until - 7 dias  (acesso até grace_until = 3 dias depois da falha)
--      canceled -> pago_ate = fim do período - 7 dias (acesso até o fim do período pago, nem um dia a mais)
-- 3) Emissão: fiscal_emissao_bloqueio(barraca) devolve null (pode emitir) ou um código. Só confere módulo de origem
--    'pago' com assinatura fiscal na tabela: base sem vigência => 'base_sem_vigencia'; CNPJ da barraca diferente do
--    contratado => 'cnpj_divergente'. Cortesia/teste do admin e 'pago' lançado à mão (sem linha em fiscal_assinaturas)
--    não são conferidos.
-- 4) Remoção: barraca com assinatura/reserva fiscal que ocupa o CNPJ (pendente, active, past_due, canceled vigente) não
--    pode ser apagada pelo dono, arquivada nem apagada em definitivo (a cobrança ficaria órfã).
-- Limitação (titularidade do CNPJ): não há como provar que o dono do app é o titular do CNPJ. O que existe é o token
--    da FocusNFe por empresa (a emissão falha se o token não for daquele CNPJ) e esta checagem de divergência.
-- Rollback: drop function if exists public.fiscal_emissao_bloqueio(uuid); drop function if exists public.fiscal_sincronizar_modulo(uuid, text);
--           drop function if exists public.fiscal_bloqueia_remocao(uuid); drop function if exists public.assinatura_base_paga_vigente(uuid);
--           alter table public.assinaturas drop column if exists pago_em;
--           recriar apagar_barraca, admin_arquivar_barraca, barracas_para_apagar e apagar_dados_barraca a partir de 20261108120000.

-- ---------------------------------------------------------------------------------------------------------------
-- pago_em: último pagamento Stripe com valor > 0 (o webhook grava no invoice.paid). Backfill pelos eventos já recebidos.
alter table public.assinaturas add column if not exists pago_em timestamptz;

update public.assinaturas a
   set pago_em = (
     select max(e.received_at)
       from public.eventos_webhook_stripe e
      where e.subscription_id = a.stripe_subscription_id
        and e.event = 'invoice.paid'
        and e.error is null
        and coalesce((e.payload #>> '{data,object,amount_paid}')::numeric, 0) > 0
   )
 where a.stripe_subscription_id is not null and a.pago_em is null;

-- ---------------------------------------------------------------------------------------------------------------
create or replace function public.assinatura_base_paga_vigente(p_usuario_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
      from public.assinaturas a
     where a.usuario_id = p_usuario_id
       and not coalesce(a.bloqueada_admin, false)
       and a.status = 'active'
       and (
         (a.stripe_subscription_id is not null
          and a.pago_em is not null
          and a.current_period_end is not null
          and now() <= a.current_period_end + interval '3 days')
         or (a.stripe_subscription_id is null and a.origem_plano = 'legado')
       )
  );
$$;
revoke all on function public.assinatura_base_paga_vigente(uuid) from public, anon, authenticated;
grant execute on function public.assinatura_base_paga_vigente(uuid) to service_role;

-- ---------------------------------------------------------------------------------------------------------------
create or replace function public.fiscal_bloqueia_remocao(p_barraca_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.fiscal_assinaturas f
     where f.barraca_id = p_barraca_id
       and public.fiscal_assinatura_ocupa(f.status, f.current_period_end)
  );
$$;
revoke all on function public.fiscal_bloqueia_remocao(uuid) from public, anon, authenticated;
grant execute on function public.fiscal_bloqueia_remocao(uuid) to service_role;

-- ---------------------------------------------------------------------------------------------------------------
create or replace function public.fiscal_sincronizar_modulo(p_barraca_id uuid, p_termo_versao text default null)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  f public.fiscal_assinaturas%rowtype;
  v_pago_ate timestamptz;
  v_res jsonb;
begin
  -- Serializa por barraca: duas sincronizações concorrentes não se cruzam.
  perform 1 from public.barracas where id = p_barraca_id for update;
  if not found then
    return 'barraca_inexistente';
  end if;

  select * into f
    from public.fiscal_assinaturas x
   where x.barraca_id = p_barraca_id
     and x.current_period_end is not null
     and (x.status in ('active', 'past_due') or (x.status = 'canceled' and x.current_period_end > now()))
   order by x.current_period_end desc
   limit 1;

  if found then
    v_pago_ate := case f.status
      when 'active' then f.current_period_end
      when 'past_due' then coalesce(f.grace_until, f.current_period_end) - interval '7 days'
      else f.current_period_end - interval '7 days'
    end;
    v_res := public.modulos_definir_interno(p_barraca_id, 'fiscal', 'ativo', 'pago', null, v_pago_ate, p_termo_versao);
    return coalesce(v_res ->> 'estado', 'invalido');
  end if;

  -- Nada vigente: desliga SÓ o módulo que a cobrança ligou (cortesia e teste do admin ficam como estão).
  if exists (
    select 1 from public.modulos_barraca m
     where m.barraca_id = p_barraca_id and m.modulo = 'fiscal' and m.origem = 'pago' and m.estado = 'ativo'
  ) then
    v_res := public.modulos_definir_interno(p_barraca_id, 'fiscal', 'cancelado', 'pago', null, null, null);
    return coalesce(v_res ->> 'estado', 'invalido');
  end if;
  return 'sem_alteracao';
end;
$$;
revoke all on function public.fiscal_sincronizar_modulo(uuid, text) from public, anon, authenticated;
grant execute on function public.fiscal_sincronizar_modulo(uuid, text) to service_role;

-- ---------------------------------------------------------------------------------------------------------------
create or replace function public.fiscal_emissao_bloqueio(p_barraca_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  m public.modulos_barraca%rowtype;
  f public.fiscal_assinaturas%rowtype;
  v_cnpj text;
begin
  select * into m from public.modulos_barraca where barraca_id = p_barraca_id and modulo = 'fiscal';
  if not found or m.origem <> 'pago' or m.estado <> 'ativo' then
    return null; -- cortesia ou teste do admin: comportamento de sempre
  end if;

  select * into f
    from public.fiscal_assinaturas x
   where x.barraca_id = p_barraca_id
     and x.current_period_end is not null
     and (x.status in ('active', 'past_due') or (x.status = 'canceled' and x.current_period_end > now()))
   order by x.current_period_end desc
   limit 1;
  if not found then
    return null; -- 'pago' lançado pelo admin sem cobrança Stripe: não há o que conferir
  end if;

  if not public.assinatura_base_paga_vigente(f.usuario_id) then
    return 'base_sem_vigencia';
  end if;

  select regexp_replace(coalesce(b.cnpj, ''), '\D', '', 'g') into v_cnpj from public.barracas b where b.id = p_barraca_id;
  if v_cnpj is distinct from f.cnpj then
    return 'cnpj_divergente';
  end if;
  return null;
end;
$$;
revoke all on function public.fiscal_emissao_bloqueio(uuid) from public, anon, authenticated;
grant execute on function public.fiscal_emissao_bloqueio(uuid) to service_role;

-- ---------------------------------------------------------------------------------------------------------------
-- Remoção bloqueada enquanto a cobrança fiscal ocupa a barraca. Corpos iguais a 20261108120000; só soma a recusa.
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
  if public.fiscal_bloqueia_remocao(p_barraca_id) then
    raise exception 'Esta barraca tem o módulo Fiscal contratado. Cancele o Fiscal e espere o fim do período já pago antes de apagá-la.';
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
  if public.fiscal_bloqueia_remocao(p_barraca_id) then
    raise exception 'a barraca tem assinatura do módulo Fiscal vigente: cancele a cobrança e espere o fim do período antes de arquivar'
      using errcode = '22023';
  end if;

  update public.barracas set arquivada_em = now() where id = p_barraca_id;
  perform public.admin_registrar_acao('arquivar_barraca', 'barraca', p_barraca_id, jsonb_build_object('nome', v_nome));
end;
$$;

create or replace function public.barracas_para_apagar()
returns table (barraca_id uuid)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select b.id from public.barracas b
   where b.arquivada_em < now() - interval '30 days'
     and not public.fiscal_bloqueia_remocao(b.id)
   order by b.arquivada_em;
$$;

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
  if public.fiscal_bloqueia_remocao(p_barraca_id) then
    raise exception 'a barraca tem assinatura do módulo Fiscal vigente: não pode ser apagada' using errcode = '22023';
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
