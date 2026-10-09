// H2: o cliente de entrega salvo no 1º pedido precisa aparecer no 2º, e a falha ao salvar não pode mais ser silenciosa.
// A tabela, o trigger do telefone e o upsert rodam de verdade no PGlite (migrations reais); a busca usa o MESMO plano
// (clientesBusca.ts) que o app manda ao banco. Rodar: npm test
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { after, before, describe, test } from 'node:test'
import { PGlite } from '@electric-sql/pglite'
import { nomeCasa, planoDeBusca } from '../src/lib/clientesBusca.ts'
import { normalizarTelefone } from '../src/lib/entrega.ts'
import { salvarClienteComReenvio } from '../src/lib/salvarClienteComReenvio.ts'

const sql = (n: string) => readFileSync(new URL(`../supabase/migrations/${n}`, import.meta.url), 'utf8')
const B1 = 'b1000000-0000-4000-8000-000000000001'

let db: PGlite

/** Mesmo que `salvarClienteFinal`: upsert por (barraca, telefone) com o telefone normalizado no app. */
async function salvar(d: { nome: string; telefone: string; rua: string; numero: string; bairro: string; referencia?: string | null }) {
  await db.query(
    `insert into public.clientes_finais (barraca_id, nome, telefone, rua, numero, bairro, referencia)
     values ($1, $2, $3, $4, $5, $6, $7)
     on conflict (barraca_id, telefone) do update
       set nome = excluded.nome, rua = excluded.rua, numero = excluded.numero, bairro = excluded.bairro, referencia = excluded.referencia`,
    [B1, d.nome.trim(), normalizarTelefone(d.telefone), d.rua.trim(), d.numero.trim(), d.bairro.trim(), d.referencia?.trim() || null],
  )
}

/** Mesmo que `buscarClientesFinais`: aplica o plano ao banco e corta com `nomeCasa`. */
async function buscar(termo: string): Promise<string[]> {
  const plano = planoDeBusca(termo)
  if (plano.tipo === 'vazio') return []
  if (plano.tipo === 'telefone') {
    const r = await db.query<{ nome: string }>(
      `select nome from public.clientes_finais where barraca_id = $1 and telefone like any($2) order by nome limit 5`,
      [B1, plano.padroes],
    )
    return r.rows.map((x) => x.nome)
  }
  const r = await db.query<{ nome: string }>(
    `select nome from public.clientes_finais where barraca_id = $1 and nome ilike $2 order by nome limit 30`,
    [B1, plano.padrao],
  )
  return r.rows.map((x) => x.nome).filter((n) => nomeCasa(n, plano.palavras)).slice(0, 5)
}

before(async () => {
  db = new PGlite()
  await db.exec(`
    create role authenticated;
    create table public.barracas (id uuid primary key);
    create table public.pedidos (id uuid primary key default gen_random_uuid(), barraca_id uuid);
    create function public.usuario_tem_acesso_barraca(b uuid) returns boolean language sql stable as $$ select true $$;
    insert into public.barracas values ('${B1}');
  `)
  await db.exec(sql('20261004130000_entrega_taxa_clientes.sql'))
  await db.exec(sql('20261004150000_clientes_finais_telefone_normalizado.sql'))
  await db.exec('alter table public.clientes_finais alter column rua drop not null, alter column numero drop not null, alter column bairro drop not null')
})
after(async () => {
  await db.close()
})

describe('pedido 1 → pedido 2 encontra o cliente', () => {
  before(async () => {
    await salvar({ nome: 'João da Silva', telefone: '(11) 91234-5678', rua: 'Rua das Flores', numero: '10', bairro: 'Centro' })
    await salvar({ nome: 'Maria Conceição', telefone: '+55 21 98888-7777', rua: 'Av. Brasil', numero: '200', bairro: 'Penha' })
  })

  test('pelo telefone, em qualquer formato que o operador digite (máscara, +55, 55 colado, só o começo)', async () => {
    for (const digitado of ['(11) 91234-5678', '11912345678', '11 91234', '5511912345678', '+55 11 91234-5678', '55 11 9123', '91234']) {
      assert.deepEqual(await buscar(digitado), ['João da Silva'], digitado)
    }
    assert.deepEqual(await buscar('21 98888'), ['Maria Conceição'])
  })

  test('pelo nome, sem acento, em minúsculo ou maiúsculo (antes "joao" não achava "João")', async () => {
    for (const digitado of ['joao', 'JOAO', 'João', 'joão da', 'jo']) {
      assert.deepEqual(await buscar(digitado), ['João da Silva'], digitado)
    }
    assert.deepEqual(await buscar('conceicao'), ['Maria Conceição'])
    assert.deepEqual(await buscar('maria conceicao'), ['Maria Conceição'])
  })

  test('nome em partes: pula palavra do meio, mas respeita a ordem', async () => {
    assert.deepEqual(await buscar('joao silva'), ['João da Silva'])
    assert.deepEqual(await buscar('silva joao'), [])
  })

  test('regressão: o `ilike` simples de antes NÃO achava o cliente com acento', async () => {
    const r = await db.query(`select 1 from public.clientes_finais where barraca_id = $1 and nome ilike '%joao%'`, [B1])
    assert.equal(r.rows.length, 0, 'este é o defeito reproduzido: busca sem acento não casa com João')
  })

  test('termo curto demais não consulta; o curinga do like digitado não vira curinga', async () => {
    assert.deepEqual(await buscar('a'), [])
    assert.deepEqual(await buscar('123'), [])
    assert.deepEqual(await buscar('%'), [])
    assert.deepEqual(await buscar('j%'), [])
  })
})

