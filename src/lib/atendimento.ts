import type { Barraca, Pedido, TipoAtendimento } from '../types/database'

/** Nome do cliente pra mostrar: o informado no pedido, ou o do formulário de
 * Entrega (pedido da v6, sem `cliente_nome`). Vazio vira null. */
export function nomeDoCliente(
  pedido: Pick<Pedido, 'cliente_nome' | 'entrega_nome'>,
): string | null {
  return pedido.cliente_nome?.trim() || pedido.entrega_nome?.trim() || null
}

/** Ordem fixa em que os modos aparecem (Ajustes e seletor de Lançar). */
export const TODOS_OS_MODOS: TipoAtendimento[] = ['mesa', 'balcao', 'retirada', 'entrega']

/** O que a barraca tinha antes dos modos configuráveis: Mesa/Balcão/Viagem. */
export const MODOS_PADRAO: TipoAtendimento[] = ['mesa', 'balcao', 'retirada']

export const ROTULO_MODO: Record<TipoAtendimento, string> = {
  mesa: 'Mesa',
  balcao: 'Balcão',
  retirada: 'Para viagem',
  entrega: 'Entrega',
}

/** Rótulo pro CLIENTE no cardápio público: lá continua "Retirada". */
export const ROTULO_MODO_CARDAPIO: Record<'retirada' | 'entrega', string> = {
  retirada: 'Retirada',
  entrega: 'Entrega',
}

export const DESCRICAO_MODO: Record<TipoAtendimento, string> = {
  mesa: 'Consumo no local, com número ou nome da mesa',
  balcao: 'Consumo no local, sem mesa',
  retirada: 'O cliente leva embalado',
  entrega: 'O motoboy leva até o cliente',
}

/** Texto curto pro cliente final no cardápio público (o de cima é pro operador). */
export const DESCRICAO_CARDAPIO_MODO: Record<'retirada' | 'entrega', string> = {
  retirada: 'Você busca no local',
  entrega: 'Levamos até você',
}

export const ICONE_MODO: Record<TipoAtendimento, string> = {
  mesa: 'table_restaurant',
  balcao: 'storefront',
  retirada: 'takeout_dining',
  entrega: 'two_wheeler',
}

/** Ajuda curta de cada tipo no seletor de Lançar Pedido. */
export function ajudaDoModo(
  tipo: TipoAtendimento,
  barraca: { comanda_aberta_habilitada?: boolean; pagamento_depois_habilitado?: boolean } | null,
): string {
  if (tipo === 'mesa') {
    return barraca?.comanda_aberta_habilitada ? 'Comer aqui · conta aberta, paga no fim' : 'Comer aqui · paga agora'
  }
  if (tipo === 'balcao') return 'Comer aqui · paga agora'
  if (tipo === 'retirada') {
    return barraca?.pagamento_depois_habilitado ? 'Embalado · paga agora ou depois' : 'Embalado · paga agora'
  }
  return 'Embalado + endereço · paga agora'
}

const AVISO_COZINHA: Record<TipoAtendimento, string> = {
  mesa: 'MESA (comer aqui)',
  balcao: 'BALCÃO (comer aqui)',
  retirada: 'PARA VIAGEM (embalar)',
  entrega: 'ENTREGA (embalar)',
}

/** Linha de apoio: o que a cozinha vai ver na comanda deste tipo. */
export function avisoCozinha(tipo: TipoAtendimento): string {
  return `Cozinha vai receber: ${AVISO_COZINHA[tipo]}`
}

/** Modos ligados da barraca, na ordem fixa. Cache antigo sem o campo (ou valor
 * inválido/vazio) cai no padrão — nunca deixa a tela de Lançar sem modo. */
export function modosAtivos(barraca: Pick<Barraca, 'modos_atendimento'> | null): TipoAtendimento[] {
  const salvos = barraca?.modos_atendimento
  if (!salvos || salvos.length === 0) return MODOS_PADRAO
  const ativos = TODOS_OS_MODOS.filter((m) => salvos.includes(m))
  return ativos.length > 0 ? ativos : MODOS_PADRAO
}

/** Modos que o cardápio digital público oferece ao CONSUMIDOR: só Retirada e
 * Entrega (Mesa/Balcão saíram da UI pública em 2026-10-07; o servidor segue
 * aceitando os tipos antigos). Respeita o que a barraca ligou: Retirada se
 * ligou Retirada; Entrega se ligou Entrega E o cardápio tem como finalizá-la
 * (`entregaDisponivel`: "Pagar na entrega" ligado ou pagamento online).
 * Se nenhum passou (só Mesa/Balcão, resposta antiga sem o campo, ou Entrega
 * ligada sem como finalizar), cai em Retirada. */
export function modosDoCardapioPublico(
  salvos: TipoAtendimento[] | null | undefined,
  entregaDisponivel = false,
): ('retirada' | 'entrega')[] {
  const modos: ('retirada' | 'entrega')[] = []
  if (salvos?.includes('retirada')) modos.push('retirada')
  if (salvos?.includes('entrega') && entregaDisponivel) modos.push('entrega')
  return modos.length > 0 ? modos : ['retirada']
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

/** Colunas de papel que a faixa pode usar quando impressa em 2x de largura (58 mm = 32 colunas → 16). */
const COLUNAS_FAIXA_PADRAO = 16

export function semAcentoMaiusculo(texto: string): string {
  return texto
    // NFD separa o acento da letra; o 1º replace tira as marcas combinantes (U+0300 a U+036F).
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\x20-\x7e]/g, '')
    .trim()
    .toUpperCase()
}

/** Faixa em destaque, logo abaixo da senha da comanda impressa (2x de largura e altura): "*** MESA 12 ***",
 * "*** BALCAO ***", "*** PARA VIAGEM ***" ou "*** ENTREGA ***". Sem acento, para a térmica genérica. Sempre cabe nas
 * `colunasFaixa` colunas (16 no papel de 58 mm, 24 no de 80 mm): mesa com nome comprido perde os asteriscos e,
 * se ainda não couber, é truncada. */
export function faixaImpressao(
  tipo: TipoAtendimento,
  opcoes: { mesa?: string | null; colunasFaixa?: number } = {},
): string | null {
  if (tipo === 'entrega') return '*** ENTREGA ***'
  if (tipo === 'balcao') return '*** BALCAO ***'
  const mesa = semAcentoMaiusculo(opcoes.mesa ?? '')
  if (tipo === 'mesa' && !mesa) return '*** BALCAO ***'
  const max = opcoes.colunasFaixa ?? COLUNAS_FAIXA_PADRAO
  const texto = tipo === 'retirada' ? 'PARA VIAGEM' : `MESA ${mesa}`
  const comEstrelas = `*** ${texto} ***`
  if (comEstrelas.length <= max) return comEstrelas
  const simples = texto
  return simples.length <= max ? simples : simples.slice(0, max).trimEnd()
}
