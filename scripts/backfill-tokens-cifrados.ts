// CLI do backfill dos tokens cifrados. Rodado PELO DONO, no próprio computador:
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... TOKENS_CHAVE_V1=... \
//     node --experimental-strip-types scripts/backfill-tokens-cifrados.ts            (simulação: só conta)
//   ... node --experimental-strip-types scripts/backfill-tokens-cifrados.ts --aplicar  (cifra de verdade)
// Sai com código 1 se sobrou token em texto sem cifra ou se houve falha. Imprime só contagens.
import { createClient } from '@supabase/supabase-js'
import { backfillCompleto, executarBackfill } from './backfillTokensCifrados.ts'

const url = process.env.SUPABASE_URL
const chave = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !chave) {
  console.error('Defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY.')
  process.exit(2)
}
const aplicar = process.argv.includes('--aplicar')
const db = createClient(url, chave, { auth: { persistSession: false } })
const relatorio = await executarBackfill(db, { get: (n) => process.env[n] }, { aplicar })
console.log(aplicar ? 'MODO: aplicar' : 'MODO: simulação (nada foi alterado)')
console.table(relatorio)
if (aplicar) {
  const ok = backfillCompleto(relatorio)
  console.log(ok ? 'OK: nenhum token ficou só em texto.' : 'ATENÇÃO: sobrou token sem cifra ou houve falha. Rode de novo.')
  process.exit(ok ? 0 : 1)
}
