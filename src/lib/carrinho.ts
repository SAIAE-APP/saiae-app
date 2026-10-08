import type { Item, TipoAtendimento } from '../types/database'
import type { DadosEntrega, DadosMensagemEntrega } from './entrega'
import type { OpcaoSnapshot } from './opcoes'

/**
 * Contrato de estado passado via `navigate(..., { state })` entre
 * LancarPedido e ConfirmarPedido (Fase 4). Preferido a Context/store porque
 * o carrinho só existe enquanto esse fluxo de duas telas está em andamento
 * — não precisa sobreviver a reload nem ser lido de mais lugares.
 */
export type Carrinho = Record<string, number>
export type EntregaDiretaPorItem = Record<string, boolean>
/** Observação específica de um item da comanda (ex.: "sem cebola"),
 * diferente de `observacao` (recado geral do pedido inteiro). */
export type ObservacaoPorItem = Record<string, string>

/** Linha do carrinho com variação/adicionais (SAI-010a). Nela a chave do `Carrinho` (e de
 * `observacaoPorItem`/`entregaDireta`) NÃO é o id do item: é `chaveDaLinha(...)`, e o item vem de
 * `itemId`. Item sem opções segue com a chave = id do item, exatamente como antes. */
export type LinhaComOpcoes = {
  itemId: string
  opcaoIds: string[]
  /** Preço final da unidade (variação absoluta ou base + adicionais), calculado no aparelho. */
  precoUnitarioCentavos: number
  /** "Grande, Ovo, Bacon" — para mostrar na nota. */
  resumo: string
  snapshot: OpcaoSnapshot[]
}
export type OpcoesPorLinha = Record<string, LinhaComOpcoes>

/** LancarPedido → ConfirmarPedido, ao clicar "Ver nota". */
export type EstadoParaConfirmar = {
  carrinho: Carrinho
  itens: Item[]
  mesa: string
  /** "Não consome no local" (Retirada ou Entrega) — derivado de `tipoAtendimento`. */
  viagem: boolean
  tipoAtendimento: TipoAtendimento
  observacao: string
  entregaDireta?: EntregaDiretaPorItem
  observacaoPorItem?: ObservacaoPorItem
  opcoesPorLinha?: OpcoesPorLinha
  /** Dados do cliente (só no modo Entrega); preenchidos em ConfirmarPedido. */
  entrega?: DadosEntrega
  /** Nome do cliente digitado em Confirmar (modos sem formulário de Entrega). */
  clienteNome?: string
  /** WhatsApp opcional (só pra avisar "pedido pronto"). */
  clienteTelefone?: string
}

/** ConfirmarPedido → LancarPedido, ao clicar "Voltar e editar". */
export type EstadoParaEditar = {
  carrinho: Carrinho
  mesa: string
  viagem: boolean
  tipoAtendimento?: TipoAtendimento
  observacao: string
  entregaDireta?: EntregaDiretaPorItem
  observacaoPorItem?: ObservacaoPorItem
  opcoesPorLinha?: OpcoesPorLinha
  /** Devolvido intacto pra não perder o que foi digitado em ConfirmarPedido. */
  entrega?: DadosEntrega
  clienteNome?: string
  clienteTelefone?: string
}

/** ConfirmarPedido → LancarPedido, depois de enviar com sucesso — LancarPedido
 * usa isso pra pular direto pra tela de senha (herói), sem passar pelo form.
 * `valor: null` até o servidor confirmar a senha real — nunca mostramos um
 * número provisório/local que pode não bater com o definitivo (bug relatado
 * em operação ao vivo, 2026-09-27: o número mudava sozinho na tela e
 * confundia o fluxo do operador). */
export type EstadoPedidoEnviado = {
  senhaEnviada: {
    valor: number | null
    idFila: string
    entregaDireta: boolean
    /** Só em pedido de Entrega: base da mensagem do botão "Chamar entregador" (a senha entra depois). */
    entrega?: Omit<DadosMensagemEntrega, 'senha'>
  }
}
