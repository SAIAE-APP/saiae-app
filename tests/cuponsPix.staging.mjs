// Cupom no Pix CONTRA O STAGING (não roda no `npm test`). Precisa de: migrations de cupons aplicadas,
// criar-pagamento-pix e cupom-validar publicadas, token de TESTE do Mercado Pago salvo na barraca-teste.
//   STAGING_SUPABASE_URL=https://qzcqwovbbylqxljcrqhk.supabase.co STAGING_CHAVE_SERVICO=... \
//   STAGING_ANON_KEY=... node tests/cuponsPix.staging.mjs
// Cria cupons e cobranças fictícios (sandbox) e apaga o que criou; liga cupons_habilitado só durante o teste.
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
let flagAntes = null

async function chamar(corpo) {
  const client_uuid = corpo.client_uuid ?? randomUUID()
  criados.clientUuids.push(client_uuid)
  const r = await fetch(`${url}/functions/v1/criar-pagamento-pix`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: anon, Authorization: `Bearer ${anon}` },
    body: JSON.stringify({ barraca_id: BARRACA, ms_no_checkout: 5000, ...corpo, client_uuid }),
  })
  return { status: r.status, corpo: await r.json().catch(() => ({})), client_uuid }
}
async function novoCupom(campos) {
  const { data, error } = await db
    .from('cupons')
    .insert({ barraca_id: BARRACA, codigo: `P${randomUUID().slice(0, 8).toUpperCase()}`, tipo: 'fixo', valor: 100, ...campos })
    .select('*')
    .single()
  if (error) throw new Error(error.message)
  criados.cupons.push(data.id)
  return data
}
const usosDoPendente = async (clientUuid) => {
  const { data: p } = await db.from('pagamentos_pendentes').select('id, cupom_id, desconto_cupom_centavos, cupom_uso_id').eq('client_uuid', clientUuid).maybeSingle()
  if (!p) return { p: null, usos: [] }
  const { data: usos } = await db.from('cupom_usos').select('id, cupom_id, estado').eq('pagamento_pendente_id', p.id)
  return { p, usos: usos ?? [] }
}

