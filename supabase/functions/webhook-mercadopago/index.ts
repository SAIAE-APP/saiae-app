// Recebe a notificação de pagamento Pix de QUALQUER provedor (Mercado Pago,
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
import { buscarTokenDoProvedor } from '../_shared/pagamento/token.ts'
import { ErroProvedor, type ConsultaPagamento } from '../_shared/pagamento/tipos.ts'
import {
  STATUS_PENDENTE_ABERTOS,
  decidirAprovado,
  totalEsperadoDoPendente,
  type TipoConciliacao,
} from '../_shared/pagamento/conciliacao.ts'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

type ItemPendente = { quantidade: number; preco_centavos_unitario: number }

type EntregaPendente = {
  nome: string
  telefone: string
  rua: string
  numero: string
  bairro: string
  referencia: string | null
  consentimento_lgpd_em?: string | null
  consentimento_marketing_em?: string | null
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

  // Assinatura/segredo, quando o provedor tiver (o corpo é lido de uma cópia).
  if (provedor.validarNotificacao && !(await provedor.validarNotificacao(req.clone()))) {
    return jsonResponse({ ok: true, aviso: 'notificação não autenticada' })
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
    return jsonResponse({ ok: true })
  }

  // O id da notificação tem que ser o do pagamento criado para este pendente.
  if (pendente.mercadopago_order_id && pendente.mercadopago_order_id !== pagamentoId) {
    return jsonResponse({ ok: true, aviso: 'pagamento não pertence a este pendente' })
  }

  const tokenProvedor = await buscarTokenDoProvedor(supabase, pendente.barraca_id, provedor.chave)
  if (!tokenProvedor) {
    return jsonResponse({ ok: true, aviso: 'token da barraca não encontrado' })
  }

  // Confirmação de verdade: consulta o provedor com o token da própria barraca,
  // nunca confiando só no corpo do webhook.
  let leitura: ConsultaPagamento
  try {
    leitura = await provedor.consultarPagamento({ token: tokenProvedor, idExterno: pagamentoId })
  } catch (erro) {
    if (erro instanceof ErroProvedor && !erro.rede) {
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
    // Total esperado = itens + taxa de entrega DO SNAPSHOT do pendente (gravado
    // no momento da cobrança). A taxa NUNCA é recalculada aqui: se o dono
    // mudou a tabela de bairros depois, vale o que o cliente viu e pagou.
    // Pendente sem entrega tem taxa 0 => conta idêntica à de antes.
    const taxaEntregaCentavos = Number(pendente.taxa_entrega_centavos ?? 0)
    const totalCentavos = totalEsperadoDoPendente(pendente.itens as ItemPendente[], taxaEntregaCentavos)

    const decisao = decidirAprovado({
      statusPendente: pendente.status,
      valorPagoCentavos: leitura.valorCentavos,
      totalEsperadoCentavos: totalCentavos,
    })
    if (decisao.acao === 'ignorar') return jsonResponse({ ok: true })

    const registrarConciliacao = async (
      tipo: TipoConciliacao,
      extra: { situacao?: string; pedido_id?: string | null; detalhe?: string } = {},
    ): Promise<boolean> => {
      // Idempotente: a mesma notificação repetida não duplica (unique provedor+id+tipo).
      const { error } = await supabase.from('pagamentos_conciliacao').upsert(
        {
          barraca_id: pendente.barraca_id,
          pendente_id: pendente.id,
          provedor: provedor.chave,
          id_externo: pagamentoId,
          tipo,
          valor_pago_centavos: leitura.valorCentavos,
          valor_esperado_centavos: totalCentavos,
          ...extra,
        },
        { onConflict: 'provedor,id_externo,tipo', ignoreDuplicates: true },
      )
      if (error) console.error('webhook-mercadopago: conciliação não registrada', error.message)
      return !error
    }

    if (decisao.acao === 'conciliar_valor') {
      // Pago mas não confere: NÃO cria pedido; registra para o dono conferir (e
      // devolver o dinheiro pelo painel do provedor, se for o caso).
      console.error('webhook-mercadopago: valor pago não confere', {
        pendente: pendente.id,
        pago_centavos: leitura.valorCentavos,
        esperado_centavos: totalCentavos,
        taxa_entrega_centavos: taxaEntregaCentavos,
      })
      const registrado = await registrarConciliacao('valor_divergente', {
        detalhe: `pendente ${pendente.status}; taxa de entrega ${taxaEntregaCentavos}`,
      })
      // Sem registro o pagamento ficaria invisível: 500 faz o provedor reenviar.
      if (!registrado) return jsonResponse({ ok: false, aviso: 'falha ao registrar conciliação' }, 500)
      return jsonResponse({ ok: true, aviso: 'valor pago não confere com o pedido' })
    }

    // Argumentos de sempre; os de entrega só entram quando o pendente é de
    // Entrega, pra pedido comum chamar criar_pedido EXATAMENTE como hoje.
    const entrega: EntregaPendente | null =
      pendente.tipo_atendimento === 'entrega' && pendente.entrega ? (pendente.entrega as EntregaPendente) : null
    const argsPedido: Record<string, unknown> = {
      p_barraca_id: pendente.barraca_id,
      p_mesa: pendente.mesa,
      p_viagem: pendente.viagem,
      p_observacao: pendente.observacao,
      p_client_uuid: pendente.client_uuid,
      p_metodo_pagamento: 'pix',
      p_itens: pendente.itens,
    }
    if (entrega) {
      argsPedido.p_tipo_atendimento = 'entrega'
      argsPedido.p_entrega = {
        nome: entrega.nome,
        telefone: entrega.telefone,
        rua: entrega.rua,
        numero: entrega.numero,
        bairro: entrega.bairro,
        referencia: entrega.referencia,
      }
      argsPedido.p_taxa_entrega_centavos = taxaEntregaCentavos
      if (pendente.cliente_nome) argsPedido.p_cliente_nome = pendente.cliente_nome
    }
    // Telefone do aviso "pedido pronto": só entra quando existe (sem ele a chamada
    // é IDÊNTICA à de antes).
    if (pendente.cliente_telefone) argsPedido.p_cliente_telefone = pendente.cliente_telefone

    const { data: resultadoPedido, error: erroPedido } = await supabase.rpc('criar_pedido', argsPedido).single()

    if (erroPedido || !resultadoPedido) {
      // 500 faz o MP tentar de novo depois — o pagamento já foi aprovado e o
      // pedido ainda não existe, então NÃO pode ser engolido como sucesso.
      // Fica também registrado, pra o dinheiro não ficar invisível se o provedor
      // desistir de reenviar.
      await registrarConciliacao('pedido_nao_criado', { detalhe: String(erroPedido?.message ?? 'sem resposta').slice(0, 300) })
      return jsonResponse({ ok: false, aviso: `falha ao criar pedido: ${erroPedido?.message}` }, 500)
    }

    const pedidoId = (resultadoPedido as { pedido_id: string }).pedido_id
    await supabase
      .from('pagamentos_pendentes')
      .update({ status: 'aprovado', pedido_id: pedidoId })
      .eq('id', pendente.id)

    // Registros de conciliação (best-effort: o pedido já existe e foi pago, então
    // NADA aqui pode falhar a resposta ao provedor).
    try {
      // Uma falha anterior de criar_pedido, agora resolvida.
      await supabase
        .from('pagamentos_conciliacao')
        .update({ situacao: 'resolvido', pedido_id: pedidoId, resolvido_em: new Date().toISOString() })
        .eq('provedor', provedor.chave)
        .eq('id_externo', pagamentoId)
        .eq('tipo', 'pedido_nao_criado')
      // Pago depois de expirar, com valor certo: o pedido nasceu; o registro
      // informa o dono de que ele chegou fora do prazo.
      if (decisao.tardio) {
        await registrarConciliacao('pago_apos_expirar', {
          situacao: 'pedido_criado',
          pedido_id: pedidoId,
          detalhe: 'Pix pago depois do prazo; o pedido foi criado normalmente.',
        })
      }
    } catch (erroConciliacao) {
      console.warn('webhook-mercadopago: conciliação não atualizada', String(erroConciliacao))
    }

    // Entrega: guarda/atualiza o cliente (endereço pra próximos pedidos), com o
    // consentimento LGPD que ele deu no formulário. Best-effort: o pedido já
    // existe e foi pago, então NADA aqui pode falhar a resposta ao MP.
    if (entrega?.consentimento_lgpd_em) {
      try {
        const { error: erroCliente } = await supabase.from('clientes_finais').upsert(
          {
            barraca_id: pendente.barraca_id,
            nome: entrega.nome,
            telefone: entrega.telefone,
            rua: entrega.rua,
            numero: entrega.numero,
            bairro: entrega.bairro,
            referencia: entrega.referencia,
            origem: 'cardapio',
            consentimento_lgpd_em: entrega.consentimento_lgpd_em,
            ...(entrega.consentimento_marketing_em ? { consentimento_marketing_em: entrega.consentimento_marketing_em } : {}),
          },
          { onConflict: 'barraca_id,telefone' },
        )
        if (erroCliente) console.warn('webhook-mercadopago: cliente_final não salvo', erroCliente.message)
      } catch (erroCliente) {
        console.warn('webhook-mercadopago: cliente_final não salvo', String(erroCliente))
      }
    }

    return jsonResponse({ ok: true })
  }

  // Só mexe em pendente ainda 'pendente': um 'expirado' que o provedor volta a
  // reportar como cancelado/rejeitado continua como está.
  if (leitura.status === 'expirado') {
    await supabase.from('pagamentos_pendentes').update({ status: 'expirado' }).eq('id', pendente.id).eq('status', 'pendente')
    return jsonResponse({ ok: true })
  }

  if (leitura.status === 'rejeitado') {
    await supabase.from('pagamentos_pendentes').update({ status: 'rejeitado' }).eq('id', pendente.id).eq('status', 'pendente')
    return jsonResponse({ ok: true })
  }

  // Ainda pendente do lado do provedor — não muda nada, espera a próxima notificação.
  return jsonResponse({ ok: true })
})
