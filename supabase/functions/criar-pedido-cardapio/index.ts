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
import {
  interpretarResolver,
  itensAcimaDoEstoque,
  montarLinhas,
  respostaDeErros,
} from '../_shared/carrinho.ts'
import { MENSAGEM_FECHADO, foraDoHorarioBloqueado } from '../_shared/horario.ts'
import { resolverPerfilDoPedido } from '../_shared/perfilNoPedido.ts'

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
    /** Sessão do perfil do cliente (obrigatória só se a barraca ligar perfil_cliente_obrigatorio). */
    sessao_token?: string
    client_uuid?: string
    nome?: string
    telefone?: string
    endereco?: string | null
    observacao?: string | null
    /** `opcao_ids` e `observacao` (SAI-010a): o cliente manda só ids e texto; preço, nome e total saem do
     * resolver_carrinho do banco. */
    itens?: { item_id?: string; quantidade?: number; opcao_ids?: string[]; observacao?: string | null }[]
    /** Entrega com endereço estruturado (taxa por bairro). Sem isto vale o modo antigo
     * "só nome/telefone/endereço livre". */
    entrega?: {
      nome?: string
      telefone?: string
      rua?: string
      numero?: string
      bairro?: string
      referencia?: string | null
      /** Aceito aqui também (contrato do Pix com Entrega); vale o de cima ou este. */
      consentimento_lgpd?: boolean
      consentimento_marketing?: boolean
    } | null
    /** Cliente aceitou o aviso de LGPD (obrigatório com `entrega`). */
    consentimento_lgpd?: boolean
    /** Total que o cliente viu (itens + taxa). Se divergir do calculado aqui, não cria o pedido (409). */
    total_esperado_centavos?: number | null
    /** Aceite OPCIONAL de ofertas por WhatsApp (separado do consentimento de entrega). */
    consentimento_marketing?: boolean
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

  // Entrega estruturada (rua, número, bairro): a taxa é decidida AQUI pelo bairro.
  const entregaBruta = body.entrega ?? null
  const entregaEstruturada = entregaBruta
    ? {
        nome: String(entregaBruta.nome ?? nome).trim().slice(0, 60),
        telefone: String(entregaBruta.telefone ?? telefone).replace(/\D/g, ''),
        rua: String(entregaBruta.rua ?? '').trim().slice(0, 100),
        numero: String(entregaBruta.numero ?? '').trim().slice(0, 20),
        bairro: String(entregaBruta.bairro ?? '').trim().replace(/\s+/g, ' ').slice(0, 80),
        referencia: String(entregaBruta.referencia ?? '').trim().slice(0, 120) || null,
      }
    : null
  if (entregaEstruturada) {
    if (entregaEstruturada.nome.length < 2) return jsonResponse({ erro: 'Informe seu nome' }, 422)
    if (entregaEstruturada.telefone.length < 10 || entregaEstruturada.telefone.length > 13) {
      return jsonResponse({ erro: 'Informe um telefone com DDD' }, 422)
    }
    if (!entregaEstruturada.rua) return jsonResponse({ erro: 'Informe a rua' }, 422)
    if (!entregaEstruturada.numero) return jsonResponse({ erro: 'Informe o número' }, 422)
    if (!entregaEstruturada.bairro) return jsonResponse({ erro: 'Informe o bairro' }, 422)
    if (body.consentimento_lgpd !== true && entregaBruta?.consentimento_lgpd !== true) {
      return jsonResponse({ erro: 'É preciso aceitar o uso dos seus dados para a entrega' }, 422)
    }
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  )

  // Junta linhas idênticas (mesmo item, opções e observação) e limita a quantidade.
  const montada = montarLinhas(body.itens, { maxLinhas: MAX_LINHAS, maxQuantidade: MAX_QUANTIDADE })
  if (!montada.ok) return jsonResponse({ erro: montada.erro }, 400)

  const { data: barraca } = await supabase
    .from('barracas')
    // '*': tolera barraca de antes da coluna `estoque_bloqueia` (vale: não bloqueia).
    .select('*')
    .eq('id', barracaId)
    .maybeSingle()
  if (!barraca) return jsonResponse({ erro: 'Barraca não encontrada' }, 404)
  if (!barraca.pagar_na_entrega_habilitado || !barraca.whatsapp_pedidos) {
    return jsonResponse({ erro: 'Esta barraca não aceita "Pagar na entrega" pelo cardápio' }, 422)
  }
  if (entregaEstruturada && !((barraca.modos_atendimento as string[] | null) ?? []).includes('entrega')) {
    return jsonResponse({ erro: 'Esta barraca não faz entrega pelo cardápio' }, 422)
  }

  const perfil = await resolverPerfilDoPedido(supabase, Deno.env.get('CLIENTE_HASH_PEPPER') ?? '', barracaId, body.sessao_token)
  if (perfil.bloqueado) {
    return jsonResponse({ erro: 'Confirme seu telefone para finalizar o pedido.', codigo: 'perfil_obrigatorio' }, 401)
  }

  // Preço, nome, disponibilidade e regras de opções (mínimo/máximo, variação) SEMPRE do banco, pelo
  // resolver_carrinho. Chamado aqui, imediatamente antes do criar_pedido (docs/opcoes.md: janela residual).
  const { data: dadosResolver, error: erroResolver } = await supabase.rpc('resolver_carrinho', {
    p_barraca_id: barracaId,
    p_linhas: montada.linhas,
  })
  const resolvido = erroResolver ? null : interpretarResolver(dadosResolver)
  if (!resolvido) {
    console.error('criar-pedido-cardapio: falha em resolver_carrinho', erroResolver?.message ?? 'resposta inesperada')
    return jsonResponse({ erro: 'Falha ao carregar o cardápio' }, 500)
  }
  if (!resolvido.ok) {
    const { status, erro } = respostaDeErros(resolvido.erros)
    return jsonResponse({ erro }, status)
  }
  const itensResolvidos = resolvido.linhas
  const totalCentavos = resolvido.total_centavos

  // Idempotência: reenvio do mesmo client_uuid devolve o pedido já criado (e
  // NÃO conta no limite — duplo toque/retry de rede não é spam).
  const { data: existente } = await supabase
    .from('pedidos')
    .select('id, senha, barraca_id, taxa_entrega_centavos')
    .eq('client_uuid', clientUuid)
    .maybeSingle()
  if (existente) {
    if (existente.barraca_id !== barracaId) return jsonResponse({ erro: 'client_uuid já usado' }, 409)
    const taxaExistente = Number(existente.taxa_entrega_centavos ?? 0)
    return jsonResponse({
      senha: existente.senha,
      taxa_entrega_centavos: taxaExistente,
      total_centavos: totalCentavos + taxaExistente,
      itens: itensResolvidos,
    })
  }

  // Opcional por barraca (padrão desligado). Fica DEPOIS do retorno idempotente acima:
  // retry de pedido que já existe nunca é recusado por horário.
  if (await foraDoHorarioBloqueado(supabase, barraca)) {
    return jsonResponse({ erro: MENSAGEM_FECHADO, codigo: 'fechado' }, 422)
  }

  // Taxa de entrega: SEMPRE calculada aqui pelo bairro (nunca vem do cliente).
  let taxaEntregaCentavos = 0
  if (entregaEstruturada) {
    const { data: taxaData, error: erroTaxa } = await supabase
      .rpc('taxa_entrega_do_bairro', { p_barraca_id: barracaId, p_bairro: entregaEstruturada.bairro })
      .single()
    const taxa = taxaData as { permitido: boolean; taxa_centavos: number } | null
    if (erroTaxa || !taxa) {
      console.error('criar-pedido-cardapio: falha em taxa_entrega_do_bairro', erroTaxa?.message)
      return jsonResponse({ erro: 'Não foi possível calcular a taxa de entrega. Tente de novo.' }, 500)
    }
    if (!taxa.permitido) {
      return jsonResponse({ erro: 'Não entregamos nesse bairro.' }, 422)
    }
    taxaEntregaCentavos = Math.max(0, Math.floor(Number(taxa.taxa_centavos) || 0))

    // O cliente confirmou um total na tela; se o servidor chegou a outro (lista de bairros
    // velha no navegador, dono mexeu na taxa), NÃO cria o pedido sem ele ver o novo valor.
    const esperado = body.total_esperado_centavos
    if (esperado !== undefined && esperado !== null && esperado !== totalCentavos + taxaEntregaCentavos) {
      return jsonResponse(
        {
          erro: 'O valor da entrega mudou. Confira o novo total antes de enviar.',
          total_centavos: totalCentavos + taxaEntregaCentavos,
          taxa_entrega_centavos: taxaEntregaCentavos,
        },
        409,
      )
    }
  }

  // Estoque: com a opção ligada pelo dono, quantidade acima do saldo é recusada AQUI, antes
  // de criar o pedido. Fica DEPOIS da idempotência acima: pedido já criado nunca é
  // recusado por estoque. Desligada (padrão), nunca recusa.
  if (barraca.estoque_bloqueia === true) {
    const { data: saldos } = await supabase
      .from('itens')
      .select('id, estoque_qtd')
      .eq('barraca_id', barracaId)
      .in('id', [...new Set(itensResolvidos.map((i) => i.item_id))])
    const saldoPorItem = new Map<string, number | null>(
      ((saldos ?? []) as { id: string; estoque_qtd: number | null }[]).map((r) => [r.id, r.estoque_qtd]),
    )
    const acima = itensAcimaDoEstoque(itensResolvidos, saldoPorItem)
    if (acima.length > 0) {
      return jsonResponse({ erro: `Sem estoque suficiente — ${acima.join('; ')}` }, 422)
    }
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

  // Modo antigo (sem endereço estruturado): a comanda não tem rua, então nome,
  // telefone e endereço livre vão também na observação. Com entrega estruturada
  // a comanda/link do entregador já mostram tudo; a observação só marca a origem.
  const observacao = entregaEstruturada
    ? ['PAGAR NA ENTREGA', observacaoCliente || null].filter(Boolean).join(' | ')
    : [
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
      p_entrega: entregaEstruturada ?? {
        // Sem rua: o endereço livre vai em `referencia` (a comanda e o link do
        // entregador mostram nome, telefone e essa referência).
        nome,
        telefone,
        referencia: endereco || null,
      },
      p_taxa_entrega_centavos: taxaEntregaCentavos,
      p_cliente_nome: entregaEstruturada ? entregaEstruturada.nome : nome,
    })
    .single()

  if (erroPedido || !criado) {
    console.error('criar-pedido-cardapio: falha em criar_pedido', erroPedido?.message)
    return jsonResponse({ erro: 'Não foi possível enviar o pedido agora. Tente de novo.' }, 500)
  }

  // Vínculo com o perfil (best-effort: nunca derruba um pedido já criado).
  if (perfil.clienteId) {
    const { error: erroVinculo } = await supabase
      .from('pedidos')
      .update({ cliente_id: perfil.clienteId })
      .eq('id', (criado as { pedido_id: string }).pedido_id)
    if (erroVinculo) console.error('criar-pedido-cardapio: falha ao vincular cliente', erroVinculo.message)
  }

  const aceitaMarketing = body.consentimento_marketing === true || entregaBruta?.consentimento_marketing === true

  // Cadastro do cliente (LGPD: só com consentimento explícito, origem 'cardapio').
  // Best-effort: falha aqui NUNCA derruba um pedido já criado.
  if (entregaEstruturada) {
    try {
      let telefoneCadastro = entregaEstruturada.telefone
      if ((telefoneCadastro.length === 12 || telefoneCadastro.length === 13) && telefoneCadastro.startsWith('55')) {
        telefoneCadastro = telefoneCadastro.slice(2)
      }
      // Perfil já confirmado por código: o pedido anônimo NÃO sobrescreve nome nem aceite (só endereço).
      const { data: existente } = await supabase
        .from('clientes_finais')
        .select('telefone_confirmado_em')
        .eq('barraca_id', barracaId)
        .eq('telefone', telefoneCadastro)
        .maybeSingle()
      const confirmado = Boolean((existente as { telefone_confirmado_em?: string | null } | null)?.telefone_confirmado_em)
      const { error: erroCliente } = await supabase.from('clientes_finais').upsert(
        {
          barraca_id: barracaId,
          ...(confirmado ? {} : { nome: entregaEstruturada.nome }),
          telefone: telefoneCadastro,
          rua: entregaEstruturada.rua,
          numero: entregaEstruturada.numero,
          bairro: entregaEstruturada.bairro,
          referencia: entregaEstruturada.referencia,
          origem: 'cardapio',
          ...(confirmado ? {} : { consentimento_lgpd_em: new Date().toISOString() }),
          // Só grava quando marcado: pedido sem o aceite NÃO apaga um aceite anterior.
          ...(aceitaMarketing ? { consentimento_marketing_em: new Date().toISOString() } : {}),
        },
        { onConflict: 'barraca_id,telefone' },
      )
      if (erroCliente) console.warn('criar-pedido-cardapio: cliente não salvo', erroCliente.message)
    } catch (erro) {
      console.warn('criar-pedido-cardapio: cliente não salvo', String(erro))
    }
  }

  return jsonResponse({
    senha: (criado as { senha: number }).senha,
    taxa_entrega_centavos: taxaEntregaCentavos,
    total_centavos: totalCentavos + taxaEntregaCentavos,
    itens: itensResolvidos,
  })
})
