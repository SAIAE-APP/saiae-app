// Apagamento definitivo de barracas arquivadas (supabase/functions/_shared/apagarBarracasArquivadas.ts).
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  apagarBarracasArquivadas,
  pastasParaLimpar,
  segredoAutorizado,
  type DepsApagar,
} from '../supabase/functions/_shared/apagarBarracasArquivadas.ts'

describe('pastasParaLimpar', () => {
  test('devolve as duas pastas da barraca', () => {
    assert.deepEqual(pastasParaLimpar('abc'), ['cardapio-fotos/abc/', 'logo-barraca/abc/'])
  })
})

describe('segredoAutorizado', () => {
  test('recusa chamada sem o segredo do cron', () => {
    assert.equal(segredoAutorizado(null, 'segredo'), false)
    assert.equal(segredoAutorizado('errado!', 'segredo'), false)
    assert.equal(segredoAutorizado('segredo', undefined), false)
  })
  test('aceita o segredo certo', () => {
    assert.equal(segredoAutorizado('segredo', 'segredo'), true)
  })
})

function deps(over: Partial<DepsApagar> & { ids: string[] }): DepsApagar & { chamadas: string[] } {
  const chamadas: string[] = []
  return {
    chamadas,
    listarBarracas: async () => over.ids,
    listarPasta: over.listarPasta ?? (async () => []),
    removerArquivos: over.removerArquivos ?? (async (b, c) => void chamadas.push(`rm ${b} ${c.join(',')}`)),
    apagarDados: over.apagarDados ?? (async (id) => void chamadas.push(`apagar ${id}`)),
    registrarErro: () => undefined,
  }
}

describe('apagarBarracasArquivadas', () => {
  test('limpa o Storage antes de apagar os dados', async () => {
    const feitos = new Set<string>()
    const d = deps({
      ids: ['b1'],
      listarPasta: async (b) => (feitos.has(b) ? [] : (feitos.add(b), ['a.png'])), // esvazia depois da remoção
    })
    const r = await apagarBarracasArquivadas(d)
    assert.deepEqual(r, { apagadas: 1, falhas: 0 })
    assert.deepEqual(d.chamadas, ['rm cardapio-fotos b1/a.png', 'rm logo-barraca b1/a.png', 'apagar b1'])
  })

  test('pagina a listagem até acabar', async () => {
    const paginas = [['1', '2'], ['3'], []]
    let i = 0
    const d = deps({ ids: ['b1'], listarPasta: async (b) => (b === 'cardapio-fotos' ? (paginas[i++] ?? []) : []) })
    await apagarBarracasArquivadas(d, 2)
    assert.deepEqual(d.chamadas.slice(0, 2), ['rm cardapio-fotos b1/1,b1/2', 'rm cardapio-fotos b1/3'])
  })

  test('falha no Storage não apaga os dados e não interrompe as outras', async () => {
    const d = deps({
      ids: ['ruim', 'boa'],
      listarPasta: async (_b, pasta) => {
        if (pasta === 'ruim') throw new Error('storage fora')
        return []
      },
    })
    const r = await apagarBarracasArquivadas(d)
    assert.deepEqual(r, { apagadas: 1, falhas: 1 })
    assert.deepEqual(d.chamadas, ['apagar boa'])
  })

  test('falha em apagarDados conta como falha e segue', async () => {
    const d = deps({
      ids: ['x', 'y'],
      apagarDados: async (id) => {
        if (id === 'x') throw new Error('rpc')
      },
    })
    assert.deepEqual(await apagarBarracasArquivadas(d), { apagadas: 1, falhas: 1 })
  })
})
