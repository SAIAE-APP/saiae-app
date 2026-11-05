// Webhook e cartão aprovado com cashback: total esperado, confirmação do resgate e crédito best-effort.
// Mesmo estilo de tests/webhookCupom.test.ts; o comportamento usa um cliente do banco falso.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'
import { decidirAprovado, totalEsperadoDoPendente } from '../supabase/functions/_shared/pagamento/conciliacao.ts'
import { decidirAprovadoDoPendente } from '../supabase/functions/_shared/pagamento/webhookAprovado.ts'
import { criarPedidoAprovado } from '../supabase/functions/_shared/pagamento/pedidoAprovado.ts'

const pedidoAprovado = readFileSync(new URL('../supabase/functions/_shared/pagamento/pedidoAprovado.ts', import.meta.url), 'utf8')
const webhookAprovado = readFileSync(new URL('../supabase/functions/_shared/pagamento/webhookAprovado.ts', import.meta.url), 'utf8')

// 2 × R$ 25,00 de itens, entrega R$ 7,00, saldo de R$ 5,00 => Pix de R$ 52,00 (mesma conta do cupom).
const itens = [{ quantidade: 2, preco_centavos_unitario: 2500 }]

describe('total esperado com saldo', () => {
  test('o saldo é desconto como o cupom: 5200, e pagar o valor cheio vai para conciliação', () => {
    const esperado = totalEsperadoDoPendente(itens, 700, 500)
    assert.equal(esperado, 5200)
    assert.equal(decidirAprovado({ statusPendente: 'pendente', valorPagoCentavos: 5700, totalEsperadoCentavos: esperado }).acao, 'conciliar_valor')
  })
  test('decidirAprovadoDoPendente soma cashback_usado_centavos ao desconto do snapshot', () => {
    const pendente = { status: 'pendente', itens, taxa_entrega_centavos: 700, desconto_cupom_centavos: 0, cashback_usado_centavos: 500, taxa_plataforma_centavos: 99 }
    const r = decidirAprovadoDoPendente(pendente, { valorCentavos: 5299, comissaoCentavos: 99 })
    assert.equal(r.totalCentavos, 5299)
    assert.equal(r.decisao.acao, 'criar_pedido')
  })
  test('pendente antigo (sem a coluna) mantém a conta de antes', () => {
    const r = decidirAprovadoDoPendente({ status: 'pendente', itens, taxa_entrega_centavos: 700 }, { valorCentavos: 5700, comissaoCentavos: null })
    assert.equal(r.totalCentavos, 5700)
  })
  test('texto: webhookAprovado lê cashback_usado_centavos', () => {
    assert.match(webhookAprovado, /cashback_usado_centavos/)
  })
})

type Op = { alvo: string; op: string; valor?: unknown }
function banco(responder: (op: Op) => { data?: unknown; error?: unknown }) {
  const ops: Op[] = []
  const consulta = (op: Op) => {
    ops.push(op)
    const q: Record<string, unknown> = {
      select: () => q,
      eq: () => q,
      maybeSingle: () => q,
      single: () => q,
      then: (ok: (v: unknown) => unknown, erro: (e: unknown) => unknown) =>
        Promise.resolve({ data: null, error: null, ...responder(op) }).then(ok, erro),
    }
    return q
  }
  const cliente = {
    from: (tabela: string) => ({
      select: () => consulta({ alvo: tabela, op: 'select' }),
      update: (valor: unknown) => consulta({ alvo: tabela, op: 'update', valor }),
      upsert: (valor: unknown) => consulta({ alvo: tabela, op: 'upsert', valor }),
    }),
    rpc: (nome: string, valor: unknown) => consulta({ alvo: nome, op: 'rpc', valor }),
  }
  return { ops, supabase: cliente as never }
}

const pendenteBase = {
  id: 'pend-1',
  barraca_id: 'b',
  client_uuid: 'uuid-1',
  status: 'pendente',
  itens: [{ quantidade: 1, preco_centavos_unitario: 4000 }],
  mesa: null,
  viagem: true,
  observacao: null,
  meio_pagamento: 'cartao',
  taxa_plataforma_centavos: 99,
}
const ctx = (supabase: never, pendente: Record<string, unknown>) => ({
  supabase,
  barracaId: 'b',
  pendenteId: 'pend-1',
  provedor: 'mercadopago',
  idExterno: '555',
  origem: 'teste',
  pendente: pendente as typeof pendenteBase,
  valorPagoCentavos: 3099,
  totalCentavos: 3099,
  taxaEntregaCentavos: 0,
  taxaPlataformaCentavos: 99,
})
const respostaPedido = (op: Op) => (op.alvo === 'criar_pedido' ? { data: { pedido_id: 'ped-1', senha: 5 } } : {})

