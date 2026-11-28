// mcp-saiae: EXECUTA o handler real (supabase/functions/mcp-saiae/handler.ts) com o banco simulado.
// A regra de negócio de proposta/aplicação vive no SQL (migration 20261127110000); aqui se testa o que o handler
// manda para as RPCs (token vem da validação, nunca da IA) e como ele traduz cada estado. O SQL precisa de teste em banco real.
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { criarHandler } from '../supabase/functions/mcp-saiae/handler.ts'

const TOKEN = 'sae_' + 'a'.repeat(48)
const ITEM_A = '11111111-1111-4111-8111-111111111111'
const ITEM_B = '22222222-2222-4222-8222-222222222222'
const PROPOSTA = '44444444-4444-4444-8444-444444444444'
type Linha = Record<string, unknown>

type Opcoes = {
  tokenValido?: boolean
  erroValidar?: boolean
  respostas?: Record<string, Linha | { erro: true }>
  limite?: Linha | { erro: true }
  categorias?: Linha[]
  itensExtras?: Linha[]
  fetchFn?: (url: string, init: RequestInit) => Promise<Response>
  resolverDns?: (host: string) => Promise<string[]>
  falhaCopia?: string
}

function montar(opts: Opcoes = {}) {
  const itens: Linha[] = [
    { id: ITEM_A, barraca_id: 'bA', nome: 'Poke', preco_centavos: 3800, categoria_id: null, ordem: 1 },
    { id: ITEM_B, barraca_id: 'bB', nome: 'Sushi', preco_centavos: 5000, categoria_id: null, ordem: 1 },
    ...(opts.itensExtras ?? []),
  ]
  const tabelas: Record<string, Linha[]> = { itens, categorias: opts.categorias ?? [] }
  const rpcs: Array<{ nome: string; args: Linha }> = []
  const escritas: string[] = []
  const limites: Linha[] = []
  const storage: Array<{ op: string; args: unknown[] }> = []
  const consulta = (tabela: string) => {
    const fonte = tabelas[tabela] ?? []
    const filtros: Array<[string, unknown]> = []
    const q: Record<string, unknown> = {}
    q.select = () => q
    q.eq = (c: string, v: unknown) => (filtros.push([c, v]), q)
    q.ilike = () => q
    q.order = () => q
    const filtrado = () => fonte.filter((i) => filtros.every(([c, v]) => i[c] === v))
    q.limit = async () => ({ data: filtrado(), error: null })
    q.range = async (de: number, ate: number) => ({ data: filtrado().slice(de, ate + 1), error: null })
    q.update = () => (escritas.push('update'), q)
    q.insert = () => (escritas.push('insert'), q)
    return q
  }
  const db = {
    from: consulta,
    storage: {
      from: (bucket: string) => ({
        upload: async (...a: unknown[]) => (storage.push({ op: 'upload', args: [bucket, ...a] }), { error: null }),
        copy: async (...a: unknown[]) => (storage.push({ op: 'copy', args: a }), { error: opts.falhaCopia ? { message: opts.falhaCopia } : null }),
        remove: async (...a: unknown[]) => (storage.push({ op: 'remove', args: a }), { error: null }),
        getPublicUrl: (caminho: string) => ({ data: { publicUrl: `https://x.supabase.co/storage/v1/object/public/${bucket}/${caminho}` } }),
      }),
    },
    rpc: async (nome: string, args: Linha) => {
      if (nome === 'mcp_limite_registrar') {
        limites.push(args)
        if (opts.limite && 'erro' in opts.limite) return { data: null, error: { message: 'x' } }
        return { data: opts.limite ?? { estado: 'ok' }, error: null }
      }
      if (nome === 'mcp_token_validar') {
        if (opts.erroValidar) return { data: null, error: { message: 'db fora' } }
        return opts.tokenValido === false ? { data: null, error: null } : { data: { barraca_id: 'bA', token_id: 't1' }, error: null }
      }
      rpcs.push({ nome, args })
      const r = opts.respostas?.[nome]
      if (r && 'erro' in r) return { data: null, error: { message: 'x' } }
      return { data: r ?? { estado: 'ok' }, error: null }
    },
  }
  const handler = criarHandler({ criarCliente: () => db, env: { get: () => 'x' }, fetchFn: opts.fetchFn, resolverDns: opts.resolverDns })
  const chamar = (corpo: unknown, auth: string | null = `Bearer ${TOKEN}`, metodo = 'POST') =>
    handler(
      new Request('http://x/mcp', {
        method: metodo,
        headers: { 'content-type': 'application/json', ...(auth ? { authorization: auth } : {}) },
        body: metodo === 'POST' ? JSON.stringify(corpo) : undefined,
      }),
    )
  const ferramenta = async (name: string, args: Linha) => {
    const r = await (await chamar({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } })).json()
    return r.result ? { texto: r.result.content[0].text as string, erro: r.result.isError as boolean } : { texto: '', erro: true, rpc: r.error }
  }
  return { chamar, ferramenta, rpcs, escritas, limites, storage }
}

