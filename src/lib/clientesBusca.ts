// Busca de cliente de entrega ao lançar o próximo pedido: regras PURAS (sem Supabase), testadas em
// tests/clientesEntregaSalvo.test.ts. `clientesFinais.ts` só aplica o plano ao banco.
//
// Problema relatado (H2): o cliente salvo no 1º pedido não aparecia no 2º. Causas tratadas aqui:
//  * nome: o `ilike` do banco não ignora acento ("joao" não achava "João") nem aceita palavra do meio ("Maria Silva" não
//    achava "Maria da Silva"). Agora o padrão tem curinga no lugar das letras que podem ter acento e uma `%` entre as
//    palavras; o que voltar do banco é conferido de novo, ignorando acento e caixa;
//  * telefone: só dígitos importam; o 55 do país digitado é tolerado (o banco guarda sem ele).
import { somenteDigitos } from './entrega.ts'

/** Menos que isso é ruído: não consulta o banco. */
export const MIN_CARACTERES_NOME = 2
export const MIN_DIGITOS_TELEFONE = 4

export type PlanoDeBusca =
  | { tipo: 'vazio' }
  | { tipo: 'telefone'; padroes: string[] }
  | { tipo: 'nome'; padrao: string; palavras: string[] }

/** Minúsculo e sem acento (para comparar nomes). */
export function semAcentoMinusculo(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
}

/** Escapa \ % _ para o termo digitado não virar curinga do like. */
function escaparLike(termo: string): string {
  return termo.replace(/[\\%_]/g, (c) => `\\${c}`)
}

/** Padrão `like` de uma palavra que casa com ela mesma acentuada ou não: as letras que podem ter acento (a, e, i, o, u,
 * y, c, n) viram `_` (um caractere qualquer). Vale para o nome em forma composta (á = 1 caractere), que é a que o app
 * grava; o excesso de resultados é cortado por `nomeCasa`. */
function padraoDaPalavra(palavra: string): string {
  const base = semAcentoMinusculo(palavra)
  let saida = ''
  for (const c of base) {
    saida += /[aeiouycn]/.test(c) ? '_' : escaparLike(c)
  }
  return saida
}

export function planoDeBusca(termo: string): PlanoDeBusca {
  const texto = termo.trim()
  const digitos = somenteDigitos(texto)
  // "Parece telefone" = só dígitos e separadores comuns; senão é nome.
  const pareceTelefone = digitos.length > 0 && /^[\d\s()+-]+$/.test(texto)

  if (pareceTelefone) {
    if (digitos.length < MIN_DIGITOS_TELEFONE) return { tipo: 'vazio' }
    // O banco guarda sem o 55 do país. Quem digita "5511..." (ainda incompleto) também acha o "11...".
    const semPais = digitos.startsWith('55') ? digitos.slice(2) : null
    const padroes = [`%${digitos}%`]
    if (semPais && semPais.length >= MIN_DIGITOS_TELEFONE) padroes.push(`%${semPais}%`)
    return { tipo: 'telefone', padroes }
  }

  if (texto.length < MIN_CARACTERES_NOME) return { tipo: 'vazio' }
  const palavras = semAcentoMinusculo(texto).split(/\s+/).filter(Boolean)
  if (palavras.length === 0) return { tipo: 'vazio' }
  return { tipo: 'nome', padrao: `%${palavras.map(padraoDaPalavra).join('%')}%`, palavras }
}

/** O nome cadastrado contém TODAS as palavras digitadas, na mesma ordem, ignorando acento e caixa. */
export function nomeCasa(nomeCadastrado: string, palavras: string[]): boolean {
  const alvo = semAcentoMinusculo(nomeCadastrado)
  let posicao = 0
  for (const p of palavras) {
    const i = alvo.indexOf(p, posicao)
    if (i < 0) return false
    posicao = i + p.length
  }
  return true
}
