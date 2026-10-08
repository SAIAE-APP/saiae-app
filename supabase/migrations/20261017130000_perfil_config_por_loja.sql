-- O "Entrar" do cardápio público só aparece nas lojas em que o dono LIGOU o perfil.
-- Antes: perfil_cliente_config devolvia uma linha para qualquer loja (o app entendia "perfil disponível" em todas).
-- Agora: sem linha = perfil indisponível (o app esconde o link e não pede cadastro). Com a flag ligada devolve
-- obrigatorio = true. Aditiva: create or replace; mesma assinatura.
create or replace function public.perfil_cliente_config(p_slug text)
returns table (obrigatorio boolean)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select b.perfil_cliente_obrigatorio
    from public.barracas b
   where b.slug = p_slug and b.perfil_cliente_obrigatorio
   limit 1;
$$;

revoke all on function public.perfil_cliente_config(text) from public;
grant execute on function public.perfil_cliente_config(text) to anon, authenticated;