describe('mcp-saiae', () => {
  test('sem token, token malformado ou método errado', async () => {
    const { chamar } = montar()
    assert.equal((await chamar({}, null)).status, 401)
    assert.equal((await chamar({}, 'Bearer abc')).status, 401)
    assert.equal((await chamar(null, `Bearer ${TOKEN}`, 'GET')).status, 405)
  })

  test('token revogado: 401; banco fora: 503', async () => {
    assert.equal((await montar({ tokenValido: false }).chamar({ jsonrpc: '2.0', id: 1, method: 'ping' })).status, 401)
    assert.equal((await montar({ erroValidar: true }).chamar({ jsonrpc: '2.0', id: 1, method: 'ping' })).status, 503)
  })

  test('initialize negocia a versão e tools/list traz anotações', async () => {
    const { chamar } = montar()
    const ini = await (await chamar({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '9999' } })).json()
    assert.equal(ini.result.protocolVersion, '2025-03-26')
    const lista = await (await chamar({ jsonrpc: '2.0', id: 2, method: 'tools/list' })).json()
    const porNome = Object.fromEntries(lista.result.tools.map((t: { name: string }) => [t.name, t]))
    assert.equal(porNome.listar_itens.annotations.readOnlyHint, true)
    assert.equal(porNome.alterar_preco_item.annotations.readOnlyHint, false)
  })

  test('envelopes inválidos recebem -32600 e não chamam RPC', async () => {
    const { chamar, rpcs } = montar()
    const params = { name: 'alterar_preco_item', arguments: { proposta_id: PROPOSTA } }
    for (const corpo of [
      { id: 1, method: 'tools/call', params },
      { jsonrpc: '1.0', id: 1, method: 'tools/call', params },
      { jsonrpc: '2.0', id: { a: 1 }, method: 'tools/call', params },
      [{ jsonrpc: '2.0', id: 1, method: 'ping' }],
    ]) {
      assert.equal((await (await chamar(corpo)).json()).error.code, -32600)
    }
    assert.equal(rpcs.length, 0)
  })

  test('notificação e chamada sem id respondem 202', async () => {
    const { chamar } = montar()
    assert.equal((await chamar({ jsonrpc: '2.0', method: 'notifications/initialized' })).status, 202)
    assert.equal((await chamar({ jsonrpc: '2.0', method: 'tools/call', params: { name: 'listar_itens' } })).status, 202)
  })

  test('listar_itens só devolve itens da barraca do token', async () => {
    const { ferramenta } = montar()
    const nomes = JSON.parse((await ferramenta('listar_itens', { busca: '100%_' })).texto).itens.map((i: { nome: string }) => i.nome)
    assert.deepEqual(nomes, ['Poke'])
  })

  test('propor: usa o token_id da validação, não grava direto e manda o dono aprovar', async () => {
    const { ferramenta, rpcs, escritas } = montar({
      respostas: { mcp_proposta_criar: { estado: 'ok', proposta_id: PROPOSTA, nome: 'Poke', de: 3800, para: 3400 } },
    })
    const r = await ferramenta('alterar_preco_item', { item_id: ITEM_A, novo_preco_centavos: 3400, token_id: 'outro' })
    assert.match(r.texto, /PROPOSTA/)
    assert.match(r.texto, new RegExp(PROPOSTA))
    assert.deepEqual(rpcs.at(-1), { nome: 'mcp_proposta_criar', args: { p_token_id: 't1', p_tipo: 'preco', p_item_id: ITEM_A, p_dados: { para: 3400 } } })
    assert.deepEqual(escritas, [])
  })

  test('aplicar: usa o token_id da validação e traduz cada estado', async () => {
    const casos: Array<[string, boolean, RegExp]> = [
      ['ok', false, /Alterado/],
      ['aguardando_aprovacao', true, /NÃO aprovou/],
      ['recusada', true, /recusou/],
      ['expirada', true, /venceu/],
      ['preco_mudou', true, /mudou/],
      ['item_mudou', true, /mudou/],
      ['token_invalido', true, /Nada foi alterado/],
      ['tipo_incorreto', true, /outra ferramenta/],
    ]
    for (const [estado, erro, regex] of casos) {
      const { ferramenta, rpcs } = montar({ respostas: { mcp_proposta_aplicar: { estado, nome: 'Poke', de: 3800, para: 3400 } } })
      const r = await ferramenta('alterar_preco_item', { proposta_id: PROPOSTA })
      assert.equal(r.erro, erro, estado)
      assert.match(r.texto, regex, estado)
      assert.deepEqual(rpcs.at(-1), { nome: 'mcp_proposta_aplicar', args: { p_token_id: 't1', p_proposta_id: PROPOSTA, p_tipo_esperado: 'preco' } })
    }
  })

  test('falha do banco ao aplicar: erro e nada alterado', async () => {
    const { ferramenta } = montar({ respostas: { mcp_proposta_aplicar: { erro: true } } })
    const r = await ferramenta('alterar_preco_item', { proposta_id: PROPOSTA })
    assert.equal(r.erro, true)
    assert.match(r.texto, /Nada foi alterado/)
  })

  test('recusa entradas inválidas sem chamar RPC', async () => {
    const { ferramenta, rpcs } = montar()
    for (const args of [
      { item_id: ITEM_A, novo_preco_centavos: 0 },
      { item_id: ITEM_A, novo_preco_centavos: 12.5 },
      { item_id: 'x', novo_preco_centavos: 100 },
      { proposta_id: 'nao-uuid' },
      {},
    ]) {
      assert.equal((await ferramenta('alterar_preco_item', args)).erro, true)
    }
    assert.equal(rpcs.length, 0)
  })

  test('marcar_esgotado: propõe com tipo esgotado e não grava direto', async () => {
    const { ferramenta, rpcs, escritas } = montar({
      respostas: { mcp_proposta_criar: { estado: 'ok', proposta_id: PROPOSTA, tipo: 'esgotado', nome: 'Poke', de: false, para: true } },
    })
    const r = await ferramenta('marcar_esgotado', { item_id: ITEM_A, esgotado: true })
    assert.match(r.texto, /PROPOSTA.*ESGOTADO/)
    assert.match(r.texto, new RegExp(PROPOSTA))
    assert.deepEqual(rpcs.at(-1), { nome: 'mcp_proposta_criar', args: { p_token_id: 't1', p_tipo: 'esgotado', p_item_id: ITEM_A, p_dados: { para: true } } })
    assert.deepEqual(escritas, [])
  })

  test('marcar_esgotado: aplicar traduz o resultado e valida entradas', async () => {
    const ok = montar({ respostas: { mcp_proposta_aplicar: { estado: 'ok', tipo: 'esgotado', nome: 'Poke', de: false, para: false } } })
    assert.match((await ok.ferramenta('marcar_esgotado', { proposta_id: PROPOSTA })).texto, /Poke agora está disponível/)
    const sem = montar({ respostas: { mcp_proposta_criar: { estado: 'sem_mudanca', nome: 'Poke' } } })
    const r = await sem.ferramenta('marcar_esgotado', { item_id: ITEM_A, esgotado: true })
    assert.equal(r.erro, false)
    assert.match(r.texto, /Nada a alterar/)
    const inv = montar()
    for (const args of [{ item_id: ITEM_A }, { item_id: ITEM_A, esgotado: 'true' }, { item_id: 'x', esgotado: true }]) {
      assert.equal((await inv.ferramenta('marcar_esgotado', args)).erro, true)
    }
    assert.equal(inv.rpcs.length, 0)
  })

  test('ajustar_estoque: propõe com delta e motivo, aplica e traduz o saldo', async () => {
    const { ferramenta, rpcs, escritas } = montar({
      respostas: { mcp_proposta_criar: { estado: 'ok', proposta_id: PROPOSTA, tipo: 'estoque', nome: 'Poke', delta: 20, estoque_atual: 5 } },
    })
    const r = await ferramenta('ajustar_estoque', { item_id: ITEM_A, quantidade: 20, motivo: 'reposição' })
    assert.match(r.texto, /PROPOSTA.*[+]20.*hoje 5, ficaria 25/)
    assert.deepEqual(rpcs.at(-1), { nome: 'mcp_proposta_criar', args: { p_token_id: 't1', p_tipo: 'estoque', p_item_id: ITEM_A, p_dados: { delta: 20, motivo: 'reposição' } } })
    assert.deepEqual(escritas, [])
    const ap = montar({ respostas: { mcp_proposta_aplicar: { estado: 'ok', tipo: 'estoque', nome: 'Poke', delta: -3, estoque_qtd: 2 } } })
    assert.match((await ap.ferramenta('ajustar_estoque', { proposta_id: PROPOSTA })).texto, /-3, saldo agora 2/)
    const faixa = montar({ respostas: { mcp_proposta_aplicar: { estado: 'fora_da_faixa', tipo: 'estoque' } } })
    assert.equal((await faixa.ferramenta('ajustar_estoque', { proposta_id: PROPOSTA })).erro, true)
  })

  test('ajustar_estoque: sem controle avisa que liga o controle; recusa entradas inválidas sem RPC', async () => {
    const liga = montar({ respostas: { mcp_proposta_criar: { estado: 'ok', proposta_id: PROPOSTA, nome: 'Poke', delta: 10, estoque_atual: null } } })
    assert.match((await liga.ferramenta('ajustar_estoque', { item_id: ITEM_A, quantidade: 10 })).texto, /liga o controle/)
    const inv = montar()
    for (const args of [
      { item_id: ITEM_A, quantidade: 0 },
      { item_id: ITEM_A, quantidade: 1.5 },
      { item_id: ITEM_A, quantidade: 1000001 },
      { item_id: ITEM_A, quantidade: '5' },
      { item_id: ITEM_A, quantidade: 5, motivo: 42 },
      { item_id: 'x', quantidade: 5 },
    ]) {
      assert.equal((await inv.ferramenta('ajustar_estoque', args)).erro, true)
    }
    assert.equal(inv.rpcs.length, 0)
  })

  test('resumo_vendas_dia: só leitura, data validada, token vem da validação', async () => {
    const { ferramenta, rpcs, escritas } = montar({ respostas: { mcp_resumo_vendas: { estado: 'ok', data: '2026-11-27', pedidos: 2, itens_centavos: 9000 } } })
    const r = await ferramenta('resumo_vendas_dia', { data: '2026-11-27' })
    assert.deepEqual(JSON.parse(r.texto), { data: '2026-11-27', pedidos: 2, itens_centavos: 9000 })
    assert.deepEqual(rpcs.at(-1), { nome: 'mcp_resumo_vendas', args: { p_token_id: 't1', p_data: '2026-11-27' } })
    await ferramenta('resumo_vendas_dia', {})
    assert.deepEqual(rpcs.at(-1), { nome: 'mcp_resumo_vendas', args: { p_token_id: 't1', p_data: null } })
    assert.deepEqual(escritas, [])
    const inv = montar()
    for (const data of ['27/11/2026', '2026-02-31', '2026-13-01', 20261127, 'hoje']) {
      assert.equal((await inv.ferramenta('resumo_vendas_dia', { data })).erro, true)
    }
    assert.equal(inv.rpcs.length, 0)
    const fora = montar({ respostas: { mcp_resumo_vendas: { estado: 'data_invalida' } } })
    assert.equal((await fora.ferramenta('resumo_vendas_dia', { data: '2020-01-01' })).erro, true)
  })

  test('ferramenta desconhecida: erro JSON-RPC', async () => {
    const r = await montar().ferramenta('apagar_tudo', {})
    assert.equal((r as { rpc?: { code: number } }).rpc?.code, -32602)
  })
})