describe('pedido aprovado com cashback', () => {
  test('SUPOSIÇÃO-CASHBACK-4: sem cashback_uso_id a confirmação do resgate não acontece (pendente antigo)', async () => {
    const db = banco(respostaPedido)
    await criarPedidoAprovado(ctx(db.supabase, pendenteBase), { tardio: false })
    assert.ok(!db.ops.some((o) => o.alvo === 'cashback_confirmar_resgate'))
    assert.ok(!db.ops.some((o) => o.alvo === 'cashback_creditar_pedido'), 'sem cliente identificado não há crédito a tentar')
  })

  test('confirma o resgate ANTES de marcar o pendente aprovado e credita DEPOIS', async () => {
    const db = banco(respostaPedido)
    const r = await criarPedidoAprovado(ctx(db.supabase, { ...pendenteBase, cashback_uso_id: 'uso-1', cashback_usado_centavos: 1000, cliente_id: 'cli-1' }), { tardio: false })
    assert.equal(r.ok, true)
    const nomes = db.ops.map((o) => `${o.op}:${o.alvo}`)
    const iConfirma = nomes.indexOf('rpc:cashback_confirmar_resgate')
    const iAprova = db.ops.findIndex((o) => o.alvo === 'pagamentos_pendentes' && (o.valor as { status?: string })?.status === 'aprovado')
    const iCredita = nomes.indexOf('rpc:cashback_creditar_pedido')
    assert.ok(iConfirma > 0 && iAprova > iConfirma && iCredita > iAprova, nomes.join(' '))
    assert.deepEqual(db.ops[iConfirma].valor, { p_uso_id: 'uso-1', p_pedido_id: 'ped-1' })
  })

  test('erro ao confirmar o resgate devolve etapa cashback e não marca o pendente aprovado', async () => {
    const silencio = console.error
    console.error = () => {}
    try {
      const db = banco((op) => (op.alvo === 'cashback_confirmar_resgate' ? { error: { message: 'x' } } : respostaPedido(op)))
      const r = await criarPedidoAprovado(ctx(db.supabase, { ...pendenteBase, cashback_uso_id: 'uso-1', cliente_id: 'cli-1' }), { tardio: false })
      assert.deepEqual(r, { ok: false, etapa: 'cashback', detalhe: 'x' })
      assert.ok(!db.ops.some((o) => o.alvo === 'pagamentos_pendentes'))
    } finally {
      console.error = silencio
    }
  })

  test('falha ou exceção do crédito NUNCA derruba o pedido', async () => {
    const silencio = console.error
    console.error = () => {}
    try {
      for (const resposta of [{ error: { message: 'boom' } }, { data: { ok: false, erro: 'desligado' } }]) {
        const db = banco((op) => (op.alvo === 'cashback_creditar_pedido' ? resposta : respostaPedido(op)))
        const r = await criarPedidoAprovado(ctx(db.supabase, { ...pendenteBase, cliente_id: 'cli-1' }), { tardio: false })
        assert.deepEqual(r, { ok: true, pedidoId: 'ped-1', senha: 5 })
      }
      const db = banco((op) => (op.alvo === 'cashback_creditar_pedido' ? (() => { throw new Error('rede') })() : respostaPedido(op)))
      const r = await criarPedidoAprovado(ctx(db.supabase, { ...pendenteBase, cliente_id: 'cli-1' }), { tardio: false })
      assert.deepEqual(r, { ok: true, pedidoId: 'ped-1', senha: 5 })
    } finally {
      console.error = silencio
    }
  })

  test('crédito gerado volta no resultado (aditivo, só quando maior que zero), com a validade', async () => {
    const db = banco((op) =>
      op.alvo === 'cashback_creditar_pedido'
        ? { data: { ok: true, credito_centavos: 200 } }
        : op.alvo === 'cashback_lancamentos'
          ? { data: { expira_em: '2026-12-26T00:00:00Z' } }
          : respostaPedido(op),
    )
    const r = await criarPedidoAprovado(ctx(db.supabase, { ...pendenteBase, cliente_id: 'cli-1' }), { tardio: false })
    assert.deepEqual(r, { ok: true, pedidoId: 'ped-1', senha: 5, cashbackGeradoCentavos: 200, cashbackVenceEm: '2026-12-26T00:00:00Z' })
    const zero = banco((op) => (op.alvo === 'cashback_creditar_pedido' ? { data: { ok: true, credito_centavos: 0 } } : respostaPedido(op)))
    assert.deepEqual(await criarPedidoAprovado(ctx(zero.supabase, { ...pendenteBase, cliente_id: 'cli-1' }), { tardio: false }), { ok: true, pedidoId: 'ped-1', senha: 5 })
  })

  test('texto: o crédito fica em try/catch e nunca retorna ok:false', () => {
    const i = pedidoAprovado.indexOf("rpc('cashback_creditar_pedido'")
    assert.ok(i > pedidoAprovado.indexOf("update({ status: 'aprovado'"))
    const antes = pedidoAprovado.slice(Math.max(0, i - 400), i)
    assert.match(antes, /try \{/)
    const depois = pedidoAprovado.slice(i, pedidoAprovado.indexOf('catch', i) + 400)
    assert.doesNotMatch(depois.slice(0, depois.indexOf('catch')), /ok: false/)
  })
})
