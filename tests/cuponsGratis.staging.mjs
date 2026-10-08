// Pedido grátis (cupom de 100%) CONTRA O STAGING (não roda no `npm test`).
//   STAGING_SUPABASE_URL=https://qzcqwovbbylqxljcrqhk.supabase.co STAGING_CHAVE_SERVICO=... \
//   STAGING_ANON_KEY=... node tests/cuponsGratis.staging.mjs
// Cria pedidos de TESTE (a cozinha do staging recebe) e apaga o que criou; liga cupons_habilitado só durante o teste.
import { createClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'

const REF = 'qzcqwovbbylqxljcrqhk'
const url = process.env.STAGING_SUPABASE_URL ?? ''
const key = process.env.STAGING_CHAVE_SERVICO ?? ''
const anon = process.env.STAGING_ANON_KEY ?? ''
if (!url.includes(REF) || !key || !anon) {
  console.error(`Abortado: defina STAGING_SUPABASE_URL (com ${REF}), STAGING_CHAVE_SERVICO e STAGING_ANON_KEY.`)
  process.exit(2)
}
const db = createClient(url, key, { auth: { persistSession: false } })
const BARRACA = 'c5ef9777-0e4d-4411-b601-f73cb2306b7a'
let falhas = 0
let total = 0
const confere = (nome, ok, detalhe = '') => {
  total++
  if (!ok) falhas++
  console.log(`${ok ? 'OK  ' : 'FALHA'} ${nome}${ok ? '' : ` -> ${detalhe}`}`)
}
const criados = { cupons: [], clientUuids: [] }
let antes = null
const chamar = async (corpo) => {
  const client_uuid = corpo.client_uuid ?? randomUUID()
  criados.clientUuids.push(client_uuid)
  const r = await fetch(`${url}/functions/v1/criar-pagamento-pix`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: anon, Authorization: `Bearer ${anon}` },
    body: JSON.stringify({ barraca_id: BARRACA, ms_no_checkout: 5000, ...corpo, client_uuid }),
  })
  return { status: r.status, corpo: await r.json().catch(() => ({})), client_uuid }
}
try {
  const { data: b } = await db.from('barracas').select('cupons_habilitado').eq('id', BARRACA).single()
  antes = b
  await db.from('barracas').update({ cupons_habilitado: true }).eq('id', BARRACA)
  await db.from('cupom_tentativas_log').delete().eq('barraca_id', BARRACA)
  const { data: itens } = await db.from('itens').select('id, preco_centavos').eq('barraca_id', BARRACA).eq('ativo', true).eq('esgotado', false).gt('preco_centavos', 0).order('preco_centavos', { ascending: false }).limit(1)
  const item = itens?.[0]
  if (!item) throw new Error('nenhum item ativo na barraca-teste')
  const carrinho = [{ item_id: item.id, quantidade: 1 }]
  const { data: c } = await db.from('cupons').insert({ barraca_id: BARRACA, codigo: `G${randomUUID().slice(0, 8).toUpperCase()}`, tipo: 'percentual', valor: 100, limite_usos: 5 }).select('*').single()
  criados.cupons.push(c.id)

  const sem = await chamar({ itens: carrinho, cupom_codigo: c.codigo })
  confere('sem telefone: 422 pedindo telefone e nada criado', sem.status === 422 && /telefone/i.test(JSON.stringify(sem.corpo)), JSON.stringify([sem.status, sem.corpo]).slice(0, 200))
  const ok = await chamar({ itens: carrinho, cupom_codigo: c.codigo, cliente_telefone: '61999990000', cliente_nome: 'TESTE gratis', total_esperado_centavos: 0 })
  confere('com telefone: 200 e pedido_gratis com senha', ok.status === 200 && ok.corpo.pedido_gratis === true && Number.isInteger(ok.corpo.senha), JSON.stringify([ok.status, ok.corpo]).slice(0, 200))
  const { data: ped } = await db.from('pedidos').select('id, metodo_pagamento, cupom_codigo, desconto_cupom_centavos').eq('client_uuid', ok.client_uuid).maybeSingle()
  confere('pedido com método gratis, código e desconto cheio', ped?.metodo_pagamento === 'gratis' && ped?.cupom_codigo === c.codigo && ped?.desconto_cupom_centavos === item.preco_centavos, JSON.stringify(ped))
  const { data: usos } = await db.from('cupom_usos').select('estado, pedido_id').eq('cupom_id', c.id)
  confere('1 uso confirmado ligado ao pedido', usos.length === 1 && usos[0].estado === 'confirmado' && usos[0].pedido_id === ped?.id, JSON.stringify(usos))
  const { data: pend } = await db.from('pagamentos_pendentes').select('status, mercadopago_order_id').eq('client_uuid', ok.client_uuid).maybeSingle()
  confere('nenhuma cobrança foi criada no provedor Pix', !pend?.mercadopago_order_id, JSON.stringify(pend))
  const re = await chamar({ client_uuid: ok.client_uuid, itens: carrinho, cupom_codigo: c.codigo, cliente_telefone: '61999990000', total_esperado_centavos: 0 })
  const { data: usos2 } = await db.from('cupom_usos').select('id').eq('cupom_id', c.id)
  const { data: peds2 } = await db.from('pedidos').select('id').eq('client_uuid', ok.client_uuid)
  confere('duplo toque: mesmo pedido, 1 pedido e 1 uso', re.status === 200 && peds2.length === 1 && usos2.length === 1 && re.corpo.senha === ok.corpo.senha, JSON.stringify([re.status, re.corpo, peds2.length, usos2.length]).slice(0, 200))
  const velho = await chamar({ itens: carrinho, cupom_codigo: c.codigo, cliente_telefone: '61999990000', total_esperado_centavos: item.preco_centavos })
  confere('total esperado antigo (sem desconto) => 409', velho.status === 409, JSON.stringify([velho.status, velho.corpo]).slice(0, 200))
} catch (e) {
  confere(`ERRO NO TESTE: ${e.message}`, false)
} finally {
  const uuids = criados.clientUuids
  const { data: peds } = uuids.length ? await db.from('pedidos').select('id').in('client_uuid', uuids) : { data: [] }
  const ids = (peds ?? []).map((p) => p.id)
  if (ids.length) {
    await db.from('cupom_usos').update({ pedido_id: null }).in('pedido_id', ids)
    await db.from('eventos_saida').delete().in('pedido_id', ids)
    await db.from('itens_do_pedido').delete().in('pedido_id', ids)
    await db.from('pagamentos_pendentes').update({ pedido_id: null, cupom_uso_id: null, cupom_id: null }).in('pedido_id', ids)
    await db.from('pedidos').delete().in('id', ids)
  }
  if (uuids.length) {
    await db.from('pagamentos_pendentes').update({ cupom_uso_id: null, cupom_id: null }).in('client_uuid', uuids)
    await db.from('pagamentos_pendentes').delete().in('client_uuid', uuids)
  }
  if (criados.cupons.length) {
    await db.from('cupom_usos').delete().in('cupom_id', criados.cupons)
    await db.from('cupons').delete().in('id', criados.cupons)
  }
  await db.from('cupom_tentativas_log').delete().eq('barraca_id', BARRACA)
  if (antes) await db.from('barracas').update(antes).eq('id', BARRACA)
  console.log(`\n${total - falhas}/${total} verificações ok${falhas ? `, ${falhas} FALHA(S)` : ''}`)
  process.exit(falhas ? 1 : 0)
}
