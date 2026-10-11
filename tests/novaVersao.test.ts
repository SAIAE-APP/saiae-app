// Aviso de nova versão do PWA: só avisa em atualização de verdade e nunca recarrega sozinho.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'
import { INTERVALO_CHECAGEM_MS, trocaEhAtualizacao } from '../src/lib/novaVersao.ts'

const ler = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')

describe('novaVersao', () => {
  test('a primeira instalação do service worker não conta como atualização', () => {
    assert.equal(trocaEhAtualizacao(false), false)
    assert.equal(trocaEhAtualizacao(true), true)
  })
  test('checa de tempos em tempos (30 min), nunca em intervalo curto que gaste bateria/rede', () => {
    assert.equal(INTERVALO_CHECAGEM_MS, 30 * 60 * 1000)
  })
  test('o hook só recarrega quando a pessoa toca em Atualizar (não há reload automático)', () => {
    const h = ler('src/hooks/useNovaVersao.ts')
    const reloads = h.match(/location\.reload\(\)/g) ?? []
    assert.equal(reloads.length, 1)
    assert.match(h, /const atualizar = useCallback\(\(\) => window\.location\.reload\(\), \[\]\)/)
    assert.match(h, /controllerchange/)
  })
  test('o aviso é montado no topo do app e tem botões de 44px (md)', () => {
    assert.match(ler('src/App.tsx'), /<AvisoNovaVersao \/>/)
    const c = ler('src/components/AvisoNovaVersao.tsx')
    assert.match(c, /Nova versão disponível/)
    assert.doesNotMatch(c, /size="sm"/)
  })
})
