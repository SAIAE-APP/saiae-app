// Correções da revisão dos cupons CONTRA O STAGING (não roda no `npm test`).
//   STAGING_SUPABASE_URL=https://qzcqwovbbylqxljcrqhk.supabase.co STAGING_CHAVE_SERVICO=... \
//   STAGING_ANON_KEY=... node tests/cuponsCorrecoes.staging.mjs
// Precisa da migration 20261018140000 e das funções criar-pedido-cardapio/criar-pagamento-pix publicadas.
// Cria dados de TESTE e apaga tudo; liga cupons_habilitado/pagar na entrega só durante o teste e restaura.
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
const criados = { cupons: [], pendentes: [], clientes: [], barracas: [], clientUuids: [] }
let antes = null

const novoCupom = async (campos, barraca = BARRACA) => {
  const { data, error } = await db
    .from('cupons')
    .insert({ barraca_id: barraca, codigo: `R${randomUUID().slice(0, 8).toUpperCase()}`, tipo: 'fixo', valor: 100, ...campos })
    .select('*')
    .single()
  if (error) throw new Error(`cupom: ${error.message}`)
  criados.cupons.push(data.id)
  return data
}
const novoPendente = async (barraca = BARRACA) => {
  const { data, error } = await db.from('pagamentos_pendentes').insert({ barraca_id: barraca, itens: [], client_uuid: `teste-${randomUUID()}` }).select('id').single()
  if (error) throw new Error(`pendente: ${error.message}`)
  criados.pendentes.push(data.id)
  return data.id
}
const novoCliente = async () => {
  const tel = `619${Math.floor(10000000 + Math.random() * 89999999)}`
  const { data, error } = await db.from('clientes_finais').insert({ barraca_id: BARRACA, nome: 'TESTE revisao', telefone: tel }).select('id').single()
  if (error) throw new Error(`cliente: ${error.message}`)
  criados.clientes.push(data.id)
  return data.id
}
const em = (min) => new Date(Date.now() + min * 60000).toISOString()
const reservar = (codigo, subtotal, cliente, pendente) =>
  rpc('cupom_reservar', { p_barraca_id: BARRACA, p_codigo: codigo, p_subtotal_centavos: subtotal, p_cliente_id: cliente, p_pendente_id: pendente, p_reservado_ate: em(35) })
const pedir = async (corpo) => {
  const client_uuid = corpo.client_uuid ?? randomUUID()
  criados.clientUuids.push(client_uuid)
  const r = await fetch(`${url}/functions/v1/criar-pedido-cardapio`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: anon, Authorization: `Bearer ${anon}` },
    body: JSON.stringify({ barraca_id: BARRACA, nome: 'TESTE revisao', telefone: '61999990000', ms_no_checkout: 5000, ...corpo, client_uuid }),
  })
  return { status: r.status, corpo: await r.json().catch(() => ({})), client_uuid }
}

