// Apagamento definitivo de barracas arquivadas há 30+ dias (edge function apagar-barracas-arquivadas).
// Sem imports de jsr:/Deno, pra ser executado nos testes; o index.ts só liga as dependências reais.
//
// Ordem por barraca: Storage primeiro, depois apagar_dados_barraca. Se o Storage falhar, os dados ficam
// (a barraca continua na lista e tenta de novo amanhã); arquivo órfão nunca fica para trás sem ninguém saber.
import { segredosIguais } from './eventosSaida.ts'

const BUCKETS = ['cardapio-fotos', 'logo-barraca']
const POR_PAGINA = 1000
const MAX_PAGINAS = 1000 // trava contra loop se o Storage listar sem nunca esvaziar

/** Pastas `bucket/{id}/` a limpar. */
export function pastasParaLimpar(barracaId: string): string[] {
  return BUCKETS.map((bucket) => `${bucket}/${barracaId}/`)
}

/** Confere o cabeçalho x-worker-secret com o segredo da function (comparação em tempo constante). */
export function segredoAutorizado(cabecalho: string | null, segredo: string | undefined): boolean {
  return segredosIguais(cabecalho, segredo)
}

export type DepsApagar = {
  listarBarracas: () => Promise<string[]>
  /** Nomes dos arquivos diretamente dentro de `pasta` (sem barra no fim), no máximo `limite`. */
  listarPasta: (bucket: string, pasta: string, limite: number) => Promise<string[]>
  /** Caminhos completos dentro do bucket. Deve lançar erro se não conseguir remover. */
  removerArquivos: (bucket: string, caminhos: string[]) => Promise<void>
  apagarDados: (barracaId: string) => Promise<void>
  registrarErro: (mensagem: string, barracaId: string, erro: unknown) => void
}

async function limparStorage(deps: DepsApagar, barracaId: string, porPagina: number) {
  for (const alvo of pastasParaLimpar(barracaId)) {
    const bucket = alvo.slice(0, alvo.indexOf('/'))
    // Remove e lista de novo do começo: apagar muda a posição dos que sobram, então não usa offset.
    for (let n = 0; n < MAX_PAGINAS; n++) {
      const nomes = await deps.listarPasta(bucket, barracaId, porPagina)
      if (nomes.length === 0) break
      await deps.removerArquivos(bucket, nomes.map((nome) => `${barracaId}/${nome}`))
    }
  }
}

export async function apagarBarracasArquivadas(deps: DepsApagar, porPagina = POR_PAGINA): Promise<{ apagadas: number; falhas: number }> {
  let apagadas = 0
  let falhas = 0
  for (const id of await deps.listarBarracas()) {
    try {
      await limparStorage(deps, id, porPagina)
      await deps.apagarDados(id)
      apagadas++
    } catch (erro) {
      falhas++
      deps.registrarErro('apagar-barracas-arquivadas: falhou', id, erro)
    }
  }
  return { apagadas, falhas }
}
