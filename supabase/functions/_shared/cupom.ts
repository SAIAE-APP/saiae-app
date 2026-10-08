// Cupons por código (v2): funções puras compartilhadas pelas edge functions (Deno e Node).
// A REGRA e o cálculo ficam no banco (cupom_regras); aqui só normalização e texto para o cliente.

const CODIGO = /^[A-Z0-9_-]{3,20}$/

/** Maiúsculas, sem espaços nas pontas; null se não for um código possível (3 a 20 de A-Z, 0-9, _ ou -). */
export function normalizarCodigo(texto: unknown): string | null {
  const t = String(texto ?? '').trim().toUpperCase()
  return CODIGO.test(t) ? t : null
}

function reais(centavos: number): string {
  return `R$ ${(centavos / 100).toFixed(2).replace('.', ',')}`
}

/** Texto simples para o cliente. Código desconhecido cai em "Cupom inválido" (nunca vaza detalhe interno). */
export function mensagemDoErro(erro: string, minimoCentavos?: number): string {
  switch (erro) {
    case 'venceu':
      return 'Este cupom venceu'
    case 'nao_comecou':
      return 'Este cupom ainda não começou'
    case 'minimo':
      return typeof minimoCentavos === 'number' ? `Vale a partir de ${reais(minimoCentavos)} em itens` : 'Pedido abaixo do mínimo deste cupom'
    case 'esgotou':
      return 'Este cupom esgotou'
    case 'ja_usou':
      return 'Você já usou este cupom'
    case 'precisa_login':
      return 'Entre com seu telefone para usar este cupom'
    default:
      return 'Cupom inválido'
  }
}

export type ResultadoAvaliacao =
  | { ok: true; cupom_id: string; codigo: string; desconto_centavos: number }
  | { ok: false; erro: string; minimo_centavos?: number }

/** Lê com segurança o jsonb devolvido por cupom_avaliar/cupom_reservar. Resposta estranha = inválido. */
export function interpretarAvaliacao(data: unknown): ResultadoAvaliacao {
  const d = (data ?? {}) as Record<string, unknown>
  if (d.ok === true && typeof d.cupom_id === 'string' && Number.isInteger(d.desconto_centavos) && (d.desconto_centavos as number) >= 0) {
    return { ok: true, cupom_id: d.cupom_id, codigo: String(d.codigo ?? ''), desconto_centavos: d.desconto_centavos as number }
  }
  return {
    ok: false,
    erro: typeof d.erro === 'string' ? d.erro : 'invalido',
    ...(typeof d.minimo_centavos === 'number' ? { minimo_centavos: d.minimo_centavos } : {}),
  }
}
