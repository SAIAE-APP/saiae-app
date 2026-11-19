// Eventos Stripe das assinaturas do módulo Fiscal (metadata.tipo = 'fiscal'). Gravam SÓ em fiscal_assinaturas, nunca em
// `assinaturas`. Chamado por processarEvento (stripeWebhook.ts) antes do fluxo da base; devolve true se tratou o evento.
//
//  - A assinatura Stripe se liga à reserva pelo `reserva_id` da metadata (id da linha de fiscal_assinaturas), por
//    update condicional (status pendente e sem assinatura vinculada): com duas subscriptions para a mesma reserva só a
//    primeira vincula; a outra é cancelada na hora na Stripe e a linha vinculada nunca é sobrescrita.
//  - Todo update é condicional: ordem do evento (stripe_evento_em) E estados de origem esperados. Evento atrasado não
//    desfaz o mais novo, e `expired` não é revivido por pagamento.
//  - O módulo `fiscal` da barraca NÃO é mexido aqui por argumento: depois de cada update aplicado chama-se a RPC
//    fiscal_sincronizar_modulo, que lê o estado FINAL das linhas sob lock da barraca (quem roda por último vê a última
//    linha) e só desliga o módulo quando nenhuma assinatura fiscal da barraca segue vigente. Carência: ver a migration
//    20261110120000 (active = fim do período; past_due = grace_until, 3 dias; canceled = fim do período).
//  - Falta do termo (metadata.termo_versao) ao ativar vira erro (500, a Stripe reenvia): não fica pago sem módulo.
import {
  STRIPE_API,
  periodoFimIso,
  subscriptionIdDaFatura,
  type DepsWebhookStripe,
  type EventoStripe,
  type SupabaseMinimo,
} from './stripeWebhook.ts'

const GRACA_MS = 3 * 24 * 60 * 60 * 1000
const ESTADOS_ATIVAVEIS = ['pendente', 'active', 'past_due', 'canceled']
const ESTADOS_ENCERRAVEIS = ['pendente', 'active', 'past_due', 'canceled']

type Linha = {
  id: string
  usuario_id: string
  barraca_id: string
  cnpj: string
  status: string
  stripe_subscription_id: string | null
}
type Metadata = Record<string, unknown> | null | undefined

const texto = (v: unknown): string | null => (typeof v === 'string' && v ? v : null)
const metadataFiscal = (m: Metadata) => (m && typeof m === 'object' && (m as Record<string, unknown>).tipo === 'fiscal' ? (m as Record<string, unknown>) : null)

async function lerLinhas(supabase: SupabaseMinimo, coluna: string, valor: string, contexto: string): Promise<Linha[]> {
  const { data, error } = await supabase
    .from('fiscal_assinaturas')
    .select('id, usuario_id, barraca_id, cnpj, status, stripe_subscription_id')
    .eq(coluna, valor)
  if (error) throw new Error(`${contexto}: ${error.message}`)
  return (data ?? []) as Linha[]
}

/** Update condicional por id: só estados de origem esperados e só se o evento não for mais antigo que o último aplicado. */
async function atualizarFiscal(
  supabase: SupabaseMinimo,
  id: string,
  campos: Record<string, unknown>,
  quandoIso: string,
  contexto: string,
  estados: string[],
): Promise<boolean> {
  const { data, error } = await supabase
    .from('fiscal_assinaturas')
    .update({ ...campos, stripe_evento_em: quandoIso })
    .eq('id', id)
    .in('status', estados)
    .or(`stripe_evento_em.is.null,stripe_evento_em.lte.${quandoIso}`)
    .select('id')
  if (error) throw new Error(`${contexto}: ${error.message}`)
  return !!data && data.length > 0
}

/** Liga o módulo ao estado das linhas (RPC transacional). 'termo_obrigatorio' não é erro: reenviar não resolve. */
async function sincronizarModulo(supabase: SupabaseMinimo, barracaId: string, termoVersao: string | null, contexto: string): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).rpc('fiscal_sincronizar_modulo', { p_barraca_id: barracaId, p_termo_versao: termoVersao })
  if (error) throw new Error(`${contexto}: módulo fiscal: ${error.message}`)
  if (data === 'termo_obrigatorio' || data === 'invalido') console.warn('webhook-stripe: módulo fiscal não alterado', contexto, data)
}

/** Cancela na hora uma assinatura fiscal que não pode valer (duplicada ou sem reserva). 404 = já não existe. */
async function cancelarDuplicada(deps: DepsWebhookStripe, subscriptionId: string, motivo: string): Promise<void> {
  console.error('webhook-stripe: assinatura fiscal DUPLICADA/ÓRFÃ cancelada', subscriptionId, motivo)
  const resp = await deps.fetch(`${STRIPE_API}/subscriptions/${subscriptionId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${deps.stripeSecretKey}` },
  })
  if (!resp.ok && resp.status !== 404) throw new Error(`cancelar duplicada ${subscriptionId}: HTTP ${resp.status}`)
}

