// Contrato integracao-v1 (bot de WhatsApp, fase 2; docs/contrato/v1/integracao-v1-bot.md): validação do corpo,
// assinatura com lista de segredos e regras puras de recusa. Sem Deno/Supabase, testado em tests/integracaoV1*.test.ts.
// O PREÇO nunca é calculado aqui: sai do resolver_carrinho (ver carrinho.ts).
import { montarLinhas, type LinhaCarrinho } from './carrinho.ts'
import { type HorarioDia, barracaAbertaAgora } from './horario.ts'
import { verificarAssinaturaIa } from './iaAssinatura.ts'

export const MAX_LINHAS_BOT = 40
const MIN_SEGREDO = 16

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const TELEFONE = /^[0-9]{10,13}$/

export type Entrega = { rua: string; numero: string; bairro: string; referencia: string | null }
type Base = { barracaId: string }
type Cliente = {
  clientUuid: string
  clienteNome: string | null
  clienteTelefone: string
  itens: LinhaCarrinho[]
}

export type CorpoIntegracao =
  | (Base & { acao: 'cardapio' })
  | (Base & { acao: 'rascunho'; itens: LinhaCarrinho[] })
  | (Base & Cliente & { acao: 'pedido'; tipoAtendimento: 'retirada' | 'entrega'; entrega: Entrega | null })
  | (Base & Cliente & { acao: 'pix'; tipoAtendimento: 'retirada'; conversaId: string })

// Chaves aceitas por ação: qualquer outra chave é corpo fora do contrato (422, sem ecoar valores).
const CHAVES: Record<string, string[]> = {
  cardapio: ['barraca_id', 'acao'],
  rascunho: ['barraca_id', 'acao', 'itens'],
  pedido: ['barraca_id', 'acao', 'itens', 'client_uuid', 'cliente_nome', 'cliente_telefone', 'tipo_atendimento', 'entrega'],
  pix: ['barraca_id', 'acao', 'itens', 'client_uuid', 'cliente_nome', 'cliente_telefone', 'tipo_atendimento', 'conversa_id'],
}

const texto = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '')

function validarEntrega(bruta: unknown): Entrega | null {
  if (typeof bruta !== 'object' || bruta === null || Array.isArray(bruta)) return null
  const e = bruta as Record<string, unknown>
  if (Object.keys(e).some((k) => !['rua', 'numero', 'bairro', 'referencia'].includes(k))) return null
  const rua = texto(e.rua, 120)
  const numero = texto(e.numero, 20)
  const bairro = texto(e.bairro, 80)
  if (!rua || !numero || !bairro) return null
  return { rua, numero, bairro, referencia: texto(e.referencia, 120) || null }
}

/** Valida o JSON já lido. Nunca lança e nunca devolve o motivo (o 422 não ecoa valores). */
export function validarCorpoIntegracao(corpo: unknown): { ok: true; valor: CorpoIntegracao } | { ok: false } {
  const recusa = { ok: false } as const
  if (typeof corpo !== 'object' || corpo === null || Array.isArray(corpo)) return recusa
  const o = corpo as Record<string, unknown>
  const acao = o.acao
  if (typeof acao !== 'string' || !(acao in CHAVES)) return recusa
  if (Object.keys(o).some((k) => !CHAVES[acao].includes(k))) return recusa
  if (typeof o.barraca_id !== 'string' || !UUID.test(o.barraca_id)) return recusa
  const barracaId = o.barraca_id.toLowerCase()

  if (acao === 'cardapio') return { ok: true, valor: { acao, barracaId } }

  const montada = montarLinhas(o.itens, { maxLinhas: MAX_LINHAS_BOT, maxQuantidade: null })
  if (!montada.ok) return recusa
  if (acao === 'rascunho') return { ok: true, valor: { acao, barracaId, itens: montada.linhas } }

  if (typeof o.client_uuid !== 'string' || !UUID.test(o.client_uuid)) return recusa
  if (typeof o.cliente_telefone !== 'string' || !TELEFONE.test(o.cliente_telefone)) return recusa
  if (o.cliente_nome !== undefined && o.cliente_nome !== null && typeof o.cliente_nome !== 'string') return recusa
  const cliente: Cliente = {
    clientUuid: o.client_uuid.toLowerCase(),
    clienteNome: texto(o.cliente_nome, 60) || null,
    clienteTelefone: o.cliente_telefone,
    itens: montada.linhas,
  }

  if (acao === 'pix') {
    // Pix só para Retirada nesta fase; conversa_id é opaco (o Sai aê só guarda).
    if (o.tipo_atendimento !== undefined && o.tipo_atendimento !== 'retirada') return recusa
    if (typeof o.conversa_id !== 'string' || o.conversa_id.length < 1 || o.conversa_id.length > 200) return recusa
    return { ok: true, valor: { acao, barracaId, ...cliente, tipoAtendimento: 'retirada', conversaId: o.conversa_id } }
  }

  const tipo = o.tipo_atendimento ?? 'retirada'
  if (tipo !== 'retirada' && tipo !== 'entrega') return recusa
  if (tipo === 'retirada') {
    if (o.entrega !== undefined && o.entrega !== null) return recusa
    return { ok: true, valor: { acao: 'pedido', barracaId, ...cliente, tipoAtendimento: 'retirada', entrega: null } }
  }
  // Entrega: o endereço é obrigatório e o nome do cliente também (vai na comanda e no link do entregador).
  const entrega = validarEntrega(o.entrega)
  if (!entrega || !cliente.clienteNome || cliente.clienteNome.length < 2) return recusa
  return { ok: true, valor: { acao: 'pedido', barracaId, ...cliente, tipoAtendimento: 'entrega', entrega } }
}

