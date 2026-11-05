// Consentimento de cookies/medição. MESMA chave e valores do site (saiae.com.br/consent.js): 'granted' | 'denied'.
// Nada de medição (Pixel do Meta, GA4) carrega nem dispara sem 'granted'. Testado em tests/medicao.test.ts.

export const CHAVE_CONSENTIMENTO = 'sx_consent'
export type Consentimento = 'granted' | 'denied' | null

type Leitura = Pick<Storage, 'getItem'>
type Escrita = Pick<Storage, 'setItem'>

export function lerConsentimento(storage: Leitura = window.localStorage): Consentimento {
  try {
    const v = storage.getItem(CHAVE_CONSENTIMENTO)
    return v === 'granted' || v === 'denied' ? v : null
  } catch {
    return null
  }
}

export function salvarConsentimento(valor: 'granted' | 'denied', storage: Escrita = window.localStorage): void {
  try {
    storage.setItem(CHAVE_CONSENTIMENTO, valor)
  } catch {
    // sem storage: o aviso reaparece na próxima visita
  }
}

/** Política de privacidade do site (a mesma do aviso de cookies). */
export const URL_PRIVACIDADE = 'https://saiae.com.br/privacidade'
