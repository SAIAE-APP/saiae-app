import { semAcentoMaiusculo } from './atendimento.ts'
import { humanizarMetodo } from './metodoPagamento.ts'
import { formatarPrecoBR } from './preco.ts'

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

// Percentual da taxa de serviço em Ajustes: bps 1000 <-> "10", 750 <-> "7,5".
export function percentualDeBps(bps: number): string {
  return String(bps / 100).replace('.', ',')
}

// Texto digitado -> bps, aceitando vírgula ou ponto e até 2 casas; só de 0 a 30%. Inválido = null.
export function bpsDePercentual(texto: string): number | null {
  const t = texto.trim()
  if (!/^\d{1,2}(?:[.,]\d{1,2})?$/.test(t)) return null
  const bps = Math.round(parseFloat(t.replace(',', '.')) * 100)
  return bps <= 3000 ? bps : null
}

/** Texto pro operador de cada resposta da RPC `fechar_comanda` que não é `ok`. */
export function mensagemFecharComanda(estado: string | undefined, metodoAtual?: string): string {
  switch (estado) {
    case 'ja_fechada':
      return `Esta comanda já foi fechada em outro aparelho com outra forma de pagamento (${humanizarMetodo(metodoAtual ?? null)}).`
    case 'sem_itens':
      return 'Esta comanda não tem itens ativos: não dá para cobrar.'
    case 'metodo_invalido':
      return 'Forma de pagamento inválida.'
    case 'sem_acesso':
      return 'Sem permissão para fechar esta comanda.'
    case 'nao_autenticado':
      return 'Sua sessão expirou. Entre de novo e tente outra vez.'
    default:
      return 'Não foi possível fechar a comanda. Tente de novo.'
  }
}

/** Botão de Mesas: comanda sem rodada ativa (todas canceladas) só é encerrada, sem cobrança. */
export function textoBotaoFecharComanda(rodadasAtivas: number): string {
  return rodadasAtivas === 0 ? 'Encerrar comanda vazia' : 'Fechar comanda e cobrar'
}

/** Toast de sucesso do fechamento. Vale o total devolvido pelo servidor (a tela pode estar desatualizada). */
export function textoComandaFechada(
  mesa: string,
  totalServidorCentavos: number | undefined,
  totalTelaCentavos: number,
  vazia: boolean,
): string {
  if (vazia) return `Mesa ${mesa} encerrada sem cobrança.`
  return `Mesa ${mesa} fechada: ${formatarPrecoBR(totalServidorCentavos ?? totalTelaCentavos)}.`
}

/** Mesa de um pedido que é rodada de comanda aberta (tem comanda e mesa); null nos demais.
 * Na rodada a identificação principal é a mesa, e a senha fica em segundo plano. */
export function mesaDaRodada(pedido: { comanda_id?: string | null; mesa?: string | null }): string | null {
  const mesa = (pedido.mesa ?? '').trim()
  return pedido.comanda_id && mesa ? mesa : null
}

/** Texto da barra preta da comanda impressa. Rodada de comanda mostra "MESA 2" (sem acento, maiúsculo) e a senha vai
 * numa linha pequena; se o nome da mesa não cabe na barra, volta a senha. */
export function textoBarraComanda(
  dados: { comandaMesa?: boolean; mesa: string | null; senha: number | null },
  colunasBarra: number,
): { barra: string; senhaNumero: string; comMesa: boolean } {
  const senhaNumero = dados.senha !== null ? String(dados.senha).padStart(3, '0') : '---'
  const mesa = dados.comandaMesa ? (dados.mesa ?? '').trim() : ''
  const rotulo = mesa ? semAcentoMaiusculo(`MESA ${mesa}`) : ''
  const comMesa = rotulo !== '' && rotulo.length <= colunasBarra
  return { barra: comMesa ? rotulo : senhaNumero, senhaNumero, comMesa }
}
