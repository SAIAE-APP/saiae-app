// Banco sem a migration: telas novas se escondem em vez de mostrar erro. Rodar: npm test
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { bancoSemRecurso } from '../src/lib/semMigration.ts'

test('reconhece tabela, coluna e função inexistentes', () => {
  for (const e of [
    { code: 'PGRST205', message: "Could not find the table 'public.grupos_opcoes' in the schema cache" },
    { code: 'PGRST202', message: 'Could not find the function public.integracao_crm_estado(p_barraca_id) in the schema cache' },
    { code: '42P01', message: 'relation "grupos_opcoes" does not exist' },
    { message: "Could not find the 'opcoes' column of 'itens_do_pedido' in the schema cache" },
    new Error('relation "opcoes" does not exist'),
  ]) {
    assert.equal(bancoSemRecurso(e), true, JSON.stringify(e))
  }
})

test('erro comum (rede, permissão) continua sendo erro', () => {
  for (const e of [{ message: 'Failed to fetch' }, { code: '42501', message: 'permission denied for table x' }, new Error('JWT expired'), null, undefined]) {
    assert.equal(bancoSemRecurso(e), false)
  }
})
