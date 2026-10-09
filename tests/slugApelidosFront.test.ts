// H7 (2/4): endereço antigo (apelido) redireciona para o atual e leva a sessão do cliente. Rodar: npm test
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { afterEach, describe, test } from 'node:test'
import { slugParaRedirecionar, trocarSlugNoCaminho } from '../src/lib/slugApelidos.ts'
import { guardarSessao, lerSessao, moverSessao } from '../src/lib/clienteSessaoLocal.ts'

describe('trocarSlugNoCaminho', () => {
  test('troca só o primeiro segmento e preserva o resto, a query e o hash', () => {
    assert.equal(trocarSlugNoCaminho('/restaurante-paulo/cardapio', 'restaurante-paulo', 'dhelena'), '/dhelena/cardapio')
    assert.equal(trocarSlugNoCaminho('/restaurante-paulo', 'restaurante-paulo', 'dhelena'), '/dhelena')
    assert.equal(trocarSlugNoCaminho('/restaurante-paulo/cozinha?x=1#y', 'restaurante-paulo', 'dhelena'), '/dhelena/cozinha?x=1#y')
    assert.equal(trocarSlugNoCaminho('/restaurante-paulo/ajustes/cardapio', 'restaurante-paulo', 'dhelena'), '/dhelena/ajustes/cardapio')
  })
  test('não mexe em caminho que não começa pelo slug antigo (nem em slug que só começa igual)', () => {
    assert.equal(trocarSlugNoCaminho('/outra/restaurante-paulo', 'restaurante-paulo', 'dhelena'), '/outra/restaurante-paulo')
    assert.equal(trocarSlugNoCaminho('/restaurante-paulo-2/cardapio', 'restaurante-paulo', 'dhelena'), '/restaurante-paulo-2/cardapio')
    assert.equal(trocarSlugNoCaminho('/', 'restaurante-paulo', 'dhelena'), '/')
  })
})

describe('slugParaRedirecionar', () => {
  test('só um slug válido e DIFERENTE do pedido; null, vazio, igual e lixo não redirecionam', () => {
    assert.equal(slugParaRedirecionar('antigo', 'novo-slug'), 'novo-slug')
    for (const r of [null, undefined, '', 'antigo', 42, {}, 'Com Espaço', '../x', 'a//b', 'x?y']) {
      assert.equal(slugParaRedirecionar('antigo', r), null, String(r))
    }
  })
})

describe('moverSessao (cliente final continua logado no endereço novo)', () => {
  const memoria = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => memoria.get(k) ?? null,
    setItem: (k: string, v: string) => void memoria.set(k, v),
    removeItem: (k: string) => void memoria.delete(k),
  }
  afterEach(() => memoria.clear())
  const sessao = { token: 't', expira_em: new Date(Date.now() + 86_400_000).toISOString(), nome: 'Ana', telefone: '11999990000' }

  test('leva a sessão para o slug novo e remove a do antigo', () => {
    guardarSessao('antigo', sessao)
    moverSessao('antigo', 'novo')
    assert.deepEqual(lerSessao('novo'), sessao)
    assert.equal(lerSessao('antigo'), null)
  })

  test('não sobrescreve sessão que já existe no slug novo', () => {
    guardarSessao('antigo', sessao)
    guardarSessao('novo', { ...sessao, token: 'ja-existia' })
    moverSessao('antigo', 'novo')
    assert.equal(lerSessao('novo')?.token, 'ja-existia')
    assert.equal(lerSessao('antigo'), null)
  })

  test('slug igual ou sem sessão: nada acontece; armazenamento que falha não lança', () => {
    guardarSessao('mesmo', sessao)
    moverSessao('mesmo', 'mesmo')
    assert.deepEqual(lerSessao('mesmo'), sessao)
    moverSessao('sem-sessao', 'novo')
    assert.equal(lerSessao('novo'), null)
    ;(globalThis as { localStorage?: unknown }).localStorage = {
      getItem: () => { throw new Error('bloqueado') },
      setItem: () => { throw new Error('bloqueado') },
      removeItem: () => { throw new Error('bloqueado') },
    }
    assert.doesNotThrow(() => moverSessao('a', 'b'))
  })
})

describe('fiação (guardas estáticas)', () => {
  const ler = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')

  test('cardápio e layout só mostram "não encontrado" depois de perguntar pelo apelido', () => {
    assert.match(ler('pages/CardapioPublico.tsx'), /useResolverApelido\(slug, estado\.status === 'erro'\)/)
    assert.match(ler('pages/CardapioPublico.tsx'), /estado\.status === 'erro' && apelido\.verificando/)
    assert.match(ler('layouts/LayoutBarraca.tsx'), /useResolverApelido\(slug, !carregando && \(Boolean\(erro\) \|\| !barraca\)\)/)
    assert.match(ler('layouts/LayoutBarraca.tsx'), /if \(carregando \|\| apelido\.verificando\)/)
  })

  test('o hook usa a função pública, leva a sessão e falha em silêncio (banco sem a função = como antes)', () => {
    const h = ler('hooks/useResolverApelido.ts')
    assert.match(h, /rpc\('barraca_slug_atual', \{ p_slug: slug \}\)/)
    assert.match(h, /moverSessao\(slug, novo\)/)
    assert.match(h, /replace: true/)
    assert.match(h, /error \? null : slugParaRedirecionar/)
  })

  test('cache de uma loja que não existe mais com este endereço é limpo (senão ficava preso no cache velho)', () => {
    const b = ler('hooks/useBarraca.ts')
    assert.match(b, /error\.code === 'PGRST116'/)
    assert.match(b, /window\.localStorage\.removeItem\(chaveCache\(slug\)\)/)
  })
})
