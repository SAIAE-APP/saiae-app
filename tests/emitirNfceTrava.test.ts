// emitir-nfce (auditoria A2): trava de emissão, reconciliação com a FocusNFe e checagem do update final.
// EXECUTA o handler real (supabase/functions/emitir-nfce/handler.ts) com supabase e fetch simulados. Rodar: npm test
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { beforeEach, describe, mock, test } from 'node:test'
import { TRAVA_NFCE_MS, criarHandler } from '../supabase/functions/emitir-nfce/handler.ts'
import { cifrar as cifrarSegredo, configDoEnv } from '../supabase/functions/_shared/segredoCifrado.ts'

type Linha = Record<string, unknown>

/** Supabase falso: só o que o handler usa. O UPDATE avalia filtros e aplica no MESMO tick (atômico, como o Postgres). */
/** Extras da comanda (Task 10): campos a mais da barraca, a comanda e as rodadas dela (consulta por comanda_id). */
type Extras = { barraca?: Linha; comanda?: Linha | null; rodadas?: Linha[]; erroLeitura?: (tabela: string, colunas: string) => Linha | null }

function criarBanco(inicial: Linha = {}, linhaToken: Linha = { token_homologacao: 'tok-h', token_producao: 'tok-p' }, extras: Extras = {}) {
  const pedido: Linha = { id: 'p1', barraca_id: 'b1', metodo_pagamento: 'pix', nfce_status: null, nfce_chave: null, nfce_numero: null, nfce_trava_em: null, ...inicial }
  const itensDoPedido = [
    { id: 'ip1', item_id: 'i1', nome_item: 'Yakisoba', quantidade: 2, preco_centavos_unitario: 1500, removido: false, opcoes: [], observacao: null },
  ]
  const barraca = { id: 'b1', cnpj: '12.345.678/0001-90', fiscal_habilitado: true, fiscal_ambiente: 'homologacao', tributos_aprox_bps: null, ...extras.barraca }
  const itens = [{ id: 'i1', ncm: '21069090', cfop: '5102', unidade_comercial: 'UN', preco_aberto: false }]
  const updates: Linha[] = []
  const estado = { falharUpdateSe: null as null | ((v: Linha) => boolean) }

  function casa(r: Linha, expr: string): boolean {
    return expr.split(',').some((termo) => {
      const [col, op, ...resto] = termo.split('.')
      const valor = resto.join('.')
      const atual = r[col] as string | null | undefined
      if (op === 'is' && valor === 'null') return atual === null || atual === undefined
      if (atual === null || atual === undefined) return false // SQL: comparação com NULL nunca é verdadeira
      if (op === 'neq') return atual !== valor
      if (op === 'lt') return atual < valor
      throw new Error(`filtro não suportado: ${termo}`)
    })
  }

  function consulta(tabela: string) {
    let op: 'select' | 'update' = 'select'
    let valores: Linha = {}
    let devolver = false
    const eqs: Array<[string, unknown]> = []
    const ors: string[] = []
    let listaIn: unknown[] | null = null
    let colunas = ''
    const q = {
      select(c = '') { if (op === 'update') devolver = true; else colunas = c; return q },
      update(v: Linha) { op = 'update'; valores = v; return q },
      eq(c: string, v: unknown) { eqs.push([c, v]); return q },
      in(_c: string, v: unknown[]) { listaIn = v; return q },
      or(e: string) { ors.push(e); return q },
      single() { return Promise.resolve(executar(true, true)) },
      maybeSingle() { return Promise.resolve(executar(true, false)) },
      then(ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) { return Promise.resolve(executar(false, false)).then(ok, ko) },
    }
    function executar(unico: boolean, exigir: boolean) {
      const erroSimulado = op === 'select' ? extras.erroLeitura?.(tabela, colunas) : null
      if (erroSimulado) return { data: null, error: erroSimulado }
      if (tabela === 'pedidos' && op === 'select' && eqs.some(([c]) => c === 'comanda_id')) return { data: extras.rodadas ?? [], error: null }
      if (tabela === 'comandas') return { data: extras.comanda ?? null, error: null }
      if (tabela === 'pedidos') {
        const bate = eqs.every(([c, v]) => pedido[c] === v) && ors.every((e) => casa(pedido, e))
        if (op === 'update') {
          updates.push(valores)
          if (estado.falharUpdateSe?.(valores)) return { data: null, error: { message: 'falha simulada do banco' } }
          if (bate) Object.assign(pedido, valores)
          return { data: devolver && bate ? { id: pedido.id } : null, error: null }
        }
        if (!bate) return { data: null, error: exigir ? { message: 'not found' } : null }
        return { data: unico ? { ...pedido, desconto_cupom_centavos: 0, itens_do_pedido: itensDoPedido } : [pedido], error: null }
      }
      if (tabela === 'usuarios_barracas') return { data: { usuario_id: 'u1' }, error: null }
      if (tabela === 'barracas') return { data: barraca, error: null }
      if (tabela === 'barracas_fiscal_token') return { data: linhaToken, error: null }
      if (tabela === 'itens') return { data: listaIn ? itens : [], error: null }
      throw new Error(`tabela inesperada: ${tabela}`)
    }
    return q
  }

  const cliente = { auth: { getUser: async () => ({ data: { user: { id: 'u1' } }, error: null }) }, from: consulta }
  return { pedido, updates, estado, cliente }
}

