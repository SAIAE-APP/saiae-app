// Teste de comportamento do cashback CONTRA O STAGING (não roda no `npm test`).
//   STAGING_SUPABASE_URL=https://qzcqwovbbylqxljcrqhk.supabase.co STAGING_CHAVE_SERVICO=... \
//   STAGING_CHAVE_ANON=... node tests/cashback.staging.mjs
// As chaves vêm do ambiente (nunca do repositório). Aborta se a URL não for a do staging.
// STAGING_CHAVE_ANON só é necessária para o caso 8 (RLS com JWT de usuário); sem ela o caso é PULADO e avisado.
// Cria dados fictícios com prefixo TESTE-CASHBACK e apaga tudo no fim; liga cashback_habilitado só durante o teste.
// Cobre a spec docs/superpowers/specs/2026-10-27-cashback-design.md e os itens "Review Focus" do plano.
import { createClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'

const REF = 'qzcqwovbbylqxljcrqhk'
const url = process.env.STAGING_SUPABASE_URL ?? ''
const key = process.env.STAGING_CHAVE_SERVICO ?? ''
const anonKey = process.env.STAGING_CHAVE_ANON ?? ''
if (!url.includes(REF) || !key) {
  console.error(`Abortado: defina STAGING_SUPABASE_URL (com ${REF}) e STAGING_CHAVE_SERVICO.`)
  process.exit(2)
}
const db = createClient(url, key, { auth: { persistSession: false } })

const BARRACA = 'c5ef9777-0e4d-4411-b601-f73cb2306b7a' // barraca-teste do seed
const vetores = JSON.parse(readFileSync(new URL('./fixtures/cashback-vetores.json', import.meta.url), 'utf8'))

let falhas = 0
let total = 0
function ok(nome, condicao, detalhe = '') {
  total++
  if (!condicao) falhas++
  console.log(`${condicao ? 'OK  ' : 'FALHA'} ${nome}${condicao ? '' : ` -> ${detalhe}`}`)
}
const rpc = async (fn, args) => {
  const { data, error } = await db.rpc(fn, args)
  if (error) throw new Error(`${fn}: ${error.message}`)
  return data
}
const em = (ms) => new Date(Date.now() + ms).toISOString()

const criados = { barracas: [], clientes: [], pendentes: [], pedidos: [], usuarios: [] }
let configAntes = null

async function novaBarraca() {
  const slug = `teste-cashback-${randomUUID().slice(0, 8)}`
  const { data, error } = await db.from('barracas').insert({ nome: 'TESTE-CASHBACK', slug }).select('id').single()
  if (error) throw new Error(`barraca: ${error.message}`)
  criados.barracas.push(data.id)
  return data.id
}
async function novoCliente(barraca = BARRACA, confirmado = true) {
  const tel = `619${Math.floor(10000000 + Math.random() * 89999999)}`
  const { data, error } = await db
    .from('clientes_finais')
    .insert({ barraca_id: barraca, nome: 'TESTE-CASHBACK', telefone: tel, telefone_confirmado_em: confirmado ? new Date().toISOString() : null })
    .select('id')
    .single()
  if (error) throw new Error(`cliente: ${error.message}`)
  criados.clientes.push(data.id)
  return data.id
}
async function novoPendente(barraca = BARRACA, extra = {}) {
  const { data, error } = await db
    .from('pagamentos_pendentes')
    .insert({ barraca_id: barraca, itens: [], client_uuid: `teste-cashback-${randomUUID()}`, ...extra })
    .select('id')
    .single()
  if (error) throw new Error(`pendente: ${error.message}`)
  criados.pendentes.push(data.id)
  return data.id
}
// Pedido com itens (total em centavos) pago online (pendente aprovado ligado ao pedido).
async function novoPedido({ barraca = BARRACA, cliente = null, itens = 4000, cupom = 0, usado = 0, pago = true } = {}) {
  const { data, error } = await db
    .from('pedidos')
    .insert({ barraca_id: barraca, cliente_id: cliente, desconto_cupom_centavos: cupom, cashback_usado_centavos: usado })
    .select('id')
    .single()
  if (error) throw new Error(`pedido: ${error.message}`)
  criados.pedidos.push(data.id)
  const it = await db
    .from('itens_do_pedido')
    .insert({ pedido_id: data.id, barraca_id: barraca, nome_item: 'TESTE-CASHBACK', quantidade: 1, preco_centavos_unitario: itens })
  if (it.error) throw new Error(`item: ${it.error.message}`)
  if (pago) await novoPendente(barraca, { pedido_id: data.id, status: 'aprovado' })
  return data.id
}
const credito = (cliente, valor, dias = 30, barraca = BARRACA) =>
  db.from('cashback_lancamentos').insert({ barraca_id: barraca, cliente_id: cliente, tipo: 'credito', valor_centavos: valor, expira_em: em(dias * 86_400_000) })
const saldo = async (cliente, barraca = BARRACA) => (await rpc('cashback_saldo', { p_barraca_id: barraca, p_cliente_id: cliente }))[0]
const somaRazao = async (cliente) => {
  const { data } = await db.from('cashback_lancamentos').select('valor_centavos').eq('cliente_id', cliente)
  return (data ?? []).reduce((s, l) => s + l.valor_centavos, 0)
}
const contar = async (filtro) => {
  let q = db.from('cashback_lancamentos').select('id', { count: 'exact', head: true })
  for (const [k, v] of Object.entries(filtro)) q = q.eq(k, v)
  return (await q).count ?? 0
}
const reservar = (cliente, pendente, itens = 4000, ate = em(30 * 60_000), barraca = BARRACA) =>
  rpc('cashback_reservar', { p_barraca_id: barraca, p_cliente_id: cliente, p_itens_centavos: itens, p_pendente_id: pendente, p_reservado_ate: ate })

async function limpar() {
  const ids = [...criados.barracas, BARRACA]
  // Razão e reservas dos dados de teste (service_role ignora RLS; o razão é só-inserção para o app, não para a limpeza).
  if (criados.clientes.length) {
    await db.from('cashback_lancamentos').delete().in('cliente_id', criados.clientes)
    await db.from('cashback_resgates').delete().in('cliente_id', criados.clientes)
  }
  await db.from('cashback_lancamentos').delete().in('barraca_id', ids).is('cliente_id', null).is('pedido_id', null)
  if (criados.pedidos.length) {
    await db.from('cashback_lancamentos').delete().in('pedido_id', criados.pedidos)
    await db.from('itens_do_pedido').delete().in('pedido_id', criados.pedidos)
  }
  if (criados.pendentes.length) {
    await db.from('cashback_resgates').delete().in('pagamento_pendente_id', criados.pendentes)
    await db.from('pagamentos_pendentes').delete().in('id', criados.pendentes)
  }
  if (criados.pedidos.length) await db.from('pedidos').delete().in('id', criados.pedidos)
  if (criados.clientes.length) await db.from('clientes_finais').delete().in('id', criados.clientes)
  if (criados.usuarios.length) {
    await db.from('usuarios_barracas').delete().in('usuario_id', criados.usuarios)
    for (const id of criados.usuarios) await db.auth.admin.deleteUser(id)
  }
  if (criados.barracas.length) await db.from('barracas').delete().in('id', criados.barracas)
  if (configAntes) await db.from('barracas').update(configAntes).eq('id', BARRACA)
}

try {
  const { data: b } = await db
    .from('barracas')
    .select('cashback_habilitado, cashback_termo_aceito_em, cashback_percentual_bp, cashback_teto_uso_pct, cashback_validade_dias')
    .eq('id', BARRACA)
    .single()
  configAntes = b
  const ligar = (habilitado) =>
    db.from('barracas').update({ cashback_habilitado: habilitado, cashback_termo_aceito_em: new Date().toISOString(), cashback_percentual_bp: 500, cashback_teto_uso_pct: 50, cashback_validade_dias: 60 }).eq('id', BARRACA)
  await ligar(true)

  // 1) Paridade: todos os vetores contra as duas funções SQL.
  {
    let erros = []
    for (const v of vetores.credito) {
      const r = await rpc('cashback_calcular_credito', { p_itens_liquidos: v.itensLiquidos, p_percentual_bp: v.percentualBp })
      if (r !== v.esperado) erros.push(`${v.nome}: ${r} != ${v.esperado}`)
    }
    for (const v of vetores.resgate) {
      const r = await rpc('cashback_calcular_resgate', { p_saldo: v.saldo, p_itens: v.itens, p_teto_uso_pct: v.tetoUsoPct })
      if (r !== v.esperado) erros.push(`${v.nome}: ${r} != ${v.esperado}`)
    }
    ok(`1) paridade: ${vetores.credito.length} vetores de crédito e ${vetores.resgate.length} de resgate`, erros.length === 0, erros.join('; '))
  }

  // 2) Idempotência: crédito, confirmação do resgate e estorno duas vezes.
  {
    const cli = await novoCliente()
    const ped = await novoPedido({ cliente: cli })
    await rpc('cashback_creditar_pedido', { p_pedido_id: ped })
    await rpc('cashback_creditar_pedido', { p_pedido_id: ped })
    ok('2) crédito duas vezes => um lançamento', (await contar({ pedido_id: ped, tipo: 'credito' })) === 1)

    const ped2 = await novoPedido({ cliente: cli })
    const pend = await novoPendente()
    const r = await reservar(cli, pend)
    ok('2) reserva com saldo ganho => ok', r.ok === true, JSON.stringify(r))
    await rpc('cashback_confirmar_resgate', { p_uso_id: r.uso_id, p_pedido_id: ped2 })
    await rpc('cashback_confirmar_resgate', { p_uso_id: r.uso_id, p_pedido_id: ped2 })
    ok('2) confirmar duas vezes => um resgate', (await contar({ cliente_id: cli, tipo: 'resgate' })) === 1)

    await rpc('cashback_estornar_pedido', { p_pedido_id: ped2 })
    await rpc('cashback_estornar_pedido', { p_pedido_id: ped2 })
    ok('2) estornar duas vezes => um estorno_resgate', (await contar({ pedido_id: ped2, tipo: 'estorno_resgate' })) === 1)
    ok('2) razão final do cliente nunca negativa', (await somaRazao(cli)) >= 0)
  }

  // 3) Corrida: duas reservas simultâneas pelo mesmo saldo (Review Focus 2).
  {
    const cli = await novoCliente()
    await credito(cli, 1000)
    const [p1, p2] = [await novoPendente(), await novoPendente()]
    const [a, c] = await Promise.all([reservar(cli, p1), reservar(cli, p2)])
    const vencedores = [a, c].filter((x) => x.ok)
    ok('3) corrida: exatamente uma reserva leva o valor cheio', vencedores.length === 1 && vencedores[0].resgate_centavos === 1000, JSON.stringify([a, c]))
    ok('3) corrida: a outra recebe sem_saldo', [a, c].filter((x) => !x.ok && x.erro === 'sem_saldo').length === 1)
    ok('3) corrida: razão nunca negativo', (await somaRazao(cli)) >= 0)
  }

  // 4) Reserva vencida + saldo gasto em outro pedido + confirmação (Review Focus 2).
  {
    const cli = await novoCliente()
    await credito(cli, 1000)
    const [p1, p2] = [await novoPendente(), await novoPendente()]
    const a = await reservar(cli, p1, 4000, em(-60_000)) // reserva já vencida
    const outro = await reservar(cli, p2)
    const pedB = await novoPedido({ cliente: cli, usado: 1000 })
    await rpc('cashback_confirmar_resgate', { p_uso_id: outro.uso_id, p_pedido_id: pedB })
    const pedA = await novoPedido({ cliente: cli, usado: 1000 })
    await rpc('cashback_confirmar_resgate', { p_uso_id: a.uso_id, p_pedido_id: pedA })
    const { data: res } = await db.from('cashback_resgates').select('excedente_centavos, estado').eq('id', a.uso_id).single()
    const { data: ped } = await db.from('pedidos').select('cashback_usado_centavos').eq('id', pedA).single()
    ok('4) razão >= 0 depois de pagar reserva vencida', (await somaRazao(cli)) >= 0)
    ok('4) excedente_centavos > 0 e resgate confirmado', res.excedente_centavos > 0 && res.estado === 'confirmado', JSON.stringify(res))
    ok('4) pedido guarda o desconto cheio', ped.cashback_usado_centavos === 1000)
  }

  // 5) Saldo vencido não ressuscita (Review Focus 1).
  {
    const cli = await novoCliente()
    await db.from('cashback_lancamentos').insert({ barraca_id: BARRACA, cliente_id: cli, tipo: 'credito', valor_centavos: 700, expira_em: em(-2 * 86_400_000) })
    ok('5) cashback_saldo = 0 após o vencimento, antes de materializar', (await saldo(cli)).saldo_centavos === 0)
    const ped = await novoPedido({ cliente: cli })
    await rpc('cashback_creditar_pedido', { p_pedido_id: ped })
    ok('5) só o crédito novo sobra (200)', (await saldo(cli)).saldo_centavos === 200 && (await somaRazao(cli)) === 200)
    ok('5) expiração do saldo antigo gravada uma vez', (await contar({ cliente_id: cli, tipo: 'expiracao' })) === 1)
  }

  // 6) Sem identidade nunca credita (Review Focus 4).
  {
    const semTel = await novoCliente(BARRACA, false)
    const p1 = await novoPedido({ cliente: semTel })
    const p2 = await novoPedido({ cliente: null })
    const r1 = await rpc('cashback_creditar_pedido', { p_pedido_id: p1 })
    const r2 = await rpc('cashback_creditar_pedido', { p_pedido_id: p2 })
    ok('6) telefone não confirmado => ok:false', r1.ok === false && r1.erro === 'telefone_nao_confirmado', JSON.stringify(r1))
    ok('6) pedido sem cliente => ok:false', r2.ok === false && r2.erro === 'sem_cliente', JSON.stringify(r2))
    ok('6) nenhuma linha criada', (await contar({ pedido_id: p1 })) === 0 && (await contar({ pedido_id: p2 })) === 0)
  }

  // 7) Desligar: novos créditos param, saldo existente segue usável (SUPOSIÇÃO-CASHBACK-2).
  {
    const cli = await novoCliente()
    await credito(cli, 1000)
    await ligar(false)
    const ped = await novoPedido({ cliente: cli })
    const r = await rpc('cashback_creditar_pedido', { p_pedido_id: ped })
    ok('7) desligado => creditar devolve desligado', r.ok === false && r.erro === 'desligado', JSON.stringify(r))
    const rv = await reservar(cli, await novoPendente())
    ok('7) desligado => reservar ainda usa o saldo', rv.ok === true && rv.resgate_centavos === 1000, JSON.stringify(rv))
    await ligar(true)
  }

  // 8) RLS: anônimo e dono de OUTRA loja não leem; ninguém escreve; dono da loja lê; resumo de outra loja = zeros.
  {
    if (!anonKey) {
      console.log('PULADO 8) RLS com JWT: defina STAGING_CHAVE_ANON para executar este caso')
    } else {
      const cli = await novoCliente()
      await credito(cli, 500)
      const outraLoja = await novaBarraca()
      const mk = async (barraca) => {
        const email = `teste-cashback-${randomUUID().slice(0, 8)}@example.test`
        const senha = `T${randomUUID()}`
        const { data, error } = await db.auth.admin.createUser({ email, password: senha, email_confirm: true })
        if (error) throw new Error(`usuario: ${error.message}`)
        criados.usuarios.push(data.user.id)
        await db.from('usuarios_barracas').insert({ usuario_id: data.user.id, barraca_id: barraca, papel: 'dono' })
        const c = createClient(url, anonKey, { auth: { persistSession: false } })
        const { error: e2 } = await c.auth.signInWithPassword({ email, password: senha })
        if (e2) throw new Error(`login: ${e2.message}`)
        return c
      }
      const dono = await mk(BARRACA)
      const donoOutro = await mk(outraLoja)
      const anon = createClient(url, anonKey, { auth: { persistSession: false } })
      const le = async (c) => (await c.from('cashback_lancamentos').select('id').eq('barraca_id', BARRACA)).data?.length ?? 0
      ok('8) anônimo lê 0 linhas', (await le(anon)) === 0)
      ok('8) dono de OUTRA loja lê 0 linhas', (await le(donoOutro)) === 0)
      ok('8) dono da loja lê as próprias linhas', (await le(dono)) >= 1)
      const ins = await dono.from('cashback_lancamentos').insert({ barraca_id: BARRACA, cliente_id: cli, tipo: 'credito', valor_centavos: 999 })
      ok('8) dono não escreve direto no razão', !!ins.error)
      const insAnon = await anon.from('cashback_lancamentos').insert({ barraca_id: BARRACA, cliente_id: cli, tipo: 'credito', valor_centavos: 999 })
      ok('8) anônimo não escreve no razão', !!insAnon.error)
      const rs = await donoOutro.rpc('cashback_resumo', { p_barraca_id: BARRACA, p_de: em(-86_400_000), p_ate: em(86_400_000) })
      const linha = rs.data?.[0] ?? {}
      ok('8) cashback_resumo de outra loja devolve zeros', Object.values(linha).every((v) => Number(v) === 0), JSON.stringify(rs))
      const rsDono = await dono.rpc('cashback_resumo', { p_barraca_id: BARRACA, p_de: em(-86_400_000), p_ate: em(86_400_000) })
      ok('8) cashback_resumo do dono enxerga o concedido', Number(rsDono.data?.[0]?.concedido_centavos ?? 0) >= 500, JSON.stringify(rsDono))
    }
  }

  // 9) cliente_apagar_dados: saldo some, razão anonimizado com valores intactos.
  {
    const cli = await novoCliente()
    await credito(cli, 800)
    const antes = await somaRazao(cli)
    await rpc('cliente_apagar_dados', { p_cliente_id: cli })
    const { data: anon } = await db.from('cashback_lancamentos').select('cliente_id, valor_centavos').eq('barraca_id', BARRACA).is('cliente_id', null).eq('valor_centavos', 800)
    ok('9) saldo do cliente apagado = 0', (await saldo(cli)).saldo_centavos === 0 && antes === 800)
    ok('9) linhas do razão ficam com cliente_id nulo e valor intacto', (anon ?? []).length >= 1)
    criados.clientes = criados.clientes.filter((x) => x !== cli)
  }

  // 10) Excluir a barraca com razão e reservas: não falha e não deixa órfão.
  {
    const loja = await novaBarraca()
    const cli = await novoCliente(loja)
    await db.from('barracas').update({ cashback_habilitado: true, cashback_termo_aceito_em: new Date().toISOString() }).eq('id', loja)
    await credito(cli, 600, 30, loja)
    const pend = await novoPendente(loja)
    await reservar(cli, pend, 4000, em(30 * 60_000), loja)
    await db.from('pagamentos_pendentes').delete().eq('barraca_id', loja)
    await db.from('clientes_finais').delete().eq('barraca_id', loja)
    const { error } = await db.from('barracas').delete().eq('id', loja)
    ok('10) excluir a barraca com razão e reservas não falha', !error, error?.message)
    const l = await db.from('cashback_lancamentos').select('id', { count: 'exact', head: true }).eq('barraca_id', loja)
    const r = await db.from('cashback_resgates').select('id', { count: 'exact', head: true }).eq('barraca_id', loja)
    ok('10) nenhuma linha órfã de razão ou reserva', (l.count ?? 0) === 0 && (r.count ?? 0) === 0)
    criados.barracas = criados.barracas.filter((x) => x !== loja)
    criados.clientes = criados.clientes.filter((x) => x !== cli)
    criados.pendentes = criados.pendentes.filter((x) => x !== pend)
  }
} catch (e) {
  falhas++
  console.error('ERRO NO TESTE:', e.message)
} finally {
  await limpar().catch((e) => console.error('Falha ao limpar:', e.message))
}

console.log(`\n${total - falhas}/${total} verificações ok`)
process.exit(falhas === 0 ? 0 : 1)
