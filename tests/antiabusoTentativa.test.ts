// Anti-abuso do cardápio (auditoria M5/B11): registrarTentativa, limitePorLoja e o flag de tempo no checkout.
// Rodar: npm test
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'
import {
  JANELA_TENTATIVAS_S,
  LIMITE_TENTATIVAS_POR_LOJA_PADRAO,
  hashIp,
  limitePorLoja,
  pareceBot,
  registrarTentativa,
} from '../supabase/functions/_shared/antiabuso.ts'

type Chamada = { fn: string; args: Record<string, unknown> }
function falso(resposta: { data: unknown; error: { message: string } | null }) {
  const chamadas: Chamada[] = []
  return {
    chamadas,
    rpc: (fn: string, args: Record<string, unknown>) => {
      chamadas.push({ fn, args })
      return Promise.resolve(resposta)
    },
  }
}
const base = { barracaId: 'b1', ipHash: 'h', clientUuid: 'u', limiteIp: 60 }

describe('registrarTentativa', () => {
  test('envia os argumentos certos, com padrão de 400 por loja em 300 s', async () => {
    const c = falso({ data: 'ok', error: null })
    assert.equal(await registrarTentativa(c, base), 'ok')
    assert.deepEqual(c.chamadas[0], {
      fn: 'cardapio_registrar_tentativa',
      args: {
        p_barraca_id: 'b1',
        p_ip_hash: 'h',
        p_client_uuid: 'u',
        p_limite_ip: 60,
        p_limite_barraca: LIMITE_TENTATIVAS_POR_LOJA_PADRAO,
        p_janela_segundos: JANELA_TENTATIVAS_S,
      },
    })
  })
  test('repassa limite_ip e limite_barraca', async () => {
    assert.equal(await registrarTentativa(falso({ data: 'limite_ip', error: null }), base), 'limite_ip')
    assert.equal(await registrarTentativa(falso({ data: 'limite_barraca', error: null }), base), 'limite_barraca')
  })
  test('erro da RPC (migration ainda não aplicada) não derruba a venda', async () => {
    const silencio = console.error
    console.error = () => {}
    try {
      assert.equal(await registrarTentativa(falso({ data: null, error: { message: 'function not found' } }), base), 'ok')
    } finally {
      console.error = silencio
    }
  })
  test('resposta inesperada (ex.: "invalido") não bloqueia cliente real', async () => {
    assert.equal(await registrarTentativa(falso({ data: 'invalido', error: null }), base), 'ok')
  })
})

describe('limitePorLoja', () => {
  test('lê a variável de ambiente; inválido volta ao padrão', () => {
    assert.equal(limitePorLoja('800'), 800)
    for (const ruim of [undefined, '', 'abc', '0', '-5', '1.5']) {
      assert.equal(limitePorLoja(ruim), LIMITE_TENTATIVAS_POR_LOJA_PADRAO)
    }
  })
})

describe('pareceBot com exigirTempo', () => {
  test('sem o campo passa por padrão e é recusado quando o flag está ligado', () => {
    assert.equal(pareceBot({}), false)
    assert.equal(pareceBot({}, true), true)
    assert.equal(pareceBot({ ms_no_checkout: 45000 }, true), false)
    assert.equal(pareceBot({ website: 'x', ms_no_checkout: 45000 }, true), true)
  })
})

describe('B11: hash com escopo', () => {
  test('escopo do pedido na entrega separa o contador do Pix', async () => {
    assert.notEqual(await hashIp('pedido-entrega', '1.1.1.1', 'b1'), await hashIp('pix', '1.1.1.1', 'b1'))
  })
})

describe('ligação nas edge functions (guarda de estrutura)', () => {
  const fonte = (n: string) => readFileSync(new URL(`../supabase/functions/${n}/index.ts`, import.meta.url), 'utf8')
  for (const nome of ['criar-pagamento-pix', 'criar-pedido-cardapio']) {
    test(`${nome}: usa a tentativa atômica e não conta/insere no log à mão`, () => {
      const f = fonte(nome)
      assert.match(f, /registrarTentativa\(/)
      assert.doesNotMatch(f, /from\('cardapio_pedidos_log'\)/)
      assert.match(f, /limitePorLoja\(/)
    })
  }
  test('criar-pedido-cardapio importa hashIp/ipDoCliente do módulo compartilhado (B11)', () => {
    const f = fonte('criar-pedido-cardapio')
    assert.match(f, /import \{[^}]*hashIp[^}]*\} from '\.\.\/_shared\/antiabuso\.ts'/)
    assert.doesNotMatch(f, /function ipDoCliente|function hashIp|async function hashIp/)
  })
  test('reportar-bug usa o limitador com o tipo bug', () => {
    const f = fonte('reportar-bug')
    assert.match(f, /consulta_externa_registrar/)
    assert.match(f, /TIPO_LIMITE_BUG/)
  })
})
