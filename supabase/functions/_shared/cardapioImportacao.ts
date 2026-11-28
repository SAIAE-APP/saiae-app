// Regras da importação de cardápio para o servidor (ferramenta `importar_cardapio_de_foto` do MCP).
// CÓPIA das funções puras de src/lib/importarCardapio.ts e src/lib/importarClientes.ts: as edge functions não
// empacotam arquivos de src/, então o código vive nos dois lugares (mesmo caso de src/lib/pixExpiracao.ts).
// tests/mcpCardapioImportacao.test.ts compara o texto das funções copiadas e roda os mesmos casos nas duas versões:
// se alguém mudar uma regra de um lado só, o teste falha. Aqui só entram as funções que a ferramenta usa.

export const LIMITE_LINHAS_CARDAPIO = 300
export const MAX_CARDAPIO = { categoria: 60, nome: 80, descricao: 300 } as const
const SEM_CATEGORIA = 'sem categoria'
const CENTAVOS_MAX = 99999999

export type CampoCardapio = 'categoria' | 'nome' | 'preco' | 'descricao' | 'ativo' | 'precoAberto'

function formatarPrecoBR(centavos: number): string {
  const valorAbsoluto = Math.round(Math.abs(centavos))
  const inteiro = Math.floor(valorAbsoluto / 100)
  const decimal = String(valorAbsoluto % 100).padStart(2, '0')
  const inteiroFormatado = inteiro.toLocaleString('pt-BR')
  const sinal = centavos < 0 ? '-' : ''
  return `${sinal}R$ ${inteiroFormatado},${decimal}`
}

