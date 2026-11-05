// Contrato integracao-v1 (bot de WhatsApp): validação do corpo, assinatura com lista de segredos e recusas puras. Rodar: npm test
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { describe, test } from 'node:test'
import {
  haSegredoValido,
  lojaComBotVigente,
  lojaDoBot,
  modosDoBot,
  recusaDaAcao,
  telefoneSemPais,
  validarCorpoIntegracao,
  verificarAssinaturaLista,
} from '../supabase/functions/_shared/integracaoV1.ts'

const S1 = 'segredo-numero-um-16+'
const S2 = 'segredo-numero-dois-16+'
const AGORA = Date.parse('2026-10-24T12:00:30Z')
const TS = Math.floor(AGORA / 1000)
const CORPO = '{"acao":"cardapio"}'
const sig = (corpo: string, ts: number, segredo: string) =>
  'sha256=' + createHmac('sha256', segredo).update(`${ts}.${corpo}`).digest('hex')

describe('verificarAssinaturaLista', () => {
  test('assinatura válida passa', async () => {
    assert.equal(await verificarAssinaturaLista(S1, String(TS), sig(CORPO, TS, S1), CORPO, AGORA), true)
  })
  test('timestamp fora da janela falha', async () => {
    const velho = TS - 301
    assert.equal(await verificarAssinaturaLista(S1, String(velho), sig(CORPO, velho, S1), CORPO, AGORA), false)
  })
  test('assinatura adulterada e corpo trocado falham', async () => {
    const boa = sig(CORPO, TS, S1)
    const ruim = boa.slice(0, -1) + (boa.endsWith('0') ? '1' : '0')
    assert.equal(await verificarAssinaturaLista(S1, String(TS), ruim, CORPO, AGORA), false)
    assert.equal(await verificarAssinaturaLista(S1, String(TS), boa, CORPO + ' ', AGORA), false)
  })
  test('segredo vazio, ausente ou curto falha', async () => {
    for (const s of [undefined, '', ' , ', 'curto']) {
      assert.equal(await verificarAssinaturaLista(s, String(TS), sig(CORPO, TS, S1), CORPO, AGORA), false)
      assert.equal(haSegredoValido(s), false)
    }
    assert.equal(await verificarAssinaturaLista('curto', String(TS), sig(CORPO, TS, 'curto'), CORPO, AGORA), false)
  })
  test('com lista de dois segredos qualquer um vale (e um terceiro não)', async () => {
    const lista = `${S1}, ${S2}`
    assert.equal(await verificarAssinaturaLista(lista, String(TS), sig(CORPO, TS, S1), CORPO, AGORA), true)
    assert.equal(await verificarAssinaturaLista(lista, String(TS), sig(CORPO, TS, S2), CORPO, AGORA), true)
    assert.equal(await verificarAssinaturaLista(lista, String(TS), sig(CORPO, TS, 'outro-segredo-16-chars'), CORPO, AGORA), false)
    assert.equal(haSegredoValido(lista), true)
  })
  test('sem cabeçalhos falha', async () => {
    assert.equal(await verificarAssinaturaLista(S1, null, null, CORPO, AGORA), false)
  })
})

const B = '11111111-1111-4111-8111-111111111111'
const IT = '22222222-2222-4222-8222-222222222222'
const CU = '33333333-3333-4333-8333-333333333333'
const itens = [{ item_id: IT, quantidade: 2, opcao_ids: [], observacao: null }]

