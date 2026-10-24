// Disparos com o CRM: acesso, validação, corpo assinado, respostas estritas e guardas da function. Rodar: npm test
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'
import {
  chamarDisparosCrm,
  montarDestinatarios,
  podeDisparar,
  urlDisparos,
  validarEnvio,
  validarPublico,
  validarRespostaCancelar,
  validarRespostaCriar,
  validarRespostaHistorico,
} from '../supabase/functions/_shared/disparosCrm.ts'
import { avaliacaoDaConfig, validarCorpoIntegracao } from '../supabase/functions/_shared/integracaoV1.ts'

const B = '11111111-1111-4111-8111-111111111111'
const base = {
  url: 'https://crm.exemplo.com/api/integracao/comanda/v1/whatsapp-disparos',
  segredo: 'segredo-de-teste-com-16+',
  barracaId: B,
  requestId: '22222222-2222-4222-8222-222222222222',
}
const criar = { acao: 'criar' as const, tipo: 'promocao' as const, texto: 'Oi {nome}', barraca_nome: 'Loja', destinatarios: [{ telefone: '5561999990000', nome: 'Ana' }] }
const fakeJson = (corpo: unknown, status = 200) => (async () => new Response(JSON.stringify(corpo), { status })) as unknown as typeof fetch

describe('podeDisparar', () => {
  test('enviar e cancelar só dono; prévia e histórico, qualquer vínculo', () => {
    assert.equal(podeDisparar('enviar', 'dono'), true)
    assert.equal(podeDisparar('cancelar', 'dono'), true)
    for (const papel of ['funcionario', 'suporte', null]) {
      assert.equal(podeDisparar('enviar', papel), false)
      assert.equal(podeDisparar('cancelar', papel), false)
      assert.equal(podeDisparar('previa', papel), true)
      assert.equal(podeDisparar('historico', papel), true)
    }
  })
})

describe('validação da entrada', () => {
  test('reativação exige dias em 15|30|60|90; promoção ignora dias', () => {
    assert.deepEqual(validarPublico({ tipo: 'reativacao', dias: 30 }), { tipo: 'reativacao', dias: 30 })
    for (const dias of [undefined, 0, 7, 45, '30', null]) assert.equal(validarPublico({ tipo: 'reativacao', dias }), null, String(dias))
    assert.deepEqual(validarPublico({ tipo: 'promocao', dias: 999 }), { tipo: 'promocao', dias: null })
    assert.equal(validarPublico({ tipo: 'outro' }), null)
    assert.equal(validarPublico(null), null)
  })
  test('texto: 1 a 600 depois do trim', () => {
    assert.equal(validarEnvio({ tipo: 'promocao', texto: '' }), null)
    assert.equal(validarEnvio({ tipo: 'promocao', texto: '   ' }), null)
    assert.equal(validarEnvio({ tipo: 'promocao', texto: 'x'.repeat(601) }), null)
    assert.equal(validarEnvio({ tipo: 'promocao' }), null)
    assert.equal(validarEnvio({ tipo: 'promocao', texto: 'x'.repeat(600) })?.texto.length, 600)
    assert.equal(validarEnvio({ tipo: 'promocao', texto: '  oi  ' })?.texto, 'oi')
    assert.equal(validarEnvio({ tipo: 'reativacao', texto: 'oi' }), null)
  })
  test('destinatários: só dígitos, 8 a 15, nome até 60 ou null, máximo 500', () => {
    const r = montarDestinatarios([
      { telefone: '(61) 99999-0000', nome: ' Ana ' },
      { telefone: '123', nome: 'Curto' },
      { telefone: null, nome: 'Sem' },
      { telefone: '61988887777', nome: '  ' },
      { telefone: '61977776666', nome: 'n'.repeat(80) },
    ])
    assert.deepEqual(r.map((d) => d.telefone), ['61999990000', '61988887777', '61977776666'])
    assert.deepEqual(r.map((d) => d.nome?.length ?? null), [3, null, 60])
    assert.equal(montarDestinatarios(Array.from({ length: 700 }, (_, i) => ({ telefone: `6199${String(i).padStart(7, '0')}`, nome: null }))).length, 500)
  })
  test('URL de disparos: própria ou derivada da de conexão', () => {
    assert.equal(urlDisparos({ disparos: 'https://a.com/d', conexao: 'https://a.com/whatsapp-conexao' }), 'https://a.com/d')
    assert.equal(urlDisparos({ conexao: 'https://crm.com/api/integracao/comanda/v1/whatsapp-conexao' }), 'https://crm.com/api/integracao/comanda/v1/whatsapp-disparos')
    assert.equal(urlDisparos({ conexao: 'https://crm.com/outra-rota' }), null)
    assert.equal(urlDisparos({}), null)
  })
})

