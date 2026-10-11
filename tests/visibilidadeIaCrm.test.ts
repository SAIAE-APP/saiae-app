// IA e CRM escondidos em todas as barracas, menos a de teste (2026-10-09): regra de visibilidade e backend intacto.
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { describe, test } from 'node:test'
import { SLUGS_COM_IA_E_CRM, mostrarAtendenteIa, mostrarIntegracaoCrm } from '../src/lib/visibilidadeIaCrm.ts'

const ler = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const existe = (p: string) => existsSync(new URL(`../${p}`, import.meta.url))

describe('Atendente IA', () => {
  test('qualquer barraca comum fica escondida, mesmo com a IA já ligada', () => {
    assert.equal(mostrarAtendenteIa({ slug: 'sabor-kawashima' }, undefined), false)
    assert.equal(mostrarAtendenteIa({ slug: 'outra-loja' }, '0'), false)
    assert.equal(mostrarAtendenteIa({}, undefined), false)
    assert.equal(mostrarAtendenteIa({ slug: null }, undefined), false)
  })
  test('só a barraca de teste vê; a flag reabre para todos (teste/staging)', () => {
    assert.deepEqual([...SLUGS_COM_IA_E_CRM], ['qa-teste-varredura'])
    assert.equal(mostrarAtendenteIa({ slug: 'qa-teste-varredura' }, undefined), true)
    assert.equal(mostrarAtendenteIa({ slug: 'sabor-kawashima' }, '1'), true)
  })
})

describe('Integração com o CRM', () => {
  test('barraca comum fica escondida; a de teste vê; a flag reabre', () => {
    assert.equal(mostrarIntegracaoCrm({ slug: 'sabor-kawashima' }, undefined), false)
    assert.equal(mostrarIntegracaoCrm({ slug: 'qa-teste-varredura' }, undefined), true)
    assert.equal(mostrarIntegracaoCrm({ slug: 'qualquer' }, '1'), true)
  })
})

describe('ligação nas telas', () => {
  test('Ajustes só monta a seção da IA pela regra, lendo a variável certa', () => {
    const a = ler('src/pages/Ajustes.tsx')
    assert.match(a, /mostrarAtendenteIa\(barraca, import\.meta\.env\.VITE_MOSTRAR_ATENDENTE_IA\) && \(/)
  })
  test('a seção do CRM se esconde pela regra, lendo a variável certa', () => {
    const c = ler('src/components/SecaoIntegracaoCrm.tsx')
    assert.match(c, /!mostrarIntegracaoCrm\(barraca, import\.meta\.env\.VITE_MOSTRAR_INTEGRACAO_CRM\)\) return null/)
  })
})

describe('só a tela some: o backend continua como estava', () => {
  test('a seção do CRM continua chamando as mesmas RPCs (esconder não desliga o envio)', () => {
    const c = ler('src/components/SecaoIntegracaoCrm.tsx')
    for (const r of ['integracao_crm_estado', 'integracao_crm_salvar', 'integracao_crm_novo_segredo', 'integracao_crm_reenviar_falhos']) {
      assert.ok(c.includes(r), r)
    }
  })
  test('nenhum arquivo de backend referencia a regra de visibilidade', () => {
    for (const p of ['supabase/functions/enviar-eventos-saida/index.ts', 'supabase/functions/ia-consumo/index.ts', 'supabase/functions/ia-contexto/index.ts']) {
      if (existe(p)) assert.doesNotMatch(ler(p), /visibilidadeIaCrm|MOSTRAR_/, p)
    }
  })
})
