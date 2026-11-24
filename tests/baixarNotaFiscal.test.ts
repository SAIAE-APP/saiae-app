// baixar-nota-fiscal: EXECUTA o handler real (supabase/functions/baixar-nota-fiscal/handler.ts) com supabase e fetch simulados.
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { criarHandler } from '../supabase/functions/baixar-nota-fiscal/handler.ts'

type Linha = Record<string, unknown>
type Chamada = { url: string; auth: string | null }

function montar(opts: { pedido?: Linha; usuario?: boolean; acesso?: boolean; modulo?: boolean; bloqueio?: string | null; barraca?: Linha; nota?: Linha; arquivos?: Record<string, (comAuth: boolean) => Response> } = {}) {
  const pedido = { id: 'p1', barraca_id: 'b1', nfce_status: 'autorizado', nfce_chave: 'NFe' + '1'.repeat(40) + '12345678', nfce_numero: '10', nfce_ambiente: 'homologacao', ...opts.pedido }
  const barraca = { id: 'b1', fiscal_ambiente: 'homologacao', ...opts.barraca }
  const linhaToken = { token_homologacao: 'tok-h', token_producao: 'tok-p' }
  const chamadas: Chamada[] = []
  const consulta = (tabela: string) => {
    const q = {
      select: () => q,
      eq: () => q,
      single: async () => ({ data: tabela === 'pedidos' ? pedido : barraca, error: null }),
      maybeSingle: async () => ({ data: tabela === 'usuarios_barracas' ? (opts.acesso === false ? null : { usuario_id: 'u1' }) : linhaToken, error: null }),
    }
    return q
  }
  const cliente = {
    auth: { getUser: async () => (opts.usuario === false ? { data: { user: null }, error: { message: 'x' } } : { data: { user: { id: 'u1' } }, error: null }) },
    from: consulta,
    rpc: async (fn: string) => (fn === 'fiscal_emissao_bloqueio' ? { data: opts.bloqueio ?? null, error: null } : { data: opts.modulo ?? true, error: null }),
  }
  const nota = { status: 'autorizado', caminho_xml_nota_fiscal: '/arquivos/nota.xml', caminho_danfe: '/arquivos/danfe.html', ...opts.nota }
  const arquivos = opts.arquivos ?? {}
  const buscar = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url)
    const auth = (init?.headers as Record<string, string> | undefined)?.Authorization ?? null
    chamadas.push({ url: u, auth: auth ? atob(auth.replace('Basic ', '')) : null })
    if (u.includes('/v2/nfce/')) return Response.json(nota)
    const caminho = new URL(u).pathname
    const f = arquivos[caminho]
    if (f) return f(auth !== null)
    if (caminho === '/arquivos/nota.xml') return new Response('<xml/>')
    if (caminho === '/arquivos/danfe.html') return new Response('<html>danfe</html>')
    return new Response('nao', { status: 404 })
  }) as typeof fetch
  const handler = criarHandler({ criarCliente: () => cliente, env: { get: () => 'x' }, buscar })
  const chamar = async () => {
    const res = await handler(new Request('http://local/baixar', { method: 'POST', headers: { Authorization: 'Bearer jwt' }, body: JSON.stringify({ pedido_id: 'p1' }) }))
    return { status: res.status, corpo: (await res.json()) as Linha }
  }
  return { chamar, chamadas }
}