/** FocusNFe falsa: guarda notas por ref; POST com ref repetida é recusado, como a API real. */
function criarFocus() {
  const notas = new Map<string, Linha>()
  const log = { posts: [] as string[], gets: [] as string[], auth: [] as string[], corpos: [] as Linha[] }
  const cfg = {
    /** POST cria a nota e depois "dá timeout" (a nota existe, a resposta se perdeu). */
    timeoutDepoisDeCriar: false,
    /** POST perde a requisição: nada é criado e o fetch lança. */
    timeoutSemCriar: false,
    /** O GET ainda não enxerga a nota (consulta anterior à criação por outra chamada). */
    getCegoAteOPost: false,
    /** POST devolve erro genérico (nada criado). */
    erroGenerico: false,
  }
  let postFeito = false
  const nota = (ref: string): Linha => ({ status: 'autorizado', chave_nfe: `CHAVE-${ref}`, numero: '10', serie: '1', protocolo: 'PROTO', mensagem_sefaz: 'Autorizado o uso da NFC-e' })
  const buscar = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url)
    const cab = init?.headers as Record<string, string> | undefined
    if (cab?.Authorization) log.auth.push(atob(cab.Authorization.replace('Basic ', '')).replace(/:$/, ''))
    const ref = u.split('/nfce')[1].replace(/^[/?]ref=|^\//, '')
    if ((init?.method ?? 'GET') === 'POST') {
      log.posts.push(ref)
      log.corpos.push(JSON.parse(String(init?.body ?? '{}')))
      await new Promise((r) => setTimeout(r, 5))
      postFeito = true
      if (cfg.erroGenerico) return Response.json({ codigo: 'requisicao_invalida', mensagem: 'CNPJ inválido' }, { status: 422 })
      if (cfg.timeoutSemCriar) throw new Error('timeout')
      if (notas.has(ref) || cfg.getCegoAteOPost) {
        notas.set(ref, nota(ref))
        return Response.json({ codigo: 'requisicao_invalida', mensagem: 'Já existe uma nota com esta referência' }, { status: 422 })
      }
      notas.set(ref, nota(ref))
      if (cfg.timeoutDepoisDeCriar) throw new Error('timeout')
      return Response.json(notas.get(ref), { status: 201 })
    }
    log.gets.push(ref)
    if (cfg.getCegoAteOPost && !postFeito) return Response.json({ codigo: 'nao_encontrado' }, { status: 404 })
    const existente = notas.get(ref)
    return existente ? Response.json(existente) : Response.json({ codigo: 'nao_encontrado' }, { status: 404 })
  }) as typeof fetch
  return { buscar, log, cfg, notas }
}

