// Cupom no cardápio digital (lado do cliente). PURO (sem imports): testável no Node. Aqui só se monta
// o corpo da chamada e se interpreta a resposta; o desconto SEMPRE vem do servidor (`cupom-validar`),
// nunca é calculado nem enviado pelo navegador. Qualquer dúvida sobre o recurso = desligado.

/** Mesma regra do servidor: maiúsculas, sem espaços nas pontas, `[A-Z0-9_-]` de 3 a 20 caracteres. */
export function normalizarCodigoCupom(texto: string): string | null {
  const codigo = String(texto ?? '').trim().toUpperCase()
  return /^[A-Z0-9_-]{3,20}$/.test(codigo) ? codigo : null
}

/** `cupom_config(slug)`: só `true` quando a loja ligou. Função ausente (banco sem a migration), erro,
 * resposta vazia ou fora de forma = desligado, e o cardápio fica como sempre foi. */
export function decidirCupomConfig(resposta: { data: unknown; error: unknown }): boolean {
  if (resposta.error) return false
  const linha = Array.isArray(resposta.data) ? resposta.data[0] : null
  return typeof linha === 'object' && linha !== null && (linha as { habilitado?: unknown }).habilitado === true
}

export type ItemParaCupom = { item_id: string; quantidade: number; opcao_ids?: string[]; observacao?: string }

/** Corpo de `cupom-validar`: só o código, o carrinho (ids) e o token. Nunca preço, total nem desconto. */
export function montarCorpoValidacao(args: { slug: string; codigo: string; itens: ItemParaCupom[]; token?: string | null }) {
  return {
    barraca_slug: args.slug,
    codigo: args.codigo,
    itens: args.itens.map((i) => ({
      item_id: i.item_id,
      quantidade: i.quantidade,
      ...(i.opcao_ids && i.opcao_ids.length > 0 ? { opcao_ids: i.opcao_ids } : {}),
      ...(i.observacao ? { observacao: i.observacao } : {}),
    })),
    ...(args.token ? { sessao_token: args.token } : {}),
  }
}

export type ResultadoCupom =
  | { ok: true; codigo: string; descontoCentavos: number; subtotalCentavos: number; totalItensCentavos: number }
  | { ok: false; mensagem: string; precisaLogin: boolean; limite: boolean }

function reais(centavos: number): string {
  return `R$ ${(Math.round(centavos) / 100).toFixed(2).replace('.', ',')}`
}

const MENSAGEM_GENERICA = 'Não foi possível validar o cupom agora. Tente de novo.'

/** Texto para o cliente quando o servidor não mandou `mensagem` (mesmos textos da spec). */
export function mensagemDoErroCupom(erro: string | undefined, minimoCentavos?: number): string {
  switch (erro) {
    case 'invalido':
      return 'Cupom inválido'
    case 'venceu':
      return 'Este cupom venceu'
    case 'nao_comecou':
      return 'Este cupom ainda não começou'
    case 'minimo':
      return typeof minimoCentavos === 'number' ? `Vale a partir de ${reais(minimoCentavos)} em itens` : 'O pedido não chegou ao mínimo deste cupom'
    case 'esgotou':
      return 'Este cupom esgotou'
    case 'ja_usou':
      return 'Você já usou este cupom'
    case 'precisa_login':
      return 'Entre com seu telefone para usar este cupom'
    default:
      return MENSAGEM_GENERICA
  }
}

/** Resposta de `cupom-validar`. `status` 0 = sem rede. Valor fora de forma nunca vira desconto. */
export function interpretarValidacao(codigo: string, resposta: { status: number; corpo: unknown }): ResultadoCupom {
  const c = (typeof resposta.corpo === 'object' && resposta.corpo !== null ? resposta.corpo : {}) as Record<string, unknown>

  if (resposta.status === 429) {
    return { ok: false, mensagem: 'Muitas tentativas. Aguarde um pouco e tente de novo.', precisaLogin: false, limite: true }
  }

  if (resposta.status >= 200 && resposta.status < 300 && c.ok === true) {
    const { desconto_centavos: desconto, subtotal_centavos: subtotal, total_itens_centavos: total } = c
    const inteiro = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0
    if (inteiro(desconto) && inteiro(subtotal) && inteiro(total) && desconto <= subtotal) {
      return { ok: true, codigo, descontoCentavos: desconto, subtotalCentavos: subtotal, totalItensCentavos: total }
    }
    return { ok: false, mensagem: MENSAGEM_GENERICA, precisaLogin: false, limite: false }
  }

  const erro = typeof c.erro === 'string' ? c.erro : undefined
  const minimo = typeof c.minimo_centavos === 'number' ? c.minimo_centavos : undefined
  const mensagem = typeof c.mensagem === 'string' && c.mensagem.trim() ? c.mensagem : mensagemDoErroCupom(erro, minimo)
  return { ok: false, mensagem, precisaLogin: erro === 'precisa_login', limite: false }
}

/** "−R$ 5,00" para a linha do resumo. */
export function textoDesconto(descontoCentavos: number): string {
  return `−${reais(descontoCentavos)}`
}

/** Total que o cliente vê e que vai em `total_esperado_centavos`: itens − desconto + taxa. Só exibição:
 * o servidor recalcula tudo e recusa (409) se divergir. */
export function totalComCupom(itensCentavos: number, descontoCentavos: number, taxaCentavos = 0): number {
  return Math.max(0, itensCentavos - descontoCentavos) + Math.max(0, taxaCentavos)
}
