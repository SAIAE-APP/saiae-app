// Cria a cobrança Pix de um pedido montado no cardápio público — Fase 2+3
// do Cardápio Digital (CLAUDE.md, roadmap). Recebe só item_id/quantidade,
// NUNCA preço do cliente: o preço real é sempre resolvido aqui a partir
// de `itens`, senão dava pra forjar o valor no DevTools.
//
// O pedido de verdade em `pedidos`/`itens_do_pedido` só nasce quando o
// Mercado Pago confirma o pagamento (ver webhook-mercadopago) — até lá a
// cobrança fica isolada em `pagamentos_pendentes`. Usa a service role
// key: lê `barracas_pagamento_token` direto, sem passar pelas funções
// SECURITY DEFINER pensadas pro client autenticado.
import { createClient } from 'jsr:@supabase/supabase-js@2'

const MERCADOPAGO_API_URL = 'https://api.mercadopago.com/v1/orders'
const EXPIRACAO_PIX = 'PT30M' // 30 min — pedido de balcão, não faz sentido um QR que dure dias

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  })
}

type ItemCarrinho = { item_id: string; quantidade: number }

type ItemCadastroRow = {
  id: string
  nome: string
  preco_centavos: number
  ativo: boolean
  esgotado: boolean
}

type MercadoPagoQr = {
  ticket_url?: string
  qr_code?: string
  qr_code_base64?: string
}

