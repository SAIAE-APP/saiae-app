// Testes das funções puras da camada de provedores (sem rede, sem Deno).
// Rodar: node --experimental-strip-types supabase/functions/_shared/pagamento/pagamento.test.ts
// (também roda no Deno: `deno run supabase/functions/_shared/pagamento/pagamento.test.ts`).
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import {
  comissaoDoMercadoPago,
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
import {
  chavePublicaDaBarraca,
  corteTokenAtingido,
  decidirCredencial,
  emitidoViaOauth,
  lerMeioPagamento,
  statusCartaoParaCliente,
  totalDaCobranca,
} from './cobrancaOnline.ts'
import { centavosParaDecimal, ehProvedorValido, ErroProvedor, valorDecimalParaCentavos } from './tipos.ts'
import { estornarPedido } from './estorno.ts'
import { decidirAprovadoDoPendente, metodoDoPedido, statusFinalDoPendente, tokenDoWebhook } from './webhookAprovado.ts'

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
for (const invalido of [-1, 1.5, NaN, Infinity]) assert.throws(() => aplicarTaxaPlataforma(invalido), RangeError)

// total esperado com taxa: itens 1500 + entrega 300 - cupom 200 + taxa 99; sem o 4º argumento é a conta de antes
assert.equal(totalEsperadoDoPendente([{ quantidade: 1, preco_centavos_unitario: 1500 }], 300, 200, 99), 1699)
assert.equal(totalEsperadoDoPendente([{ quantidade: 1, preco_centavos_unitario: 1500 }], 300, 200), 1600)

// comissão do marketplace: com taxa esperada > 0, comissão paga diferente = conciliar; igual = cria o pedido
assert.deepEqual(
  decidirAprovado({ statusPendente: 'pendente', valorPagoCentavos: 1699, totalEsperadoCentavos: 1699, comissaoPagaCentavos: 50, taxaPlataformaEsperadaCentavos: 99 }),
  { acao: 'conciliar_valor' },
)
// comissão NÃO informada pelo provedor (valor e referência conferem): cria o pedido e marca para conciliação
assert.deepEqual(
  decidirAprovado({ statusPendente: 'pendente', valorPagoCentavos: 1699, totalEsperadoCentavos: 1699, comissaoPagaCentavos: null, taxaPlataformaEsperadaCentavos: 99 }),
  { acao: 'criar_pedido', tardio: false, comissaoNaoInformada: true },
)
// valor errado continua bloqueando mesmo sem a comissão
assert.deepEqual(
  decidirAprovado({ statusPendente: 'pendente', valorPagoCentavos: 1600, totalEsperadoCentavos: 1699, comissaoPagaCentavos: null, taxaPlataformaEsperadaCentavos: 99 }),
  { acao: 'conciliar_valor' },
)
// comissão zero informada (diferente da taxa) bloqueia
assert.deepEqual(
  decidirAprovado({ statusPendente: 'pendente', valorPagoCentavos: 1699, totalEsperadoCentavos: 1699, comissaoPagaCentavos: 0, taxaPlataformaEsperadaCentavos: 99 }),
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
    // timeout e limite de taxa do provedor são transitórios (tentar de novo), não recusa
    for (const status of [408, 429]) {
      simular(() => json(status, { message: 'Not enough balance' }))
      await assert.rejects(estorno, (e: Error) => e.name === 'ErroProvedor', String(status))
    }
    // chave de idempotência determinística quando informada: retry depois de timeout não estorna duas vezes
    simular(() => json(201, { id: 9, status: 'approved' }))
    await mercadoPago.estornar!({ token: 'T', idExterno: '77', chaveIdempotencia: 'estorno-p1' })
    assert.equal((chamadas[0].init.headers as Record<string, string>)['X-Idempotency-Key'], 'estorno-p1')
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

// --- cobrança online (criar-pagamento-pix): meio, credencial, corte, total com a taxa
{
  // meio: ausente/pix = Pix; cartão exige token, método e e-mail
  assert.deepEqual(lerMeioPagamento({}), { ok: true, meio: 'pix' })
  assert.deepEqual(lerMeioPagamento({ meio: 'pix', card_token: 'x' }), { ok: true, meio: 'pix' })
  assert.equal((lerMeioPagamento({ meio: 'boleto' }) as { status: number }).status, 400)
  const cartaoOk = { meio: 'cartao', card_token: 'CT', payment_method_id: 'visa', issuer_id: 24, email_pagador: 'a@b.com' }
  assert.deepEqual(lerMeioPagamento(cartaoOk), {
    ok: true,
    meio: 'cartao',
    cartao: { cardToken: 'CT', paymentMethodId: 'visa', issuerId: '24', emailPagador: 'a@b.com' },
  })
  assert.equal('issuerId' in (lerMeioPagamento({ ...cartaoOk, issuer_id: undefined }) as { cartao: object }).cartao, false)
  for (const faltando of [{ card_token: undefined }, { card_token: '  ' }, { payment_method_id: '' }, { email_pagador: 'sem-arroba' }, { issuer_id: {} }]) {
    const r = lerMeioPagamento({ ...cartaoOk, ...faltando })
    assert.equal(r.ok, false)
    assert.equal((r as { status: number }).status, 422)
  }

  // corte: sem variável ou inválida = ainda não chegou
  const agora = new Date('2026-11-20T12:00:00Z')
  assert.equal(corteTokenAtingido(undefined, agora), false)
  assert.equal(corteTokenAtingido('', agora), false)
  assert.equal(corteTokenAtingido('lixo', agora), false)
  assert.equal(corteTokenAtingido('2026-11-20T12:00:00Z', agora), true)
  assert.equal(corteTokenAtingido('2026-11-19', agora), true)
  assert.equal(corteTokenAtingido('2026-12-01', agora), false)

  // credencial
  const conectada = { ok: true as const, token: 'AT', publicKey: 'PK' }
  const semOauth = { ok: false as const, motivo: 'nao_conectada' as const }
  assert.deepEqual(decidirCredencial({ vendedor: conectada, corteAtingido: false, meio: 'pix' }), { ok: true, modo: 'oauth', token: 'AT' })
  assert.deepEqual(decidirCredencial({ vendedor: conectada, corteAtingido: true, meio: 'cartao' }), { ok: true, modo: 'oauth', token: 'AT' })
  assert.deepEqual(decidirCredencial({ vendedor: semOauth, corteAtingido: false, meio: 'pix' }), { ok: true, modo: 'token_colado' })
  const depoisDoCorte = decidirCredencial({ vendedor: semOauth, corteAtingido: true, meio: 'pix' }) as { status: number; corpo: { codigo: string } }
  assert.equal(depoisDoCorte.status, 409)
  assert.equal(depoisDoCorte.corpo.codigo, 'mp_nao_conectado')
  const cartaoSemOauth = decidirCredencial({ vendedor: semOauth, corteAtingido: false, meio: 'cartao' }) as { status: number; corpo: { codigo: string } }
  assert.equal(cartaoSemOauth.corpo.codigo, 'mp_nao_conectado')
  const renovacao = decidirCredencial({ vendedor: { ok: false, motivo: 'renovacao_falhou' }, corteAtingido: false, meio: 'pix' }) as { status: number; corpo: object }
  assert.equal(renovacao.status, 503)
  assert.ok(!JSON.stringify(renovacao).includes('AT'))

  // total = itens − cupom + entrega + 99 (OAuth); token colado não leva taxa; total zero não leva taxa
  assert.deepEqual(totalDaCobranca({ subtotalItensCentavos: 1500, descontoCentavos: 200, taxaEntregaCentavos: 300, modo: 'oauth' }), { taxaPlataformaCentavos: 99, totalCentavos: 1699 })
  assert.deepEqual(totalDaCobranca({ subtotalItensCentavos: 1500, descontoCentavos: 200, taxaEntregaCentavos: 300, modo: 'token_colado' }), { taxaPlataformaCentavos: 0, totalCentavos: 1600 })
  assert.deepEqual(totalDaCobranca({ subtotalItensCentavos: 1500, descontoCentavos: 1500, taxaEntregaCentavos: 0, modo: 'oauth' }), { taxaPlataformaCentavos: 0, totalCentavos: 0 })
  // o total gravado bate com o que o webhook espera do pendente
  assert.equal(totalEsperadoDoPendente([{ quantidade: 1, preco_centavos_unitario: 1500 }], 300, 200, 99), 1699)

  assert.equal(emitidoViaOauth({ taxa_plataforma_centavos: 99 }), true)
  assert.equal(emitidoViaOauth({ taxa_plataforma_centavos: 0 }), false)
  assert.equal(emitidoViaOauth({}), false)

  assert.equal(statusCartaoParaCliente('aprovado'), 'aprovado')
  assert.equal(statusCartaoParaCliente('pendente'), 'pendente')
  assert.equal(statusCartaoParaCliente('rejeitado'), 'rejeitado')
  assert.equal(statusCartaoParaCliente('expirado'), 'rejeitado')
}
{ // chave pública: só barraca com pagamento online ligado e OAuth conectado; nunca o token
  const ID = '11000000-0000-4000-8000-000000000001'
  const banco = (online: unknown, oauth: Record<string, unknown> | null) => ({
    from: (tabela: string) => ({
      select: () => ({
        eq: async () => ({
          data: tabela === 'barracas' ? [{ pagamento_online_habilitado: online }] : oauth ? [oauth] : [],
          error: null,
        }),
      }),
    }),
  })
  const linhaOk = { status: 'conectada', public_key: 'APP_USR-pk', access_token_cifrado: 'v1.segredo' }
  assert.equal(await chavePublicaDaBarraca(banco(true, linhaOk), ID), 'APP_USR-pk')
  assert.equal(await chavePublicaDaBarraca(banco(false, linhaOk), ID), null)
  assert.equal(await chavePublicaDaBarraca(banco(true, { ...linhaOk, status: 'desconectada' }), ID), null)
  assert.equal(await chavePublicaDaBarraca(banco(true, { ...linhaOk, public_key: null }), ID), null)
  assert.equal(await chavePublicaDaBarraca(banco(true, null), ID), null)
  assert.equal(await chavePublicaDaBarraca(banco(true, linhaOk), 'nao-e-uuid'), null)
}

{ // comissão do MP: amount ausente, vazio ou não numérico é "não informada" (null), nunca 0
  for (const amount of [null, '', '  ', 'abc', undefined, true, {}]) {
    assert.equal(comissaoDoMercadoPago({ fee_details: [{ type: 'application_fee', amount }] }), null, `amount ${JSON.stringify(amount)}`)
  }
  assert.equal(comissaoDoMercadoPago({ fee_details: [{ type: 'application_fee', amount: 0.99 }] }), 99)
  assert.equal(comissaoDoMercadoPago({ fee_details: [{ type: 'application_fee', amount: '0.99' }] }), 99)
  assert.equal(comissaoDoMercadoPago({ fee_details: [{ type: 'application_fee', amount: 0 }] }), 0)
}
{ // webhook: total esperado com a taxa Sai aê e comissão conferida
  const itens = [{ quantidade: 1, preco_centavos_unitario: 1500 }]
  const novo = { status: 'pendente', itens, taxa_entrega_centavos: 300, desconto_cupom_centavos: 200, taxa_plataforma_centavos: 99 }
  // pago sem a taxa: não confere
  const semTaxa = decidirAprovadoDoPendente(novo, { valorCentavos: 1600, comissaoCentavos: 99 })
  assert.deepEqual(semTaxa.decisao, { acao: 'conciliar_valor' })
  assert.equal(semTaxa.totalCentavos, 1699)
  assert.equal(semTaxa.taxaPlataformaCentavos, 99)
  assert.equal(semTaxa.taxaEntregaCentavos, 300)
  // comissão diferente de 99: não confere; não informada: cria o pedido e marca para conciliação
  assert.deepEqual(decidirAprovadoDoPendente(novo, { valorCentavos: 1699, comissaoCentavos: 50 }).decisao, { acao: 'conciliar_valor' })
  assert.deepEqual(decidirAprovadoDoPendente(novo, { valorCentavos: 1699, comissaoCentavos: null }).decisao, { acao: 'criar_pedido', tardio: false, comissaoNaoInformada: true })
  // tudo certo
  assert.deepEqual(decidirAprovadoDoPendente(novo, { valorCentavos: 1699, comissaoCentavos: 99 }).decisao, { acao: 'criar_pedido', tardio: false })
  assert.deepEqual(decidirAprovadoDoPendente({ ...novo, status: 'expirado' }, { valorCentavos: 1699, comissaoCentavos: 99 }).decisao, { acao: 'criar_pedido', tardio: true })
  // pendente antigo (sem taxa, colunas ausentes): segue criando o pedido como antes, sem olhar comissão
  const antigo = decidirAprovadoDoPendente({ status: 'pendente', itens }, { valorCentavos: 1500, comissaoCentavos: null })
  assert.deepEqual(antigo.decisao, { acao: 'criar_pedido', tardio: false })
  assert.equal(antigo.taxaPlataformaCentavos, 0)
  assert.deepEqual(decidirAprovadoDoPendente({ status: 'pendente', itens, taxa_plataforma_centavos: 0 }, { valorCentavos: 1500, comissaoCentavos: null }).decisao, { acao: 'criar_pedido', tardio: false })
  // já processado
  assert.deepEqual(decidirAprovadoDoPendente({ ...novo, status: 'aprovado' }, { valorCentavos: 1699, comissaoCentavos: 99 }).decisao, { acao: 'ignorar' })
}
{ // webhook: qual token consulta o provedor de volta
  let chamadas: string[] = []
  const fontes = (vendedor: unknown, colado: string | null) => {
    chamadas = []
    return {
      vendedor: async () => { chamadas.push('vendedor'); return vendedor as never },
      colado: async () => { chamadas.push('colado'); return colado },
    }
  }
  // pendente com taxa = cobrado pelo OAuth
  assert.deepEqual(await tokenDoWebhook({ taxa_plataforma_centavos: 99 }, fontes({ ok: true, token: 'OAUTH', publicKey: null }, 'COLADO')), { ok: true, token: 'OAUTH' })
  assert.deepEqual(chamadas, ['vendedor'])
  // renovação falhou ou barraca desconectada: 500 (o provedor reenvia), nunca cai no token colado
  const falhou = await tokenDoWebhook({ taxa_plataforma_centavos: 99 }, fontes({ ok: false, motivo: 'renovacao_falhou' }, 'COLADO'))
  assert.equal(falhou.ok, false)
  assert.equal(!falhou.ok && falhou.status, 500)
  assert.deepEqual(chamadas, ['vendedor'])
  const desconectada = await tokenDoWebhook({ taxa_plataforma_centavos: 99 }, fontes({ ok: false, motivo: 'nao_conectada' }, 'COLADO'))
  assert.equal(!desconectada.ok && desconectada.status, 500)
  // pendente antigo: token colado, como sempre
  assert.deepEqual(await tokenDoWebhook({ taxa_plataforma_centavos: 0 }, fontes({ ok: true, token: 'OAUTH', publicKey: null }, 'COLADO')), { ok: true, token: 'COLADO' })
  assert.deepEqual(chamadas, ['colado'])
  assert.deepEqual(await tokenDoWebhook({}, fontes({ ok: true, token: 'OAUTH', publicKey: null }, 'COLADO')), { ok: true, token: 'COLADO' })
  const semToken = await tokenDoWebhook({}, fontes({ ok: true, token: 'OAUTH', publicKey: null }, null))
  assert.equal(!semToken.ok && semToken.status, 200)
}
{ // webhook (fiação): sem log de token, cartão ou e-mail; taxa gravada no pedido depois do criar_pedido
  const fonte = readFileSync(new URL('../../webhook-mercadopago/index.ts', import.meta.url), 'utf8')
  assert.ok(fonte.includes('tokenDoWebhook('))
  assert.ok(fonte.includes('decidirAprovadoDoPendente('))
  assert.ok(/update\(\{ taxa_plataforma_centavos: taxaPlataformaCentavos \}\)/.test(fonte))
  // comissão não informada: o pedido nasce e fica o registro de conciliação
  assert.ok(/if \(decisao\.comissaoNaoInformada\) \{\s*await registrarConciliacao\('comissao_nao_informada'/.test(fonte))
  assert.ok(!fonte.includes('buscarTokenDoProvedor(supabase, pendente.barraca_id, provedor.chave, Deno.env)\n  if'))
  for (const linha of fonte.split('\n').filter((l) => /console\.(log|warn|error|info)/.test(l))) {
    assert.ok(!/token|card|cartao|email|payer/i.test(linha.replace(/'[^']*'/g, '')), `log suspeito: ${linha.trim()}`)
  }
}

{ // webhook: meio do pendente decide o método do pedido e o status final da recusa
  assert.equal(metodoDoPedido({ meio_pagamento: 'cartao' }), 'credito')
  assert.equal(metodoDoPedido({ meio_pagamento: 'pix' }), 'pix')
  assert.equal(metodoDoPedido({}), 'pix') // pendente de antes da coluna
  // cartão cancelado/recusado termina rejeitado (como o criar-pagamento-pix grava); Pix mantém o status do provedor
  assert.equal(statusFinalDoPendente({ meio_pagamento: 'cartao' }, 'expirado'), 'rejeitado')
  assert.equal(statusFinalDoPendente({ meio_pagamento: 'cartao' }, 'rejeitado'), 'rejeitado')
  assert.equal(statusFinalDoPendente({ meio_pagamento: 'pix' }, 'expirado'), 'expirado')
  assert.equal(statusFinalDoPendente({}, 'rejeitado'), 'rejeitado')
  assert.equal(statusFinalDoPendente({}, 'expirado'), 'expirado')
}
{ // fiação do meio: criar-pagamento-pix grava; webhook usa no criar_pedido e na recusa
  const pix = readFileSync(new URL('../../criar-pagamento-pix/index.ts', import.meta.url), 'utf8')
  assert.equal((pix.match(/meio_pagamento: meioPedido\.meio,/g) ?? []).length, 2, 'insert e reaproveitamento')
  const webhook = readFileSync(new URL('../../webhook-mercadopago/index.ts', import.meta.url), 'utf8')
  assert.ok(webhook.includes('p_metodo_pagamento: metodoDoPedido(pendente),'))
  assert.ok(!webhook.includes("p_metodo_pagamento: 'pix'"))
  assert.ok(/update\(\{ status: statusFinalDoPendente\(pendente, leitura\.status\) \}\)\.eq\('id', pendente\.id\)\.eq\('status', 'pendente'\)/.test(webhook))
}

{ // estorno do pedido pago online (estornar-pagamento): acesso, elegibilidade, credencial, idempotência
  type Chamada = { token: string; idExterno: string; chaveIdempotencia?: string }
  const montar = (opcoes: {
    barraca?: string | null
    dono?: boolean
    pendentes?: Record<string, unknown>[]
    resultado?: () => Promise<{ ok: true } | { ok: false; motivo: 'saldo_insuficiente' | 'outro' }>
    vendedor?: unknown
    colado?: string | null
    marcar?: boolean
  }) => {
    const registro = { estornos: [] as Chamada[], marcados: [] as string[], donoConsultado: [] as string[] }
    const provedorFalso = {
      ...mercadoPago,
      estornar: async (p: Chamada) => {
        registro.estornos.push(p)
        return (opcoes.resultado ?? (async () => ({ ok: true as const })))()
      },
    }
    const deps = {
      barracaDoPedido: async () => (opcoes.barraca === undefined ? 'b1' : opcoes.barraca),
      ehDono: async (b: string) => { registro.donoConsultado.push(b); return opcoes.dono ?? true },
      pendentesDoPedido: async () => opcoes.pendentes ?? [],
      vendedor: async () => (opcoes.vendedor ?? { ok: true, token: 'OAUTH', publicKey: null }) as never,
      colado: async () => (opcoes.colado === undefined ? 'COLADO' : opcoes.colado),
      provedor: (chave: unknown) => (chave === 'mercadopago' ? provedorFalso : null),
      marcarEstornado: async (id: string) => { registro.marcados.push(id); return opcoes.marcar ?? true },
    }
    return { deps, registro }
  }
  const pago = { id: 'p1', status: 'aprovado', mercadopago_order_id: '777', provedor: 'mercadopago', taxa_plataforma_centavos: 99, estornado_em: null }

  // sucesso: OAuth (pendente com taxa), chave fixa do pendente, grava estornado_em
  {
    const { deps, registro } = montar({ pendentes: [pago] })
    assert.deepEqual(await estornarPedido('ped1', deps), { status: 200, corpo: { ok: true } })
    assert.deepEqual(registro.estornos, [{ token: 'OAUTH', idExterno: '777', chaveIdempotencia: 'estorno-p1' }])
    assert.deepEqual(registro.marcados, ['p1'])
  }
  // pendente antigo (sem taxa): token colado
  {
    const { deps, registro } = montar({ pendentes: [{ ...pago, taxa_plataforma_centavos: 0 }] })
    assert.equal((await estornarPedido('ped1', deps)).status, 200)
    assert.equal(registro.estornos[0].token, 'COLADO')
  }
  // pedido sem pagamento online: nao_pago_online, sem chamar o provedor
  for (const pendentes of [[], [{ ...pago, mercadopago_order_id: null }], [{ ...pago, status: 'pendente' }], [{ ...pago, status: 'expirado' }]]) {
    const { deps, registro } = montar({ pendentes })
    const r = await estornarPedido('ped1', deps)
    assert.equal(r.status, 422)
    assert.equal((r.corpo as { codigo?: string }).codigo, 'nao_pago_online')
    assert.equal(registro.estornos.length, 0)
  }
  // escolhe o pendente aprovado e pago entre vários
  {
    const { deps, registro } = montar({ pendentes: [{ ...pago, id: 'p0', status: 'expirado' }, pago] })
    assert.equal((await estornarPedido('ped1', deps)).status, 200)
    assert.deepEqual(registro.marcados, ['p1'])
  }
  // chamada repetida: ja_estornado (sucesso) SEM chamar o provedor de novo
  {
    const { deps, registro } = montar({ pendentes: [{ ...pago, estornado_em: '2026-10-26T12:00:00Z' }] })
    assert.deepEqual(await estornarPedido('ped1', deps), { status: 200, corpo: { ok: true, codigo: 'ja_estornado' } })
    assert.equal(registro.estornos.length, 0)
    assert.equal(registro.marcados.length, 0)
  }
  // saldo insuficiente: responde com o código e NÃO grava estornado_em
  {
    const { deps, registro } = montar({ pendentes: [pago], resultado: async () => ({ ok: false, motivo: 'saldo_insuficiente' }) })
    const r = await estornarPedido('ped1', deps)
    assert.equal(r.status, 409)
    assert.equal((r.corpo as { codigo?: string }).codigo, 'saldo_insuficiente')
    assert.match((r.corpo as { erro: string }).erro, /suporte/i)
    assert.equal(registro.marcados.length, 0)
  }
  // outra recusa do provedor: também não grava
  {
    const { deps, registro } = montar({ pendentes: [pago], resultado: async () => ({ ok: false, motivo: 'outro' }) })
    const r = await estornarPedido('ped1', deps)
    assert.equal(r.status, 409)
    assert.equal((r.corpo as { codigo?: string }).codigo, 'recusado')
    assert.equal(registro.marcados.length, 0)
  }
  // falha transitória do provedor: 502 sem gravar; outro erro sobe
  {
    const { deps, registro } = montar({ pendentes: [pago], resultado: async () => { throw new ErroProvedor('timeout', { rede: true }) } })
    const r = await estornarPedido('ped1', deps)
    assert.equal(r.status, 502)
    assert.equal(registro.marcados.length, 0)
    const bug = montar({ pendentes: [pago], resultado: async () => { throw new TypeError('bug') } })
    await assert.rejects(() => estornarPedido('ped1', bug.deps), TypeError)
  }
  // dono de outra barraca e pedido inexistente: o MESMO erro genérico, sem olhar o pagamento
  {
    const outra = montar({ dono: false, pendentes: [pago] })
    const inexistente = montar({ barraca: null, pendentes: [pago] })
    const r1 = await estornarPedido('ped1', outra.deps)
    const r2 = await estornarPedido('ped1', inexistente.deps)
    assert.equal(r1.status, 403)
    assert.deepEqual(r1, r2)
    assert.equal((r1.corpo as { codigo?: string }).codigo, undefined)
    assert.equal(outra.registro.estornos.length + inexistente.registro.estornos.length, 0)
    assert.deepEqual(inexistente.registro.donoConsultado, [])
  }
  // OAuth falhou: não estorna com o token colado
  {
    const { deps, registro } = montar({ pendentes: [pago], vendedor: { ok: false, motivo: 'nao_conectada' } })
    assert.equal((await estornarPedido('ped1', deps)).status, 503)
    assert.equal(registro.estornos.length, 0)
  }
  // estornou mas não gravou: erro (o retry usa a mesma chave e não estorna duas vezes)
  {
    const { deps } = montar({ pendentes: [pago], marcar: false })
    assert.equal((await estornarPedido('ped1', deps)).status, 500)
  }
  // provedor sem estorno
  {
    const { deps, registro } = montar({ pendentes: [{ ...pago, provedor: 'pagbank' }] })
    assert.equal((await estornarPedido('ped1', deps)).status, 422)
    assert.equal(registro.estornos.length, 0)
  }
}

console.log('pagamento.test.ts: tudo certo')
