// Testes da lógica pura da impressão por aparelho (Node >= 22.18: roda TS direto).
// Rodar: npm test
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  MAX_TENTATIVAS_IMPRESSAO,
  chavesDeImpressao,
  comRetentativaDeImpressao,
  erroDeImpressoraOcupada,
  esperaEntreTentativasMs,
  jaImpressoNesteAparelho,
  marcarImpressoNesteAparelho,
} from '../src/lib/politicaImpressao.ts'

function armazenamentoFalso() {
  const dados = new Map<string, string>()
  return {
    getItem: (k: string) => dados.get(k) ?? null,
    setItem: (k: string, v: string) => void dados.set(k, v),
    dados,
  }
}

test('chaves: usa client_uuid (formato antigo) e id do pedido', () => {
  assert.deepEqual(chavesDeImpressao({ pedidoId: 'p1', clientUuid: 'c1' }), [
    'mesaagil:comanda-impressa:c1',
    'mesaagil:comanda-impressa-id:p1',
  ])
  assert.deepEqual(chavesDeImpressao({ pedidoId: 'p1', clientUuid: null }), ['mesaagil:comanda-impressa-id:p1'])
  assert.deepEqual(chavesDeImpressao({}), [])
})

test('idempotência por aparelho: marcado por uma via vale pela outra (caminhos a e b)', () => {
  const st = armazenamentoFalso()
  assert.equal(jaImpressoNesteAparelho(st, { pedidoId: 'p1', clientUuid: 'c1' }), false)
  // caminho (a) conhece pedidoId + client_uuid e marca as duas chaves
  marcarImpressoNesteAparelho(st, { pedidoId: 'p1', clientUuid: 'c1' })
  // caminho (b) chega só com o id (sem client_uuid): já reconhece
  assert.equal(jaImpressoNesteAparelho(st, { pedidoId: 'p1', clientUuid: null }), true)
  // e vice-versa: só o client_uuid
  assert.equal(jaImpressoNesteAparelho(st, { clientUuid: 'c1' }), true)
  // outro pedido não é afetado
  assert.equal(jaImpressoNesteAparelho(st, { pedidoId: 'p2', clientUuid: 'c2' }), false)
})

test('marcação antiga só por client_uuid continua reconhecida', () => {
  const st = armazenamentoFalso()
  st.setItem('mesaagil:comanda-impressa:c9', '2026-10-01T10:00:00Z')
  assert.equal(jaImpressoNesteAparelho(st, { pedidoId: 'qualquer', clientUuid: 'c9' }), true)
})

test('sem storage ou storage que lança: não quebra', () => {
  assert.equal(jaImpressoNesteAparelho(null, { pedidoId: 'p1' }), false)
  assert.doesNotThrow(() => marcarImpressoNesteAparelho(null, { pedidoId: 'p1' }))
  const quebrado = {
    getItem: () => {
      throw new Error('negado')
    },
    setItem: () => {
      throw new Error('negado')
    },
  }
  assert.equal(jaImpressoNesteAparelho(quebrado, { pedidoId: 'p1' }), false)
  assert.doesNotThrow(() => marcarImpressoNesteAparelho(quebrado, { pedidoId: 'p1' }))
})

test('erro de impressora ocupada: só conexão/escrita', () => {
  assert.equal(erroDeImpressoraOcupada({ code: 'connect_failed' }), true)
  assert.equal(erroDeImpressoraOcupada({ code: 'write_failed' }), true)
  assert.equal(erroDeImpressoraOcupada({ code: 'permission_denied' }), false)
  assert.equal(erroDeImpressoraOcupada({ code: 'not_found' }), false)
  assert.equal(erroDeImpressoraOcupada({ code: 'unavailable' }), false)
  assert.equal(erroDeImpressoraOcupada({ code: 'invalid_data' }), false)
  assert.equal(erroDeImpressoraOcupada({ message: 'socket might closed or timeout, read ret: -1' }), true)
  assert.equal(erroDeImpressoraOcupada(new Error('algo aleatório')), false)
  assert.equal(erroDeImpressoraOcupada(null), false)
})

test('espera entre tentativas: sempre entre 1 e 3 s e depende do aleatório', () => {
  for (const tentativa of [1, 2, 3, 4]) {
    assert.equal(esperaEntreTentativasMs(tentativa, () => 0), 1000)
    const maximo = esperaEntreTentativasMs(tentativa, () => 0.999999)
    assert.ok(maximo <= 3000 && maximo >= 1000, `tentativa ${tentativa}: ${maximo}`)
  }
  assert.notEqual(esperaEntreTentativasMs(2, () => 0.1), esperaEntreTentativasMs(2, () => 0.9))
})

test('retentativa: sucesso na 3ª tentativa, esperando entre elas', async () => {
  let chamadas = 0
  const esperas: number[] = []
  const resultado = await comRetentativaDeImpressao(
    async () => {
      chamadas++
      if (chamadas < 3) throw { code: 'connect_failed' }
      return 'ok'
    },
    { esperar: async (ms) => void esperas.push(ms), aleatorio: () => 0.5 },
  )
  assert.equal(resultado, 'ok')
  assert.equal(chamadas, 3)
  assert.equal(esperas.length, 2)
  assert.ok(esperas.every((ms) => ms >= 1000 && ms <= 3000))
})

test('retentativa: desiste depois de 4 tentativas e relança o último erro', async () => {
  let chamadas = 0
  await assert.rejects(
    comRetentativaDeImpressao(
      async () => {
        chamadas++
        throw { code: 'connect_failed', message: `falha ${chamadas}` }
      },
      { esperar: async () => {} },
    ),
    (erro: { message?: string }) => erro.message === `falha ${MAX_TENTATIVAS_IMPRESSAO}`,
  )
  assert.equal(chamadas, MAX_TENTATIVAS_IMPRESSAO)
})

test('retentativa: erro que não é de ocupada falha na hora, sem esperar', async () => {
  let chamadas = 0
  let esperou = false
  await assert.rejects(
    comRetentativaDeImpressao(
      async () => {
        chamadas++
        throw { code: 'permission_denied' }
      },
      {
        esperar: async () => {
          esperou = true
        },
      },
    ),
  )
  assert.equal(chamadas, 1)
  assert.equal(esperou, false)
})

test('retentativa: sucesso de primeira não espera nada', async () => {
  let esperou = false
  const r = await comRetentativaDeImpressao(async () => 42, {
    esperar: async () => {
      esperou = true
    },
  })
  assert.equal(r, 42)
  assert.equal(esperou, false)
})
