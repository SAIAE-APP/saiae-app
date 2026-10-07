import { LIMITE_LINHAS_IMPORTACAO, parsearCsv } from './importarClientes'

/** Tamanho máximo do arquivo (uma planilha de 2000 clientes tem poucas centenas de KB). */
export const TAMANHO_MAX_ARQUIVO_BYTES = 5 * 1024 * 1024

export class ErroArquivoImportacao extends Error {}

function decodificarCsv(buffer: ArrayBuffer): string {
  const utf8 = new TextDecoder('utf-8').decode(buffer)
  // CSV salvo pelo Excel antigo vem em Windows-1252: bytes inválidos viram U+FFFD.
  return utf8.includes('�') ? new TextDecoder('windows-1252').decode(buffer) : utf8
}

function textoDaCelula(valor: unknown): string {
  if (valor === null || valor === undefined) return ''
  if (valor instanceof Date) return valor.toISOString().slice(0, 10)
  if (typeof valor === 'object') {
    const v = valor as { text?: unknown; result?: unknown; richText?: { text: string }[] }
    if (Array.isArray(v.richText)) return v.richText.map((r) => r.text).join('')
    if (v.result !== undefined) return textoDaCelula(v.result)
    if (typeof v.text === 'string') return v.text
    return ''
  }
  return String(valor)
}

/** Lê .csv ou .xlsx (1ª aba) como tabela de texto. exceljs só é baixado ao importar .xlsx. */
export async function lerArquivoDeClientes(arquivo: File): Promise<string[][]> {
  if (arquivo.size > TAMANHO_MAX_ARQUIVO_BYTES) {
    throw new ErroArquivoImportacao('Arquivo muito grande (máximo 5 MB).')
  }
  const nome = arquivo.name.toLowerCase()
  const buffer = await arquivo.arrayBuffer()

  if (nome.endsWith('.csv') || nome.endsWith('.txt')) return parsearCsv(decodificarCsv(buffer))

  if (nome.endsWith('.xlsx')) {
    const ExcelJS = await import('exceljs')
    const workbook = new ExcelJS.Workbook()
    try {
      await workbook.xlsx.load(buffer)
    } catch {
      throw new ErroArquivoImportacao('Não consegui abrir a planilha. Confira se é um .xlsx válido.')
    }
    const aba = workbook.worksheets[0]
    if (!aba) throw new ErroArquivoImportacao('A planilha não tem nenhuma aba.')
    // Folga pra linhas vazias no fim; acima disso o arquivo passa do limite de qualquer jeito.
    const ultima = Math.min(aba.rowCount, LIMITE_LINHAS_IMPORTACAO + 200)
    if (aba.rowCount > ultima) {
      throw new ErroArquivoImportacao(
        `A planilha tem mais de ${LIMITE_LINHAS_IMPORTACAO} linhas; o máximo é ${LIMITE_LINHAS_IMPORTACAO} por arquivo. Divida em partes.`,
      )
    }
    const colunas = Math.min(aba.columnCount, 30)
    const tabela: string[][] = []
    for (let r = 1; r <= ultima; r++) {
      const linha = aba.getRow(r)
      const celulas: string[] = []
      for (let c = 1; c <= colunas; c++) celulas.push(textoDaCelula(linha.getCell(c).value))
      tabela.push(celulas)
    }
    return tabela
  }

  throw new ErroArquivoImportacao('Formato não suportado. Envie um arquivo .csv ou .xlsx.')
}
