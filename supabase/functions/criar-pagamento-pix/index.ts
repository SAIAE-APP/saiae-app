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

// Payments API (não Orders): a Orders API rejeita `notification_url` no body
// ("additionalProperties '$.notification_url' not allowed") e lá o webhook só
// existe configurado no painel da aplicação MP. Como cada barraca usa o
// PRÓPRIO token/app do Mercado Pago, depender do painel de cada dono é frágil
// — em /v1/payments a notification_url vai por pagamento.
const MERCADOPAGO_API_URL = 'https://api.mercadopago.com/v1/payments'
// Mínimo aceito pelo MP é 30 min; 35 dá folga pra diferença de relógio.
// Pedido de balcão, não faz sentido um QR que dure dias.
const EXPIRACAO_PIX_MS = 35 * 60 * 1000

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

/** Entrega estruturada vinda do formulário do cardápio (tudo texto do cliente:
 * só é sanitizado aqui; a TAXA nunca vem do cliente). */
type EntregaBody = {
  nome?: string
  telefone?: string
  rua?: string
  numero?: string
  bairro?: string
  referencia?: string | null
  consentimento_lgpd?: boolean
}

type TaxaEntregaRow = { permitido: boolean; taxa_centavos: number; origem: string }

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

function extrairQr(pagamento: unknown) {
  const dados = (pagamento as { point_of_interaction?: { transaction_data?: MercadoPagoQr } } | null)
    ?.point_of_interaction?.transaction_data
  return {
    qr_code: dados?.qr_code ?? null,
    qr_code_base64: dados?.qr_code_base64 ?? null,
    ticket_url: dados?.ticket_url ?? null,
  }
}

