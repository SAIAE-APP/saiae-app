// Trava do modo "staging": só deixa subir (dev/build) se o env aponta para o
// projeto Supabase de STAGING e nunca para o de produção. Lê .env.staging e
// .env.staging.local (gitignored). Roda antes de `dev:staging` e `build:staging`.
import { loadEnv } from 'vite'
import { REF_PRODUCAO, REF_STAGING, abortar, refDaChaveAnon } from './staging-guarda.mjs'

const env = loadEnv('staging', process.cwd(), 'VITE_')
const url = (env.VITE_SUPABASE_URL ?? '').trim()
const chave = (env.VITE_SUPABASE_ANON_KEY ?? '').trim()

const erros = []
if (!url) erros.push('VITE_SUPABASE_URL ausente em .env.staging.local')
if (!chave) erros.push('VITE_SUPABASE_ANON_KEY ausente em .env.staging.local')

if (url) {
  let ref = null
  try {
    ref = new URL(url).hostname.split('.')[0]
  } catch {
    erros.push('VITE_SUPABASE_URL não é uma URL válida')
  }
  if (ref === REF_PRODUCAO) erros.push('VITE_SUPABASE_URL aponta para a PRODUÇÃO')
  else if (ref && ref !== REF_STAGING) erros.push(`VITE_SUPABASE_URL (${ref}) não é o projeto de staging`)
}
if (chave) {
  const refChave = refDaChaveAnon(chave)
  if (refChave === REF_PRODUCAO) erros.push('VITE_SUPABASE_ANON_KEY é a chave da PRODUÇÃO')
  else if (refChave && refChave !== REF_STAGING) erros.push(`VITE_SUPABASE_ANON_KEY é de outro projeto (${refChave})`)
}

if (erros.length > 0) {
  abortar(`${erros.join('; ')}. Copie .env.staging.example para .env.staging.local`)
}
console.log(`Env de staging OK (projeto Supabase: ${REF_STAGING}).`)
