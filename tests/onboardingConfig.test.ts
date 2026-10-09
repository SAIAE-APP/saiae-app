// Assistente de configuração inicial (PR 2): slug, horários, CNPJ, passos e checklist. Rodar: npm test
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'
import {
  CATEGORIAS,
  ORIGENS,
  PASSOS,
  SLUGS_RESERVADOS,
  aplicarModelo,
  calcularChecklist,
  cnpjValido,
  deveAbrirAssistente,
  gerarSlug,
  horariosParaRpc,
  igualAoDiaAnterior,
  mensagemDoProblemaSlug,
  mostrarChecklist,
  passosVisiveis,
  podePular,
  problemaDoSlug,
  proximoPasso,
  semanaDoBanco,
  semanaFechada,
  sugerirSlugs,
  validarSemana,
} from '../src/lib/onboardingConfig.ts'

const sql = readFileSync(new URL('../supabase/migrations/20261020100000_onboarding_config.sql', import.meta.url), 'utf8')

describe('gerarSlug', () => {
  test('sem acento, minúsculo, hífens', () => {
    assert.equal(gerarSlug('Pastelão do Zé!'), 'pastelao-do-ze')
    assert.equal(gerarSlug('  Açaí & Cia — Centro  '), 'acai-cia-centro')
    assert.equal(gerarSlug('Restaurante   Paulo'), 'restaurante-paulo')
    assert.equal(gerarSlug('PF da Dona Ana 2'), 'pf-da-dona-ana-2')
  })
  test('só símbolos ou vazio => vazio', () => {
    for (const v of ['', '   ', '!!!', '---', null, undefined]) assert.equal(gerarSlug(v as string), '')
  })
  test('limite de 40 sem hífen pendurado e sem cortar palavra quando dá', () => {
    const s = gerarSlug('Restaurante e Pizzaria do Seu Joaquim da Esquina Grande Demais')
    assert.ok(s.length <= 40)
    assert.doesNotMatch(s, /-$/)
    assert.equal(problemaDoSlug(s), null)
    assert.equal(gerarSlug('a'.repeat(80)).length, 40)
  })
  test('o resultado sempre passa no formato do banco', () => {
    for (const n of ['Café com Leite', 'Ñandú Grill', '100% Natural', 'X-Tudo do Bairro', 'Çá Çé']) {
      const s = gerarSlug(n)
      assert.match(s, /^[a-z0-9]+(-[a-z0-9]+)*$/, n)
    }
  })
})

describe('problemaDoSlug', () => {
  test('formato, tamanho, reservado', () => {
    assert.equal(problemaDoSlug(''), 'vazio')
    assert.equal(problemaDoSlug('Abc'), 'formato')
    assert.equal(problemaDoSlug('a--b'), 'formato')
    assert.equal(problemaDoSlug('-a'), 'formato')
    assert.equal(problemaDoSlug('a'.repeat(41)), 'longo')
    assert.equal(problemaDoSlug('login'), 'reservado')
    assert.equal(problemaDoSlug('configurar'), 'reservado')
    assert.equal(problemaDoSlug('pastelao-do-ze'), null)
  })
  test('todo problema tem mensagem em português simples', () => {
    for (const p of ['vazio', 'longo', 'formato', 'reservado'] as const) assert.ok(mensagemDoProblemaSlug(p).length > 10)
  })
})

describe('lista de reservados igual à do banco', () => {
  test('SLUGS_RESERVADOS == slug_reservado() da migration', () => {
    const trecho = sql.slice(sql.indexOf('function public.slug_reservado'), sql.indexOf('-- 5)'))
    const doBanco = [...trecho.matchAll(/'([a-z0-9-]+)'/g)].map((m) => m[1]).filter((x) => x !== 'reservado')
    assert.deepEqual([...doBanco].sort(), [...SLUGS_RESERVADOS].sort())
  })
})

