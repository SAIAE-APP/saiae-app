// Trava do modo "staging": só deixa subir (dev/build) se o env aponta para o
// projeto Supabase de STAGING e nunca para o de produção. Lê .env.staging e
// .env.staging.local (gitignored). Roda antes de `dev:staging` e `build:staging`.
import { loadEnv } from 'vite'
import { RAIZ, REF_PRODUCAO, REF_STAGING, abortar, refDaChaveAnon } from './staging-guarda.mjs'

const env = loadEnv('staging', RAIZ, 'VITE_')
const url = (env.VITE_SUPABASE_URL ?? '').trim()
const chave = (env.VITE_SUPABASE_ANON_KEY ?? '').trim()

const erros = []
if (!url) erros.push('VITE_SUPABASE_URL ausente')
if (!chave) erros.push('VITE_SUPABASE_ANON_KEY ausente')

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
  abortar(`${erros.join('; ')}. Defina em .env.staging.local (copie de .env.staging.example); o Vite lê .env, .env.local, .env.staging e .env.staging.local, nessa precedência`)
}
console.log(`Env de staging OK (projeto Supabase: ${REF_STAGING}).`)
