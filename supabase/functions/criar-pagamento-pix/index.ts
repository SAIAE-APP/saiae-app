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
import { buscarTokenDoProvedor, obterTokenVendedor } from '../_shared/pagamento/token.ts'
import { minutosExpiracaoPix } from '../_shared/pagamento/expiracao.ts'
import { ErroProvedor, ehProvedorValido, type QrPix, type ResultadoCartao } from '../_shared/pagamento/tipos.ts'
import { totalEsperadoDoPendente } from '../_shared/pagamento/conciliacao.ts'
import { concluirCartaoAprovado } from '../_shared/pagamento/pedidoAprovado.ts'
import {
  chavePublicaDaBarraca,
  corteTokenAtingido,
  decidirCredencial,
  emitidoViaOauth,
  expiraEmDoPendente,
  lerMeioPagamento,
  statusCartaoParaCliente,
  totalDaCobranca,
} from '../_shared/pagamento/cobrancaOnline.ts'
import { hashIp, ipDoCliente, limitePorLoja, pareceBot, registrarTentativa } from '../_shared/antiabuso.ts'
import { resolverPerfilDoPedido } from '../_shared/perfilNoPedido.ts'
import { avaliarCupomDoPedido, liberarReservasAbandonadas, reservarCupomDoPedido } from '../_shared/cupomPedido.ts'
import { avaliarCashbackDoPedido, liberarCashbackAbandonado, reservarCashbackDoPedido } from '../_shared/cashbackPedido.ts'
import { descontoDoBeneficio } from '../_shared/cashback.ts'
import { argsPedidoGratis, ehPedidoGratis, telefoneDoPedidoGratis } from '../_shared/pedidoGratis.ts'
import { MENSAGEM_FECHADO, foraDoHorarioBloqueado } from '../_shared/horario.ts'
import { interpretarResolver, itensAcimaDoEstoque, montarLinhas, respostaDeErros } from '../_shared/carrinho.ts'

// Teto anti-bot por IP (e por loja, bem alto): não é limite de volume (ver comentário no ponto de uso).
const LIMITE_COBRANCAS_POR_IP = 60

// Expiração do QR: por barraca (barracas.pix_expiracao_minutos, 35..60, padrão 35).
// O Mercado Pago exige 30 min a 30 dias; os 35 mínimos dão folga de relógio.

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

// Teto de linhas do carrinho (igual ao do "pagar na entrega" e ao do resolver_carrinho).
const MAX_LINHAS = 40

