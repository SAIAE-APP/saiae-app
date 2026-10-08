// Trava compartilhada dos scripts de staging. Qualquer comando que escreve num
// projeto Supabase passa por aqui antes, para nunca atingir a produção por engano.
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const REF_STAGING = 'qzcqwovbbylqxljcrqhk'
export const REF_PRODUCAO = 'vimjwzumjggrlvlxdejr'

/** Raiz do repositório, independente do diretório de onde o script foi chamado. */
export const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..')

/** ref embutido no JWT da chave anon (claim `ref`), ou null se não for decodificável. */
export function refDaChaveAnon(chave) {
  try {
    const carga = JSON.parse(Buffer.from(chave.split('.')[1], 'base64url').toString('utf8'))
    return typeof carga.ref === 'string' ? carga.ref : null
  } catch {
    return null
  }
}

function lerRef(caminho, extrair) {
  if (!existsSync(caminho)) return null
  try {
    return extrair(readFileSync(caminho, 'utf8').trim()) || null
  } catch {
    return null
  }
}

/**
 * Exige que o link local da CLI (supabase/.temp) seja o de STAGING. Aborta em
 * QUALQUER outro caso: produção, outro projeto, link ausente ou ilegível.
 * (Os comandos também passam --project-ref, mas `db query` exige --linked junto.)
 */
export function garantirLinkEhStaging() {
  const refs = [
    lerRef(join(RAIZ, 'supabase/.temp/project-ref'), (t) => t),
    lerRef(join(RAIZ, 'supabase/.temp/linked-project.json'), (t) => JSON.parse(t).ref),
  ]
  if (refs.includes(REF_PRODUCAO)) {
    abortar(`o link local da CLI (supabase/.temp) aponta para a PRODUÇÃO. Rode: supabase link --project-ref ${REF_STAGING}`)
  }
  if (refs.some((ref) => ref !== REF_STAGING)) {
    abortar(`o link local da CLI não é o de staging (ou está ausente/ilegível). Rode: supabase link --project-ref ${REF_STAGING}`)
  }
}

export function abortar(motivo) {
  console.error(`\nStaging BLOQUEADO: ${motivo}.\nVeja docs/staging.md.\n`)
  process.exit(1)
}
