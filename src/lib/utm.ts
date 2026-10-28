// Origem do cadastro (UTM): o site manda o visitante para o app com utm_* na URL. Guardamos em localStorage por 90 dias
// (dado próprio de atribuição, sem cookie de terceiros) e gravamos no cadastro depois do login. PURO nas funções de
// decisão (testado em tests/utm.test.ts); o acesso ao localStorage fica em try/catch (navegação privada, WebView).

export const PARAMETROS_UTM = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'] as const
export type ParametroUtm = (typeof PARAMETROS_UTM)[number]
export type Utm = Partial<Record<ParametroUtm, string>>
export type UtmGuardado = { utm: Utm; guardadoEm: number }

export const CHAVE_UTM = 'saiae:utm'
export const VALIDADE_UTM_MS = 90 * 24 * 60 * 60 * 1000
const TAMANHO_MAXIMO = 200

/** Só os 5 parâmetros da lista, sem vazios, com espaço aparado e tamanho limitado. Qualquer outro é ignorado. */
export function lerUtmDaUrl(search: string): Utm {
  const params = new URLSearchParams(search)
  const utm: Utm = {}
  for (const nome of PARAMETROS_UTM) {
    const valor = (params.get(nome) ?? '').trim().slice(0, TAMANHO_MAXIMO)
    if (valor) utm[nome] = valor
  }
  return utm
}

/** URL com UTM = novo toque, substitui o conjunto inteiro; URL sem UTM nunca apaga o que já estava guardado. */
export function decidirUtmGuardado(atual: UtmGuardado | null, daUrl: Utm, agora: number): UtmGuardado | null {
  if (Object.keys(daUrl).length > 0) return { utm: daUrl, guardadoEm: agora }
  return utmVigente(atual, agora) ? atual : null
}

export function utmVigente(guardado: UtmGuardado | null, agora: number): guardado is UtmGuardado {
  return guardado !== null && agora - guardado.guardadoEm < VALIDADE_UTM_MS && Object.keys(guardado.utm).length > 0
}

function lerGuardado(storage: Pick<Storage, 'getItem'>): UtmGuardado | null {
  try {
    const bruto = storage.getItem(CHAVE_UTM)
    if (!bruto) return null
    const lido = JSON.parse(bruto) as { utm?: unknown; guardadoEm?: unknown }
    if (typeof lido.guardadoEm !== 'number' || typeof lido.utm !== 'object' || lido.utm === null) return null
    // Reaplica o filtro: o que está no storage também só pode conter os 5 parâmetros.
    const utm = lerUtmDaUrl(new URLSearchParams(lido.utm as Record<string, string>).toString())
    return { utm, guardadoEm: lido.guardadoEm }
  } catch {
    return null
  }
}

/** Chamado uma vez ao abrir o app. Nunca lança. */
export function capturarUtm(
  search: string,
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> = window.localStorage,
  agora = Date.now(),
): void {
  try {
    const novo = decidirUtmGuardado(lerGuardado(storage), lerUtmDaUrl(search), agora)
    if (novo) storage.setItem(CHAVE_UTM, JSON.stringify(novo))
    else storage.removeItem(CHAVE_UTM)
  } catch {
    // sem storage: a medição some, o app segue
  }
}

/** UTM guardado e ainda dentro dos 90 dias, ou null. */
export function utmDoCadastro(
  storage: Pick<Storage, 'getItem'> = window.localStorage,
  agora = Date.now(),
): Utm | null {
  try {
    const guardado = lerGuardado(storage)
    return utmVigente(guardado, agora) ? guardado.utm : null
  } catch {
    return null
  }
}