const png = (largura: number, altura: number) => {
  const b = new Uint8Array(33)
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52])
  new DataView(b.buffer).setUint32(16, largura)
  new DataView(b.buffer).setUint32(20, altura)
  return b
}
const BARRACA = 'bA'
const UUID_PEND = 'f1000000-0000-4000-8000-000000000001'

describe('mcp-saiae: limite de chamadas', () => {
  test('conta só tools/call de ferramenta conhecida, com o token da validação', async () => {
    const m = montar()
    await m.chamar({ jsonrpc: '2.0', id: 1, method: 'ping' })
    await m.chamar({ jsonrpc: '2.0', id: 2, method: 'tools/list' })
    await m.ferramenta('apagar_tudo', {})
    assert.equal(m.limites.length, 0)
    await m.ferramenta('listar_itens', {})
    assert.deepEqual(m.limites, [{ p_token_id: 't1' }])
  })

  test('estourou o minuto ou o dia: 429 com Retry-After e a ferramenta NÃO roda', async () => {
    for (const [estado, retry] of [['limite_minuto', 12], ['limite_dia', 3600]] as const) {
      const m = montar({ limite: { estado, retry_em: retry } })
      const r = await m.chamar({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'alterar_preco_item', arguments: { item_id: ITEM_A, novo_preco_centavos: 3400 } } })
      assert.equal(r.status, 429)
      assert.equal(r.headers.get('retry-after'), String(retry))
      assert.equal((await r.json()).erro, 'limite_de_chamadas')
      assert.equal(m.rpcs.length, 0)
    }
  })

  test('token revogado entre a validação e a contagem: 401, não executa', async () => {
    const m = montar({ limite: { estado: 'token_invalido' } })
    const r = await m.chamar({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'listar_itens', arguments: {} } })
    assert.equal(r.status, 401)
    assert.equal(m.rpcs.length, 0)
  })

  test('falha ou resposta estranha na contagem: 503, não executa', async () => {
    for (const limite of [{ erro: true } as const, { estado: 'x' }]) {
      const m = montar({ limite })
      const r = await m.chamar({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'listar_itens', arguments: {} } })
      assert.equal(r.status, 503)
    }
  })
})

