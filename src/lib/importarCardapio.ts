// Importação do cardápio por planilha: leitura do cabeçalho, preço em vários formatos, validação por linha, dedupe e
// plano de gravação (funções puras, testadas em tests/importarCardapio.test.ts). A leitura do arquivo reaproveita
// importarClientesArquivo.ts e a gravação (inserts em lote pela RLS) está em cardapioImportacao.ts.
import { chaveCabecalho, limparCelula, parsearCsv } from './importarClientes.ts'
import { CENTAVOS_MAX, formatarPrecoBR } from './preco.ts'

export { parsearCsv }

/** Máximo de linhas de dados por arquivo (cardápio de barraca: 20 a 300 itens). */
export const LIMITE_LINHAS_CARDAPIO = 300
/** Itens por chamada de insert. */
export const TAMANHO_LOTE_ITENS = 100

export const MAX_CARDAPIO = { categoria: 60, nome: 80, descricao: 300 } as const
const SEM_CATEGORIA = 'sem categoria'

export type CampoCardapio = 'categoria' | 'nome' | 'preco' | 'descricao' | 'ativo' | 'precoAberto'

const SINONIMOS: Record<CampoCardapio, string[]> = {
  categoria: ['categoria', 'grupo', 'secao'],
  nome: ['nome', 'item', 'produto', 'nome do item', 'nome do produto'],
  preco: ['preco', 'valor', 'preco r', 'valor r', 'preco reais', 'preco unitario'],
  descricao: ['descricao', 'descricao do item', 'detalhes', 'observacao'],
  ativo: ['ativo', 'ativa', 'disponivel'],
  precoAberto: ['preco aberto', 'valor livre', 'preco livre'],
}

/** Índice de cada coluna conhecida (primeira que casar); ausente = -1. Sem acento, sem maiúscula, qualquer ordem. */
export function mapearColunasCardapio(cabecalho: string[]): Record<CampoCardapio, number> {
  const chaves = cabecalho.map(chaveCabecalho)
  const achar = (campo: CampoCardapio) => chaves.findIndex((c) => SINONIMOS[campo].includes(c))
  return {
    categoria: achar('categoria'),
    nome: achar('nome'),
    preco: achar('preco'),
    descricao: achar('descricao'),
    ativo: achar('ativo'),
    precoAberto: achar('precoAberto'),
  }
}

/** Nome comparável: minúsculo, sem acento, espaços colapsados ("  Pastéis  Fritos" = "pasteis fritos"). */
export function chaveNome(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

export type PrecoLido = { ok: true; centavos: number } | { ok: false; motivo: string }

/**
 * Preço em reais → centavos. Aceita "12", "12,5", "12,50", "R$ 12,50", "12.50", "1.234,56" e "1,234.56".
 * Recusa o ambíguo ("1.234" e "1,234": milhar ou decimal?), mais de 2 casas, negativo e texto.
 */
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

/** sim/não: vazio = sim. Devolve null quando o texto não é nenhum dos valores conhecidos. */
export function interpretarSimNao(texto: string, vazio: boolean): boolean | null {
  const t = chaveNome(texto)
  if (t === '') return vazio
  if (['sim', 's', '1', 'true', 'verdadeiro', 'x', 'ativo', 'ativa', 'yes', 'y'].includes(t)) return true
  if (['nao', 'n', '0', 'false', 'falso', 'inativo', 'inativa', 'no'].includes(t)) return false
  return null
}

export type LinhaCardapio = { linha: number; celulas: string[] }

export type LeituraCardapio =
  | { ok: false; erro: 'vazio' | 'sem_cabecalho' | 'muitas_linhas'; mensagem: string }
  | { ok: true; linhas: LinhaCardapio[]; colunas: Record<CampoCardapio, number> }

/** Valida o formato (1ª linha = cabeçalho com Nome e Preço) e o limite de linhas. */
export function lerTabelaCardapio(tabela: string[][], limite = LIMITE_LINHAS_CARDAPIO): LeituraCardapio {
  const comDados = tabela
    .map((celulas, i) => ({ linha: i + 1, celulas }))
    .filter((l) => l.celulas.some((c) => String(c ?? '').trim() !== ''))
  if (comDados.length === 0) return { ok: false, erro: 'vazio', mensagem: 'O arquivo está vazio.' }
  const [cab, ...dados] = comDados
  const colunas = mapearColunasCardapio(cab.celulas.map((c) => String(c ?? '')))
  if (colunas.nome < 0 || (colunas.preco < 0 && colunas.precoAberto < 0)) {
    return {
      ok: false,
      erro: 'sem_cabecalho',
      mensagem: 'Não achei as colunas "Nome" e "Preço" na primeira linha. Baixe a planilha modelo e use as mesmas colunas.',
    }
  }
  if (dados.length === 0) return { ok: false, erro: 'vazio', mensagem: 'O arquivo só tem o cabeçalho, sem itens.' }
  if (dados.length > limite) {
    return {
      ok: false,
      erro: 'muitas_linhas',
      mensagem: `O arquivo tem ${dados.length} linhas; o máximo é ${limite} por arquivo. Divida em partes.`,
    }
  }
  return { ok: true, linhas: dados, colunas }
}

/** O que o banco já tem: categorias (por nome comparável) e itens (categoria + nome comparável). */
export type CardapioExistente = {
  categorias: { id: string; nome: string; ordem: number }[]
  itens: { nome: string; categoria_id: string | null; ordem: number }[]
}

export type ItemParaCriar = {
  linha: number
  /** Nome da categoria como digitado (1ª grafia no arquivo); null = sem categoria. */
  categoria: string | null
  categoriaChave: string | null
  nome: string
  precoCentavos: number
  descricao: string | null
  ativo: boolean
  precoAberto: boolean
}

export type ResultadoValidacaoCardapio = {
  /** Itens que serão gravados (já descontados os que existem e os repetidos no arquivo). */
  paraCriar: ItemParaCriar[]
  invalidas: { linha: number; motivo: string }[]
  /** Mesmo nome na mesma categoria dentro do arquivo: vale a 1ª linha. */
  duplicadasNoArquivo: { linha: number; nome: string }[]
  /** Já existe na barraca (mesma categoria + nome): pulado, nunca sobrescrito. */
  jaExistiam: number
  /** Categorias que serão criadas (1ª grafia do arquivo, na ordem em que aparecem). */
  categoriasNovas: string[]
}

/**
 * Valida e deduplica. Erro de linha: nome vazio/longo, preço vazio/0/inválido (exceto "Preço aberto" = sim, que grava
 * preço 0), "Ativo" ilegível, categoria/descrição longas. Linha com erro NÃO entra; o resto segue.
 */
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
      const lido = interpretarPreco(textoPreco)
      if (!lido.ok) problemas.push(lido.motivo)
      else if (lido.centavos === 0) problemas.push('preço zerado (use a coluna "Preço aberto" = sim para valor livre)')
      else precoCentavos = lido.centavos
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

/** Planilha modelo: cabeçalho + 3 exemplos. `;` e BOM para o Excel brasileiro abrir sem desconfigurar. */
export function gerarCsvModeloCardapio(): string {
  const linhas = [
    ['Categoria', 'Nome', 'Preço', 'Descrição', 'Ativo'],
    ['Pastéis', 'Pastel de carne', '8,50', 'Carne moída temperada', 'sim'],
    ['Pastéis', 'Pastel de queijo', '8,00', '', 'sim'],
    ['Bebidas', 'Caldo de cana 500 ml', '7', 'Gelado', 'sim'],
  ]
  return '﻿' + linhas.map((l) => l.join(';')).join('\r\n') + '\r\n'
}