describe('validarCorpoIntegracao', () => {
  test('cardápio só com barraca_id e acao', () => {
    assert.deepEqual(validarCorpoIntegracao({ barraca_id: B, acao: 'cardapio' }), { ok: true, valor: { acao: 'cardapio', barracaId: B } })
    assert.equal(validarCorpoIntegracao({ barraca_id: B, acao: 'cardapio', itens }).ok, false)
  })
  test('acao desconhecida, barraca_id inválido e corpo que não é objeto são recusados', () => {
    assert.equal(validarCorpoIntegracao({ barraca_id: B, acao: 'apagar' }).ok, false)
    assert.equal(validarCorpoIntegracao({ barraca_id: 'x', acao: 'cardapio' }).ok, false)
    for (const v of [null, [], 'texto', 7, undefined]) assert.equal(validarCorpoIntegracao(v).ok, false)
  })
  test('rascunho: uma linha válida passa; mais de 40 linhas, vazio e quantidade 0 não', () => {
    const r = validarCorpoIntegracao({ barraca_id: B, acao: 'rascunho', itens })
    assert.equal(r.ok, true)
    if (r.ok && r.valor.acao === 'rascunho') assert.equal(r.valor.itens[0].quantidade, 2)
    const muitas = Array.from({ length: 41 }, (_, i) => ({
      item_id: `44444444-4444-4444-8444-${String(i).padStart(12, '0')}`,
      quantidade: 1,
    }))
    assert.equal(validarCorpoIntegracao({ barraca_id: B, acao: 'rascunho', itens: muitas }).ok, false)
    assert.equal(validarCorpoIntegracao({ barraca_id: B, acao: 'rascunho', itens: [] }).ok, false)
    assert.equal(validarCorpoIntegracao({ barraca_id: B, acao: 'rascunho', itens: [{ item_id: IT, quantidade: 0 }] }).ok, false)
  })
  const pedido = { barraca_id: B, acao: 'pedido', itens, client_uuid: CU, cliente_nome: ' Ana ', cliente_telefone: '5511999998888' }
  test('pedido de retirada: telefone só dígitos 10–13, client_uuid uuid, nome aparado', () => {
    const r = validarCorpoIntegracao(pedido)
    assert.equal(r.ok, true)
    if (r.ok && r.valor.acao === 'pedido') {
      assert.equal(r.valor.clienteNome, 'Ana')
      assert.equal(r.valor.tipoAtendimento, 'retirada')
    }
    for (const tel of ['123456789', '55119999988887', '+5511999998888', '(11) 99999-8888', 5511999998888]) {
      assert.equal(validarCorpoIntegracao({ ...pedido, cliente_telefone: tel }).ok, false, String(tel))
    }
    assert.equal(validarCorpoIntegracao({ ...pedido, client_uuid: 'abc' }).ok, false)
  })
  test('pedido de entrega exige endereço e nome; retirada não aceita endereço', () => {
    const entrega = { rua: 'Rua A', numero: '10', bairro: 'Centro' }
    assert.equal(validarCorpoIntegracao({ ...pedido, tipo_atendimento: 'entrega', entrega }).ok, true)
    assert.equal(validarCorpoIntegracao({ ...pedido, tipo_atendimento: 'entrega' }).ok, false)
    assert.equal(validarCorpoIntegracao({ ...pedido, tipo_atendimento: 'entrega', entrega: { ...entrega, bairro: '' } }).ok, false)
    assert.equal(validarCorpoIntegracao({ ...pedido, tipo_atendimento: 'entrega', entrega: { ...entrega, taxa: 0 } }).ok, false)
    assert.equal(validarCorpoIntegracao({ ...pedido, cliente_nome: null, tipo_atendimento: 'entrega', entrega }).ok, false)
    assert.equal(validarCorpoIntegracao({ ...pedido, tipo_atendimento: 'retirada', entrega }).ok, false)
    assert.equal(validarCorpoIntegracao({ ...pedido, tipo_atendimento: 'mesa' }).ok, false)
  })
  test('chave desconhecida (inclusive preço vindo de fora) é recusada', () => {
    assert.equal(validarCorpoIntegracao({ ...pedido, total_centavos: 1 }).ok, false)
    assert.equal(validarCorpoIntegracao({ barraca_id: B, acao: 'rascunho', itens, preco: 1 }).ok, false)
  })
  test('pix exige conversa_id e só aceita retirada', () => {
    const pix = { ...pedido, acao: 'pix', conversa_id: 'sessao:abc' }
    assert.equal(validarCorpoIntegracao(pix).ok, true)
    assert.equal(validarCorpoIntegracao({ ...pix, conversa_id: undefined }).ok, false)
    assert.equal(validarCorpoIntegracao({ ...pix, conversa_id: 'x'.repeat(201) }).ok, false)
    assert.equal(validarCorpoIntegracao({ ...pix, tipo_atendimento: 'entrega' }).ok, false)
    assert.equal(validarCorpoIntegracao({ ...pix, entrega: { rua: 'a', numero: '1', bairro: 'b' } }).ok, false)
  })
})

const LOJA = {
  nome: 'Loja',
  slug: 'loja',
  modos_atendimento: ['retirada'],
  pagar_na_entrega_habilitado: true,
  pagamento_online_habilitado: true,
  perfil_cliente_obrigatorio: false,
  ia_habilitada: true,
  fuso: 'America/Sao_Paulo',
}

