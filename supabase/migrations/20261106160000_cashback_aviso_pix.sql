-- Cashback do cardápio digital, M7: o status do pagamento passa a informar o cashback gerado pelo pedido,
-- para o cliente ver "Você ganhou R$ X. Vale até DD/MM." na tela do Pix (polling).
-- ADITIVA no retorno: as três colunas atuais (status, senha, pedido_id) continuam na mesma ordem e com os
-- mesmos nomes; só acrescenta cashback_gerado_centavos e cashback_vence_em. Como o tipo de retorno muda,
-- a função é recriada (drop + create), mantendo security definer, search_path fixo e o grant a anon/authenticated.
-- Não expõe dado novo além do valor e da data do crédito do PRÓPRIO pagamento (o id é um uuid não adivinhável).
-- Rollback: recriar a função da migration 20260927130000_add_pagamento_online.sql.

drop function if exists public.consultar_status_pagamento(uuid);

create function public.consultar_status_pagamento(p_id uuid)
returns table (
  status text,
  senha int,
  pedido_id uuid,
  cashback_gerado_centavos integer,
  cashback_vence_em timestamptz
)
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select pp.status,
         p.senha,
         pp.pedido_id,
         coalesce(p.cashback_gerado_centavos, 0),
         (select l.expira_em
            from public.cashback_lancamentos l
           where l.pedido_id = pp.pedido_id and l.tipo = 'credito'
           limit 1)
    from public.pagamentos_pendentes pp
    left join public.pedidos p on p.id = pp.pedido_id
   where pp.id = p_id;
$$;

revoke all on function public.consultar_status_pagamento(uuid) from public;
grant execute on function public.consultar_status_pagamento(uuid) to anon, authenticated;
