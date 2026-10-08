-- SAI-010a, etapa 4a: leitura PÚBLICA (anon) dos grupos e opções do cardápio.
-- Spec: docs/superpowers/specs/2026-10-07-sai-010-adicionais-design.md (§5). Depende de 20261015100000.
--
-- `cardapio_publico` NÃO muda (app e PWA antigos seguem iguais). Os grupos vêm por RPC própria,
-- no padrão de banners_publicos / bairros_entrega_publicos: SECURITY DEFINER, sem abrir RLS
-- pública nas tabelas, e só o que o cliente final pode ver.
--
-- Só devolve linhas quando a loja liga `opcoes_habilitado`; loja sem isso = nenhuma linha = item plano.
-- Só grupos e opções ATIVOS, de itens ATIVOS. Opção esgotada vem com esgotado = true (o cardápio a
-- desabilita). Grupo ativo SEM nenhuma opção ativa vem como uma linha com opcao_id nulo, para o
-- front saber que um grupo obrigatório ficou sem opção (item não pedível).
-- A ordem das linhas é a de exibição: grupos pela ligação com o item, opções pela ordem.
--
-- Rollback: drop function if exists public.opcoes_publicas(text);

create or replace function public.opcoes_publicas(p_slug text)
returns table(
  item_id uuid,
  grupo_id uuid,
  grupo_nome text,
  grupo_tipo text,
  min_escolhas integer,
  max_escolhas integer,
  opcao_id uuid,
  opcao_nome text,
  opcao_preco_centavos integer,
  opcao_esgotado boolean
)
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select
    ig.item_id,
    g.id,
    g.nome,
    g.tipo,
    g.min_escolhas,
    g.max_escolhas,
    o.id,
    o.nome,
    o.preco_centavos,
    o.esgotado
  from public.barracas b
  join public.itens i on i.barraca_id = b.id and i.ativo
  join public.itens_grupos ig on ig.item_id = i.id
  join public.grupos_opcoes g on g.id = ig.grupo_id and g.barraca_id = ig.barraca_id and g.ativo
  left join public.opcoes o on o.grupo_id = g.id and o.ativo
  where b.slug = p_slug
    and b.opcoes_habilitado
  order by ig.item_id, ig.ordem, g.ordem, g.id, o.ordem, o.id;
$$;

grant execute on function public.opcoes_publicas(text) to anon, authenticated;