describe('baixar-nota-fiscal (handler executado)', () => {
  test('sem JWT válido: 401 e nada chamado', async () => {
    const { chamar, chamadas } = montar({ usuario: false })
    assert.equal((await chamar()).status, 401)
    assert.equal(chamadas.length, 0)
  })

  test('sem acesso à barraca: 403', async () => {
    const { chamar, chamadas } = montar({ acesso: false })
    assert.equal((await chamar()).status, 403)
    assert.equal(chamadas.length, 0)
  })

  test('pedido não autorizado: 422', async () => {
    const { chamar, chamadas } = montar({ pedido: { nfce_status: 'erro' } })
    assert.equal((await chamar()).status, 422)
    assert.equal(chamadas.length, 0)
  })

  test('módulo desligado: 403 modulo_desligado', async () => {
    const { chamar, chamadas } = montar({ modulo: false })
    const r = await chamar()
    assert.equal(r.status, 403)
    assert.equal(r.corpo.erro, 'modulo_desligado')
    assert.equal(chamadas.length, 0)
  })

  test('assinatura sem vigência: 403 com mensagem', async () => {
    const { chamar } = montar({ bloqueio: 'base_sem_vigencia' })
    const r = await chamar()
    assert.equal(r.status, 403)
    assert.equal(r.corpo.erro, 'base_sem_vigencia')
  })

  test('caminho com "//" é recusado (XML) e nenhum host estranho é buscado', async () => {
    const { chamar, chamadas } = montar({ nota: { caminho_xml_nota_fiscal: '//evil.example/x.xml' } })
    const r = await chamar()
    assert.equal(r.status, 502)
    assert.ok(chamadas.every((c) => !c.url.includes('evil')))
  })

  test('caminho absoluto com host estranho e caminho sem "/" são recusados; DANFCe vira null', async () => {
    for (const ruim of ['https://evil.example/danfe.html', 'arquivos/danfe.html', '/\\evil.example/x']) {
      const { chamar, chamadas } = montar({ nota: { caminho_danfe: ruim } })
      const r = await chamar()
      assert.equal(r.status, 200)
      assert.equal(r.corpo.danfce_html, null)
      assert.ok(chamadas.every((c) => !c.url.includes('evil')))
    }
  })

  test('401 no download com Basic: tenta sem auth e conclui', async () => {
    const { chamar, chamadas } = montar({
      arquivos: { '/arquivos/nota.xml': (comAuth) => (comAuth ? new Response('no', { status: 401 }) : new Response('<xml ok/>')) },
    })
    const r = await chamar()
    assert.equal(r.status, 200)
    assert.equal(r.corpo.xml, '<xml ok/>')
    const doXml = chamadas.filter((c) => c.url.endsWith('/arquivos/nota.xml'))
    assert.deepEqual(doXml.map((c) => c.auth), ['tok-h:', null])
  })

  test('sucesso: devolve xml, danfce_html e nome_base; sem vazar token', async () => {
    const { chamar } = montar()
    const r = await chamar()
    assert.equal(r.status, 200)
    assert.equal(r.corpo.xml, '<xml/>')
    assert.equal(r.corpo.danfce_html, '<html>danfe</html>')
    assert.equal(r.corpo.nome_base, 'nfce-10-12345678')
    assert.ok(!JSON.stringify(r.corpo).includes('tok-'))
  })

  test('arquivo acima de 2 MB é recusado', async () => {
    const { chamar } = montar({ arquivos: { '/arquivos/nota.xml': () => new Response('x'.repeat(2 * 1024 * 1024 + 1)) } })
    assert.equal((await chamar()).status, 502)
  })

  test('usa o ambiente GRAVADO no pedido, não o atual da barraca', async () => {
    const { chamar, chamadas } = montar({ pedido: { nfce_ambiente: 'homologacao' }, barraca: { fiscal_ambiente: 'producao' } })
    await chamar()
    assert.ok(chamadas.every((c) => c.url.startsWith('https://homologacao.focusnfe.com.br/')))
    assert.equal(chamadas[0].auth, 'tok-h:')
    const prod = montar({ pedido: { nfce_ambiente: 'producao' }, barraca: { fiscal_ambiente: 'homologacao' } })
    await prod.chamar()
    assert.ok(prod.chamadas.every((c) => c.url.startsWith('https://api.focusnfe.com.br/')))
    assert.equal(prod.chamadas[0].auth, 'tok-p:')
  })

  test('nfce_ambiente nulo cai no ambiente atual da barraca', async () => {
    const { chamar, chamadas } = montar({ pedido: { nfce_ambiente: null }, barraca: { fiscal_ambiente: 'producao' } })
    await chamar()
    assert.ok(chamadas[0].url.startsWith('https://api.focusnfe.com.br/v2/nfce/'))
  })
})
