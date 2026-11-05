-- Pedidos do cardápio público por semana e por barraca (métrica do projeto cardápio-hierarquia).
-- Somente leitura. Rodar no SQL editor do Supabase (staging ou produção) e comparar 2 a 4 semanas antes e depois do lançamento.
--
-- Não existe coluna de origem em `pedidos`. A consulta reconhece o pedido do cardápio público por dois rastros:
--   1. pagamento online (Pix ou cartão): há um `pagamentos_pendentes` aprovado ligado ao pedido por `pedido_id`;
--   2. "Pagar na entrega": a edge function `criar-pedido-cardapio` grava a observação começando por 'PAGAR NA ENTREGA'.
-- Limites conhecidos: (2) é um texto, não uma coluna. Um operador que digite esse prefixo à mão entra na conta, e se a
-- função mudar o texto o rastro some. Pedido de cupom grátis também passa por `pagamentos_pendentes` (conta em 1).
-- Se a métrica virar rotina, o correto é uma coluna `pedidos.origem` gravada por `criar_pedido` (migration própria).
-- Pedidos cancelados ficam de fora. A semana começa na segunda-feira, no fuso de Brasília.

select
  p.barraca_id,
  date_trunc('week', p.criado_em at time zone 'America/Sao_Paulo')::date as semana,
  count(*) as pedidos
from public.pedidos p
where p.status <> 'cancelado'
  and (
    exists (
      select 1
      from public.pagamentos_pendentes pp
      where pp.pedido_id = p.id
        and pp.status = 'aprovado'
    )
    or p.observacao like 'PAGAR NA ENTREGA%'
  )
group by 1, 2
order by 1, 2;