export function limparCelula(valor: unknown, max: number): string {
  let t = String(valor ?? '')
    // eslint-disable-next-line no-control-regex -- remover caracteres de controle é o objetivo
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (/^'[=+\-@]/.test(t)) t = t.slice(1)
  return t.slice(0, max)
}

export function chaveNome(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

export type PrecoLido = { ok: true; centavos: number } | { ok: false; motivo: string }

export function interpretarPreco(texto: string): PrecoLido {
  const t = texto.replace(/R\$/gi, '').replace(/\s+/g, '')
  if (t === '') return { ok: false, motivo: 'preço vazio' }
  if (t.startsWith('-')) return { ok: false, motivo: 'preço negativo' }
  if (!/^[\d.,]+$/.test(t)) return { ok: false, motivo: 'preço inválido' }

  const ultimoPonto = t.lastIndexOf('.')
  const ultimaVirgula = t.lastIndexOf(',')
  let inteiro: string
  let decimal = ''

  if (ultimoPonto >= 0 && ultimaVirgula >= 0) {
    // Os dois: o último separador é o decimal, o outro agrupa milhar ("1.234,56" ou "1,234.56").
    const decimalNoFim = Math.max(ultimoPonto, ultimaVirgula)
    const milhar = ultimoPonto > ultimaVirgula ? ',' : '.'
    const parteInteira = t.slice(0, decimalNoFim)
    const grupos = parteInteira.split(milhar)
    if (parteInteira.includes(ultimoPonto > ultimaVirgula ? '.' : ',')) return { ok: false, motivo: 'preço inválido' }
    if (!/^\d{1,3}$/.test(grupos[0]) || grupos.slice(1).some((g) => !/^\d{3}$/.test(g))) return { ok: false, motivo: 'preço inválido' }
    inteiro = grupos.join('')
    decimal = t.slice(decimalNoFim + 1)
    if (decimal === '') return { ok: false, motivo: 'preço inválido' }
  } else if (ultimoPonto >= 0 || ultimaVirgula >= 0) {
    const sep = ultimoPonto >= 0 ? '.' : ','
    const partes = t.split(sep)
    if (partes.length > 2) {
      // "1.234.567": só vale como milhar (grupos de 3 depois do primeiro).
      if (sep === ',' || !/^\d{1,3}$/.test(partes[0]) || partes.slice(1).some((g) => !/^\d{3}$/.test(g))) {
        return { ok: false, motivo: 'preço inválido' }
      }
      inteiro = partes.join('')
    } else {
      const [antes, depois] = partes
      if (antes === '' || depois === '') return { ok: false, motivo: 'preço inválido' }
      if (depois.length === 3 && antes.length <= 3) return { ok: false, motivo: 'preço ambíguo (use vírgula nos centavos, ex.: 1234,00)' }
      if (depois.length > 2) return { ok: false, motivo: 'preço com mais de 2 casas decimais' }
      inteiro = antes
      decimal = depois
    }
  } else {
    inteiro = t
  }

  if (!/^\d+$/.test(inteiro) || (decimal !== '' && !/^\d{1,2}$/.test(decimal))) return { ok: false, motivo: 'preço inválido' }
  const centavos = Number(inteiro) * 100 + Number(decimal.padEnd(2, '0') || '0')
  if (!Number.isSafeInteger(centavos)) return { ok: false, motivo: 'preço inválido' }
  if (centavos > CENTAVOS_MAX) return { ok: false, motivo: `preço acima do máximo (${formatarPrecoBR(CENTAVOS_MAX)})` }
  return { ok: true, centavos }
}

export function interpretarSimNao(texto: string, vazio: boolean): boolean | null {
  const t = chaveNome(texto)
  if (t === '') return vazio
  if (['sim', 's', '1', 'true', 'verdadeiro', 'x', 'ativo', 'ativa', 'yes', 'y'].includes(t)) return true
  if (['nao', 'n', '0', 'false', 'falso', 'inativo', 'inativa', 'no'].includes(t)) return false
  return null
}

export type LinhaCardapio = { linha: number; celulas: string[] }

export type CardapioExistente = {
  categorias: { id: string; nome: string; ordem: number }[]
  itens: { nome: string; categoria_id: string | null; ordem: number }[]
}

export type ItemParaCriar = {
  linha: number
  categoria: string | null
  categoriaChave: string | null
  nome: string
  precoCentavos: number
  descricao: string | null
  ativo: boolean
  precoAberto: boolean
}

export type ResultadoValidacaoCardapio = {
  paraCriar: ItemParaCriar[]
  invalidas: { linha: number; motivo: string }[]
  duplicadasNoArquivo: { linha: number; nome: string }[]
  jaExistiam: number
  categoriasNovas: string[]
}

export function validarCardapio(
  linhas: LinhaCardapio[],
  colunas: Record<CampoCardapio, number>,
  existente: CardapioExistente,
): ResultadoValidacaoCardapio {
  const celula = (celulas: string[], i: number, max: number) => (i >= 0 ? limparCelula(celulas[i], max + 1) : '')
  const categoriaPorChave = new Map(existente.categorias.map((c) => [chaveNome(c.nome), c.id]))
  const itensExistentes = new Set(existente.itens.map((i) => `${i.categoria_id ?? ''}|${chaveNome(i.nome)}`))
  const vistos = new Set<string>()
  const categoriasNovas = new Map<string, string>() // chave -> grafia
  const r: ResultadoValidacaoCardapio = { paraCriar: [], invalidas: [], duplicadasNoArquivo: [], jaExistiam: 0, categoriasNovas: [] }

  for (const { linha, celulas } of linhas) {
    const nome = celula(celulas, colunas.nome, MAX_CARDAPIO.nome)
    const categoriaBruta = celula(celulas, colunas.categoria, MAX_CARDAPIO.categoria)
    const descricao = celula(celulas, colunas.descricao, MAX_CARDAPIO.descricao)
    const ativo = interpretarSimNao(celula(celulas, colunas.ativo, 20), true)
    const precoAberto = interpretarSimNao(celula(celulas, colunas.precoAberto, 20), false)
    const textoPreco = celula(celulas, colunas.preco, 30)

    const problemas: string[] = []
    if (!nome) problemas.push('nome vazio')
    else if (nome.length > MAX_CARDAPIO.nome) problemas.push(`nome com mais de ${MAX_CARDAPIO.nome} caracteres`)
    if (categoriaBruta.length > MAX_CARDAPIO.categoria) problemas.push(`categoria com mais de ${MAX_CARDAPIO.categoria} caracteres`)
    if (descricao.length > MAX_CARDAPIO.descricao) problemas.push(`descrição com mais de ${MAX_CARDAPIO.descricao} caracteres`)
    if (ativo === null) problemas.push('"Ativo" deve ser sim ou não')
    if (precoAberto === null) problemas.push('"Preço aberto" deve ser sim ou não')

    let precoCentavos = 0
    if (precoAberto === true) {
      // Valor livre: o operador digita na venda; o preço de reserva fica R$ 0,00 (a coluna Preço é ignorada).
      precoCentavos = 0
    } else if (precoAberto === false) {
      // A célula é cortada em 31 caracteres: se passou de 30, o valor lido poderia ser outro (ex.: zeros antes do número).
      if (textoPreco.length > 30) problemas.push('preço com mais de 30 caracteres')
      else {
        const lido = interpretarPreco(textoPreco)
        if (!lido.ok) problemas.push(lido.motivo)
        else if (lido.centavos === 0) problemas.push('preço zerado (use a coluna "Preço aberto" = sim para valor livre)')
        else precoCentavos = lido.centavos
      }
    }

    if (problemas.length > 0) {
      r.invalidas.push({ linha, motivo: problemas.join(' e ') })
      continue
    }

    const chaveCat = chaveNome(categoriaBruta)
    const semCategoria = chaveCat === '' || chaveCat === SEM_CATEGORIA
    const categoriaChave = semCategoria ? null : chaveCat
    const categoriaExistenteId = categoriaChave ? (categoriaPorChave.get(categoriaChave) ?? null) : null
    const chaveItem = `${categoriaChave ?? ''}|${chaveNome(nome)}`

    if (vistos.has(chaveItem)) {
      r.duplicadasNoArquivo.push({ linha, nome })
      continue
    }
    vistos.add(chaveItem)

    // Já existe no banco: mesma categoria (ou ambos sem categoria) e mesmo nome.
    if (itensExistentes.has(`${semCategoria ? '' : (categoriaExistenteId ?? '\u0000')}|${chaveNome(nome)}`)) {
      r.jaExistiam++
      continue
    }

    if (categoriaChave && !categoriaExistenteId && !categoriaPorChave.has(categoriaChave) && !categoriasNovas.has(categoriaChave)) {
      categoriasNovas.set(categoriaChave, categoriaBruta)
    }
    r.paraCriar.push({
      linha,
      categoria: semCategoria ? null : (categoriasNovas.get(categoriaChave!) ?? categoriaBruta),
      categoriaChave,
      nome,
      precoCentavos,
      descricao: descricao || null,
      ativo: ativo ?? true,
      precoAberto: precoAberto === true,
    })
  }
  r.categoriasNovas = [...categoriasNovas.values()]
  return r
}

/** Colunas fixas da lista que a IA manda: categoria, nome, preço, descrição (sem "Ativo" nem "Preço aberto"). */
export const COLUNAS_IA: Record<CampoCardapio, number> = { categoria: 0, nome: 1, preco: 2, descricao: 3, ativo: -1, precoAberto: -1 }
