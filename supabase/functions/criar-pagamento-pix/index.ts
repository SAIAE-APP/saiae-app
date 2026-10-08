// Cria a cobrança Pix de um pedido montado no cardápio público — Fase 2+3
// do Cardápio Digital (CLAUDE.md, roadmap). Recebe só item_id/quantidade,
// NUNCA preço do cliente: o preço real é sempre resolvido aqui a partir
// de `itens`, senão dava pra forjar o valor no DevTools.
//
// O pedido de verdade em `pedidos`/`itens_do_pedido` só nasce quando o
// provedor confirma o pagamento (ver webhook-mercadopago) — até lá a
// cobrança fica isolada em `pagamentos_pendentes`. Usa a service role
// key: lê `barracas_pagamento_token` direto, sem passar pelas funções
// SECURITY DEFINER pensadas pro client autenticado.
//
// Provedor Pix: `barracas.pagamento_provedor` (padrão 'mercadopago') escolhe o
// adaptador em ../_shared/pagamento (interface ProvedorPix). A cobrança grava o
// provedor no pendente, então trocar de provedor depois não afeta cobranças já
// emitidas.
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { chaveDoProvedor, obterProvedor, urlNotificacaoPagamento } from '../_shared/pagamento/registro.ts'
import { buscarTokenDoProvedor } from '../_shared/pagamento/token.ts'
import { ErroProvedor, ehProvedorValido, type QrPix } from '../_shared/pagamento/tipos.ts'
import { hashIp, ipDoCliente, pareceBot } from '../_shared/antiabuso.ts'

// Teto anti-bot por IP: não é limite de volume (ver comentário no ponto de uso).
const JANELA_RATE_LIMIT_MS = 5 * 60 * 1000
const LIMITE_COBRANCAS_POR_IP = 60

// Mínimo aceito pelo Mercado Pago é 30 min; 35 dá folga pra diferença de relógio.
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
  consentimento_marketing?: boolean
}

type TaxaEntregaRow = { permitido: boolean; taxa_centavos: number; origem: string }

