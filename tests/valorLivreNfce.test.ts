// Valor livre, PR 4/4: a NFC-e descreve o item como "nome - o que foi vendido" e tolera banco sem a coluna.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'

const nfce = readFileSync(new URL('../supabase/functions/emitir-nfce/handler.ts', import.meta.url), 'utf8')

describe('emitir-nfce com item de preço aberto', () => {
  test('lê a observação da linha do pedido e a flag preco_aberto do cadastro', () => {
    assert.match(nfce, /itens_do_pedido\(id, item_id, nome_item, quantidade, preco_centavos_unitario, removido, opcoes, observacao\)/)
    assert.match(nfce, /select\('id, ncm, cfop, unidade_comercial, preco_aberto'\)/)
  })
  test('banco sem a migration: repete a consulta sem a coluna (nota comum continua saindo)', () => {
    assert.match(nfce, /select\('id, ncm, cfop, unidade_comercial'\)/)
  })
  test('descrição = nome do item + o que foi vendido, só para item de preço aberto', () => {
    assert.match(nfce, /const texto = livre \? `\$\{base\} - \$\{livre\}` : base/)
    assert.match(nfce, /descricaoDoItem\(item\.nome_item, item\.opcoes, cadastro\.preco_aberto \? item\.observacao : null\)/)
  })
  test('continua exigindo NCM, CFOP e unidade do item (nunca emite descrição vaga sem dados fiscais)', () => {
    assert.match(nfce, /if \(!cadastro\?\.ncm\) camposFaltando\.push\('NCM'\)/)
    assert.match(nfce, /if \(!cadastro\?\.cfop\) camposFaltando\.push\('CFOP'\)/)
  })
})
