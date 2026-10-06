// Cria um pedido "Pagar na entrega" feito no cardápio público (sem login).
// O pedido entra na Cozinha na hora (criar_pedido, método `na_entrega`) e o
// front abre o wa.me do dono com o resumo.
//
// Segurança: endpoint público, então NUNCA confia no cliente. Preço, nome e
// disponibilidade do item vêm SEMPRE de `itens` (o cliente manda só
// item_id + quantidade); a opção precisa estar ligada pelo dono; anti-spam por
// IP (hash) e por barraca numa janela de tempo; idempotente por client_uuid
// (reenvio devolve a mesma senha). Usa a service role key.
import { createClient } from 'jsr:@supabase/supabase-js@2'

// Anti-bot, NÃO limite de volume: barraca em evento recebe centenas de pedidos em
// poucos minutos e vários consumidores saem do mesmo IP (wifi/NAT). Por isso não
// há teto por barraca e o teto por IP é altíssimo: só barra script em loop.
// Cliente real nunca chega perto disso.
const JANELA_MS = 5 * 60 * 1000
const LIMITE_POR_IP = 120
// Envio mais rápido que isso depois de abrir o checkout não é humano.
const MIN_MS_NO_CHECKOUT = 2000
const MAX_LINHAS = 40
const MAX_QUANTIDADE = 50

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

