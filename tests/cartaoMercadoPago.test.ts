// Cartão no cardápio: validação dos campos e geração do token direto no Mercado Pago. Rodar: npm test
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { gerarTokenCartao, validarDadosCartao, type DadosCartaoTela } from '../src/lib/cartaoMercadoPago.ts'

const AGORA = new Date('2026-10-26T12:00:00Z')
const VALIDO: DadosCartaoTela = {
  numero: '5031 4332 1540 6351',
  validade: '11/30',
  cvv: '123',
  nome: 'APRO',
  cpf: '529.982.247-25',
  email: 'cliente@exemplo.com',
}

test('cartaoMercadoPago: dados válidos não têm erro', () => {
  assert.deepEqual(validarDadosCartao(VALIDO, AGORA), {})
})

test('cartaoMercadoPago: número fora do Luhn, validade vencida, CVV curto, CPF e e-mail inválidos', () => {
  const erros = validarDadosCartao(
    { numero: '5031 4332 1540 6352', validade: '09/26', cvv: '12', nome: ' ', cpf: '111.111.111-11', email: 'x@' },
    AGORA,
  )
  assert.deepEqual(Object.keys(erros).sort(), ['cpf', 'cvv', 'email', 'nome', 'numero', 'validade'])
})

test('cartaoMercadoPago: validade do mês corrente ainda vale; mês 13 não', () => {
  assert.equal(validarDadosCartao({ ...VALIDO, validade: '10/26' }, AGORA).validade, undefined)
  assert.ok(validarDadosCartao({ ...VALIDO, validade: '13/30' }, AGORA).validade)
})

function fetchFalso(respostas: { url: RegExp; status: number; corpo: unknown }[], chamadas: { url: string; init?: RequestInit }[]) {
  return async (url: string, init?: RequestInit) => {
    chamadas.push({ url, init })
    const r = respostas.find((x) => x.url.test(url))
    if (!r) throw new TypeError('rede')
    return new Response(JSON.stringify(r.corpo), { status: r.status })
  }
}

test('cartaoMercadoPago: busca o meio pelo BIN e gera o token só no Mercado Pago, com a chave do vendedor', async () => {
  const chamadas: { url: string; init?: RequestInit }[] = []
  const r = await gerarTokenCartao(
    'APP_USR-chave',
    VALIDO,
    fetchFalso(
      [
        { url: /payment_methods\/search/, status: 200, corpo: { results: [{ id: 'master', payment_type_id: 'credit_card', issuer: { id: 24 } }] } },
        { url: /card_tokens/, status: 201, corpo: { id: 'tok_1' } },
      ],
      chamadas,
    ),
  )
  assert.deepEqual(r, { ok: true, cardToken: 'tok_1', paymentMethodId: 'master', issuerId: '24' })
  for (const c of chamadas) {
    assert.ok(c.url.startsWith('https://api.mercadopago.com/'), c.url)
    assert.ok(c.url.includes('public_key=APP_USR-chave'))
  }
  assert.match(chamadas[0].url, /bins=50314332/)
  const corpo = JSON.parse(String(chamadas[1].init?.body))
  assert.equal(corpo.card_number, '5031433215406351')
  assert.equal(corpo.expiration_month, 11)
  assert.equal(corpo.expiration_year, 2030)
  assert.deepEqual(corpo.cardholder, { name: 'APRO', identification: { type: 'CPF', number: '52998224725' } })
})

test('cartaoMercadoPago: cartão só de débito é recusado antes de gerar token', async () => {
  const chamadas: { url: string; init?: RequestInit }[] = []
  const r = await gerarTokenCartao(
    'k',
    VALIDO,
    fetchFalso([{ url: /payment_methods/, status: 200, corpo: { results: [{ id: 'debmaster', payment_type_id: 'debit_card' }] } }], chamadas),
  )
  assert.equal(r.ok, false)
  assert.equal(chamadas.length, 1)
})

test('cartaoMercadoPago: falha de rede ou recusa do token vira mensagem amigável, sem detalhe do provedor', async () => {
  const semRede = await gerarTokenCartao('k', VALIDO, fetchFalso([], []))
  assert.equal(semRede.ok, false)
  const recusa = await gerarTokenCartao(
    'k',
    VALIDO,
    fetchFalso(
      [
        { url: /payment_methods/, status: 200, corpo: { results: [{ id: 'master', payment_type_id: 'credit_card' }] } },
        { url: /card_tokens/, status: 400, corpo: { message: 'invalid card_number_id', cause: [{ code: 'E301' }] } },
      ],
      [],
    ),
  )
  assert.equal(recusa.ok, false)
  if (!recusa.ok) assert.doesNotMatch(recusa.erro, /invalid|E301/)
})

test('cartaoMercadoPago: dados do cartão nunca vão para console, storage nem servidor do Sai aê', async () => {
  const { readFileSync } = await import('node:fs')
  for (const arquivo of ['../src/lib/cartaoMercadoPago.ts', '../src/components/CartaoMercadoPago.tsx']) {
    const fonte = readFileSync(new URL(arquivo, import.meta.url), 'utf8')
    assert.doesNotMatch(fonte, /console\.|localStorage|sessionStorage|supabase/, arquivo)
  }
  // A tela manda ao servidor só o token, o meio e o e-mail.
  const tela = readFileSync(new URL('../src/pages/CardapioPublico.tsx', import.meta.url), 'utf8')
  assert.doesNotMatch(tela, /card_number|security_code|cardholder/)
})
