// Migration que libera tipos novos no limitador por usuário/hora. Rodar: npm test
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'

const sql = readFileSync(new URL('../supabase/migrations/20261024120000_limite_tentativas_tipo_livre.sql', import.meta.url), 'utf8')
  .replace(/\r\n/g, '\n')
  .replace(/^--.*$/gm, '')

describe('consulta_externa_registrar com tipo livre', () => {
  test('a constraint e a função aceitam o mesmo formato de tipo (inclui cancelar_assinatura, cnpj e cep)', () => {
    const formato = /\^\[a-z\]\[a-z0-9_\]\{1,29\}\$/g
    assert.equal((sql.match(formato) ?? []).length, 2)
    const re = new RegExp('^[a-z][a-z0-9_]{1,29}$')
    for (const tipo of ['cnpj', 'cep', 'cancelar_assinatura']) assert.ok(re.test(tipo), tipo)
    for (const ruim of ['', 'A', "x'; drop", 'a'.repeat(31), '1abc']) assert.ok(!re.test(ruim), ruim)
  })
  test('continua restrita ao service_role', () => {
    assert.match(sql, /revoke all on function public\.consulta_externa_registrar\(uuid, text, integer\) from public, anon, authenticated;/)
    assert.match(sql, /grant execute on function public\.consulta_externa_registrar\(uuid, text, integer\) to service_role;/)
  })
  test('mantém o lock por usuário+tipo e a janela de 1 hora', () => {
    assert.match(sql, /pg_advisory_xact_lock\(hashtextextended\(p_usuario_id::text \|\| ':' \|\| p_tipo, 0\)\)/)
    assert.match(sql, /criado_em >= now\(\) - interval '1 hour'/)
  })
})
