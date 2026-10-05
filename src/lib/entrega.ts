import type { Barraca } from '../types/database'
import { formatarPrecoBR } from './preco'

export type ConfigTaxaEntrega = {
  habilitada: boolean
  centavos: number
  editavel: boolean
}

/** Config da taxa com defaults pra cache antigo (sem as colunas): desligada. */
export function configTaxaEntrega(
  barraca: Pick<Barraca, 'taxa_entrega_habilitada' | 'taxa_entrega_centavos' | 'taxa_entrega_editavel'> | null,
): ConfigTaxaEntrega {
  return {
    habilitada: barraca?.taxa_entrega_habilitada ?? false,
    centavos: Math.max(0, barraca?.taxa_entrega_centavos ?? 0),
    editavel: barraca?.taxa_entrega_editavel ?? true,
  }
}

/** Taxa que entra no pedido: 0 se o modo não é Entrega ou a função está desligada. */
export function taxaDoPedido(config: ConfigTaxaEntrega, ehEntrega: boolean): number {
  return ehEntrega && config.habilitada ? config.centavos : 0
}

export type DadosEntrega = {
  nome: string
  telefone: string
  rua: string
  numero: string
  bairro: string
  referencia?: string | null
}

/** Só os dígitos do telefone (tira máscara; o 55 do país fica). */
export function somenteDigitos(texto: string): string {
  return texto.replace(/\D/g, '')
}

/** Telefone brasileiro pra exibir: (11) 91234-5678 / (11) 1234-5678; outro formato volta como veio. */
export function formatarTelefoneBR(telefone: string): string {
  const d = somenteDigitos(telefone)
  const local = d.length > 11 && d.startsWith('55') ? d.slice(2) : d
  if (local.length === 11) return `(${local.slice(0, 2)}) ${local.slice(2, 7)}-${local.slice(7)}`
  if (local.length === 10) return `(${local.slice(0, 2)}) ${local.slice(2, 6)}-${local.slice(6)}`
  return telefone
}

export type ErrosEntrega = Partial<Record<'nome' | 'telefone' | 'rua' | 'numero' | 'bairro', string>>

/** Obrigatórios do pedido de entrega: nome, telefone, rua, número e bairro. */
export function validarDadosEntrega(dados: DadosEntrega): ErrosEntrega {
  const erros: ErrosEntrega = {}
  if (!dados.nome.trim()) erros.nome = 'Informe o nome do cliente'
  const digitos = somenteDigitos(dados.telefone)
  if (digitos.length < 8 || digitos.length > 15) erros.telefone = 'Informe um telefone válido'
  if (!dados.rua.trim()) erros.rua = 'Informe a rua'
  if (!dados.numero.trim()) erros.numero = 'Informe o número'
  if (!dados.bairro.trim()) erros.bairro = 'Informe o bairro'
  return erros
}

export type ItemMensagemEntrega = {
  nome: string
  quantidade: number
  observacao?: string | null
}

export type DadosMensagemEntrega = {
  senha: number
  itens: ItemMensagemEntrega[]
  cliente: DadosEntrega
  /** Total do pedido já com a taxa, em centavos. */
  totalCentavos: number
  /** 0 ou ausente = sem linha de taxa. */
  taxaEntregaCentavos?: number
  metodoPagamento?: string | null
  observacao?: string | null
}

/**
 * Texto da mensagem pro entregador (WhatsApp). Sem emoji, só o *negrito* do
 * próprio WhatsApp, pra sair igual em qualquer aparelho.
 */
export function montarMensagemEntregador(d: DadosMensagemEntrega): string {
  const taxa = d.taxaEntregaCentavos ?? 0
  const linhas: string[] = [`*Entrega - Pedido #${d.senha}*`, '']

  linhas.push('*Itens:*')
  for (const item of d.itens) {
    linhas.push(`${item.quantidade}x ${item.nome}`)
    if (item.observacao?.trim()) linhas.push(`   Obs: ${item.observacao.trim()}`)
  }

  linhas.push('', '*Cliente:*', d.cliente.nome.trim(), formatarTelefoneBR(d.cliente.telefone))

  const rua = `${d.cliente.rua.trim()}, ${d.cliente.numero.trim()}`
  linhas.push('', '*Endereço:*', `${rua} - ${d.cliente.bairro.trim()}`)
  if (d.cliente.referencia?.trim()) linhas.push(`Ref.: ${d.cliente.referencia.trim()}`)

  if (d.observacao?.trim()) linhas.push('', `*Observação:* ${d.observacao.trim()}`)

  linhas.push('')
  if (taxa > 0) {
    linhas.push(`Subtotal: ${formatarPrecoBR(d.totalCentavos - taxa)}`)
    linhas.push(`Taxa de entrega: ${formatarPrecoBR(taxa)}`)
  }
  linhas.push(`*Total: ${formatarPrecoBR(d.totalCentavos)}*`)
  if (d.metodoPagamento?.trim()) linhas.push(`Pagamento: ${d.metodoPagamento.trim()}`)

  return linhas.join('\n')
}

/** Link do WhatsApp sem número: abre a escolha de contato com o texto pronto. */
export function linkWhatsAppSemNumero(mensagem: string): string {
  return `https://wa.me/?text=${encodeURIComponent(mensagem)}`
}
