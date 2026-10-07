// Testes das funções puras da camada de provedores (sem rede, sem Deno).
// Rodar: node --experimental-strip-types supabase/functions/_shared/pagamento/pagamento.test.ts
// (também roda no Deno: `deno run supabase/functions/_shared/pagamento/pagamento.test.ts`).
import assert from 'node:assert/strict'
import {
  dataExpiracaoMercadoPago,
  extrairNotificacaoMercadoPago,
  extrairQrMercadoPago,
  montarCorpoCobrancaMercadoPago,
  statusDoMercadoPago,
} from './mercadopago.ts'
import { chaveDoProvedor, obterProvedor, urlNotificacaoPagamento } from './registro.ts'
import { buscarTokenDoProvedor } from './token.ts'
import {
  extrairNotificacaoAsaas,
  iguaisEmTempoConstante,
  leituraDePagamentosAsaas,
  montarCorpoQrEstaticoAsaas,
  statusDoAsaas,
  tokenWebhookAsaas,
  urlWebhookAsaas,
} from './asaas.ts'
import { centavosParaDecimal, ehProvedorValido, valorDecimalParaCentavos } from './tipos.ts'

const semCorpo = async () => null

// --- centavos inteiros (sem erro de ponto flutuante)
assert.equal(valorDecimalParaCentavos(29.99), 2999)
assert.equal(valorDecimalParaCentavos('0.1'), 10)
assert.equal(valorDecimalParaCentavos(1234.5), 123450)
assert.equal(valorDecimalParaCentavos(19.9 + 0.1), 2000)
assert.equal(centavosParaDecimal(2999), 29.99)
assert.equal(centavosParaDecimal(10), 0.1)

// --- status do MP: só approved aprova; refunded/in_process não fazem nada
assert.equal(statusDoMercadoPago('approved'), 'aprovado')
assert.equal(statusDoMercadoPago('cancelled'), 'expirado')
assert.equal(statusDoMercadoPago('expired'), 'expirado')
assert.equal(statusDoMercadoPago('rejected'), 'rejeitado')
for (const s of ['pending', 'in_process', 'refunded', 'charged_back', 'authorized', undefined, null, '']) {
  assert.equal(statusDoMercadoPago(s), 'pendente')
}

// --- QR
assert.deepEqual(
  extrairQrMercadoPago({ point_of_interaction: { transaction_data: { qr_code: 'abc', qr_code_base64: 'b64', ticket_url: 'u' } } }),
  { copiaECola: 'abc', qrCodeBase64: 'b64', ticketUrl: 'u' },
)
assert.deepEqual(extrairQrMercadoPago(null), { copiaECola: null, qrCodeBase64: null, ticketUrl: null })

// --- expiração com offset de Brasília (mesma conta de antes: now + 35min - 3h, Z -> -03:00)
assert.equal(dataExpiracaoMercadoPago(new Date('2026-09-29T15:00:00.000Z')), '2026-09-29T12:00:00.000-03:00')

// --- corpo da cobrança MP (valor decimal vindo de centavos; e-mail por pedido; referência)
const corpo = montarCorpoCobrancaMercadoPago({
  token: 'x',
  barracaId: 'b1',
  valorCentavos: 4590,
  referencia: 'pend-1',
  descricao: 'Pedido no cardápio digital',
  expiraEm: new Date('2026-09-29T15:00:00.000Z'),
  urlNotificacao: 'https://x/functions/v1/webhook-mercadopago?pendente=pend-1&p=mercadopago',
})
assert.equal(corpo.transaction_amount, 45.9)
assert.equal(corpo.payment_method_id, 'pix')
assert.equal(corpo.external_reference, 'pend-1')
assert.deepEqual(corpo.payer, { email: 'pedido-pend-1@saiae.com.br' })
assert.equal(corpo.notification_url, 'https://x/functions/v1/webhook-mercadopago?pendente=pend-1&p=mercadopago')

