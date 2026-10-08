// Trava do modo "staging": só deixa subir (dev/build) se o env aponta para o
// projeto Supabase de STAGING e nunca para o de produção. Lê .env.staging e
// .env.staging.local (gitignored). Roda antes de `dev:staging` e `build:staging`.
import { loadEnv } from 'vite'

const REF_STAGING = 'qzcqwovbbylqxljcrqhk'
const REF_PRODUCAO = 'vimjwzumjggrlvlxdejr'

const env = loadEnv('staging', process.cwd(), 'VITE_')
const url = (env.VITE_SUPABASE_URL ?? '').trim()
const chave = (env.VITE_SUPABASE_ANON_KEY ?? '').trim()

const erros = []
if (!url) erros.push('VITE_SUPABASE_URL ausente em .env.staging.local')
if (!chave) erros.push('VITE_SUPABASE_ANON_KEY ausente em .env.staging.local')
if (url) {
  const ref = new URL(url).hostname.split('.')[0]
  if (ref === REF_PRODUCAO) erros.push('VITE_SUPABASE_URL aponta para a PRODUÇÃO')
  else if (ref !== REF_STAGING) erros.push(`VITE_SUPABASE_URL (${ref}) não é o projeto de staging`)
}

if (erros.length > 0) {
  console.error(`\nModo staging BLOQUEADO: ${erros.join('; ')}.`)
  console.error('Veja docs/staging.md (copie .env.staging.example para .env.staging.local).\n')
  process.exit(1)
}
console.log(`Env de staging OK (projeto Supabase: ${REF_STAGING}).`)
