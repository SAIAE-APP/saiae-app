// Token do cliente final no aparelho. PURO (sem imports): testável no Node. O token só existe aqui
// (no banco fica o hash); vale 30 dias e some ao sair, ao vencer ou quando o servidor recusar.
export type SessaoCliente = { token: string; expira_em: string; nome: string; telefone: string }

const chave = (slug: string) => `saiae:cliente:${slug}`

export function lerSessao(slug: string): SessaoCliente | null {
  try {
    const bruto = localStorage.getItem(chave(slug))
    if (!bruto) return null
    const s = JSON.parse(bruto) as SessaoCliente
    if (!s?.token || !s.expira_em || Date.parse(s.expira_em) <= Date.now()) {
      localStorage.removeItem(chave(slug))
      return null
    }
    return s
  } catch {
    return null
  }
}

export function guardarSessao(slug: string, s: SessaoCliente): void {
  try {
    localStorage.setItem(chave(slug), JSON.stringify(s))
  } catch {
    /* sem armazenamento: o cliente só terá que confirmar de novo */
  }
}

export function limparSessao(slug: string): void {
  try {
    localStorage.removeItem(chave(slug))
  } catch {
    /* idem */
  }
}
