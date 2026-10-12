/* eslint-disable @typescript-eslint/no-explicit-any -- banco simulado dos testes */
// Gravação da importação do cardápio EXECUTADA contra um banco simulado (a RLS é o caminho real; aqui se confere a
// lógica: categorias sem duplicar, ordem sequencial, lotes, falha parcial e repetibilidade). Rodar: npm test
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  ErroImportacaoCardapio,
  carregarCardapioExistenteCom,
  gravarCardapioImportadoCom,
} from '../src/lib/cardapioImportacaoNucleo.ts'
import { TAMANHO_LOTE_ITENS, validarCardapio, type CardapioExistente, type ItemParaCriar } from '../src/lib/importarCardapio.ts'

type Linha = Record<string, any>
class BancoSimulado {
  categorias: Linha[] = []
  itens: Linha[] = []
  insertsDeItens: Linha[][] = []
  /** Falha o insert de itens quando o nº do lote (1-based) chega aqui. */
  falharNoLote: number | null = null
  private seq = 0

  from(tabela: 'categorias' | 'itens') {
    const dados = () => (tabela === 'categorias' ? this.categorias : this.itens)
    const st = { op: 'select' as 'select' | 'insert', linhas: [] as Linha[], filtros: [] as Array<(r: Linha) => boolean>, faixa: null as [number, number] | null, retorna: false }
    const b: any = {
      select: () => { if (st.op === 'insert') st.retorna = true; return b },
      insert: (linhas: Linha[]) => { st.op = 'insert'; st.linhas = linhas; return b },
      eq: (c: string, v: unknown) => { st.filtros.push((r) => r[c] === v); return b },
      order: () => b,
      range: (a: number, z: number) => { st.faixa = [a, z]; return b },
      then: (ok: (v: any) => unknown, err?: (e: unknown) => unknown) => Promise.resolve(exec()).then(ok, err),
    }
    const exec = () => {
      if (st.op === 'insert') {
        if (tabela === 'itens') {
          this.insertsDeItens.push(st.linhas)
          if (this.falharNoLote === this.insertsDeItens.length) return { data: null, error: { message: 'queda de rede simulada' } }
        }
        const novas = st.linhas.map((l) => ({ id: `${tabela}-${++this.seq}`, ...l }))
        dados().push(...novas)
        return { data: st.retorna ? novas.map((n) => ({ id: n.id, nome: n.nome })) : null, error: null }
      }
      let r = dados().filter((x) => st.filtros.every((f) => f(x)))
      if (st.faixa) r = r.slice(st.faixa[0], st.faixa[1] + 1)
      return { data: r, error: null }
    }
    return b
  }
}

const item = (nome: string, categoria: string | null, extra: Partial<ItemParaCriar> = {}): ItemParaCriar => ({
  linha: 2,
  categoria,
  categoriaChave: categoria ? categoria.toLowerCase() : null,
  nome,
  precoCentavos: 500,
  descricao: null,
  ativo: true,
  precoAberto: false,
  ...extra,
})

