// Trava real do assistente de configuração: o dono só usa o sistema depois da tela final. Rodar: npm test
// A prova na tela está em docs/onboarding-roteiro-e2e.md (seção "Trava").
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'
import { passoInicialSemBarraca, precisaVoltarAoAssistente, resumoDoAssistente, aplicarModelo, semanaFechada, type BarracaParaGuarda } from '../src/lib/onboardingConfig.ts'

const ler = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')

const dono = (id: string, slug: string): BarracaParaGuarda => ({ barraca_id: id, papel: 'dono', slug })
const func = (id: string, slug: string): BarracaParaGuarda => ({ barraca_id: id, papel: 'funcionario', slug })

describe('precisaVoltarAoAssistente', () => {
  test('dono com o assistente por concluir é devolvido em qualquer URL da barraca dele', () => {
    const base = { flagLigada: true, escopo: 'slug' as const, barracas: [dono('b1', 'loja')], pendentesIds: ['b1'] }
    assert.equal(precisaVoltarAoAssistente({ ...base, slug: 'loja' }), true)
  })
  test('barraca concluída (inclusive toda barraca antiga) nunca é travada', () => {
    assert.equal(precisaVoltarAoAssistente({ flagLigada: true, escopo: 'slug', slug: 'loja', barracas: [dono('b1', 'loja')], pendentesIds: [] }), false)
  })
  test('funcionário nunca é travado, mesmo que a barraca esteja pendente', () => {
    assert.equal(precisaVoltarAoAssistente({ flagLigada: true, escopo: 'slug', slug: 'loja', barracas: [func('b1', 'loja')], pendentesIds: ['b1'] }), false)
  })
  test('só a barraca pendente é travada: a outra barraca do mesmo dono segue livre', () => {
    const barracas = [dono('b1', 'velha'), dono('b2', 'nova')]
    assert.equal(precisaVoltarAoAssistente({ flagLigada: true, escopo: 'slug', slug: 'velha', barracas, pendentesIds: ['b2'] }), false)
    assert.equal(precisaVoltarAoAssistente({ flagLigada: true, escopo: 'slug', slug: 'nova', barracas, pendentesIds: ['b2'] }), true)
  })
  test('slug que o usuário não tem não é assunto do assistente (a RotaProtegida já trata)', () => {
    assert.equal(precisaVoltarAoAssistente({ flagLigada: true, escopo: 'slug', slug: 'outra', barracas: [dono('b1', 'loja')], pendentesIds: ['b1'] }), false)
  })
  test('com a flag desligada nada é travado', () => {
    assert.equal(precisaVoltarAoAssistente({ flagLigada: false, escopo: 'slug', slug: 'loja', barracas: [dono('b1', 'loja')], pendentesIds: ['b1'] }), false)
    assert.equal(precisaVoltarAoAssistente({ flagLigada: false, escopo: 'lista', barracas: [], pendentesIds: [] }), false)
  })
  test('lista de barracas: conta sem barraca ou com barraca pendente vai para o assistente', () => {
    assert.equal(precisaVoltarAoAssistente({ flagLigada: true, escopo: 'lista', barracas: [], pendentesIds: [] }), true)
    assert.equal(precisaVoltarAoAssistente({ flagLigada: true, escopo: 'lista', barracas: [dono('b1', 'loja')], pendentesIds: ['b1'] }), true)
  })
  test('lista de barracas: quem já concluiu tudo (ou é só funcionário) escolhe barraca normalmente', () => {
    assert.equal(precisaVoltarAoAssistente({ flagLigada: true, escopo: 'lista', barracas: [dono('b1', 'loja')], pendentesIds: [] }), false)
    assert.equal(precisaVoltarAoAssistente({ flagLigada: true, escopo: 'lista', barracas: [func('b1', 'loja')], pendentesIds: [] }), false)
  })
})

describe('retomada antes de existir barraca', () => {
  test('volta ao passo seguinte ao último respondido', () => {
    assert.equal(passoInicialSemBarraca({ origem: null, categoria: null }), 1)
    assert.equal(passoInicialSemBarraca({ origem: 'instagram', categoria: null }), 2)
    assert.equal(passoInicialSemBarraca({ origem: 'instagram', categoria: 'pizza' }), 3)
    assert.equal(passoInicialSemBarraca({ origem: null, categoria: 'pizza' }), 3)
  })
})

