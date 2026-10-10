// Disjuntor do assistente de configuração: se o app ficar indo e voltando entre /configurar e o resto
// (vai e vem de redirecionamentos), o assistente é suspenso nesta aba e o app abre normal.
// Princípio do onboarding: nunca prender o usuário por falha. Dura até fechar a aba (sessionStorage).

const CHAVE_SALTOS = 'saiae.assistente.saltos'
const CHAVE_SUSPENSO = 'saiae.assistente.suspenso'
export const JANELA_MS = 10_000
export const LIMITE_SALTOS = 6

type Armazem = Pick<Storage, 'getItem' | 'setItem'>

function armazem(): Armazem | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage
  } catch {
    return null
  }
}

/** Conta um redirecionamento do/para o assistente; suspende o assistente se passar do limite na janela. */
export function registrarSalto(agora: number = Date.now(), a: Armazem | null = armazem()): void {
  if (!a) return
  try {
    const lista = (JSON.parse(a.getItem(CHAVE_SALTOS) ?? '[]') as number[]).filter((t) => agora - t < JANELA_MS)
    lista.push(agora)
    a.setItem(CHAVE_SALTOS, JSON.stringify(lista))
    if (lista.length >= LIMITE_SALTOS) a.setItem(CHAVE_SUSPENSO, '1')
  } catch {
    // sem armazenamento: o disjuntor fica inativo, nada quebra
  }
}

export function assistenteSuspenso(a: Armazem | null = armazem()): boolean {
  try {
    return a?.getItem(CHAVE_SUSPENSO) === '1'
  } catch {
    return false
  }
}