describe('regras da loja para o bot', () => {
  test('modos: entrega só com pagar na entrega; sem modo atendível cai em retirada', () => {
    assert.deepEqual(modosDoBot(LOJA), ['retirada'])
    assert.deepEqual(modosDoBot({ ...LOJA, modos_atendimento: ['retirada', 'entrega'] }), ['retirada', 'entrega'])
    assert.deepEqual(modosDoBot({ ...LOJA, modos_atendimento: ['entrega'] }), ['entrega'])
    assert.deepEqual(modosDoBot({ ...LOJA, modos_atendimento: ['entrega'], pagar_na_entrega_habilitado: false }), ['retirada'])
    assert.deepEqual(modosDoBot({ ...LOJA, modos_atendimento: ['mesa'] }), ['retirada'])
  })
  test('recusas de pedido, na ordem', () => {
    assert.equal(recusaDaAcao('pedido', 'retirada', LOJA, true), null)
    assert.equal(recusaDaAcao('pedido', 'retirada', { ...LOJA, ia_habilitada: false }, false)?.codigo, 'bot_desligado')
    assert.equal(recusaDaAcao('pedido', 'retirada', LOJA, false)?.codigo, 'fechado')
    assert.equal(recusaDaAcao('pedido', 'entrega', LOJA, true)?.codigo, 'modo_indisponivel')
    assert.equal(recusaDaAcao('pedido', 'retirada', { ...LOJA, pagar_na_entrega_habilitado: false }, true)?.codigo, 'sem_pagar_na_entrega')
  })
  test('lojaDoBot: link, aberta_agora, pagamentos e dono só se confirmado', () => {
    const quarta = new Date('2026-10-21T15:00:00Z') // quarta 12h em São Paulo
    const horarios = [{ dia_semana: 3, aberto: true, hora_abertura: '18:00', hora_fechamento: '22:00' }]
    const l = lojaDoBot({ ...LOJA, ia_whatsapp_dono: '5511999990000' }, horarios, 'https://app.exemplo.com/', quarta)
    assert.equal(l.link_cardapio, 'https://app.exemplo.com/loja/cardapio')
    assert.equal(l.aberta_agora, false)
    assert.deepEqual(l.pagamentos, { na_entrega: true, pix: true })
    assert.equal(l.whatsapp_dono, null)
    assert.equal(l.bot_habilitado, true)
    const c = lojaDoBot({ ...LOJA, ia_whatsapp_dono: '5511999990000', ia_whatsapp_dono_confirmado_em: '2026-10-01T00:00:00Z' }, [], 'https://x', quarta)
    assert.equal(c.whatsapp_dono, '5511999990000')
    assert.equal(c.aberta_agora, true) // sem horário cadastrado não restringe
  })
  test('lojaComBotVigente: flag ligada só vale com o módulo bot vigente (fecha em erro)', async () => {
    const db = (r: { data: unknown; error: unknown } | 'lanca') => ({
      rpc: () => (r === 'lanca' ? Promise.reject(new Error('rede')) : Promise.resolve(r)),
    })
    const desligada = (b: typeof LOJA) => recusaDaAcao('pedido', 'retirada', b, true)?.codigo === 'bot_desligado'
    const off = await lojaComBotVigente(LOJA, db({ data: false, error: null }), 'b1')
    assert.equal(off.ia_habilitada, false)
    assert.equal(lojaDoBot(off, [], 'https://x', new Date()).bot_habilitado, false)
    assert.ok(desligada(off))
    const on = await lojaComBotVigente(LOJA, db({ data: true, error: null }), 'b1')
    assert.equal(on.ia_habilitada, true)
    assert.ok(!desligada(on))
    assert.equal((await lojaComBotVigente(LOJA, db({ data: true, error: { message: 'x' } }), 'b1')).ia_habilitada, false)
    assert.equal((await lojaComBotVigente(LOJA, db('lanca'), 'b1')).ia_habilitada, false)
    // flag já desligada nem consulta o banco
    const sem = { rpc: () => { throw new Error('não deveria consultar') } }
    assert.equal((await lojaComBotVigente({ ...LOJA, ia_habilitada: false }, sem, 'b1')).ia_habilitada, false)
  })
  test('telefoneSemPais tira o 55 só com 12/13 dígitos', () => {
    assert.equal(telefoneSemPais('5511999998888'), '11999998888')
    assert.equal(telefoneSemPais('551133334444'), '1133334444')
    assert.equal(telefoneSemPais('5599999999'), '5599999999') // 10 dígitos: 55 é DDD
  })
})
