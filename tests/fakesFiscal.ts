/* eslint-disable @typescript-eslint/no-explicit-any -- fakes de supabase/fetch dos testes */
// Banco em memória e Stripe simulada compartilhados pelos testes do módulo Fiscal (checkout e webhook).
// O banco reproduz os índices únicos de fiscal_assinaturas (cnpj e barraca só entre vivas; subscription e sessão únicas).
export type Linha = Record<string, any>

const VIVOS = ['pendente', 'active', 'past_due']
// Ocupa o CNPJ/barraca: vivo, ou canceled ainda dentro do período pago (trigger fiscal_assinaturas_unica_viva).
const ocupa = (r: Record<string, any>, agoraMs: number) =>
  VIVOS.includes(r.status) || (r.status === 'canceled' && r.current_period_end != null && Date.parse(r.current_period_end) > agoraMs)

export class BancoFiscal {
  tabelas: Record<string, Linha[]> = {
    assinaturas: [],
    assinatura_ofertas: [],
    usuarios_barracas: [],
    barracas: [],
    fiscal_assinaturas: [],
    eventos_webhook_stripe: [],
  }
  falhas = new Set<string>()
  fiscalAberto = true
  baseVigente = true
  agoraMs = Date.now()
  rpcChamadas: Array<{ nome: string; args: Record<string, any> }> = []
  moduloResultado = 'ok'

  rpc(nome: string, args: Record<string, any>) {
    this.rpcChamadas.push({ nome, args })
    if (nome === 'fiscal_contratacao_aberta') return Promise.resolve({ data: this.fiscalAberto, error: null })
    if (nome === 'assinatura_base_paga_vigente') return Promise.resolve({ data: this.baseVigente, error: null })
    if (nome === 'fiscal_sincronizar_modulo') return Promise.resolve({ data: this.moduloResultado, error: null })
    if (nome === 'fiscal_emissao_bloqueio') return Promise.resolve({ data: null, error: null })
    if (nome === 'consulta_externa_registrar') return Promise.resolve({ data: true, error: null })
    return Promise.resolve({ data: null, error: { message: `rpc desconhecida ${nome}` } })
  }

  from(tabela: string) {
    const st: { op: string; dados: Linha | null; filtros: Array<(r: Linha) => boolean>; retorna: boolean; single: boolean } = {
      op: 'select', dados: null, filtros: [], retorna: false, single: false,
    }
    const b: any = {
      insert: (d: Linha) => { st.op = 'insert'; st.dados = d; return b },
      update: (d: Linha) => { st.op = 'update'; st.dados = d; return b },
      delete: () => { st.op = 'delete'; return b },
      select: () => { if (st.op === 'update' || st.op === 'insert') st.retorna = true; return b },
      eq: (c: string, v: unknown) => { st.filtros.push((r) => r[c] === v); return b },
      in: (c: string, v: unknown[]) => { st.filtros.push((r) => v.includes(r[c])); return b },
      is: (c: string, v: unknown) => { st.filtros.push((r) => (r[c] ?? null) === v); return b },
      lt: (c: string, v: string) => { st.filtros.push((r) => r[c] != null && Date.parse(r[c]) < Date.parse(v)); return b },
      or: (expr: string) => {
        const lte = expr.match(/stripe_evento_em\.lte\.(.+)$/)?.[1]
        st.filtros.push((r) => r.stripe_evento_em == null || (lte !== undefined && Date.parse(r.stripe_evento_em) <= Date.parse(lte)))
        return b
      },
      limit: () => b,
      maybeSingle: () => { st.single = true; return b },
      single: () => { st.single = true; return b },
      then: (ok: (v: any) => unknown, err?: (e: unknown) => unknown) => Promise.resolve(exec()).then(ok, err),
    }
    const exec = () => {
      if (this.falhas.has(`${tabela}:${st.op}`)) return { data: null, error: { message: `falha simulada ${tabela}:${st.op}`, code: 'XX000' } }
      const linhas = (this.tabelas[tabela] ??= [])
      if (st.op === 'insert') {
        const nova = { created_at: new Date().toISOString(), stripe_evento_em: null, stripe_subscription_id: null, stripe_checkout_session_id: null, ...st.dados! }
        if (tabela === 'eventos_webhook_stripe' && linhas.some((r) => r.stripe_event_id === nova.stripe_event_id)) {
          return { data: null, error: { message: 'duplicate key', code: '23505' } }
        }
        if (tabela === 'fiscal_assinaturas' && this.violaUnico(nova)) return { data: null, error: { message: 'duplicate key', code: '23505' } }
        linhas.push(nova)
        return { data: st.retorna ? [nova] : null, error: null }
      }
      const alvo = linhas.filter((r) => st.filtros.every((f) => f(r)))
      if (st.op === 'update') {
        for (const r of alvo) Object.assign(r, st.dados)
        return { data: st.retorna ? alvo.map((r) => ({ ...r })) : null, error: null }
      }
      if (st.op === 'delete') {
        this.tabelas[tabela] = linhas.filter((r) => !alvo.includes(r))
        return { data: null, error: null }
      }
      return { data: st.single ? (alvo[0] ? { ...alvo[0] } : null) : alvo.map((r) => ({ ...r })), error: null }
    }
    return b
  }

  private violaUnico(nova: Linha): boolean {
    return this.tabelas.fiscal_assinaturas.some(
      (r) =>
        (ocupa(r, this.agoraMs) && ocupa(nova, this.agoraMs) && (r.cnpj === nova.cnpj || r.barraca_id === nova.barraca_id)) ||
        (nova.stripe_subscription_id && r.stripe_subscription_id === nova.stripe_subscription_id) ||
        (nova.stripe_checkout_session_id && r.stripe_checkout_session_id === nova.stripe_checkout_session_id),
    )
  }
}

export type Chamada = { url: string; metodo: string; headers: Record<string, string>; corpo: URLSearchParams }
export type Rota = { status: number; corpo?: unknown }

/** Stripe simulada: rotas "METODO caminho". Sem rota = 404. */
export function stripeSimulada(rotas: Record<string, Rota>, chamadas: Chamada[]): typeof fetch {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    const caminho = String(url).replace('https://api.stripe.com/v1/', '')
    const metodo = init?.method ?? 'GET'
    chamadas.push({ url: caminho, metodo, headers: (init?.headers ?? {}) as Record<string, string>, corpo: new URLSearchParams(String(init?.body ?? '')) })
    const r = rotas[`${metodo} ${caminho}`] ?? { status: 404 }
    return new Response(JSON.stringify(r.corpo ?? {}), { status: r.status })
  }) as typeof fetch
}