/** SAI-010a: `opcao_ids` e `observacao` por linha; preço, nome e total saem do resolver_carrinho. */
type ItemCarrinho = { item_id: string; quantidade: number; opcao_ids?: string[]; observacao?: string | null }

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

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS })
  }

  let body: {
    barraca_id?: string
    /** Sessão do perfil do cliente (obrigatória só se a barraca ligar perfil_cliente_obrigatorio). */
    sessao_token?: string
    /** Cupom digitado pelo cliente. Só o CÓDIGO viaja: o desconto é calculado aqui, no banco. */
    cupom_codigo?: string | null
    /** Usar o saldo de cashback neste pedido (só `true` conta). Só o pedido de uso viaja: o valor é calculado aqui, no banco. */
    usar_cashback?: boolean
    /** Pix anterior deste cliente (id que o próprio front recebeu): checkout refeito libera a reserva dele. */
    pendente_anterior_id?: string | null
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
    /** Ausente = 'pix' (cliente antigo). 'cartao' só com a barraca conectada por OAuth. */
    meio?: 'pix' | 'cartao'
    /** Token do cartão gerado no navegador com a chave pública do vendedor (nenhum dado de cartão passa aqui). */
    card_token?: string
    payment_method_id?: string
    issuer_id?: string
    email_pagador?: string
    /** 'chave_publica': só devolve a chave pública do vendedor (para gerar o token do cartão). */
    acao?: string
  }
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ erro: 'JSON inválido' }, 400)
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  )

  // Cardápio público: a chave pública do vendedor (pública por desenho) e nada mais. Erro genérico, sem enumerar.
  if (body.acao === 'chave_publica') {
    const publicKey = await chavePublicaDaBarraca(supabase, body.barraca_id)
    return publicKey ? jsonResponse({ public_key: publicKey }) : jsonResponse({ erro: 'Pagamento com cartão indisponível.' }, 404)
  }

  const { barraca_id, client_uuid, itens } = body
  if (!barraca_id || !client_uuid || !Array.isArray(itens) || itens.length === 0) {
    return jsonResponse({ erro: 'barraca_id, client_uuid e itens são obrigatórios' }, 400)
  }

  const meioPedido = lerMeioPagamento(body)
  if (!meioPedido.ok) return jsonResponse(meioPedido.corpo, meioPedido.status)

  // Defesas baratas que não afetam cliente real: honeypot preenchido ou envio
  // rápido demais. Resposta genérica, sem dizer qual regra pegou.
  if (pareceBot(body, Deno.env.get('EXIGIR_MS_NO_CHECKOUT') === '1')) {
    return jsonResponse({ erro: 'Não foi possível gerar o Pix. Tente de novo.' }, 400)
  }

  // Idempotência: duplo toque / retry de rede não gera duas cobranças.
  const { data: pendenteExistente } = await supabase
    .from('pagamentos_pendentes')
    // '*': tolera pendente de antes da coluna `provedor` (vale Mercado Pago).
    .select('*')
    .eq('client_uuid', client_uuid)
    .maybeSingle()

  // Pedido GRÁTIS já criado com este client_uuid (retry/duplo toque): devolve o mesmo pedido, sem criar outro.
  if (pendenteExistente?.status === 'aprovado' && pendenteExistente.pedido_id && !pendenteExistente.mercadopago_order_id) {
    const { data: jaCriado } = await supabase.from('pedidos').select('id, senha').eq('id', pendenteExistente.pedido_id).maybeSingle()
    if (jaCriado) return jsonResponse({ pedido_gratis: true, senha: jaCriado.senha, pedido_id: jaCriado.id })
  }

  if (pendenteExistente?.mercadopago_order_id) {
    // Retry do mesmo client_uuid devolve o QR já emitido. Se o cliente agora
    // espera OUTRO total (mudou endereço/taxa), não reaproveita: o QR antigo
    // cobraria o valor antigo. O front gera client_uuid novo e tenta de novo.
    const totalExistente = totalEsperadoDoPendente(
      (pendenteExistente.itens ?? []) as { quantidade: number; preco_centavos_unitario: number }[],
      Number(pendenteExistente.taxa_entrega_centavos ?? 0),
      // Cupom: o total do QR já emitido é o DESCONTADO.
      // Cashback: o saldo usado também é desconto de benefício (cupom OU saldo, nunca os dois).
      Number(pendenteExistente.desconto_cupom_centavos ?? 0) + Number(pendenteExistente.cashback_usado_centavos ?? 0),
      Number(pendenteExistente.taxa_plataforma_centavos ?? 0),
    )
    const esperadoRetry = body.total_esperado_centavos
    if (esperadoRetry !== undefined && esperadoRetry !== null && esperadoRetry !== totalExistente) {
      return jsonResponse({ erro: 'Os dados do pedido mudaram. Gere um novo Pix.' }, 409)
    }

    // O QR é recuperado no MESMO provedor e com a MESMA credencial da emissão (taxa > 0 só existe no OAuth).
    const provedorEmitido = obterProvedor(chaveDoProvedor(pendenteExistente.provedor))
    let tokenEmitido: string | null = null
    if (provedorEmitido && emitidoViaOauth(pendenteExistente)) {
      const vendedor = await obterTokenVendedor(supabase, pendenteExistente.barraca_id, Deno.env)
      tokenEmitido = vendedor.ok ? vendedor.token : null
    } else if (provedorEmitido) {
      tokenEmitido = await buscarTokenDoProvedor(supabase, pendenteExistente.barraca_id, provedorEmitido.chave, Deno.env)
    }

    if (provedorEmitido && tokenEmitido && meioPedido.meio === 'cartao') {
      // Retry do cartão: a idempotência do provedor já evitou a cobrança dupla; só devolve o status atual.
      try {
        const atual = await provedorEmitido.consultarPagamento({ token: tokenEmitido, idExterno: pendenteExistente.mercadopago_order_id })
        return jsonResponse({
          pendente_id: pendenteExistente.id,
          status: statusCartaoParaCliente(atual.status),
          total_centavos: totalExistente,
          taxa_plataforma_centavos: Number(pendenteExistente.taxa_plataforma_centavos ?? 0),
        })
      } catch (erro) {
        if (!(erro instanceof ErroProvedor)) throw erro
        return jsonResponse({ erro: 'Não foi possível consultar o pagamento agora. Tente de novo.' }, 502)
      }
    }

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
        cashback_usado_centavos: Number(pendenteExistente.cashback_usado_centavos ?? 0),
        taxa_plataforma_centavos: Number(pendenteExistente.taxa_plataforma_centavos ?? 0),
      })
    }
  }

  // Teto anti-bot por IP (hash). Cada cobrança nova chama a API do provedor com o
  // token DO DONO, então script em loop não pode gerar cobrança à vontade. Retry
  // do mesmo client_uuid já voltou acima (não conta). Contador próprio do Pix
  // (escopo no hash), separado do de "Pagar na entrega". Alto de propósito: evento
  // tem muita gente no mesmo wifi/NAT; cliente real nunca chega perto.
  const ipHash = await hashIp('pix', ipDoCliente(req), barraca_id)
  // Conta + grava numa transação só (cardapio_registrar_tentativa): rajada paralela não passa do teto.
  // Teto por loja (auditoria M5): botnet com IPs distintos não gera cobrança ilimitada no token do dono.
  const decisao = await registrarTentativa(supabase, {
    barracaId: barraca_id,
    ipHash,
    clientUuid: client_uuid,
    limiteIp: LIMITE_COBRANCAS_POR_IP,
    limiteBarraca: limitePorLoja(Deno.env.get('CARDAPIO_LIMITE_POR_LOJA')),
  })
  if (decisao !== 'ok') {
    return jsonResponse({ erro: 'Muitas tentativas em pouco tempo. Aguarde um instante e tente de novo.' }, 429)
  }

  const { data: barraca, error: erroBarraca } = await supabase
    .from('barracas')
    // '*': tolera barraca de antes da coluna `pagamento_provedor` (vale Mercado Pago).
    .select('*')
    .eq('id', barraca_id)
    .single()

  if (erroBarraca || !barraca) {
    return jsonResponse({ erro: 'Barraca não encontrada' }, 404)
  }

  const perfil = await resolverPerfilDoPedido(supabase, Deno.env.get('CLIENTE_HASH_PEPPER') ?? '', barraca_id, body.sessao_token)
  if (perfil.bloqueado) {
    return jsonResponse({ erro: 'Confirme seu telefone para finalizar o pedido.', codigo: 'perfil_obrigatorio' }, 401)
  }

  if (!barraca.pagamento_online_habilitado) {
    return jsonResponse({ erro: 'Pagamento online não habilitado para esta barraca' }, 422)
  }

  // Opcional por barraca (padrão desligado). Só NOVA cobrança: o retry de cobrança já
  // emitida voltou lá em cima, e o webhook (cliente já pagou) nunca olha o horário.
  if (await foraDoHorarioBloqueado(supabase, barraca)) {
    return jsonResponse({ erro: MENSAGEM_FECHADO, codigo: 'fechado' }, 422)
  }

  const provedorChave = chaveDoProvedor(barraca.pagamento_provedor)
  const provedor = ehProvedorValido(provedorChave) ? obterProvedor(provedorChave) : null
  if (!provedor) {
    return jsonResponse({ erro: 'Provedor de pagamento não disponível para esta barraca' }, 422)
  }

  // Credencial: OAuth do vendedor (marketplace, com a taxa Sai aê) ou, só antes do corte, o token colado (sem taxa).
  const credencial = decidirCredencial({
    vendedor:
      provedor.chave === 'mercadopago' ? await obterTokenVendedor(supabase, barraca_id, Deno.env) : { ok: false, motivo: 'nao_conectada' },
    corteAtingido: corteTokenAtingido(Deno.env.get('CORTE_TOKEN_MP_ISO'), new Date()),
    meio: meioPedido.meio,
  })
  if (!credencial.ok) return jsonResponse(credencial.corpo, credencial.status)

  const tokenProvedor =
    credencial.modo === 'oauth' ? credencial.token : await buscarTokenDoProvedor(supabase, barraca_id, provedor.chave, Deno.env)
  if (!tokenProvedor) {
    return jsonResponse({ erro: `Token do ${provedor.nome} não configurado` }, 422)
  }

  // Preço SEMPRE resolvido no banco (resolver_carrinho) a partir do cardápio real — o que o cliente
  // manda é só item_id + opcao_ids + quantidade + observacao. Chamado imediatamente antes de gravar o
  // pendente (docs/opcoes.md: janela residual). O preço fica congelado no pendente até o webhook.
  const montada = montarLinhas(itens, { maxLinhas: MAX_LINHAS, maxQuantidade: null })
  if (!montada.ok) return jsonResponse({ erro: montada.erro }, 400)

  const { data: dadosResolver, error: erroResolver } = await supabase.rpc('resolver_carrinho', {
    p_barraca_id: barraca_id,
    p_linhas: montada.linhas,
  })
  const resolvido = erroResolver ? null : interpretarResolver(dadosResolver)
  if (!resolvido) {
    console.error('criar-pagamento-pix: falha em resolver_carrinho', erroResolver?.message ?? 'resposta inesperada')
    return jsonResponse({ erro: 'Falha ao carregar o cardápio' }, 500)
  }
  if (!resolvido.ok) {
    const { status, erro } = respostaDeErros(resolvido.erros)
    return jsonResponse({ erro }, status)
  }
  const itensResolvidos = resolvido.linhas

  // Estoque: com a opção ligada pelo dono, quantidade acima do saldo é recusada ANTES de
  // gerar o Pix (o retry de um Pix já emitido volta lá em cima, sem passar por aqui, e o
  // webhook nunca recusa por estoque: pagamento aprovado vira pedido, mesmo negativando).
  // Soma por item (o carrinho pode repetir o mesmo item em linhas diferentes).
  if (barraca.estoque_bloqueia === true) {
    const { data: saldos } = await supabase
      .from('itens')
      .select('id, estoque_qtd')
      .eq('barraca_id', barraca_id)
      .in('id', [...new Set(itensResolvidos.map((i) => i.item_id))])
    const saldoPorItem = new Map<string, number | null>(
      ((saldos ?? []) as { id: string; estoque_qtd: number | null }[]).map((r) => [r.id, r.estoque_qtd]),
    )
    const acima = itensAcimaDoEstoque(itensResolvidos, saldoPorItem)
    if (acima.length > 0) {
      return jsonResponse({ erro: `Sem estoque suficiente — ${acima.join('; ')}` }, 422)
    }
  }

  const totalCentavos = resolvido.total_centavos
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

  // ---- Cupom (só quando enviado; sem ele nada muda). Aqui só AVALIA (sem gravar) para o total esperado
  // ser conferido antes de criar a cobrança; a reserva real vem depois, com o id da cobrança. ----
  if (String(body.cupom_codigo ?? '').trim() !== '' || body.pendente_anterior_id) {
    await liberarReservasAbandonadas(supabase, {
      barracaId: barraca_id,
      clienteId: perfil.clienteId,
      pendentesIds: [body.pendente_anterior_id, pendenteExistente?.id],
    })
  }
  const avCupom = await avaliarCupomDoPedido(supabase, {
    barracaId: barraca_id,
    codigoBruto: body.cupom_codigo,
    subtotalCentavos: totalCentavos,
    clienteId: perfil.clienteId,
    ipHash: await hashIp('cupom-validar', ipDoCliente(req), barraca_id),
  })
  if (!avCupom.ok) return jsonResponse(avCupom.corpo, avCupom.status)
  const descontoCentavos = avCupom.desconto
  const cupomCodigo = avCupom.codigo

  // ---- Cashback (só quando `usar_cashback`; sem ele nada muda). SUPOSIÇÃO-CASHBACK-1 (spec §20.1): a barraca financia, o
  // saldo é desconto nos itens; a taxa Sai aê (application_fee) não muda. SUPOSIÇÃO-CASHBACK-4 (spec §20.4): cupom OU saldo.
  // Libera as reservas abandonadas ANTES de avaliar, senão o saldo "esgota" contra a própria reserva anterior. ----
  if (body.usar_cashback === true || body.pendente_anterior_id) {
    await liberarCashbackAbandonado(supabase, {
      barracaId: barraca_id,
      clienteId: perfil.clienteId,
      pendenteAnteriorId: body.pendente_anterior_id,
    })
  }
  const avCashback = await avaliarCashbackDoPedido(supabase, {
    barracaId: barraca_id,
    usar: body.usar_cashback,
    clienteId: perfil.clienteId,
    itensCentavos: totalCentavos,
    temCupom: Boolean(cupomCodigo),
  })
  if (!avCashback.ok) return jsonResponse(avCashback.corpo, avCashback.status)
  const cashbackCentavos = avCashback.resgate
  const descontoBeneficio = descontoDoBeneficio(descontoCentavos, cashbackCentavos)

  // Tudo em centavos INTEIROS; só vira reais na última linha (MP). A taxa Sai aê entra só no OAuth.
  const { taxaPlataformaCentavos, totalCentavos: totalCobradoCentavos } = totalDaCobranca({ subtotalItensCentavos: totalCentavos, descontoCentavos: descontoBeneficio, taxaEntregaCentavos, modo: credencial.modo })

  // Cliente viu um total na tela; se o servidor chegou a outro (dono mexeu na
  // taxa/preço no meio), NÃO cobra sem o cliente ver o novo valor.
  const esperado = body.total_esperado_centavos
  if (esperado !== undefined && esperado !== null && esperado !== totalCobradoCentavos) {
    return jsonResponse(
      {
        erro: 'O valor do pedido mudou. Confira o novo total antes de pagar.',
        total_centavos: totalCobradoCentavos,
        taxa_entrega_centavos: taxaEntregaCentavos,
        taxa_plataforma_centavos: taxaPlataformaCentavos,
      },
      409,
    )
  }

  // Pedido grátis (cupom cobre tudo, sem taxa a pagar): exige telefone informado. O perfil confirmado, quando a
  // loja usa perfil, já foi exigido lá em cima (`perfil.bloqueado`); o limite por IP também já valeu.
  const gratis = ehPedidoGratis(totalCobradoCentavos)
  const telefoneGratis = telefoneDoPedidoGratis({
    telefoneEntrega: entregaSnapshot?.telefone,
    telefoneAviso: clienteTelefone,
  })
  if (gratis && !telefoneGratis) {
    return jsonResponse({ erro: 'Informe seu WhatsApp para finalizar o pedido grátis.', codigo: 'telefone_obrigatorio' }, 422)
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
        taxa_plataforma_centavos: taxaPlataformaCentavos,
        meio_pagamento: meioPedido.meio,
        ...(perfil.clienteId ? { cliente_id: perfil.clienteId } : {}),
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
        taxa_plataforma_centavos: taxaPlataformaCentavos,
        meio_pagamento: meioPedido.meio,
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
        ...(perfil.clienteId ? { cliente_id: perfil.clienteId } : {}),
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

  // Mesma data vai pro provedor (QR vence nele) e pro pendente (cron de expiração). Cartão: sem validade no
  // pendente (o cron não o marca `expirado`); a data só segura a reserva do cupom.
  const expiraEm = new Date(Date.now() + minutosExpiracaoPix(barraca.pix_expiracao_minutos) * 60 * 1000)
  await supabase.from('pagamentos_pendentes').update({ expira_em: expiraEmDoPendente(meioPedido.meio, expiraEm) }).eq('id', pendente.id)

  // Cupom: reserva ATÔMICA no banco, ligada a esta cobrança, vigente até o Pix vencer. Sem cupom, uma
  // reserva antiga da mesma cobrança (cliente tirou o código) é liberada.
  if (cupomCodigo) {
    const res = await reservarCupomDoPedido(supabase, {
      barracaId: barraca_id,
      codigo: cupomCodigo,
      subtotalCentavos: totalCentavos,
      clienteId: perfil.clienteId,
      pendenteId: pendente.id,
      reservadoAte: expiraEm,
    })
    if (!res.ok) return jsonResponse(res.corpo, res.status)
    const reserva = res.reserva
    if (reserva.desconto_centavos !== descontoCentavos) {
      // Desconto mudou no meio (dono editou o cupom): o cliente confirma o novo total antes de pagar.
      const novo = totalDaCobranca({ subtotalItensCentavos: totalCentavos, descontoCentavos: reserva.desconto_centavos, taxaEntregaCentavos, modo: credencial.modo })
      return jsonResponse(
        {
          erro: 'O valor do pedido mudou. Confira o novo total antes de pagar.',
          total_centavos: novo.totalCentavos,
          taxa_entrega_centavos: taxaEntregaCentavos,
          taxa_plataforma_centavos: novo.taxaPlataformaCentavos,
        },
        409,
      )
    }
    await supabase
      .from('pagamentos_pendentes')
      .update({ cupom_id: reserva.cupom_id, desconto_cupom_centavos: reserva.desconto_centavos, cupom_uso_id: reserva.uso_id ?? null })
      .eq('id', pendente.id)
  } else if (pendenteExistente) {
    await supabase.rpc('cupom_liberar', { p_pendente_id: pendente.id })
    await supabase
      .from('pagamentos_pendentes')
      .update({ cupom_id: null, desconto_cupom_centavos: 0, cupom_uso_id: null })
      .eq('id', pendente.id)
  }

  // Cashback: reserva ATÔMICA ligada a esta cobrança, vigente até o Pix vencer. Sem saldo nesta chamada, uma reserva
  // antiga da mesma cobrança (cliente tirou o saldo) é liberada.
  if (cashbackCentavos > 0 && perfil.clienteId) {
    const res = await reservarCashbackDoPedido(supabase, {
      barracaId: barraca_id,
      clienteId: perfil.clienteId,
      itensCentavos: totalCentavos,
      pendenteId: pendente.id,
      reservadoAte: expiraEm,
    })
    if (!res.ok) return jsonResponse(res.corpo, res.status)
    if (res.resgate !== cashbackCentavos) {
      // Saldo mudou no meio (outro checkout gastou parte): o cliente confirma o novo total antes de pagar.
      await supabase.rpc('cashback_liberar', { p_pendente_id: pendente.id })
      const novo = totalDaCobranca({ subtotalItensCentavos: totalCentavos, descontoCentavos: res.resgate, taxaEntregaCentavos, modo: credencial.modo })
      return jsonResponse(
        {
          erro: 'O valor do pedido mudou. Confira o novo total antes de pagar.',
          total_centavos: novo.totalCentavos,
          taxa_entrega_centavos: taxaEntregaCentavos,
          taxa_plataforma_centavos: novo.taxaPlataformaCentavos,
        },
        409,
      )
    }
    await supabase
      .from('pagamentos_pendentes')
      .update({ cashback_usado_centavos: res.resgate, cashback_uso_id: res.usoId })
      .eq('id', pendente.id)
  } else if (pendenteExistente) {
    await supabase.rpc('cashback_liberar', { p_pendente_id: pendente.id })
    await supabase.from('pagamentos_pendentes').update({ cashback_usado_centavos: 0, cashback_uso_id: null }).eq('id', pendente.id)
  }

  if (gratis) {
    // O cupom é o que "paga": a reserva acima é obrigatória e o pedido nasce junto da confirmação do uso.
    const { data: comUso } = await supabase.from('pagamentos_pendentes').select('cupom_uso_id').eq('id', pendente.id).single()
    const usoId = (comUso as { cupom_uso_id?: string | null } | null)?.cupom_uso_id
    if (!cupomCodigo || !usoId) {
      return jsonResponse({ erro: 'Não foi possível finalizar o pedido grátis agora. Tente de novo.' }, 500)
    }
    const { data: criado, error: erroPedido } = await supabase
      .rpc(
        'criar_pedido_com_cupom',
        argsPedidoGratis({
          usoId,
          barracaId: barraca_id,
          mesa: ehEntrega ? null : body.mesa || null,
          viagem: ehEntrega ? true : Boolean(body.viagem),
          observacao: body.observacao || null,
          clientUuid: client_uuid,
          itens: itensResolvidos,
          entrega: entregaSnapshot,
          taxaEntregaCentavos,
          clienteNome,
          clienteTelefone: telefoneGratis,
        }),
      )
      .single()
    const resultado = criado as { pedido_id?: string; senha?: number } | null
    if (erroPedido || !resultado?.pedido_id) {
      await supabase.rpc('cupom_liberar', { p_pendente_id: pendente.id })
      console.error('criar-pagamento-pix: falha ao criar pedido grátis')
      return jsonResponse({ erro: 'Não foi possível finalizar o pedido agora. Tente de novo.' }, 500)
    }
    if (perfil.clienteId) {
      const { error: erroVinculo } = await supabase.from('pedidos').update({ cliente_id: perfil.clienteId }).eq('id', resultado.pedido_id)
      if (erroVinculo) console.error('criar-pagamento-pix: falha ao vincular cliente ao pedido grátis')
    }
    await supabase.from('pagamentos_pendentes').update({ status: 'aprovado', pedido_id: resultado.pedido_id }).eq('id', pendente.id)
    return jsonResponse({
      pedido_gratis: true,
      senha: resultado.senha,
      pedido_id: resultado.pedido_id,
      pendente_id: pendente.id,
      total_centavos: 0,
      taxa_entrega_centavos: taxaEntregaCentavos,
      desconto_cupom_centavos: descontoCentavos,
    })
  }

  const descricao = ehEntrega ? 'Pedido com entrega no cardápio digital' : 'Pedido no cardápio digital'
  const urlNotificacao = urlNotificacaoPagamento(Deno.env.get('SUPABASE_URL') ?? '', pendente.id, provedor.chave)

  // Cartão à vista. Aprovado na hora: o pedido nasce aqui (concluirCartaoAprovado); senão, no webhook, como o Pix.
  if (meioPedido.meio === 'cartao') {
    if (!provedor.criarCobrancaCartao) {
      if (cupomCodigo || cashbackCentavos > 0) await supabase.rpc('cupom_liberar', { p_pendente_id: pendente.id })
      return jsonResponse({ erro: 'Pagamento com cartão indisponível nesta barraca.' }, 422)
    }
    let resultadoCartao: ResultadoCartao
    try {
      resultadoCartao = await provedor.criarCobrancaCartao({
        token: tokenProvedor,
        valorCentavos: totalCobradoCentavos,
        referencia: pendente.id,
        descricao,
        urlNotificacao,
        taxaPlataformaCentavos,
        ...meioPedido.cartao,
      })
    } catch (erro) {
      // A cobrança não saiu: devolve a vaga do cupom. Mensagem limpa, sem nada do provedor.
      if (cupomCodigo || cashbackCentavos > 0) await supabase.rpc('cupom_liberar', { p_pendente_id: pendente.id })
      if (erro instanceof ErroProvedor) {
        return jsonResponse({ erro: 'Não foi possível processar o cartão. Confira os dados ou pague com Pix.', codigo: 'cartao_falhou' }, 502)
      }
      throw erro
    }
    await supabase.from('pagamentos_pendentes').update({ mercadopago_order_id: resultadoCartao.idExterno }).eq('id', pendente.id)
    const statusCartao = statusCartaoParaCliente(resultadoCartao.status)
    if (statusCartao === 'rejeitado') {
      // Mesma regra do webhook: recusa não consome o cupom.
      await supabase.from('pagamentos_pendentes').update({ status: 'rejeitado' }).eq('id', pendente.id).eq('status', 'pendente')
      await supabase.rpc('cupom_liberar', { p_pendente_id: pendente.id })
    }
    // Aprovado já na resposta: cria o pedido aqui, pela mesma decisão e o mesmo criar_pedido idempotente do webhook
    // (que depois acha o pendente aprovado e não faz nada). Falhou? Fica para o webhook; a resposta segue a mesma.
    const pedidoCartao =
      statusCartao === 'aprovado'
        ? await concluirCartaoAprovado({
            supabase,
            provedor,
            token: tokenProvedor,
            idExterno: resultadoCartao.idExterno,
            pendenteId: pendente.id,
            origem: 'criar-pagamento-pix',
          })
        : null
    return jsonResponse({
      pendente_id: pendente.id,
      status: statusCartao,
      total_centavos: totalCobradoCentavos,
      taxa_plataforma_centavos: taxaPlataformaCentavos,
      cashback_usado_centavos: cashbackCentavos,
      ...(pedidoCartao ? { pedido_id: pedidoCartao.pedidoId, senha: pedidoCartao.senha } : {}),
    })
  }

  let cobranca: QrPix
  try {
    cobranca = await provedor.criarCobranca({
      token: tokenProvedor,
      valorCentavos: totalCobradoCentavos,
      referencia: pendente.id,
      descricao,
      expiraEm,
      urlNotificacao,
      taxaPlataformaCentavos,
    })
  } catch (erro) {
    // A cobrança não saiu: devolve a vaga do cupom (a cobrança nunca existiu para o cliente).
    if (cupomCodigo || cashbackCentavos > 0) await supabase.rpc('cupom_liberar', { p_pendente_id: pendente.id })
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
    desconto_cupom_centavos: descontoCentavos,
    cashback_usado_centavos: cashbackCentavos,
    taxa_plataforma_centavos: taxaPlataformaCentavos,
  })
})
