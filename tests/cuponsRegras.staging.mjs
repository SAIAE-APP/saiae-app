// Teste de comportamento das regras de cupom CONTRA O STAGING (não roda no `npm test`).
//   STAGING_SUPABASE_URL=https://qzcqwovbbylqxljcrqhk.supabase.co STAGING_CHAVE_SERVICO=... \
//     node tests/cuponsRegras.staging.mjs
// A chave de serviço vem do ambiente (nunca do repositório). Aborta se a URL não for a do staging.
// Cria dados fictícios com prefixo TESTE e apaga tudo no fim; liga cupons_habilitado só durante o teste.
import { createClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'

const REF = 'qzcqwovbbylqxljcrqhk'
const url = process.env.STAGING_SUPABASE_URL ?? ''
const key = process.env.STAGING_CHAVE_SERVICO ?? ''
if (!url.includes(REF) || !key) {
  console.error(`Abortado: defina STAGING_SUPABASE_URL (com ${REF}) e STAGING_CHAVE_SERVICO.`)
  process.exit(2)
}
const db = createClient(url, key, { auth: { persistSession: false } })

const BARRACA = 'c5ef9777-0e4d-4411-b601-f73cb2306b7a' // barraca-teste do seed
let falhas = 0
let total = 0
function confere(nome, ok, detalhe = '') {
  total++
  if (!ok) falhas++
  console.log(`${ok ? 'OK  ' : 'FALHA'} ${nome}${ok ? '' : ` -> ${detalhe}`}`)
}
const rpc = async (fn, args) => {
  const { data, error } = await db.rpc(fn, args)
  if (error) throw new Error(`${fn}: ${error.message}`)
  return data
}

const criados = { cupons: [], pendentes: [], clientes: [], barracas: [] }
let flagAntes = null

async function novoCupom(barraca, campos) {
  const { data, error } = await db
    .from('cupons')
    .insert({ barraca_id: barraca, codigo: `T${randomUUID().slice(0, 8).toUpperCase()}`, tipo: 'fixo', valor: 500, ...campos })
    .select('*')
    .single()
  if (error) throw new Error(`cupom: ${error.message}`)
  criados.cupons.push(data.id)
  return data
}
async function novoPendente(barraca = BARRACA) {
  const { data, error } = await db
    .from('pagamentos_pendentes')
    .insert({ barraca_id: barraca, itens: [], client_uuid: `teste-${randomUUID()}` })
    .select('id')
    .single()
  if (error) throw new Error(`pendente: ${error.message}`)
  criados.pendentes.push(data.id)
  return data.id
}
async function novoCliente(barraca = BARRACA) {
  const tel = `619${Math.floor(10000000 + Math.random() * 89999999)}`
  const { data, error } = await db
    .from('clientes_finais')
    .insert({ barraca_id: barraca, nome: 'TESTE cupom', telefone: tel })
    .select('id')
    .single()
  if (error) throw new Error(`cliente: ${error.message}`)
  criados.clientes.push(data.id)
  return data.id
}
const reservar = (barraca, codigo, subtotal, cliente, pendente, ate) =>
  rpc('cupom_reservar', {
    p_barraca_id: barraca,
    p_codigo: codigo,
    p_subtotal_centavos: subtotal,
    p_cliente_id: cliente,
    p_pendente_id: pendente,
    p_reservado_ate: ate ?? new Date(Date.now() + 30 * 60_000).toISOString(),
  })
const em = (ms) => new Date(Date.now() + ms).toISOString()

async function limpar() {
  for (const id of criados.cupons) await db.from('cupom_usos').delete().eq('cupom_id', id)
  if (criados.cupons.length) await db.from('cupons').delete().in('id', criados.cupons)
  if (criados.pendentes.length) await db.from('pagamentos_pendentes').delete().in('id', criados.pendentes)
  if (criados.clientes.length) await db.from('clientes_finais').delete().in('id', criados.clientes)
  if (criados.barracas.length) await db.from('barracas').delete().in('id', criados.barracas)
  await db.from('cupom_tentativas_log').delete().like('ip_hash', 'teste-%')
  if (flagAntes !== null) await db.from('barracas').update({ cupons_habilitado: flagAntes }).eq('id', BARRACA)
}

try {
  const { data: b } = await db.from('barracas').select('cupons_habilitado').eq('id', BARRACA).single()
  flagAntes = b.cupons_habilitado
  await db.from('barracas').update({ cupons_habilitado: true }).eq('id', BARRACA)

  // 1) Concorrência: 10 chamadas paralelas pelo ÚLTIMO uso => exatamente 1 vence.
  {
    const c = await novoCupom(BARRACA, { limite_usos: 1 })
    const pendentes = await Promise.all(Array.from({ length: 10 }, () => novoPendente()))
    const r = await Promise.all(pendentes.map((p) => reservar(BARRACA, c.codigo, 5000, null, p)))
    const ok = r.filter((x) => x.ok).length
    confere('10 paralelas pelo último uso: exatamente 1 ok', ok === 1, `ok=${ok}`)
    confere('as outras 9 recebem "esgotou"', r.filter((x) => !x.ok && x.erro === 'esgotou').length === 9)
  }

  // 2) Pedido mínimo e validade nas bordas.
  {
    const c = await novoCupom(BARRACA, { pedido_minimo_centavos: 3000 })
    const p = await novoPendente()
    const baixo = await reservar(BARRACA, c.codigo, 2999, null, p)
    confere('mínimo: 2999 < 3000 => minimo com valor', !baixo.ok && baixo.erro === 'minimo' && baixo.minimo_centavos === 3000)
    confere('mínimo: 3000 passa', (await reservar(BARRACA, c.codigo, 3000, null, p)).ok === true)
    const futuro = await novoCupom(BARRACA, { inicio_em: em(3600_000), fim_em: em(7200_000) })
    confere('validade: ainda não começou', (await rpc('cupom_avaliar', { p_barraca_id: BARRACA, p_codigo: futuro.codigo, p_subtotal_centavos: 5000, p_cliente_id: null })).erro === 'nao_comecou')
    const passado = await novoCupom(BARRACA, { inicio_em: em(-7200_000), fim_em: em(-3600_000) })
    confere('validade: venceu', (await rpc('cupom_avaliar', { p_barraca_id: BARRACA, p_codigo: passado.codigo, p_subtotal_centavos: 5000, p_cliente_id: null })).erro === 'venceu')
  }

  // 3) Cálculo: percentual com floor, teto de R$ 1,00 nos itens.
  {
    const pc = await novoCupom(BARRACA, { tipo: 'percentual', valor: 10 })
    const r1 = await rpc('cupom_avaliar', { p_barraca_id: BARRACA, p_codigo: pc.codigo, p_subtotal_centavos: 999, p_cliente_id: null })
    confere('percentual: 10% de 999 = 99 (floor)', r1.ok && r1.desconto_centavos === 99, JSON.stringify(r1))
    const fx = await novoCupom(BARRACA, { tipo: 'fixo', valor: 450 })
    const r2 = await rpc('cupom_avaliar', { p_barraca_id: BARRACA, p_codigo: fx.codigo, p_subtotal_centavos: 500, p_cliente_id: null })
    confere('teto: fixo 450 em 500 => desconto 450 (sobra R$ 0,50)', r2.ok && r2.desconto_centavos === 450, JSON.stringify(r2))
    const cem = await novoCupom(BARRACA, { tipo: 'percentual', valor: 100 })
    const r3 = await rpc('cupom_avaliar', { p_barraca_id: BARRACA, p_codigo: cem.codigo, p_subtotal_centavos: 2000, p_cliente_id: null })
    confere('pedido grátis: 100% de 2000 => 2000 (cobre os itens inteiros)', r3.ok && r3.desconto_centavos === 2000, JSON.stringify(r3))
    const r4 = await rpc('cupom_avaliar', { p_barraca_id: BARRACA, p_codigo: cem.codigo, p_subtotal_centavos: 80, p_cliente_id: null })
    confere('pedido grátis: 100% de 80 => 80 (não há mais piso de R$ 1,00)', r4.ok && r4.desconto_centavos === 80, JSON.stringify(r4))
  }

  // 4) Uma vez por cliente: sem sessão, com reserva vigente, com confirmado.
  {
    const c = await novoCupom(BARRACA, { uma_por_cliente: true })
    const cli = await novoCliente()
    const p1 = await novoPendente()
    confere('uma_por_cliente sem sessão => precisa_login', (await reservar(BARRACA, c.codigo, 5000, null, p1)).erro === 'precisa_login')
    const r1 = await reservar(BARRACA, c.codigo, 5000, cli, p1)
    confere('uma_por_cliente: primeira reserva ok', r1.ok === true)
    // Refazer o checkout (outra cobrança do MESMO cliente): vale a mais recente, a anterior é liberada.
    const p2 = await novoPendente()
    const r3 = await reservar(BARRACA, c.codigo, 5000, cli, p2)
    confere('refazer o checkout: nova reserva do mesmo cliente passa', r3.ok === true, JSON.stringify(r3))
    const { data: uso1 } = await db.from('cupom_usos').select('estado').eq('pagamento_pendente_id', p1).single()
    confere('a reserva anterior do mesmo cliente foi liberada', uso1.estado === 'liberado', uso1.estado)
    await rpc('cupom_liberar', { p_pendente_id: p2 })
    const { data: uso2 } = await db.from('cupom_usos').select('estado').eq('pagamento_pendente_id', p2).single()
    confere('liberar devolve a vaga', uso2.estado === 'liberado', uso2.estado)
    const r3b = await reservar(BARRACA, c.codigo, 5000, cli, p2)
    confere('reservar de novo a mesma cobrança depois de liberada funciona (mesma linha)', r3b.ok === true, JSON.stringify(r3b))
    const { data: pedido } = await db.from('pedidos').select('id').eq('barraca_id', BARRACA).limit(1).maybeSingle()
    if (pedido) {
      await rpc('cupom_confirmar', { p_uso_id: r3.uso_id, p_pedido_id: pedido.id })
      const p3 = await novoPendente()
      confere('ja_usou com uso confirmado', (await reservar(BARRACA, c.codigo, 5000, cli, p3)).erro === 'ja_usou')
      const { data: ped } = await db.from('pedidos').select('cupom_codigo, desconto_cupom_centavos').eq('id', pedido.id).single()
      confere('confirmar copia cupom e desconto para o pedido', ped.cupom_codigo === c.codigo && ped.desconto_cupom_centavos === 500, JSON.stringify(ped))
      await db.from('pedidos').update({ cupom_id: null, cupom_codigo: null, desconto_cupom_centavos: 0 }).eq('id', pedido.id)
    } else {
      console.log('PULADO confirmar/ja_usou confirmado: nenhum pedido no staging para vincular')
    }
  }

  // 5) Reserva vencida não conta; confirmar depois de liberada ainda confirma; mesma pendente => 1 uso.
  {
    const c = await novoCupom(BARRACA, { limite_usos: 1 })
    const p1 = await novoPendente()
    await reservar(BARRACA, c.codigo, 5000, null, p1, em(-60_000)) // já vencida
    const p2 = await novoPendente()
    confere('reserva vencida não conta no limite', (await reservar(BARRACA, c.codigo, 5000, null, p2)).ok === true)

    const d = await novoCupom(BARRACA, { limite_usos: 5 })
    const p = await novoPendente()
    const a = await reservar(BARRACA, d.codigo, 5000, null, p)
    const b2 = await reservar(BARRACA, d.codigo, 5000, null, p)
    const { count } = await db.from('cupom_usos').select('id', { count: 'exact', head: true }).eq('pagamento_pendente_id', p)
    confere('mesma pendente duas vezes => 1 uso e mesmo id', count === 1 && a.uso_id === b2.uso_id, `count=${count}`)

    const outro = await novoCupom(BARRACA, {})
    const trocou = await reservar(BARRACA, outro.codigo, 5000, null, p)
    const { data: usos } = await db.from('cupom_usos').select('cupom_id, estado').eq('pagamento_pendente_id', p)
    confere('trocar o código: a reserva migra para o novo cupom (1 linha, cupom novo, reservado)', trocou.ok && usos.length === 1 && usos[0].cupom_id === outro.id && usos[0].estado === 'reservado', JSON.stringify(usos))
    const velho = (await db.from('cupom_usos').select('id', { count: 'exact', head: true }).eq('cupom_id', d.id).eq('estado', 'reservado')).count
    confere('o cupom antigo ficou sem reserva (vaga devolvida)', velho === 0, `reservas=${velho}`)
  }

  // 6) Isolamento entre lojas: mesmo código em duas lojas; cupom desligado na loja.
  {
    const { data: b2, error } = await db.from('barracas').insert({ nome: 'TESTE cupom outra loja', slug: `teste-cupom-${randomUUID().slice(0, 6)}` }).select('id').single()
    if (error) {
      console.log(`PULADO isolamento entre lojas: não consegui criar 2ª barraca (${error.message})`)
    } else {
      criados.barracas.push(b2.id)
      await db.from('barracas').update({ cupons_habilitado: true }).eq('id', b2.id)
      const mesmo = `ISOL${randomUUID().slice(0, 4).toUpperCase()}`
      await novoCupom(BARRACA, { codigo: mesmo, valor: 500 })
      await novoCupom(b2.id, { codigo: mesmo, valor: 700 })
      const a = await rpc('cupom_avaliar', { p_barraca_id: BARRACA, p_codigo: mesmo, p_subtotal_centavos: 5000, p_cliente_id: null })
      const b = await rpc('cupom_avaliar', { p_barraca_id: b2.id, p_codigo: mesmo, p_subtotal_centavos: 5000, p_cliente_id: null })
      confere('mesmo código em duas lojas não se cruza', a.desconto_centavos === 500 && b.desconto_centavos === 700)
    }
    const c = await novoCupom(BARRACA, {})
    await db.from('barracas').update({ cupons_habilitado: false }).eq('id', BARRACA)
    confere('loja com cupons desligados => invalido', (await rpc('cupom_avaliar', { p_barraca_id: BARRACA, p_codigo: c.codigo, p_subtotal_centavos: 5000, p_cliente_id: null })).erro === 'invalido')
    await db.from('barracas').update({ cupons_habilitado: true }).eq('id', BARRACA)
  }

  // 7) Limite de tentativas inválidas: a 16ª do mesmo IP é barrada; válida não conta.
  {
    const ip = `teste-${randomUUID()}`
    let ultimo = true
    for (let i = 1; i <= 15; i++) ultimo = ultimo && (await rpc('cupom_registrar_tentativa', { p_barraca_id: BARRACA, p_ip_hash: ip, p_valida: false }))
    confere('15 inválidas passam', ultimo === true)
    confere('a 16ª inválida do mesmo IP é barrada', (await rpc('cupom_registrar_tentativa', { p_barraca_id: BARRACA, p_ip_hash: ip, p_valida: false })) === false)
    const ip2 = `teste-${randomUUID()}`
    let okv = true
    for (let i = 1; i <= 30; i++) okv = okv && (await rpc('cupom_registrar_tentativa', { p_barraca_id: BARRACA, p_ip_hash: ip2, p_valida: true }))
    confere('tentativas válidas não contam', okv === true)
  }

  // 8) Segurança: chamada anônima às funções de reserva é recusada.
  {
    const anonKey = process.env.STAGING_ANON_KEY
    if (!anonKey) {
      console.log('PULADO anônimo: defina STAGING_ANON_KEY para conferir que anon não executa as funções')
    } else {
      const anon = createClient(url, anonKey, { auth: { persistSession: false } })
      for (const fn of ['cupom_reservar', 'cupom_avaliar', 'cupom_confirmar', 'cupom_liberar', 'cupom_registrar_tentativa']) {
        const { error } = await anon.rpc(fn, {})
        confere(`anon não executa ${fn}`, !!error && /permission|denied|not.*found|could not/i.test(error.message), error?.message)
      }
      const { data } = await anon.rpc('cupom_config', { p_slug: 'barraca-teste' })
      confere('anon executa cupom_config (só booleano)', Array.isArray(data) && data.every((x) => Object.keys(x).join() === 'habilitado'))
      const { data: leitura } = await anon.from('cupom_usos').select('id').limit(1)
      confere('anon não lê cupom_usos', !leitura || leitura.length === 0)
    }
  }
} catch (e) {
  falhas++
  console.error('ERRO NO TESTE:', e.message)
} finally {
  await limpar()
}

console.log(`\n${total - falhas}/${total} verificações ok${falhas ? `, ${falhas} FALHA(S)` : ''}`)
process.exit(falhas ? 1 : 0)
