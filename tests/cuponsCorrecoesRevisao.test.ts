// Correções da revisão independente dos cupons (B1, B2, I1, I2, I3, S2). Rodar: npm test
// A prova de comportamento está em tests/cuponsCorrecoes.staging.mjs.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'

const ler = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const helper = ler('supabase/functions/_shared/cupomPedido.ts')
const pix = ler('supabase/functions/criar-pagamento-pix/index.ts')
const entrega = ler('supabase/functions/criar-pedido-cardapio/index.ts')
const mig = ler('supabase/migrations/20261018140000_cupons_correcoes_revisao.sql')

describe('B1: tentativa registrada com o resultado real', () => {
  test('avalia ANTES de registrar e registra av.ok (nunca "formato válido")', () => {
    const iAvalia = helper.indexOf("rpc('cupom_avaliar'")
    const iRegistra = helper.indexOf("rpc('cupom_registrar_tentativa'")
    assert.ok(iAvalia > 0 && iRegistra > iAvalia)
    assert.match(helper, /p_valida: av\.ok/)
    assert.doesNotMatch(helper, /p_valida: codigo !== null/)
  })
})

describe('B2: excluir conta/barraca com cupons', () => {
  test('FKs deixam de ser RESTRICT e a exclusão limpa cupons, usos e log', () => {
    assert.match(mig, /cupom_usos_cupom_id_fkey foreign key \(cupom_id\) references public\.cupons\(id\) on delete cascade/)
    assert.match(mig, /delete from public\.cupom_usos where barraca_id = v_barraca/)
    assert.match(mig, /delete from public\.cupons where barraca_id = v_barraca/)
    assert.match(mig, /delete from public\.cupom_tentativas_log where barraca_id = v_barraca/)
    assert.ok(mig.indexOf('delete from public.cupom_usos') < mig.indexOf('delete from public.barracas where id = v_barraca'))
  })
})

describe('I1: checkout refeito libera a reserva antiga antes de avaliar', () => {
  test('o Pix libera (anterior + a própria cobrança em retry) antes de avaliar', () => {
    const iLibera = pix.indexOf('liberarReservasAbandonadas(supabase')
    const iAvalia = pix.indexOf('avaliarCupomDoPedido(supabase')
    assert.ok(iLibera > 0 && iAvalia > iLibera)
    assert.match(pix, /pendente_anterior_id\?: string \| null/)
  })
  test('a função de banco só mexe em reservado, na mesma loja, e só o papel de serviço executa', () => {
    assert.match(mig, /estado = 'reservado'\s+and \(/)
    assert.match(mig, /revoke all on function public\.cupom_liberar_abandonadas\(uuid, uuid, uuid\) from public, anon, authenticated/)
  })
})

describe('I2: retry da mesma cobrança reavalia', () => {
  test('só uso confirmado é devolvido como está; reservado é reavaliado', () => {
    const reservar = mig.slice(mig.indexOf('function public.cupom_reservar'), mig.indexOf('-- I3'))
    assert.match(reservar, /if v_uso_estado = 'confirmado' then/)
    assert.doesNotMatch(reservar, /v_uso_estado = 'reservado' and v_uso_cupom = c\.id/)
    assert.match(reservar, /update public\.cupom_usos set estado = 'liberado' where id = v_uso and estado = 'reservado'/)
  })
})

describe('I3: pedido e cupom na mesma transação', () => {
  test('o pagar na entrega com cupom usa o wrapper e não confirma em chamada separada', () => {
    assert.match(entrega, /usoCupomId \? 'criar_pedido_com_cupom' : 'criar_pedido'/)
    assert.match(entrega, /p_uso_id: usoCupomId/)
    assert.doesNotMatch(entrega, /rpc\('cupom_confirmar'/)
  })
  test('o wrapper chama criar_pedido e cupom_confirmar e é só do papel de serviço', () => {
    const w = mig.slice(mig.indexOf('function public.criar_pedido_com_cupom'), mig.indexOf('-- S2'))
    assert.match(w, /from public\.criar_pedido\(/)
    assert.match(w, /perform public\.cupom_confirmar\(p_uso_id, v_pedido\)/)
    assert.match(mig, /grant execute on function public\.criar_pedido_com_cupom\([^)]*\) to service_role/)
  })
})

describe('S2: log de tentativas', () => {
  test('sem DELETE na linha quente, com índice e limpeza por cron', () => {
    const f = mig.slice(mig.indexOf('function public.cupom_registrar_tentativa'), mig.indexOf('-- Limpeza diária'))
    assert.doesNotMatch(f, /delete from/)
    assert.match(mig, /cupom_tentativas_invalidas/)
    assert.match(mig, /limpar-cupom-tentativas/)
  })
})

describe('Re-revisão: wrapper idempotente', () => {
  const m2 = ler('supabase/migrations/20261018150000_cupons_wrapper_idempotente.sql')
  test('reenvio libera o uso novo e uso inexistente vira erro', () => {
    assert.match(m2, /raise exception 'Uso de cupom inexistente para esta loja'/)
    assert.match(m2, /update public\.cupom_usos set estado = 'liberado' where id = p_uso_id and estado = 'reservado'/)
    assert.match(m2, /perform public\.cupom_confirmar\(p_uso_id, v_pedido\)/)
    assert.match(m2, /grant execute on function public\.criar_pedido_com_cupom\([^)]*\) to service_role/)
  })
})
