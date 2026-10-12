// reportar-bug (auditoria M4): limites de tamanho e e-mail sem texto do cliente no assunto.
// Funções puras, testadas em tests/reportarBug.test.ts.

export const LIMITE_RELATOS_POR_HORA = 5
export const TIPO_LIMITE_BUG = 'bug'

export const MAX_DESCRICAO = 4000
export const MAX_ESPERADO = 2000
export const MAX_NOME = 80
export const MAX_SLUG = 80
export const MAX_USER_AGENT = 200

/** Uma linha só: quebras e separadores Unicode de linha viram espaço (sem forjar cabeçalho/linha). */
export function umaLinha(v: unknown, max: number): string {
  return String(v ?? '')
    .replace(/[\r\n\u2028\u2029]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
}

/** Bloco de texto: preserva quebras, só apara e corta. */
export function bloco(v: unknown, max: number): string {
  return String(v ?? '').trim().slice(0, max)
}

export type Relato = {
  descricao: string
  esperado: string
  barracaNome: string
  barracaSlug: string
  userAgent: string
}

export function normalizarRelato(body: Record<string, unknown> | null | undefined): Relato {
  return {
    descricao: bloco(body?.descricao, MAX_DESCRICAO),
    esperado: bloco(body?.esperado, MAX_ESPERADO),
    barracaNome: umaLinha(body?.barraca_nome, MAX_NOME),
    barracaSlug: umaLinha(body?.barraca_slug, MAX_SLUG),
    userAgent: umaLinha(body?.user_agent, MAX_USER_AGENT),
  }
}

/** Assunto fixo: só o prefixo do id do usuário (vem do JWT), nunca texto enviado pelo cliente. */
export function assuntoDoRelato(usuarioId: string): string {
  return `[Bug] ${usuarioId.slice(0, 8)}`
}

export function corpoDoRelato(usuarioEmail: string, r: Relato): string {
  const linhas = [
    `Usuário: ${usuarioEmail}`,
    'Dados abaixo informados pelo navegador (não verificados):',
    `Barraca: ${r.barracaNome || '—'} (${r.barracaSlug || '—'})`,
    `Navegador: ${r.userAgent || '—'}`,
    '',
    'Descrição:',
    r.descricao,
  ]
  if (r.esperado) linhas.push('', 'O que esperava que acontecesse:', r.esperado)
  return linhas.join('\n')
}
