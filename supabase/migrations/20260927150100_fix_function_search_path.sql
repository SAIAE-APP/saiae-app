-- SEGURANÇA (MÉDIO): 5 funções ficaram sem `search_path` fixo (achado do
-- linter de segurança do Supabase, "Function Search Path Mutable"). Sem
-- isso, uma função resolve nomes de tabela/função não qualificados de
-- acordo com o `search_path` de quem a chama — em teoria, um usuário com
-- permissão de CREATE num schema poderia criar um objeto "sombra" que
-- muda o comportamento da função (mais grave em `usuario_tem_acesso_barraca`,
-- que é SECURITY DEFINER e usada como checagem de acesso em quase toda
-- policy do projeto). Fix: fixa search_path = public, pg_temp em todas.

alter function public.usuario_tem_acesso_barraca(uuid)
  set search_path = public, pg_temp;

alter function public.assinatura_tem_acesso(assinaturas, timestamp with time zone)
  set search_path = public, pg_temp;

alter function public.minha_assinatura()
  set search_path = public, pg_temp;

alter function public.criar_pedido(uuid, text, boolean, text, text, text, jsonb)
  set search_path = public, pg_temp;

alter function public.set_senha_pedido()
  set search_path = public, pg_temp;
