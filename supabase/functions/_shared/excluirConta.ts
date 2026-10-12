// Exclusão de conta self-service (Ajustes > Excluir minha conta). Irreversível. Fica em _shared, sem imports de
// jsr:/Deno, pra ser EXECUTADA nos testes (tests/excluirConta.test.ts) com supabase e Stripe simulados; a Edge
// Function (excluir-conta/index.ts) só liga as dependências reais.
//
// Ordem: assinatura na Stripe → dados (RPC excluir_dados_conta, só service role) → arquivos no Storage → login em
// auth.users. A assinatura vem PRIMEIRO e falha FECHADA: se a Stripe não cancelar, nada é apagado (nunca apagar a
// conta deixando cobrança viva, sem ninguém para cancelar). Se falhar depois disso, dá pra tentar de novo: cada etapa
// é idempotente (cancelar uma assinatura já cancelada conta como sucesso).
import { comCors } from './cors.ts'
import { STRIPE_API, atualizarAssinatura, type SupabaseMinimo } from './stripeWebhook.ts'

// O Allow-Origin vem da allowlist (comCors, _shared/cors.ts), nunca `*`.
const CORS_HEADERS = {
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

export const BUCKETS_EXCLUSAO = ['cardapio-fotos', 'logo-barraca']
export const MSG_EXCLUIR_ASSINATURA_FALHA = 'Não consegui cancelar sua assinatura agora. Tente de novo ou fale com o suporte.'
export const MSG_EXCLUIR_FALHA = 'Não foi possível excluir a conta agora. Tente novamente em instantes.'

/** Estados locais em que não há mais cobrança futura: `canceled` é cancelamento ao fim do período (a Stripe não
 * cobra de novo) e `expired` já acabou. Nesses a Stripe nem é chamada. */
const SEM_COBRANCA_FUTURA = ['canceled', 'expired']

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } })
}

export type DepsExcluirConta = {
  /** Valida o JWT e devolve o usuário (o id nunca vem do body). */
  autenticar: (jwt: string) => Promise<{ id: string } | null>
  admin: SupabaseMinimo & {
    rpc: (nome: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }>
    storage: {
      from: (bucket: string) => {
        list: (pasta: string, opcoes: { limit: number }) => PromiseLike<{ data: { name: string }[] | null }>
        remove: (caminhos: string[]) => PromiseLike<unknown>
      }
    }
    auth: { admin: { deleteUser: (id: string) => PromiseLike<{ error: { message: string } | null }> } }
  }
  /** Reenvia ao CRM os pedidos de apagar conversas da IA (falha não bloqueia a exclusão). */
  drenarFila: () => Promise<unknown>
  fetch: typeof fetch
  stripeSecretKey: string | undefined
  agoraMs?: () => number
}

/** Cancela NA HORA (sem cobrança futura). Devolve true se a assinatura já está encerrada na Stripe. */
async function cancelarNaStripe(deps: DepsExcluirConta, subscriptionId: string): Promise<boolean> {
  const cabecalhos = { Authorization: `Bearer ${deps.stripeSecretKey}` }
  let resposta: Response
  try {
    resposta = await deps.fetch(`${STRIPE_API}/subscriptions/${subscriptionId}`, { method: 'DELETE', headers: cabecalhos })
  } catch (erro) {
    console.error('excluir-conta: Stripe inacessível', String(erro))
    return false
  }
  const corpo = (await resposta.json().catch(() => null)) as { status?: string; error?: { type?: string; code?: string; message?: string } } | null
  if (resposta.ok) return corpo?.status === 'canceled'

  // Falhou. Se a assinatura já estava encerrada (repetição de uma tentativa anterior), conta como sucesso; qualquer
  // outra coisa (inclusive não conseguir confirmar) é falha — e a conta NÃO é apagada.
  console.error('excluir-conta: Stripe recusou o cancelamento', resposta.status, corpo?.error?.type, corpo?.error?.code, corpo?.error?.message)
  if (resposta.status === 404) return true
  try {
    const consulta = await deps.fetch(`${STRIPE_API}/subscriptions/${subscriptionId}`, { headers: cabecalhos })
    if (consulta.ok) return ((await consulta.json().catch(() => null)) as { status?: string } | null)?.status === 'canceled'
    return consulta.status === 404
  } catch {
    return false
  }
}

