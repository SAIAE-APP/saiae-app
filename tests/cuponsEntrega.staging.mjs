// "Pagar na entrega" com cupom CONTRA O STAGING (não roda no `npm test`).
// Precisa de: migrations de cupons aplicadas, criar-pedido-cardapio publicada, barraca-teste com
// pagar_na_entrega_habilitado e whatsapp_pedidos (o script liga e restaura).
//   STAGING_SUPABASE_URL=https://qzcqwovbbylqxljcrqhk.supabase.co STAGING_CHAVE_SERVICO=... \
//   STAGING_ANON_KEY=... node tests/cuponsEntrega.staging.mjs
// Cria pedidos de TESTE (a cozinha do staging recebe) e apaga o que criou.
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

async function pedir(corpo) {
  const client_uuid = corpo.client_uuid ?? randomUUID()
  criados.clientUuids.push(client_uuid)
  const r = await fetch(`${url}/functions/v1/criar-pedido-cardapio`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: anon, Authorization: `Bearer ${anon}` },
    body: JSON.stringify({ barraca_id: BARRACA, nome: 'TESTE cupom', telefone: '61999990000', ms_no_checkout: 5000, ...corpo, client_uuid }),
  })
  return { status: r.status, corpo: await r.json().catch(() => ({})), client_uuid }
}
async function novoCupom(campos) {
  const { data, error } = await db
    .from('cupons')
    .insert({ barraca_id: BARRACA, codigo: `E${randomUUID().slice(0, 8).toUpperCase()}`, tipo: 'fixo', valor: 100, ...campos })
    .select('*')
    .single()
  if (error) throw new Error(error.message)
  criados.cupons.push(data.id)
  return data
}