try {
  const { data: b } = await db.from('barracas').select('cupons_habilitado, pagar_na_entrega_habilitado, whatsapp_pedidos').eq('id', BARRACA).single()
  antes = b
  await db.from('barracas').update({ cupons_habilitado: true, pagar_na_entrega_habilitado: true, whatsapp_pedidos: b.whatsapp_pedidos ?? '61999990000' }).eq('id', BARRACA)
  await db.from('cupom_tentativas_log').delete().eq('barraca_id', BARRACA)

  // I1: checkout abandonado libera a reserva antes de avaliar (limite 1 não "esgota" contra a própria reserva)
  const c1 = await novoCupom({ limite_usos: 1 })
  const pA = await novoPendente()
  const r1 = await reservar(c1.codigo, 5000, null, pA)
  confere('I1: Pix A reserva o único uso', r1.ok === true, JSON.stringify(r1))
  const pB = await novoPendente()
  const r1b = await reservar(c1.codigo, 5000, null, pB)
  confere('I1: sem liberar, o Pix B esbarra na reserva de A (esgotou)', r1b.ok === false && r1b.erro === 'esgotou', JSON.stringify(r1b))
  const n = await rpc('cupom_liberar_abandonadas', { p_barraca_id: BARRACA, p_cliente_id: null, p_pendente_anterior_id: pA })
  confere('I1: liberar o Pix anterior libera 1 reserva', n === 1, String(n))
  const r1c = await reservar(c1.codigo, 5000, null, pB)
  confere('I1: depois de liberar, o Pix B reserva', r1c.ok === true, JSON.stringify(r1c))

  // I1: cliente logado, cupom sem uma_por_cliente
  const c2 = await novoCupom({ limite_usos: 1 })
  const cli = await novoCliente()
  const pC = await novoPendente()
  await reservar(c2.codigo, 5000, cli, pC)
  const nCli = await rpc('cupom_liberar_abandonadas', { p_barraca_id: BARRACA, p_cliente_id: cli, p_pendente_anterior_id: null })
  confere('I1: liberar por cliente logado libera a reserva dele', nCli === 1, String(nCli))
  const outraLoja = await rpc('cupom_liberar_abandonadas', { p_barraca_id: randomUUID(), p_cliente_id: cli, p_pendente_anterior_id: pB })
  confere('I1: outra loja não libera reserva alheia', outraLoja === 0, String(outraLoja))

  // I2: retry da mesma cobrança reavalia com o subtotal atual (e limite 1 não esgota contra a própria reserva)
  const c3 = await novoCupom({ tipo: 'percentual', valor: 10, limite_usos: 1, pedido_minimo_centavos: 500 })
  const pD = await novoPendente()
  const a = await reservar(c3.codigo, 1000, null, pD)
  const a2 = await reservar(c3.codigo, 2000, null, pD)
  confere('I2: retry com subtotal maior recalcula o desconto', a.desconto_centavos === 100 && a2.ok === true && a2.desconto_centavos === 200 && a2.uso_id === a.uso_id, JSON.stringify([a, a2]))
  const { data: linhas } = await db.from('cupom_usos').select('estado, desconto_centavos').eq('cupom_id', c3.id)
  confere('I2: continua 1 linha reservada com o desconto novo', linhas.length === 1 && linhas[0].estado === 'reservado' && linhas[0].desconto_centavos === 200, JSON.stringify(linhas))
  const a3 = await reservar(c3.codigo, 300, null, pD)
  const { data: l3 } = await db.from('cupom_usos').select('estado').eq('cupom_id', c3.id)
  confere('I2: retry que deixa de valer devolve o erro e libera a reserva', a3.ok === false && l3[0].estado === 'liberado', JSON.stringify([a3, l3]))

  // B1: palpites bem formados e errados no endpoint de pedido contam; o 16º é barrado (429)
  const { data: itens } = await db.from('itens').select('id, preco_centavos').eq('barraca_id', BARRACA).eq('ativo', true).eq('esgotado', false).gt('preco_centavos', 0).order('preco_centavos', { ascending: false }).limit(1)
  const item = itens?.[0]
  if (!item) throw new Error('nenhum item ativo na barraca-teste')
  const carrinho = [{ item_id: item.id, quantidade: 2 }]
  const status = []
  for (let i = 0; i < 17; i++) {
    const r = await pedir({ itens: carrinho, cupom_codigo: `ZZ${String(i).padStart(4, '0')}CHUTE` })
    status.push(r.status)
  }
  confere('B1: 15 palpites errados bem formados => 422 e o 16º => 429', status.slice(0, 15).every((s) => s === 422) && status[15] === 429 && status[16] === 429, JSON.stringify(status))
  await db.from('cupom_tentativas_log').delete().eq('barraca_id', BARRACA)

  // I3: pedido e confirmação do cupom na mesma transação
  const c4 = await novoCupom({ tipo: 'fixo', valor: 100 })
  const subtotal = item.preco_centavos * 2
  const ok = await pedir({ itens: carrinho, cupom_codigo: c4.codigo, total_esperado_centavos: subtotal - 100 })
  const { data: ped } = await db.from('pedidos').select('id, cupom_codigo, desconto_cupom_centavos').eq('client_uuid', ok.client_uuid).single()
  const { data: usos } = await db.from('cupom_usos').select('estado, pedido_id').eq('cupom_id', c4.id)
  confere('I3: pedido nasce com o desconto e o uso confirmado juntos', ok.status === 200 && ped.desconto_cupom_centavos === 100 && usos.length === 1 && usos[0].estado === 'confirmado' && usos[0].pedido_id === ped.id, JSON.stringify([ok.status, ped, usos]))
  const { data: ev } = await db.rpc('montar_evento_saida', { p_evento_id: (await db.from('eventos_saida').select('id').eq('pedido_id', ped.id).order('sequence').limit(1)).data?.[0]?.id ?? randomUUID() })
  confere('I3/I4: evento (quando há integração) já sai com desconto', ev == null || ev?.pedido?.desconto_cupom_centavos === 100 || JSON.stringify(ev ?? {}).includes('desconto_cupom_centavos'), JSON.stringify(ev).slice(0, 200))

  // Re-revisão I1: dois envios do MESMO client_uuid (duplo toque) contam um uso só
  const c5 = await novoCupom({ tipo: 'fixo', valor: 100, limite_usos: 5 })
  const cu = randomUUID()
  const dup = await Promise.all([
    pedir({ client_uuid: cu, itens: carrinho, cupom_codigo: c5.codigo }),
    pedir({ client_uuid: cu, itens: carrinho, cupom_codigo: c5.codigo }),
  ])
  await pedir({ client_uuid: cu, itens: carrinho, cupom_codigo: c5.codigo })
  const { data: usos5 } = await db.from('cupom_usos').select('estado').eq('cupom_id', c5.id)
  const { data: peds5 } = await db.from('pedidos').select('id').eq('client_uuid', cu)
  confere('duplo envio: 1 pedido e no máximo 1 uso confirmado', peds5.length === 1 && usos5.filter((u) => u.estado === 'confirmado').length === 1 && !usos5.some((u) => u.estado === 'reservado'), JSON.stringify([dup.map((d) => d.status), peds5.length, usos5]))

  // B2: apagar a barraca com cupom e uso não é barrado (FK em cascata)
  const { data: b2, error: eb2 } = await db.from('barracas').insert({ nome: 'TESTE revisao exclusao', slug: `teste-rev-${randomUUID().slice(0, 6)}` }).select('id').single()
  if (eb2) throw new Error(eb2.message)
  criados.barracas.push(b2.id)
  const cx = await novoCupom({}, b2.id)
  const { data: pend } = await db.from('pagamentos_pendentes').insert({ barraca_id: b2.id, itens: [], client_uuid: `teste-${randomUUID()}` }).select('id').single()
  await db.from('cupom_usos').insert({ cupom_id: cx.id, barraca_id: b2.id, pagamento_pendente_id: pend.id, estado: 'confirmado', desconto_centavos: 100, reservado_ate: em(35) })
  await db.from('pagamentos_pendentes').delete().eq('id', pend.id)
  const del = await db.from('barracas').delete().eq('id', b2.id)
  const { count: sobrou } = await db.from('cupons').select('id', { count: 'exact', head: true }).eq('barraca_id', b2.id)
  confere('B2: excluir barraca com cupom e uso confirmado funciona e leva os cupons', !del.error && sobrou === 0, del.error?.message ?? `sobrou=${sobrou}`)
} catch (e) {
  confere(`ERRO NO TESTE: ${e.message}`, false)
} finally {
  const uuids = criados.clientUuids
  if (uuids.length) {
    const { data: peds } = await db.from('pedidos').select('id').in('client_uuid', uuids)
    const ids = (peds ?? []).map((p) => p.id)
    if (ids.length) {
      await db.from('cupom_usos').update({ pedido_id: null }).in('pedido_id', ids)
      await db.from('eventos_saida').delete().in('pedido_id', ids)
      await db.from('itens_do_pedido').delete().in('pedido_id', ids)
      await db.from('pedidos').delete().in('id', ids)
    }
  }
  if (criados.cupons.length) await db.from('pagamentos_pendentes').update({ cupom_uso_id: null, cupom_id: null }).in('cupom_id', criados.cupons)
  if (criados.pendentes.length) await db.from('pagamentos_pendentes').delete().in('id', criados.pendentes)
  if (criados.cupons.length) {
    await db.from('cupom_usos').delete().in('cupom_id', criados.cupons)
    await db.from('cupons').delete().in('id', criados.cupons)
  }
  if (criados.clientes.length) await db.from('clientes_finais').delete().in('id', criados.clientes)
  for (const id of criados.barracas) await db.from('barracas').delete().eq('id', id)
  await db.from('cupom_tentativas_log').delete().eq('barraca_id', BARRACA)
  if (antes) await db.from('barracas').update(antes).eq('id', BARRACA)
  console.log(`\n${total - falhas}/${total} verificações ok${falhas ? `, ${falhas} FALHA(S)` : ''}`)
  process.exit(falhas ? 1 : 0)
}