describe('resumo da tela "Tudo pronto"', () => {
  const semana = aplicarModelo('almoco')
  const barraca = {
    nome: 'Loja',
    modos_atendimento: ['balcao', 'entrega'],
    metodos_pagamento_ativos: ['dinheiro', 'pix'],
    endereco_rua: 'Rua A',
    endereco_numero: '10',
    endereco_bairro: 'Centro',
    endereco_cidade: 'Brasília',
    endereco_uf: 'DF',
    cnpj: '11222333000181',
    taxa_entrega_habilitada: true,
    taxa_entrega_centavos: 500,
  }
  const mapa = (l: { rotulo: string; valor: string }[]) => Object.fromEntries(l.map((x) => [x.rotulo, x.valor]))
  test('mostra tudo o que o dono informou', () => {
    const r = mapa(resumoDoAssistente(barraca, semana))
    assert.equal(r['Horário'], '6 dias por semana, das 11:00 às 15:00')
    assert.equal(r['Pagamento'], 'Dinheiro, Pix')
    assert.equal(r['Atendimento'], 'Balcão, Entrega')
    assert.match(r['Taxa de entrega'], /5,00/)
    assert.equal(r['Endereço'], 'Rua A, 10 · Centro · Brasília/DF')
    assert.equal(r['CNPJ'], '11.222.333/0001-81')
    assert.equal(r['Cardápio de exemplo'], undefined)
  })
  test('só mostra o que existe; "sem CNPJ" e kit aparecem', () => {
    const r = mapa(resumoDoAssistente({ nome: 'X', sem_cnpj: true, kit_aplicado: 'pf' }, semanaFechada()))
    assert.deepEqual(Object.keys(r), ['CNPJ', 'Cardápio de exemplo'])
    assert.equal(r['CNPJ'], 'Ainda não tenho')
  })
  test('sem Entrega, a taxa não aparece mesmo que esteja gravada', () => {
    const r = mapa(resumoDoAssistente({ ...barraca, modos_atendimento: ['balcao'] }, semana))
    assert.equal(r['Taxa de entrega'], undefined)
  })
  test('horários diferentes entre os dias mostram só a quantidade de dias', () => {
    const s = aplicarModelo('almoco').map((h, i) => (i === 2 ? { ...h, abre: '09:00' } : h))
    assert.equal(mapa(resumoDoAssistente(barraca, s))['Horário'], '6 dias por semana')
  })
})

describe('fiação', () => {
  const app = ler('src/App.tsx')
  test('toda URL /:slug/... passa pela guarda dentro de RotaProtegida', () => {
    assert.match(app, /<RotaProtegida verificarSlug>\s*<GuardaAssistente escopo="slug">\s*<LayoutBarraca \/>\s*<\/GuardaAssistente>\s*<\/RotaProtegida>/)
  })
  test('a tela de criar/escolher barraca (caminho antigo) também passa pela guarda', () => {
    assert.match(app, /<GuardaAssistente escopo="lista">\s*<SelecionarBarraca \/>\s*<\/GuardaAssistente>/)
  })
  test('/configurar, login, cadastro e saída NÃO passam pela guarda (sem laço)', () => {
    const configurar = app.slice(app.indexOf('path="/configurar"'), app.indexOf('path="/selecionar-barraca"'))
    assert.doesNotMatch(configurar, /GuardaAssistente/)
    assert.doesNotMatch(app.slice(app.indexOf('path="/login"'), app.indexOf('path="/assinar"')), /GuardaAssistente/)
  })
  test('a guarda só age com a flag, lê o banco a cada montagem e devolve com Navigate replace', () => {
    const g = ler('src/components/GuardaAssistente.tsx')
    assert.match(g, /onboardingConfigHabilitado\(import\.meta\.env\.VITE_ONBOARDING_CONFIG\)/)
    assert.match(g, /<Navigate to="\/configurar" replace \/>/)
    assert.match(ler('src/hooks/useBarracasPendentes.ts'), /barracasComOnboardingPendente\(donas\)/)
  })
  test('falha de leitura nunca trava (lista vazia)', () => {
    assert.match(ler('src/lib/onboardingApi.ts'), /if \(error \|\| !data\) return \[\][\s\S]*catch \{\s*return \[\]/)
  })
  test('a tela final não oferece "Ir para o início" quando não conseguiu concluir', () => {
    const c = ler('src/pages/Configurar.tsx')
    const erro = c.slice(c.indexOf("if (fase === 'erro')"), c.indexOf("if (fase === 'erro')") + 1200)
    assert.match(erro, /Tentar de novo/)
    assert.match(erro, /Revisar os passos/)
    assert.doesNotMatch(erro, /onIrParaHub/)
  })
  test('o resumo vem do banco (barraca e horários recarregados), não da memória da tela', () => {
    const c = ler('src/pages/Configurar.tsx')
    assert.match(c, /carregarBarracaCompleta\(barraca\.id\), carregarSemana\(barraca\.id\)/)
    assert.match(c, /resumoDoAssistente\(fresca, semanaDoBanco\(linhas\)\)/)
  })
  test('o Dispatcher continua mandando conta nova ou pendente direto para /configurar', () => {
    assert.match(ler('src/pages/Dispatcher.tsx'), /if \(onboardingPendente\) \{\s*navigate\('\/configurar', \{ replace: true \}\)/)
  })
})
