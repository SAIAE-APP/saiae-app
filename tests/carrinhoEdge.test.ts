// SAI-010a etapa 3: lógica pura das edge functions do cardápio e do Pix (montar linhas para o
// resolver_carrinho, interpretar a resposta e traduzir em HTTP). Rodar: npm test
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  interpretarResolver,
  itensAcimaDoEstoque,
  montarLinhas,
  quantidadePorItem,
  respostaDeErros,
} from '../supabase/functions/_shared/carrinho.ts'

const A = '11000000-0000-4000-8000-000000000001'
const B = '11000000-0000-4000-8000-000000000002'
const O1 = 'd1000000-0000-4000-8000-000000000001'
const O2 = 'd1000000-0000-4000-8000-000000000002'
const LIM = { maxLinhas: 40, maxQuantidade: 50 }

describe('montarLinhas', () => {
  test('item simples: forma antiga (item_id + quantidade) continua valendo', () => {
    const r = montarLinhas([{ item_id: A, quantidade: 2 }], LIM)
    assert.deepEqual(r, { ok: true, linhas: [{ item_id: A, quantidade: 2, opcao_ids: [], observacao: null }] })
  })

  test('junta linhas idênticas somando a quantidade (comportamento de antes para itens simples)', () => {
    const r = montarLinhas([{ item_id: A, quantidade: 2 }, { item_id: B, quantidade: 1 }, { item_id: A, quantidade: 3 }], LIM)
    assert.ok(r.ok)
    assert.deepEqual(r.linhas.map((l) => [l.item_id, l.quantidade]), [[A, 5], [B, 1]])
  })

  test('mesmo item com opções diferentes ou observação diferente = linhas separadas', () => {
    const r = montarLinhas(
      [
        { item_id: A, quantidade: 1, opcao_ids: [O1] },
        { item_id: A, quantidade: 1, opcao_ids: [O2] },
        { item_id: A, quantidade: 1, opcao_ids: [O1], observacao: 'sem cebola' },
        { item_id: A, quantidade: 1 },
      ],
      LIM,
    )
    assert.ok(r.ok)
    assert.equal(r.linhas.length, 4)
  })

  test('a ordem das opções não importa para juntar; a quantidade soma', () => {
    const r = montarLinhas(
      [
        { item_id: A, quantidade: 1, opcao_ids: [O1, O2] },
        { item_id: A, quantidade: 2, opcao_ids: [O2, O1] },
      ],
      LIM,
    )
    assert.ok(r.ok)
    assert.equal(r.linhas.length, 1)
    assert.equal(r.linhas[0].quantidade, 3)
  })

  test('teto de quantidade só quando informado (cardápio 50; Pix sem teto)', () => {
    const cardapio = montarLinhas([{ item_id: A, quantidade: 40 }, { item_id: A, quantidade: 40 }], LIM)
    assert.ok(cardapio.ok)
    assert.equal(cardapio.linhas[0].quantidade, 50)
    const pix = montarLinhas([{ item_id: A, quantidade: 40 }, { item_id: A, quantidade: 40 }], { maxLinhas: 40, maxQuantidade: null })
    assert.ok(pix.ok)
    assert.equal(pix.linhas[0].quantidade, 80)
  })

  test('observação é aparada e limitada a 120; vazia ou não-string vira null', () => {
    const r = montarLinhas(
      [
        { item_id: A, quantidade: 1, observacao: `  ${'x'.repeat(300)}  ` },
        { item_id: B, quantidade: 1, observacao: '   ' },
        { item_id: A, quantidade: 1, observacao: 42 as unknown as string },
      ],
      LIM,
    )
    assert.ok(r.ok)
    assert.equal(r.linhas[0].observacao?.length, 120)
    assert.equal(r.linhas[1].observacao, null)
    assert.equal(r.linhas[2].observacao, null)
  })

  test('entradas inválidas => Itens inválidos', () => {
    const ruins: unknown[] = [
      undefined,
      null,
      [],
      'x',
      { item_id: A },
      [null],
      ['x'],
      [{ item_id: A }],
      [{ item_id: A, quantidade: 0 }],
      [{ item_id: A, quantidade: -3 }],
      [{ item_id: A, quantidade: 'abc' }],
      [{ item_id: 123, quantidade: 1 }],
      [{ item_id: '', quantidade: 1 }],
      [{ item_id: A, quantidade: 1, opcao_ids: 'x' }],
      [{ item_id: A, quantidade: 1, opcao_ids: [1, 2] }],
      [{ item_id: A, quantidade: 1, opcao_ids: Array.from({ length: 21 }, () => O1) }],
      Array.from({ length: 41 }, () => ({ item_id: A, quantidade: 1 })),
    ]
    for (const entrada of ruins) {
      assert.deepEqual(montarLinhas(entrada, LIM), { ok: false, erro: 'Itens inválidos' }, JSON.stringify(entrada))
    }
  })

  test('opcao_ids null/ausente = sem opções; o cliente não consegue injetar preço', () => {
    const r = montarLinhas([{ item_id: A, quantidade: 1, opcao_ids: null, preco_centavos_unitario: 1, preco: 1 } as never], LIM)
    assert.ok(r.ok)
    assert.deepEqual(Object.keys(r.linhas[0]).sort(), ['item_id', 'observacao', 'opcao_ids', 'quantidade'])
  })
})

