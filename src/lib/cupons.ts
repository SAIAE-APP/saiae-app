// Cupons no painel do dono (Ajustes). Lógica PURA (só importa `preco.ts`, que também é pura): validação do
// formulário, selo de situação e textos. Espelha as regras do banco (spec 2026-10-08-cupons-design.md) para o
// dono ver o erro na tela, não uma falha de constraint. O servidor é quem decide o desconto de cada pedido.
import { CENTAVOS_MAX, formatarPrecoBR, reaisParaCentavos } from './preco.ts'

export type TipoCupom = 'percentual' | 'fixo'

/** Linha de `cupons` como o painel lê. */
export type Cupom = {
  id: string
  codigo: string
  tipo: TipoCupom
  /** Percentual: 1–100. Fixo: centavos. */
  valor: number
  inicio_em: string | null
  fim_em: string | null
  limite_usos: number | null
  uma_por_cliente: boolean
  pedido_minimo_centavos: number
  ativo: boolean
}

/** Números agregados por cupom (rpc `cupons_resumo`; `cupom_usos` não é legível pelo painel). */
export type ResumoCupom = { cupom_id: string; usos_confirmados: number; desconto_total_centavos: number }

export type FormularioCupom = {
  codigo: string
  tipo: TipoCupom
  /** Percentual: "10". Fixo: reais, "5,00". */
  valorTexto: string
  /** Datas "AAAA-MM-DD" (campo de data); vazio = sem limite. */
  inicioTexto: string
  fimTexto: string
  /** Vazio = ilimitado. */
  limiteTexto: string
  umaPorCliente: boolean
  /** Reais; vazio = sem mínimo. */
  minimoTexto: string
  ativo: boolean
}

export type DadosCupom = Omit<Cupom, 'id'>

export const MAX_LIMITE_USOS = 1_000_000

export function formularioVazio(): FormularioCupom {
  return { codigo: '', tipo: 'percentual', valorTexto: '', inicioTexto: '', fimTexto: '', limiteTexto: '', umaPorCliente: false, minimoTexto: '', ativo: true }
}

/** Mesma regra do banco: maiúsculas, `[A-Z0-9_-]`, 3 a 20 caracteres. */
export function normalizarCodigo(texto: string): string | null {
  const codigo = String(texto ?? '').trim().toUpperCase()
  return /^[A-Z0-9_-]{3,20}$/.test(codigo) ? codigo : null
}

function reaisValidos(texto: string): number | null {
  const limpo = texto.trim()
  if (!/^\d+([.,]\d{0,2})?$/.test(limpo)) return null
  const [inteiro] = limpo.replace(',', '.').split('.')
  if (Number(inteiro) * 100 > CENTAVOS_MAX) return null // acima do teto é recusado, não cortado
  return reaisParaCentavos(limpo)
}

/** Fuso padrão (o das barracas do Brasil). Cupom NUNCA usa o fuso do navegador: o dono pode estar viajando. */
export const FUSO_PADRAO = 'America/Sao_Paulo'

/** `barracas.fuso` quando for um fuso IANA conhecido; senão o padrão. */
export function fusoDaLoja(fuso: string | null | undefined): string {
  if (!fuso) return FUSO_PADRAO
  try {
    new Intl.DateTimeFormat('pt-BR', { timeZone: fuso })
    return fuso
  } catch {
    return FUSO_PADRAO
  }
}

/** Partes de data/hora de um instante vistas no fuso (ano, mês 1–12, dia, hora, minuto, segundo). */
function partesNoFuso(ms: number, fuso: string) {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: fuso, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
  const p: Record<string, number> = {}
  for (const x of f.formatToParts(new Date(ms))) if (x.type !== 'literal') p[x.type] = Number(x.value)
  return { ano: p.year, mes: p.month, dia: p.day, hora: p.hour, min: p.minute, seg: p.second }
}

/** Diferença (ms) entre a hora de parede no fuso e o UTC naquele instante. */
function deslocamento(ms: number, fuso: string): number {
  const p = partesNoFuso(ms, fuso)
  return Date.UTC(p.ano, p.mes - 1, p.dia, p.hora, p.min, p.seg) - Math.floor(ms / 1000) * 1000
}