describe('gravarCardapioImportadoCom', () => {
  test('cria só as categorias que faltam, depois dos existentes; itens com ordem sequencial depois dos existentes', async () => {
    const db = new BancoSimulado()
    db.categorias.push({ id: 'c-bebidas', barraca_id: 'b1', nome: 'Bebidas', ordem: 4 })
    db.itens.push({ id: 'i0', barraca_id: 'b1', nome: 'Velho', categoria_id: null, ordem: 7 })
    const existente = await carregarCardapioExistenteCom(db, 'b1')
    const resumo = await gravarCardapioImportadoCom(db, 'b1', existente, [
      item('Suco', 'Bebidas'),
      item('Pastel', 'Pastéis'),
      item('Pastel de queijo', 'Pastéis'),
      item('Combo', null),
    ])
    assert.deepEqual(resumo, { itensCriados: 4, categoriasCriadas: 1 })
    const novaCat = db.categorias.find((c) => c.nome === 'Pastéis')!
    assert.equal(novaCat.ordem, 5)
    assert.equal(db.categorias.length, 2, 'Bebidas não foi duplicada')
    const novos = db.itens.filter((i) => i.nome !== 'Velho')
    assert.deepEqual(novos.map((i) => i.ordem), [8, 9, 10, 11])
    assert.deepEqual(novos.map((i) => i.categoria_id), ['c-bebidas', novaCat.id, novaCat.id, null])
    assert.ok(novos.every((i) => i.barraca_id === 'b1'))
    assert.equal(db.itens.find((i) => i.id === 'i0')!.nome, 'Velho', 'nada existente foi alterado')
  })

  test('só manda preco_aberto quando é true; fiscal, foto e estoque ficam fora do insert', async () => {
    const db = new BancoSimulado()
    await gravarCardapioImportadoCom(db, 'b1', { categorias: [], itens: [] }, [
      item('Livre', null, { precoAberto: true, precoCentavos: 0 }),
      item('Normal', null),
    ])
    const [livre, normal] = db.itens
    assert.equal(livre.preco_aberto, true)
    assert.equal(livre.preco_centavos, 0)
    assert.equal('preco_aberto' in normal, false)
    for (const campo of ['ncm', 'cfop', 'unidade_comercial', 'foto_url', 'estoque_qtd', 'popular', 'esgotado']) {
      assert.equal(campo in normal, false, campo)
    }
  })

  test('lotes de 100 e progresso', async () => {
    const db = new BancoSimulado()
    const muitos = Array.from({ length: 250 }, (_, i) => item(`Item ${i}`, null))
    const progresso: number[] = []
    await gravarCardapioImportadoCom(db, 'b1', { categorias: [], itens: [] }, muitos, (feitos) => progresso.push(feitos))
    assert.deepEqual(db.insertsDeItens.map((l) => l.length), [TAMANHO_LOTE_ITENS, TAMANHO_LOTE_ITENS, 50])
    assert.deepEqual(progresso, [100, 200, 250])
    assert.deepEqual(db.itens.map((i) => i.ordem), Array.from({ length: 250 }, (_, i) => i + 1))
  })

  test('falha no meio: erro traz o que já foi gravado; importar de novo completa sem duplicar', async () => {
    const db = new BancoSimulado()
    const todos = Array.from({ length: 250 }, (_, i) => item(`Item ${i}`, i % 2 === 0 ? 'Salgados' : 'Doces'))
    db.falharNoLote = 2
    await assert.rejects(
      async () => gravarCardapioImportadoCom(db, 'b1', { categorias: [], itens: [] }, todos),
      (e: unknown) => {
        assert.ok(e instanceof ErroImportacaoCardapio)
        assert.match(e.message, /queda de rede/)
        assert.deepEqual(e.parcial, { itensCriados: 100, categoriasCriadas: 2 })
        return true
      },
    )
    assert.equal(db.itens.length, 100)

    // Segunda tentativa: relê o banco, valida de novo (os 100 viram "já existem") e grava só o resto.
    db.falharNoLote = null
    const existente = await carregarCardapioExistenteCom(db, 'b1')
    const linhas = todos.map((t, i) => ({ linha: i + 2, celulas: [t.categoria ?? '', t.nome, '5,00'] }))
    const v = validarCardapio(linhas, { categoria: 0, nome: 1, preco: 2, descricao: -1, ativo: -1, precoAberto: -1 }, existente)
    assert.equal(v.jaExistiam, 100)
    assert.equal(v.paraCriar.length, 150)
    assert.deepEqual(v.categoriasNovas, [], 'as 2 categorias já existiam')
    const r2 = await gravarCardapioImportadoCom(db, 'b1', existente, v.paraCriar)
    assert.deepEqual(r2, { itensCriados: 150, categoriasCriadas: 0 })
    assert.equal(db.itens.length, 250)
    assert.equal(new Set(db.itens.map((i) => i.nome)).size, 250, 'nenhum nome duplicado')
    assert.equal(db.categorias.length, 2)
    assert.equal(new Set(db.itens.map((i) => i.ordem)).size, 250, 'ordem sem repetição')
  })

  test('importar o mesmo arquivo duas vezes: a 2ª não cria nada', async () => {
    const db = new BancoSimulado()
    const linhas = [
      { linha: 2, celulas: ['Pastéis', 'Pastel', '8'] },
      { linha: 3, celulas: ['', 'Combo', '20'] },
    ]
    const cols = { categoria: 0, nome: 1, preco: 2, descricao: -1, ativo: -1, precoAberto: -1 }
    for (const rodada of [1, 2]) {
      const existente = await carregarCardapioExistenteCom(db, 'b1')
      const v = validarCardapio(linhas, cols, existente)
      assert.equal(v.paraCriar.length, rodada === 1 ? 2 : 0)
      assert.equal(v.jaExistiam, rodada === 1 ? 0 : 2)
      if (v.paraCriar.length > 0) await gravarCardapioImportadoCom(db, 'b1', existente, v.paraCriar)
    }
    assert.equal(db.itens.length, 2)
    assert.equal(db.categorias.length, 1)
  })

  test('erro ao criar categorias: nada de item é gravado', async () => {
    const db = new BancoSimulado()
    const origem = db.from.bind(db)
    db.from = ((t: 'categorias' | 'itens') => {
      const b = origem(t)
      if (t === 'categorias') b.insert = () => ({ select: () => Promise.resolve({ data: null, error: { message: 'sem permissão' } }) })
      return b
    }) as any
    await assert.rejects(
      gravarCardapioImportadoCom(db, 'b1', { categorias: [], itens: [] }, [item('A', 'Nova')]),
      (e: unknown) => e instanceof ErroImportacaoCardapio && /sem permissão/.test(e.message) && e.parcial.itensCriados === 0,
    )
    assert.equal(db.itens.length, 0)
  })
})

describe('carregarCardapioExistenteCom', () => {
  test('pagina além de 1000 linhas e filtra pela barraca', async () => {
    const db = new BancoSimulado()
    for (let i = 0; i < 1500; i++) db.itens.push({ id: `i${i}`, barraca_id: 'b1', nome: `N${i}`, categoria_id: null, ordem: i })
    db.itens.push({ id: 'outro', barraca_id: 'b2', nome: 'De outra barraca', categoria_id: null, ordem: 1 })
    const e: CardapioExistente = await carregarCardapioExistenteCom(db, 'b1')
    assert.equal(e.itens.length, 1500)
    assert.ok(!e.itens.some((i) => i.nome === 'De outra barraca'))
  })
})
