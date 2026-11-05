// Apagamento definitivo de barracas arquivadas há 30+ dias (edge function apagar-barracas-arquivadas).
// Sem imports de jsr:/Deno, pra ser executado nos testes; o index.ts só liga as dependências reais.
//
// Ordem por barraca: Storage primeiro, depois apagar_dados_barraca. Se o Storage falhar ou não esvaziar, os dados
// ficam (a barraca continua na lista e tenta de novo amanhã); arquivo órfão nunca fica para trás sem ninguém saber.
import { segredosIguais } from './eventosSaida.ts'

const BUCKETS = ['cardapio-fotos', 'logo-barraca']
const POR_PAGINA = 1000
const MAX_PASSADAS = 100 // trava contra loop se o Storage listar sem nunca esvaziar (estourar = falha, não apaga os dados)
const MAX_PROFUNDIDADE = 5

/** Pastas `bucket/{id}/` a limpar. */
export function pastasParaLimpar(barracaId: string): string[] {
  return BUCKETS.map((bucket) => `${bucket}/${barracaId}/`)
}

/** Confere o cabeçalho x-worker-secret com o segredo da function (comparação em tempo constante). */
export function segredoAutorizado(cabecalho: string | null, segredo: string | undefined): boolean {
  return segredosIguais(cabecalho, segredo)
}

export type EntradaPasta = { nome: string; pasta: boolean }

export type DepsApagar = {
  listarBarracas: () => Promise<string[]>
  /** Entradas diretamente dentro de `pasta` (sem barra no fim), no máximo `limite`. Subpastas vêm com `pasta: true`. */
  listarPasta: (bucket: string, pasta: string, limite: number) => Promise<EntradaPasta[]>
  /** Caminhos completos dentro do bucket. Deve lançar erro se não conseguir remover. */
  removerArquivos: (bucket: string, caminhos: string[]) => Promise<void>
  apagarDados: (barracaId: string) => Promise<void>
  registrarErro: (mensagem: string, barracaId: string, erro: unknown) => void
}

/** Esvazia `pasta` (arquivos e subpastas, recursivo). Lança se no limite de passadas ou de profundidade ainda sobrar algo. */
async function limparPasta(deps: DepsApagar, bucket: string, pasta: string, porPagina: number, profundidade = 0): Promise<void> {
  if (profundidade > MAX_PROFUNDIDADE) throw new Error(`${bucket}/${pasta}: profundidade acima de ${MAX_PROFUNDIDADE}`)
  // Remove e lista de novo do começo: apagar muda a posição dos que sobram, então não usa offset.
  for (let n = 0; n < MAX_PASSADAS; n++) {
    const entradas = await deps.listarPasta(bucket, pasta, porPagina)
    if (entradas.length === 0) return
    const arquivos = entradas.filter((e) => !e.pasta).map((e) => `${pasta}/${e.nome}`)
    if (arquivos.length > 0) await deps.removerArquivos(bucket, arquivos)
    for (const sub of entradas.filter((e) => e.pasta)) {
      await limparPasta(deps, bucket, `${pasta}/${sub.nome}`, porPagina, profundidade + 1)
    }
  }
  throw new Error(`${bucket}/${pasta}: não esvaziou em ${MAX_PASSADAS} passadas`)
}

export async function apagarBarracasArquivadas(deps: DepsApagar, porPagina = POR_PAGINA): Promise<{ apagadas: number; falhas: number }> {
  let apagadas = 0
  let falhas = 0
  for (const id of await deps.listarBarracas()) {
    try {
      for (const bucket of BUCKETS) await limparPasta(deps, bucket, id, porPagina)
      await deps.apagarDados(id)
      apagadas++
    } catch (erro) {
      falhas++
      deps.registrarErro('apagar-barracas-arquivadas: falhou', id, erro)
    }
  }
  return { apagadas, falhas }
}
