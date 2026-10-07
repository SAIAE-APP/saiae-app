// Trava do build Android: o Vite grava VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY dentro do JS
// no momento do build, e `src/lib/supabase.ts` lança erro ao carregar se faltarem. Sem esta
// checagem, um build feito numa pasta sem .env gera um app que abre em TELA BRANCA (aconteceu
// com o .aab 1.9 / versionCode 11). Roda antes do `android:sync`.
import { loadEnv } from 'vite'

const env = loadEnv('production', process.cwd(), 'VITE_')
const url = (env.VITE_SUPABASE_URL ?? '').trim()
const chave = (env.VITE_SUPABASE_ANON_KEY ?? '').trim()

const erros = []
if (!url) erros.push('VITE_SUPABASE_URL ausente')
else if (!/^https:\/\/[a-z0-9]+\.supabase\.co\/?$/.test(url)) erros.push('VITE_SUPABASE_URL não parece uma URL do Supabase')
if (!chave) erros.push('VITE_SUPABASE_ANON_KEY ausente')

if (erros.length > 0) {
  console.error(`\nBuild Android BLOQUEADO: ${erros.join('; ')}.`)
  console.error('Crie o arquivo .env (ou .env.production) nesta pasta com as variáveis do projeto Supabase de PRODUÇÃO,')
  console.error('senão o app abre em tela branca. Veja o roteiro de build do APK.\n')
  process.exit(1)
}

const ref = new URL(url).hostname.split('.')[0]
console.log(`Env do build OK (projeto Supabase: ${ref}).`)
