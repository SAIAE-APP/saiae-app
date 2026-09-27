// Recebe a notificação de status do Mercado Pago (order.processed) —
// Fase 2+3 do Cardápio Digital (CLAUDE.md, roadmap). NUNCA confia no
// corpo do webhook: confirma o status de verdade com um GET de volta pra
// API do Mercado Pago (prática recomendada na doc oficial) antes de
// materializar o pedido.
//
// Só quando o Mercado Pago confirma "approved" que o pedido de verdade
// nasce em pedidos/itens_do_pedido — via a própria função criar_pedido
// já existente (chamada com service role, que ignora RLS/SECURITY
// INVOKER), usando os itens/preços já validados que ficaram guardados em
// pagamentos_pendentes.itens. Se rejeitado/expirado, nenhum pedido chega
// a existir.
import { createClient } from 'jsr:@supabase/supabase-js@2'

const MERCADOPAGO_API_URL = 'https://api.mercadopago.com/v1/orders'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok')
  }

  const url = new URL(req.url)
  let orderId = url.searchParams.get('data.id') ?? url.searchParams.get('id')

  if (!orderId) {
    const corpo = await req.json().catch(() => null)
    orderId = corpo?.data?.id ?? null
  }

  // Mercado Pago exige 200/201 rápido — se não veio id nenhum não tem o
  // que fazer, mas ainda assim confirma o recebimento pra não gerar retry
  // infinito.
  if (!orderId) {
    return jsonResponse({ ok: true, aviso: 'sem id de order' })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  )

  const { data: pendente, error: erroPendente } = await supabase
    .from('pagamentos_pendentes')
    .select('id, barraca_id, mesa, viagem, observacao, itens, status, client_uuid')
    .eq('mercadopago_order_id', orderId)
    .maybeSingle()

  if (erroPendente || !pendente) {
    return jsonResponse({ ok: true, aviso: 'pagamento pendente não encontrado' })
  }

  // Já processado (retry do próprio Mercado Pago) — responde ok sem
  // reprocessar.
  if (pendente.status !== 'pendente') {
    return jsonResponse({ ok: true })
  }

  const { data: tokenRow } = await supabase
    .from('barracas_pagamento_token')
    .select('access_token')
    .eq('barraca_id', pendente.barraca_id)
    .maybeSingle()

  if (!tokenRow?.access_token) {
    return jsonResponse({ ok: true, aviso: 'token da barraca não encontrado' })
  }

  // Confirmação de verdade: GET na API do Mercado Pago com o token da
  // própria barraca, nunca confiando só no corpo do webhook.
  const respostaMp = await fetch(`${MERCADOPAGO_API_URL}/${orderId}`, {
    headers: { Authorization: `Bearer ${tokenRow.access_token}` },
  })
  const order = await respostaMp.json().catch(() => null)

  if (!respostaMp.ok || !order) {
    return jsonResponse({ ok: true, aviso: 'falha ao confirmar status na API do Mercado Pago' })
  }

  const statusMp = order.status as string
  const statusDetail = order.status_detail as string | undefined

  if (statusMp === 'approved' || statusDetail === 'accredited') {
    const { data: resultadoPedido, error: erroPedido } = await supabase
      .rpc('criar_pedido', {
        p_barraca_id: pendente.barraca_id,
        p_mesa: pendente.mesa,
        p_viagem: pendente.viagem,
        p_observacao: pendente.observacao,
        p_client_uuid: pendente.client_uuid,
        p_metodo_pagamento: 'pix',
        p_itens: pendente.itens,
      })
      .single()

    if (erroPedido || !resultadoPedido) {
      return jsonResponse({ ok: true, aviso: `falha ao criar pedido: ${erroPedido?.message}` })
    }

    await supabase
      .from('pagamentos_pendentes')
      .update({ status: 'aprovado', pedido_id: (resultadoPedido as { pedido_id: string }).pedido_id })
      .eq('id', pendente.id)

    return jsonResponse({ ok: true })
  }

  if (statusMp === 'cancelled' || statusMp === 'expired' || statusDetail === 'expired') {
    await supabase.from('pagamentos_pendentes').update({ status: 'expirado' }).eq('id', pendente.id)
    return jsonResponse({ ok: true })
  }

  if (statusMp === 'rejected' || statusDetail === 'rejected') {
    await supabase.from('pagamentos_pendentes').update({ status: 'rejeitado' }).eq('id', pendente.id)
    return jsonResponse({ ok: true })
  }

  // Ainda pendente do lado do Mercado Pago (ex.: action_required) — não
  // muda nada, espera a próxima notificação.
  return jsonResponse({ ok: true })
})