describe('mcp-saiae: criar_cupom', () => {
  const resposta = { estado: 'ok', proposta_id: PROPOSTA, tipo: 'cupom', nome: 'PROMO10', codigo: 'PROMO10', tipo_desconto: 'percentual', valor: 10, valido_de: null, valido_ate: '2099-12-31', limite_usos: 50, pedido_minimo_centavos: 3000 }

  test('propõe com os dados validados, sem item, sem gravar, e avisa que nasce pausado', async () => {
    const m = montar({ respostas: { mcp_proposta_criar: resposta } })
    const r = await m.ferramenta('criar_cupom', { codigo: ' promo10 ', percentual: 10, valido_ate: '2099-12-31', limite_usos: 50, pedido_minimo_centavos: 3000 })
    assert.match(r.texto, /PROPOSTA criada.*PROMO10.*10%.*até 2099-12-31.*50 usos.*PAUSADO/)
    assert.match(r.texto, new RegExp(PROPOSTA))
    assert.deepEqual(m.rpcs.at(-1), {
      nome: 'mcp_proposta_criar',
      args: { p_token_id: 't1', p_tipo: 'cupom', p_item_id: null, p_dados: { codigo: 'promo10', tipo_desconto: 'percentual', valor: 10, valido_de: null, valido_ate: '2099-12-31', limite_usos: 50, pedido_minimo_centavos: 3000 } },
    })
    assert.deepEqual(m.escritas, [])
    const fixo = montar({ respostas: { mcp_proposta_criar: { ...resposta, tipo_desconto: 'fixo', valor: 500 } } })
    assert.match((await fixo.ferramenta('criar_cupom', { codigo: 'MENOS5', valor_fixo_centavos: 500 })).texto, /R\$\s5,00 de desconto/)
    assert.equal((fixo.rpcs.at(-1)!.args.p_dados as Linha).tipo_desconto, 'fixo')
  })

  test('aplicar usa o tipo cupom e explica que o cupom está pausado', async () => {
    const m = montar({ respostas: { mcp_proposta_aplicar: { estado: 'ok', tipo: 'cupom', codigo: 'PROMO10', cupons_habilitado: false } } })
    const r = await m.ferramenta('criar_cupom', { proposta_id: PROPOSTA })
    assert.match(r.texto, /PROMO10 criado, mas PAUSADO.*Ajustes > Cupons.*desligados/)
    assert.deepEqual(m.rpcs.at(-1), { nome: 'mcp_proposta_aplicar', args: { p_token_id: 't1', p_proposta_id: PROPOSTA, p_tipo_esperado: 'cupom' } })
    const repetido = montar({ respostas: { mcp_proposta_aplicar: { estado: 'codigo_existe', tipo: 'cupom' } } })
    assert.equal((await repetido.ferramenta('criar_cupom', { proposta_id: PROPOSTA })).erro, true)
  })

  test('entradas inválidas são recusadas sem chamar o banco', async () => {
    const m = montar()
    for (const args of [
      {}, { codigo: 'ab', percentual: 10 }, { codigo: 'a b c', percentual: 10 }, { codigo: 'OK123' },
      { codigo: 'OK123', percentual: 10, valor_fixo_centavos: 500 }, { codigo: 'OK123', percentual: 0 }, { codigo: 'OK123', percentual: 101 },
      { codigo: 'OK123', percentual: 5.5 }, { codigo: 'OK123', percentual: '10' }, { codigo: 'OK123', valor_fixo_centavos: 0 },
      { codigo: 'OK123', percentual: 10, valido_ate: '31/12/2099' }, { codigo: 'OK123', percentual: 10, valido_de: '2026-02-31' },
      { codigo: 'OK123', percentual: 10, limite_usos: 0 }, { codigo: 'OK123', percentual: 10, limite_usos: 1.5 },
      { codigo: 'OK123', percentual: 10, pedido_minimo_centavos: -1 },
    ]) {
      assert.equal((await m.ferramenta('criar_cupom', args)).erro, true, JSON.stringify(args))
    }
    assert.equal(m.rpcs.length, 0)
  })

  test('estados de erro do banco viram mensagem clara', async () => {
    for (const estado of ['codigo_existe', 'data_invalida', 'janela_invalida', 'valor_invalido', 'limite_invalido', 'minimo_invalido', 'codigo_invalido', 'muitas_pendentes']) {
      const m = montar({ respostas: { mcp_proposta_criar: { estado, nome: 'X' } } })
      assert.equal((await m.ferramenta('criar_cupom', { codigo: 'OK123', percentual: 10 })).erro, true, estado)
    }
  })
})

