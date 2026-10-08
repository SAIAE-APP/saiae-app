// Testes das funções puras da camada de provedores (sem rede, sem Deno).
// Rodar: node --experimental-strip-types supabase/functions/_shared/pagamento/pagamento.test.ts
// (também roda no Deno: `deno run supabase/functions/_shared/pagamento/pagamento.test.ts`).
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import {
  dataExpiracaoMercadoPago,
  extrairNotificacaoMercadoPago,
  extrairQrMercadoPago,
  mercadoPago,
  montarCorpoCobrancaMercadoPago,
  statusDoMercadoPago,
  validarAssinaturaMercadoPago,
} from './mercadopago.ts'
import { chaveDoProvedor, obterProvedor, urlNotificacaoPagamento } from './registro.ts'
import { buscarTokenDoProvedor } from './token.ts'
import { decidirAprovado, totalEsperadoDoPendente } from './conciliacao.ts'
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

// --- nome do pagador (experimental, só teste): ausente = payload de sempre; presente vai em payer.first_name
const base = {
  token: 'x',
  valorCentavos: 600,
  referencia: 'pend-2',
  descricao: 'd',
  expiraEm: new Date('2026-09-29T15:00:00.000Z'),
  urlNotificacao: 'https://x/n',
}
assert.deepEqual(montarCorpoCobrancaMercadoPago(base).payer, { email: 'pedido-pend-2@saiae.com.br' })
assert.deepEqual(montarCorpoCobrancaMercadoPago({ ...base, pagador: {} }).payer, { email: 'pedido-pend-2@saiae.com.br' })
assert.deepEqual(montarCorpoCobrancaMercadoPago({ ...base, pagador: { nome: '' } }).payer, { email: 'pedido-pend-2@saiae.com.br' })
assert.deepEqual(montarCorpoCobrancaMercadoPago({ ...base, pagador: { nome: 'APRO' } }).payer, {
  email: 'pedido-pend-2@saiae.com.br',
  first_name: 'APRO',
})

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

// Conciliação: total esperado = itens + taxa do snapshot (centavos inteiros)
assert.equal(totalEsperadoDoPendente([{ quantidade: 2, preco_centavos_unitario: 1800 }, { quantidade: 1, preco_centavos_unitario: 600 }], 500), 4700)
assert.equal(totalEsperadoDoPendente([{ quantidade: 1, preco_centavos_unitario: 1000 }], 0), 1000)

// Pendente normal, valor certo: cria o pedido (não tardio)
assert.deepEqual(decidirAprovado({ statusPendente: 'pendente', valorPagoCentavos: 4700, totalEsperadoCentavos: 4700 }), { acao: 'criar_pedido', tardio: false })
// Pago depois de expirar, valor certo: cria o pedido (tardio, vira registro informativo)
assert.deepEqual(decidirAprovado({ statusPendente: 'expirado', valorPagoCentavos: 4700, totalEsperadoCentavos: 4700 }), { acao: 'criar_pedido', tardio: true })
// Valor divergente (a mais ou a menos), expirado ou não: concilia, NUNCA cria pedido
assert.deepEqual(decidirAprovado({ statusPendente: 'pendente', valorPagoCentavos: 4600, totalEsperadoCentavos: 4700 }), { acao: 'conciliar_valor' })
assert.deepEqual(decidirAprovado({ statusPendente: 'expirado', valorPagoCentavos: 4800, totalEsperadoCentavos: 4700 }), { acao: 'conciliar_valor' })
// Já processado ou rejeitado: ignora (retry do provedor)
assert.deepEqual(decidirAprovado({ statusPendente: 'aprovado', valorPagoCentavos: 4700, totalEsperadoCentavos: 4700 }), { acao: 'ignorar' })
assert.deepEqual(decidirAprovado({ statusPendente: 'rejeitado', valorPagoCentavos: 4700, totalEsperadoCentavos: 4700 }), { acao: 'ignorar' })

// x-signature do Mercado Pago (HMAC calculado de forma independente com node:crypto)
const hmacMp = (segredo: string, manifesto: string) => createHmac('sha256', segredo).update(manifesto).digest('hex')
const SEG = 'segredo-de-teste'
assert.equal(
  await validarAssinaturaMercadoPago({
    xSignature: `ts=1742505638683,v1=${hmacMp(SEG, 'id:123456;request-id:req-1;ts:1742505638683;')}`,
    xRequestId: 'req-1',
    dataId: '123456',
    segredo: SEG,
  }),
  true,
)
// data.id alfanumérico chega maiúsculo: o manifesto usa minúsculo
assert.equal(
  await validarAssinaturaMercadoPago({
    xSignature: `ts=1,v1=${hmacMp(SEG, 'id:abc123;request-id:r;ts:1;')}`,
    xRequestId: 'r',
    dataId: 'ABC123',
    segredo: SEG,
  }),
  true,
)
// sem request-id, a parte some do manifesto
assert.equal(
  await validarAssinaturaMercadoPago({
    xSignature: `ts=9,v1=${hmacMp(SEG, 'id:7;ts:9;')}`,
    xRequestId: null,
    dataId: '7',
    segredo: SEG,
  }),
  true,
)
// segredo errado, id adulterado, cabeçalho malformado
const sig = (segredo: string, manifesto: string) => `ts=1,v1=${hmacMp(segredo, manifesto)}`
assert.equal(await validarAssinaturaMercadoPago({ xSignature: sig('outro', 'id:7;ts:1;'), xRequestId: null, dataId: '7', segredo: SEG }), false)
assert.equal(await validarAssinaturaMercadoPago({ xSignature: sig(SEG, 'id:7;ts:1;'), xRequestId: null, dataId: '8', segredo: SEG }), false)
assert.equal(await validarAssinaturaMercadoPago({ xSignature: 'lixo', xRequestId: null, dataId: '7', segredo: SEG }), false)
assert.equal(await validarAssinaturaMercadoPago({ xSignature: 'ts=1', xRequestId: null, dataId: '7', segredo: SEG }), false)

// ProvedorPix.validarNotificacao: sem segredo / sem cabeçalho / válida / inválida
const reqMp = (cabecalhos: Record<string, string>) =>
  new Request('https://x.test/f?pendente=p&p=mercadopago&data.id=55', { method: 'POST', headers: cabecalhos })
assert.equal(await mercadoPago.validarNotificacao!(reqMp({}), null), 'sem_segredo')
assert.equal(await mercadoPago.validarNotificacao!(reqMp({}), SEG), 'sem_assinatura')
assert.equal(
  await mercadoPago.validarNotificacao!(
    reqMp({ 'x-signature': `ts=3,v1=${hmacMp(SEG, 'id:55;request-id:rq;ts:3;')}`, 'x-request-id': 'rq' }),
    SEG,
  ),
  'valida',
)
assert.equal(await mercadoPago.validarNotificacao!(reqMp({ 'x-signature': 'ts=3,v1=00', 'x-request-id': 'rq' }), SEG), 'invalida')

console.log('pagamento.test.ts: tudo certo')
