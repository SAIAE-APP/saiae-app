// H7 (4/4): edge functions públicas e manifest aceitam o endereço antigo (apelido). Rodar: npm test
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'
import { buscarBarracaPorSlug, slugDoApelido } from '../supabase/functions/_shared/resolverSlug.ts'

type Linha = { id: string }
/** Banco de mentira: `barracas` por slug + a função `barraca_slug_atual`. */
function falso(opcoes: { barracas: Record<string, Linha>; apelidos?: Record<string, string>; rpcErro?: boolean }) {
  const chamadas: string[] = []
  const cliente = {
    from: () => ({
      select: () => ({
        eq: (_c: string, slug: string) => ({
          maybeSingle: async () => {
            chamadas.push(`select:${slug}`)
            return { data: opcoes.barracas[slug] ?? null }
          },
        }),
      }),
    }),
    rpc: async (_n: string, args: { p_slug: string }) => {
      chamadas.push(`rpc:${args.p_slug}`)
      if (opcoes.rpcErro) return { data: null, error: { message: 'function does not exist' } }
      return { data: opcoes.apelidos?.[args.p_slug] ?? null, error: null }
    },
  }
  return { cliente: cliente as never, chamadas }
}

describe('slugDoApelido', () => {
  test('só um slug válido e diferente do pedido', () => {
    assert.equal(slugDoApelido('antigo', 'novo'), 'novo')
    for (const r of [null, undefined, '', 'antigo', 7, 'Com Espaço', '../x']) assert.equal(slugDoApelido('antigo', r), null, String(r))
  })
})

describe('buscarBarracaPorSlug', () => {
  test('slug atual: uma busca só, sem perguntar pelo apelido (nenhum custo no caminho normal)', async () => {
    const { cliente, chamadas } = falso({ barracas: { atual: { id: 'b1' } } })
    assert.deepEqual(await buscarBarracaPorSlug<Linha>(cliente, 'atual', 'id'), { id: 'b1' })
    assert.deepEqual(chamadas, ['select:atual'])
  })

  test('endereço antigo: acha pelo apelido e devolve a loja', async () => {
    const { cliente, chamadas } = falso({ barracas: { atual: { id: 'b1' } }, apelidos: { antigo: 'atual' } })
    assert.deepEqual(await buscarBarracaPorSlug<Linha>(cliente, 'antigo', 'id'), { id: 'b1' })
    assert.deepEqual(chamadas, ['select:antigo', 'rpc:antigo', 'select:atual'])
  })

  test('sem loja e sem apelido: null; banco sem a função (erro): null, como antes', async () => {
    assert.equal(await buscarBarracaPorSlug<Linha>(falso({ barracas: {} }).cliente, 'nada', 'id'), null)
    assert.equal(await buscarBarracaPorSlug<Linha>(falso({ barracas: { atual: { id: 'b1' } }, apelidos: { antigo: 'atual' }, rpcErro: true }).cliente, 'antigo', 'id'), null)
  })

  test('apelido que aponta para loja que sumiu: null', async () => {
    assert.equal(await buscarBarracaPorSlug<Linha>(falso({ barracas: {}, apelidos: { antigo: 'sumiu' } }).cliente, 'antigo', 'id'), null)
  })
})

describe('fiação (guardas estáticas)', () => {
  const ler = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')

  test('as quatro functions públicas que recebem barraca_slug usam o resolvedor', () => {
    for (const f of ['cliente-pedir-codigo', 'cliente-sessao', 'cliente-verificar-codigo', 'cupom-validar']) {
      const s = ler(`supabase/functions/${f}/index.ts`)
      assert.match(s, /buscarBarracaPorSlug</, f)
      assert.doesNotMatch(s, /from\('barracas'\)\.select\([^)]*\)\.eq\('slug', slug\)/, `${f} ainda busca só pelo slug atual`)
    }
  })

  test('o manifest do PWA sai com o endereço ATUAL quando o pedido veio por um apelido', () => {
    const m = ler('functions/[slug]/manifest.webmanifest.ts')
    assert.match(m, /rest\/v1\/rpc\/barraca_slug_atual/)
    assert.match(m, /let slug = String\(context\.params\.slug/)
    assert.match(m, /start_url: `\/\$\{slug\}`/)
    assert.match(m, /scope: `\/\$\{slug\}`/)
    assert.match(m, /\/\^\[a-z0-9\]\+\(-\[a-z0-9\]\+\)\*\$\/\.test\(atual\)/)
  })
})
