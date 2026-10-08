// Roteiro ponta a ponta dos cupons CONTRA O STAGING (não roda no `npm test`). Junta o que os outros scripts
// provam em separado: cupom -> pedido com desconto (pagar na entrega) -> uso confirmado -> relatório ->
// evento do CRM; e a vida de uma reserva de Pix (reserva, expira, libera, aprovado tardio ainda confirma).
//   STAGING_SUPABASE_URL=https://qzcqwovbbylqxljcrqhk.supabase.co STAGING_CHAVE_SERVICO=... \
//   STAGING_ANON_KEY=... node tests/cuponsE2E.staging.mjs
// Pré-requisitos: migrations de cupons (inclui 20261018130000), criar-pedido-cardapio publicada.
// O Pix real (webhook do Mercado Pago) NÃO é simulado aqui: a ponta final é o Pix de valor baixo na loja de teste.
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
const rpc = async (fn, args) => {
  const { data, error } = await db.rpc(fn, args)
  if (error) throw new Error(`${fn}: ${error.message}`)
  return data
}
const criados = { cupons: [], clientUuids: [], pendentes: [], eventos: [] }
let antes = null

async function novoCupom(campos) {
  const { data, error } = await db
    .from('cupons')
    .insert({ barraca_id: BARRACA, codigo: `X${randomUUID().slice(0, 8).toUpperCase()}`, tipo: 'fixo', valor: 100, ...campos })
    .select('*')
    .single()
  if (error) throw new Error(error.message)
  criados.cupons.push(data.id)
  return data
}
async function novoPendente() {
  const { data, error } = await db.from('pagamentos_pendentes').insert({ barraca_id: BARRACA, itens: [], client_uuid: `teste-${randomUUID()}` }).select('id').single()
  if (error) throw new Error(error.message)
  criados.pendentes.push(data.id)
  return data.id
}
async function pedir(corpo) {
  const client_uuid = randomUUID()
  criados.clientUuids.push(client_uuid)
  const r = await fetch(`${url}/functions/v1/criar-pedido-cardapio`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: anon, Authorization: `Bearer ${anon}` },
    body: JSON.stringify({ barraca_id: BARRACA, nome: 'TESTE cupom', telefone: '61999990000', ms_no_checkout: 5000, client_uuid, ...corpo }),
  })
  return { status: r.status, corpo: await r.json().catch(() => ({})), client_uuid }
}
const reservar = (codigo, subtotal, pendente, cliente = null, ate = new Date(Date.now() + 30 * 60_000).toISOString()) =>
  rpc('cupom_reservar', { p_barraca_id: BARRACA, p_codigo: codigo, p_subtotal_centavos: subtotal, p_cliente_id: cliente, p_pendente_id: pendente, p_reservado_ate: ate })