type ItemCadastroRow = {
  id: string
  nome: string
  preco_centavos: number
  ativo: boolean
  esgotado: boolean
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function hashIp(ip: string, barracaId: string): Promise<string> {
  const dados = new TextEncoder().encode(`${barracaId}:${ip}`)
  const digest = await crypto.subtle.digest('SHA-256', dados)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

function ipDoCliente(req: Request): string {
  return (
    req.headers.get('cf-connecting-ip') ??
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    req.headers.get('x-real-ip') ??
    'desconhecido'
  )
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS })
  if (req.method !== 'POST') return jsonResponse({ erro: 'Método não permitido' }, 405)

  let body: {
    barraca_id?: string
    client_uuid?: string
    nome?: string
    telefone?: string
    endereco?: string | null
    observacao?: string | null
    itens?: { item_id?: string; quantidade?: number }[]
    /** Honeypot: campo oculto no formulário; humano nunca preenche. */
    website?: string
    /** Tempo entre abrir o checkout e enviar (medido no navegador). */
    ms_no_checkout?: number
  }
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ erro: 'JSON inválido' }, 400)
  }

  const barracaId = String(body.barraca_id ?? '')
  const clientUuid = String(body.client_uuid ?? '')
  const nome = String(body.nome ?? '').trim().slice(0, 60)
  const telefone = String(body.telefone ?? '').replace(/\D/g, '')
  const endereco = String(body.endereco ?? '').trim().slice(0, 200)
  const observacaoCliente = String(body.observacao ?? '').trim().slice(0, 200)

  // Defesas baratas que não afetam cliente real: honeypot preenchido ou envio
  // rápido demais. Mesma resposta genérica, sem dizer qual regra pegou.
  const msNoCheckout = Number(body.ms_no_checkout)
  if (
    String(body.website ?? '').length > 0 ||
    !Number.isFinite(msNoCheckout) ||
    msNoCheckout < MIN_MS_NO_CHECKOUT
  ) {
    return jsonResponse({ erro: 'Não foi possível enviar o pedido. Tente de novo.' }, 400)
  }

  if (!UUID.test(barracaId) || !UUID.test(clientUuid)) {
    return jsonResponse({ erro: 'barraca_id e client_uuid inválidos' }, 400)
  }
  if (!Array.isArray(body.itens) || body.itens.length === 0 || body.itens.length > MAX_LINHAS) {
    return jsonResponse({ erro: 'Itens inválidos' }, 400)
  }
  if (nome.length < 2) return jsonResponse({ erro: 'Informe seu nome' }, 422)
  if (telefone.length < 10 || telefone.length > 13) {
    return jsonResponse({ erro: 'Informe um telefone com DDD' }, 422)
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  )

  // Junta linhas repetidas e limita a quantidade.
  const quantidadePorItem = new Map<string, number>()
  for (const linha of body.itens) {
    const id = String(linha.item_id ?? '')
    const quantidade = Math.floor(Number(linha.quantidade) || 0)
    if (!UUID.test(id) || quantidade < 1) return jsonResponse({ erro: 'Itens inválidos' }, 400)
    quantidadePorItem.set(id, Math.min(MAX_QUANTIDADE, (quantidadePorItem.get(id) ?? 0) + quantidade))
  }

  const { data: barraca } = await supabase
    .from('barracas')
    .select('id, pagar_na_entrega_habilitado, whatsapp_pedidos')
    .eq('id', barracaId)
    .maybeSingle()
  if (!barraca) return jsonResponse({ erro: 'Barraca não encontrada' }, 404)
  if (!barraca.pagar_na_entrega_habilitado || !barraca.whatsapp_pedidos) {
    return jsonResponse({ erro: 'Esta barraca não aceita "Pagar na entrega" pelo cardápio' }, 422)
  }

  // Preço e disponibilidade SEMPRE do cadastro real.
  const { data: cadastro, error: erroItens } = await supabase
    .from('itens')
    .select('id, nome, preco_centavos, ativo, esgotado')
    .eq('barraca_id', barracaId)
    .in('id', [...quantidadePorItem.keys()])
  if (erroItens) return jsonResponse({ erro: 'Falha ao carregar o cardápio' }, 500)

  const porId = new Map<string, ItemCadastroRow>(((cadastro ?? []) as ItemCadastroRow[]).map((i) => [i.id, i]))
  const itensResolvidos: {
    item_id: string
    nome_item: string
    quantidade: number
    preco_centavos_unitario: number
  }[] = []
  const indisponiveis: string[] = []
  for (const [id, quantidade] of quantidadePorItem) {
    const item = porId.get(id)
    if (!item || !item.ativo || item.esgotado || item.preco_centavos <= 0) {
      indisponiveis.push(item?.nome ?? 'item')
      continue
    }
    itensResolvidos.push({
      item_id: item.id,
      nome_item: item.nome,
      quantidade,
      preco_centavos_unitario: item.preco_centavos,
    })
  }
  if (indisponiveis.length > 0) {
    return jsonResponse({ erro: `Item(ns) indisponível(is): ${indisponiveis.join(', ')}` }, 422)
  }
  const totalCentavos = itensResolvidos.reduce((s, i) => s + i.preco_centavos_unitario * i.quantidade, 0)

  // Idempotência: reenvio do mesmo client_uuid devolve o pedido já criado (e
  // NÃO conta no limite — duplo toque/retry de rede não é spam).
  const { data: existente } = await supabase
    .from('pedidos')
    .select('id, senha, barraca_id')
    .eq('client_uuid', clientUuid)
    .maybeSingle()
  if (existente) {
    if (existente.barraca_id !== barracaId) return jsonResponse({ erro: 'client_uuid já usado' }, 409)
    return jsonResponse({ senha: existente.senha, total_centavos: totalCentavos, itens: itensResolvidos })
  }

  // Teto anti-bot por IP (hash), janela deslizante. Sem limite por barraca.
  const desde = new Date(Date.now() - JANELA_MS).toISOString()
  const ipHash = await hashIp(ipDoCliente(req), barracaId)
  const { count: porIp } = await supabase
    .from('cardapio_pedidos_log')
    .select('id', { count: 'exact', head: true })
    .eq('ip_hash', ipHash)
    .gte('criado_em', desde)
  if ((porIp ?? 0) >= LIMITE_POR_IP) {
    return jsonResponse({ erro: 'Muitos pedidos em pouco tempo. Aguarde um instante e tente de novo.' }, 429)
  }
  await supabase.from('cardapio_pedidos_log').insert({ barraca_id: barracaId, ip_hash: ipHash, client_uuid: clientUuid })

  // Aqui não há rua/número estruturados, então a comanda impressa não traz o
  // bloco "ENTREGAR PARA": nome, telefone e endereço vão na observação.
  const observacao = [
    `PAGAR NA ENTREGA - ${nome} - ${telefone}`,
    endereco ? `Endereco: ${endereco}` : null,
    observacaoCliente || null,
  ]
    .filter(Boolean)
    .join(' | ')

  const { data: criado, error: erroPedido } = await supabase
    .rpc('criar_pedido', {
      p_barraca_id: barracaId,
      p_mesa: null,
      p_viagem: true,
      p_observacao: observacao,
      p_client_uuid: clientUuid,
      p_metodo_pagamento: 'na_entrega',
      p_itens: itensResolvidos,
      p_tipo_atendimento: 'entrega',
      // Sem rua estruturada: o endereço livre vai em `referencia` (a comanda e o
      // link do entregador mostram nome, telefone e essa referência).
      p_entrega: { nome, telefone, referencia: endereco || null },
    })
    .single()

  if (erroPedido || !criado) {
    console.error('criar-pedido-cardapio: falha em criar_pedido', erroPedido?.message)
    return jsonResponse({ erro: 'Não foi possível enviar o pedido agora. Tente de novo.' }, 500)
  }

  return jsonResponse({
    senha: (criado as { senha: number }).senha,
    total_centavos: totalCentavos,
    itens: itensResolvidos,
  })
})
