import { supabase } from './supabase'
import { formatarTelefoneBR, normalizarTelefone } from './entrega'
import { formatarPrecoBR } from './preco'
import type { ClienteFinal } from '../types/database'

export type FiltroExportar = 'aceitaram' | 'todos'
export type FormatoExportar = 'xlsx' | 'csv'

export type LinhaCliente = {
  nome: string
  telefone: string
  telefoneDigitos: string
  rua: string
  numero: string
  bairro: string
  referencia: string
  pedidos: number
  ultimoPedido: string
  ticketMedio: string
  origem: string
  cadastro: string
  contatoComercial: 'sim' | 'não informado'
}

const PAGINA = 1000

type ClienteExport = ClienteFinal & {
  origem?: string | null
  consentimento_marketing_em?: string | null
}

type PedidoResumo = {
  entrega_telefone: string | null
  criado_em: string
  status: string
  itens_do_pedido: { quantidade: number; preco_centavos_unitario: number; removido: boolean }[]
}

/**
 * Valor de célula seguro: texto que começa com = + - @ (ou tab/CR) seria
 * interpretado como fórmula no Excel/Sheets ("injeção de fórmula"). Prefixa
 * com apóstrofo, que vira texto puro na planilha.
 */
export function protegerCelula(valor: string): string {
  return /^[=+\-@\t\r]/.test(valor) ? `'${valor}` : valor
}

function formatarData(iso: string | null | undefined): string {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('pt-BR')
}

async function paginar<T>(buscar: (de: number, ate: number) => PromiseLike<{ data: T[] | null; error: Error | null }>): Promise<T[]> {
  const todos: T[] = []
  for (let de = 0; ; de += PAGINA) {
    const { data, error } = await buscar(de, de + PAGINA - 1)
    if (error) throw error
    const lote = data ?? []
    todos.push(...lote)
    if (lote.length < PAGINA) break
  }
  return todos
}

/** Clientes + estatísticas de pedidos (2 consultas paginadas, sem N+1). */
export async function montarLinhasClientes(barracaId: string, filtro: FiltroExportar): Promise<LinhaCliente[]> {
  const clientes = await paginar<ClienteExport>((de, ate) =>
    supabase
      .from('clientes_finais')
      .select('id, barraca_id, nome, telefone, rua, numero, bairro, referencia, criado_em, atualizado_em, origem, consentimento_marketing_em')
      .eq('barraca_id', barracaId)
      .order('id')
      .range(de, ate),
  )

  const pedidos = await paginar<PedidoResumo>((de, ate) =>
    supabase
      .from('pedidos')
      .select('entrega_telefone, criado_em, status, itens_do_pedido(quantidade, preco_centavos_unitario, removido)')
      .eq('barraca_id', barracaId)
      .not('entrega_telefone', 'is', null)
      .neq('status', 'cancelado')
      .order('id')
      .range(de, ate),
  )

  const porTelefone = new Map<string, { qtd: number; total: number; ultimo: string }>()
  for (const p of pedidos) {
    const tel = normalizarTelefone(p.entrega_telefone ?? '')
    if (!tel) continue
    const valor = p.itens_do_pedido
      .filter((i) => !i.removido)
      .reduce((s, i) => s + i.quantidade * i.preco_centavos_unitario, 0)
    const atual = porTelefone.get(tel) ?? { qtd: 0, total: 0, ultimo: '' }
    atual.qtd += 1
    atual.total += valor
    if (p.criado_em > atual.ultimo) atual.ultimo = p.criado_em
    porTelefone.set(tel, atual)
  }

  return clientes
    .filter((c) => filtro === 'todos' || Boolean(c.consentimento_marketing_em))
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
    .map((c) => {
      const est = porTelefone.get(c.telefone)
      return {
        nome: c.nome,
        telefone: formatarTelefoneBR(c.telefone),
        telefoneDigitos: c.telefone,
        rua: c.rua ?? '',
        numero: c.numero ?? '',
        bairro: c.bairro ?? '',
        referencia: c.referencia ?? '',
        pedidos: est?.qtd ?? 0,
        ultimoPedido: formatarData(est?.ultimo),
        // Ticket médio dos itens (a taxa de entrega fica à parte, como no resto do app).
        ticketMedio: est && est.qtd > 0 ? formatarPrecoBR(Math.round(est.total / est.qtd)) : '',
        origem:
          c.origem === 'cardapio'
            ? 'Cardápio digital'
            : c.origem === 'app'
              ? 'App'
              : c.origem === 'importacao'
                ? 'Importação'
                : 'Não informado',
        cadastro: formatarData(c.criado_em),
        contatoComercial: c.consentimento_marketing_em ? 'sim' : 'não informado',
      }
    })
}

