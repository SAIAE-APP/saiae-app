// Tela "Atendente IA" (Ajustes): validações e o link do WhatsApp da loja. PURO (sem imports): testável no Node.
// A IA do WhatsApp usa UM número do Sai aê para todas as lojas; o cliente chega por um link que já leva o código
// da loja na primeira mensagem (`#CODIGO`, é o que o CRM procura).

export const MAX_TEXTO_LIVRE = 2000
export const MAX_NUMERO_SAIAE_DIGITOS = 15

export type ResultadoWhatsapp = { ok: true; digitos: string } | { ok: false; motivo: string }

/** WhatsApp do dono para os avisos: só dígitos, com DDD, no formato que o banco aceita (10 a 13 dígitos; o 55 do
 * país entra se faltar, como no resto do app). Vazio é recusado: a IA precisa de onde avisar. */
export function validarWhatsappDono(texto: string): ResultadoWhatsapp {
  const d = String(texto ?? '').replace(/\D/g, '')
  if (d === '') return { ok: false, motivo: 'Informe o WhatsApp do dono com DDD.' }
  // "+" marca número internacional: só vale se for o do Brasil (+55). Sem "+", 10 ou 11 dígitos são DDD + número.
  if (String(texto).trim().startsWith('+') && !d.startsWith('55')) {
    return { ok: false, motivo: 'Use um número do Brasil com DDD, por exemplo (11) 99999-0000.' }
  }
  // 10 ou 11 dígitos = DDD + número (o 55 do país é acrescentado); 12 ou 13 já com 55.
  const completo = d.length === 10 || d.length === 11 ? `55${d}` : d
  if (!(completo.length === 12 || completo.length === 13) || !completo.startsWith('55')) {
    return { ok: false, motivo: 'Use um número do Brasil com DDD, por exemplo (11) 99999-0000.' }
  }
  return { ok: true, digitos: completo }
}

/** "O que a IA deve saber": até 2000 caracteres (limite do banco). Devolve o texto aparado ou o erro. */
export function validarTextoLivre(texto: string): { ok: true; texto: string | null } | { ok: false; motivo: string } {
  const limpo = String(texto ?? '').trim()
  if (limpo.length > MAX_TEXTO_LIVRE) return { ok: false, motivo: `O texto pode ter até ${MAX_TEXTO_LIVRE} caracteres (tem ${limpo.length}).` }
  return { ok: true, texto: limpo === '' ? null : limpo }
}

/** Código da loja do link: o mesmo formato do banco (6 caracteres sem I, L, O, 0 e 1). */
export function codigoValido(codigo: string | null | undefined): boolean {
  return typeof codigo === 'string' && /^[A-HJKMNP-Z2-9]{6}$/.test(codigo)
}

/** Número do Sai aê (de `VITE_WHATSAPP_NUMERO_SAIAE`): só dígitos, 10 a 15; qualquer outra coisa = indisponível. */
export function numeroSaiaeValido(bruto: string | null | undefined): string | null {
  const d = String(bruto ?? '').replace(/\D/g, '')
  return d.length >= 10 && d.length <= MAX_NUMERO_SAIAE_DIGITOS ? d : null
}

/** Primeira mensagem do cliente: leva o código com `#`, que o CRM procura em qualquer posição do texto. */
export function mensagemInicial(codigo: string): string {
  return `Oi! Quero tirar uma dúvida sobre a loja. #${codigo}`
}

/** `https://wa.me/<número do Sai aê>?text=<mensagem com o código>`; null se faltar o número ou o código.
 * Nunca contém o telefone do dono. */
export function linkWhatsappDaLoja(numeroSaiae: string | null | undefined, codigo: string | null | undefined): string | null {
  const numero = numeroSaiaeValido(numeroSaiae)
  if (!numero || !codigoValido(codigo)) return null
  return `https://wa.me/${numero}?text=${encodeURIComponent(mensagemInicial(codigo as string))}`
}

/** Mensagens do erro da rpc `ia_ligar` em frases para o dono. */
export function mensagemErroIa(erro: { message?: string } | null | undefined): string {
  const m = erro?.message ?? ''
  if (/ia_sem_whatsapp_dono/.test(m)) return 'Antes de ligar, informe e salve o WhatsApp do dono: é para onde a IA avisa quando precisa de você.'
  if (/sem acesso/.test(m)) return 'Você não tem acesso a esta loja.'
  if (/failed to fetch|networkerror|network request failed|load failed/i.test(m)) return 'Sem internet. Não foi salvo.'
  return m ? `Não foi possível salvar: ${m}` : 'Não foi possível salvar. Tente novamente.'
}

export type ConsumoIa = { mes: string | null; conversas: number; limite: number | null }

/** Linha do consumo do mês na tela: "12 de 100 conversas este mês", "3 conversas este mês (sem limite definido)".
 * `atingiu` = passou do limite: a atendente só manda o link do cardápio até o mês virar. */
export function textoConsumo(c: ConsumoIa): { texto: string; atingiu: boolean } {
  const palavra = c.conversas === 1 ? 'conversa' : 'conversas'
  if (c.limite === null) return { texto: `${c.conversas} ${palavra} este mês (sem limite definido)`, atingiu: false }
  const atingiu = c.conversas >= c.limite
  return { texto: `${c.conversas} de ${c.limite} conversas este mês`, atingiu }
}

/** Resposta da function `ia-consumo` → dados da tela; qualquer coisa fora de forma = null ("consumo indisponível"). */
export function lerConsumo(corpo: unknown): ConsumoIa | null {
  if (typeof corpo !== 'object' || corpo === null) return null
  const { ok, mes, conversas, limite } = corpo as Record<string, unknown>
  if (ok !== true || typeof conversas !== 'number' || !Number.isInteger(conversas) || conversas < 0) return null
  if (limite !== null && (typeof limite !== 'number' || !Number.isInteger(limite) || limite < 0)) return null
  if (mes !== null && typeof mes !== 'string') return null
  return { mes: (mes as string | null) ?? null, conversas, limite }
}
