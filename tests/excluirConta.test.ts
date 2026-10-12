/* eslint-disable @typescript-eslint/no-explicit-any -- fakes de supabase/fetch dos testes */
// excluir-conta EXECUTADA com Stripe e supabase simulados: a assinatura viva é cancelada ANTES de apagar qualquer
// coisa, e se a Stripe falhar nada é apagado (nunca apagar a conta deixando cobrança viva). Rodar: npm test
import assert from 'node:assert/strict'
import { beforeEach, describe, test } from 'node:test'
import {
  BUCKETS_EXCLUSAO,
  MSG_EXCLUIR_ASSINATURA_FALHA,
  MSG_EXCLUIR_FALHA,
  tratarExcluirConta,
} from '../supabase/functions/_shared/excluirConta.ts'

const AGORA_MS = Date.UTC(2026, 9, 25, 12, 0, 0)

type Linha = Record<string, any>
class AdminSimulado {
  assinaturas: Linha[] = []
  falhas = new Set<string>()
  /** Ordem de tudo que mexe em dados, para provar que a Stripe vem antes. */
  eventos: string[] = []
  barracasApagadas: string[] = ['barraca-1']
  arquivos: Record<string, string[]> = { 'cardapio-fotos': ['a.jpg', 'b.jpg'], 'logo-barraca': [] }
  removidos: string[] = []
  usuarioApagado: string | null = null

  from(tabela: string) {
    const st: { op: string | null; dados: Linha | null; filtros: Array<(r: Linha) => boolean>; retorna: boolean; single: boolean } = {
      op: null, dados: null, filtros: [], retorna: false, single: false,
    }
    const b: any = {
      update: (d: Linha) => { st.op = 'update'; st.dados = d; return b },
      select: () => { if (st.op === 'update') st.retorna = true; else st.op = 'select'; return b },
      eq: (c: string, v: unknown) => { st.filtros.push((r) => r[c] === v); return b },
      or: (expr: string) => {
        const lte = expr.match(/stripe_evento_em\.lte\.(.+)$/)?.[1]
        st.filtros.push((r) => r.stripe_evento_em == null || (lte !== undefined && Date.parse(r.stripe_evento_em) <= Date.parse(lte)))
        return b
      },
      limit: () => b,
      maybeSingle: () => { st.single = true; return b },
      then: (ok: (v: any) => unknown, err?: (e: unknown) => unknown) => Promise.resolve(exec()).then(ok, err),
    }
    const exec = () => {
      if (this.falhas.has(`${tabela}:${st.op}`)) return { data: null, error: { message: `falha simulada ${tabela}:${st.op}` } }
      const alvo = this.assinaturas.filter((r) => st.filtros.every((f) => f(r)))
      if (st.op === 'update') {
        this.eventos.push('espelho')
        for (const r of alvo) Object.assign(r, st.dados)
        return { data: st.retorna ? alvo.map((r) => ({ usuario_id: r.usuario_id })) : null, error: null }
      }
      return { data: st.single ? (alvo[0] ?? null) : alvo, error: null }
    }
    return b
  }
  rpc(nome: string, args: Record<string, unknown>) {
    this.eventos.push(`rpc:${nome}:${String(args.p_usuario_id)}`)
    if (this.falhas.has(`rpc:${nome}`)) return Promise.resolve({ data: null, error: { message: 'boom' } })
    return Promise.resolve({ data: this.barracasApagadas, error: null })
  }
  storage = {
    from: (bucket: string) => ({
      list: async () => ({ data: (this.arquivos[bucket] ?? []).map((name) => ({ name })) }),
      remove: async (caminhos: string[]) => { this.removidos.push(...caminhos) },
    }),
  }
  auth = {
    admin: {
      deleteUser: async (id: string) => {
        this.eventos.push('deleteUser')
        if (this.falhas.has('auth:deleteUser')) return { error: { message: 'boom' } }
        this.usuarioApagado = id
        return { error: null }
      },
    },
  }
}

type Chamada = { caminho: string; metodo: string }
let admin: AdminSimulado
let chamadas: Chamada[]
let rotas: Record<string, { status: number; corpo?: unknown } | 'rede'>
let filaDrenada: number

function fetchSimulado(): typeof fetch {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    const caminho = String(url).replace('https://api.stripe.com/v1/', '')
    const metodo = init?.method ?? 'GET'
    chamadas.push({ caminho, metodo })
    admin.eventos.push(`stripe:${metodo} ${caminho}`)
    const r = rotas[`${metodo} ${caminho}`] ?? { status: 404 }
    if (r === 'rede') throw new TypeError('network down')
    return new Response(JSON.stringify(r.corpo ?? {}), { status: r.status })
  }) as typeof fetch
}

const requisicao = (corpo: unknown = { confirmacao: 'EXCLUIR' }, autorizado = true) =>
  new Request('https://x/excluir-conta', {
    method: 'POST',
    body: JSON.stringify(corpo),
    headers: autorizado ? { Authorization: 'Bearer jwt' } : {},
  })
