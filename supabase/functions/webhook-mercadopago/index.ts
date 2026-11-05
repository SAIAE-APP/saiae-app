// Recebe a notificação de pagamento (Pix ou cartão) de QUALQUER provedor (Mercado Pago,
// Payments API type "payment", e os que vierem em ../_shared/pagamento) — Fase
// 2+3 do Cardápio Digital (CLAUDE.md, roadmap). NUNCA confia no corpo do
// webhook: confirma o status de verdade consultando o provedor de volta, com o
// token da barraca dona do pagamento (prática recomendada na doc oficial), e
// confere que o pagamento é mesmo daquele pendente (referência) e do valor
// certo (itens + taxa do snapshot).
//
// A notification_url é montada por pagamento em criar-pagamento-pix com
// `?pendente=<id>&p=<provedor>`, então a barraca (e o token dela) é achada pelo
// nosso banco ANTES de falar com o provedor — cada dono usa a própria conta e
// não há webhook configurado no painel. SEM `p` (cobranças emitidas antes da
// camada de provedores) vale Mercado Pago. O nome desta function é histórico e
// continua sendo o único endpoint de notificação: não renomear (URLs já
// emitidas apontam pra ele).
//
// Só quando o provedor confirma "aprovado" o pedido de verdade nasce em
// pedidos/itens_do_pedido — via criar_pedido (service role), que é
// idempotente por client_uuid: notificação repetida ou concorrente não cria
// dois pedidos. Pendentes órfãos (sem pagamento no MP) nunca recebem
// notificação e portanto nunca viram pedido.
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { chaveDoProvedor, obterProvedor } from '../_shared/pagamento/registro.ts'
import { buscarSegredoWebhook, buscarTokenDoProvedor, obterTokenVendedor } from '../_shared/pagamento/token.ts'
import {
  conciliacaoSemConfirmacao,
  decidirAprovadoDoPendente,
  statusFinalDoPendente,
  tokenDoWebhook,
} from '../_shared/pagamento/webhookAprovado.ts'
import { criarPedidoAprovado, registrarConciliacao, type BaseConciliacao } from '../_shared/pagamento/pedidoAprovado.ts'
import { ErroProvedor, decidirAssinatura, type ConsultaPagamento } from '../_shared/pagamento/tipos.ts'
import { STATUS_PENDENTE_ABERTOS, type TipoConciliacao } from '../_shared/pagamento/conciliacao.ts'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok')
  }

  const url = new URL(req.url)
  const pendenteIdUrl = url.searchParams.get('pendente')

  // Provedor da notificação: `p` na URL; sem `p` (cobrança antiga) = Mercado Pago.
  const provedorChave = chaveDoProvedor(url.searchParams.get('p'))
  const provedor = obterProvedor(provedorChave)
  if (!provedor) {
    return jsonResponse({ ok: true, aviso: 'provedor desconhecido' })
  }

  // O provedor exige 200 rápido — o que não é notificação de pagamento (ou não
  // tem id) ainda assim é confirmado pra não gerar retry infinito.
  const notificacao = await provedor.extrairIdDaNotificacao(url, () => req.json())
  if (notificacao.ignorar) {
    return jsonResponse({ ok: true, aviso: 'notificação ignorada' })
  }
  const pagamentoId = notificacao.idExterno

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  )

  const consulta = supabase
    .from('pagamentos_pendentes')
    // '*': tolera pendente de antes da coluna `provedor` (vale Mercado Pago).
    .select('*')
  const { data: pendente, error: erroPendente } = pendenteIdUrl
    ? await consulta.eq('id', pendenteIdUrl).maybeSingle()
    : await consulta.eq('mercadopago_order_id', pagamentoId).maybeSingle()

  if (erroPendente || !pendente) {
    return jsonResponse({ ok: true, aviso: 'pagamento pendente não encontrado' })
  }

  // O pendente tem que ser DESTE provedor (notificação de um provedor não confirma
  // cobrança de outro).
  if (chaveDoProvedor(pendente.provedor) !== provedor.chave) {
    return jsonResponse({ ok: true, aviso: 'provedor da notificação não confere com o pendente' })
  }

  // Já processado (retry do próprio provedor) — responde ok sem reprocessar.
  // 'expirado' NÃO é final: o cliente pode ter pago depois de expirar, e esse
  // dinheiro não pode sumir (ver decidirAprovado / pagamentos_conciliacao).
  if (!(STATUS_PENDENTE_ABERTOS as readonly string[]).includes(pendente.status)) {
    // Cashback: se o crédito falhou da primeira vez (best-effort), o reenvio do provedor tenta de novo. A RPC é idempotente
    // por pedido e nunca muda a resposta ao provedor.
    if (pendente.status === 'aprovado' && pendente.pedido_id && pendente.cliente_id) {
      try {
        await supabase.rpc('cashback_creditar_pedido', { p_pedido_id: pendente.pedido_id })
      } catch {
        console.error('cashback_credito_falhou', pendente.pedido_id)
      }
    }
    return jsonResponse({ ok: true })
  }

  // O id da notificação tem que ser o do pagamento criado para este pendente.
  if (pendente.mercadopago_order_id && pendente.mercadopago_order_id !== pagamentoId) {
    return jsonResponse({ ok: true, aviso: 'pagamento não pertence a este pendente' })
  }

  // Assinatura da notificação (camada extra, só quando o dono cadastrou o segredo e o
  // provedor assina). Assinatura PRESENTE e inválida = forjada: 401, sem consultar nada.
  // Sem segredo ou sem cabeçalho segue só com a consulta de volta abaixo, que é a
  // garantia de verdade (o Mercado Pago pode não assinar notificações por pagamento).
  if (provedor.validarNotificacao) {
    const segredo = await buscarSegredoWebhook(supabase, pendente.barraca_id, provedor.chave, Deno.env)
    const assinatura = await provedor.validarNotificacao(req, segredo)
    // EXIGIR_ASSINATURA_MP=1: com segredo cadastrado, notificação SEM assinatura também é recusada (401).
    // Desligado por padrão: ver decidirAssinatura (tipos.ts).
    const decisao = decidirAssinatura(assinatura, Deno.env.get('EXIGIR_ASSINATURA_MP') === '1')
    if (decisao === 'rejeitar_invalida') {
      console.warn('webhook-mercadopago: assinatura inválida', { pendente: pendente.id })
      return jsonResponse({ ok: false, aviso: 'assinatura inválida' }, 401)
    }
    if (decisao === 'rejeitar_ausente') {
      console.warn('webhook-mercadopago: assinatura ausente e EXIGIR_ASSINATURA_MP=1', { pendente: pendente.id })
      return jsonResponse({ ok: false, aviso: 'assinatura ausente' }, 401)
    }
    if (assinatura === 'sem_assinatura') {
      console.warn('webhook-mercadopago: segredo cadastrado, mas a notificação veio sem assinatura', { pendente: pendente.id })
    }
  }

  // Mesma credencial que emitiu a cobrança: pendente com taxa Sai aê = OAuth do vendedor; sem taxa (anterior ao
  // corte) = token colado. Falha do OAuth devolve 500 (o provedor reenvia) sem confirmar nada.
  const credencial = await tokenDoWebhook(pendente, {
    vendedor: () => obterTokenVendedor(supabase, pendente.barraca_id, Deno.env),
    colado: () => buscarTokenDoProvedor(supabase, pendente.barraca_id, provedor.chave, Deno.env),
  })
  // Base dos registros de conciliação deste pagamento (antes e depois da consulta ao provedor).
  const baseConciliacao: BaseConciliacao = {
    supabase,
    barracaId: pendente.barraca_id,
    pendenteId: pendente.id,
    provedor: provedor.chave,
    idExterno: pagamentoId,
    origem: 'webhook-mercadopago',
  }
  if (!credencial.ok) {
    if (credencial.status !== 200) console.error('webhook-mercadopago: credencial indisponível', { pendente: pendente.id, aviso: credencial.aviso })
    // OAuth indisponível: registra ANTES do 500 (o provedor reenvia, mas pode desistir e o dinheiro sumiria).
    const semCredencial = conciliacaoSemConfirmacao(pendente, pagamentoId, 'credencial')
    if (semCredencial) await registrarConciliacao(baseConciliacao, semCredencial.tipo, { detalhe: semCredencial.detalhe })
    return jsonResponse({ ok: credencial.status === 200, aviso: credencial.aviso }, credencial.status)
  }
  const tokenProvedor = credencial.token

  // Confirmação de verdade: consulta o provedor com o token da própria barraca,
  // nunca confiando só no corpo do webhook.
  let leitura: ConsultaPagamento
  try {
    leitura = await provedor.consultarPagamento({ token: tokenProvedor, idExterno: pagamentoId })
  } catch (erro) {
    if (erro instanceof ErroProvedor && !erro.rede) {
      // Provedor recusou a consulta (não encontrado/sem permissão): reenviar não resolve; fica a conciliação.
      const recusada = conciliacaoSemConfirmacao(pendente, pagamentoId, 'consulta_recusada')
      if (recusada) await registrarConciliacao(baseConciliacao, recusada.tipo, { detalhe: recusada.detalhe })
      return jsonResponse({ ok: true, aviso: erro.message })
    }
    // Sem rede até o provedor: 500 faz ele tentar de novo (nada foi processado).
    console.error('webhook-mercadopago: provedor inacessível', String(erro))
    return jsonResponse({ ok: false, aviso: 'provedor inacessível' }, 500)
  }

  if (leitura.referencia !== pendente.id) {
    return jsonResponse({ ok: true, aviso: 'external_reference não confere' })
  }

  if (leitura.status === 'aprovado') {
    // Total esperado = itens − cupom + taxa de entrega + taxa Sai aê, tudo DO SNAPSHOT do pendente (gravado no
    // momento da cobrança). Nada é recalculado aqui: se o dono mudou a tabela de bairros depois, vale o que o
    // cliente viu e pagou. Com taxa Sai aê, a comissão informada pelo provedor tem que ser a mesma (não informada:
    // cria o pedido e registra conciliação). Pendente
    // antigo (sem entrega, sem taxa) => conta idêntica à de antes. Vale igual para Pix e cartão.
    const { decisao, totalCentavos, taxaEntregaCentavos, taxaPlataformaCentavos } = decidirAprovadoDoPendente(pendente, leitura)
    if (decisao.acao === 'ignorar') return jsonResponse({ ok: true })

    // Idempotente: a mesma notificação repetida não duplica (unique provedor+id+tipo).
    const registrarConciliacaoAprovado = (
      tipo: TipoConciliacao,
      extra: { situacao?: string; pedido_id?: string | null; detalhe?: string } = {},
    ): Promise<boolean> =>
      registrarConciliacao(baseConciliacao, tipo, { valor_pago_centavos: leitura.valorCentavos, valor_esperado_centavos: totalCentavos, ...extra })

    if (decisao.acao === 'conciliar_valor') {
      // Pago mas não confere: NÃO cria pedido; registra para o dono conferir (e
      // devolver o dinheiro pelo painel do provedor, se for o caso).
      console.error('webhook-mercadopago: valor pago não confere', {
        pendente: pendente.id,
        pago_centavos: leitura.valorCentavos,
        esperado_centavos: totalCentavos,
        taxa_entrega_centavos: taxaEntregaCentavos,
        taxa_plataforma_centavos: taxaPlataformaCentavos,
        comissao_centavos: leitura.comissaoCentavos,
      })
      const registrado = await registrarConciliacaoAprovado('valor_divergente', {
        detalhe:
          `pendente ${pendente.status}; taxa de entrega ${taxaEntregaCentavos}` +
          (taxaPlataformaCentavos > 0 ? `; taxa Sai aê ${taxaPlataformaCentavos}; comissão no provedor ${leitura.comissaoCentavos ?? 'não informada'}` : ''),
      })
      // Sem registro o pagamento ficaria invisível: 500 faz o provedor reenviar.
      if (!registrado) return jsonResponse({ ok: false, aviso: 'falha ao registrar conciliação' }, 500)
      return jsonResponse({ ok: true, aviso: 'valor pago não confere com o pedido' })
    }

    // Cria o pedido (mesmo caminho do cartão aprovado na resposta síncrona, ver pedidoAprovado.ts).
    const criado = await criarPedidoAprovado(
      { ...baseConciliacao, pendente, valorPagoCentavos: leitura.valorCentavos, totalCentavos, taxaEntregaCentavos, taxaPlataformaCentavos },
      decisao,
    )
    if (!criado.ok && criado.etapa === 'pedido') {
      // 500 faz o MP tentar de novo depois — o pagamento já foi aprovado e o
      // pedido ainda não existe, então NÃO pode ser engolido como sucesso.
      // Fica também registrado, pra o dinheiro não ficar invisível se o provedor
      // desistir de reenviar.
      await registrarConciliacaoAprovado('pedido_nao_criado', { detalhe: criado.detalhe.slice(0, 300) })
      return jsonResponse({ ok: false, aviso: `falha ao criar pedido: ${criado.detalhe}` }, 500)
    }
    // Resgate de cashback não confirmado: mesma regra do cupom (500 antes de marcar aprovado; o provedor reenvia).
    if (!criado.ok && criado.etapa === 'cashback') return jsonResponse({ ok: false, aviso: 'falha ao confirmar o saldo de cashback' }, 500)
    // Cupom não confirmado: 500 ANTES de marcar o pendente aprovado; o provedor reenvia e tentamos de novo.
    if (!criado.ok) return jsonResponse({ ok: false, aviso: 'falha ao confirmar o cupom' }, 500)

    return jsonResponse({ ok: true })
  }

  // Só mexe em pendente ainda 'pendente': um 'expirado' que o provedor volta a
  // reportar como cancelado/rejeitado continua como está. Cartão cancelado ou
  // recusado termina 'rejeitado' (mesmo status que o criar-pagamento-pix grava).
  if (leitura.status === 'expirado') {
    await supabase.from('pagamentos_pendentes').update({ status: statusFinalDoPendente(pendente, leitura.status) }).eq('id', pendente.id).eq('status', 'pendente')
    await supabase.rpc('cupom_liberar', { p_pendente_id: pendente.id }) // devolve a vaga do cupom (se houver)
    return jsonResponse({ ok: true })
  }

  if (leitura.status === 'rejeitado') {
    await supabase.from('pagamentos_pendentes').update({ status: statusFinalDoPendente(pendente, leitura.status) }).eq('id', pendente.id).eq('status', 'pendente')
    await supabase.rpc('cupom_liberar', { p_pendente_id: pendente.id }) // devolve a vaga do cupom (se houver)
    return jsonResponse({ ok: true })
  }

  // Ainda pendente do lado do provedor — não muda nada, espera a próxima notificação.
  return jsonResponse({ ok: true })
})
