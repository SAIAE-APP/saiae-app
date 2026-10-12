-- Auditoria M3: funções SECURITY DEFINER ainda executáveis por `anon` em produção.
--
-- No Supabase, `REVOKE ... FROM PUBLIC` não basta: o projeto concede EXECUTE a `anon`
-- por default privileges, e o pseudo-papel PUBLIC também vale para anon. Por isso o
-- revoke é de `public` E de `anon`, função por função.
--
-- Lista REAL (consulta do dono em 2026-10-12). NÃO tocadas, públicas de propósito:
--   bairros_entrega_publicos, banners_publicos, barraca_slug_atual, cardapio_publico,
--   consultar_status_pagamento, cupom_config, entregador_confirmar, entregador_pedido,
--   horarios_publicos, ofertas_publicas (sem uso no app; segue pública até o dono decidir),
--   opcoes_publicas, perfil_cliente_config.
-- Também NÃO tocadas: onboarding_* e slug_disponivel (já protegidas) e
-- expirar_assinaturas_job (migration 20261024110000).
--
-- Grupo 1 (usadas só por usuário logado e/ou policies RLS `to authenticated`):
--   revoga de public/anon, mantém authenticated e o papel de serviço.
--   usuario_tem_acesso_barraca é chamada por policies; todas as policies que a usam
--   são `to authenticated` (conferido em supabase/migrations e supabase/functions/*.sql;
--   as de storage.objects públicas só checam bucket_id). Função SECURITY DEFINER chamando
--   outra função roda como dono, então RPCs públicas não dependem desse grant.
-- Grupo 2 (só job, trigger ou papel de serviço): revoga de public/anon/authenticated.
--   Trigger não exige EXECUTE do papel que dispara o evento.
--   processar_webhook_kirvano: removida em 20261026100000 (Pacote 4); aqui só cobre o caso
--   de aplicar fora de ordem.
--
-- Só atua em funções que existem (reexecutável). Assinaturas resolvidas via pg_proc,
-- então vale para qualquer sobrecarga.
-- Verificação: supabase/verificacao/privilegios_funcoes.sql.

do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = any (array[
         'apagar_barraca', 'assinatura_da_barraca', 'barraca_assinatura_ativa', 'cobranca_ativa',
         'criar_barraca', 'definir_senha_admin', 'definir_token_fiscal', 'definir_token_pagamento',
         'senha_admin_configurada', 'token_fiscal_configurado', 'token_pagamento_configurado',
         'verificar_senha_admin', 'usuario_tem_acesso_barraca'
       ])
  loop
    execute format('revoke all on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated, service_role', r.sig);
  end loop;

  for r in
    select p.oid::regprocedure as sig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = any (array[
         'criar_assinatura_trial', 'trg_pedido_evento_criado', 'trg_pedido_evento_pago_na_entrega',
         'trg_pedido_evento_status', 'trg_pendente_evento_pago', 'processar_webhook_kirvano'
       ])
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
  end loop;
end;
$$;

-- Funções futuras nascem sem EXECUTE para anon. Quem precisar de função pública passa a
-- conceder `grant execute ... to anon` explicitamente (padrão das migrations recentes).
-- Atenção: isso NÃO tira o EXECUTE implícito de PUBLIC em função nova; por isso toda
-- migration nova de função sensível continua precisando de `revoke all ... from public, anon`.
-- Tolerante: sem permissão para alterar o default de um dos papéis, só avisa.
do $$
begin
  alter default privileges for role postgres in schema public revoke execute on functions from anon;
exception when others then
  raise warning 'default privileges (postgres) não alterados: %', sqlerrm;
end;
$$;

do $$
begin
  alter default privileges for role supabase_admin in schema public revoke execute on functions from anon;
exception when others then
  raise warning 'default privileges (supabase_admin) não alterados: %', sqlerrm;
end;
$$;