async function buscarQrDaOrder(orderId: string, token: string) {
  const resposta = await fetch(`${MERCADOPAGO_API_URL}/${orderId}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  const dados = await resposta.json().catch(() => null)
  const pagamento = dados?.transactions?.payments?.[0]?.payment_method as MercadoPagoQr | undefined
  return {
    qr_code: pagamento?.qr_code ?? null,
    qr_code_base64: pagamento?.qr_code_base64 ?? null,
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS })
  }

  let body: {
    barraca_id?: string
    mesa?: string | null
    viagem?: boolean
    observacao?: string | null
    client_uuid?: string
    itens?: ItemCarrinho[]
  }
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ erro: 'JSON inválido' }, 400)
  }

  const { barraca_id, client_uuid, itens } = body
  if (!barraca_id || !client_uuid || !Array.isArray(itens) || itens.length === 0) {
    return jsonResponse({ erro: 'barraca_id, client_uuid e itens são obrigatórios' }, 400)
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  )

  // Idempotência: duplo toque / retry de rede não gera duas cobranças.
  const { data: pendenteExistente } = await supabase
    .from('pagamentos_pendentes')
    .select('id, barraca_id, mercadopago_order_id')
    .eq('client_uuid', client_uuid)
    .maybeSingle()

  if (pendenteExistente?.mercadopago_order_id) {
    const { data: tokenRow } = await supabase
      .from('barracas_pagamento_token')
      .select('access_token')
      .eq('barraca_id', pendenteExistente.barraca_id)
      .maybeSingle()

    if (tokenRow?.access_token) {
      const qr = await buscarQrDaOrder(pendenteExistente.mercadopago_order_id, tokenRow.access_token)
      return jsonResponse({ pendente_id: pendenteExistente.id, ...qr })
    }
  }

  const { data: barraca, error: erroBarraca } = await supabase
    .from('barracas')
    .select('id, pagamento_online_habilitado')
    .eq('id', barraca_id)
    .single()

  if (erroBarraca || !barraca) {
    return jsonResponse({ erro: 'Barraca não encontrada' }, 404)
  }

  if (!barraca.pagamento_online_habilitado) {
    return jsonResponse({ erro: 'Pagamento online não habilitado para esta barraca' }, 422)
  }

  const { data: tokenRow, error: erroToken } = await supabase
    .from('barracas_pagamento_token')
    .select('access_token')
    .eq('barraca_id', barraca_id)
    .maybeSingle()

  if (erroToken || !tokenRow?.access_token) {
    return jsonResponse({ erro: 'Token do Mercado Pago não configurado' }, 422)
  }

  // Preço SEMPRE resolvido aqui a partir do cardápio real — o que o
  // cliente manda é só item_id + quantidade.
  const idsItens = itens.map((i) => i.item_id)
  const { data: itensCadastro, error: erroItens } = await supabase
    .from('itens')
    .select('id, nome, preco_centavos, ativo, esgotado')
    .eq('barraca_id', barraca_id)
    .in('id', idsItens)

  if (erroItens) {
    return jsonResponse({ erro: 'Falha ao carregar o cardápio' }, 500)
  }

  const cadastroPorId = new Map<string, ItemCadastroRow>(
    ((itensCadastro ?? []) as ItemCadastroRow[]).map((item) => [item.id, item]),
  )

  const itensResolvidos: { item_id: string; nome_item: string; quantidade: number; preco_centavos_unitario: number }[] = []
  const indisponiveis: string[] = []

  for (const linha of itens) {
    const quantidade = Math.max(1, Math.floor(Number(linha.quantidade) || 0))
    const cadastro = cadastroPorId.get(linha.item_id)
    if (!cadastro || !cadastro.ativo || cadastro.esgotado) {
      indisponiveis.push(cadastro?.nome ?? linha.item_id)
      continue
    }
    itensResolvidos.push({
      item_id: cadastro.id,
      nome_item: cadastro.nome,
      quantidade,
      preco_centavos_unitario: cadastro.preco_centavos,
    })
  }

  if (indisponiveis.length > 0) {
    return jsonResponse({ erro: `Item(ns) indisponível(is): ${indisponiveis.join(', ')}` }, 422)
  }

  const totalCentavos = itensResolvidos.reduce(
    (soma, item) => soma + item.preco_centavos_unitario * item.quantidade,
    0,
  )
  if (totalCentavos <= 0) {
    return jsonResponse({ erro: 'Carrinho vazio' }, 422)
  }

  const { data: pendente, error: erroPendente } = await supabase
    .from('pagamentos_pendentes')
    .insert({
      barraca_id,
      mesa: body.mesa || null,
      viagem: Boolean(body.viagem),
      observacao: body.observacao || null,
      itens: itensResolvidos,
      client_uuid,
    })
    .select('id')
    .single()

  if (erroPendente || !pendente) {
    return jsonResponse({ erro: 'Falha ao registrar o pedido' }, 500)
  }

  const totalFormatado = (totalCentavos / 100).toFixed(2)

  let respostaMp: Response
  try {
    respostaMp = await fetch(MERCADOPAGO_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tokenRow.access_token}`,
        'Content-Type': 'application/json',
        'X-Idempotency-Key': client_uuid,
      },
      body: JSON.stringify({
        type: 'online',
        total_amount: totalFormatado,
        external_reference: pendente.id,
        processing_mode: 'automatic',
        transactions: {
          payments: [
            {
              amount: totalFormatado,
              payment_method: { id: 'pix', type: 'bank_transfer' },
              expiration_time: EXPIRACAO_PIX,
            },
          ],
        },
        // Mercado Pago exige um e-mail de pagador; o cardápio público não
        // coleta e-mail do cliente final, então usa um placeholder por
        // pedido. Ajustar se a conta MP em produção exigir um e-mail real.
        payer: { email: `pedido-${pendente.id}@saiae.app` },
        notification_url: `${Deno.env.get('SUPABASE_URL')}/functions/v1/webhook-mercadopago`,
      }),
    })
  } catch (erroRede) {
    return jsonResponse({ erro: `Falha ao contatar o Mercado Pago: ${String(erroRede)}` }, 502)
  }

  const resultadoMp = await respostaMp.json().catch(() => null)

  if (!respostaMp.ok) {
    const mensagem = resultadoMp?.message ?? resultadoMp?.error ?? 'Erro desconhecido no Mercado Pago'
    return jsonResponse({ erro: mensagem, detalhe: resultadoMp }, 502)
  }

  await supabase
    .from('pagamentos_pendentes')
    .update({ mercadopago_order_id: resultadoMp.id })
    .eq('id', pendente.id)

  const pagamento = resultadoMp?.transactions?.payments?.[0]?.payment_method as MercadoPagoQr | undefined

  return jsonResponse({
    pendente_id: pendente.id,
    qr_code: pagamento?.qr_code ?? null,
    qr_code_base64: pagamento?.qr_code_base64 ?? null,
  })
})
