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
  montarCorpoCobrancaCartaoMercadoPago,
  montarCorpoCobrancaMercadoPago,
  statusDoMercadoPago,
  validarAssinaturaMercadoPago,
} from './mercadopago.ts'
import { chaveDoProvedor, obterProvedor, urlNotificacaoPagamento } from './registro.ts'
import { buscarTokenDoProvedor, obterTokenVendedor } from './token.ts'
import { ErroOauthMp, montarUrlAutorizacao, precisaRenovar, type TokensMp } from './oauthMercadoPago.ts'
import { cifrar, configDoEnv } from '../segredoCifrado.ts'
import { readFileSync } from 'node:fs'
import { decidirAprovado, totalEsperadoDoPendente } from './conciliacao.ts'
import { aplicarTaxaPlataforma, TAXA_PLATAFORMA_CENTAVOS } from './taxaPlataforma.ts'
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

// --- taxa da plataforma (R$ 0,99 por pedido pago online; pedido grátis não paga taxa)
assert.equal(TAXA_PLATAFORMA_CENTAVOS, 99)
assert.deepEqual(aplicarTaxaPlataforma(1500), { taxaPlataformaCentavos: 99, totalCentavos: 1599 })
assert.deepEqual(aplicarTaxaPlataforma(0), { taxaPlataformaCentavos: 0, totalCentavos: 0 })

// total esperado com taxa: itens 1500 + entrega 300 - cupom 200 + taxa 99; sem o 4º argumento é a conta de antes
assert.equal(totalEsperadoDoPendente([{ quantidade: 1, preco_centavos_unitario: 1500 }], 300, 200, 99), 1699)
assert.equal(totalEsperadoDoPendente([{ quantidade: 1, preco_centavos_unitario: 1500 }], 300, 200), 1600)

// comissão do marketplace: com taxa esperada > 0, comissão paga diferente = conciliar; igual = cria o pedido
assert.deepEqual(
  decidirAprovado({ statusPendente: 'pendente', valorPagoCentavos: 1699, totalEsperadoCentavos: 1699, comissaoPagaCentavos: 50, taxaPlataformaEsperadaCentavos: 99 }),
  { acao: 'conciliar_valor' },
)
assert.deepEqual(
  decidirAprovado({ statusPendente: 'pendente', valorPagoCentavos: 1699, totalEsperadoCentavos: 1699, comissaoPagaCentavos: null, taxaPlataformaEsperadaCentavos: 99 }),
  { acao: 'conciliar_valor' },
)
assert.deepEqual(
  decidirAprovado({ statusPendente: 'pendente', valorPagoCentavos: 1699, totalEsperadoCentavos: 1699, comissaoPagaCentavos: 99, taxaPlataformaEsperadaCentavos: 99 }),
  { acao: 'criar_pedido', tardio: false },
)
assert.deepEqual(
  decidirAprovado({ statusPendente: 'aprovado', valorPagoCentavos: 1699, totalEsperadoCentavos: 1699, comissaoPagaCentavos: 50, taxaPlataformaEsperadaCentavos: 99 }),
  { acao: 'ignorar' },
)
// pendente antigo sem taxa: comissão não é comparada
assert.deepEqual(
  decidirAprovado({ statusPendente: 'pendente', valorPagoCentavos: 4700, totalEsperadoCentavos: 4700, comissaoPagaCentavos: null, taxaPlataformaEsperadaCentavos: 0 }),
  { acao: 'criar_pedido', tardio: false },
)

// --- OAuth do vendedor: janela de renovação e URL de autorização
const AGORA = new Date('2026-11-04T12:00:00Z')
assert.equal(precisaRenovar(new Date(AGORA.getTime() + 30 * 60_000).toISOString(), AGORA), true)
assert.equal(precisaRenovar(new Date(AGORA.getTime() + 120 * 60_000).toISOString(), AGORA), false)
assert.equal(precisaRenovar(new Date(AGORA.getTime() - 1000).toISOString(), AGORA), true)
assert.equal(precisaRenovar('lixo', AGORA), true)

const urlAut = new URL(montarUrlAutorizacao({ clientId: '123', redirectUri: 'https://x.co/cb/?a=b', state: 'st&te' }))
assert.equal(urlAut.origin + urlAut.pathname, 'https://auth.mercadopago.com/authorization')
assert.equal(urlAut.searchParams.get('client_id'), '123')
assert.equal(urlAut.searchParams.get('response_type'), 'code')
assert.equal(urlAut.searchParams.get('platform_id'), 'mp')
assert.equal(urlAut.searchParams.get('redirect_uri'), 'https://x.co/cb/?a=b')
assert.equal(urlAut.searchParams.get('state'), 'st&te')
assert.ok(urlAut.search.includes('redirect_uri=https%3A%2F%2Fx.co%2Fcb%2F%3Fa%3Db'))

