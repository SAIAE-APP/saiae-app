-- Conciliação de Pix: registro de todo pagamento aprovado que NÃO virou pedido
-- pelo caminho normal, para o dinheiro do cliente nunca "sumir" em silêncio.
--
-- Casos (coluna `tipo`):
--   * valor_divergente   — o valor pago não bate com itens + taxa do snapshot. O
--                          webhook NÃO cria pedido; o dono confere e, se for o
--                          caso, devolve o dinheiro pelo painel do provedor.
--   * pago_apos_expirar  — aprovado depois de a cobrança expirar, com valor certo.
--                          O webhook cria o pedido normalmente (situacao =
--                          'pedido_criado') e deixa o registro para o dono saber.
--   * pedido_nao_criado  — aprovado e válido, mas `criar_pedido` falhou. O webhook
--                          responde 500 (o provedor reenvia); quando o pedido
--                          nasce, o registro vira 'resolvido'.
--
-- ADITIVA: tabela nova, nenhuma função existente é alterada. RLS: o dono só LÊ as
-- linhas das suas barracas; a escrita é só da service role (edge function). Aviso
-- no painel e marcação "resolvido" pelo dono vêm numa próxima história.
--
-- `pendente_id`/`barraca_id` em cascade: excluir a conta apaga os pendentes e a
-- barraca, e a conciliação vai junto. `pedido_id` set null: "Apagar período"
-- remove pedidos sem perder o registro de conciliação.

create table if not exists public.pagamentos_conciliacao (
  id uuid primary key default gen_random_uuid(),
  barraca_id uuid not null references public.barracas(id) on delete cascade,
  pendente_id uuid not null references public.pagamentos_pendentes(id) on delete cascade,
  provedor text not null,
  -- Id do pagamento no provedor (mesmo valor de pagamentos_pendentes.mercadopago_order_id).
  id_externo text not null,
  tipo text not null,
  situacao text not null default 'a_revisar',
  valor_pago_centavos integer,
  valor_esperado_centavos integer,
  pedido_id uuid references public.pedidos(id) on delete set null,
  detalhe text,
  criado_em timestamptz not null default now(),
  resolvido_em timestamptz,
  resolvido_por uuid,
  constraint pagamentos_conciliacao_tipo_valido
    check (tipo in ('valor_divergente', 'pago_apos_expirar', 'pedido_nao_criado')),
  constraint pagamentos_conciliacao_situacao_valida
    check (situacao in ('a_revisar', 'pedido_criado', 'resolvido')),
  constraint pagamentos_conciliacao_valores_validos
    check (
      (valor_pago_centavos is null or valor_pago_centavos >= 0)
      and (valor_esperado_centavos is null or valor_esperado_centavos >= 0)
    ),
  -- Idempotência: a mesma notificação repetida não duplica o registro.
  constraint pagamentos_conciliacao_unica unique (provedor, id_externo, tipo)
);

create index if not exists pagamentos_conciliacao_barraca_idx
  on public.pagamentos_conciliacao (barraca_id, situacao, criado_em desc);
create index if not exists pagamentos_conciliacao_pendente_idx
  on public.pagamentos_conciliacao (pendente_id);

alter table public.pagamentos_conciliacao enable row level security;

drop policy if exists "usuarios veem conciliacao de suas barracas" on public.pagamentos_conciliacao;
create policy "usuarios veem conciliacao de suas barracas"
on public.pagamentos_conciliacao
for select
to authenticated
using (usuario_tem_acesso_barraca(barraca_id));