type ItemCadastroRow = {
  id: string
  nome: string
  preco_centavos: number
  ativo: boolean
  esgotado: boolean
  estoque_qtd: number | null
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
    /** WhatsApp opcional (fora da Entrega) só pra avisar "pedido pronto". */
    cliente_telefone?: string | null
    /** Total que o cliente viu na tela (itens + taxa). Se o servidor calcular outro, não cobra. */
    total_esperado_centavos?: number | null
    /** Honeypot: campo oculto no formulário; humano nunca preenche. */
    website?: string
    /** Tempo entre abrir o checkout e enviar (medido no navegador). Opcional (cliente antigo não manda). */
    ms_no_checkout?: number
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

  // Defesas baratas que não afetam cliente real: honeypot preenchido ou envio
  // rápido demais. Resposta genérica, sem dizer qual regra pegou.
  if (pareceBot(body)) {
    return jsonResponse({ erro: 'Não foi possível gerar o Pix. Tente de novo.' }, 400)
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  )

  // Idempotência: duplo toque / retry de rede não gera duas cobranças.
  const { data: pendenteExistente } = await supabase
    .from('pagamentos_pendentes')
    // '*': tolera pendente de antes da coluna `provedor` (vale Mercado Pago).
    .select('*')
    .eq('client_uuid', client_uuid)
    .maybeSingle()

  if (pendenteExistente?.mercadopago_order_id) {
    // Retry do mesmo client_uuid devolve o QR já emitido. Se o cliente agora
    // espera OUTRO total (mudou endereço/taxa), não reaproveita: o QR antigo
    // cobraria o valor antigo. O front gera client_uuid novo e tenta de novo.
    const esperadoRetry = body.total_esperado_centavos
    if (esperadoRetry !== undefined && esperadoRetry !== null) {
      const totalExistente =
        ((pendenteExistente.itens ?? []) as { quantidade: number; preco_centavos_unitario: number }[]).reduce(
          (soma, item) => soma + item.preco_centavos_unitario * item.quantidade,
          0,
        ) + Number(pendenteExistente.taxa_entrega_centavos ?? 0)
      if (esperadoRetry !== totalExistente) {
        return jsonResponse({ erro: 'Os dados do pedido mudaram. Gere um novo Pix.' }, 409)
      }
    }

    // O QR é recuperado no MESMO provedor em que a cobrança foi emitida.
    const provedorEmitido = obterProvedor(chaveDoProvedor(pendenteExistente.provedor))
    const tokenEmitido = provedorEmitido
      ? await buscarTokenDoProvedor(supabase, pendenteExistente.barraca_id, provedorEmitido.chave)
      : null

    if (provedorEmitido && tokenEmitido) {
      const qr = await provedorEmitido.recuperarQr({
        token: tokenEmitido,
        idExterno: pendenteExistente.mercadopago_order_id,
      })
      return jsonResponse({
        pendente_id: pendenteExistente.id,
        qr_code: qr.copiaECola,
        qr_code_base64: qr.qrCodeBase64,
        ticket_url: qr.ticketUrl ?? null,
      })
    }
  }

  // Teto anti-bot por IP (hash). Cada cobrança nova chama a API do provedor com o
  // token DO DONO, então script em loop não pode gerar cobrança à vontade. Retry
  // do mesmo client_uuid já voltou acima (não conta). Contador próprio do Pix
  // (escopo no hash), separado do de "Pagar na entrega". Alto de propósito: evento
  // tem muita gente no mesmo wifi/NAT; cliente real nunca chega perto.
  const ipHash = await hashIp('pix', ipDoCliente(req), barraca_id)
  const desde = new Date(Date.now() - JANELA_RATE_LIMIT_MS).toISOString()
  const { count: cobrancasDoIp } = await supabase
    .from('cardapio_pedidos_log')
    .select('id', { count: 'exact', head: true })
    .eq('ip_hash', ipHash)
    .gte('criado_em', desde)
  if ((cobrancasDoIp ?? 0) >= LIMITE_COBRANCAS_POR_IP) {
    return jsonResponse({ erro: 'Muitas tentativas em pouco tempo. Aguarde um instante e tente de novo.' }, 429)
  }
  await supabase.from('cardapio_pedidos_log').insert({ barraca_id, ip_hash: ipHash, client_uuid })

  const { data: barraca, error: erroBarraca } = await supabase
    .from('barracas')
    // '*': tolera barraca de antes da coluna `pagamento_provedor` (vale Mercado Pago).
    .select('*')
    .eq('id', barraca_id)
    .single()

  if (erroBarraca || !barraca) {
    return jsonResponse({ erro: 'Barraca não encontrada' }, 404)
  }

  if (!barraca.pagamento_online_habilitado) {
    return jsonResponse({ erro: 'Pagamento online não habilitado para esta barraca' }, 422)
  }

  const provedorChave = chaveDoProvedor(barraca.pagamento_provedor)
  const provedor = ehProvedorValido(provedorChave) ? obterProvedor(provedorChave) : null
  if (!provedor) {
    return jsonResponse({ erro: 'Provedor de pagamento não disponível para esta barraca' }, 422)
  }

  const tokenProvedor = await buscarTokenDoProvedor(supabase, barraca_id, provedor.chave)
  if (!tokenProvedor) {
    return jsonResponse({ erro: `Token do ${provedor.nome} não configurado` }, 422)
  }

  // Preço SEMPRE resolvido aqui a partir do cardápio real — o que o
  // cliente manda é só item_id + quantidade.
  const idsItens = itens.map((i) => i.item_id)
  const { data: itensCadastro, error: erroItens } = await supabase
    .from('itens')
    .select('id, nome, preco_centavos, ativo, esgotado, estoque_qtd')
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

  // Estoque: com a opção ligada pelo dono, quantidade acima do saldo é recusada ANTES de
  // gerar o Pix (o retry de um Pix já emitido volta lá em cima, sem passar por aqui, e o
  // webhook nunca recusa por estoque: pagamento aprovado vira pedido, mesmo negativando).
  // Soma por item (o carrinho pode repetir o mesmo item em linhas diferentes).
  if (barraca.estoque_bloqueia === true) {
    const somaPorItem = new Map<string, { nome: string; quantidade: number }>()
    for (const i of itensResolvidos) {
      const atual = somaPorItem.get(i.item_id)
      somaPorItem.set(i.item_id, { nome: i.nome_item, quantidade: (atual?.quantidade ?? 0) + i.quantidade })
    }
    const acima: string[] = []
    for (const [id, { nome, quantidade }] of somaPorItem) {
      const saldo = cadastroPorId.get(id)?.estoque_qtd ?? null
      if (saldo !== null && quantidade > saldo) acima.push(saldo <= 0 ? `${nome}: sem estoque` : `${nome}: restam ${saldo}`)
    }
    if (acima.length > 0) {
      return jsonResponse({ erro: `Sem estoque suficiente — ${acima.join('; ')}` }, 422)
    }
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

  // Telefone só pro aviso "pedido pronto" (fora da Entrega, onde vale o do
  // formulário). Mesma normalização do banco; inválido é IGNORADO, nunca recusa.
  let clienteTelefone: string | null = null
  if (body.tipo_atendimento !== 'entrega') {
    let d = String(body.cliente_telefone ?? '').replace(/\D/g, '')
    if ((d.length === 12 || d.length === 13) && d.startsWith('55')) d = d.slice(2)
    if (d.length >= 8 && d.length <= 15) clienteTelefone = d
  }

  if (ehEntrega) {
    const modos = (barraca.modos_atendimento ?? []) as string[]
    if (!modos.includes('entrega')) {
      return jsonResponse({ erro: 'Esta barraca não está aceitando pedidos de entrega' }, 422)
    }

    const e = body.entrega ?? {}
    const texto = (valor: unknown, max: number) => String(valor ?? '').trim().slice(0, max)
    const nome = texto(e.nome, 60)
    const telefone = String(e.telefone ?? '').replace(/\D/g, '')
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
      // Contato comercial é consentimento SEPARADO e opcional (só quando marcou).
      ...(e.consentimento_marketing === true ? { consentimento_marketing_em: new Date().toISOString() } : {}),
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

  // Retry depois de uma falha do provedor (pendente já existe, sem pagamento nele):
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
        // Só quando informado: sem telefone o update é o de sempre.
        ...(clienteTelefone ? { cliente_telefone: clienteTelefone } : {}),
        // Pendente sem cobrança emitida pode trocar de provedor (dono mudou a escolha).
        ...(chaveDoProvedor(pendenteExistente.provedor) !== provedor.chave ? { provedor: provedor.chave } : {}),
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
        ...(clienteTelefone ? { cliente_telefone: clienteTelefone } : {}),
        // Mercado Pago = default da coluna: o insert dele é IDÊNTICO ao de antes.
        ...(provedor.chave !== 'mercadopago' ? { provedor: provedor.chave } : {}),
      })
      .select('id')
      .single()

    if (erroPendente || !criado) {
      return jsonResponse({ erro: 'Falha ao registrar o pedido', detalhe: erroPendente?.message }, 500)
    }
    pendente = criado
  }

  let cobranca: QrPix
  try {
    cobranca = await provedor.criarCobranca({
      token: tokenProvedor,
      valorCentavos: totalCobradoCentavos,
      referencia: pendente.id,
      descricao: ehEntrega ? 'Pedido com entrega no cardápio digital' : 'Pedido no cardápio digital',
      expiraEm: new Date(Date.now() + EXPIRACAO_PIX_MS),
      urlNotificacao: urlNotificacaoPagamento(Deno.env.get('SUPABASE_URL') ?? '', pendente.id, provedor.chave),
    })
  } catch (erro) {
    if (erro instanceof ErroProvedor) {
      return jsonResponse(
        { erro: erro.message, detalhe: erro.detalhe },
        502,
      )
    }
    throw erro
  }

  // A coluna se chama mercadopago_order_id por herança da Orders API do MP; guarda o
  // id externo do pagamento em QUALQUER provedor (renomear fica pra depois, sem risco agora).
  await supabase
    .from('pagamentos_pendentes')
    .update({ mercadopago_order_id: cobranca.idExterno })
    .eq('id', pendente.id)

  return jsonResponse({
    pendente_id: pendente.id,
    qr_code: cobranca.copiaECola,
    qr_code_base64: cobranca.qrCodeBase64,
    ticket_url: cobranca.ticketUrl ?? null,
    total_centavos: totalCobradoCentavos,
    taxa_entrega_centavos: taxaEntregaCentavos,
  })
})