// --- obterTokenVendedor com cliente Supabase falso
const BARRACA = 'b-1'
const envFake = {
  get: (n: string) =>
    ({ TOKENS_CHAVE_V1: Buffer.alloc(32, 7).toString('base64'), MP_CLIENT_ID: 'cid', MP_CLIENT_SECRET: 'csec' } as Record<string, string>)[n],
}
const cfgFake = configDoEnv(envFake)
const cif = async (campo: string, v: string) => (await cifrar(v, { barracaId: BARRACA, campo }, cfgFake)).valor
type Linha = Record<string, unknown>
function bancoFalso(linha: Linha | null, opcoes: { perderCorrida?: Linha; falharEscritaApos?: number } = {}) {
  const estado = { linha: linha ? { ...linha } : null, updates: [] as Linha[] }
  let perder = opcoes.perderCorrida
  let chamadasUpdate = 0
  const cliente = {
    from: () => ({
      select: () => ({ eq: async () => ({ data: estado.linha ? [{ ...estado.linha }] : [], error: null }) }),
      update: (valores: Linha) => ({
        eq: () => ({
          eq: (_c: string, lido: unknown) => ({
            select: async () => {
              chamadasUpdate++
              if (opcoes.falharEscritaApos !== undefined && chamadasUpdate > opcoes.falharEscritaApos) return { data: null, error: { message: 'falha simulada' } }
              if (perder) {
                estado.linha = { ...perder }
                perder = undefined
              }
              if (!estado.linha || estado.linha.atualizado_em !== lido) return { data: [], error: null }
              estado.updates.push(valores)
              estado.linha = { ...estado.linha, ...valores }
              return { data: [{ barraca_id: BARRACA }], error: null }
            },
          }),
        }),
      }),
    }),
  }
  return { cliente, estado }
}
const linhaBase = async (expira: Date): Promise<Linha> => ({
  barraca_id: BARRACA,
  status: 'conectada',
  access_token_cifrado: await cif('mp_access_token', 'AT-velho'),
  refresh_token_cifrado: await cif('mp_refresh_token', 'RT-velho'),
  public_key: 'PK-velha',
  expira_em: expira.toISOString(),
  atualizado_em: '2026-11-01T00:00:00.000Z',
})
const novosTokens: TokensMp = { accessToken: 'AT-novo', refreshToken: 'RT-novo', expiraEmSegundos: 15552000, userId: '9', publicKey: 'PK-nova' }
const naoRenova = async (): Promise<TokensMp> => {
  throw new Error('não devia renovar')
}