const deps = (extra: Record<string, unknown> = {}) => ({
  autenticar: async (jwt: string) => (jwt === 'jwt' ? { id: 'u1' } : null),
  admin: admin as any,
  drenarFila: async () => { filaDrenada++ },
  fetch: fetchSimulado(),
  stripeSecretKey: 'sk_teste',
  agoraMs: () => AGORA_MS,
  ...extra,
})
const viva = (status = 'active') => {
  admin.assinaturas = [{ usuario_id: 'u1', status, stripe_subscription_id: 'sub_1', stripe_evento_em: null, current_period_end: '2026-11-25T00:00:00.000Z' }]
}
const chamouStripe = () => chamadas.length > 0
const apagouAlgo = () => admin.eventos.some((e) => e.startsWith('rpc:excluir_dados_conta')) || admin.usuarioApagado !== null

beforeEach(() => {
  admin = new AdminSimulado()
  chamadas = []
  filaDrenada = 0
  rotas = { 'DELETE subscriptions/sub_1': { status: 200, corpo: { id: 'sub_1', status: 'canceled' } } }
})

describe('com assinatura viva', () => {
  for (const status of ['active', 'past_due', 'trialing']) {
    test(`${status}: cancela na Stripe (imediato) e SÓ DEPOIS apaga dados, arquivos e login`, async () => {
      viva(status)
      const r = await tratarExcluirConta(requisicao(), deps())
      assert.equal(r.status, 200)
      assert.deepEqual(await r.json(), { ok: true })
      const ordem = admin.eventos.filter((e) => !e.startsWith('espelho'))
      assert.deepEqual(ordem, ['stripe:DELETE subscriptions/sub_1', 'rpc:excluir_dados_conta:u1', 'deleteUser'])
      assert.equal(chamadas[0].metodo, 'DELETE', 'cancelamento imediato (DELETE), não cancel_at_period_end')
      assert.equal(admin.usuarioApagado, 'u1')
      assert.deepEqual(admin.removidos, ['barraca-1/a.jpg', 'barraca-1/b.jpg'])
      assert.equal(filaDrenada, 1)
    })
  }

  test('espelha no banco como canceled com o mesmo critério de ordem do webhook (evento mais novo não é sobrescrito)', async () => {
    viva('active')
    await tratarExcluirConta(requisicao(), deps())
    assert.equal(admin.assinaturas[0].status, 'canceled')
    assert.equal(admin.assinaturas[0].current_period_end, new Date(AGORA_MS).toISOString())
    assert.equal(admin.assinaturas[0].stripe_evento_em, new Date(AGORA_MS).toISOString())

    viva('active')
    admin.assinaturas[0].stripe_evento_em = new Date(AGORA_MS + 60_000).toISOString() // webhook mais novo já aplicado
    assert.equal((await tratarExcluirConta(requisicao(), deps())).status, 200)
    assert.equal(admin.assinaturas[0].status, 'active', 'não sobrescreveu o evento mais novo')
  })

  test('falha do espelho não impede a exclusão (a Stripe já cancelou)', async () => {
    viva('active')
    admin.falhas.add('assinaturas:update')
    assert.equal((await tratarExcluirConta(requisicao(), deps())).status, 200)
    assert.equal(admin.usuarioApagado, 'u1')
  })
})

describe('falha FECHADA: se a Stripe não cancelar, nada é apagado', () => {
  const esperarNadaApagado = async (r: Response) => {
    assert.equal(r.status, 502)
    assert.equal((await r.json()).erro, MSG_EXCLUIR_ASSINATURA_FALHA)
    assert.equal(apagouAlgo(), false)
    assert.deepEqual(admin.removidos, [])
    assert.equal(filaDrenada, 0)
  }

  test('Stripe devolve erro (500)', async () => {
    viva()
    rotas['DELETE subscriptions/sub_1'] = { status: 500, corpo: { error: { message: 'erro interno segredo' } } }
    rotas['GET subscriptions/sub_1'] = { status: 500 }
    await esperarNadaApagado(await tratarExcluirConta(requisicao(), deps()))
  })
  test('Stripe fora do ar (rede)', async () => {
    viva()
    rotas['DELETE subscriptions/sub_1'] = 'rede'
    await esperarNadaApagado(await tratarExcluirConta(requisicao(), deps()))
  })
  test('Stripe responde 200 mas a assinatura não ficou canceled', async () => {
    viva()
    rotas['DELETE subscriptions/sub_1'] = { status: 200, corpo: { id: 'sub_1', status: 'active' } }
    await esperarNadaApagado(await tratarExcluirConta(requisicao(), deps()))
  })
  test('sem STRIPE_SECRET_KEY configurada e com assinatura viva', async () => {
    viva()
    await esperarNadaApagado(await tratarExcluirConta(requisicao(), deps({ stripeSecretKey: undefined })))
    assert.equal(chamouStripe(), false)
  })
  test('erro da Stripe só vai para o log: o cliente recebe a frase genérica em português', async () => {
    viva()
    rotas['DELETE subscriptions/sub_1'] = { status: 400, corpo: { error: { type: 'invalid_request_error', message: 'detalhe_interno_xyz' } } }
    rotas['GET subscriptions/sub_1'] = { status: 200, corpo: { status: 'active' } }
    const r = await tratarExcluirConta(requisicao(), deps())
    const texto = await r.text()
    assert.ok(!texto.includes('detalhe_interno_xyz'))
    assert.ok(texto.includes('Não consegui cancelar sua assinatura agora. Tente de novo ou fale com o suporte.'))
    assert.equal(apagouAlgo(), false)
  })
  test('não conseguir ler a assinatura no banco também não apaga nada', async () => {
    viva()
    admin.falhas.add('assinaturas:select')
    const r = await tratarExcluirConta(requisicao(), deps())
    assert.equal(r.status, 500)
    assert.equal((await r.json()).erro, MSG_EXCLUIR_FALHA)
    assert.equal(apagouAlgo(), false)
    assert.equal(chamouStripe(), false)
  })
})

