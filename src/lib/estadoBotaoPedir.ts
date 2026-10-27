/** Sem horário cadastrado (status null) a loja conta como sempre aberta. */
export function lojaAberta(status: { aberto: boolean } | null): boolean {
  return status === null || status.aberto
}

/** Loja fechada: o cliente ainda abre o pedido para revisar e tirar itens, mas não avança ao pagamento/envio. */
export function podeFinalizarPedido(lojaAberta: boolean): boolean {
  return lojaAberta
}

export type TipoBotaoPedir = 'esgotado' | 'fechado' | 'escolher' | 'adicionar' | 'contador'

export type EntradaBotaoPedir = {
  esgotado: boolean
  lojaAberta: boolean
  podeAdicionar: boolean
  comOpcoes: boolean
  quantidade: number
}

/** Precedência: esgotado > contador > fechado > escolher/adicionar.
 * Com a loja fechada o cliente ainda diminui o que já tem, mas não aumenta. */
export function estadoBotaoPedir(p: EntradaBotaoPedir): {
  tipo: TipoBotaoPedir
  desabilitado: boolean
  podeAumentar: boolean
  podeDiminuir: boolean
} {
  if (p.esgotado) return { tipo: 'esgotado', desabilitado: true, podeAumentar: false, podeDiminuir: false }
  if (!p.comOpcoes && p.quantidade > 0) {
    return { tipo: 'contador', desabilitado: false, podeAumentar: p.lojaAberta && p.podeAdicionar, podeDiminuir: true }
  }
  if (!p.lojaAberta) return { tipo: 'fechado', desabilitado: true, podeAumentar: false, podeDiminuir: false }
  return {
    tipo: p.comOpcoes ? 'escolher' : 'adicionar',
    desabilitado: !p.podeAdicionar,
    podeAumentar: false,
    podeDiminuir: false,
  }
}
