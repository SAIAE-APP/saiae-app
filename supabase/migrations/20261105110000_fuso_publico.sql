-- Cardápio público: fuso da barraca para calcular "aberto/fechado" no horário DELA, não no do visitante.
-- Função nova e pequena (não mexe em cardapio_publico nem horarios_publicos); devolve só o fuso, nada privado.
-- Sem a migration o app cai em America/Sao_Paulo.
-- Rollback: drop function public.fuso_publico(text);

create or replace function public.fuso_publico(p_slug text)
returns text
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select b.fuso from barracas b where b.slug = p_slug;
$$;

grant execute on function public.fuso_publico(text) to anon, authenticated;
