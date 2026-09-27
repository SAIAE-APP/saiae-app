-- SEGURANÇA (CRÍTICO): as policies de INSERT em `pedidos` e
-- `itens_do_pedido` existiam como DUAS policies PERMISSIVE separadas:
--   1. "usuarios inserem ... em suas barracas" — usuario_tem_acesso_barraca()
--   2. "assinatura da barraca precisa estar ativa pra novos ..." — barraca_assinatura_ativa()
--
-- No Postgres, múltiplas policies PERMISSIVE pro mesmo comando (INSERT) se
-- combinam com OR, não AND. Ou seja, bastava UMA das duas passar. Como
-- `barraca_assinatura_ativa(barraca_id)` não verifica se o usuário
-- autenticado pertence àquela barraca — só se o DONO da barraca tem
-- assinatura ativa — qualquer usuário autenticado (de QUALQUER barraca,
-- inclusive uma conta trial recém-criada) conseguia inserir pedidos e
-- itens em pedidos de OUTRAS barracas, desde que a barraca alvo tivesse
-- assinatura ativa (o caso comum — clientes pagantes). O `barraca_id`
-- alvo é descobrível por qualquer pessoa via `cardapio_publico(slug)`,
-- que é intencionalmente pública (CLAUDE.md) e devolve `barraca_id` no
-- primeiro campo.
--
-- Isso furava a invariante de multi-tenant do projeto ("toda tabela tem
-- barraca_id, toda query filtra por ele", CLAUDE.md) permitindo um
-- atacante autenticado injetar comandas falsas na cozinha de QUALQUER
-- outra barraca.
--
-- Fix: substitui os dois pares de policies por UMA policy de INSERT por
-- tabela que exige as DUAS condições (AND), preservando as duas regras
-- de negócio originais sem reabrir o bypass.

begin;

drop policy if exists "usuarios inserem pedidos em suas barracas" on public.pedidos;
drop policy if exists "assinatura da barraca precisa estar ativa pra novos pedidos" on public.pedidos;

create policy "usuarios inserem pedidos em suas barracas com assinatura ativa"
on public.pedidos
as permissive
for insert
to authenticated
with check (
  public.usuario_tem_acesso_barraca(barraca_id)
  and public.barraca_assinatura_ativa(barraca_id)
);

drop policy if exists "usuarios inserem itens_do_pedido em suas barracas" on public.itens_do_pedido;
drop policy if exists "assinatura da barraca precisa estar ativa pra novos itens" on public.itens_do_pedido;

create policy "usuarios inserem itens_do_pedido em suas barracas com assinatura ativa"
on public.itens_do_pedido
as permissive
for insert
to authenticated
with check (
  exists (
    select 1 from public.pedidos
    where pedidos.id = itens_do_pedido.pedido_id
      and public.usuario_tem_acesso_barraca(pedidos.barraca_id)
      and public.barraca_assinatura_ativa(pedidos.barraca_id)
  )
);

commit;
