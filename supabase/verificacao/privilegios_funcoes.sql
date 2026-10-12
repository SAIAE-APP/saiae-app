-- Verificação do M3 (rodar no SQL editor do Supabase, SÓ LEITURA).
-- Resultado esperado está em cada bloco. Nada aqui altera dados.

-- 1) O que `anon` ainda executa (SECURITY DEFINER no schema public).
--    Esperado: SOMENTE estas 12 (públicas de propósito):
--    bairros_entrega_publicos, banners_publicos, barraca_slug_atual, cardapio_publico,
--    consultar_status_pagamento, cupom_config, entregador_confirmar, entregador_pedido,
--    horarios_publicos, ofertas_publicas, opcoes_publicas, perfil_cliente_config
select p.proname, pg_get_function_identity_arguments(p.oid) as args
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.prosecdef
   and has_function_privilege('anon', p.oid, 'execute')
 order by 1;

-- 2) Grupo 1: anon = false; authenticated = true; service_role = true.
select p.proname, pg_get_function_identity_arguments(p.oid) as args,
       has_function_privilege('anon', p.oid, 'execute')          as anon,
       has_function_privilege('authenticated', p.oid, 'execute') as authenticated,
       has_function_privilege('service_role', p.oid, 'execute')  as service_role
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in (
     'apagar_barraca', 'assinatura_da_barraca', 'barraca_assinatura_ativa', 'cobranca_ativa',
     'criar_barraca', 'definir_senha_admin', 'definir_token_fiscal', 'definir_token_pagamento',
     'senha_admin_configurada', 'token_fiscal_configurado', 'token_pagamento_configurado',
     'verificar_senha_admin', 'usuario_tem_acesso_barraca')
 order by 1;

-- 3) Grupo 2 (+ job da assinatura): anon = false; authenticated = false.
select p.proname, pg_get_function_identity_arguments(p.oid) as args,
       has_function_privilege('anon', p.oid, 'execute')          as anon,
       has_function_privilege('authenticated', p.oid, 'execute') as authenticated
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in (
     'criar_assinatura_trial', 'trg_pedido_evento_criado', 'trg_pedido_evento_pago_na_entrega',
     'trg_pedido_evento_status', 'trg_pendente_evento_pago', 'processar_webhook_kirvano',
     'expirar_assinaturas_job')
 order by 1;

-- 4) Nenhuma linha esperada: função do grupo 1/2 ainda aberta para anon.
select p.proname
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and has_function_privilege('anon', p.oid, 'execute')
   and p.proname in (
     'apagar_barraca', 'assinatura_da_barraca', 'barraca_assinatura_ativa', 'cobranca_ativa',
     'criar_barraca', 'definir_senha_admin', 'definir_token_fiscal', 'definir_token_pagamento',
     'senha_admin_configurada', 'token_fiscal_configurado', 'token_pagamento_configurado',
     'verificar_senha_admin', 'usuario_tem_acesso_barraca', 'criar_assinatura_trial',
     'trg_pedido_evento_criado', 'trg_pedido_evento_pago_na_entrega', 'trg_pedido_evento_status',
     'trg_pendente_evento_pago', 'processar_webhook_kirvano', 'expirar_assinaturas_job');

-- 5) Default privileges: funções novas não devem nascer com EXECUTE para anon.
--    Esperado: nenhuma linha com 'anon=X' em defaclacl para objtype 'f' no schema public.
select pg_get_userbyid(d.defaclrole) as papel, d.defaclobjtype as tipo, d.defaclacl
  from pg_default_acl d
  join pg_namespace n on n.oid = d.defaclnamespace
 where n.nspname = 'public' and d.defaclobjtype = 'f';

-- Teste funcional manual depois de aplicar (app): login, criar loja, Ajustes > Fiscal e
-- Pagamento, PIN administrativo, cardápio público SEM login, link do entregador (/e/:token).