describe('mcp-saiae: definir_foto_item', () => {
  const dns = async () => ['93.184.216.34']
  const imagem = (bytes = png(800, 600)) => async () => new Response(bytes, { status: 200, headers: { 'content-type': 'text/plain' } })
  const respostaCriar = { estado: 'ok', proposta_id: PROPOSTA, tipo: 'foto', nome: 'Poke', largura: 800, altura: 600, bytes: 33, tinha_foto: false }

  test('baixa, guarda em pendente/ do bucket, propõe e NÃO muda o item', async () => {
    const m = montar({ fetchFn: imagem(), resolverDns: dns, respostas: { mcp_proposta_criar: respostaCriar } })
    const r = await m.ferramenta('definir_foto_item', { item_id: ITEM_A, imagem_url: 'https://cdn.exemplo.com/poke.jpg' })
    assert.equal(r.erro, false, r.texto)
    assert.match(r.texto, /PROPOSTA criada.*Poke.*800x600/)
    const up = m.storage.find((x) => x.op === 'upload')!
    assert.equal(up.args[0], 'cardapio-fotos')
    assert.match(String(up.args[1]), new RegExp(`^${BARRACA}/pendente/[0-9a-f-]{36}\\.png$`))
    assert.deepEqual(up.args[3], { contentType: 'image/png', upsert: false }, 'o tipo vem dos bytes, não do Content-Type')
    const criar = m.rpcs.find((x) => x.nome === 'mcp_proposta_criar')!
    assert.equal(criar.args.p_tipo, 'foto')
    assert.equal(criar.args.p_item_id, ITEM_A)
    const d = criar.args.p_dados as Linha
    assert.equal(d.pendente, up.args[1])
    assert.match(String(d.destino), new RegExp(`^${BARRACA}/${ITEM_A}-[0-9a-f]{16}\\.png$`))
    assert.equal(d.destino_url, `https://x.supabase.co/storage/v1/object/public/cardapio-fotos/${d.destino}`)
    assert.deepEqual([d.bytes, d.largura, d.altura], [33, 800, 600])
    assert.deepEqual(m.escritas, [])
    assert.equal(m.storage.some((x) => x.op === 'copy'), false)
  })

  test('endereços perigosos e nomes que resolvem para dentro: recusados antes de qualquer rede', async () => {
    let chamadas = 0
    const fetchFn = async () => (chamadas++, new Response(png(1, 1)))
    const m = montar({ fetchFn, resolverDns: async (h) => (h === 'rebind.exemplo.com' ? ['10.0.0.9'] : ['93.184.216.34']) })
    for (const url of [
      'http://cdn.exemplo.com/a.jpg', 'https://localhost/a.jpg', 'https://127.0.0.1/a.jpg', 'https://169.254.169.254/latest/meta-data',
      'https://[::1]/a.jpg', 'https://rebind.exemplo.com/a.jpg', 'https://u:p@cdn.exemplo.com/a.jpg', 'data:image/png;base64,AAAA', 'file:///etc/passwd', '', 42,
    ]) {
      const r = await m.ferramenta('definir_foto_item', { item_id: ITEM_A, imagem_url: url })
      assert.equal(r.erro, true, String(url))
    }
    assert.equal(chamadas, 0)
    assert.equal(m.storage.length, 0)
    assert.equal(m.rpcs.length, 0)
  })

  test('falha ao consultar o DNS (mesmo que só A ou só AAAA) recusa o download', async () => {
    let chamadas = 0
    const m = montar({ fetchFn: async () => (chamadas++, new Response(png(1, 1))), resolverDns: async () => { throw new Error('SERVFAIL') } })
    const r = await m.ferramenta('definir_foto_item', { item_id: ITEM_A, imagem_url: 'https://cdn.exemplo.com/a.jpg' })
    assert.equal(r.erro, true)
    assert.equal(chamadas, 0)
  })

  test('item de outra barraca ou inexistente: nem baixa a imagem', async () => {
    let chamadas = 0
    const m = montar({ fetchFn: async () => (chamadas++, new Response(png(1, 1))), resolverDns: dns })
    assert.match((await m.ferramenta('definir_foto_item', { item_id: ITEM_B, imagem_url: 'https://cdn.exemplo.com/a.jpg' })).texto, /não encontrado/)
    assert.equal((await m.ferramenta('definir_foto_item', { item_id: 'x', imagem_url: 'https://cdn.exemplo.com/a.jpg' })).erro, true)
    assert.equal(chamadas, 0)
  })

  test('não é imagem, grande demais ou sem DNS configurado: recusa sem guardar nada', async () => {
    const html = montar({ fetchFn: async () => new Response('<html>'.padEnd(64, ' '), { headers: { 'content-type': 'image/jpeg' } }), resolverDns: dns })
    assert.equal((await html.ferramenta('definir_foto_item', { item_id: ITEM_A, imagem_url: 'https://cdn.exemplo.com/a.jpg' })).erro, true)
    const grande = montar({ fetchFn: async () => new Response(png(100, 100), { headers: { 'content-length': String(6 * 1024 * 1024) } }), resolverDns: dns })
    assert.equal((await grande.ferramenta('definir_foto_item', { item_id: ITEM_A, imagem_url: 'https://cdn.exemplo.com/a.jpg' })).erro, true)
    const semDns = montar({ fetchFn: imagem() })
    assert.equal((await semDns.ferramenta('definir_foto_item', { item_id: ITEM_A, imagem_url: 'https://cdn.exemplo.com/a.jpg' })).erro, true)
    for (const m of [html, grande, semDns]) assert.equal(m.storage.length, 0)
  })

  test('proposta recusada pelo banco desfaz o arquivo pendente', async () => {
    const m = montar({ fetchFn: imagem(), resolverDns: dns, respostas: { mcp_proposta_criar: { estado: 'muitas_pendentes' } } })
    const r = await m.ferramenta('definir_foto_item', { item_id: ITEM_A, imagem_url: 'https://cdn.exemplo.com/a.jpg' })
    assert.equal(r.erro, true)
    const up = m.storage.find((x) => x.op === 'upload')!
    assert.deepEqual(m.storage.find((x) => x.op === 'remove')!.args, [[up.args[1]]])
  })

  const pendente = `${BARRACA}/pendente/${UUID_PEND}.png`
  const destino = `${BARRACA}/${ITEM_A}-0123456789abcdef.png`
  const antiga = `${BARRACA}/${ITEM_A}-1700000000000.jpg`
  const prep = { estado: 'ok', tipo: 'foto', pendente, destino }

  test('aplicar: copia para o destino, aplica no banco e só então apaga o pendente e a foto antiga', async () => {
    const m = montar({ respostas: { mcp_foto_preparar: prep, mcp_proposta_aplicar: { estado: 'ok', tipo: 'foto', nome: 'Poke', foto_antiga_url: `https://x.supabase.co/storage/v1/object/public/cardapio-fotos/${antiga}` } } })
    const r = await m.ferramenta('definir_foto_item', { proposta_id: PROPOSTA })
    assert.match(r.texto, /foto de Poke foi trocada/)
    assert.deepEqual(m.rpcs.map((x) => x.nome), ['mcp_foto_preparar', 'mcp_proposta_aplicar'])
    assert.deepEqual(m.rpcs[1].args, { p_token_id: 't1', p_proposta_id: PROPOSTA, p_tipo_esperado: 'foto' })
    assert.deepEqual(m.storage.map((x) => x.op), ['copy', 'remove'])
    assert.deepEqual(m.storage[0].args, [pendente, destino])
    assert.deepEqual(m.storage[1].args, [[pendente, antiga]])
  })

  test('só apaga como "antiga" foto de ITEM desta barraca: banner, capa e arquivo alheio ficam', async () => {
    for (const caminho of [`${BARRACA}/banners/1.jpg`, `${BARRACA}/capa-1.jpg`, `bB/${ITEM_B}-1.jpg`, `${BARRACA}/../bB/${ITEM_B}-1.jpg`, `${BARRACA}/${ITEM_A}-1.jpg/../../x`]) {
      const m = montar({ respostas: { mcp_foto_preparar: prep, mcp_proposta_aplicar: { estado: 'ok', tipo: 'foto', nome: 'Poke', foto_antiga_url: `https://x.supabase.co/storage/v1/object/public/cardapio-fotos/${caminho}` } } })
      await m.ferramenta('definir_foto_item', { proposta_id: PROPOSTA })
      assert.deepEqual(m.storage.at(-1)!.args, [[pendente]], caminho)
    }
  })

  test('aplicar recusado pelo banco NÃO apaga o destino (outra chamada pode tê-lo aplicado); sem aprovação nem copia', async () => {
    const m = montar({ respostas: { mcp_foto_preparar: prep, mcp_proposta_aplicar: { estado: 'item_mudou', tipo: 'foto' } } })
    assert.equal((await m.ferramenta('definir_foto_item', { proposta_id: PROPOSTA })).erro, true)
    assert.deepEqual(m.storage.map((x) => x.op), ['copy'])

    const sem = montar({ respostas: { mcp_foto_preparar: { estado: 'aguardando_aprovacao', tipo: 'foto' } } })
    assert.match((await sem.ferramenta('definir_foto_item', { proposta_id: PROPOSTA })).texto, /NÃO aprovou/)
    assert.equal(sem.storage.length, 0)

    const jaFoi = montar({ respostas: { mcp_foto_preparar: { estado: 'ja_aplicada', tipo: 'foto' } } })
    assert.equal((await jaFoi.ferramenta('definir_foto_item', { proposta_id: PROPOSTA })).erro, false)
    assert.equal(jaFoi.storage.length, 0)
    assert.equal(jaFoi.rpcs.at(-1)!.nome, 'mcp_fotos_limpar_listar', 'repetir a aplicação retoma a limpeza')

    const outraBarraca = montar({ respostas: { mcp_foto_preparar: { ...prep, pendente: `bB/pendente/${UUID_PEND}.png` } } })
    assert.equal((await outraBarraca.ferramenta('definir_foto_item', { proposta_id: PROPOSTA })).erro, true)
    assert.equal(outraBarraca.storage.length, 0)

    const semCopia = montar({ falhaCopia: 'storage fora', respostas: { mcp_foto_preparar: prep } })
    assert.equal((await semCopia.ferramenta('definir_foto_item', { proposta_id: PROPOSTA })).erro, true)
    assert.equal(semCopia.rpcs.some((x) => x.nome === 'mcp_proposta_aplicar'), false)

    const jaCopiado = montar({ falhaCopia: 'The resource already exists', respostas: { mcp_foto_preparar: prep, mcp_proposta_aplicar: { estado: 'ok', tipo: 'foto', nome: 'Poke', foto_antiga_url: null } } })
    assert.equal((await jaCopiado.ferramenta('definir_foto_item', { proposta_id: PROPOSTA })).erro, false)
  })

  test('limpeza de pendentes só remove caminhos pendente/ desta barraca', async () => {
    const m = montar({
      fetchFn: imagem(), resolverDns: dns,
      respostas: {
        mcp_proposta_criar: respostaCriar,
        mcp_fotos_limpar_listar: [
          { id: 'p1', pendente: `${BARRACA}/pendente/${UUID_PEND}.jpg`, destino: `${BARRACA}/${ITEM_A}-0123456789abcdef.jpg`, antiga: `https://x.supabase.co/storage/v1/object/public/cardapio-fotos/${BARRACA}/${ITEM_A}-1700000000000.jpg` },
          { id: 'p2', pendente: 'bB/pendente/x.jpg', destino: `bB/${ITEM_B}-0123456789abcdef.jpg`, antiga: null },
          { id: 'p3', pendente: `${BARRACA}/${ITEM_A}-1.jpg`, destino: `${BARRACA}/banners/1.jpg`, antiga: `https://x.supabase.co/storage/v1/object/public/cardapio-fotos/${BARRACA}/capa-1.jpg` },
        ] as unknown as Linha,
      },
    })
    await m.ferramenta('definir_foto_item', { item_id: ITEM_A, imagem_url: 'https://cdn.exemplo.com/a.jpg' })
    const remocoes = m.storage.filter((x) => x.op === 'remove').map((x) => x.args[0])
    assert.deepEqual(remocoes, [[`${BARRACA}/pendente/${UUID_PEND}.jpg`, `${BARRACA}/${ITEM_A}-0123456789abcdef.jpg`, `${BARRACA}/${ITEM_A}-1700000000000.jpg`]])
  })
})

