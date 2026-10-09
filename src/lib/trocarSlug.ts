// Tela "Endereço do cardápio" (Ajustes): textos e regras puras da troca do slug (H7). O formato, a lista de reservados e
// `gerarSlug` vêm de `onboardingConfig.ts` (uma só fonte, também usada pelo assistente de configuração).
// PURO, testado em tests/trocarSlug.test.ts.
import { SLUG_MAX, gerarSlug, mensagemDoProblemaSlug, problemaDoSlug } from './onboardingConfig.ts'

export const SLUG_MIN = 3

export const AVISO_TROCA =
  'Os links e QR codes antigos continuam funcionando. O atalho instalado no celular da equipe pode precisar ser reinstalado. Você só pode trocar de novo depois de 24 horas.'

/** Enquanto o dono DIGITA: minúsculo, sem acento, hífen no lugar de espaço e símbolo, sem hífen repetido nem no começo.
 * O hífen do FIM fica (senão não dá para digitar "pastel-do-ze": o hífen sumiria antes da próxima letra). */
export function normalizarSlugDigitado(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '')
    .slice(0, SLUG_MAX)
}

/** O que vai para a validação e para o banco: o digitado, sem hífen pendurado no fim. */
export function slugParaSalvar(digitado: string): string {
  return normalizarSlugDigitado(digitado).replace(/-+$/, '')
}

/** Erro de formato do que está no campo (null = pode tentar salvar). Inclui o mínimo de 3 que o banco exige. */
export function erroDoCampoSlug(slug: string): string | null {
  if (slug.length > 0 && slug.length < SLUG_MIN) return `Use pelo menos ${SLUG_MIN} caracteres.`
  const p = problemaDoSlug(slug)
  return p ? mensagemDoProblemaSlug(p) : null
}

export function podeSalvarSlug(atual: string, digitado: string): boolean {
  const final = slugParaSalvar(digitado)
  return final !== atual && erroDoCampoSlug(final) === null
}

/** Sugestão "Usar o nome da barraca". */
export function slugDoNome(nome: string): string {
  return gerarSlug(nome)
}

/** Texto para o dono de cada resposta da RPC `barraca_trocar_slug`. */
export function mensagemTrocarSlug(estado: string | undefined): string {
  switch (estado) {
    case 'em_uso':
      return 'Esse endereço já está em uso. Escolha outro.'
    case 'reservado':
      return 'Esse endereço é reservado. Escolha outro.'
    case 'invalido':
      return 'Use de 3 a 40 caracteres: letras minúsculas, números e hífen.'
    case 'muito_cedo':
      return 'O endereço já foi trocado nas últimas 24 horas. Tente de novo amanhã.'
    case 'limite_apelidos':
      return 'Esta barraca já usou o limite de endereços antigos (10). Fale com o suporte.'
    case 'sem_acesso':
      return 'Só o dono da barraca pode trocar o endereço do cardápio.'
    case 'nao_autenticado':
      return 'Sua sessão expirou. Entre de novo e tente outra vez.'
    default:
      return 'Não foi possível trocar o endereço agora. Tente de novo.'
  }
}