/**
 * Vincula a assinatura à reserva. 'ok' = vinculada agora ou já era esta mesma assinatura (reentrega);
 * 'outra' = a reserva já tem OUTRA assinatura ou já não está pendente; 'ausente' = a reserva não existe.
 */
async function ligarReserva(
  supabase: SupabaseMinimo,
  reservaId: string,
  subscriptionId: string,
  campos: Record<string, unknown>,
  contexto: string,
): Promise<{ resultado: 'ok'; linha: Linha } | { resultado: 'outra' | 'ausente' }> {
  const { data, error } = await supabase
    .from('fiscal_assinaturas')
    .update({ ...campos, stripe_subscription_id: subscriptionId })
    .eq('id', reservaId)
    .eq('status', 'pendente')
    .is('stripe_subscription_id', null)
    .select('id, usuario_id, barraca_id, cnpj, status, stripe_subscription_id')
  if (error) throw new Error(`${contexto}: ${error.message}`)
  if (data && data.length > 0) return { resultado: 'ok', linha: data[0] as Linha }
  const [atual] = await lerLinhas(supabase, 'id', reservaId, contexto)
  if (!atual) return { resultado: 'ausente' }
  return atual.stripe_subscription_id === subscriptionId ? { resultado: 'ok', linha: atual } : { resultado: 'outra' }
}

