// Revisar cardápio de exemplo (kits iniciais, PR 5): lógica pura e fiação. Rodar: npm test
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'
import { centavosParaCampo, itensSemPreco, montarPlano, podeSalvar, type LinhaItemRevisao, type LinhaOpcaoRevisao } from '../src/lib/revisarKit.ts'
import { rotaDoItemChecklist } from '../src/lib/onboardingConfig.ts'

const item = (p: Partial<LinhaItemRevisao> = {}): LinhaItemRevisao => ({ id: 'i1', nome: 'Burger', categoria: 'Hambúrgueres', precoTexto: '', usar: false, variacaoId: null, ...p })
const opcao = (p: Partial<LinhaOpcaoRevisao> = {}): LinhaOpcaoRevisao => ({ id: 'o1', grupoId: 'g1', grupoNome: 'Carnes', tipo: 'variacao', nome: 'Simples', precoTexto: '', usar: false, ...p })

describe('montarPlano', () => {
  test('nada marcado: nada a gravar, e não dá para salvar', () => {
    const plano = montarPlano([item(), item({ id: 'i2' })], [opcao()])
    assert.deepEqual(plano.itens, [])
    assert.deepEqual(plano.opcoes, [])
    assert.deepEqual(plano.erros, {})
    assert.equal(podeSalvar(plano), false)
  })
  test('item marcado com preço entra no plano, ativo, com o preço em centavos', () => {
    const plano = montarPlano([item({ usar: true, precoTexto: '24,90' })], [])
    assert.deepEqual(plano.itens, [{ id: 'i1', nome: 'Burger', preco_centavos: 2490, ativo: true }])
    assert.equal(podeSalvar(plano), true)
  })
  test('item marcado SEM preço é erro e não entra no plano (nunca vai ao ar a R$ 0,00)', () => {
    const plano = montarPlano([item({ usar: true, precoTexto: '' }), item({ id: 'i2', usar: true, precoTexto: '0' })], [])
    assert.deepEqual(plano.itens, [])
    assert.ok(plano.erros['item:i1'] && plano.erros['item:i2'])
    assert.equal(podeSalvar(plano), false)
  })
  test('preço inválido, nome vazio e nome longo são recusados', () => {
    assert.ok(montarPlano([item({ usar: true, precoTexto: 'abc' })], []).erros['item:i1'])
    assert.ok(montarPlano([item({ usar: true, precoTexto: '10', nome: '   ' })], []).erros['item:i1'])
    assert.ok(montarPlano([item({ usar: true, precoTexto: '10', nome: 'x'.repeat(61) })], []).erros['item:i1'])
    assert.ok(montarPlano([item({ usar: true, precoTexto: '9999999999' })], []).erros['item:i1'])
  })
  test('item desmarcado com preço digitado continua escondido (só o que o dono marca é ativado)', () => {
    const plano = montarPlano([item({ usar: false, precoTexto: '30' })], [])
    assert.deepEqual(plano.itens, [])
  })
  test('o nome editado é aparado antes de gravar', () => {
    assert.equal(montarPlano([item({ usar: true, precoTexto: '10', nome: '  X-Tudo  ' })], []).itens[0].nome, 'X-Tudo')
  })
  test('variação marcada exige preço maior que zero', () => {
    const plano = montarPlano([], [opcao({ usar: true, precoTexto: '' })])
    assert.ok(plano.erros['opcao:o1'])
    assert.deepEqual(plano.opcoes, [])
    assert.deepEqual(montarPlano([], [opcao({ usar: true, precoTexto: '30,00' })]).opcoes, [{ id: 'o1', preco_centavos: 3000, ativo: true }])
  })
  test('adicional marcado pode ficar sem preço (grátis), mas preço inválido é erro', () => {
    assert.deepEqual(montarPlano([], [opcao({ tipo: 'adicional', usar: true, precoTexto: '' })]).opcoes, [{ id: 'o1', preco_centavos: 0, ativo: true }])
    assert.ok(montarPlano([], [opcao({ tipo: 'adicional', usar: true, precoTexto: '1,2,3' })]).erros['opcao:o1'])
  })
  test('item com tamanho obrigatório e nenhum tamanho ativo gera aviso (não impede salvar)', () => {
    const plano = montarPlano([item({ usar: true, precoTexto: '20', variacaoId: 'g1' })], [opcao()])
    assert.equal(plano.avisos.length, 1)
    assert.equal(podeSalvar(plano), true)
  })
  test('sem aviso quando algum tamanho vai ficar ativo, nesta rodada ou já no banco', () => {
    const agora = montarPlano([item({ usar: true, precoTexto: '20', variacaoId: 'g1' })], [opcao({ usar: true, precoTexto: '25' })])
    assert.deepEqual(agora.avisos, [])
    const noBanco = montarPlano([item({ usar: true, precoTexto: '20', variacaoId: 'g1' })], [], new Set(['g1']))
    assert.deepEqual(noBanco.avisos, [])
  })
  test('erro numa linha não derruba as outras no plano, mas bloqueia salvar tudo', () => {
    const plano = montarPlano([item({ usar: true, precoTexto: '10' }), item({ id: 'i2', usar: true, precoTexto: '' })], [])
    assert.equal(plano.itens.length, 1)
    assert.ok(plano.erros['item:i2'])
    assert.equal(podeSalvar(plano), false)
  })
})

