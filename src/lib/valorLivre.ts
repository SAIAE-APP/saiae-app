// Valor livre ("Preço aberto"), PR 3/4: regra de validação do valor e do "o que foi vendido".
// Spec: docs/superpowers/specs/2026-10-19-valor-livre-design.md (seção 2 e decisões da seção 6).
import { reaisParaCentavos } from './preco.ts'

/** Limite por linha (decisão 4 do João): R$ 9.999,99. */
export const LIMITE_VALOR_LIVRE_CENTAVOS = 999_999
export const MIN_OBS_VALOR_LIVRE = 2
export const MAX_OBS_VALOR_LIVRE = 60

export type ResultadoValorLivre = { ok: true; centavos: number; observacao: string } | { ok: false; erro: string }

/** Valida o que o operador digitou: valor > 0 e <= limite; observação de 2 a 60 caracteres (obrigatória). */
export function validarValorLivre(valorTexto: string, observacao: string): ResultadoValorLivre {
  const centavos = reaisParaCentavos(valorTexto)
  const obs = observacao.trim().replace(/\s+/g, ' ')
  if (!Number.isFinite(centavos) || centavos <= 0) return { ok: false, erro: 'Digite o valor (maior que zero).' }
  if (centavos > LIMITE_VALOR_LIVRE_CENTAVOS) return { ok: false, erro: 'O valor máximo por linha é R$ 9.999,99.' }
  if (obs.length < MIN_OBS_VALOR_LIVRE) return { ok: false, erro: 'Diga o que foi vendido (mínimo 2 letras).' }
  if (obs.length > MAX_OBS_VALOR_LIVRE) return { ok: false, erro: `O que foi vendido: no máximo ${MAX_OBS_VALOR_LIVRE} letras.` }
  return { ok: true, centavos, observacao: obs }
}

/** Cada toque cria uma linha própria (nunca soma com outro valor): a chave carrega um sufixo único. */
export function chaveValorLivre(itemId: string, sufixo: string): string {
  return JSON.stringify([itemId, 'livre', sufixo])
}