/** `segredos` é a lista separada por vírgula (rotação): vale se QUALQUER um confere. Segredo curto é ignorado;
 * lista sem nenhum segredo válido nunca autentica. */
export async function verificarAssinaturaLista(
  segredos: string | undefined,
  timestamp: string | null,
  assinatura: string | null,
  corpoBruto: string,
  agoraMs: number = Date.now(),
): Promise<boolean> {
  const lista = (segredos ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length >= MIN_SEGREDO)
  let confere = false
  // Testa todos (sem curto-circuito) para o tempo não revelar qual segredo da lista bateu.
  for (const s of lista) {
    if (await verificarAssinaturaIa(s, timestamp, assinatura, corpoBruto, agoraMs)) confere = true
  }
  return confere
}

/** Há segredo configurado que valha? Sem isso a rota responde 503 e nunca aceita nada. */
export function haSegredoValido(segredos: string | undefined): boolean {
  return (segredos ?? '').split(',').some((s) => s.trim().length >= MIN_SEGREDO)
}

/** Campos crus da barraca usados pelo bot (mesmos nomes das colunas; vêm do integracao_cardapio ou de `barracas`). */
export type LojaCrua = {
  nome: string
  slug: string
  modos_atendimento?: string[] | null
  pagar_na_entrega_habilitado?: boolean | null
  pagamento_online_habilitado?: boolean | null
  perfil_cliente_obrigatorio?: boolean | null
  ia_habilitada?: boolean | null
  ia_whatsapp_dono?: string | null
  ia_whatsapp_dono_confirmado_em?: string | null
  fuso?: string | null
}

/** Modos que o bot sabe atender. Entrega só com "pagar na entrega" (Pix com entrega não existe nesta fase);
 * sem nenhum modo atendível a loja cai em Retirada, como o cardápio público. */
export function modosDoBot(l: LojaCrua): ('retirada' | 'entrega')[] {
  const m = l.modos_atendimento ?? []
  const entrega = m.includes('entrega') && l.pagar_na_entrega_habilitado === true
  const retirada = m.includes('retirada') || !entrega
  return [...(retirada ? (['retirada'] as const) : []), ...(entrega ? (['entrega'] as const) : [])]
}

/** Pix do bot só existe com pagamento online ligado E sem exigência de perfil confirmado (o bot não confirma perfil). */
export function pixDisponivel(l: LojaCrua): boolean {
  return l.pagamento_online_habilitado === true && l.perfil_cliente_obrigatorio !== true
}

export function lojaDoBot(l: LojaCrua, horarios: HorarioDia[], urlApp: string, agora: Date = new Date()) {
  return {
    nome: l.nome,
    slug: l.slug,
    link_cardapio: `${urlApp.replace(/\/+$/, '')}/${l.slug}/cardapio`,
    aberta_agora: barracaAbertaAgora(horarios, l.fuso, agora),
    modos: modosDoBot(l) as string[],
    pagamentos: { na_entrega: l.pagar_na_entrega_habilitado === true, pix: pixDisponivel(l) },
    // Só o número que o dono confirmou recebe aviso do bot.
    whatsapp_dono: l.ia_whatsapp_dono_confirmado_em ? (l.ia_whatsapp_dono ?? null) : null,
    bot_habilitado: l.ia_habilitada === true,
  }
}

export type Recusa = { codigo: string; mensagem: string }

/** Recusas de negócio de `pedido` e `pix`, na ordem em que valem. null = pode seguir. */
export function recusaDaAcao(
  acao: 'pedido' | 'pix',
  tipo: 'retirada' | 'entrega',
  l: LojaCrua,
  abertaAgora: boolean,
): Recusa | null {
  if (l.ia_habilitada !== true) return { codigo: 'bot_desligado', mensagem: 'O atendimento por WhatsApp não está ligado nesta loja.' }
  if (!abertaAgora) return { codigo: 'fechado', mensagem: 'A loja está fechada no momento.' }
  if (!modosDoBot(l).includes(tipo)) return { codigo: 'modo_indisponivel', mensagem: 'A loja não atende neste modo.' }
  if (acao === 'pedido' && l.pagar_na_entrega_habilitado !== true) {
    return { codigo: 'sem_pagar_na_entrega', mensagem: 'A loja não aceita pagar na entrega.' }
  }
  if (acao === 'pix') {
    if (l.perfil_cliente_obrigatorio === true) {
      return { codigo: 'perfil_obrigatorio', mensagem: 'Esta loja exige confirmar o telefone no cardápio.' }
    }
    if (l.pagamento_online_habilitado !== true) return { codigo: 'sem_pix', mensagem: 'A loja não aceita Pix online.' }
  }
  return null
}

/** Mesma normalização do cardápio e do banco: tira o 55 do país só com 12 ou 13 dígitos (com 10/11 o 55 é DDD). */
export function telefoneSemPais(digitos: string): string {
  return (digitos.length === 12 || digitos.length === 13) && digitos.startsWith('55') ? digitos.slice(2) : digitos
}