describe('chamarDisparosCrm', () => {
  test('corpo assinado só com os campos do contrato, redirect manual e timeout', async () => {
    let cap: { init: RequestInit } | null = null
    const fake = (async (_u: string, init: RequestInit) => {
      cap = { init }
      return new Response(JSON.stringify({ ok: true, campanha_id: 'c1', total: 1, invalidos: 0, repetido: false }))
    }) as unknown as typeof fetch
    const r = await chamarDisparosCrm({ ...base, corpo: criar }, fake)
    assert.deepEqual(r, { ok: true, dados: { ok: true, campanha_id: 'c1', total: 1, invalidos: 0, repetido: false } })
    const h = cap!.init.headers as Record<string, string>
    const corpo = cap!.init.body as string
    assert.deepEqual(Object.keys(JSON.parse(corpo)).sort(), ['acao', 'barraca_id', 'barraca_nome', 'destinatarios', 'request_id', 'texto', 'tipo'])
    assert.equal(JSON.parse(corpo).request_id, base.requestId)
    assert.equal(h['X-Saiae-Event-Id'], base.requestId)
    assert.equal(h['X-Saiae-Signature'], 'sha256=' + createHmac('sha256', base.segredo).update(`${h['X-Saiae-Timestamp']}.${corpo}`).digest('hex'))
    assert.equal(cap!.init.redirect, 'manual')
    assert.ok(cap!.init.signal)
  })
  test('motivo de negócio do CRM passa; formato fora do contrato falha', async () => {
    assert.deepEqual(await chamarDisparosCrm({ ...base, corpo: criar }, fakeJson({ ok: false, motivo: 'campanha_em_andamento' })), {
      ok: true,
      dados: { ok: false, motivo: 'campanha_em_andamento' },
    })
    for (const ruim of [{ ok: false, motivo: 'inventado' }, { ok: true }, { ok: true, campanha_id: 'c', total: '1', invalidos: 0, repetido: false }, 'x', null]) {
      const r = await chamarDisparosCrm({ ...base, corpo: criar }, fakeJson(ruim))
      assert.equal(r.ok, false, JSON.stringify(ruim))
    }
  })
  test('status de erro, JSON quebrado, rede e URL insegura viram falha sem vazar', async () => {
    for (const s of [401, 422, 429, 503]) assert.equal((await chamarDisparosCrm({ ...base, corpo: { acao: 'historico' } }, fakeJson({ erro: 'segredo' }, s))).ok, false)
    const quebrado = (async () => new Response('não é json')) as unknown as typeof fetch
    assert.equal((await chamarDisparosCrm({ ...base, corpo: { acao: 'historico' } }, quebrado)).ok, false)
    const cai = (async () => {
      throw new Error('ECONNREFUSED 10.0.0.1')
    }) as unknown as typeof fetch
    const r = await chamarDisparosCrm({ ...base, corpo: { acao: 'historico' } }, cai)
    assert.deepEqual(r, { ok: false, motivo: 'erro de rede' })
    let chamou = false
    const espiao = (async () => {
      chamou = true
      return new Response('{}')
    }) as unknown as typeof fetch
    for (const url of ['http://crm.com/x', 'https://127.0.0.1/x', 'https://localhost/x']) assert.equal((await chamarDisparosCrm({ ...base, url, corpo: { acao: 'historico' } }, espiao)).ok, false)
    assert.equal(chamou, false)
  })
})

