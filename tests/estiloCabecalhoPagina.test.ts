import assert from 'node:assert/strict'
import { test } from 'node:test'
import { classesTituloCabecalho } from '../src/lib/estiloCabecalhoPagina.ts'

test('título do cabeçalho nunca quebra linha e corta com ellipsis', () => {
  const classes = classesTituloCabecalho()
  assert.ok(classes.includes('whitespace-nowrap'), 'falta whitespace-nowrap')
  assert.ok(classes.includes('truncate'), 'falta truncate')
})

test('título do cabeçalho usa fonte menor no mobile e 32px só a partir de md:', () => {
  const classes = classesTituloCabecalho()
  assert.ok(classes.includes('text-2xl'), 'falta tamanho mobile')
  assert.ok(classes.includes('md:text-[32px]'), 'falta tamanho desktop')
})
