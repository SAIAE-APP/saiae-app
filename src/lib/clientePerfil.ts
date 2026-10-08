// Perfil do cliente final: validações do formulário e "pedir de novo". PURO (sem imports de outros
// arquivos do app): testável no Node.
function somenteDigitos(texto: string): string {
  return String(texto ?? '').replace(/\D/g, '')
}

/** Mesma regra de src/lib/entrega.ts: o 55 só sai com 12 ou 13 dígitos. */
function normalizarTelefone(texto: string): string {
  const d = somenteDigitos(texto)
  return (d.length === 12 || d.length === 13) && d.startsWith('55') ? d.slice(2) : d
}

export type ErrosIdentificacao = Partial<Record<'nome' | 'telefone' | 'privacidade', string>>

/** Etapa "seus dados" do fechamento: nome, telefone brasileiro com DDD e aceite da privacidade. */
export function validarDadosIdentificacao(d: { nome: string; telefone: string; aceitouPrivacidade: boolean }): ErrosIdentificacao {
  const erros: ErrosIdentificacao = {}
  if (d.nome.trim().length < 2) erros.nome = 'Informe seu nome'
  const tel = normalizarTelefone(d.telefone)
  if (tel.length !== 10 && tel.length !== 11) erros.telefone = 'Informe um telefone com DDD'
  if (!d.aceitouPrivacidade) erros.privacidade = 'Aceite a política de privacidade para continuar'
  return erros
}

/** Espelha supabase/functions/_shared/pedirDeNovo.ts (resposta da ação `pedir_de_novo`). */
export type LinhaPedirDeNovo = {
  item_id: string | null
  nome: string
  quantidade: number
  status: 'ok' | 'preco_mudou' | 'esgotado' | 'indisponivel' | 'refazer_opcoes'
  preco_atual_centavos: number | null
  preco_antigo_centavos: number
}

/** R$ 12,00 (mesmo formato de src/lib/preco.ts, copiado para manter este arquivo puro). */
function reais(centavos: number): string {
  return `R$ ${(centavos / 100).toFixed(2).replace('.', ',')}`
}

/** Só `ok` e `preco_mudou` entram no carrinho (o segundo, depois de o cliente ver o preço novo);
 * o resto fica de fora com um aviso: nunca monta carrinho errado em silêncio. */
export function resumoPedirDeNovo(linhas: LinhaPedirDeNovo[]) {
  const montar = linhas.filter((l) => l.status === 'ok' || l.status === 'preco_mudou')
  const bloqueados = linhas.filter((l) => !montar.includes(l))
  const avisos = linhas.flatMap((l) => {
    if (l.status === 'preco_mudou') return [`${l.nome}: o preço agora é ${reais(l.preco_atual_centavos ?? 0)}.`]
    if (l.status === 'esgotado') return [`${l.nome} está esgotado hoje.`]
    if (l.status === 'indisponivel') return [`${l.nome} não está mais no cardápio.`]
    if (l.status === 'refazer_opcoes') return [`${l.nome} tinha adicionais: escolha de novo no cardápio.`]
    return []
  })
  return { montar, avisos, bloqueados }
}

/** Itens do "pedir de novo" guardados entre a página de perfil e o cardápio. */
export type ItemPedirDeNovo = { item_id: string; quantidade: number }

export function lerPedirDeNovo(bruto: string | null): ItemPedirDeNovo[] {
  if (!bruto) return []
  try {
    const v = JSON.parse(bruto) as unknown
    if (!Array.isArray(v)) return []
    return v.filter(
      (i): i is ItemPedirDeNovo =>
        typeof i === 'object' && i !== null && typeof (i as ItemPedirDeNovo).item_id === 'string' &&
        Number.isInteger((i as ItemPedirDeNovo).quantidade) && (i as ItemPedirDeNovo).quantidade >= 1 && (i as ItemPedirDeNovo).quantidade <= 50,
    )
  } catch {
    return []
  }
}
