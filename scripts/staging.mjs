// Comandos que ESCREVEM no Supabase de staging, sempre com a trava anti-produção e
// sempre com --project-ref explícito (nunca confiando só no link local da CLI).
// Uso: node scripts/staging.mjs <list|repair|push|deploy|seed>
import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RAIZ, REF_STAGING, abortar, garantirLinkEhStaging } from './staging-guarda.mjs'

const EMAIL_SEED = 'dono@staging.saiae.invalid'
const FUNCOES_PUBLICAS = ['criar-pagamento-pix', 'criar-pedido-cardapio', 'webhook-mercadopago', 'webhook-stripe']
const FUNCOES_COM_JWT = ['emitir-nfce', 'excluir-conta', 'reportar-bug', 'criar-checkout-stripe', 'cancelar-assinatura-stripe']

garantirLinkEhStaging()
process.chdir(RAIZ)

// Sem shell: os argumentos chegam intactos à CLI (no Windows, `shell: true` quebraria
// qualquer argumento com espaço e gera o aviso DEP0190). Precisa do executável
// `supabase` (supabase.exe no Windows) no PATH.
function executar(args, opcoes = {}) {
  const r = spawnSync('supabase', args, { shell: false, ...opcoes })
  if (r.error) {
    abortar(`não consegui executar a CLI do Supabase (${r.error.code ?? r.error.message}). Instale o executável \`supabase\` e deixe no PATH`)
  }
  return r
}
function executarOk(args) {
  const r = executar(args, { stdio: 'inherit' })
  if (r.status !== 0) process.exit(r.status ?? 1)
}

/** Roda SQL no staging por arquivo (-f), sem passar SQL como argumento. */
function sqlNoStaging(sql, { saida = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'staging-sql-'))
  try {
    const arquivo = join(dir, 'consulta.sql')
    writeFileSync(arquivo, sql)
    // `db query` exige --linked junto de --project-ref; quem decide o projeto é o --project-ref.
    const args = ['db', 'query', '--linked', '--project-ref', REF_STAGING, '-o', 'json', '-f', arquivo]
    if (!saida) return executarOk(args)
    const r = executar(args, { encoding: 'utf8' })
    if (r.status !== 0) {
      process.stderr.write(r.stderr ?? '')
      process.exit(r.status ?? 1)
    }
    return JSON.parse(r.stdout)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const comandos = {
  list: () => executarOk(['migration', 'list', '--project-ref', REF_STAGING]),

  repair: () => {
    const versoes = readdirSync(join(RAIZ, 'supabase/migrations'))
      .filter((f) => f.endsWith('.sql'))
      .map((f) => f.split('_')[0])
    executarOk(['migration', 'repair', '--status', 'applied', ...versoes, '--project-ref', REF_STAGING])
  },

  push: () => executarOk(['db', 'push', '--project-ref', REF_STAGING]),

  deploy: () => {
    for (const f of FUNCOES_PUBLICAS) executarOk(['functions', 'deploy', f, '--project-ref', REF_STAGING, '--no-verify-jwt'])
    for (const f of FUNCOES_COM_JWT) executarOk(['functions', 'deploy', f, '--project-ref', REF_STAGING])
  },

  seed: () => {
    const existente = sqlNoStaging(`select 1 as ok from auth.users where email = '${EMAIL_SEED}'`, { saida: true })
    const jaExiste = (existente.rows ?? []).length > 0
    const senha = randomBytes(12).toString('base64url')
    sqlNoStaging(readFileSync(join(RAIZ, 'supabase/seed/staging.sql'), 'utf8').replaceAll('__SENHA__', senha))
    console.log('\nSeed aplicado no staging.')
    console.log(`Usuário de teste: ${EMAIL_SEED}`)
    if (jaExiste) console.log('O usuário já existia: a senha não foi alterada.')
    else console.log(`Senha (aparece só agora): ${senha}`)
  },
}

const comando = process.argv[2]
if (!comandos[comando]) abortar(`comando inválido (${comando ?? 'nenhum'}). Use: ${Object.keys(comandos).join(', ')}`)
comandos[comando]()