async function excluirContaInterno(req: Request, deps: DepsExcluirConta): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS })

  let confirmacao: string | undefined
  try {
    confirmacao = (await req.json())?.confirmacao
  } catch {
    return json({ erro: 'JSON inválido' }, 400)
  }
  if (confirmacao !== 'EXCLUIR') return json({ erro: 'Confirmação ausente' }, 400)

  const usuario = await deps.autenticar((req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, ''))
  if (!usuario) return json({ erro: 'Não autenticado' }, 401)
  const usuarioId = usuario.id
  const { admin } = deps
  const agoraMs = (deps.agoraMs ?? Date.now)()

  // 1) Assinatura: antes de apagar qualquer coisa.
  const { data: assinatura, error: erroAssinatura } = await admin
    .from('assinaturas')
    .select('stripe_subscription_id, status')
    .eq('usuario_id', usuarioId)
    .maybeSingle()
  if (erroAssinatura) {
    // Sem saber se há cobrança viva, não apaga.
    console.error('[excluir-conta] leitura da assinatura', erroAssinatura.message)
    return json({ erro: MSG_EXCLUIR_FALHA }, 500)
  }

  if (assinatura?.stripe_subscription_id && !SEM_COBRANCA_FUTURA.includes(assinatura.status)) {
    if (!deps.stripeSecretKey) {
      console.error('[excluir-conta] STRIPE_SECRET_KEY ausente com assinatura viva')
      return json({ erro: MSG_EXCLUIR_ASSINATURA_FALHA }, 502)
    }
    if (!(await cancelarNaStripe(deps, assinatura.stripe_subscription_id))) {
      return json({ erro: MSG_EXCLUIR_ASSINATURA_FALHA }, 502)
    }
    // Espelha no banco com o mesmo critério de ordem do webhook (evento mais novo não é sobrescrito). Best-effort: a
    // Stripe já cancelou e os dados vão ser apagados em seguida; se falhar só fica no log.
    const agoraIso = new Date(agoraMs).toISOString()
    try {
      await atualizarAssinatura(
        admin,
        { coluna: 'usuario_id', valor: usuarioId },
        { status: 'canceled', canceled_at: agoraIso, current_period_end: agoraIso, updated_at: agoraIso },
        new Date(Math.floor(agoraMs / 1000) * 1000).toISOString(),
        { contexto: 'excluir-conta' },
      )
    } catch (erro) {
      console.error('[excluir-conta] espelho da assinatura', String(erro))
    }
  }

  // 2) Dados, arquivos e login (como sempre).
  const { data: barracasApagadas, error: erroDados } = await admin.rpc('excluir_dados_conta', { p_usuario_id: usuarioId })
  if (erroDados) {
    console.error('[excluir-conta] dados', erroDados)
    return json({ erro: 'Não foi possível apagar os dados. Tente de novo.' }, 500)
  }

  // Storage: falha aqui não bloqueia a exclusão do login (arquivo órfão é melhor que conta que não sai).
  for (const barracaId of (barracasApagadas ?? []) as string[]) {
    for (const bucket of BUCKETS_EXCLUSAO) {
      try {
        const { data: arquivos } = await admin.storage.from(bucket).list(barracaId, { limit: 1000 })
        const caminhos = (arquivos ?? []).map((a) => `${barracaId}/${a.name}`)
        if (caminhos.length > 0) await admin.storage.from(bucket).remove(caminhos)
      } catch (e) {
        console.error('[excluir-conta] storage', bucket, barracaId, e)
      }
    }
  }

  // Conversas da IA no CRM: os pedidos já estão na fila (mesma transação dos dados). Falha do CRM não bloqueia a
  // exclusão da conta; o job periódico reenvia.
  await deps.drenarFila().catch(() => undefined)

  const { error: erroAuth } = await admin.auth.admin.deleteUser(usuarioId)
  if (erroAuth) {
    console.error('[excluir-conta] auth', erroAuth)
    return json({ erro: 'Dados apagados, mas não foi possível remover o login. Tente de novo.' }, 500)
  }

  return json({ ok: true })
}

export function tratarExcluirConta(req: Request, deps: DepsExcluirConta): Promise<Response> {
  return comCors(req, excluirContaInterno(req, deps))
}
