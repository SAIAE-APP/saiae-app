// Importação de clientes de entrega: parse de CSV, normalização, validação e
// dedupe (funções puras, testadas em tests/importarClientes.test.ts). A leitura
// do arquivo está em importarClientesArquivo.ts e o envio em clientesFinais.ts.

/** Máximo de linhas de dados por arquivo. */
export const LIMITE_LINHAS_IMPORTACAO = 2000
/** Clientes por chamada da RPC (o banco aceita até 500). */
export const TAMANHO_LOTE_IMPORTACAO = 200

const MAX = { nome: 120, rua: 160, numero: 20, bairro: 80, referencia: 160 } as const

export type ClienteImportado = {
  nome: string
  telefone: string
  rua: string
  numero: string
  bairro: string
  referencia: string
}

export type LinhaInvalida = { linha: number; motivo: string }
export type LinhaDuplicada = { linha: number; telefone: string }

export type ResultadoValidacao = {
  validos: (ClienteImportado & { linha: number })[]
  invalidas: LinhaInvalida[]
  /** Telefone repetido dentro do arquivo: vale a primeira linha, as outras são ignoradas. */
  duplicadasNoArquivo: LinhaDuplicada[]
  /** Telefone que já existe na barraca: não duplica; só campos vazios são completados. */
  jaExistentes: number
  novos: number
}

/** Mesma regra de `normalizarTelefone` (src/lib/entrega.ts): só dígitos e sem o 55
 * do país, que só sai com 12/13 dígitos (com 10/11 o "55" é o DDD de Santa Maria/RS). */
export function normalizarTelefoneImportado(texto: string): string {
  const d = texto.replace(/\D/g, '')
  return (d.length === 12 || d.length === 13) && d.startsWith('55') ? d.slice(2) : d
}