describe('sugerirSlugs', () => {
  test('bairro primeiro, depois -2 e -3; todas válidas', () => {
    assert.deepEqual(sugerirSlugs('pastelao', 'Asa Norte'), ['pastelao-asa-norte', 'pastelao-2', 'pastelao-3'])
    assert.deepEqual(sugerirSlugs('pastelao'), ['pastelao-2', 'pastelao-3'])
  })
  test('não repete o que já está ocupado e respeita o limite', () => {
    assert.deepEqual(sugerirSlugs('pastelao', null, ['pastelao-2']), ['pastelao-3'])
    const longas = sugerirSlugs('a'.repeat(40), 'b'.repeat(40))
    for (const s of longas) assert.equal(problemaDoSlug(s), null)
  })
  test('base vazia: nada', () => {
    assert.deepEqual(sugerirSlugs(''), [])
  })
})

describe('horários', () => {
  test('modelo Almoço: segunda a sábado 11–15, domingo fechado', () => {
    const s = aplicarModelo('almoco')
    assert.equal(s.length, 7)
    assert.equal(s[0].aberto, false)
    for (const d of [1, 2, 3, 4, 5, 6]) assert.deepEqual([s[d].aberto, s[d].abre, s[d].fecha], [true, '11:00', '15:00'])
  })
  test('modelo Fim de semana: só sábado e domingo', () => {
    const s = aplicarModelo('fim_de_semana')
    assert.deepEqual(s.filter((h) => h.aberto).map((h) => h.dia), [0, 6])
  })
  test('"Igual ao dia anterior" copia o dia de cima; domingo não tem anterior', () => {
    let s = semanaFechada()
    s = s.map((h) => (h.dia === 1 ? { ...h, aberto: true, abre: '09:00', fecha: '17:00' } : h))
    const r = igualAoDiaAnterior(s, 2)
    assert.deepEqual([r[2].aberto, r[2].abre, r[2].fecha], [true, '09:00', '17:00'])
    assert.equal(igualAoDiaAnterior(s, 0), s)
    assert.equal(s[2].aberto, false) // não muta a original
  })
  test('validação: ao menos um dia aberto, horário completo e válido, abre != fecha', () => {
    assert.equal(validarSemana(semanaFechada()).geral, 'nenhum_dia_aberto')
    assert.equal(validarSemana(aplicarModelo('jantar')).ok, true)
    const incompleto = semanaFechada().map((h) => (h.dia === 3 ? { ...h, aberto: true } : h))
    assert.equal(validarSemana(incompleto).erros[3], 'horario_incompleto')
    const ruim = semanaFechada().map((h) => (h.dia === 3 ? { ...h, aberto: true, abre: '25:00', fecha: '10:00' } : h))
    assert.equal(validarSemana(ruim).erros[3], 'horario_invalido')
    const igual = semanaFechada().map((h) => (h.dia === 3 ? { ...h, aberto: true, abre: '10:00', fecha: '10:00' } : h))
    assert.equal(validarSemana(igual).erros[3], 'abre_igual_fecha')
  })
  test('fechar depois da meia-noite é permitido (18:00–02:00)', () => {
    const s = semanaFechada().map((h) => (h.dia === 5 ? { ...h, aberto: true, abre: '18:00', fecha: '02:00' } : h))
    assert.equal(validarSemana(s).ok, true)
  })
  test('formato da RPC: dia fechado sem horários', () => {
    const r = horariosParaRpc(aplicarModelo('fim_de_semana'))
    assert.deepEqual(r[0], { dia: 0, aberto: true, abre: '11:00', fecha: '23:00' })
    assert.deepEqual(r[1], { dia: 1, aberto: false })
  })
  test('leitura do banco: HH:MM:SS vira HH:MM e dia sem registro fica fechado', () => {
    const s = semanaDoBanco([{ dia_semana: 2, aberto: true, hora_abertura: '08:30:00', hora_fechamento: '12:00:00' }])
    assert.deepEqual([s[2].abre, s[2].fecha, s[2].aberto], ['08:30', '12:00', true])
    assert.equal(s[3].aberto, false)
  })
})

describe('cnpjValido', () => {
  test('dígitos verificadores', () => {
    assert.equal(cnpjValido('11.222.333/0001-81'), true)
    assert.equal(cnpjValido('11222333000181'), true)
    assert.equal(cnpjValido('11222333000182'), false)
    assert.equal(cnpjValido('00000000000000'), false)
    assert.equal(cnpjValido('123'), false)
    assert.equal(cnpjValido(''), false)
  })
})

