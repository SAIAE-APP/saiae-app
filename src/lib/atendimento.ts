import type { Barraca, Pedido, TipoAtendimento } from '../types/database'

/** Ordem fixa em que os modos aparecem (Ajustes e seletor de Lançar). */
export const TODOS_OS_MODOS: TipoAtendimento[] = ['mesa', 'balcao', 'retirada', 'entrega']

/** O que a barraca tinha antes dos modos configuráveis: Mesa/Balcão/Viagem. */
export const MODOS_PADRAO: TipoAtendimento[] = ['mesa', 'balcao', 'retirada']

export const ROTULO_MODO: Record<TipoAtendimento, string> = {
  mesa: 'Mesa',
  balcao: 'Balcão',
  retirada: 'Retirada',
  entrega: 'Entrega',
}

export const DESCRICAO_MODO: Record<TipoAtendimento, string> = {
  mesa: 'Consumo no local, com número ou nome da mesa',
  balcao: 'Consumo no local, sem mesa',
  retirada: 'O cliente leva embora',
  entrega: 'O motoboy leva até o cliente',
}

export const ICONE_MODO: Record<TipoAtendimento, string> = {
  mesa: 'table_restaurant',
  balcao: 'storefront',
  retirada: 'takeout_dining',
  entrega: 'two_wheeler',
}

/** Modos ligados da barraca, na ordem fixa. Cache antigo sem o campo (ou valor
 * inválido/vazio) cai no padrão — nunca deixa a tela de Lançar sem modo. */
export function modosAtivos(barraca: Pick<Barraca, 'modos_atendimento'> | null): TipoAtendimento[] {
  const salvos = barraca?.modos_atendimento
  if (!salvos || salvos.length === 0) return MODOS_PADRAO
  const ativos = TODOS_OS_MODOS.filter((m) => salvos.includes(m))
  return ativos.length > 0 ? ativos : MODOS_PADRAO
}

/** Modos que o cardápio digital público pode oferecer: os ligados pela barraca,
 * menos Entrega (o cardápio não coleta endereço nem taxa). Resposta antiga da
 * função (sem o campo), ou barraca que só tem Entrega ligada, cai no padrão
 * em vez de deixar o cliente sem opção. */
export function modosDoCardapioPublico(salvos: TipoAtendimento[] | null | undefined): TipoAtendimento[] {
  if (!salvos || salvos.length === 0) return MODOS_PADRAO
  const oferecidos = TODOS_OS_MODOS.filter((m) => m !== 'entrega' && salvos.includes(m))
  return oferecidos.length > 0 ? oferecidos : MODOS_PADRAO
}

/** `pedidos.viagem` = "não consome no local" (Retirada ou Entrega). */
export function ehViagem(tipo: TipoAtendimento): boolean {
  return tipo === 'retirada' || tipo === 'entrega'
}

/** Tipo de um pedido; deriva de mesa/viagem quando `tipo_atendimento` é NULL. */
export function tipoDoPedido(pedido: Pick<Pedido, 'tipo_atendimento' | 'mesa' | 'viagem'>): TipoAtendimento {
  if (pedido.tipo_atendimento) return pedido.tipo_atendimento
  if (pedido.viagem) return 'retirada'
  return pedido.mesa ? 'mesa' : 'balcao'
}

type DadosAtendimento = Pick<Pedido, 'tipo_atendimento' | 'mesa' | 'viagem'>

/** Texto do tipo no card do pedido: "Mesa 4", "Balcão", "Retirada", "Entrega". */
export function rotuloAtendimento(pedido: DadosAtendimento): string {
  const tipo = tipoDoPedido(pedido)
  if (tipo === 'mesa') return pedido.mesa ? `Mesa ${pedido.mesa}` : ROTULO_MODO.balcao
  return ROTULO_MODO[tipo]
}

export function iconeAtendimento(pedido: DadosAtendimento): string {
  return ICONE_MODO[tipoDoPedido(pedido)]
}

/** Modo inicial do seletor: o primeiro ativo, preferindo Balcão (o padrão de sempre). */
export function modoInicial(ativos: TipoAtendimento[]): TipoAtendimento {
  return ativos.includes('balcao') ? 'balcao' : ativos[0]
}

/** Faixa em destaque no topo da comanda impressa. Mesa/Balcão não têm faixa:
 * o destaque existe pra separar o que sai do balcão (Retirada x Entrega). */
export function faixaImpressao(tipo: TipoAtendimento): string | null {
  if (tipo === 'entrega') return '*** ENTREGA ***'
  if (tipo === 'retirada') return '*** RETIRADA ***'
  return null
}
