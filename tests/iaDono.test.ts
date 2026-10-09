// Confirmação do WhatsApp do dono: pedido ao CRM, rota de confirmação e textos da tela. Rodar: npm test
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'
import { corpoDoPedido, interpretarRespostaPedido, pedirConfirmacaoAoCrm, respostaDaConfirmacao } from '../supabase/functions/_shared/iaDono.ts'
import { estadoConfirmacaoDono, lerPedidoConfirmacao, mensagemErroIa } from '../src/lib/atendenteIa.ts'

const SEGREDO = 'segredo-de-teste-da-plataforma'
const URL_CRM = 'https://crm.exemplo.com.br/api/integracao/comanda/v1/ia-dono-pedir-confirmacao'
const AGORA = 1_800_000_000_000
const resposta = (status: number, corpo: unknown) => new Response(typeof corpo === 'string' ? corpo : JSON.stringify(corpo), { status })

describe('corpoDoPedido', () => {
  test('só código [A-Z0-9]{6} e telefone de 10 a 13 dígitos; nada além disso viaja', () => {
    assert.equal(corpoDoPedido('ABCD23', '5511999990000'), '{"codigo_loja":"ABCD23","telefone":"5511999990000"}')
    for (const [c, t] of [['abcd23', '5511999990000'], ['ABCD2', '5511999990000'], ['ABCD23', '(11) 9999'], ['ABCD23', ''], ['ABCD23', '551199999000099']]) {
      assert.equal(corpoDoPedido(c, t), null, `${c} ${t}`)
    }
  })
})

describe('pedirConfirmacaoAoCrm', () => {
  test('POST assinado sobre o corpo exato, sem seguir redirect, sem o segredo na requisição', async () => {
    let visto: { url: string; init: RequestInit } | null = null
    const r = await pedirConfirmacaoAoCrm({ url: URL_CRM, segredo: SEGREDO, codigoLoja: 'ABCD23', telefone: '5511999990000' }, async (url, init) => {
      visto = { url: String(url), init: init as RequestInit }
      return resposta(200, { enviado: true })
    }, AGORA)
    assert.deepEqual(r, { ok: true, enviado: true })
    const v = visto as unknown as { url: string; init: RequestInit }
    const corpo = '{"codigo_loja":"ABCD23","telefone":"5511999990000"}'
    const ts = Math.floor(AGORA / 1000)
    assert.equal(v.url, URL_CRM)
    assert.equal(v.init.method, 'POST')
    assert.equal(v.init.body, corpo)
    assert.equal(v.init.redirect, 'manual')
    const h = v.init.headers as Record<string, string>
    assert.equal(h['X-Saiae-Timestamp'], String(ts))
    assert.equal(h['X-Saiae-Signature'], 'sha256=' + createHmac('sha256', SEGREDO).update(`${ts}.${corpo}`).digest('hex'))
    assert.ok(!JSON.stringify(h).includes(SEGREDO))
  })

  test('não configurado, URL interna/http ou dados inválidos: não chama a rede', async () => {
    let chamou = false
    const f = async () => { chamou = true; return resposta(200, { enviado: true }) }
    const base = { segredo: SEGREDO, codigoLoja: 'ABCD23', telefone: '5511999990000' }
    assert.equal((await pedirConfirmacaoAoCrm({ ...base, url: undefined }, f)).ok, false)
    assert.equal((await pedirConfirmacaoAoCrm({ ...base, url: URL_CRM, segredo: '' }, f)).ok, false)
    assert.equal((await pedirConfirmacaoAoCrm({ ...base, url: 'http://crm.exemplo.com.br/x' }, f)).ok, false)
    assert.equal((await pedirConfirmacaoAoCrm({ ...base, url: 'https://10.0.0.5/x' }, f)).ok, false)
    assert.equal((await pedirConfirmacaoAoCrm({ ...base, url: URL_CRM, codigoLoja: 'x' }, f)).ok, false)
    assert.equal(chamou, false)
  })

  test('respostas do contrato: enviado:false com motivo conhecido é ok; 401/500/forma errada/erro de rede são falha', async () => {
    const chama = (f: () => Promise<Response>) => pedirConfirmacaoAoCrm({ url: URL_CRM, segredo: SEGREDO, codigoLoja: 'ABCD23', telefone: '5511999990000' }, f, AGORA)
    assert.deepEqual(await chama(async () => resposta(200, { enviado: false, motivo: 'limite' })), { ok: true, enviado: false, motivo: 'limite' })
    for (const f of [
      async () => resposta(401, ''), async () => resposta(503, ''), async () => resposta(302, ''),
      async () => resposta(200, { enviado: false, motivo: 'inventado' }), async () => resposta(200, { enviado: 'sim' }),
      async () => resposta(200, 'não é json'), async () => { throw new Error('ECONNRESET') },
    ]) {
      const r = await chama(f)
      assert.equal(r.ok, false)
      if (!r.ok) assert.ok(!r.motivo.includes(SEGREDO))
    }
    assert.equal(interpretarRespostaPedido(null).ok, false)
  })
})

