// SAI-010a etapa 4d: opções no Lançar Pedido do operador (src/lib/opcoes.ts). Rodar: npm test
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  montarGruposDoOperador,
  precoUnitario,
  snapshotOpcoes,
  validarEscolhas,
  type GrupoLeitura,
  type LigacaoLeitura,
  type OpcaoLeitura,
} from '../src/lib/opcoes.ts'

const grupo = (over: Partial<GrupoLeitura>): GrupoLeitura => ({
  id: 'g-tam', nome: 'Tamanho', tipo: 'variacao', min_escolhas: 1, max_escolhas: 1, ordem: 0, ativo: true, ...over,
})
const opcao = (over: Partial<OpcaoLeitura>): OpcaoLeitura => ({
  id: 'o-p', grupo_id: 'g-tam', nome: 'Pequeno', preco_centavos: 800, ordem: 0, ativo: true, esgotado: false, ...over,
})
const lig = (item_id: string, grupo_id: string, ordem = 0): LigacaoLeitura => ({ item_id, grupo_id, ordem })

const GRUPOS = [grupo({}), grupo({ id: 'g-ext', nome: 'Extras', tipo: 'adicional', min_escolhas: 0, max_escolhas: null })]
const OPCOES = [
  opcao({}),
  opcao({ id: 'o-g', nome: 'Grande', preco_centavos: 1200, ordem: 1 }),
  opcao({ id: 'o-ovo', grupo_id: 'g-ext', nome: 'Ovo', preco_centavos: 200 }),
]
const LIGACOES = [lig('i1', 'g-ext', 1), lig('i1', 'g-tam', 0)]

describe('montarGruposDoOperador', () => {
  test('agrupa por item na ordem da ligação (variação primeiro)', () => {
    const grupos = montarGruposDoOperador(GRUPOS, OPCOES, LIGACOES).get('i1')!
    assert.deepEqual(grupos.map((g) => g.id), ['g-tam', 'g-ext'])
    assert.deepEqual(grupos[0].opcoes.map((o) => o.nome), ['Pequeno', 'Grande'])
  })

  test('ignora grupo e opção inativos', () => {
    const grupos = montarGruposDoOperador(
      [grupo({ ativo: false }), GRUPOS[1]],
      [...OPCOES, opcao({ id: 'o-x', grupo_id: 'g-ext', nome: 'Inativa', ativo: false })],
      LIGACOES,
    ).get('i1')!
    assert.deepEqual(grupos.map((g) => g.id), ['g-ext'])
    assert.deepEqual(grupos[0].opcoes.map((o) => o.nome), ['Ovo'])
  })

  test('grupo obrigatório sem opção disponível não trava o balcão', () => {
    const opcoes = OPCOES.map((o) => (o.grupo_id === 'g-tam' ? { ...o, esgotado: true } : o))
    const grupos = montarGruposDoOperador(GRUPOS, opcoes, LIGACOES).get('i1')!
    const tam = grupos.find((g) => g.id === 'g-tam')!
    assert.equal(tam.min, 0)
    assert.equal(validarEscolhas(grupos, []).ok, true)
  })

  test('grupo sem nenhuma opção ativa some (item vende simples)', () => {
    const mapa = montarGruposDoOperador(GRUPOS, [], [lig('i1', 'g-tam')])
    assert.equal(mapa.has('i1'), false)
  })

  test('obrigatório com opção disponível continua exigindo escolha', () => {
    const grupos = montarGruposDoOperador(GRUPOS, OPCOES, LIGACOES).get('i1')!
    assert.equal(validarEscolhas(grupos, []).ok, false)
    assert.equal(validarEscolhas(grupos, ['o-g']).ok, true)
  })
})

describe('snapshotOpcoes', () => {
  test('foto das escolhas com as chaves que o servidor aceita; variação substitui o preço', () => {
    const grupos = montarGruposDoOperador(GRUPOS, OPCOES, LIGACOES).get('i1')!
    const ids = ['o-ovo', 'o-g']
    assert.equal(precoUnitario(1000, grupos, ids), 1400)
    assert.deepEqual(snapshotOpcoes(grupos, ids), [
      { grupo_id: 'g-tam', grupo_nome: 'Tamanho', tipo: 'variacao', opcao_id: 'o-g', nome: 'Grande', preco_centavos: 1200, quantidade: 1 },
      { grupo_id: 'g-ext', grupo_nome: 'Extras', tipo: 'adicional', opcao_id: 'o-ovo', nome: 'Ovo', preco_centavos: 200, quantidade: 1 },
    ])
  })

  test('sem escolhas, snapshot vazio (payload igual ao de antes)', () => {
    const grupos = montarGruposDoOperador(GRUPOS, OPCOES, LIGACOES).get('i1')!
    assert.deepEqual(snapshotOpcoes(grupos, []), [])
  })
})