try {
  const { data: b } = await db.from('barracas').select('cupons_habilitado').eq('id', BARRACA).single()
  flagAntes = b.cupons_habilitado
  await db.from('barracas').update({ cupons_habilitado: true }).eq('id', BARRACA)
  const { data: itens } = await db.from('itens').select('id, preco_centavos, ativo, esgotado').eq('barraca_id', BARRACA).eq('ativo', true).eq('esgotado', false).gt('preco_centavos', 0).order('preco_centavos', { ascending: false }).limit(5)
  // item simples (sem grupo obrigatório) de preço alto para caber o desconto
  const item = itens?.[0]
  if (!item) throw new Error('nenhum item simples ativo na barraca-teste')
  const carrinho = [{ item_id: item.id, quantidade: 2 }]
  const subtotal = item.preco_centavos * 2
  console.log(`item ${item.id} a ${item.preco_centavos} x2 => subtotal ${subtotal}`)

  // 1) sem cupom: igual ao de sempre
  const sem = await chamar({ itens: carrinho, total_esperado_centavos: subtotal })
  confere('sem cupom: 200 e total = subtotal', sem.status === 200 && sem.corpo.total_centavos === subtotal, JSON.stringify(sem.corpo).slice(0, 200))

  // 2) com cupom fixo: total descontado, pendente gravado, 1 reserva
  const fixo = await novoCupom({ tipo: 'fixo', valor: 100 })
  const antigo = await chamar({ itens: carrinho, cupom_codigo: fixo.codigo, total_esperado_centavos: subtotal })
  confere('total_esperado SEM desconto => 409 com o novo total', antigo.status === 409 && antigo.corpo.total_centavos === subtotal - 100, JSON.stringify(antigo.corpo).slice(0, 200))
  const ok = await chamar({ itens: carrinho, cupom_codigo: fixo.codigo.toLowerCase(), total_esperado_centavos: subtotal - 100 })
  confere('com cupom (minúsculas): 200 e total descontado', ok.status === 200 && ok.corpo.total_centavos === subtotal - 100 && ok.corpo.desconto_cupom_centavos === 100, JSON.stringify(ok.corpo).slice(0, 200))
  const u1 = await usosDoPendente(ok.client_uuid)
  confere('pendente guarda cupom/desconto e há 1 reserva', u1.p?.cupom_id === fixo.id && u1.p?.desconto_cupom_centavos === 100 && u1.usos.length === 1 && u1.usos[0].estado === 'reservado', JSON.stringify(u1))

  // 3) retry idempotente (mesmo client_uuid, mesmo cupom) => segue 1 reserva; total esperado = descontado
  const retry = await chamar({ client_uuid: ok.client_uuid, itens: carrinho, cupom_codigo: fixo.codigo, total_esperado_centavos: subtotal - 100 })
  const u2 = await usosDoPendente(ok.client_uuid)
  confere('retry com o mesmo client_uuid: 200 e continua 1 reserva', retry.status === 200 && u2.usos.length === 1, `${retry.status} usos=${u2.usos.length}`)

  // 4) cupom inválido / vencido / mínimo: mensagem e NENHUMA cobrança criada
  const inv = await chamar({ itens: carrinho, cupom_codigo: 'NAOEXISTE' })
  confere('cupom inexistente => 422 "Cupom inválido"', inv.status === 422 && inv.corpo.erro === 'Cupom inválido', JSON.stringify(inv.corpo))
  const { p: semCobranca } = await usosDoPendente(inv.client_uuid)
  confere('cupom inválido não cria cobrança', semCobranca === null)
  const venc = await novoCupom({ inicio_em: new Date(Date.now() - 7200_000).toISOString(), fim_em: new Date(Date.now() - 3600_000).toISOString() })
  const rv = await chamar({ itens: carrinho, cupom_codigo: venc.codigo })
  confere('cupom vencido => 422 "Este cupom venceu"', rv.status === 422 && rv.corpo.erro === 'Este cupom venceu', JSON.stringify(rv.corpo))
  const minimo = await novoCupom({ pedido_minimo_centavos: subtotal + 1000 })
  const rm = await chamar({ itens: carrinho, cupom_codigo: minimo.codigo })
  confere('pedido mínimo => 422 com o valor', rm.status === 422 && /Vale a partir de R\$/.test(rm.corpo.erro ?? ''), JSON.stringify(rm.corpo))

  // 5) trocar o código na mesma cobrança migra a reserva; tirar o código libera
  const outro = await novoCupom({ tipo: 'fixo', valor: 200 })
  const base = await chamar({ itens: carrinho, cupom_codigo: fixo.codigo, total_esperado_centavos: subtotal - 100 })
  const troca = await chamar({ client_uuid: base.client_uuid, itens: carrinho, cupom_codigo: outro.codigo, total_esperado_centavos: subtotal - 200 })
  // a cobrança do provedor só sai 1x por client_uuid: retry com cobrança emitida devolve o QR antigo (409 se total mudou)
  confere('trocar cupom com Pix já emitido => 409 "Os dados do pedido mudaram" (gerar novo Pix)', troca.status === 409, `${troca.status} ${JSON.stringify(troca.corpo).slice(0, 150)}`)

  // 6) uma_por_cliente sem sessão
  const um = await novoCupom({ uma_por_cliente: true })
  const rl = await chamar({ itens: carrinho, cupom_codigo: um.codigo })
  confere('uma_por_cliente sem sessão => precisa_login', rl.status === 422 && /Entre com seu telefone/.test(rl.corpo.erro ?? ''), JSON.stringify(rl.corpo))

  // 7) o corpo não aceita forçar desconto
  const forca = await chamar({ itens: carrinho, cupom_codigo: fixo.codigo, desconto_cupom_centavos: 99999, desconto_centavos: 99999, total_esperado_centavos: subtotal - 100 })
  confere('desconto enviado no corpo é ignorado (total segue o do banco)', forca.status === 200 && forca.corpo.total_centavos === subtotal - 100, JSON.stringify(forca.corpo).slice(0, 200))
} catch (e) {
  falhas++
  console.error('ERRO NO TESTE:', e.message)
} finally {
  const { data: pend } = await db.from('pagamentos_pendentes').select('id').in('client_uuid', criados.clientUuids)
  const ids = (pend ?? []).map((p) => p.id)
  if (ids.length) {
    await db.from('cupom_usos').delete().in('pagamento_pendente_id', ids)
    await db.from('pagamentos_pendentes').delete().in('id', ids)
  }
  for (const id of criados.cupons) await db.from('cupom_usos').delete().eq('cupom_id', id)
  if (criados.cupons.length) await db.from('cupons').delete().in('id', criados.cupons)
  await db.from('cupom_tentativas_log').delete().eq('barraca_id', BARRACA).gte('criado_em', new Date(Date.now() - 3600_000).toISOString())
  if (flagAntes !== null) await db.from('barracas').update({ cupons_habilitado: flagAntes }).eq('id', BARRACA)
}
console.log(`\n${total - falhas}/${total} verificações ok${falhas ? `, ${falhas} FALHA(S)` : ''}`)
process.exit(falhas ? 1 : 0)
