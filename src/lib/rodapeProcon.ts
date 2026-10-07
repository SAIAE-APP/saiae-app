import { TELEFONE_PROCON } from './fiscal.ts'
import { semAcento } from './semAcento.ts'

/** Quebra o texto em linhas de no máximo `colunas` caracteres (palavra maior que a linha é cortada). */
function quebrarEmLinhas(texto: string, colunas: number): string[] {
  const linhas: string[] = []
  let atual = ''
  for (const palavra of texto.split(/\s+/).filter(Boolean)) {
    let resto = palavra
    while (resto.length > colunas) {
      if (atual) {
        linhas.push(atual)
        atual = ''
      }
      linhas.push(resto.slice(0, colunas))
      resto = resto.slice(colunas)
    }
    if (!atual) atual = resto
    else if (atual.length + 1 + resto.length <= colunas) atual += ` ${resto}`
    else {
      linhas.push(atual)
      atual = resto
    }
  }
  if (atual) linhas.push(atual)
  return linhas
}

/** Rodapé do PROCON (nota/cupom entregue ao consumidor): "PROCON 151" sempre,
 * mais "Sede: <endereço>" quando cadastrado. Sem acento e já quebrado na
 * largura do papel (32 colunas no 58mm, 48 no 80mm). */
export function linhasRodapeProcon(enderecoSede: string | null | undefined, colunas: number): string[] {
  const linhas = [`PROCON ${TELEFONE_PROCON}`]
  const sede = semAcento(enderecoSede ?? '').trim()
  if (sede) linhas.push(...quebrarEmLinhas(`Sede: ${sede}`, colunas))
  return linhas
}
