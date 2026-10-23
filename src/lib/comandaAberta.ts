// Regras puras da comanda aberta por mesa e da taxa de serviço.
// Tudo atrás de interruptor por barraca (desligado por padrão). A taxa de serviço
// aparece à parte, nunca somada ao faturamento dos itens.

export function comandaAbertaLigada(
  barraca: { comanda_aberta_habilitada?: boolean } | null | undefined,
): boolean {
  return barraca?.comanda_aberta_habilitada === true
}

export function modoUsaComanda(
  barraca: { comanda_aberta_habilitada?: boolean } | null | undefined,
  tipo: string | null | undefined,
): boolean {
  return comandaAbertaLigada(barraca) && tipo === 'mesa'
}

// Espelho exato do SQL public.normalizar_mesa (migration 20261029100000): mesma ordem de passos.
export function normalizarMesa(texto: string): string {
  const aparar = (s: string) => s.replace(/^ +| +$/g, '')
  let s = (texto ?? '').toLowerCase()
  s = s.replace(/[áàâãäéèêëíìîïóòôõöúùûüçñ]/g, (c) => 'aaaaaeeeeiiiiooooouuuucn'['áàâãäéèêëíìîïóòôõöúùûüçñ'.indexOf(c)])
  s = aparar(s.replace(/\s+/g, ' '))
  // "mesa" como palavra inteira ou colado num número ("mesa5"); "mesanino" fica.
  s = aparar(s.replace(/^mesa(?:(?![\p{L}\p{N}_])|(?=[0-9]))/u, ''))
  s = aparar(s.replace(/^[^a-z0-9]+/, ''))
  return s.replace(/^0+([0-9])/, '$1')
}

// Texto do botão de envio. `mesaTemComanda` undefined = ainda não se sabe (lista de comandas não carregada).
export function textoBotaoEnviar(modoComanda: boolean, mesa: string, mesaTemComanda: boolean | undefined): string {
  if (!modoComanda) return 'Confirmar e enviar'
  if (mesaTemComanda === undefined) return 'Enviar para a cozinha'
  // Se o operador já digitou "Mesa 5", não vira "Mesa Mesa 5".
  const numero = mesa.trim().replace(/^mesa(?:(?![\p{L}\p{N}_])|(?=[0-9]))[^\p{L}\p{N}]*/iu, '')
  return `${mesaTemComanda ? 'Adicionar à comanda da' : 'Abrir comanda da'} Mesa ${numero}`
}

export type ComandaAberta = {
  id: string
  mesa: string
  abertaEm: string
  subtotalCentavos: number
  rodadas: {
    pedidoId: string
    senha: number | null
    criadoEm: string
    status: string
    itens: { nome: string; quantidade: number }[]
  }[]
}

// Uma linha por pedido (rodada) de comanda aberta, já com os dados da comanda.
export type LinhaBanco = {
  comanda_id: string
  mesa: string
  aberta_em: string
  pedido_id: string
  senha: number | null
  criado_em: string
  status: string
  itens: { nome_item: string; quantidade: number; preco_centavos_unitario: number; removido?: boolean }[]
}

// Agrupa as rodadas por comanda. Rodada cancelada e item removido não entram no subtotal nem na lista;
// a comanda aberta continua listada mesmo sem rodada ativa (o operador ainda precisa fechá-la).
export function agruparComandas(linhas: LinhaBanco[]): ComandaAberta[] {
  const porId = new Map<string, ComandaAberta>()
  for (const l of [...linhas].sort((a, b) => a.criado_em.localeCompare(b.criado_em))) {
    let c = porId.get(l.comanda_id)
    if (!c) {
      c = { id: l.comanda_id, mesa: l.mesa, abertaEm: l.aberta_em, subtotalCentavos: 0, rodadas: [] }
      porId.set(l.comanda_id, c)
    }
    if (l.status === 'cancelado') continue
    const itens = l.itens.filter((i) => !i.removido)
    c.subtotalCentavos += subtotalDaComanda([{ status: l.status, itens }])
    c.rodadas.push({
      pedidoId: l.pedido_id,
      senha: l.senha,
      criadoEm: l.criado_em,
      status: l.status,
      itens: itens.map((i) => ({ nome: i.nome_item, quantidade: i.quantidade })),
    })
  }
  return [...porId.values()].sort((a, b) => a.abertaEm.localeCompare(b.abertaEm))
}

export function subtotalDaComanda(
  pedidos: {
    status: string
    itens: { quantidade: number; preco_centavos_unitario: number; removido?: boolean }[]
  }[],
): number {
  let total = 0
  for (const p of pedidos) {
    if (p.status === 'cancelado') continue
    for (const i of p.itens) {
      if (!i.removido) total += i.quantidade * i.preco_centavos_unitario
    }
  }
  return total
}

// bps = centésimos de por cento (1000 = 10%). Metade sobe; inteiros, sem float.
export function taxaServicoCentavos(subtotalCentavos: number, bps: number): number {
  if (!(bps > 0) || !(subtotalCentavos > 0)) return 0
  return Math.floor((subtotalCentavos * bps + 5000) / 10000)
}

export function totalDoFechamento(
  subtotal: number,
  cobrarTaxa: boolean,
  bps: number,
): { taxaCentavos: number; totalCentavos: number } {
  const taxaCentavos = cobrarTaxa ? taxaServicoCentavos(subtotal, bps) : 0
  return { taxaCentavos, totalCentavos: subtotal + taxaCentavos }
}

export function taxaPadraoMarcada(barraca: { taxa_servico_habilitada?: boolean }): boolean {
  return barraca.taxa_servico_habilitada === true
}

// Agrupa rajadas de chamadas numa só, `ms` depois da última.
export function criarDebounce(fn: () => void, ms: number): (() => void) & { cancelar: () => void } {
  let t: ReturnType<typeof setTimeout> | undefined
  const chamar = () => {
    clearTimeout(t)
    t = setTimeout(fn, ms)
  }
  chamar.cancelar = () => clearTimeout(t)
  return chamar
}