try {
  const { data: b } = await db.from('barracas').select('cupons_habilitado, pagar_na_entrega_habilitado, whatsapp_pedidos').eq('id', BARRACA).single()
  antes = b
  await db.from('barracas').update({ cupons_habilitado: true, pagar_na_entrega_habilitado: true, whatsapp_pedidos: b.whatsapp_pedidos ?? '61999990000' }).eq('id', BARRACA)
  const { data: itens } = await db.from('itens').select('id, preco_centavos').eq('barraca_id', BARRACA).eq('ativo', true).eq('esgotado', false).gt('preco_centavos', 0).order('preco_centavos', { ascending: false }).limit(1)
  const item = itens?.[0]
  if (!item) throw new Error('nenhum item ativo na barraca-teste')
  const carrinho = [{ item_id: item.id, quantidade: 2 }]
  const subtotal = item.preco_centavos * 2

  // 1) Cupom -> pedido com desconto -> uso confirmado
  const cupom = await novoCupom({ tipo: 'fixo', valor: 100 })
  const ped = await pedir({ itens: carrinho, cupom_codigo: cupom.codigo, total_esperado_centavos: subtotal - 100 })
  confere('pedido com cupom: 200 e total descontado', ped.status === 200 && ped.corpo.total_centavos === subtotal - 100, JSON.stringify(ped.corpo).slice(0, 160))
  const { data: pedido } = await db.from('pedidos').select('id, status, cupom_codigo, desconto_cupom_centavos').eq('client_uuid', ped.client_uuid).single()
  confere('pedido guarda código e desconto', pedido.cupom_codigo === cupom.codigo && pedido.desconto_cupom_centavos === 100, JSON.stringify(pedido))
  const { data: usos } = await db.from('cupom_usos').select('estado').eq('cupom_id', cupom.id)
  confere('uso confirmado', usos.length === 1 && usos[0].estado === 'confirmado')

  // 2) Cupom editado/pausado/apagado depois não muda o pedido antigo
  await db.from('cupons').update({ valor: 999, ativo: false }).eq('id', cupom.id)
  const { data: depois } = await db.from('pedidos').select('cupom_codigo, desconto_cupom_centavos').eq('id', pedido.id).single()
  confere('editar/pausar o cupom não muda o pedido antigo', depois.desconto_cupom_centavos === 100 && depois.cupom_codigo === cupom.codigo)

  // 3) Relatório: o desconto sai à parte (mesma conta do app: soma dos não cancelados)
  const { data: dia } = await db.from('pedidos').select('status, desconto_cupom_centavos').eq('barraca_id', BARRACA).in('client_uuid', criados.clientUuids)
  const somaDescontos = (dia ?? []).filter((p) => p.status !== 'cancelado').reduce((s, p) => s + (p.desconto_cupom_centavos ?? 0), 0)
  confere('descontos do período somam 100 (à parte dos itens)', somaDescontos === 100, String(somaDescontos))

  // 4) Evento para o CRM: monta o envelope com cupom e total pago (linha de outbox criada só para o teste)
  const { data: ev, error: erroEv } = await db.from('eventos_saida').insert({ barraca_id: BARRACA, pedido_id: pedido.id, tipo: 'order.created', sequence: 9000 + Math.floor(Math.random() * 900), status_pedido: pedido.status }).select('id').single()
  if (erroEv) {
    console.log(`PULADO evento: não consegui criar linha no outbox (${erroEv.message})`)
  } else {
    criados.eventos.push(ev.id)
    const env = await rpc('montar_evento_saida', { p_evento_id: ev.id })
    const d = env?.data ?? {}
    confere('evento leva cupom_codigo e desconto', d.cupom_codigo === cupom.codigo && d.desconto_cupom_centavos === 100, JSON.stringify(d).slice(0, 200))
    confere('evento: total_centavos é o PAGO (itens − desconto + taxa)', d.total_centavos === subtotal - 100 + (d.taxa_entrega_centavos ?? 0), `${d.total_centavos}`)
  }

  // 5) Ciclo de vida da reserva de um Pix (sem provedor): reserva -> expira -> libera -> aprovado tardio confirma
  const c2 = await novoCupom({ limite_usos: 1 })
  const p1 = await novoPendente()
  const r1 = await reservar(c2.codigo, subtotal, p1)
  confere('Pix aberto: cupom reservado', r1.ok === true)
  const p2 = await novoPendente()
  confere('enquanto a reserva vale, o último uso não é de outro', (await reservar(c2.codigo, subtotal, p2)).erro === 'esgotou')
  await rpc('cupom_liberar', { p_pendente_id: p1 })
  confere('Pix expirou: a vaga volta', (await reservar(c2.codigo, subtotal, p2)).ok === true)
  await rpc('cupom_confirmar', { p_uso_id: r1.uso_id, p_pedido_id: pedido.id })
  const { data: u1 } = await db.from('cupom_usos').select('estado').eq('id', r1.uso_id).single()
  confere('aprovado DEPOIS de expirar ainda confirma (pagamento aprovado nunca é recusado)', u1.estado === 'confirmado', u1.estado)
  await rpc('cupom_confirmar', { p_uso_id: r1.uso_id, p_pedido_id: pedido.id })
  const { data: u1b } = await db.from('cupom_usos').select('estado').eq('id', r1.uso_id).single()
  confere('confirmar de novo (webhook duplicado) é no-op', u1b.estado === 'confirmado')
  await db.from('pedidos').update({ cupom_id: null, cupom_codigo: null, desconto_cupom_centavos: 0 }).eq('id', pedido.id)

  // 6) Segurança: anon não executa as funções de regra e não lê o uso
  const anonDb = createClient(url, anon, { auth: { persistSession: false } })
  for (const fn of ['cupom_reservar', 'cupom_avaliar', 'cupom_confirmar', 'cupom_liberar', 'cupom_liberar_uso', 'cupom_registrar_tentativa']) {
    const { error } = await anonDb.rpc(fn, {})
    confere(`anon não executa ${fn}`, !!error && /permission|denied|could not find|not found/i.test(error.message ?? ''), error?.message)
  }
  const { data: leitura } = await anonDb.from('cupom_usos').select('id').limit(1)
  confere('anon não lê cupom_usos', !leitura || leitura.length === 0)
} catch (e) {
  falhas++
  console.error('ERRO NO TESTE:', e.message)
} finally {
  const { data: peds } = await db.from('pedidos').select('id').in('client_uuid', criados.clientUuids)
  const ids = (peds ?? []).map((p) => p.id)
  if (criados.eventos.length) await db.from('eventos_saida').delete().in('id', criados.eventos)
  for (const id of criados.cupons) await db.from('cupom_usos').delete().eq('cupom_id', id)
  if (ids.length) {
    await db.from('itens_do_pedido').delete().in('pedido_id', ids)
    await db.from('pedidos').delete().in('id', ids)
  }
  if (criados.pendentes.length) await db.from('pagamentos_pendentes').delete().in('id', criados.pendentes)
  if (criados.cupons.length) await db.from('cupons').delete().in('id', criados.cupons)
  await db.from('cardapio_pedidos_log').delete().in('client_uuid', criados.clientUuids)
  await db.from('cupom_tentativas_log').delete().eq('barraca_id', BARRACA).gte('criado_em', new Date(Date.now() - 3600_000).toISOString())
  if (antes) await db.from('barracas').update(antes).eq('id', BARRACA)
}
console.log(`\n${total - falhas}/${total} verificações ok${falhas ? `, ${falhas} FALHA(S)` : ''}`)
process.exit(falhas ? 1 : 0)
