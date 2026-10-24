// Correções da revisão de segurança da integracao-v1: lista de segredos nas três rotas, total esperado,
// cruzamento de client_uuid, content-length e colunas explícitas. Rodar: npm test
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'
import { tratarEventoSessao } from '../supabase/functions/_shared/crmSessaoEvento.ts'
import { primeiroSegredo, totalDivergente, validarCorpoIntegracao } from '../supabase/functions/_shared/integracaoV1.ts'

const S1 = 'segredo-numero-um-16+'
const S2 = 'segredo-numero-dois-16+'
const AGORA = Date.parse('2026-10-24T12:00:30Z')
const TS = Math.floor(AGORA / 1000)
const sig = (corpo: string, segredo: string) => 'sha256=' + createHmac('sha256', segredo).update(`${TS}.${corpo}`).digest('hex')
const lerFonte = (caminho: string) => readFileSync(new URL(caminho, import.meta.url), 'utf8').replace(/\/\/.*$/gm, '')

describe('crm-evento-sessao aceita lista de segredos', () => {
  const corpo = JSON.stringify({
    barraca_id: '11111111-1111-4111-8111-111111111111',
    estado: 'caiu',
    occurred_at: '2026-10-24T12:00:00.000Z',
    request_id: '22222222-2222-4222-8222-222222222222',
  })
  const tratar = (segredo: string | undefined, assinadoCom: string, corpoEnviado = corpo) => {
    let gravou = false
    return tratarEventoSessao(
      { corpoBruto: corpoEnviado, timestamp: String(TS), assinatura: sig(corpoEnviado, assinadoCom), segredo, agoraMs: AGORA },
      async () => {
        gravou = true
        return 'ok'
      },
    ).then((r) => ({ r, gravou }))
  }
  test('qualquer segredo da lista de 2 vale', async () => {
    for (const s of [S1, S2]) {
      const { r, gravou } = await tratar(`${S1},${S2}`, s)
      assert.equal(r.status, 200, s)
      assert.ok(gravou)
    }
  })
  test('segredo fora da lista dá 401 e payload inválido assinado dá 422 (não 401)', async () => {
    assert.equal((await tratar(`${S1},${S2}`, 'segredo-de-fora-da-lista')).r.status, 401)
    assert.equal((await tratar(`${S1},${S2}`, S2, '{"x":1}')).r.status, 422)
  })
  test('lista sem nenhum segredo de 16+ dá 503', async () => {
    assert.equal((await tratar('curto, outro', S1)).r.status, 503)
  })
})

describe('whatsapp-conexao assina com o PRIMEIRO segredo da lista', () => {
  test('primeiroSegredo', () => {
    assert.equal(primeiroSegredo(`${S1}, ${S2}`), S1)
    assert.equal(primeiroSegredo(` ${S2} ,${S1}`), S2)
    assert.equal(primeiroSegredo(undefined), '')
  })
  test('a function usa primeiroSegredo e não passa a lista crua ao CRM', () => {
    const f = lerFonte('../supabase/functions/whatsapp-conexao/index.ts')
    assert.match(f, /primeiroSegredo\(Deno\.env\.get\('WHATSAPP_CONEXAO_SEGREDO'\)\)/)
    assert.match(f, /chamarConexaoCrm\(\{ url, segredo,/)
  })
  test('crm-evento-sessao verifica pela lista', () => {
    const f = lerFonte('../supabase/functions/_shared/crmSessaoEvento.ts')
    assert.match(f, /verificarAssinaturaLista\(/)
    assert.doesNotMatch(f, /verificarAssinaturaIa\(/)
  })
})

describe('total_esperado_centavos', () => {
  const B = '11111111-1111-4111-8111-111111111111'
  const U = '33333333-3333-4333-8333-333333333333'
  const itens = [{ item_id: '44444444-4444-4444-8444-444444444444', quantidade: 1 }]
  const cliente = { client_uuid: U, cliente_telefone: '61999531848', itens }
  const valido = (c: Record<string, unknown>) => validarCorpoIntegracao({ barraca_id: B, ...c })

  test('rascunho, pedido e pix aceitam inteiro >= 0 e devolvem totalEsperado', () => {
    for (const c of [
      { acao: 'rascunho', itens },
      { acao: 'pedido', ...cliente },
      { acao: 'pix', ...cliente, conversa_id: 'x' },
    ]) {
      const v = valido({ ...c, total_esperado_centavos: 2400 })
      assert.ok(v.ok, c.acao)
      assert.equal((v as { valor: { totalEsperado: number | null } }).valor.totalEsperado, 2400)
      const sem = valido(c)
      assert.ok(sem.ok)
      assert.equal((sem as { valor: { totalEsperado: number | null } }).valor.totalEsperado, null)
    }
  })
  test('recusa decimal, negativo, texto e null; cardápio não aceita o campo', () => {
    for (const t of [12.5, -1, '2400', null, Number.MAX_SAFE_INTEGER + 2]) {
      assert.equal(valido({ acao: 'rascunho', itens, total_esperado_centavos: t }).ok, false, String(t))
    }
    assert.equal(valido({ acao: 'cardapio', total_esperado_centavos: 100 }).ok, false)
  })
  test('totalDivergente', () => {
    assert.equal(totalDivergente(null, 100), false)
    assert.equal(totalDivergente(100, 100), false)
    assert.equal(totalDivergente(99, 100), true)
  })
})

describe('function integracao-v1: guardas da revisão', () => {
  const f = lerFonte('../supabase/functions/integracao-v1/index.ts')
  const pos = (t: string) => {
    const i = f.indexOf(t)
    assert.ok(i >= 0, t)
    return i
  }
  test('content-length acima do limite dá 413 antes de ler o corpo', () => {
    assert.ok(pos("headers.get('content-length')") < pos('req.text()'))
    assert.ok(pos('haSegredoValido(') < pos("headers.get('content-length')"))
  })
  test('carregarLoja sem select(*)', () => {
    const trecho = f.slice(pos('async function carregarLoja'), pos('async function resolverCarrinho'))
    assert.doesNotMatch(trecho, /select\('\*'\)/)
  })
  test('total_mudou é checado antes de criar pedido e antes de cobrar', () => {
    assert.ok(pos('totalDivergente(c.totalEsperado, r.total + taxa)') < pos("rpc('criar_pedido'"))
    assert.ok(pos('totalDivergente(c.totalEsperado, r.total)') < pos('criarCobranca('))
  })
  test('pedido recusa uuid de pendente e pix recusa uuid de pedido', () => {
    const pedido = f.slice(pos('async function acaoPedido'), pos('type Pendente'))
    assert.match(pedido, /from\('pagamentos_pendentes'\)/)
    const pix = f.slice(pos('async function acaoPix'), pos('Deno.serve('))
    assert.match(pix, /from\('pedidos'\)/)
    assert.match(pix, /uuidEmUso()/)
  })
  test('pix reivindica o pendente por RPC atômica e não insere direto', () => {
    const pix = f.slice(pos('async function acaoPix'), pos('Deno.serve('))
    assert.match(pix, /rpc\('integracao_pix_reservar'/)
    assert.doesNotMatch(pix, /\.insert\(/)
  })
})