/** "AAAA-MM-DD" → início (00:00:00) ou fim (23:59:59.999) desse dia NO FUSO da loja, em ISO; null se inválida. */
export function dataParaIso(texto: string, ponta: 'inicio' | 'fim', fuso: string = FUSO_PADRAO): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(texto.trim())
  if (!m) return null
  const [ano, mes, dia] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const calendario = new Date(Date.UTC(ano, mes - 1, dia))
  // Date.UTC rola datas impossíveis (31/02 vira março): confere de volta.
  if (calendario.getUTCFullYear() !== ano || calendario.getUTCMonth() !== mes - 1 || calendario.getUTCDate() !== dia) return null
  const z = fusoDaLoja(fuso)
  const [h, mi, s, ms] = ponta === 'inicio' ? [0, 0, 0, 0] : [23, 59, 59, 999]
  const parede = Date.UTC(ano, mes - 1, dia, h, mi, s, ms)
  // Converte hora de parede em instante: aplica o deslocamento e confere de novo (virada de horário de verão).
  let instante = parede - deslocamento(parede, z)
  instante = parede - deslocamento(instante, z)
  return new Date(instante).toISOString()
}

/** Dia "AAAA-MM-DD" de um instante, visto no fuso da loja. */
export function isoParaDia(iso: string, fuso: string = FUSO_PADRAO): string {
  const p = partesNoFuso(Date.parse(iso), fusoDaLoja(fuso))
  return `${p.ano}-${String(p.mes).padStart(2, '0')}-${String(p.dia).padStart(2, '0')}`
}
export type ErrosCupom = Partial<Record<'codigo' | 'valor' | 'inicio' | 'fim' | 'limite' | 'minimo' | 'umaPorCliente', string>>

/** Valida o formulário. `lojaUsaPerfil`: "uma vez por cliente" exige o perfil do cliente (sessão), então só vale
 * com `perfil_cliente_obrigatorio` ligado. Devolve os `dados` prontos para gravar só se não houver erro. */
export function validarFormularioCupom(
  f: FormularioCupom,
  opcoes: { lojaUsaPerfil: boolean; fuso?: string | null },
): { ok: true; dados: DadosCupom } | { ok: false; erros: ErrosCupom } {
  const erros: ErrosCupom = {}

  const codigo = normalizarCodigo(f.codigo)
  if (!codigo) erros.codigo = 'Use de 3 a 20 letras, números, - ou _ (sem espaços).'

  let valor = 0
  if (f.tipo === 'percentual') {
    const t = f.valorTexto.trim()
    valor = /^\d{1,3}$/.test(t) ? Number(t) : 0
    if (valor < 1 || valor > 100) erros.valor = 'O desconto deve ser de 1% a 100%.'
  } else {
    const centavos = reaisValidos(f.valorTexto)
    if (centavos === null || centavos <= 0) erros.valor = 'Informe um valor maior que zero.'
    else valor = centavos
  }

  const fuso = fusoDaLoja(opcoes.fuso)
  const inicio = f.inicioTexto.trim() ? dataParaIso(f.inicioTexto, 'inicio', fuso) : null
  const fim = f.fimTexto.trim() ? dataParaIso(f.fimTexto, 'fim', fuso) : null
  if (f.inicioTexto.trim() && !inicio) erros.inicio = 'Data de início inválida.'
  if (f.fimTexto.trim() && !fim) erros.fim = 'Data de fim inválida.'
  if (inicio && fim && Date.parse(fim) <= Date.parse(inicio)) erros.fim = 'O fim deve ser depois do início.'

  let limite: number | null = null
  if (f.limiteTexto.trim()) {
    const t = f.limiteTexto.trim()
    const n = /^\d+$/.test(t) ? Number(t) : 0
    if (n < 1 || n > MAX_LIMITE_USOS) erros.limite = 'O limite de usos deve ser um número inteiro maior que zero (ou deixe vazio).'
    else limite = n
  }

  let minimo = 0
  if (f.minimoTexto.trim()) {
    const c = reaisValidos(f.minimoTexto)
    if (c === null) erros.minimo = 'Valor mínimo inválido.'
    else minimo = c
  }

  if (f.umaPorCliente && !opcoes.lojaUsaPerfil) {
    erros.umaPorCliente = 'Para limitar a uma vez por cliente, ligue o perfil do cliente na loja.'
  }

  if (Object.keys(erros).length > 0 || !codigo) return { ok: false, erros }
  return {
    ok: true,
    dados: {
      codigo,
      tipo: f.tipo,
      valor,
      inicio_em: inicio,
      fim_em: fim,
      limite_usos: limite,
      uma_por_cliente: f.umaPorCliente,
      pedido_minimo_centavos: minimo,
      ativo: f.ativo,
    },
  }
}

