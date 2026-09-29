// Recebe a notificação de pagamento do Mercado Pago (Payments API, type
// "payment") — Fase 2+3 do Cardápio Digital (CLAUDE.md, roadmap). NUNCA
// confia no corpo do webhook: confirma o status de verdade com um GET de
// volta pra API do Mercado Pago, usando o token da barraca dona do
// pagamento (prática recomendada na doc oficial), e confere que o
// pagamento é mesmo daquele pendente (external_reference) e do valor certo.
//
// A notification_url é montada por pagamento em criar-pagamento-pix com
// `?pendente=<id>`, então a barraca (e o token dela) é achada pelo nosso
// banco ANTES de falar com o MP — cada dono usa a própria conta MP e não há
// webhook configurado no painel.
//
// Só quando o MP confirma "approved" o pedido de verdade nasce em
// pedidos/itens_do_pedido — via criar_pedido (service role), que é
// idempotente por client_uuid: notificação repetida ou concorrente não cria
// dois pedidos. Pendentes órfãos (sem pagamento no MP) nunca recebem
// notificação e portanto nunca viram pedido.
import { createClient } from 'jsr:@supabase/supabase-js@2'

const MERCADOPAGO_API_URL = 'https://api.mercadopago.com/v1/payments'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

type ItemPendente = { quantidade: number; preco_centavos_unitario: number }

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok')
  }

  const url = new URL(req.url)
  let pagamentoId = url.searchParams.get('data.id') ?? url.searchParams.get('id')
  let tipo = url.searchParams.get('type') ?? url.searchParams.get('topic')
  const pendenteIdUrl = url.searchParams.get('pendente')

  if (!pagamentoId || !tipo) {
    const corpo = await req.json().catch(() => null)
    pagamentoId = pagamentoId ?? (corpo?.data?.id != null ? String(corpo.data.id) : null)
    tipo = tipo ?? corpo?.type ?? corpo?.topic ?? null
  }

  // Mercado Pago exige 200/201 rápido — o que não é notificação de pagamento
  // (ou não tem id) ainda assim é confirmado pra não gerar retry infinito.
  if (!pagamentoId || (tipo && tipo !== 'payment')) {
    return jsonResponse({ ok: true, aviso: 'notificação ignorada' })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  )

  const consulta = supabase
    .from('pagamentos_pendentes')
    .select('id, barraca_id, mesa, viagem, observacao, itens, status, client_uuid, mercadopago_order_id')
  const { data: pendente, error: erroPendente } = pendenteIdUrl
    ? await consulta.eq('id', pendenteIdUrl).maybeSingle()
    : await consulta.eq('mercadopago_order_id', pagamentoId).maybeSingle()

  if (erroPendente || !pendente) {
    return jsonResponse({ ok: true, aviso: 'pagamento pendente não encontrado' })
  }

  // Já processado (retry do próprio Mercado Pago) — responde ok sem
  // reprocessar.
  if (pendente.status !== 'pendente') {
    return jsonResponse({ ok: true })
  }

  // O id da notificação tem que ser o do pagamento criado para este pendente.
  if (pendente.mercadopago_order_id && pendente.mercadopago_order_id !== pagamentoId) {
    return jsonResponse({ ok: true, aviso: 'pagamento não pertence a este pendente' })
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
  const respostaMp = await fetch(`${MERCADOPAGO_API_URL}/${pagamentoId}`, {
    headers: { Authorization: `Bearer ${tokenRow.access_token}` },
  })
  const pagamento = await respostaMp.json().catch(() => null)

  if (!respostaMp.ok || !pagamento) {
    return jsonResponse({ ok: true, aviso: 'falha ao confirmar status na API do Mercado Pago' })
  }

  if (String(pagamento.external_reference ?? '') !== pendente.id) {
    return jsonResponse({ ok: true, aviso: 'external_reference não confere' })
  }

  const statusMp = pagamento.status as string

  if (statusMp === 'approved') {
    const totalCentavos = (pendente.itens as ItemPendente[]).reduce(
      (soma, item) => soma + item.preco_centavos_unitario * item.quantidade,
      0,
    )
    if (Math.round(Number(pagamento.transaction_amount) * 100) !== totalCentavos) {
      return jsonResponse({ ok: true, aviso: 'valor pago não confere com o pedido' })
    }

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
      // 500 faz o MP tentar de novo depois — o pagamento já foi aprovado e o
      // pedido ainda não existe, então NÃO pode ser engolido como sucesso.
      return jsonResponse({ ok: false, aviso: `falha ao criar pedido: ${erroPedido?.message}` }, 500)
    }

    await supabase
      .from('pagamentos_pendentes')
      .update({ status: 'aprovado', pedido_id: (resultadoPedido as { pedido_id: string }).pedido_id })
      .eq('id', pendente.id)

    return jsonResponse({ ok: true })
  }

  if (statusMp === 'cancelled' || statusMp === 'expired') {
    await supabase.from('pagamentos_pendentes').update({ status: 'expirado' }).eq('id', pendente.id)
    return jsonResponse({ ok: true })
  }

  if (statusMp === 'rejected') {
    await supabase.from('pagamentos_pendentes').update({ status: 'rejeitado' }).eq('id', pendente.id)
    return jsonResponse({ ok: true })
  }

  // Ainda pendente do lado do Mercado Pago (pending / in_process) — não muda
  // nada, espera a próxima notificação.
  return jsonResponse({ ok: true })
})