describe('mcp-saiae: importar_cardapio_de_foto', () => {
  const item = (nome: string, preco: unknown, categoria?: string, descricao?: string) => ({ nome, preco, categoria, descricao })
  const ok = { estado: 'ok', proposta_id: PROPOSTA, tipo: 'cardapio', nome: 'Cardápio', total: 2, a_criar: 2, categorias_novas: ['Pastéis'], amostra: [{ categoria: 'Pastéis', nome: 'Pastel', preco_centavos: 850, descricao: null }] }

  test('valida como a planilha, manda só o que seria criado e devolve a prévia', async () => {
    const m = montar({
      categorias: [{ id: 'c1', barraca_id: 'bA', nome: 'Bebidas', ordem: 1 }],
      itensExtras: [{ id: '9', barraca_id: 'bA', nome: 'Suco de laranja', preco_centavos: 500, categoria_id: 'c1', ordem: 2 }],
      respostas: { mcp_proposta_criar: ok },
    })
    const r = await m.ferramenta('importar_cardapio_de_foto', {
      itens: [
        item('Pastel de carne', '8,50', 'Pastéis', 'Carne'),
        item('pastel de carne ', '9', 'Pasteis'), // repetido no envio
        item('SUCO DE LARANJA', '5', 'bebidas'), // já existe
        item('Água', '1.234', 'Bebidas'), // ambíguo
        item('', '5'),
        item('Caldo', 'grátis'),
        item('Pastel de queijo', 9, 'Pastéis'), // número vira "9"
        'lixo',
      ],
    })
    assert.equal(r.erro, false, r.texto)
    assert.match(r.texto, /PROPOSTA criada, nada foi cadastrado/)
    assert.match(r.texto, /"recusadas":4/)
    assert.match(r.texto, /"repetidas_no_envio":1/)
    assert.match(r.texto, /"ja_existiam":1/)
    assert.match(r.texto, /preço ambíguo/)
    assert.match(r.texto, new RegExp(PROPOSTA))
    assert.deepEqual(m.rpcs.at(-1), {
      nome: 'mcp_proposta_criar',
      args: {
        p_token_id: 't1', p_tipo: 'cardapio', p_item_id: null,
        p_dados: { itens: [
          { categoria: 'Pastéis', nome: 'Pastel de carne', preco_centavos: 850, descricao: 'Carne' },
          { categoria: 'Pastéis', nome: 'Pastel de queijo', preco_centavos: 900, descricao: null },
        ] },
      },
    })
    assert.deepEqual(m.escritas, [])
  })

  test('nada a criar, lista vazia ou grande demais: sem proposta', async () => {
    const m = montar({ itensExtras: [{ id: '9', barraca_id: 'bA', nome: 'Suco', preco_centavos: 500, categoria_id: null, ordem: 2 }] })
    const existe = await m.ferramenta('importar_cardapio_de_foto', { itens: [item('suco', '5')] })
    assert.match(existe.texto, /Nada a criar/)
    assert.equal(existe.erro, false)
    assert.equal((await m.ferramenta('importar_cardapio_de_foto', { itens: [item('', '')] })).erro, true)
    assert.equal((await m.ferramenta('importar_cardapio_de_foto', { itens: [] })).erro, true)
    assert.equal((await m.ferramenta('importar_cardapio_de_foto', { itens: 'x' })).erro, true)
    const muitos = Array.from({ length: 301 }, (_, i) => item(`Item ${i}`, '5'))
    assert.match((await m.ferramenta('importar_cardapio_de_foto', { itens: muitos })).texto, /máximo é 300/)
    assert.equal(m.rpcs.length, 0)
    const trezentos = montar({ respostas: { mcp_proposta_criar: ok } })
    assert.equal((await trezentos.ferramenta('importar_cardapio_de_foto', { itens: muitos.slice(0, 300) })).erro, false)
    assert.equal(((trezentos.rpcs.at(-1)!.args.p_dados as { itens: unknown[] }).itens).length, 300)
  })

  test('preço com mais de 30 caracteres é recusado, não cortado (zeros + 12 não vira R$ 1,00)', async () => {
    const m = montar({ respostas: { mcp_proposta_criar: ok } })
    const r = await m.ferramenta('importar_cardapio_de_foto', { itens: [item('Pastel', '0'.repeat(30) + '12')] })
    assert.equal(r.erro, true)
    assert.match(r.texto, /mais de 30 caracteres/)
    assert.equal(m.rpcs.length, 0)
  })

  test('corpo maior que o limite: 413 antes de decodificar', async () => {
    const m = montar()
    const r = await m.chamar({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'listar_itens', arguments: { x: 'a'.repeat(1_100_000) } } })
    assert.equal(r.status, 413)
    assert.equal(m.limites.length, 0)
  })

  test('só considera o cardápio da barraca do token (item e categoria de outra barraca não contam)', async () => {
    const m = montar({ itensExtras: [{ id: '9', barraca_id: 'bB', nome: 'Pastel', preco_centavos: 500, categoria_id: null, ordem: 2 }], respostas: { mcp_proposta_criar: ok } })
    await m.ferramenta('importar_cardapio_de_foto', { itens: [item('Pastel', '5')] })
    assert.equal(((m.rpcs.at(-1)!.args.p_dados as { itens: unknown[] }).itens).length, 1)
  })

  test('aplicar usa o tipo cardápio e relata o que foi feito', async () => {
    const m = montar({ respostas: { mcp_proposta_aplicar: { estado: 'ok', tipo: 'cardapio', criados: 5, categorias_criadas: 2, pulados: 3, total: 8 } } })
    const r = await m.ferramenta('importar_cardapio_de_foto', { proposta_id: PROPOSTA })
    assert.match(r.texto, /5 itens criados, 2 categorias novas, 3 pulados/)
    assert.deepEqual(m.rpcs.at(-1), { nome: 'mcp_proposta_aplicar', args: { p_token_id: 't1', p_proposta_id: PROPOSTA, p_tipo_esperado: 'cardapio' } })
  })
})