/** Minúsculo, sem acento e sem pontuação: "Telefone (só dígitos)" vira "telefone so digitos". */
function chaveCabecalho(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/** A exportação prefixa com apóstrofo célula que começa com = + - @ (anti-fórmula);
 * ao reimportar o apóstrofo sai, senão "+55 11 9..." viraria "'+55...". */
function limparCelula(valor: unknown, max: number): string {
  let t = String(valor ?? '')
    // eslint-disable-next-line no-control-regex -- remover caracteres de controle é o objetivo
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (/^'[=+\-@]/.test(t)) t = t.slice(1)
  return t.slice(0, max)
}

/** Parse de CSV (RFC 4180): BOM, `;` `,` ou tab, campos entre aspas com quebra de linha e `""`. */
export function parsearCsv(texto: string): string[][] {
  const t = texto.charCodeAt(0) === 0xfeff ? texto.slice(1) : texto // BOM
  const primeiraLinha = t.split(/\r\n|\n|\r/, 1)[0] ?? ''
  const contar = (c: string) => primeiraLinha.split(c).length - 1
  const delimitador = [';', '\t', ','].reduce((melhor, c) => (contar(c) > contar(melhor) ? c : melhor), ';')

  const linhas: string[][] = []
  let linha: string[] = []
  let campo = ''
  let aspas = false
  const fecharCampo = () => {
    linha.push(campo)
    campo = ''
  }
  const fecharLinha = () => {
    fecharCampo()
    linhas.push(linha)
    linha = []
  }
  for (let i = 0; i < t.length; i++) {
    const c = t[i]
    if (aspas) {
      if (c === '"' && t[i + 1] === '"') {
        campo += '"'
        i++
      } else if (c === '"') aspas = false
      else campo += c
    } else if (c === '"') aspas = true
    else if (c === delimitador) fecharCampo()
    else if (c === '\r') {
      if (t[i + 1] === '\n') i++
      fecharLinha()
    } else if (c === '\n') fecharLinha()
    else campo += c
  }
  if (campo !== '' || linha.length > 0) fecharLinha()
  return linhas
}

type Campo = 'nome' | 'telefone' | 'telefoneDigitos' | 'rua' | 'numero' | 'bairro' | 'referencia'

const SINONIMOS: Record<Campo, string[]> = {
  nome: ['nome', 'cliente', 'nome do cliente', 'nome completo'],
  telefone: ['telefone', 'celular', 'whatsapp', 'fone', 'tel', 'telefone celular', 'contato'],
  telefoneDigitos: ['telefone so digitos'],
  rua: ['rua', 'endereco', 'logradouro', 'avenida', 'rua avenida'],
  numero: ['numero', 'n', 'no', 'num', 'nro'],
  bairro: ['bairro'],
  referencia: ['referencia', 'complemento', 'ponto de referencia'],
}

/** Índice de cada coluna conhecida no cabeçalho (primeira que casar); ausente = -1. */
export function mapearColunas(cabecalho: string[]): Record<Campo, number> {
  const chaves = cabecalho.map(chaveCabecalho)
  const achar = (campo: Campo) => chaves.findIndex((c) => SINONIMOS[campo].includes(c))
  return {
    nome: achar('nome'),
    telefone: achar('telefone'),
    telefoneDigitos: achar('telefoneDigitos'),
    rua: achar('rua'),
    numero: achar('numero'),
    bairro: achar('bairro'),
    referencia: achar('referencia'),
  }
}

export type ErroArquivo = 'vazio' | 'sem_cabecalho' | 'muitas_linhas'

export type LeituraTabela =
  | { ok: false; erro: ErroArquivo; mensagem: string }
  | { ok: true; linhas: { linha: number; celulas: string[] }[]; colunas: Record<Campo, number> }

/** Valida o formato da tabela (1ª linha = cabeçalho, com Nome e Telefone) e o limite de linhas. */
export function lerTabela(tabela: string[][], limite = LIMITE_LINHAS_IMPORTACAO): LeituraTabela {
  const comDados = tabela
    .map((celulas, i) => ({ linha: i + 1, celulas }))
    .filter((l) => l.celulas.some((c) => String(c ?? '').trim() !== ''))
  if (comDados.length === 0) return { ok: false, erro: 'vazio', mensagem: 'O arquivo está vazio.' }
  const [cab, ...dados] = comDados
  const colunas = mapearColunas(cab.celulas.map((c) => String(c ?? '')))
  const temTelefone = colunas.telefone >= 0 || colunas.telefoneDigitos >= 0
  if (colunas.nome < 0 || !temTelefone) {
    return {
      ok: false,
      erro: 'sem_cabecalho',
      mensagem: 'Não achei as colunas "Nome" e "Telefone" na primeira linha. Use a planilha exportada daqui como modelo.',
    }
  }
  if (dados.length === 0) return { ok: false, erro: 'vazio', mensagem: 'O arquivo só tem o cabeçalho, sem clientes.' }
  if (dados.length > limite) {
    return {
      ok: false,
      erro: 'muitas_linhas',
      mensagem: `O arquivo tem ${dados.length} linhas; o máximo é ${limite} por arquivo. Divida em partes.`,
    }
  }
  return { ok: true, linhas: dados, colunas }
}

/**
 * Valida e deduplica as linhas. `existentes` = telefones (já normalizados) que a
 * barraca tem cadastrados. Telefone vazio, com menos de 10 dígitos ou mais de 15,
 * e nome vazio são erro de linha; o resto das linhas segue.
 */
export function validarClientes(
  linhas: { linha: number; celulas: string[] }[],
  colunas: Record<Campo, number>,
  existentes: ReadonlySet<string>,
): ResultadoValidacao {
  const celula = (celulas: string[], i: number, max: number) => (i >= 0 ? limparCelula(celulas[i], max) : '')
  const vistos = new Set<string>()
  const r: ResultadoValidacao = { validos: [], invalidas: [], duplicadasNoArquivo: [], jaExistentes: 0, novos: 0 }

  for (const { linha, celulas } of linhas) {
    const nome = celula(celulas, colunas.nome, MAX.nome)
    // Dois telefones possíveis (formatado e só dígitos): vale o primeiro que for válido.
    const candidatos = [colunas.telefone, colunas.telefoneDigitos]
      .map((i) => normalizarTelefoneImportado(celula(celulas, i, 40)))
      .filter(Boolean)
    const telefone = candidatos.find((t) => t.length >= 10 && t.length <= 15) ?? candidatos[0] ?? ''

    const problemas: string[] = []
    if (!nome) problemas.push('nome vazio')
    if (!telefone) problemas.push('telefone vazio')
    else if (telefone.length < 10) problemas.push('telefone com menos de 10 dígitos')
    else if (telefone.length > 15) problemas.push('telefone com mais de 15 dígitos')
    if (problemas.length > 0) {
      r.invalidas.push({ linha, motivo: problemas.join(' e ') })
      continue
    }
    if (vistos.has(telefone)) {
      r.duplicadasNoArquivo.push({ linha, telefone })
      continue
    }
    vistos.add(telefone)
    if (existentes.has(telefone)) r.jaExistentes++
    else r.novos++
    r.validos.push({
      linha,
      nome,
      telefone,
      rua: celula(celulas, colunas.rua, MAX.rua),
      numero: celula(celulas, colunas.numero, MAX.numero),
      bairro: celula(celulas, colunas.bairro, MAX.bairro),
      referencia: celula(celulas, colunas.referencia, MAX.referencia),
    })
  }
  return r
}

export function emLotes<T>(itens: readonly T[], tamanho = TAMANHO_LOTE_IMPORTACAO): T[][] {
  const lotes: T[][] = []
  for (let i = 0; i < itens.length; i += tamanho) lotes.push(itens.slice(i, i + tamanho))
  return lotes
}