{ // sem linha
  const { cliente } = bancoFalso(null)
  assert.deepEqual(await obterTokenVendedor(cliente, BARRACA, envFake, { agora: () => AGORA, renovar: naoRenova }), { ok: false, motivo: 'nao_conectada' })
}
{ // desconectada
  const { cliente } = bancoFalso({ ...(await linhaBase(new Date(AGORA.getTime() + 9e6))), status: 'desconectada' })
  assert.deepEqual(await obterTokenVendedor(cliente, BARRACA, envFake, { agora: () => AGORA, renovar: naoRenova }), { ok: false, motivo: 'nao_conectada' })
}
{ // token válido: não renova
  const { cliente, estado } = bancoFalso(await linhaBase(new Date(AGORA.getTime() + 5 * 3600_000)))
  assert.deepEqual(await obterTokenVendedor(cliente, BARRACA, envFake, { agora: () => AGORA, renovar: naoRenova }), { ok: true, token: 'AT-velho', publicKey: 'PK-velha' })
  assert.equal(estado.updates.length, 0)
}
{ // vencido: renova e grava novos tokens CIFRADOS (e a public_key)
  const { cliente, estado } = bancoFalso(await linhaBase(new Date(AGORA.getTime() + 10 * 60_000)))
  let chamadas = 0
  const r = await obterTokenVendedor(cliente, BARRACA, envFake, {
    agora: () => AGORA,
    renovar: async (p) => {
      chamadas++
      assert.equal(p.refreshToken, 'RT-velho')
      assert.equal(p.clientId, 'cid')
      assert.equal(p.clientSecret, 'csec')
      return novosTokens
    },
  })
  assert.deepEqual(r, { ok: true, token: 'AT-novo', publicKey: 'PK-nova' })
  assert.equal(chamadas, 1)
  const final = estado.updates[estado.updates.length - 1]
  assert.equal(final.status, 'conectada')
  assert.equal(final.public_key, 'PK-nova')
  assert.match(String(final.access_token_cifrado), /^v1\./)
  assert.ok(!JSON.stringify(final).includes('AT-novo') && !JSON.stringify(final).includes('RT-novo'))
  assert.equal(new Date(String(final.expira_em)).getTime(), AGORA.getTime() + 15552000 * 1000)
}
{ // renovação recusada pelo MP (400): marca desconectada
  const { cliente, estado } = bancoFalso(await linhaBase(new Date(AGORA.getTime() + 10 * 60_000)))
  const r = await obterTokenVendedor(cliente, BARRACA, envFake, {
    agora: () => AGORA,
    renovar: async () => {
      throw new ErroOauthMp(400)
    },
  })
  assert.deepEqual(r, { ok: false, motivo: 'renovacao_falhou' })
  assert.equal(estado.linha?.status, 'desconectada')
}
{ // gravação dos tokens novos falha (error do supabase-js, sem throw): renovacao_falhou
  const { cliente } = bancoFalso(await linhaBase(new Date(AGORA.getTime() + 10 * 60_000)), { falharEscritaApos: 1 })
  const r = await obterTokenVendedor(cliente, BARRACA, envFake, { agora: () => AGORA, renovar: async () => novosTokens })
  assert.deepEqual(r, { ok: false, motivo: 'renovacao_falhou' })
}
{ // falha de rede/5xx: erro, mas NÃO desconecta
  const { cliente, estado } = bancoFalso(await linhaBase(new Date(AGORA.getTime() + 10 * 60_000)))
  const r = await obterTokenVendedor(cliente, BARRACA, envFake, {
    agora: () => AGORA,
    renovar: async () => {
      throw new ErroOauthMp(503)
    },
  })
  assert.deepEqual(r, { ok: false, motivo: 'renovacao_falhou' })
  assert.equal(estado.linha?.status, 'conectada')
}
{ // perdeu a corrida: outra requisição já renovou; relê e usa o token novo sem chamar o MP
  const vencida = await linhaBase(new Date(AGORA.getTime() + 10 * 60_000))
  const outra = { ...(await linhaBase(new Date(AGORA.getTime() + 9 * 3600_000))), access_token_cifrado: await cif('mp_access_token', 'AT-da-outra'), atualizado_em: '2026-11-04T11:59:59.000Z' }
  const { cliente } = bancoFalso(vencida, { perderCorrida: outra })
  assert.deepEqual(await obterTokenVendedor(cliente, BARRACA, envFake, { agora: () => AGORA, renovar: naoRenova }), { ok: true, token: 'AT-da-outra', publicKey: 'PK-velha' })
}

