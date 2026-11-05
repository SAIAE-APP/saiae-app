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
  test('vazio nunca autoriza', () => {
    assert.equal(segredoAutorizado('', ''), false)
    assert.equal(segredoAutorizado('', 'segredo'), false)
  })
  test('aceita o segredo certo', () => {
    assert.equal(segredoAutorizado('segredo', 'segredo'), true)
  })
})

/** Storage em memória: chaves "bucket/caminho/completo". Listar devolve filhos diretos; subpasta vem com pasta: true. */
function fake(arquivos: string[], over: Partial<DepsApagar> & { ids: string[]; remocaoFalsa?: boolean }) {
  const storage = new Set(arquivos)
  const chamadas: string[] = []
  const deps: DepsApagar = {
    listarBarracas: async () => over.ids,
    listarPasta: async (bucket, pasta, limite) => {
      const prefixo = `${bucket}/${pasta}/`
      const filhos = new Map<string, boolean>()
      for (const k of storage) {
        if (!k.startsWith(prefixo)) continue
        const resto = k.slice(prefixo.length)
        const i = resto.indexOf('/')
        filhos.set(i === -1 ? resto : resto.slice(0, i), i !== -1)
      }
      return [...filhos].slice(0, limite).map(([nome, pasta]) => ({ nome, pasta }))
    },
    removerArquivos: async (bucket, caminhos) => {
      chamadas.push(`rm ${bucket} ${caminhos.join(',')}`)
      if (!over.remocaoFalsa) for (const c of caminhos) storage.delete(`${bucket}/${c}`) // inexistente: sem erro, como no Supabase
    },
    apagarDados: over.apagarDados ?? (async (id) => void chamadas.push(`apagar ${id}`)),
    registrarErro: () => undefined,
  }
  return { deps, chamadas, storage }
}

describe('apagarBarracasArquivadas', () => {
  test('limpa o Storage antes de apagar os dados', async () => {
    const f = fake(['cardapio-fotos/b1/a.png', 'logo-barraca/b1/l.png'], { ids: ['b1'] })
    assert.deepEqual(await apagarBarracasArquivadas(f.deps), { apagadas: 1, falhas: 0 })
    assert.deepEqual(f.chamadas, ['rm cardapio-fotos b1/a.png', 'rm logo-barraca b1/l.png', 'apagar b1'])
  })

  test('pagina a listagem até acabar', async () => {
    const f = fake(['1', '2', '3'].map((n) => `cardapio-fotos/b1/${n}`), { ids: ['b1'] })
    await apagarBarracasArquivadas(f.deps, 2)
    assert.deepEqual(f.chamadas.slice(0, 2), ['rm cardapio-fotos b1/1,b1/2', 'rm cardapio-fotos b1/3'])
  })

  test('subpasta aninhada (banners/) é limpa por inteiro e só então apaga os dados', async () => {
    const f = fake(
      ['cardapio-fotos/b1/a.png', 'cardapio-fotos/b1/banners/x.jpg', 'cardapio-fotos/b1/banners/fundo/y.jpg'],
      { ids: ['b1'] },
    )
    assert.deepEqual(await apagarBarracasArquivadas(f.deps), { apagadas: 1, falhas: 0 })
    assert.equal(f.storage.size, 0)
    assert.equal(f.chamadas.at(-1), 'apagar b1')
    assert.ok(f.chamadas.includes('rm cardapio-fotos b1/banners/x.jpg'))
    assert.ok(f.chamadas.includes('rm cardapio-fotos b1/banners/fundo/y.jpg'))
  })

  test('Storage que nunca esvazia: falha, não apaga os dados e as outras seguem', async () => {
    const f = fake(['cardapio-fotos/preso/a.png'], { ids: ['preso'], remocaoFalsa: true })
    const r = await apagarBarracasArquivadas(f.deps)
    assert.deepEqual(r, { apagadas: 0, falhas: 1 })
    assert.ok(!f.chamadas.some((c) => c.startsWith('apagar')))
  })

  test('falha no Storage não apaga os dados e não interrompe as outras', async () => {
    const f = fake([], { ids: ['ruim', 'boa'] })
    const listar = f.deps.listarPasta
    f.deps.listarPasta = async (b, pasta, l) => {
      if (pasta === 'ruim') throw new Error('storage fora')
      return listar(b, pasta, l)
    }
    assert.deepEqual(await apagarBarracasArquivadas(f.deps), { apagadas: 1, falhas: 1 })
    assert.deepEqual(f.chamadas, ['apagar boa'])
  })

  test('falha em apagarDados conta como falha e segue', async () => {
    const f = fake([], {
      ids: ['x', 'y'],
      apagarDados: async (id) => {
        if (id === 'x') throw new Error('rpc')
      },
    })
    assert.deepEqual(await apagarBarracasArquivadas(f.deps), { apagadas: 1, falhas: 1 })
  })
})
