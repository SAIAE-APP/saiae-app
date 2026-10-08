// Regras de cupom no banco: só o papel de serviço executa, reserva trava a linha, teto de R$ 1,00. Rodar: npm test
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const sql = readFileSync(new URL('../supabase/migrations/20261018110000_cupons_regras.sql', import.meta.url), 'utf8')

test('funções de regra: revoke geral e grant só ao papel de serviço (apagar é do dono autenticado)', () => {
  for (const f of ['cupom_avaliar', 'cupom_reservar', 'cupom_confirmar', 'cupom_liberar', 'cupom_registrar_tentativa']) {
    assert.match(sql, new RegExp(`revoke all on function public\\.${f}\\([^)]*\\) from public, anon, authenticated`), f)
    assert.match(sql, new RegExp(`grant execute on function public\\.${f}\\([^)]*\\) to service_role`), f)
  }
  assert.match(sql, /revoke all on function public\.cupom_regras\([^)]*\) from public, anon, authenticated/)
  assert.doesNotMatch(sql, /grant execute on function public\.cupom_regras/)
  assert.match(sql, /grant execute on function public\.cupom_apagar\(uuid\) to authenticated/)
  assert.doesNotMatch(sql, /to anon/)
})

test('reserva trava a linha do cupom (disputa pelo último uso)', () => {
  const reservar = sql.slice(sql.indexOf('function public.cupom_reservar'), sql.indexOf('function public.cupom_confirmar'))
  assert.match(reservar, /for update/)
  assert.match(reservar, /cupons_habilitado/)
})

test('avaliar não grava nem trava', () => {
  const avaliar = sql.slice(sql.indexOf('function public.cupom_avaliar'), sql.indexOf('-- Reserva atômica'))
  assert.doesNotMatch(avaliar, /for update|insert into|update public/)
})

test('desconto: floor em inteiros e itens cobrados nunca abaixo de 100 centavos', () => {
  assert.match(sql, /\(p_subtotal_centavos::bigint \* p_cupom\.valor\) \/ 100/)
  assert.match(sql, /greatest\(0, least\(v_desc, p_subtotal_centavos - 100\)\)/)
})

test('reserva vencida não conta; confirmar vale mesmo liberada; liberar nunca toca em confirmado', () => {
  assert.match(sql, /estado = 'reservado' and reservado_ate > p_agora/)
  assert.match(sql, /where id = p_uso_id and estado <> 'confirmado'/)
  assert.match(sql, /where pagamento_pendente_id = p_pendente_id and estado = 'reservado'/)
})

test('limites de tentativa: 15 por IP e 100 por loja, só inválidas', () => {
  assert.match(sql, /return v_ip <= 15 and v_loja <= 100/)
  assert.match(sql, /not valida and criado_em >= now\(\) - interval '1 hour'/)
})

test('cupom com uso não pode ser apagado; aditiva', () => {
  assert.match(sql, /raise exception 'cupom_com_uso'/)
  assert.doesNotMatch(sql, /drop table|truncate|drop column/i)
})

test('uma linha de uso por cobrança: trocar de cupom reaproveita a linha (o índice único não permite 2ª)', () => {
  const reservar = sql.slice(sql.indexOf('function public.cupom_reservar'), sql.indexOf('-- Pagamento aprovado'))
  assert.match(reservar, /pagamento_pendente_id = p_pendente_id for update/)
  assert.match(reservar, /update public\.cupom_usos\s+set cupom_id = c\.id/)
  assert.match(reservar, /v_uso_estado = 'confirmado'/)
})