// --- notificação do MP
assert.deepEqual(
  await extrairNotificacaoMercadoPago(new URL('https://x/w?pendente=p&data.id=123&type=payment'), semCorpo),
  { idExterno: '123' },
)
assert.deepEqual(await extrairNotificacaoMercadoPago(new URL('https://x/w?id=77&topic=payment'), semCorpo), { idExterno: '77' })
// id/tipo só no corpo
assert.deepEqual(
  await extrairNotificacaoMercadoPago(new URL('https://x/w?pendente=p'), async () => ({ type: 'payment', data: { id: 555 } })),
  { idExterno: '555' },
)
// outro tipo, sem id ou corpo ilegível: ignora (200 rápido)
assert.deepEqual(await extrairNotificacaoMercadoPago(new URL('https://x/w?data.id=1&type=merchant_order'), semCorpo), { ignorar: true })
assert.deepEqual(await extrairNotificacaoMercadoPago(new URL('https://x/w?pendente=p'), semCorpo), { ignorar: true })
assert.deepEqual(
  await extrairNotificacaoMercadoPago(new URL('https://x/w'), async () => {
    throw new Error('json inválido')
  }),
  { ignorar: true },
)

// --- registro e retrocompatibilidade: sem `p` (URL antiga) = Mercado Pago
assert.equal(chaveDoProvedor(null), 'mercadopago')
assert.equal(chaveDoProvedor(''), 'mercadopago')
assert.equal(chaveDoProvedor(undefined), 'mercadopago')
assert.equal(chaveDoProvedor('asaas'), 'asaas')
assert.equal(obterProvedor('mercadopago')?.chave, 'mercadopago')
assert.equal(obterProvedor('pagbank'), null) // válido na lista, ainda sem adaptador
assert.equal(obterProvedor('qualquer'), null)
assert.equal(ehProvedorValido('woovi'), true)
assert.equal(ehProvedorValido('x'), false)
assert.equal(
  urlNotificacaoPagamento('https://proj.supabase.co', 'abc', 'mercadopago'),
  'https://proj.supabase.co/functions/v1/webhook-mercadopago?pendente=abc&p=mercadopago',
)

// --- token: linha sem a coluna `provedor` (antes da migration) vale Mercado Pago
function clienteFalso(linhas: Record<string, unknown>[]) {
  return {
    from: () => ({ select: () => ({ eq: async () => ({ data: linhas, error: null }) }) }),
  }
}
assert.equal(await buscarTokenDoProvedor(clienteFalso([{ barraca_id: 'b', access_token: 'tk' }]), 'b', 'mercadopago'), 'tk')
assert.equal(await buscarTokenDoProvedor(clienteFalso([{ barraca_id: 'b', access_token: 'tk' }]), 'b', 'asaas'), null)
assert.equal(
  await buscarTokenDoProvedor(
    clienteFalso([
      { provedor: 'mercadopago', access_token: 'mp' },
      { provedor: 'asaas', access_token: 'as' },
    ]),
    'b',
    'asaas',
  ),
  'as',
)
assert.equal(await buscarTokenDoProvedor(clienteFalso([]), 'b', 'mercadopago'), null)
assert.equal(
  await buscarTokenDoProvedor({ from: () => ({ select: () => ({ eq: async () => ({ data: null, error: { message: 'x' } }) }) }) }, 'b', 'mercadopago'),
  null,
)

// ===== Asaas (QR Code Pix estático) =====

// status: só RECEIVED/CONFIRMED aprovam
assert.equal(statusDoAsaas('RECEIVED'), 'aprovado')
assert.equal(statusDoAsaas('CONFIRMED'), 'aprovado')
for (const st of ['PENDING', 'OVERDUE', 'REFUNDED', 'REFUND_REQUESTED', undefined, null]) {
  assert.equal(statusDoAsaas(st), 'pendente')
}

// corpo do QR estático: valor fixo, uso único, referência = pendente, expiração em segundos
const corpoAsaas = montarCorpoQrEstaticoAsaas(
  {
    token: 'x',
    barracaId: 'b1',
    valorCentavos: 2090,
    referencia: 'pend-9',
    descricao: 'Pedido no cardápio digital',
    expiraEm: new Date(Date.now() + 35 * 60 * 1000),
    urlNotificacao: 'https://x/functions/v1/webhook-mercadopago?pendente=pend-9&p=asaas',
  },
  'chave-uuid',
)
assert.equal(corpoAsaas.addressKey, 'chave-uuid')
assert.equal(corpoAsaas.value, 20.9)
assert.equal(corpoAsaas.allowsMultiplePayments, false)
assert.equal(corpoAsaas.externalReference, 'pend-9')
assert.ok(Number(corpoAsaas.expirationSeconds) >= 34 * 60 && Number(corpoAsaas.expirationSeconds) <= 35 * 60)

