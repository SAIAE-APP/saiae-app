// Kits iniciais (PR 4, assistente): regras puras de sugestão e a fiação em Configurar.tsx / onboardingApi.ts.
// A tela em si se prova no roteiro E2E (docs/onboarding-roteiro-e2e.md). Rodar: npm test
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'
import { KITS, sugestoesDoKit } from '../src/lib/kitsIniciais.ts'

const configurar = readFileSync(new URL('../src/pages/Configurar.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const api = readFileSync(new URL('../src/lib/onboardingApi.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n')

describe('sugestões do kit para os passos 6 e 8', () => {
  test('antes de confirmar os passos, sugere horário e modos do kit', () => {
    const s = sugestoesDoKit({ kitId: 'pizzaria', etapaFeita: 3, temDiaAberto: false })
    assert.equal(s.rotulo, 'Pizzaria')
    assert.equal(s.horario, 'jantar')
    assert.deepEqual(s.modos, ['mesa', 'balcao', 'retirada', 'entrega'])
  })
  test('depois do passo 6 não sugere mais o horário; depois do 8 não sugere mais os modos', () => {
    assert.equal(sugestoesDoKit({ kitId: 'pf', etapaFeita: 6, temDiaAberto: false }).horario, null)
    assert.notEqual(sugestoesDoKit({ kitId: 'pf', etapaFeita: 6, temDiaAberto: false }).modos, null)
    assert.equal(sugestoesDoKit({ kitId: 'pf', etapaFeita: 8, temDiaAberto: false }).modos, null)
  })
  test('horário já gravado com dia aberto nunca é sobrescrito pela sugestão', () => {
    assert.equal(sugestoesDoKit({ kitId: 'feira', etapaFeita: 3, temDiaAberto: true }).horario, null)
  })
  test('sem kit, "nenhum" ou kit desconhecido: nenhuma sugestão', () => {
    for (const k of [null, undefined, 'nenhum', 'foguete']) {
      assert.deepEqual(sugestoesDoKit({ kitId: k, etapaFeita: 0, temDiaAberto: false }), { rotulo: null, horario: null, modos: null }, String(k))
    }
  })
  test('a sugestão devolve cópia (mexer nela não altera o kit)', () => {
    const s = sugestoesDoKit({ kitId: 'feira', etapaFeita: 0, temDiaAberto: false })
    s.modos!.push('entrega')
    assert.deepEqual(KITS.find((k) => k.id === 'feira')!.modos, ['balcao'])
  })
})

describe('fiação do assistente (atrás de VITE_ONBOARDING_KITS)', () => {
  test('o interruptor vem de VITE_ONBOARDING_KITS', () => {
    assert.match(configurar, /onboardingKitsHabilitado\(import\.meta\.env\.VITE_ONBOARDING_KITS\)/)
  })
  test('o seletor de kit só aparece com o interruptor e com categoria escolhida', () => {
    assert.match(configurar, /\{kitsLigado && categoria && <SeletorDeKit /)
  })
  test('o passo 2 só manda o kit quando o interruptor está ligado', () => {
    assert.match(configurar, /onSalvar\(categoria, kitsLigado \? kit : null\)/)
  })
  test('a chamada do banco só leva p_kit quando existe (banco sem a migration continua funcionando)', () => {
    assert.match(api, /\.\.\.\(kit \? \{ p_kit: kit \} : \{\}\)/)
  })
  test('o kit é aplicado depois de criar a barraca e nunca trava o passo (sem throw nem return de erro)', () => {
    const bloco = configurar.slice(configurar.indexOf('const criada = await criarBarraca'), configurar.indexOf('onContinuarExistente={'))
    assert.ok(bloco.indexOf('concluirMarca') < bloco.indexOf('aplicarKit('), 'aplica depois de concluir o passo 3')
    assert.match(bloco, /kitsLigado && kitEscolhido && kitEscolhido !== KIT_NENHUM/)
    const depois = bloco.slice(bloco.indexOf('aplicarKit('))
    assert.doesNotMatch(depois.slice(0, depois.indexOf('seguinte(3)')), /throw|return k\.|return \w*erro/i)
    assert.match(depois, /seguinte\(3\)/)
  })
  test('a retomada reaplica o kit pendente só para barraca elegível e ainda sem kit', () => {
    assert.match(configurar, /completa\.kit_elegivel !== false && !completa\.kit_aplicado_em/)
    assert.match(configurar, /carregarKitEscolhido\(\)/)
  })
  test('"nenhum" nunca é aplicado', () => {
    assert.match(configurar, /kit !== KIT_NENHUM && kitDoId\(kit\)/)
  })
  test('a tela final troca o botão só quando há kit aplicado', () => {
    assert.match(configurar, /comKit \? 'Completar os preços do cardápio' : 'Cadastrar meus itens'/)
  })
  test('aplicarKit usa a RPC e o conteúdo do kit; falha vira estado simples', () => {
    assert.match(api, /rpc<\{ estado\?: string \}>\('onboarding_aplicar_kit', \{ p_barraca_id: barracaId, p_kit: kit, p_conteudo: conteudoDoKit\(kit\) \}\)/)
    assert.match(api, /r\.dados\?\.estado \?\? 'dados_invalidos'/)
  })
})
