// Leitura de arquivo do cardápio (.csv UTF-8, .csv do Excel antigo em Windows-1252, .xlsx) + a fixture de exemplo.
// Rodar: npm test
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'
import { LIMITE_LINHAS_CARDAPIO, lerTabelaCardapio, validarCardapio } from '../src/lib/importarCardapio.ts'
import { ErroArquivoImportacao, TAMANHO_MAX_ARQUIVO_BYTES, lerArquivoDeTabela } from '../src/lib/importarClientesArquivo.ts'

const arquivoCsv = (conteudo: Buffer | string, nome = 'cardapio.csv') => new File([conteudo], nome)

async function validarArquivo(arquivo: File) {
  const lida = lerTabelaCardapio(await lerArquivoDeTabela(arquivo, LIMITE_LINHAS_CARDAPIO))
  if (!lida.ok) throw new Error(lida.mensagem)
  return validarCardapio(lida.linhas, lida.colunas, { categorias: [], itens: [] })
}

describe('CSV', () => {
  test('fixture de exemplo (UTF-8, BOM, ";", aspas com ";" dentro, preço em vários formatos)', async () => {
    const r = await validarArquivo(arquivoCsv(readFileSync(new URL('./fixtures/cardapio-exemplo.csv', import.meta.url))))
    assert.deepEqual(r.paraCriar.map((i) => [i.categoria, i.nome, i.precoCentavos, i.ativo]), [
      ['Pastéis', 'Pastel de carne', 850, true],
      ['Pastéis', 'Pastel de queijo', 800, true],
      ['Bebidas', 'Caldo de cana 500 ml', 700, true],
      ['Bebidas', 'Refrigerante lata', 600, false],
      [null, 'Combo do dia', 2550, true],
    ])
    assert.equal(r.paraCriar[4].descricao, 'Pastel + caldo; leva dois')
    assert.deepEqual(r.categoriasNovas, ['Pastéis', 'Bebidas'])
    assert.deepEqual(r.invalidas, [{ linha: 7, motivo: 'preço inválido' }])
  })

  test('CSV salvo pelo Excel antigo (Windows-1252) mantém os acentos e reconhece o cabeçalho', async () => {
    const r = await validarArquivo(arquivoCsv(Buffer.from('Categoria;Nome;Preço\r\nPastéis;Pastel de pão;5,5\r\n', 'latin1')))
    assert.equal(r.paraCriar[0].nome, 'Pastel de pão')
    assert.equal(r.paraCriar[0].categoria, 'Pastéis')
    assert.equal(r.paraCriar[0].precoCentavos, 550)
  })

  test('cabeçalho em qualquer ordem e com delimitador vírgula', async () => {
    const r = await validarArquivo(arquivoCsv('preco,NOME,categoria\n7,Suco,Bebidas\n'))
    assert.deepEqual(r.paraCriar.map((i) => [i.categoria, i.nome, i.precoCentavos]), [['Bebidas', 'Suco', 700]])
  })

  test('formato não suportado e arquivo grande demais', async () => {
    await assert.rejects(lerArquivoDeTabela(new File(['x'], 'cardapio.pdf'), 300), ErroArquivoImportacao)
    await assert.rejects(lerArquivoDeTabela(new File([new Uint8Array(TAMANHO_MAX_ARQUIVO_BYTES + 1)], 'grande.csv'), 300), /muito grande/)
  })
})

describe('XLSX (exceljs só é carregado ao importar .xlsx)', () => {
  async function xlsx(linhas: unknown[][]): Promise<File> {
    const modulo = await import('exceljs')
    const ExcelJS = 'Workbook' in modulo ? modulo : (modulo as unknown as { default: typeof modulo }).default
    const wb = new ExcelJS.Workbook()
    const aba = wb.addWorksheet('Cardápio')
    for (const l of linhas) aba.addRow(l)
    const buffer = await wb.xlsx.writeBuffer()
    return new File([buffer], 'cardapio.xlsx')
  }

  test('células numéricas, texto, vazias e fórmula com resultado', async () => {
    const arquivo = await xlsx([
      ['Categoria', 'Nome', 'Preço', 'Descrição', 'Ativo'],
      ['Pastéis', 'Pastel de carne', 8.5, 'Carne', 'sim'],
      ['Pastéis', 'Pastel de queijo', '8,00', null, 1],
      ['Bebidas', 'Caldo de cana', 7, null, 0],
      [null, 'Sem categoria aqui', 'R$ 12,50', null, null],
    ])
    const r = await validarArquivo(arquivo)
    assert.equal(r.invalidas.length, 0)
    assert.deepEqual(r.paraCriar.map((i) => [i.categoria, i.nome, i.precoCentavos, i.ativo]), [
      ['Pastéis', 'Pastel de carne', 850, true],
      ['Pastéis', 'Pastel de queijo', 800, true],
      ['Bebidas', 'Caldo de cana', 700, false],
      [null, 'Sem categoria aqui', 1250, true],
    ])
  })

  test('limite de 300 linhas: 300 passam; 301 viram mensagem clara; planilha enorme é barrada na leitura', async () => {
    const cab = ['Nome', 'Preço']
    const dados = (n: number) => Array.from({ length: n }, (_, i) => [`Item ${i + 1}`, 5])
    const ok = lerTabelaCardapio(await lerArquivoDeTabela(await xlsx([cab, ...dados(300)]), LIMITE_LINHAS_CARDAPIO))
    assert.ok(ok.ok)
    const quase = lerTabelaCardapio(await lerArquivoDeTabela(await xlsx([cab, ...dados(301)]), LIMITE_LINHAS_CARDAPIO))
    assert.ok(!quase.ok && quase.erro === 'muitas_linhas' && quase.mensagem.includes('300'))
    await assert.rejects(lerArquivoDeTabela(await xlsx([cab, ...dados(700)]), LIMITE_LINHAS_CARDAPIO), /mais de 300 linhas/)
  })

  test('arquivo .xlsx corrompido vira mensagem em português', async () => {
    await assert.rejects(lerArquivoDeTabela(new File(['isto não é um zip'], 'quebrado.xlsx'), 300), /Não consegui abrir a planilha/)
  })
})