describe('validadores de resposta', () => {
  const camp = { id: 'c1', tipo: 'promocao', estado: 'em_andamento', criada_em: '2026-10-24T12:00:00.000Z', total: 5, enviados: 2, falhas: 0, pulados: 1, na_fila: 2 }
  const hist = { ok: true, campanhas: [camp], avaliacoes: { media: 4.5, total: 2, enviadas_30d: 3, itens: [{ pedido_id: B, nota: 5, comentario: null, em: '2026-10-24T12:00:00.000Z' }] } }
  test('histórico válido passa e cortes de tamanho valem', () => {
    assert.ok(validarRespostaHistorico(hist))
    assert.equal(validarRespostaHistorico({ ...hist, campanhas: Array.from({ length: 15 }, () => camp) })?.campanhas.length, 10)
    assert.ok(validarRespostaHistorico({ ...hist, avaliacoes: { ...hist.avaliacoes, media: null, itens: [] } }))
  })
  test('histórico fora do contrato é rejeitado', () => {
    assert.equal(validarRespostaHistorico({ ...hist, campanhas: [{ ...camp, estado: 'x' }] }), null)
    assert.equal(validarRespostaHistorico({ ...hist, campanhas: [{ ...camp, enviados: -1 }] }), null)
    assert.equal(validarRespostaHistorico({ ...hist, avaliacoes: { ...hist.avaliacoes, itens: [{ pedido_id: B, nota: 7, comentario: null, em: '2026-10-24T12:00:00Z' }] } }), null)
    assert.equal(validarRespostaHistorico({ ok: true }), null)
  })
  test('criar e cancelar', () => {
    assert.ok(validarRespostaCriar({ ok: true, campanha_id: 'c', total: 3, invalidos: 1, repetido: true }))
    assert.equal(validarRespostaCriar({ ok: true, campanha_id: 'x'.repeat(41), total: 3, invalidos: 1, repetido: true }), null)
    assert.deepEqual(validarRespostaCancelar({ ok: true, cancelados: 0 }), { ok: true, cancelados: 0 })
    assert.equal(validarRespostaCancelar({ ok: true, cancelados: -1 }), null)
    assert.equal(validarRespostaCancelar({ ok: false }), null)
  })
})

describe('integracao-v1: avaliacao_config', () => {
  test('corpo aceito só com barraca_id e acao', () => {
    assert.deepEqual(validarCorpoIntegracao({ barraca_id: B, acao: 'avaliacao_config' }), { ok: true, valor: { acao: 'avaliacao_config', barracaId: B } })
    assert.equal(validarCorpoIntegracao({ barraca_id: B, acao: 'avaliacao_config', itens: [] }).ok, false)
  })
  test('resposta mapeada com os quatro campos; forma estranha vira null', () => {
    const c = { ativo: true, texto: null, whatsapp_dono: '5561999990000', barraca_nome: 'Loja', extra: 1 }
    assert.deepEqual(avaliacaoDaConfig(c), { ativo: true, texto: null, whatsapp_dono: '5561999990000', barraca_nome: 'Loja' })
    assert.equal(avaliacaoDaConfig({ ...c, ativo: 'sim' }), null)
    assert.equal(avaliacaoDaConfig({ ...c, whatsapp_dono: 'abc' }), null)
    assert.equal(avaliacaoDaConfig(null), null)
  })
})

describe('function whatsapp-disparos: guardas estáticas', () => {
  const codigo = readFileSync(new URL('../supabase/functions/whatsapp-disparos/index.ts', import.meta.url), 'utf8').replace(/\/\/.*$/gm, '')
  const pos = (t: string) => {
    const i = codigo.indexOf(t)
    assert.ok(i >= 0, t)
    return i
  }
  test('JWT, vínculo, papel e módulo vêm antes do público e do CRM', () => {
    for (const t of ['auth.getUser(', 'usuarios_barracas', 'podeDisparar(', 'modulo_desligado']) {
      assert.ok(pos(t) < pos("rpc('disparos_publico'"), t)
      assert.ok(pos(t) < pos('chamarDisparosCrm({'), t)
    }
    assert.ok(pos("'Sem acesso a esta loja'") < pos('modulo_desligado'))
  })
  test('módulo desligado devolve 403 e nenhum log imprime telefone, nome ou texto', () => {
    assert.match(codigo, /json\(\{ erro: 'modulo_desligado' \}, 403\)/)
    for (const c of codigo.match(/console\.\w+\([^)]*\)/g) ?? []) assert.doesNotMatch(c, /telefone|nome|texto|corpo|\.message|destinat/i, c)
  })
  test('não devolve o erro do CRM nem a lista de telefones', () => {
    assert.match(codigo, /json\(\{ erro: 'Conexão indisponível' \}, 502\)/)
    assert.doesNotMatch(codigo, /json\([^)]*destinatarios/)
    assert.doesNotMatch(codigo, /r\.motivo/)
  })
})
