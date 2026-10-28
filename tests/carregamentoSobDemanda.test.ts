// Carregamento sob demanda: telas do balcão ficam fixas (offline), o resto é lazy, e pedaço ausente recarrega uma vez só.
// Rodar: npm test
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'
import { tratarPedacoAusente } from '../src/lib/recargaPorPedacoAusente.ts'

const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
const layout = readFileSync(new URL('../src/layouts/LayoutBarraca.tsx', import.meta.url), 'utf8')
const main = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8')

describe('App.tsx: o que é lazy e o que é fixo', () => {
  test('fluxo de balcão e porta de entrada seguem com import estático (funcionam offline)', () => {
    for (const nome of ['Dashboard', 'LancarPedido', 'ConfirmarPedido', 'Cozinha', 'TelaChamada', 'Mesas', 'Login', 'Dispatcher']) {
      assert.ok(app.includes(`import { ${nome} } from './pages/${nome}'`), `${nome} deve ser import estático`)
      assert.ok(!app.includes(`const ${nome} = lazy`), `${nome} não pode ser lazy`)
    }
    assert.match(app, /^import \{ LayoutBarraca \} from/m)
  })

  test('telas fora do balcão são lazy e não têm import estático', () => {
    const lazys = ['CardapioPublico', 'PerfilCliente', 'Privacidade', 'Ajustes', 'Desktop', 'Historico', 'Caixa', 'Configurar', 'RevisarCardapioExemplo']
    for (const nome of lazys) {
      assert.ok(app.includes(`const ${nome} = lazy(() => import('./pages/${nome}')`), `${nome} deve ser lazy`)
      assert.ok(!app.includes(`import { ${nome} } from`), `${nome} não pode ter import estático`)
    }
  })

  test('as rotas ficam dentro de um Suspense, e o Planos do layout também é lazy', () => {
    assert.ok(app.indexOf('<Suspense') < app.indexOf('<Routes>') && app.indexOf('</Routes>') < app.indexOf('</Suspense>'))
    assert.match(layout, /const Planos = lazy\(/)
    assert.doesNotMatch(layout, /^import \{ Planos \}/m)
  })

  test('o tratador de vite:preloadError está instalado no main', () => {
    assert.match(main, /instalarRecargaPorPedacoAusente\(\)/)
    assert.match(readFileSync(new URL('../src/lib/recargaPorPedacoAusente.ts', import.meta.url), 'utf8'), /vite:preloadError/)
  })
})

describe('tratarPedacoAusente', () => {
  function ambiente(agora = 1_000_000) {
    const guardado = new Map<string, string>()
    const r = { recargas: 0, impedidos: 0, agora }
    return {
      r,
      storage: { getItem: (k: string) => guardado.get(k) ?? null, setItem: (k: string, v: string) => void guardado.set(k, v) },
      evento: { preventDefault: () => void r.impedidos++ },
      deps: () => ({ storage: { getItem: (k: string) => guardado.get(k) ?? null, setItem: (k: string, v: string) => void guardado.set(k, v) }, recarregar: () => void r.recargas++, agora: () => r.agora }),
    }
  }

  test('primeiro erro recarrega e engole o erro', () => {
    const a = ambiente()
    assert.equal(tratarPedacoAusente(a.evento, a.deps()), true)
    assert.deepEqual([a.r.recargas, a.r.impedidos], [1, 1])
  })

  test('segundo erro logo depois NÃO recarrega (sem loop) e deixa o erro seguir', () => {
    const a = ambiente()
    tratarPedacoAusente(a.evento, a.deps())
    a.r.agora += 5_000
    assert.equal(tratarPedacoAusente(a.evento, a.deps()), false)
    assert.deepEqual([a.r.recargas, a.r.impedidos], [1, 1])
  })

  test('um deploy novo na mesma aba, depois da janela, recarrega de novo', () => {
    const a = ambiente()
    tratarPedacoAusente(a.evento, a.deps())
    a.r.agora += 120_000
    assert.equal(tratarPedacoAusente(a.evento, a.deps()), true)
    assert.equal(a.r.recargas, 2)
  })

  test('sessionStorage indisponível: não recarrega (não dá para travar o loop)', () => {
    const a = ambiente()
    const quebrado = { getItem: () => { throw new Error('bloqueado') }, setItem: () => { throw new Error('bloqueado') } }
    assert.equal(tratarPedacoAusente(a.evento, { storage: quebrado, recarregar: () => void a.r.recargas++ }), false)
    assert.equal(a.r.recargas, 0)
  })
})