function montar(inicial: Linha = {}, linhaToken?: Linha, env: Record<string, string> = {}, extras: Extras = {}) {
  const banco = criarBanco(inicial, linhaToken, extras)
  const focus = criarFocus()
  const relogio = { agora: Date.parse('2026-10-25T12:00:00Z') }
  const handler = criarHandler({
    criarCliente: () => banco.cliente,
    env: { get: (n: string) => env[n] ?? (n.startsWith('TOKENS_') ? undefined : 'x') },
    buscar: (u, i) => focus.buscar(u, i),
    agora: () => relogio.agora,
    esperar: async () => {},
  })
  const chamar = async (corpo: Linha = { pedido_id: 'p1' }) => {
    const res = await handler(new Request('http://local/emitir-nfce', { method: 'POST', headers: { Authorization: 'Bearer jwt' }, body: JSON.stringify(corpo) }))
    return { status: res.status, corpo: (await res.json()) as Linha }
  }
  return { banco, focus, relogio, chamar }
}

describe('emitir-nfce: trava e reconciliação (handler executado)', () => {
  beforeEach(() => mock.restoreAll())

  test('caminho feliz: um POST, pedido autorizado e trava solta', async () => {
    const { banco, focus, chamar } = montar()
    const r = await chamar()
    assert.equal(r.status, 200)
    assert.equal(r.corpo.status, 'autorizado')
    assert.deepEqual(focus.log.posts, ['p1'])
    assert.equal(banco.pedido.nfce_status, 'autorizado')
    assert.equal(banco.pedido.nfce_chave, 'CHAVE-p1')
    assert.equal(banco.pedido.nfce_trava_em, null)
  })

  test('duas chamadas em paralelo = UM POST à FocusNFe e nenhum `erro` gravado', async () => {
    const { banco, focus, chamar } = montar()
    const [a, b] = await Promise.all([chamar(), chamar()])
    assert.equal(focus.log.posts.length, 1)
    assert.equal(banco.pedido.nfce_status, 'autorizado')
    assert.equal(banco.pedido.nfce_chave, 'CHAVE-p1')
    assert.ok(!banco.updates.some((u) => u.nfce_status === 'erro'))
    // quem perdeu a corrida recebe a nota (se a vencedora já terminou) ou "em andamento" (409); nunca erro de emissão
    for (const r of [a, b]) assert.ok(r.status === 200 || r.status === 202 || r.status === 409, `status ${r.status}`)
    assert.ok([a, b].some((r) => r.status === 200 && r.corpo.status === 'autorizado'))
  })

  test('seis chamadas simultâneas continuam sendo um POST só', async () => {
    const { focus, banco, chamar } = montar()
    await Promise.all(Array.from({ length: 6 }, () => chamar()))
    assert.equal(focus.log.posts.length, 1)
    assert.equal(banco.pedido.nfce_status, 'autorizado')
  })

  test('timeout do POST (nota criada, resposta perdida): nova chamada reconcilia e grava autorizado sem reenviar', async () => {
    const { banco, focus, relogio, chamar } = montar()
    focus.cfg.timeoutDepoisDeCriar = true
    const primeira = await chamar()
    // a própria chamada já tenta reconciliar logo após o timeout e encontra a nota
    assert.equal(primeira.corpo.status, 'autorizado')
    assert.equal(focus.log.posts.length, 1)

    // pior caso: banco ficou `processando_autorizacao` com a trava (a gravação pós-timeout não aconteceu)
    banco.pedido.nfce_status = 'processando_autorizacao'
    banco.pedido.nfce_chave = null
    banco.pedido.nfce_trava_em = new Date(relogio.agora).toISOString()
    relogio.agora += TRAVA_NFCE_MS + 1000
    const segunda = await chamar()
    assert.equal(segunda.status, 200)
    assert.equal(segunda.corpo.status, 'autorizado')
    assert.equal(segunda.corpo.chave, 'CHAVE-p1')
    assert.equal(focus.log.posts.length, 1, 'não reenviou')
    assert.equal(banco.pedido.nfce_status, 'autorizado')
    assert.equal(banco.pedido.nfce_chave, 'CHAVE-p1')
  })

  test('timeout sem nota criada: dentro do prazo da trava = 409 sem POST; depois do prazo reenvia', async () => {
    const { banco, focus, relogio, chamar } = montar()
    focus.cfg.timeoutSemCriar = true
    const primeira = await chamar()
    assert.equal(primeira.status, 502)
    assert.equal(banco.pedido.nfce_status, 'processando_autorizacao', 'trava segue valendo')
    assert.equal(focus.log.posts.length, 1)

    const cedo = await chamar()
    assert.equal(cedo.status, 409)
    assert.equal(focus.log.posts.length, 1, 'trava vigente: nada reenviado')

    focus.cfg.timeoutSemCriar = false
    relogio.agora += TRAVA_NFCE_MS + 1000
    const tarde = await chamar()
    assert.equal(tarde.status, 200)
    assert.equal(focus.log.posts.length, 2)
    assert.equal(banco.pedido.nfce_status, 'autorizado')
  })

  test('ref duplicada com nota AUTORIZADA grava `autorizado`, nunca `erro`', async () => {
    const { banco, focus, chamar } = montar()
    focus.cfg.getCegoAteOPost = true // o GET prévio não vê a nota; o POST descobre que a ref já existe
    const r = await chamar()
    assert.equal(focus.log.posts.length, 1)
    assert.equal(r.status, 200)
    assert.equal(r.corpo.status, 'autorizado')
    assert.equal(banco.pedido.nfce_status, 'autorizado')
    assert.equal(banco.pedido.nfce_chave, 'CHAVE-p1')
    assert.ok(!banco.updates.some((u) => u.nfce_status === 'erro'))
  })

  test('pedido que já está em `erro` mas a nota existe na FocusNFe: reconcilia sem POST', async () => {
    const { banco, focus, chamar } = montar({ nfce_status: 'erro' })
    focus.notas.set('p1', { status: 'autorizado', chave_nfe: 'CHAVE-EXISTENTE', numero: '7' })
    const r = await chamar()
    assert.equal(r.corpo.status, 'autorizado')
    assert.equal(focus.log.posts.length, 0)
    assert.equal(banco.pedido.nfce_status, 'autorizado')
    assert.equal(banco.pedido.nfce_chave, 'CHAVE-EXISTENTE')
  })

  test('nota ainda processando na FocusNFe: 202, sem POST e sem gravar `erro`', async () => {
    const { banco, focus, chamar } = montar({ nfce_status: 'processando_autorizacao' })
    focus.notas.set('p1', { status: 'processando_autorizacao' })
    const r = await chamar()
    assert.equal(r.status, 202)
    assert.equal(focus.log.posts.length, 0)
    assert.ok(!banco.updates.some((u) => u.nfce_status === 'erro'))
  })

  test('erro REAL da FocusNFe (nota não existe) continua gravando `erro` e solta a trava', async () => {
    const { banco, focus, chamar } = montar()
    focus.cfg.erroGenerico = true
    const r = await chamar()
    assert.equal(r.status, 502)
    assert.equal(r.corpo.erro, 'CNPJ inválido')
    assert.equal(banco.pedido.nfce_status, 'erro')
    assert.equal(banco.pedido.nfce_trava_em, null)
  })

  test('update final com erro de banco = 500 com a CHAVE na resposta e no log', async () => {
    const { banco, chamar } = montar()
    banco.estado.falharUpdateSe = (v) => v.nfce_status === 'autorizado'
    const log = mock.method(console, 'error', () => {})
    const r = await chamar()
    assert.equal(r.status, 500)
    assert.match(String(r.corpo.erro), /CHAVE-p1/)
    assert.equal(r.corpo.chave, 'CHAVE-p1')
    const registrou = log.mock.calls.some((c) => JSON.stringify(c.arguments).includes('CHAVE-p1'))
    assert.ok(registrou, 'a chave foi para o log')
  })

  test('pedido já autorizado responde do banco, sem tocar na FocusNFe', async () => {
    const { focus, chamar } = montar({ nfce_status: 'autorizado', nfce_chave: 'K', nfce_numero: '3' })
    const r = await chamar()
    assert.deepEqual(r.corpo, { status: 'autorizado', chave: 'K', numero: '3' })
    assert.equal(focus.log.posts.length + focus.log.gets.length, 0)
  })
})