// notificação: só pagamento recebido de QR estático; o corpo nunca é confiado (só o pixQrCodeId sai dele)
const corpoNotif = (event: string, payment: Record<string, unknown>) => async () => ({ event, payment })
assert.deepEqual(
  await extrairNotificacaoAsaas(new URL('https://x/w?p=asaas&b=b1'), corpoNotif('PAYMENT_RECEIVED', { id: 'pay_1', pixQrCodeId: 'qr_1' })),
  { idExterno: 'qr_1' },
)
assert.deepEqual(
  await extrairNotificacaoAsaas(new URL('https://x/w'), corpoNotif('PAYMENT_CONFIRMED', { pixQrCodeId: 'qr_2' })),
  { idExterno: 'qr_2' },
)
assert.deepEqual(await extrairNotificacaoAsaas(new URL('https://x/w'), corpoNotif('PAYMENT_CREATED', { pixQrCodeId: 'qr_3' })), { ignorar: true })
assert.deepEqual(await extrairNotificacaoAsaas(new URL('https://x/w'), corpoNotif('PAYMENT_RECEIVED', { id: 'pay_4' })), { ignorar: true })
assert.deepEqual(await extrairNotificacaoAsaas(new URL('https://x/w'), semCorpo), { ignorar: true })

// leitura dos pagamentos do QR: valor em centavos inteiros, referência esperada quando o Asaas não a propaga
assert.deepEqual(leituraDePagamentosAsaas([], 'pend-9'), { status: 'pendente', valorCentavos: 0, referencia: 'pend-9' })
assert.deepEqual(leituraDePagamentosAsaas([{ status: 'RECEIVED', value: 20.9 }], 'pend-9'), {
  status: 'aprovado',
  valorCentavos: 2090,
  referencia: 'pend-9',
})
assert.equal(leituraDePagamentosAsaas([{ status: 'RECEIVED', value: 19.9 + 0.1 }], 'p').valorCentavos, 2000)
// referência divergente volta como veio (o webhook recusa)
assert.equal(leituraDePagamentosAsaas([{ status: 'RECEIVED', value: 5, externalReference: 'outro' }], 'pend-9').referencia, 'outro')
// o aprovado vale mais que um pendente da lista
assert.equal(leituraDePagamentosAsaas([{ status: 'PENDING', value: 1 }, { status: 'CONFIRMED', value: 2 }], 'p').valorCentavos, 200)

// webhook da conta: URL por barraca e authToken derivado (32+ caracteres, sem espaços), conferido em tempo constante
assert.equal(
  urlWebhookAsaas('https://proj.supabase.co/functions/v1/webhook-mercadopago?pendente=abc&p=asaas', 'b1'),
  'https://proj.supabase.co/functions/v1/webhook-mercadopago?p=asaas&b=b1',
)
const tk = await tokenWebhookAsaas('segredo-do-projeto', 'b1')
assert.match(tk, /^[0-9a-f]{64}$/)
assert.equal(tk, await tokenWebhookAsaas('segredo-do-projeto', 'b1'))
assert.notEqual(tk, await tokenWebhookAsaas('segredo-do-projeto', 'b2'))
assert.notEqual(tk, await tokenWebhookAsaas('outro-segredo', 'b1'))
assert.equal(iguaisEmTempoConstante(tk, tk), true)
assert.equal(iguaisEmTempoConstante(tk, tk.slice(0, -1) + 'x'), false)
assert.equal(iguaisEmTempoConstante('a', 'ab'), false)
assert.equal(obterProvedor('asaas')?.chave, 'asaas')
assert.deepEqual(obterProvedor('asaas')?.configExtraObrigatoria, ['chave_pix'])
assert.equal(obterProvedor('asaas')?.qrRecuperavel, false)

console.log('pagamento.test.ts: tudo certo')