const COLUNAS: { header: string; key: keyof LinhaCliente; width: number }[] = [
  { header: 'Nome', key: 'nome', width: 28 },
  { header: 'Telefone', key: 'telefone', width: 18 },
  { header: 'Telefone (só dígitos)', key: 'telefoneDigitos', width: 20 },
  { header: 'Rua', key: 'rua', width: 28 },
  { header: 'Número', key: 'numero', width: 10 },
  { header: 'Bairro', key: 'bairro', width: 20 },
  { header: 'Referência', key: 'referencia', width: 24 },
  { header: 'Nº de pedidos', key: 'pedidos', width: 14 },
  { header: 'Último pedido', key: 'ultimoPedido', width: 14 },
  { header: 'Ticket médio', key: 'ticketMedio', width: 14 },
  { header: 'Origem', key: 'origem', width: 16 },
  { header: 'Cadastro', key: 'cadastro', width: 12 },
  { header: 'Aceita contato comercial', key: 'contatoComercial', width: 24 },
]

function valorCelula(linha: LinhaCliente, chave: keyof LinhaCliente): string | number {
  const v = linha[chave]
  return typeof v === 'number' ? v : protegerCelula(String(v))
}

export async function gerarXlsxClientes(linhas: LinhaCliente[]): Promise<ArrayBuffer> {
  const ExcelJS = await import('exceljs')
  const workbook = new ExcelJS.Workbook()
  const planilha = workbook.addWorksheet('Clientes de entrega')
  planilha.columns = COLUNAS.map((c) => ({ header: c.header, key: c.key, width: c.width }))

  const cabecalho = planilha.getRow(1)
  cabecalho.font = { bold: true, color: { argb: 'FF18171C' } }
  cabecalho.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFC21A' } }
  cabecalho.alignment = { vertical: 'middle' }
  cabecalho.height = 20
  planilha.views = [{ state: 'frozen', ySplit: 1 }]
  planilha.autoFilter = { from: 'A1', to: { row: 1, column: COLUNAS.length } }

  for (const linha of linhas) {
    const row = planilha.addRow(Object.fromEntries(COLUNAS.map((c) => [c.key, valorCelula(linha, c.key)])))
    // Telefone, número e dígitos sempre como texto (zeros à esquerda, sem notação científica).
    for (const chave of ['telefone', 'telefoneDigitos', 'numero'] as const) {
      const indice = COLUNAS.findIndex((c) => c.key === chave) + 1
      row.getCell(indice).numFmt = '@'
    }
  }

  return workbook.xlsx.writeBuffer() as Promise<ArrayBuffer>
}

/** CSV UTF-8 com BOM e `;` (o Excel em português abre certo). */
export function gerarCsvClientes(linhas: LinhaCliente[]): string {
  const aspas = (texto: string) => `"${texto.replace(/"/g, '""')}"`
  const cabecalho = COLUNAS.map((c) => aspas(c.header)).join(';')
  const corpo = linhas.map((l) => COLUNAS.map((c) => aspas(String(valorCelula(l, c.key)))).join(';'))
  return '﻿' + [cabecalho, ...corpo].join('\r\n')
}

export function baixarArquivo(conteudo: BlobPart, tipo: string, nome: string) {
  const url = URL.createObjectURL(new Blob([conteudo], { type: tipo }))
  const link = document.createElement('a')
  link.href = url
  link.download = nome
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

export async function exportarClientes(barracaId: string, slug: string, filtro: FiltroExportar, formato: FormatoExportar): Promise<number> {
  const linhas = await montarLinhasClientes(barracaId, filtro)
  const base = `clientes-entrega-${slug}-${new Date().toISOString().slice(0, 10)}`
  if (formato === 'csv') {
    baixarArquivo(gerarCsvClientes(linhas), 'text/csv;charset=utf-8', `${base}.csv`)
  } else {
    baixarArquivo(
      await gerarXlsxClientes(linhas),
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      `${base}.xlsx`,
    )
  }
  return linhas.length
}