describe('interpretarResolver', () => {
  const boa = {
    ok: true,
    total_centavos: 4400,
    linhas: [{ item_id: A, nome_item: 'X', quantidade: 2, preco_centavos_unitario: 2200, opcoes: [], observacao: null }],
  }

  test('aceita sucesso e erro bem formados', () => {
    assert.deepEqual(interpretarResolver(boa), boa)
    const erro = { ok: false, erros: [{ linha: 0, item_id: A, codigo: 'grupo_minimo', mensagem: 'm' }] }
    assert.deepEqual(interpretarResolver(erro), erro)
  })

  test('rejeita formas inesperadas (null, vazio, total fora do lugar, preço não inteiro)', () => {
    for (const ruim of [
      null,
      undefined,
      'x',
      {},
      { ok: true },
      { ok: true, linhas: [], total_centavos: 0 },
      { ok: true, linhas: boa.linhas },
      { ok: true, linhas: [{ ...boa.linhas[0], preco_centavos_unitario: 22.5 }], total_centavos: 1 },
      { ok: true, linhas: [{ ...boa.linhas[0], opcoes: 'x' }], total_centavos: 1 },
      { ok: false },
      { ok: false, erros: [] },
    ]) {
      assert.equal(interpretarResolver(ruim), null, JSON.stringify(ruim))
    }
  })
})

describe('respostaDeErros', () => {
  const e = (codigo: string, mensagem = codigo) => ({ linha: 0, item_id: A, codigo, mensagem })

  test('carrinho malformado => 400 genérico', () => {
    for (const c of ['carrinho_invalido', 'item_invalido', 'quantidade_invalida', 'muitas_opcoes', 'opcao_duplicada']) {
      assert.deepEqual(respostaDeErros([e(c)]), { status: 400, erro: 'Itens inválidos' })
    }
  })

  test('barraca inexistente => 404', () => {
    assert.deepEqual(respostaDeErros([e('barraca_invalida')]), { status: 404, erro: 'Barraca não encontrada' })
  })

  test('indisponibilidade e regras de grupo => 422 com a mensagem do banco (sem duplicar)', () => {
    const r = respostaDeErros([
      e('item_indisponivel', 'Yakisoba está indisponível.'),
      e('grupo_minimo', 'Escolha pelo menos 1 em "Tamanho".'),
      e('grupo_minimo', 'Escolha pelo menos 1 em "Tamanho".'),
    ])
    assert.equal(r.status, 422)
    assert.equal(r.erro, 'Yakisoba está indisponível.; Escolha pelo menos 1 em "Tamanho".')
  })

  test('mistura de malformado e indisponível => 422 (informa o que o cliente pode corrigir)', () => {
    assert.equal(respostaDeErros([e('item_invalido'), e('item_indisponivel', 'Fora.')]).status, 422)
  })
})

describe('estoque por item', () => {
  const linhas = [
    { item_id: A, nome_item: 'Yaki', quantidade: 2 },
    { item_id: A, nome_item: 'Yaki', quantidade: 2 }, // mesma comida, opções diferentes
    { item_id: B, nome_item: 'Refri', quantidade: 1 },
  ]

  test('soma as linhas do mesmo item antes de comparar com o saldo', () => {
    assert.equal(quantidadePorItem(linhas).get(A)?.quantidade, 4)
    const acima = itensAcimaDoEstoque(linhas, new Map([[A, 3], [B, 10]]))
    assert.deepEqual(acima, ['Yaki: restam 3'])
  })

  test('saldo zero/negativo => sem estoque; saldo desconhecido (null) nunca bloqueia', () => {
    assert.deepEqual(itensAcimaDoEstoque(linhas, new Map([[A, 0], [B, -2]])), ['Yaki: sem estoque', 'Refri: sem estoque'])
    assert.deepEqual(itensAcimaDoEstoque(linhas, new Map([[A, null]])), [])
    assert.deepEqual(itensAcimaDoEstoque(linhas, new Map()), [])
  })
})
