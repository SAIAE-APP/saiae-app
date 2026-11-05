// Task 4 (módulos pagos): helper moduloAtivo e gates das edge functions. Rodar: npm test
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { moduloAtivo } from '../supabase/functions/_shared/modulos.ts'
import { criarHandler as criarDisparos } from '../supabase/functions/whatsapp-disparos/handler.ts'
import { criarHandler as criarConexao } from '../supabase/functions/whatsapp-conexao/handler.ts'

const B = '11111111-1111-4111-8111-111111111111'

describe('moduloAtivo', () => {
  test('moduloAtivo devolve true só quando a RPC devolve true', async () => {
    const chamadas: unknown[] = []
    const db = (data: unknown) => ({ rpc: async (fn: string, args: object) => (chamadas.push([fn, args]), { data, error: null }) })
    assert.equal(await moduloAtivo(db(true), B, 'fiscal'), true)
    assert.deepEqual(chamadas[0], ['modulo_ativo', { p_barraca_id: B, p_modulo: 'fiscal' }])
    assert.equal(await moduloAtivo(db(false), B, 'fiscal'), false)
    assert.equal(await moduloAtivo(db('true'), B, 'fiscal'), false)
  })

  test('devolve false quando a RPC dá erro ou devolve null (ou lança)', async () => {
    assert.equal(await moduloAtivo({ rpc: async () => ({ data: true, error: { message: 'x' } }) }, B, 'fiscal'), false)
    assert.equal(await moduloAtivo({ rpc: async () => ({ data: null, error: null }) }, B, 'fiscal'), false)
    assert.equal(await moduloAtivo({ rpc: async () => { throw new Error('rede') } }, B, 'fiscal'), false)
  })
})

/** Supabase falso: usuário logado, vínculo com o papel dado, módulos vigentes = lista. */
function banco(papel: string, vigentes: string[], opts: { rpcDisparosErro?: string } = {}) {
  const rpcs: string[] = []
  const cliente = {
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } }, error: null }) },
    from: (tabela: string) => {
      const q = {
        select: () => q, eq: () => q,
        maybeSingle: async () => ({ data: tabela === 'usuarios_barracas' ? { papel } : { nome: 'Loja' }, error: null }),
      }
      return q
    },
    rpc: async (fn: string, args: Record<string, unknown>) => {
      rpcs.push(fn)
      if (fn === 'modulo_ativo') return { data: vigentes.includes(String(args.p_modulo)), error: null }
      if (opts.rpcDisparosErro) return { data: null, error: { message: opts.rpcDisparosErro } }
      return { data: [], error: null }
    },
  }
  return { cliente, rpcs }
}
const req = (corpo: object) => new Request('http://local/x', { method: 'POST', headers: { Authorization: 'Bearer jwt' }, body: JSON.stringify(corpo) })
const env = { get: () => undefined }

describe('whatsapp-disparos', () => {
  test('cancelar passa sem módulo', async () => {
    const b = banco('dono', [])
    const res = await criarDisparos({ criarCliente: () => b.cliente, env })(req({ barraca_id: B, acao: 'cancelar', campanha_id: 'c1' }))
    assert.equal(res.status, 502) // passou do gate; sem URL do CRM
  })

  test('whatsapp-disparos: sem módulo responde 403 modulo_desligado', async () => {
    const b = banco('dono', ['whatsapp_avisos'])
    const res = await criarDisparos({ criarCliente: () => b.cliente, env })(req({ barraca_id: B, acao: 'historico' }))
    assert.equal(res.status, 403)
    assert.deepEqual(await res.json(), { erro: 'modulo_desligado' })
  })

  test('com módulo vigente passa do gate', async () => {
    const b = banco('dono', ['whatsapp_disparos'])
    const res = await criarDisparos({ criarCliente: () => b.cliente, env })(req({ barraca_id: B, acao: 'historico' }))
    assert.equal(res.status, 502) // sem URL do CRM no env: passou do gate e parou no CRM
  })

  test('erro modulo_desligado vindo da RPC disparos_publico vira 403 modulo_desligado', async () => {
    const b = banco('dono', ['whatsapp_disparos'], { rpcDisparosErro: 'modulo_desligado' })
    const res = await criarDisparos({ criarCliente: () => b.cliente, env })(
      req({ barraca_id: B, acao: 'enviar', tipo: 'reativacao', dias: 30, texto: 'Oi {nome}, voltamos! Venha ver as novidades.', request_id: crypto.randomUUID() }),
    )
    assert.equal(res.status, 403)
    assert.deepEqual(await res.json(), { erro: 'modulo_desligado' })
  })
})

describe('whatsapp-conexao', () => {
  const chamar = async (vigentes: string[], acao: string) => {
    const b = banco('dono', vigentes)
    return criarConexao({ criarCliente: () => b.cliente, env })(req({ barraca_id: B, acao }))
  }
  test('whatsapp-conexao: aceita com só whatsapp_bot, recusa sem nenhum dos três', async () => {
    assert.equal((await chamar(['whatsapp_bot'], 'iniciar')).status, 502) // passou do gate; sem URL do CRM
    const r2 = await chamar(['fiscal'], 'iniciar')
    assert.equal(r2.status, 403)
    assert.deepEqual(await r2.json(), { erro: 'modulo_desligado' })
  })
  test('iniciar sem módulo continua 403', async () => {
    assert.equal((await chamar([], 'iniciar')).status, 403)
  })
  test('desconectar passa sem nenhum módulo', async () => {
    assert.equal((await chamar([], 'desconectar')).status, 502)
  })
  test('status e historico passam sem módulo', async () => {
    assert.equal((await chamar([], 'status')).status, 502)
    assert.equal((await chamar([], 'historico')).status, 502)
  })
})
