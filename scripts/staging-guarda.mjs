// Trava compartilhada dos scripts de staging. Qualquer comando que escreve num
// projeto Supabase passa por aqui antes, para nunca atingir a produção por engano.
import { existsSync, readFileSync } from 'node:fs'

export const REF_STAGING = 'qzcqwovbbylqxljcrqhk'
export const REF_PRODUCAO = 'vimjwzumjggrlvlxdejr'

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
    return extrair(readFileSync(caminho, 'utf8').trim())
  } catch {
    return null
  }
}

/** Aborta se o link local da CLI (supabase/.temp) apontar para a produção. */
export function garantirLinkNaoEhProducao() {
  const refs = [
    lerRef('supabase/.temp/project-ref', (t) => t),
    lerRef('supabase/.temp/linked-project.json', (t) => JSON.parse(t).ref),
  ].filter(Boolean)
  if (refs.includes(REF_PRODUCAO)) {
    abortar(`o link local da CLI (supabase/.temp) aponta para a PRODUÇÃO. Rode: supabase link --project-ref ${REF_STAGING}`)
  }
}

export function abortar(motivo) {
  console.error(`\nStaging BLOQUEADO: ${motivo}.\nVeja docs/staging.md.\n`)
  process.exit(1)
}