describe('passos e retomada', () => {
  test('obrigatórios são nome/link, horário, pagamento e modos; o resto pode ser adiado', () => {
    assert.deepEqual(PASSOS.filter((p) => p.obrigatorio).map((p) => p.chave), ['marca', 'horario', 'pagamento', 'modos'])
    for (const n of [3, 6, 7, 8, 10]) assert.equal(podePular(n), false, String(n))
    for (const n of [1, 2, 4, 5, 9]) assert.equal(podePular(n), true, String(n))
  })
  test('próximo passo: o seguinte ao concluído; sem Entrega pula a taxa', () => {
    assert.equal(proximoPasso(0, false), 1)
    assert.equal(proximoPasso(3, false), 4)
    assert.equal(proximoPasso(8, false), 10)
    assert.equal(proximoPasso(8, true), 9)
    assert.equal(proximoPasso(10, true), 10)
    assert.equal(proximoPasso(-5, false), 1)
  })
  test('barra de progresso: 10 passos com Entrega, 9 sem', () => {
    assert.equal(passosVisiveis(true).length, 10)
    assert.equal(passosVisiveis(false).length, 9)
  })
  test('conta nova abre o assistente com a flag; barraca antiga (concluída) nunca; sem flag, ninguém', () => {
    assert.equal(deveAbrirAssistente({ flagLigada: true, concluido: false }), true)
    assert.equal(deveAbrirAssistente({ flagLigada: true, concluido: true }), false)
    assert.equal(deveAbrirAssistente({ flagLigada: false, concluido: false }), false)
  })
  test('listas de origem e categoria batem com os CHECKs do banco', () => {
    for (const o of ORIGENS) assert.ok(sql.includes(`'${o.chave}'`), o.chave)
    for (const c of CATEGORIAS) assert.ok(sql.includes(`'${c.chave}'`), c.chave)
    assert.equal(ORIGENS.length, 8)
    assert.equal(CATEGORIAS.length, 10)
  })
})

describe('checklist (pesos iguais)', () => {
  const vazio = { horario: false, pagamento: false, modos: false, item: false, endereco: false, cnpj: false, entrega_ativa: false, taxa: null, pix_online: false, logo: false }
  test('conta nova só com a marca: 1 de 9 (sem taxa porque não há Entrega) = 11%', () => {
    const r = calcularChecklist(vazio)
    assert.equal(r.total, 9)
    assert.equal(r.feitos, 1)
    assert.equal(r.porcentagem, 11)
  })
  test('com Entrega o item de taxa entra no total', () => {
    assert.equal(calcularChecklist({ ...vazio, entrega_ativa: true, taxa: false }).total, 10)
    assert.equal(calcularChecklist({ ...vazio, entrega_ativa: true, taxa: true }).feitos, 2)
  })
  test('tudo feito = 100% (e some do Hub)', () => {
    const tudo = { horario: true, pagamento: true, modos: true, item: true, endereco: true, cnpj: true, entrega_ativa: true, taxa: true, pix_online: true, logo: true }
    const r = calcularChecklist(tudo)
    assert.equal(r.porcentagem, 100)
    assert.equal(mostrarChecklist(r.porcentagem, null, Date.now()), false)
  })
  test('cada item aberto aponta para um passo (ou Ajustes) e tem rótulo simples', () => {
    for (const i of calcularChecklist({ ...vazio, entrega_ativa: true }).itens) {
      assert.ok(i.rotulo.length > 3)
      assert.ok(i.passo === null || (i.passo >= 3 && i.passo <= 9))
    }
  })
  test('cartão oculto por 7 dias volta depois', () => {
    const agora = Date.parse('2026-10-20T12:00:00Z')
    assert.equal(mostrarChecklist(50, '2026-10-25T12:00:00Z', agora), false)
    assert.equal(mostrarChecklist(50, '2026-10-19T12:00:00Z', agora), true)
    assert.equal(mostrarChecklist(50, null, agora), true)
  })
  test('resposta incompleta do banco (migration ainda não aplicada) não quebra', () => {
    const r = calcularChecklist({})
    assert.equal(r.feitos, 1)
    assert.ok(r.porcentagem >= 0 && r.porcentagem <= 100)
  })
})
