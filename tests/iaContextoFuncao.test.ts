// IA no WhatsApp, Task 2: guardas estáticas da edge function ia-contexto (a lógica pura está em iaAssinatura.test.ts).
// Rodar: npm test
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'

const fonte = readFileSync(new URL('../supabase/functions/ia-contexto/index.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n')

describe('ia-contexto (edge function)', () => {
  test('a assinatura é conferida ANTES de qualquer consulta ao banco', () => {
    const posAssinatura = fonte.indexOf('verificarAssinaturaIa(')
    const posBanco = fonte.indexOf('createClient(')
    const posRpc = fonte.indexOf("rpc('ia_contexto'")
    assert.ok(posAssinatura > 0 && posBanco > posAssinatura && posRpc > posBanco)
    assert.ok(fonte.indexOf('validarCorpoIa(') > posAssinatura, 'o corpo só é interpretado depois da assinatura')
  })

  test('sem segredo configurado = 503; assinatura inválida = 401 sem corpo; só POST', () => {
    assert.match(fonte, /IA_CONTEXTO_SEGREDO/)
    assert.match(fonte, /if \(!segredo\) return new Response\(null, \{ status: 503 \}\)/)
    assert.match(fonte, /if \(!assinaturaValida\) return new Response\(null, \{ status: 401 \}\)/)
    assert.match(fonte, /req\.method !== 'POST'.*405/)
  })

  test('corpo limitado a 4 KB (cabeçalho e texto) e lido uma única vez', () => {
    assert.match(fonte, /declarado > TAMANHO_MAX_CORPO\) return new Response\(null, \{ status: 413 \}\)/)
    assert.match(fonte, /corpoBruto\.length > TAMANHO_MAX_CORPO/)
    assert.equal((fonte.match(/req\.text\(\)/g) ?? []).length, 1)
    assert.ok(!/req\.json\(\)/.test(fonte))
  })

  test('nunca registra telefone, código ou corpo; erro devolve mensagem genérica', () => {
    const logs = fonte.split('\n').filter((l) => /console\.(log|error|warn|info)/.test(l))
    assert.ok(logs.length >= 1)
    // Só mensagem fixa, sem variável nem interpolação (nada de telefone, código ou corpo no log).
    for (const l of logs) assert.match(l.trim(), /^console\.error\('[^'$`]*'\)$/, l)
    assert.match(fonte, /Falha ao montar o contexto/)
  })

  test('rota servidor-a-servidor: sem CORS para o navegador e sem login do usuário', () => {
    assert.ok(!/Access-Control-Allow-Origin/i.test(fonte))
    assert.ok(!/auth\.getUser|Authorization/.test(fonte))
  })

  test('o resultado de ia_contexto é devolvido como veio (já isolado por loja no banco)', () => {
    assert.match(fonte, /return json\(data\)/)
  })
})