async function buscarQrDoPagamento(pagamentoId: string, token: string) {
  const resposta = await fetch(`${MERCADOPAGO_API_URL}/${pagamentoId}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  return extrairQr(await resposta.json().catch(() => null))
}

// O MP pede date_of_expiration com offset (ex.: 2026-09-29T12:00:00.000-03:00).
function dataExpiracao(): string {
  const brasilia = new Date(Date.now() + EXPIRACAO_PIX_MS - 3 * 60 * 60 * 1000)
  return brasilia.toISOString().replace('Z', '-03:00')
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
    /** Só 'entrega' muda o fluxo; ausente = exatamente o comportamento de sempre. */
    tipo_atendimento?: string | null
    entrega?: EntregaBody | null
    /** Nome opcional do cliente (fora da Entrega, onde vale o nome do formulário). */
    cliente_nome?: string | null
    /** Total que o cliente viu na tela (itens + taxa). Se o servidor calcular outro, não cobra. */
    total_esperado_centavos?: number | null
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
      const qr = await buscarQrDoPagamento(pendenteExistente.mercadopago_order_id, tokenRow.access_token)
      return jsonResponse({ pendente_id: pendenteExistente.id, ...qr })
    }
  }

  const { data: barraca, error: erroBarraca } = await supabase
    .from('barracas')
    .select('id, pagamento_online_habilitado, modos_atendimento')
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

  // ---- Entrega (só quando pedida; sem ela nada abaixo muda o fluxo antigo) ----
  const ehEntrega = body.tipo_atendimento === 'entrega'
  let entregaSnapshot: Record<string, string | null> | null = null
  let taxaEntregaCentavos = 0
  let clienteNome: string | null = String(body.cliente_nome ?? '').trim().slice(0, 60) || null

  if (ehEntrega) {
    const modos = (barraca.modos_atendimento ?? []) as string[]
    if (!modos.includes('entrega')) {
      return jsonResponse({ erro: 'Esta barraca não está aceitando pedidos de entrega' }, 422)
    }

    const e = body.entrega ?? {}
    const texto = (valor: unknown, max: number) => String(valor ?? '').trim().slice(0, max)
    const nome = texto(e.nome, 60)
    const telefone = String(e.telefone ?? '').replace(/D/g, '')
    const rua = texto(e.rua, 120)
    const numero = texto(e.numero, 20)
    const bairro = texto(e.bairro, 80)
    const referencia = texto(e.referencia, 120) || null

    if (nome.length < 2) return jsonResponse({ erro: 'Informe seu nome' }, 422)
    if (telefone.length < 10 || telefone.length > 13) {
      return jsonResponse({ erro: 'Informe um telefone com DDD' }, 422)
    }
    if (!rua || !numero || !bairro) {
      return jsonResponse({ erro: 'Informe rua, número e bairro da entrega' }, 422)
    }
    // LGPD: o cadastro do cliente só é guardado com o consentimento visível.
    if (e.consentimento_lgpd !== true) {
      return jsonResponse({ erro: 'É preciso aceitar o uso dos seus dados para a entrega' }, 422)
    }

    // A taxa é SEMPRE calculada aqui (contrato do sprint 2: função só da
    // service role). Falha ao calcular NÃO cai em taxa 0 — é dinheiro: sem
    // taxa confiável, não cobra.
    const { data: taxaData, error: erroTaxa } = await supabase.rpc('taxa_entrega_do_bairro', {
      p_barraca_id: barraca_id,
      p_bairro: bairro,
    })
    const taxa = (Array.isArray(taxaData) ? taxaData[0] : taxaData) as TaxaEntregaRow | null
    if (erroTaxa || !taxa) {
      console.error('criar-pagamento-pix: taxa_entrega_do_bairro falhou', erroTaxa?.message)
      return jsonResponse({ erro: 'Não foi possível calcular a taxa de entrega agora. Tente de novo.' }, 500)
    }
    if (!taxa.permitido) {
      return jsonResponse({ erro: 'Não entregamos nesse bairro.' }, 422)
    }
    if (!Number.isInteger(taxa.taxa_centavos) || taxa.taxa_centavos < 0) {
      console.error('criar-pagamento-pix: taxa inválida', taxa)
      return jsonResponse({ erro: 'Não foi possível calcular a taxa de entrega agora. Tente de novo.' }, 500)
    }

    taxaEntregaCentavos = taxa.taxa_centavos
    clienteNome = nome
    entregaSnapshot = {
      nome,
      telefone,
      rua,
      numero,
      bairro,
      referencia,
      consentimento_lgpd_em: new Date().toISOString(),
    }
  }

  // Tudo em centavos INTEIROS; só vira reais na última linha (MP).
  const totalCobradoCentavos = totalCentavos + taxaEntregaCentavos

  // Cliente viu um total na tela; se o servidor chegou a outro (dono mexeu na
  // taxa/preço no meio), NÃO cobra sem o cliente ver o novo valor.
  const esperado = body.total_esperado_centavos
  if (esperado !== undefined && esperado !== null && esperado !== totalCobradoCentavos) {
    return jsonResponse(
      {
        erro: 'O valor do pedido mudou. Confira o novo total antes de pagar.',
        total_centavos: totalCobradoCentavos,
        taxa_entrega_centavos: taxaEntregaCentavos,
      },
      409,
    )
  }

  // Retry depois de uma falha do MP (pendente já existe, sem pagamento no MP):
  // reaproveita a linha em vez de estourar a unique de client_uuid. Só
  // reaproveita se ainda está pendente e é da mesma barraca.
  let pendente: { id: string } | null = null
  if (
    pendenteExistente &&
    !pendenteExistente.mercadopago_order_id &&
    pendenteExistente.barraca_id === barraca_id
  ) {
    const { data: reaproveitado } = await supabase
      .from('pagamentos_pendentes')
      .update({
        mesa: ehEntrega ? null : body.mesa || null,
        viagem: ehEntrega ? true : Boolean(body.viagem),
        observacao: body.observacao || null,
        itens: itensResolvidos,
        // Reaproveitado: o snapshot de entrega acompanha os itens.
        tipo_atendimento: ehEntrega ? 'entrega' : null,
        entrega: entregaSnapshot,
        taxa_entrega_centavos: taxaEntregaCentavos,
        cliente_nome: clienteNome,
      })
      .eq('id', pendenteExistente.id)
      .eq('status', 'pendente')
      .select('id')
      .maybeSingle()
    pendente = reaproveitado
  }

  if (!pendente) {
    const { data: criado, error: erroPendente } = await supabase
      .from('pagamentos_pendentes')
      .insert({
        barraca_id,
        mesa: ehEntrega ? null : body.mesa || null,
        viagem: ehEntrega ? true : Boolean(body.viagem),
        observacao: body.observacao || null,
        itens: itensResolvidos,
        client_uuid,
        // Só entram quando há entrega: pedido comum insere EXATAMENTE o que
        // inseria antes (as colunas novas ficam NULL/0 pelo default).
        ...(ehEntrega
          ? {
              tipo_atendimento: 'entrega',
              entrega: entregaSnapshot,
              taxa_entrega_centavos: taxaEntregaCentavos,
              cliente_nome: clienteNome,
            }
          : {}),
      })
      .select('id')
      .single()

    if (erroPendente || !criado) {
      return jsonResponse({ erro: 'Falha ao registrar o pedido', detalhe: erroPendente?.message }, 500)
    }
    pendente = criado
  }

  let respostaMp: Response
  try {
    respostaMp = await fetch(MERCADOPAGO_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tokenRow.access_token}`,
        'Content-Type': 'application/json',
        // Um pagamento por pendente: retry do mesmo pendente devolve o mesmo
        // pagamento em vez de cobrar duas vezes.
        'X-Idempotency-Key': pendente.id,
      },
      body: JSON.stringify({
        transaction_amount: totalCobradoCentavos / 100,
        payment_method_id: 'pix',
        description: ehEntrega ? 'Pedido com entrega no cardápio digital' : 'Pedido no cardápio digital',
        external_reference: pendente.id,
        date_of_expiration: dataExpiracao(),
        // Mercado Pago exige um e-mail de pagador; o cardápio público não
        // coleta e-mail do cliente final, então usa um endereço por pedido
        // num domínio nosso.
        payer: { email: `pedido-${pendente.id}@saiae.com.br` },
        // O id do pendente vai na URL: o webhook precisa saber de qual barraca
        // é o token pra consultar o pagamento, e só o MP guarda o dono do
        // pagamento — sem isso seria preciso adivinhar o token.
        notification_url: `${Deno.env.get('SUPABASE_URL')}/functions/v1/webhook-mercadopago?pendente=${pendente.id}`,
      }),
    })
  } catch (erroRede) {
    return jsonResponse({ erro: 'Falha ao contatar o Mercado Pago', detalhe: String(erroRede) }, 502)
  }

  const resultadoMp = await respostaMp.json().catch(() => null)

  if (!respostaMp.ok || !resultadoMp?.id) {
    const mensagem = resultadoMp?.message ?? resultadoMp?.error ?? 'Erro desconhecido no Mercado Pago'
    return jsonResponse({ erro: mensagem, detalhe: resultadoMp }, 502)
  }

  // A coluna se chama mercadopago_order_id por herança da Orders API; guarda o
  // id do pagamento (Payments API).
  await supabase
    .from('pagamentos_pendentes')
    .update({ mercadopago_order_id: String(resultadoMp.id) })
    .eq('id', pendente.id)

  return jsonResponse({
    pendente_id: pendente.id,
    ...extrairQr(resultadoMp),
    total_centavos: totalCobradoCentavos,
    taxa_entrega_centavos: taxaEntregaCentavos,
  })
})
