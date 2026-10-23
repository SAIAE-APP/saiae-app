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
