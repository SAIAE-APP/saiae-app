// IA e CRM escondidos para cliente novo (2026-10-09): regra de visibilidade e garantia de que o backend não mudou.
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { describe, test } from 'node:test'
import { mostrarAtendenteIa, mostrarIntegracaoCrm } from '../src/lib/visibilidadeIaCrm.ts'

const ler = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const existe = (p: string) => existsSync(new URL(`../${p}`, import.meta.url))

describe('Atendente IA', () => {
  test('cliente novo (IA não habilitada): escondida', () => {
    assert.equal(mostrarAtendenteIa({ ia_habilitada: false }, undefined), false)
    assert.equal(mostrarAtendenteIa({}, undefined), false)
    assert.equal(mostrarAtendenteIa({ ia_habilitada: null }, '0'), false)
  })
  test('quem já usa continua vendo; a flag reabre para todos', () => {
    assert.equal(mostrarAtendenteIa({ ia_habilitada: true }, undefined), true)
    assert.equal(mostrarAtendenteIa({ ia_habilitada: false }, '1'), true)
  })
})

describe('Integração com o CRM', () => {
  test('cliente novo (sem conexão) ou estado ainda não carregado: escondida', () => {
    assert.equal(mostrarIntegracaoCrm(null, undefined), false)
    assert.equal(mostrarIntegracaoCrm({ url: null, ativo: false, segredo_configurado: false }, undefined), false)
    assert.equal(mostrarIntegracaoCrm({ url: '   ', ativo: false, segredo_configurado: false }, '0'), false)
  })
  test('barraca já conectada continua vendo (URL, segredo ou envio ligado)', () => {
    assert.equal(mostrarIntegracaoCrm({ url: 'https://crm.exemplo.com/x', ativo: false, segredo_configurado: false }, undefined), true)
    assert.equal(mostrarIntegracaoCrm({ url: null, ativo: false, segredo_configurado: true }, undefined), true)
    assert.equal(mostrarIntegracaoCrm({ url: null, ativo: true, segredo_configurado: false }, undefined), true)
  })
  test('a flag reabre para todos, até antes de carregar', () => {
    assert.equal(mostrarIntegracaoCrm(null, '1'), true)
    assert.equal(mostrarIntegracaoCrm({ ativo: false }, '1'), true)
  })
})

describe('ligação nas telas', () => {
  test('Ajustes só monta a seção da IA pela regra, lendo a variável certa', () => {
    const a = ler('src/pages/Ajustes.tsx')
    assert.match(a, /mostrarAtendenteIa\(barraca, import\.meta\.env\.VITE_MOSTRAR_ATENDENTE_IA\) && \(/)
  })
  test('a seção do CRM se esconde pela regra, lendo a variável certa', () => {
    const c = ler('src/components/SecaoIntegracaoCrm.tsx')
    assert.match(c, /!mostrarIntegracaoCrm\(estado, import\.meta\.env\.VITE_MOSTRAR_INTEGRACAO_CRM\)\) return null/)
  })
})

describe('só a tela some: o backend continua como estava', () => {
  test('a seção do CRM continua chamando as mesmas RPCs (esconder não desliga o envio)', () => {
    const c = ler('src/components/SecaoIntegracaoCrm.tsx')
    for (const r of ['integracao_crm_estado', 'integracao_crm_salvar', 'integracao_crm_novo_segredo', 'integracao_crm_reenviar_falhos']) {
      assert.ok(c.includes(r), r)
    }
  })
  test('nenhum arquivo de backend referencia a nova regra de visibilidade', () => {
    for (const p of ['supabase/functions/enviar-eventos-saida/index.ts', 'supabase/functions/ia-consumo/index.ts', 'supabase/functions/ia-contexto/index.ts']) {
      if (existe(p)) assert.doesNotMatch(ler(p), /visibilidadeIaCrm|MOSTRAR_/, p)
    }
  })
})

describe('onboarding e checklist não oferecem nem citam IA/CRM', () => {
  const alvo = [
    'src/pages/Configurar.tsx',
    'src/components/CartaoChecklistOnboarding.tsx',
    'src/lib/onboardingConfig.ts',
    'src/lib/onboardingApi.ts',
    'docs/superpowers/specs/2026-10-08-onboarding-configuracao-design.md',
  ]
  for (const p of alvo) {
    test(p, () => {
      if (!existe(p)) return // ainda não está nesta base (chega com os PRs do onboarding)
      assert.doesNotMatch(ler(p), /atendente\s*ia|\bCRM\b|\bIA\b/i, p)
    })
  }
})

describe('CLAUDE.md registra a decisão', () => {
  test('uma nota explica que IA e CRM ficam escondidos por decisão de 2026-10-09', () => {
    const t = ler('CLAUDE.md')
    assert.match(t, /IA e CRM escondidos \(decisão do João, 2026-10-09/)
    assert.match(t, /VITE_MOSTRAR_ATENDENTE_IA=1/)
    assert.match(t, /VITE_MOSTRAR_INTEGRACAO_CRM=1/)
  })
})