describe('repetição e casos sem cobrança viva', () => {
  test('sem assinatura: apaga como sempre e não chama a Stripe', async () => {
    admin.assinaturas = []
    const r = await tratarExcluirConta(requisicao(), deps({ stripeSecretKey: undefined }))
    assert.equal(r.status, 200)
    assert.equal(chamouStripe(), false)
    assert.equal(admin.usuarioApagado, 'u1')
  })
  test('em teste do app (sem vínculo com a Stripe): não chama a Stripe', async () => {
    admin.assinaturas = [{ usuario_id: 'u1', status: 'trialing', stripe_subscription_id: null }]
    assert.equal((await tratarExcluirConta(requisicao(), deps())).status, 200)
    assert.equal(chamouStripe(), false)
  })
  for (const status of ['canceled', 'expired']) {
    test(`já ${status}: não chama a Stripe e apaga`, async () => {
      viva(status)
      assert.equal((await tratarExcluirConta(requisicao(), deps())).status, 200)
      assert.equal(chamouStripe(), false)
      assert.equal(admin.usuarioApagado, 'u1')
    })
  }
  test('tentativa repetida: a Stripe diz que a assinatura não existe (404) => conta como cancelada e segue', async () => {
    viva()
    rotas['DELETE subscriptions/sub_1'] = { status: 404, corpo: { error: { code: 'resource_missing' } } }
    assert.equal((await tratarExcluirConta(requisicao(), deps())).status, 200)
    assert.equal(admin.usuarioApagado, 'u1')
  })
  test('tentativa repetida: cancelar de novo recusado, mas a consulta mostra canceled => segue', async () => {
    viva()
    rotas['DELETE subscriptions/sub_1'] = { status: 400, corpo: { error: { message: 'já cancelada' } } }
    rotas['GET subscriptions/sub_1'] = { status: 200, corpo: { status: 'canceled' } }
    assert.equal((await tratarExcluirConta(requisicao(), deps())).status, 200)
    assert.deepEqual(chamadas.map((c) => c.metodo), ['DELETE', 'GET'])
  })
  test('falha depois de cancelar (dados): a Stripe NÃO é chamada de novo se a conta já estiver marcada canceled; senão repete sem problema', async () => {
    viva()
    admin.falhas.add('rpc:excluir_dados_conta')
    const r1 = await tratarExcluirConta(requisicao(), deps())
    assert.equal(r1.status, 500)
    assert.equal(admin.assinaturas[0].status, 'canceled', 'o espelho evita novo cancelamento na repetição')
    admin.falhas.clear()
    chamadas.length = 0
    assert.equal((await tratarExcluirConta(requisicao(), deps())).status, 200)
    assert.equal(chamouStripe(), false)
    assert.equal(admin.usuarioApagado, 'u1')
  })
})

describe('contrato da função', () => {
  test('exige JWT válido e a confirmação EXCLUIR', async () => {
    viva()
    assert.equal((await tratarExcluirConta(requisicao({ confirmacao: 'excluir' }), deps())).status, 400)
    assert.equal((await tratarExcluirConta(requisicao({}), deps())).status, 400)
    assert.equal((await tratarExcluirConta(requisicao({ confirmacao: 'EXCLUIR' }, false), deps())).status, 401)
    assert.equal(chamouStripe(), false)
    assert.equal(apagouAlgo(), false)
  })
  test('o usuário vem do JWT, nunca do body', async () => {
    viva()
    await tratarExcluirConta(requisicao({ confirmacao: 'EXCLUIR', usuario_id: 'outro', p_usuario_id: 'outro' }), deps())
    assert.ok(admin.eventos.includes('rpc:excluir_dados_conta:u1'))
    assert.ok(!admin.eventos.some((e) => e.includes('outro')))
  })
  test('erro ao remover o login depois de apagar os dados', async () => {
    admin.assinaturas = []
    admin.falhas.add('auth:deleteUser')
    const r = await tratarExcluirConta(requisicao(), deps())
    assert.equal(r.status, 500)
    assert.match((await r.json()).erro, /remover o login/)
  })
  test('apaga os arquivos dos dois buckets', () => {
    assert.deepEqual(BUCKETS_EXCLUSAO, ['cardapio-fotos', 'logo-barraca'])
  })
})
