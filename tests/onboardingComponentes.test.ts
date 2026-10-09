// PR 3 do onboarding: componentes extraídos de Ajustes (mesmo visual e comportamento) para o assistente reutilizar.
// Sem testing-library no projeto: confere a estrutura e que Ajustes não duplicou o markup. Rodar: npm test
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'

const ler = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')

describe('SeletorModos', () => {
  const c = ler('src/components/SeletorModos.tsx')
  test('só apresentação: nada de Supabase nem de salvar', () => {
    assert.doesNotMatch(c, /supabase|useSalvarBarraca|useRascunho/)
    assert.match(c, /onAlternar\(modo\)/)
  })
  test('markup de antes: toggle por modo, alvo de toque de 44 px, rótulo e descrição', () => {
    assert.match(c, /TODOS_OS_MODOS\.map/)
    assert.match(c, /min-h-11/)
    assert.match(c, /DESCRICAO_MODO\[modo\]/)
    assert.match(c, /aria-label=\{ROTULO_MODO\[modo\]\}/)
  })
  test('Ajustes continua dono da regra "ao menos um ativo" e do salvar', () => {
    const s = ler('src/components/SecaoModosAtendimento.tsx')
    assert.match(s, /<SeletorModos ativos=\{ativos\} onAlternar=\{alternar\} \/>/)
    assert.match(s, /Você precisa ter ao menos um tipo de atendimento ativo/)
    assert.match(s, /salvador\.salvar\(\{ modos_atendimento: novaLista \}\)/)
    assert.doesNotMatch(s, /<Toggle/)
  })
})

describe('SeletorMetodos', () => {
  const c = ler('src/components/SeletorMetodos.tsx')
  test('só apresentação e mesmo markup (METODOS_DISPONIVEIS, sem vales)', () => {
    assert.doesNotMatch(c, /supabase|useSalvarBarraca|useRascunho/)
    assert.match(c, /METODOS_DISPONIVEIS\.map/)
    assert.doesNotMatch(c, /vale/i)
  })
  test('Ajustes usa o componente e mantém a regra e o salvar', () => {
    const a = ler('src/pages/Ajustes.tsx')
    assert.match(a, /<SeletorMetodos ativos=\{ativos\} onAlternar=\{alternar\} \/>/)
    assert.match(a, /Você precisa ter ao menos um método de pagamento ativo/)
    assert.match(a, /metodos\.salvar\(\{ metodos_pagamento_ativos: novaLista \}\)/)
    assert.doesNotMatch(a, /METODOS_DISPONIVEIS/)
  })
})

describe('CampoHorarioDia', () => {
  const c = ler('src/components/CampoHorarioDia.tsx')
  test('dois horários só quando o dia está aberto; rótulos acessíveis como antes', () => {
    assert.match(c, /\{linha\.aberto && \(/)
    assert.match(c, /aria-label=\{`\$\{rotulo\} aberto`\}/)
    assert.match(c, /Horário de abertura de \$\{rotulo\}/)
    assert.match(c, /Horário de fechamento de \$\{rotulo\}/)
  })
  test('"Igual ao dia anterior" só aparece quando a tela pede (Ajustes não passa a prop)', () => {
    assert.match(c, /\{onIgualAoAnterior && \(/)
    const s = ler('src/components/SecaoHorarioFuncionamento.tsx')
    assert.match(s, /<CampoHorarioDia/)
    assert.doesNotMatch(s, /onIgualAoAnterior/)
  })
  test('Ajustes continua salvando cada dia por upsert (comportamento igual)', () => {
    const s = ler('src/components/SecaoHorarioFuncionamento.tsx')
    assert.match(s, /\.upsert\(/)
    assert.match(s, /onConflict: 'barraca_id,dia_semana'/)
    assert.doesNotMatch(s, /type="time"/)
  })
  test('alvo de toque de 44 px no botão extra', () => {
    assert.match(c, /min-h-11/)
  })
})