export async function processarEventoFiscal(
  evento: EventoStripe,
  deps: DepsWebhookStripe,
  aux: { buscarNaStripe: (caminho: string) => Promise<Record<string, unknown> | null>; quandoIso: string; agoraIso: string; agora: number },
): Promise<boolean> {
  const { supabase } = deps
  const { buscarNaStripe, quandoIso, agoraIso, agora } = aux
  const obj = evento.data.object

  /** Linha já vinculada a esta assinatura Stripe (identifica evento fiscal mesmo sem metadata, p. ex. reembolso). */
  async function linhaPorSub(subscriptionId: string | null, contexto: string): Promise<Linha | null> {
    if (!subscriptionId) return null
    return (await lerLinhas(supabase, 'stripe_subscription_id', subscriptionId, contexto))[0] ?? null
  }

  async function ativar(
    linha: Linha,
    subscriptionId: string,
    assinaturaStripe: Record<string, unknown>,
    extra: Record<string, unknown>,
    contexto: string,
    termo: unknown,
    estados: string[] = ESTADOS_ATIVAVEIS,
  ) {
    // Sem o termo não liga o módulo em silêncio: erro => 500 e a Stripe reenvia (não fica pago sem módulo).
    const termoVersao = texto(termo)
    if (!termoVersao) throw new Error(`${contexto}: metadata.termo_versao ausente`)
    const aplicou = await atualizarFiscal(
      supabase,
      linha.id,
      {
        ...extra,
        stripe_subscription_id: subscriptionId,
        status: 'active',
        current_period_end: periodoFimIso(assinaturaStripe),
        grace_until: null,
        canceled_at: null,
        updated_at: agoraIso,
      },
      quandoIso,
      contexto,
      estados,
    )
    if (aplicou) await sincronizarModulo(supabase, linha.barraca_id, termoVersao, contexto)
  }

  /** Muda o estado de uma assinatura já vinculada e ressincroniza o módulo. Linha ausente = nada a fazer. */
  async function mudar(subscriptionId: string | null, campos: Record<string, unknown>, estados: string[], contexto: string) {
    const linha = await linhaPorSub(subscriptionId, contexto)
    if (!linha) {
      console.warn('webhook-stripe: evento fiscal sem linha vinculada, ignorado', evento.id, contexto)
      return
    }
    const aplicou = await atualizarFiscal(supabase, linha.id, { ...campos, updated_at: agoraIso }, quandoIso, contexto, estados)
    if (aplicou) await sincronizarModulo(supabase, linha.barraca_id, null, contexto)
  }

  /** Acha a linha da assinatura (por id da assinatura ou, na primeira vez, pela reserva da metadata) ou resolve o destino dela. */
  async function linhaDaAssinatura(
    subscriptionId: string,
    metadata: Metadata,
    campos: Record<string, unknown>,
    contexto: string,
  ): Promise<Linha | null> {
    const existente = await linhaPorSub(subscriptionId, contexto)
    if (existente) return existente
    const reservaId = texto(metadata?.reserva_id)
    if (!reservaId) throw new Error(`${contexto}: metadata.reserva_id ausente`)
    const r = await ligarReserva(supabase, reservaId, subscriptionId, campos, contexto)
    if (r.resultado === 'ok') return r.linha
    await cancelarDuplicada(deps, subscriptionId, r.resultado === 'outra' ? `reserva ${reservaId} já tem outra assinatura` : `reserva ${reservaId} inexistente`)
    return null
  }

  switch (evento.type) {
    case 'checkout.session.completed': {
      const meta = metadataFiscal(obj.metadata as Metadata)
      if (!meta) return false
      const sessaoId = texto(obj.id)
      const subscriptionId = texto(obj.subscription)
      if (!sessaoId || !subscriptionId) return true
      const assinaturaStripe = await buscarNaStripe(`subscriptions/${subscriptionId}`)
      if (!assinaturaStripe) throw new Error('checkout.session.completed(fiscal): assinatura não encontrada na Stripe')
      const statusStripe = assinaturaStripe.status as string | undefined
      const pago =
        obj.payment_status === 'paid' || (obj.payment_status === 'no_payment_required' && (statusStripe === 'active' || statusStripe === 'trialing'))
      const contexto = 'checkout.session.completed(fiscal)'
      const vinculo = { stripe_customer_id: texto(obj.customer), stripe_checkout_session_id: sessaoId, updated_at: agoraIso }
      const linha = await linhaDaAssinatura(subscriptionId, meta, vinculo, contexto)
      if (!linha) return true
      if (pago) await ativar(linha, subscriptionId, assinaturaStripe, vinculo, contexto, meta.termo_versao)
      return true
    }

    case 'invoice.paid':
    case 'invoice.payment_failed': {
      const subscriptionId = subscriptionIdDaFatura(obj)
      if (!subscriptionId) return false
      const parent = obj.parent as { subscription_details?: { metadata?: Metadata } } | null | undefined
      const metaFatura = metadataFiscal(parent?.subscription_details?.metadata)
      const existente = await linhaPorSub(subscriptionId, evento.type)
      if (!existente && !metaFatura) return false // base
      const contexto = `${evento.type}(fiscal)`

      if (evento.type === 'invoice.payment_failed') {
        // Só quem está active entra em atraso. Já past_due não é tocado: uma só carência de 3 dias, sem estender a cada retry.
        await mudar(subscriptionId, { status: 'past_due', grace_until: new Date(agora + GRACA_MS).toISOString() }, ['active'], contexto)
        return true
      }

      const assinaturaStripe = await buscarNaStripe(`subscriptions/${subscriptionId}`)
      if (!assinaturaStripe) throw new Error(`${contexto}: assinatura não encontrada na Stripe`)
      const metadata = (assinaturaStripe.metadata as Metadata) ?? parent?.subscription_details?.metadata
      const linha = await linhaDaAssinatura(subscriptionId, metadata, { updated_at: agoraIso }, contexto)
      if (!linha) return true
      await ativar(linha, subscriptionId, assinaturaStripe, {}, contexto, (metadata as Record<string, unknown> | null | undefined)?.termo_versao)
      return true
    }

    case 'customer.subscription.updated': {
      const subscriptionId = texto(obj.id)
      if (!metadataFiscal(obj.metadata as Metadata) && !(await linhaPorSub(subscriptionId, evento.type))) return false
      if (obj.cancel_at_period_end === true) {
        const fim = periodoFimIso(obj)
        await mudar(
          subscriptionId,
          { status: 'canceled', canceled_at: agoraIso, ...(fim ? { current_period_end: fim } : {}) },
          ['active', 'past_due'],
          'customer.subscription.updated(fiscal cancelada)',
        )
        return true
      }
      // Mudou de ideia antes do fim: só volta quem estava `canceled`.
      const linha = await linhaPorSub(subscriptionId, evento.type)
      if (linha?.status === 'canceled') {
        await ativar(linha, subscriptionId as string, obj, {}, 'customer.subscription.updated(fiscal reativada)', (obj.metadata as Metadata)?.termo_versao, ['canceled'])
      }
      return true
    }

    case 'customer.subscription.deleted': {
      const subscriptionId = texto(obj.id)
      if (!metadataFiscal(obj.metadata as Metadata) && !(await linhaPorSub(subscriptionId, evento.type))) return false
      const fim = periodoFimIso(obj)
      await mudar(
        subscriptionId,
        { status: 'expired', canceled_at: agoraIso, ...(fim ? { current_period_end: fim } : {}) },
        ESTADOS_ENCERRAVEIS,
        'customer.subscription.deleted(fiscal)',
      )
      return true
    }

    case 'charge.refunded': {
      if (obj.refunded !== true) return false
      const invoiceId = texto(obj.invoice)
      if (!invoiceId) return false
      const fatura = await buscarNaStripe(`invoices/${invoiceId}`)
      const subscriptionId = fatura ? subscriptionIdDaFatura(fatura) : null
      if (!(await linhaPorSub(subscriptionId, evento.type))) return false
      await mudar(subscriptionId, { status: 'expired' }, ESTADOS_ENCERRAVEIS, 'charge.refunded(fiscal)')
      return true
    }

    default:
      return false
  }
}