try {
  const { data: b } = await db.from('barracas').select('cupons_habilitado, pagar_na_entrega_habilitado, whatsapp_pedidos').eq('id', BARRACA).single()
  antes = b
  await db.from('barracas').update({ cupons_habilitado: true, pagar_na_entrega_habilitado: true, whatsapp_pedidos: b.whatsapp_pedidos ?? '61999990000' }).eq('id', BARRACA)
  const { data: itens } = await db.from('itens').select('id, preco_centavos').eq('barraca_id', BARRACA).eq('ativo', true).eq('esgotado', false).gt('preco_centavos', 0).order('preco_centavos', { ascending: false }).limit(1)
  const item = itens?.[0]
  if (!item) throw new Error('nenhum item ativo na barraca-teste')
  const carrinho = [{ item_id: item.id, quantidade: 2 }]
  const subtotal = item.preco_centavos * 2

  // 1) sem cupom: igual ao de sempre
  const sem = await pedir({ itens: carrinho })
  confere('sem cupom: 200 e total = subtotal', sem.status === 200 && sem.corpo.total_centavos === subtotal, JSON.stringify(sem.corpo).slice(0, 200))

  // 2) com cupom: desconta, confirma direto e grava no pedido
  const c = await novoCupom({ tipo: 'fixo', valor: 100 })
  const velho = await pedir({ itens: carrinho, cupom_codigo: c.codigo, total_esperado_centavos: subtotal })
  confere('total esperado SEM desconto => 409 com o novo total', velho.status === 409 && velho.corpo.total_centavos === subtotal - 100, JSON.stringify(velho.corpo).slice(0, 200))
  const ok = await pedir({ itens: carrinho, cupom_codigo: c.codigo.toLowerCase(), total_esperado_centavos: subtotal - 100 })
  confere('com cupom: 200 e total descontado', ok.status === 200 && ok.corpo.total_centavos === subtotal - 100 && ok.corpo.desconto_cupom_centavos === 100, JSON.stringify(ok.corpo).slice(0, 200))
  const { data: ped } = await db.from('pedidos').select('id, cupom_codigo, desconto_cupom_centavos, cupom_id').eq('client_uuid', ok.client_uuid).single()
  confere('pedido guarda código, desconto e cupom', ped.cupom_codigo === c.codigo && ped.desconto_cupom_centavos === 100 && ped.cupom_id === c.id, JSON.stringify(ped))
  const { data: usos } = await db.from('cupom_usos').select('estado, pedido_id, pagamento_pendente_id').eq('cupom_id', c.id)
  confere('1 uso, CONFIRMADO, ligado ao pedido, sem cobrança', usos.length === 1 && usos[0].estado === 'confirmado' && usos[0].pedido_id === ped.id && usos[0].pagamento_pendente_id === null, JSON.stringify(usos))

  // 3) reenvio com o mesmo client_uuid devolve o pedido já criado, com o total descontado, sem 2º uso
  const re = await pedir({ client_uuid: ok.client_uuid, itens: carrinho, cupom_codigo: c.codigo })
  const { data: usos2 } = await db.from('cupom_usos').select('id').eq('cupom_id', c.id)
  confere('reenvio idempotente: 200, total descontado e continua 1 uso', re.status === 200 && re.corpo.total_centavos === subtotal - 100 && usos2.length === 1, `${re.status} ${JSON.stringify(re.corpo).slice(0, 120)} usos=${usos2.length}`)

  // 4) limite total: o último uso vai para um só
  const um = await novoCupom({ limite_usos: 1 })
  const [a, b2] = await Promise.all([pedir({ itens: carrinho, cupom_codigo: um.codigo }), pedir({ itens: carrinho, cupom_codigo: um.codigo })])
  const oks = [a, b2].filter((r) => r.status === 200).length
  confere('2 pedidos paralelos pelo último uso: exatamente 1 vence', oks === 1, `${a.status}/${b2.status}`)
  const perdedor = [a, b2].find((r) => r.status !== 200)
  confere('quem perdeu recebe "Este cupom esgotou" e nenhum pedido é criado', perdedor?.corpo?.erro === 'Este cupom esgotou', JSON.stringify(perdedor?.corpo))

  // 5) inválido/vencido: mensagem e nenhum pedido
  const inv = await pedir({ itens: carrinho, cupom_codigo: 'NAOEXISTE' })
  const { count } = await db.from('pedidos').select('id', { count: 'exact', head: true }).eq('client_uuid', inv.client_uuid)
  confere('cupom inválido => 422 e nenhum pedido', inv.status === 422 && inv.corpo.erro === 'Cupom inválido' && count === 0, JSON.stringify(inv.corpo))

  // 6) o corpo não força desconto
  const forca = await pedir({ itens: carrinho, cupom_codigo: c.codigo, desconto_cupom_centavos: 99999, total_esperado_centavos: subtotal - 100 })
  confere('desconto no corpo é ignorado', forca.status === 200 && forca.corpo.total_centavos === subtotal - 100 || forca.status === 422, JSON.stringify(forca.corpo).slice(0, 160))
} catch (e) {
  falhas++
  console.error('ERRO NO TESTE:', e.message)
} finally {
  const { data: peds } = await db.from('pedidos').select('id').in('client_uuid', criados.clientUuids)
  const ids = (peds ?? []).map((p) => p.id)
  for (const id of criados.cupons) await db.from('cupom_usos').delete().eq('cupom_id', id)
  if (ids.length) {
    await db.from('itens_do_pedido').delete().in('pedido_id', ids)
    await db.from('pedidos').delete().in('id', ids)
  }
  if (criados.cupons.length) await db.from('cupons').delete().in('id', criados.cupons)
  await db.from('cardapio_pedidos_log').delete().in('client_uuid', criados.clientUuids)
  await db.from('cupom_tentativas_log').delete().eq('barraca_id', BARRACA).gte('criado_em', new Date(Date.now() - 3600_000).toISOString())
  if (antes) await db.from('barracas').update(antes).eq('id', BARRACA)
}
console.log(`\n${total - falhas}/${total} verificações ok${falhas ? `, ${falhas} FALHA(S)` : ''}`)
process.exit(falhas ? 1 : 0)
