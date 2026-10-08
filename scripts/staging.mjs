// Comandos que ESCREVEM no Supabase de staging, sempre com a trava anti-produção e
// sempre com --project-ref explícito (nunca confiando só no link local da CLI).
// Uso: node scripts/staging.mjs <list|repair|push|deploy|seed>
import { execFileSync, spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { REF_STAGING, abortar, garantirLinkNaoEhProducao } from './staging-guarda.mjs'

const EMAIL_SEED = 'dono@staging.saiae.invalid'
const FUNCOES_PUBLICAS = ['criar-pagamento-pix', 'criar-pedido-cardapio', 'webhook-mercadopago', 'webhook-stripe']
const FUNCOES_COM_JWT = ['emitir-nfce', 'excluir-conta', 'reportar-bug', 'criar-checkout-stripe', 'cancelar-assinatura-stripe']

garantirLinkNaoEhProducao()

const shell = process.platform === 'win32'

function supabaseOk(args) {
  const r = spawnSync('supabase', args, { stdio: 'inherit', shell })
  if (r.status !== 0) process.exit(r.status ?? 1)
}

const comandos = {
  list: () => supabaseOk(['migration', 'list', '--project-ref', REF_STAGING]),

  repair: () => {
    const versoes = readdirSync('supabase/migrations')
      .filter((f) => f.endsWith('.sql'))
      .map((f) => f.split('_')[0])
    supabaseOk(['migration', 'repair', '--status', 'applied', ...versoes, '--project-ref', REF_STAGING])
  },

  push: () => supabaseOk(['db', 'push', '--project-ref', REF_STAGING]),

  deploy: () => {
    for (const f of FUNCOES_PUBLICAS) supabaseOk(['functions', 'deploy', f, '--project-ref', REF_STAGING, '--no-verify-jwt'])
    for (const f of FUNCOES_COM_JWT) supabaseOk(['functions', 'deploy', f, '--project-ref', REF_STAGING])
  },

  seed: () => {
    // `db query` exige --linked junto de --project-ref; quem decide o projeto é o --project-ref.
    const saida = execFileSync(
      'supabase',
      ['db', 'query', '--linked', '--project-ref', REF_STAGING, `select 1 as ok from auth.users where email = '${EMAIL_SEED}'`],
      { encoding: 'utf8', shell },
    )
    const jaExiste = (JSON.parse(saida).rows ?? []).length > 0
    const senha = randomBytes(12).toString('base64url')
    const sql = readFileSync('supabase/seed/staging.sql', 'utf8').replaceAll('__SENHA__', senha)
    const dir = mkdtempSync(join(tmpdir(), 'seed-staging-'))
    try {
      const arquivo = join(dir, 'seed.sql')
      writeFileSync(arquivo, sql)
      supabaseOk(['db', 'query', '--linked', '--project-ref', REF_STAGING, '-f', arquivo])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
    console.log('\nSeed aplicado no staging.')
    console.log(`Usuário de teste: ${EMAIL_SEED}`)
    if (jaExiste) console.log('O usuário já existia: a senha não foi alterada.')
    else console.log(`Senha (aparece só agora): ${senha}`)
  },
}

const comando = process.argv[2]
if (!comandos[comando]) abortar(`comando inválido (${comando ?? 'nenhum'}). Use: ${Object.keys(comandos).join(', ')}`)
comandos[comando]()