describe('apoio', () => {
  test('centavos para o campo de preço', () => {
    assert.equal(centavosParaCampo(0), '')
    assert.equal(centavosParaCampo(2490), '24,90')
    assert.equal(centavosParaCampo(500), '5,00')
  })
  test('itens sem preço', () => {
    assert.equal(itensSemPreco([{ preco_centavos: 0 }, { preco_centavos: 100 }, { preco_centavos: 0 }]), 2)
  })
})

describe('checklist: para onde cada item leva', () => {
  test('itens de sempre mantêm as rotas de Ajustes', () => {
    assert.equal(rotaDoItemChecklist('loja', 'horario'), '/loja/ajustes/cardapio')
    assert.equal(rotaDoItemChecklist('loja', 'cnpj'), '/loja/ajustes')
    assert.equal(rotaDoItemChecklist('loja', 'item'), '/loja/ajustes/cardapio')
  })
  test('preços do kit levam à tela de revisão; a oferta abre no Hub (sem rota)', () => {
    assert.equal(rotaDoItemChecklist('loja', 'kit_precos'), '/loja/ajustes/cardapio/exemplo')
    assert.equal(rotaDoItemChecklist('loja', 'kit_oferta'), null)
  })
})

describe('fiação', () => {
  const ler = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
  test('a rota existe dentro da barraca e a tela só abre com o interruptor dos kits', () => {
    assert.match(ler('../src/App.tsx'), /path="ajustes\/cardapio\/exemplo" element=\{<RevisarCardapioExemplo \/>\}/)
    assert.match(ler('../src/pages/RevisarCardapioExemplo.tsx'), /onboardingKitsHabilitado\(import\.meta\.env\.VITE_ONBOARDING_KITS\)/)
  })
  test('só mexe em item marcado como kit_exemplo e da própria barraca', () => {
    const dados = ler('../src/lib/revisarKitDados.ts')
    assert.match(dados, /\.eq\('kit_exemplo', true\)/)
    assert.match(dados, /\.eq\('barraca_id', barracaId\)\s*\n\s*\.eq\('kit_exemplo', true\)/)
    assert.doesNotMatch(dados, /\.delete\(|\.insert\(/)
  })
  test('grava as opções antes dos itens (o item só vale com tudo no lugar)', () => {
    const dados = ler('../src/lib/revisarKitDados.ts')
    const corpo = dados.slice(dados.indexOf('export async function salvarRevisao'))
    assert.ok(corpo.indexOf("from('opcoes')") < corpo.indexOf("from('itens')"))
  })
  test('a oferta do Hub nunca aplica "nenhum" como kit', () => {
    const oferta = ler('../src/components/OfertaKit.tsx')
    assert.ok(oferta.indexOf('if (kit === KIT_NENHUM)') < oferta.indexOf('aplicarKit('))
  })
})