describe('respostaDaConfirmacao (o que o CRM lê)', () => {
  test('confirmado:true só quando gravou ou já estava gravado', () => {
    assert.deepEqual(respostaDaConfirmacao('ok'), { confirmado: true })
    assert.deepEqual(respostaDaConfirmacao('ja_confirmado'), { confirmado: true })
    assert.deepEqual(respostaDaConfirmacao('numero_diferente'), { confirmado: false, motivo: 'numero_diferente' })
    assert.deepEqual(respostaDaConfirmacao('loja_inexistente'), { confirmado: false, motivo: 'loja_inexistente' })
    assert.deepEqual(respostaDaConfirmacao(undefined), { confirmado: false, motivo: 'erro' })
  })
})

describe('functions (guardas estáticas)', () => {
  const ler = (n: string) => readFileSync(new URL(`../supabase/functions/${n}/index.ts`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')

  test('ia-dono-confirmar: a assinatura vem antes de qualquer consulta e o log é fixo', () => {
    const f = ler('ia-dono-confirmar')
    assert.ok(f.indexOf('verificarAssinaturaIa(') > 0 && f.indexOf('verificarAssinaturaIa(') < f.indexOf("rpc('ia_dono_confirmar'"))
    assert.match(f, /if \(!assinaturaValida\) return new Response\(null, \{ status: 401 \}\)/)
    assert.match(f, /if \(!segredo\) return new Response\(null, \{ status: 503 \}\)/)
    for (const l of f.split('\n').filter((x) => /console\./.test(x))) assert.match(l.trim(), /^console\.error\('[^'$`]*'\)$/, l)
  })

  test('ia-dono-pedir-confirmacao: login e vínculo antes do banco e do CRM; telefone nunca vem do navegador', () => {
    const f = ler('ia-dono-pedir-confirmacao')
    const pos = (t: string) => f.indexOf(t)
    assert.ok(pos('auth.getUser(') > 0 && pos("from('usuarios_barracas')") > pos('auth.getUser(') && pos("rpc('ia_dono_pedir_preparar'") > pos("from('usuarios_barracas')") && pos('pedirConfirmacaoAoCrm(') > pos("rpc('ia_dono_pedir_preparar'"))
    assert.match(f, /if \(!vinculo\) return json\(\{ erro: 'Sem acesso a esta loja' \}, 403\)/)
    assert.match(f, /telefone: p\.telefone \?\? ''/)
    assert.doesNotMatch(f, /corpo\.telefone/)
    assert.match(f, /Deno\.env\.get\('CRM_IA_DONO_PEDIR_URL'\)/)
    for (const l of f.split('\n').filter((x) => /console\./.test(x))) assert.match(l.trim(), /^console\.error\('[^'$`]*'\)$/, l)
  })
})

describe('tela: estado e textos', () => {
  const c = '2026-10-19T10:00:00Z'
  test('estadoConfirmacaoDono', () => {
    assert.equal(estadoConfirmacaoDono({ ia_whatsapp_dono: null, ia_whatsapp_dono_confirmado_em: null }), 'sem_numero')
    assert.equal(estadoConfirmacaoDono({ ia_whatsapp_dono: '5511999990000', ia_whatsapp_dono_confirmado_em: null, ia_dono_confirmacao_pedida_em: null }), 'nao_confirmado')
    assert.equal(estadoConfirmacaoDono({ ia_whatsapp_dono: '5511999990000', ia_whatsapp_dono_confirmado_em: null, ia_dono_confirmacao_pedida_em: c }), 'aguardando')
    assert.equal(estadoConfirmacaoDono({ ia_whatsapp_dono: '5511999990000', ia_whatsapp_dono_confirmado_em: c }), 'confirmado')
    // banco/cache sem a coluna: não exige nada
    assert.equal(estadoConfirmacaoDono({ ia_whatsapp_dono: '5511999990000' }), 'confirmado')
  })
  test('lerPedidoConfirmacao e a mensagem do erro de ligar', () => {
    assert.equal(lerPedidoConfirmacao({ ok: true, estado: 'enviado' }).enviado, true)
    assert.equal(lerPedidoConfirmacao({ ok: false, estado: 'aguarde' }).enviado, false)
    assert.match(lerPedidoConfirmacao({ ok: false, estado: 'nao_enviado', motivo: 'limite' }).texto, /muitas vezes/)
    assert.equal(lerPedidoConfirmacao(null).enviado, false)
    assert.match(mensagemErroIa({ message: 'ia_dono_nao_confirmado' }), /Enviar confirmação/)
  })
})