// --- comissão (application_fee em reais, vinda de centavos), cartão e estorno
{
  const base = { token: 'T', valorCentavos: 1000, referencia: 'ref-1', descricao: 'Pedido', expiraEm: new Date('2026-11-04T15:00:00Z'), urlNotificacao: 'https://x/n' }
  assert.equal(montarCorpoCobrancaMercadoPago({ ...base, taxaPlataformaCentavos: 99 }).application_fee, 0.99)
  assert.equal('application_fee' in montarCorpoCobrancaMercadoPago(base), false)
  assert.equal('application_fee' in montarCorpoCobrancaMercadoPago({ ...base, taxaPlataformaCentavos: 0 }), false)

  const semExpira = { token: base.token, valorCentavos: base.valorCentavos, referencia: base.referencia, descricao: base.descricao, urlNotificacao: base.urlNotificacao }
  const corpo = montarCorpoCobrancaCartaoMercadoPago({ ...semExpira, taxaPlataformaCentavos: 99, cardToken: 'CT', paymentMethodId: 'visa', issuerId: '24', emailPagador: 'a@b.com' })
  assert.deepEqual(corpo, {
    transaction_amount: 10,
    token: 'CT',
    installments: 1,
    payment_method_id: 'visa',
    issuer_id: 24,
    description: 'Pedido',
    external_reference: 'ref-1',
    payer: { email: 'a@b.com' },
    notification_url: 'https://x/n',
    application_fee: 0.99,
  })
  const sem = montarCorpoCobrancaCartaoMercadoPago({ ...semExpira, cardToken: 'CT', paymentMethodId: 'visa', emailPagador: 'a@b.com' })
  assert.equal('application_fee' in sem, false)
  assert.equal('issuer_id' in sem, false)
  assert.equal(statusDoMercadoPago('in_process'), 'pendente')

  const fetchOriginal = globalThis.fetch
  const chamadas: { url: string; init: RequestInit }[] = []
  const simular = (resp: () => Response | Promise<Response>) => {
    chamadas.length = 0
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      chamadas.push({ url: String(url), init })
      return resp()
    }) as typeof fetch
  }
  const json = (status: number, corpoJson: unknown) => new Response(JSON.stringify(corpoJson), { status })
  const consulta = () => mercadoPago.consultarPagamento({ token: 'T', idExterno: '1' })
  const cartao = () => mercadoPago.criarCobrancaCartao!({ ...semExpira, cardToken: 'CT', paymentMethodId: 'visa', emailPagador: 'a@b.com' })
  const estorno = () => mercadoPago.estornar!({ token: 'T', idExterno: '77' })
  try {
    // comissão lida de fee_details
    simular(() => json(200, { status: 'approved', transaction_amount: 10, external_reference: 'ref-1', fee_details: [{ type: 'mercadopago_fee', amount: 0.5 }, { type: 'application_fee', amount: 0.99 }] }))
    assert.equal((await consulta()).comissaoCentavos, 99)
    simular(() => json(200, { status: 'approved', transaction_amount: 10, fee_details: [{ type: 'mercadopago_fee', amount: 0.5 }] }))
    assert.equal((await consulta()).comissaoCentavos, null)
    simular(() => json(200, { status: 'approved', transaction_amount: 10 }))
    assert.equal((await consulta()).comissaoCentavos, null)
    simular(() => json(200, { status: 'approved', transaction_amount: 10, fee_details: [null, { type: 'application_fee', amount: 'abc' }] }))
    assert.equal((await consulta()).comissaoCentavos, null)

    // cartão: idempotência = referencia; resultado tipado; erro não ecoa o token
    simular(() => json(201, { id: 555, status: 'in_process', status_detail: 'pending_contingency' }))
    assert.deepEqual(await cartao(), { idExterno: '555', status: 'pendente', statusDetalhe: 'pending_contingency' })
    assert.equal((chamadas[0].init.headers as Record<string, string>)['X-Idempotency-Key'], 'ref-1')
    simular(() => json(400, { message: 'invalid token' }))
    await assert.rejects(cartao, (e: Error) => e.name === 'ErroProvedor' && !/CT/.test(e.message))

    // estorno
    simular(() => json(201, { id: 9, status: 'approved' }))
    assert.deepEqual(await estorno(), { ok: true })
    assert.equal(chamadas[0].url, 'https://api.mercadopago.com/v1/payments/77/refunds')
    assert.equal(chamadas[0].init.method, 'POST')
    assert.equal(chamadas[0].init.body, undefined)
    assert.ok((chamadas[0].init.headers as Record<string, string>)['X-Idempotency-Key'])
    simular(() => json(400, { message: 'Not enough balance in seller account to refund' }))
    assert.deepEqual(await estorno(), { ok: false, motivo: 'saldo_insuficiente' })
    simular(() => json(400, { message: 'payment already refunded' }))
    assert.deepEqual(await estorno(), { ok: false, motivo: 'outro' })
    simular(() => json(503, { message: 'unavailable' }))
    await assert.rejects(estorno, (e: Error & { rede?: boolean }) => e.name === 'ErroProvedor' && e.rede === false)
    simular(() => { throw new Error('boom') })
    await assert.rejects(estorno, (e: Error & { rede?: boolean }) => e.name === 'ErroProvedor' && e.rede === true)
  } finally {
    globalThis.fetch = fetchOriginal
  }
}

// --- as functions OAuth nunca registram token/código/segredo
for (const f of ['oauthMercadoPago.ts', '../../mp-oauth-iniciar/index.ts', '../../mp-oauth-callback/index.ts']) {
  const fonte = readFileSync(new URL(f, import.meta.url), 'utf8')
  for (const linha of fonte.split('\n')) {
    if (/console\.(log|info|warn|error|debug)/.test(linha)) {
      assert.doesNotMatch(linha, /token|code|secret|refresh|\bbody\b|resposta/i, f + ': log suspeito: ' + linha)
    }
  }
}

console.log('pagamento.test.ts: tudo certo')