describe('cadastro repetido', () => {
  test('o mesmo telefone em formatos diferentes é UM cliente (atualiza, não duplica)', async () => {
    await salvar({ nome: 'Carlos', telefone: '31 95555-4444', rua: 'R. A', numero: '1', bairro: 'B' })
    await salvar({ nome: 'Carlos Souza', telefone: '+55 (31) 95555-4444', rua: 'R. B', numero: '2', bairro: 'B' })
    const r = await db.query<{ nome: string; rua: string }>(`select nome, rua from public.clientes_finais where telefone = '31955554444'`)
    assert.deepEqual(r.rows, [{ nome: 'Carlos Souza', rua: 'R. B' }])
    assert.deepEqual(await buscar('carlos'), ['Carlos Souza'])
  })
})

describe('falha ao salvar o cliente: visível e reenviada', () => {
  test('salvou: nada a avisar nem enfileirar', async () => {
    const eventos: string[] = []
    const r = await salvarClienteComReenvio({
      salvar: async () => { eventos.push('salvar') },
      enfileirar: async () => { eventos.push('enfileirar') },
      avisar: () => { eventos.push('avisar') },
    })
    assert.equal(r, 'salvo')
    assert.deepEqual(eventos, ['salvar'])
  })

  test('falhou: avisa o operador e enfileira o reenvio', async () => {
    const eventos: string[] = []
    const r = await salvarClienteComReenvio({
      salvar: async () => { throw new Error('rede') },
      enfileirar: async () => { eventos.push('enfileirar') },
      avisar: () => { eventos.push('avisar') },
    })
    assert.equal(r, 'na_fila')
    assert.deepEqual(eventos, ['avisar', 'enfileirar'])
  })

  test('nunca lança: aviso que quebra não impede o reenvio; fila que quebra vira "perdido"', async () => {
    let enfileirou = false
    assert.equal(await salvarClienteComReenvio({
      salvar: async () => { throw new Error('x') },
      enfileirar: async () => { enfileirou = true },
      avisar: () => { throw new Error('toast') },
    }), 'na_fila')
    assert.equal(enfileirou, true)
    assert.equal(await salvarClienteComReenvio({
      salvar: async () => { throw new Error('x') },
      enfileirar: async () => { throw new Error('idb') },
      avisar: () => {},
    }), 'perdido')
  })
})

describe('fila de sincronização (guardas estáticas)', () => {
  const ler = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
  const sync = ler('hooks/useSincronizacao.ts')

  test('o erro de salvar o cliente não vai mais só para o console', () => {
    assert.doesNotMatch(sync, /salvarClienteFinal\(barracaId, entrega\)\.catch/)
    assert.match(sync, /salvarClienteComReenvio\(\{/)
    assert.match(sync, /enfileirar\('salvar_cliente'/)
    assert.match(sync, /EVENTO_CLIENTE_NAO_SALVO/)
  })

  test('a operação salvar_cliente é adiada (não trava os pedidos) e desiste depois de várias tentativas', () => {
    const caso = sync.slice(sync.indexOf("case 'salvar_cliente'"), sync.indexOf("case 'mudar_status'"))
    assert.match(caso, /throw new OperacaoAdiadaError\(/)
    assert.match(caso, /op\.tentativas >= MAX_TENTATIVAS_CLIENTE/)
  })

  test('operação criada durante a rodada agenda nova tentativa', () => {
    assert.match(sync, /if \(!falhou && \(await listarPendentes\(\)\)\.length > 0\) falhou = true/)
  })

  test('o layout mostra o aviso ao operador', () => {
    const layout = ler('layouts/LayoutBarraca.tsx')
    assert.match(layout, /addEventListener\(EVENTO_CLIENTE_NAO_SALVO/)
    assert.match(layout, /ainda não foi salvo no cadastro/)
  })
})