const dataCurta = (iso: string, fuso: string) => {
  const [ano, mes, dia] = isoParaDia(iso, fuso).split('-')
  return `${dia}/${mes}/${ano}`
}

/** Formulário preenchido a partir de um cupom salvo (editar); datas no fuso da loja. */
export function formularioDoCupom(c: Cupom, fuso?: string | null): FormularioCupom {
  const dia = (iso: string | null) => (iso ? isoParaDia(iso, fusoDaLoja(fuso)) : '')
  return {
    codigo: c.codigo,
    tipo: c.tipo,
    valorTexto: c.tipo === 'percentual' ? String(c.valor) : (c.valor / 100).toFixed(2).replace('.', ','),
    inicioTexto: dia(c.inicio_em),
    fimTexto: dia(c.fim_em),
    limiteTexto: c.limite_usos === null ? '' : String(c.limite_usos),
    umaPorCliente: c.uma_por_cliente,
    minimoTexto: c.pedido_minimo_centavos > 0 ? (c.pedido_minimo_centavos / 100).toFixed(2).replace('.', ',') : '',
    ativo: c.ativo,
  }
}

export type SeloCupom = 'Pausado' | 'Vencido' | 'Esgotado' | 'Agendado' | 'Ativo'

/** Situação do cupom para o selo da lista. Ordem de prioridade: pausado, vencido, esgotado, agendado, ativo. */
export function seloDoCupom(c: Pick<Cupom, 'ativo' | 'inicio_em' | 'fim_em' | 'limite_usos'>, usosConfirmados: number, agora: Date = new Date()): SeloCupom {
  if (!c.ativo) return 'Pausado'
  if (c.fim_em && Date.parse(c.fim_em) < agora.getTime()) return 'Vencido'
  if (c.limite_usos !== null && usosConfirmados >= c.limite_usos) return 'Esgotado'
  if (c.inicio_em && Date.parse(c.inicio_em) > agora.getTime()) return 'Agendado'
  return 'Ativo'
}

/** "−10%" ou "−R$ 5,00". */
export function textoDescontoDoCupom(c: Pick<Cupom, 'tipo' | 'valor'>): string {
  return c.tipo === 'percentual' ? `−${c.valor}%` : `−${formatarPrecoBR(c.valor)}`
}

/** "01/10/2026 a 31/10/2026", "a partir de 01/10/2026", "até 31/10/2026" ou "Sem prazo". */
export function textoValidade(c: Pick<Cupom, 'inicio_em' | 'fim_em'>, fusoLoja?: string | null): string {
  const fuso = fusoDaLoja(fusoLoja)
  if (c.inicio_em && c.fim_em) return `${dataCurta(c.inicio_em, fuso)} a ${dataCurta(c.fim_em, fuso)}`
  if (c.inicio_em) return `a partir de ${dataCurta(c.inicio_em, fuso)}`
  if (c.fim_em) return `até ${dataCurta(c.fim_em, fuso)}`
  return 'Sem prazo'
}

/** "3 / 10 usos" ou "3 usos" (sem limite). */
export function textoUsos(usosConfirmados: number, limite: number | null): string {
  if (limite !== null) return `${usosConfirmados} / ${limite} usos`
  return usosConfirmados === 1 ? '1 uso' : `${usosConfirmados} usos`
}

/** Cupom com uso (confirmado ou reservado) não pode ser apagado, só pausado. Confirmados vêm do resumo; o
 * banco é quem decide de verdade (`cupom_apagar`). */
export function podeApagar(usosConfirmados: number): boolean {
  return usosConfirmados === 0
}