describe('corrigir forma de pagamento não libera pedido com nota (migration)', () => {
  test('a RPC trata nfce_chave preenchida como nota emitida e a migration cria a coluna da trava', () => {
    const sql = readFileSync(new URL('../supabase/migrations/20261025100000_nfce_trava_e_chave.sql', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
    assert.match(sql, /add column if not exists nfce_trava_em timestamptz/)
    assert.match(sql, /v_pedido\.nfce_chave is not null\n\s+or \(v_pedido\.nfce_status is not null/)
    assert.match(sql, /grant execute on function public\.corrigir_metodo_pagamento\(uuid, text\) to authenticated/)
    assert.match(sql, /revoke all on function public\.corrigir_metodo_pagamento\(uuid, text\) from public, anon/)
  })
})

describe('emitir-nfce: pedidos que nunca emitem (handler executado)', () => {
  beforeEach(() => mock.restoreAll())

  test('cancelado: 422 em português, 0 POST, 0 GET na FocusNFe, 0 update e trava intacta', async () => {
    const { banco, focus, chamar } = montar({ status: 'cancelado' })
    const r = await chamar()
    assert.equal(r.status, 422)
    assert.equal(r.corpo.codigo, 'pedido_cancelado')
    assert.equal(r.corpo.erro, 'Pedido cancelado não emite nota.')
    assert.deepEqual(focus.log.posts, [])
    assert.deepEqual(focus.log.gets, [])
    assert.equal(banco.updates.length, 0)
    assert.equal(banco.pedido.nfce_status, null)
    assert.equal(banco.pedido.nfce_trava_em, null)
  })
  test('cancelado com erro anterior (nfce_status erro): continua recusado, sem reivindicar a trava', async () => {
    const { banco, focus, chamar } = montar({ status: 'cancelado', nfce_status: 'erro' })
    const r = await chamar()
    assert.equal(r.status, 422)
    assert.equal(focus.log.posts.length + focus.log.gets.length, 0)
    assert.equal(banco.updates.length, 0)
  })
  test('método gratis: 422 pedido_gratis, sem FocusNFe e sem update', async () => {
    const { banco, focus, chamar } = montar({ status: 'entregue', metodo_pagamento: 'gratis' })
    const r = await chamar()
    assert.equal(r.status, 422)
    assert.equal(r.corpo.codigo, 'pedido_gratis')
    assert.equal(focus.log.posts.length + focus.log.gets.length, 0)
    assert.equal(banco.updates.length, 0)
  })
  test('na_entrega sem forma definida: 422, sem FocusNFe e sem update', async () => {
    const { banco, focus, chamar } = montar({ status: 'entregue', metodo_pagamento: 'na_entrega' })
    const r = await chamar()
    assert.equal(r.status, 422)
    assert.match(String(r.corpo.erro), /definida na entrega/)
    assert.equal(focus.log.posts.length + focus.log.gets.length, 0)
    assert.equal(banco.updates.length, 0)
  })
  test('pedido entregue e válido segue emitindo normalmente (a regra não atrapalha o caminho feliz)', async () => {
    const { focus, chamar, banco } = montar({ status: 'entregue' })
    const r = await chamar()
    assert.equal(r.status, 200)
    assert.equal(focus.log.posts.length, 1)
    assert.equal(banco.pedido.nfce_status, 'autorizado')
  })
  test('nota já autorizada continua devolvendo o resultado (mesmo se o pedido foi cancelado depois)', async () => {
    const { focus, chamar } = montar({ status: 'cancelado', nfce_status: 'autorizado', nfce_chave: 'CHAVE-X', nfce_numero: '7' })
    const r = await chamar()
    assert.equal(r.status, 200)
    assert.equal(r.corpo.chave, 'CHAVE-X')
    assert.equal(focus.log.posts.length, 0)
  })
})

describe('emitir-nfce: token "cifrado, senão texto"', () => {
  beforeEach(() => mock.restoreAll())
  const CHAVE = Buffer.alloc(32, 7).toString('base64')
  const CHAVE_OUTRA = Buffer.alloc(32, 9).toString('base64')
  const cifrar = async (texto: string, campo = 'token_homologacao') =>
    (await cifrarSegredo(texto, { barracaId: 'b1', campo }, configDoEnv({ get: (n) => ({ TOKENS_CHAVE_V1: CHAVE })[n] }))).valor

  test('só texto, sem chave: usa o texto (comportamento de hoje)', async () => {
    const { focus, chamar } = montar()
    assert.equal((await chamar()).status, 200)
    assert.deepEqual(focus.log.auth.filter((a) => a), ['tok-h', 'tok-h'].slice(0, focus.log.auth.length))
    assert.ok(focus.log.auth.every((a) => a === 'tok-h'))
  })

  test('só cifrado, com chave: decifra e usa o token do ambiente', async () => {
    const cifrado = await cifrar('tok-cifrado-h')
    const { focus, chamar } = montar({}, { token_homologacao: null, token_homologacao_cifrado: cifrado }, { TOKENS_CHAVE_V1: CHAVE })
    assert.equal((await chamar()).status, 200)
    assert.ok(focus.log.auth.length > 0 && focus.log.auth.every((a) => a === 'tok-cifrado-h'))
  })

  test('cifrado e texto, com chave: o cifrado vence', async () => {
    const cifrado = await cifrar('tok-cifrado-h')
    const { focus, chamar } = montar({}, { token_homologacao: 'tok-velho', token_homologacao_cifrado: cifrado }, { TOKENS_CHAVE_V1: CHAVE })
    await chamar()
    assert.ok(focus.log.auth.every((a) => a === 'tok-cifrado-h'))
  })

  test('cifrado e texto, SEM chave: cai no texto e a emissão segue', async () => {
    const cifrado = await cifrar('tok-cifrado-h')
    const avisos: unknown[][] = []
    mock.method(console, 'warn', (...a: unknown[]) => avisos.push(a))
    const { focus, chamar } = montar({}, { token_homologacao: 'tok-velho', token_homologacao_cifrado: cifrado })
    assert.equal((await chamar()).status, 200)
    assert.ok(focus.log.auth.every((a) => a === 'tok-velho'))
    assert.ok(avisos.some((a) => a.includes('sem_chave')))
    assert.ok(!JSON.stringify(avisos).includes('tok-'), 'o log não carrega token')
  })

  test('cifrado e texto, chave ERRADA: cai no texto', async () => {
    const cifrado = await cifrar('tok-cifrado-h')
    mock.method(console, 'warn', () => {})
    const { focus, chamar } = montar({}, { token_homologacao: 'tok-velho', token_homologacao_cifrado: cifrado }, { TOKENS_CHAVE_V1: CHAVE_OUTRA })
    assert.equal((await chamar()).status, 200)
    assert.ok(focus.log.auth.every((a) => a === 'tok-velho'))
  })

  test('só cifrado e sem chave: 422 "não configurado", sem chamar a FocusNFe e sem vazar nada', async () => {
    const cifrado = await cifrar('tok-cifrado-h')
    mock.method(console, 'warn', () => {})
    const { focus, chamar } = montar({}, { token_homologacao: null, token_homologacao_cifrado: cifrado })
    const r = await chamar()
    assert.equal(r.status, 422)
    assert.match(String(r.corpo.erro), /não configurado/)
    assert.equal(focus.log.posts.length + focus.log.gets.length, 0)
  })

  test('cifrado de OUTRO campo (produção colado em homologação) não decifra', async () => {
    const cifradoProducao = await cifrar('tok-prod', 'token_producao')
    mock.method(console, 'warn', () => {})
    const { focus, chamar } = montar({}, { token_homologacao: null, token_homologacao_cifrado: cifradoProducao }, { TOKENS_CHAVE_V1: CHAVE })
    assert.equal((await chamar()).status, 422)
    assert.equal(focus.log.posts.length, 0)
  })
})

describe('emitir-nfce: taxa de serviço da comanda na nota (interruptor nfce_incluir_taxas)', () => {
  beforeEach(() => mock.restoreAll())

  // Pedido p1 (2 x 15,00 = 3000) é uma das 3 rodadas da comanda c1, fechada com taxa de 600: base 1000 + 3000 + 2000 (p3 cancelada e o item removido de p2 não contam) = rateio 100/300/200.
  const rodadas = [
    { id: 'p0', status: 'entregue', itens_do_pedido: [{ quantidade: 1, preco_centavos_unitario: 1000, removido: false }] },
    { id: 'p1', status: 'entregue', itens_do_pedido: [{ quantidade: 2, preco_centavos_unitario: 1500, removido: false }] },
    { id: 'p2', status: 'entregue', itens_do_pedido: [{ quantidade: 1, preco_centavos_unitario: 2000, removido: false }, { quantidade: 9, preco_centavos_unitario: 100, removido: true }] },
    { id: 'p3', status: 'cancelado', itens_do_pedido: [{ quantidade: 1, preco_centavos_unitario: 9000, removido: false }] },
  ]
  const comandaFechada = { id: 'c1', status: 'fechada', taxa_servico_centavos: 600 }
  const corpoEnviado = (focus: { log: { corpos: Linha[] } }) => focus.log.corpos[0] as { items: Linha[]; formas_pagamento: Linha[] }

  test('desligado (padrão): payload idêntico ao de hoje, sem outras despesas', async () => {
    const { banco, focus, chamar } = montar({ comanda_id: 'c1' }, undefined, {}, { comanda: comandaFechada, rodadas })
    assert.equal((await chamar()).status, 200)
    const corpo = corpoEnviado(focus)
    assert.ok(!('valor_outras_despesas' in corpo.items[0]))
    assert.deepEqual(corpo.formas_pagamento, [{ forma_pagamento: '17', valor_pagamento: 30 }])
    assert.ok(!banco.updates.some((u) => 'nfce_taxa_servico_centavos' in u))
  })

  test('ligado e comanda fechada com taxa: nota leva a parte da rodada e o pagamento bate com o total', async () => {
    const { banco, focus, chamar } = montar({ comanda_id: 'c1' }, undefined, {}, { barraca: { nfce_incluir_taxas: true }, comanda: comandaFechada, rodadas })
    assert.equal((await chamar()).status, 200)
    const corpo = corpoEnviado(focus)
    assert.equal(corpo.items[0].valor_outras_despesas, 3)
    assert.deepEqual(corpo.formas_pagamento, [{ forma_pagamento: '17', valor_pagamento: 33 }])
    assert.equal(banco.pedido.nfce_taxa_servico_centavos, 300)
  })

  test('ligado, mas comanda ainda aberta ou sem taxa: nada muda', async () => {
    for (const comanda of [{ ...comandaFechada, status: 'aberta' }, { ...comandaFechada, taxa_servico_centavos: 0 }]) {
      const { focus, chamar } = montar({ comanda_id: 'c1' }, undefined, {}, { barraca: { nfce_incluir_taxas: true }, comanda, rodadas })
      assert.equal((await chamar()).status, 200)
      assert.ok(!('valor_outras_despesas' in corpoEnviado(focus).items[0]))
      assert.equal(corpoEnviado(focus).formas_pagamento[0].valor_pagamento, 30)
    }
  })

  test('ligado, pedido fora de comanda: nada muda', async () => {
    const { focus, chamar } = montar({}, undefined, {}, { barraca: { nfce_incluir_taxas: true } })
    assert.equal((await chamar()).status, 200)
    assert.ok(!('valor_outras_despesas' in corpoEnviado(focus).items[0]))
  })

  test('retry depois de timeout: reenvia e grava a MESMA parte congelada na trava, mesmo com os dados mudados', async () => {
    const comanda = { ...comandaFechada }
    const vivas = rodadas.map((r) => ({ ...r }))
    const { banco, focus, relogio, chamar } = montar({ comanda_id: 'c1' }, undefined, {}, { barraca: { nfce_incluir_taxas: true }, comanda, rodadas: vivas })
    focus.cfg.timeoutSemCriar = true
    assert.equal((await chamar()).status, 502)
    assert.equal(banco.pedido.nfce_taxa_servico_centavos, 300, 'parte congelada na trava, antes do POST')
    // Depois do POST: a taxa muda e uma rodada é cancelada (a parte "ao vivo" agora seria outra).
    comanda.taxa_servico_centavos = 1000
    vivas[0].status = 'cancelado'
    focus.cfg.timeoutSemCriar = false
    relogio.agora += TRAVA_NFCE_MS + 1
    assert.equal((await chamar()).status, 200)
    assert.equal(focus.log.corpos.length, 2)
    for (const corpo of focus.log.corpos as Array<{ items: Linha[]; formas_pagamento: Linha[] }>) {
      assert.equal(corpo.items[0].valor_outras_despesas, 3)
      assert.equal(corpo.formas_pagamento[0].valor_pagamento, 33)
    }
    assert.equal(banco.pedido.nfce_status, 'autorizado')
    assert.equal(banco.pedido.nfce_taxa_servico_centavos, 300)
  })

  test('reconciliação em outra chamada (nota criada, resposta perdida): grava a parte enviada, não a recalculada', async () => {
    const comanda = { ...comandaFechada }
    const { banco, focus, relogio, chamar } = montar({ comanda_id: 'c1' }, undefined, {}, { barraca: { nfce_incluir_taxas: true }, comanda, rodadas })
    focus.cfg.timeoutDepoisDeCriar = true
    const original = focus.buscar
    let consultaFora = true
    // Na 1ª chamada a consulta também falha: ela termina sem saber que a nota existe.
    focus.buscar = (async (u: string | URL | Request, init?: RequestInit) =>
      consultaFora && (init?.method ?? 'GET') === 'GET' ? Response.json({}, { status: 503 }) : original(u, init)) as typeof fetch
    assert.equal((await chamar()).status, 502)
    assert.equal(banco.pedido.nfce_taxa_servico_centavos, 300)
    comanda.taxa_servico_centavos = 1000 // dados mudam depois do POST
    consultaFora = false
    relogio.agora += TRAVA_NFCE_MS + 1
    assert.equal((await chamar()).status, 200)
    assert.equal(focus.log.posts.length, 1, 'reconciliou sem reenviar')
    assert.equal(banco.pedido.nfce_status, 'autorizado')
    assert.equal(banco.pedido.nfce_taxa_servico_centavos, 300)
  })

  for (const [nome, tabela, trecho] of [
    ['vínculo do pedido', 'pedidos', 'nfce_taxa_servico_centavos'],
    ['interruptor', 'barracas', 'nfce_incluir_taxas'],
    ['comanda', 'comandas', 'taxa_servico_centavos'],
    ['rodadas', 'pedidos', 'itens_do_pedido(quantidade'],
  ] as const) {
    test(`erro ao ler ${nome}: 500 antes da trava, nada vai para a FocusNFe`, async () => {
      const erroLeitura = (t: string, c: string) => (t === tabela && c.includes(trecho) ? { code: '08006', message: 'conexão caiu' } : null)
      const { banco, focus, chamar } = montar({ comanda_id: 'c1' }, undefined, {}, { barraca: { nfce_incluir_taxas: true }, comanda: comandaFechada, rodadas, erroLeitura })
      const r = await chamar()
      assert.equal(r.status, 500)
      assert.equal(focus.log.posts.length + focus.log.gets.length, 0)
      assert.equal(banco.updates.length, 0)
    })
  }

  for (const code of ['42703', 'PGRST204']) {
    test(`coluna ausente (${code}, migration não aplicada): vale 0 e a nota sai como hoje`, async () => {
      const erroLeitura = (t: string, c: string) =>
        (t === 'pedidos' && c.includes('nfce_taxa_servico_centavos')) || (t === 'barracas' && c.includes('nfce_incluir_taxas'))
          ? { code, message: 'column does not exist' }
          : null
      const { focus, chamar } = montar({ comanda_id: 'c1' }, undefined, {}, { comanda: comandaFechada, rodadas, erroLeitura })
      assert.equal((await chamar()).status, 200)
      assert.ok(!('valor_outras_despesas' in corpoEnviado(focus).items[0]))
      assert.equal(corpoEnviado(focus).formas_pagamento[0].valor_pagamento, 30)
    })
  }

  test('a parte da rodada não depende da ordem em que as rodadas chegam do banco', async () => {
    const { focus, chamar } = montar({ comanda_id: 'c1' }, undefined, {}, { barraca: { nfce_incluir_taxas: true }, comanda: comandaFechada, rodadas: [...rodadas].reverse() })
    assert.equal((await chamar()).status, 200)
    assert.equal(corpoEnviado(focus).items[0].valor_outras_despesas, 3)
  })
})
