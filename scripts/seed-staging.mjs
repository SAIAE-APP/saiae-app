// Aplica supabase/seed/staging.sql SOMENTE no projeto de staging. A senha do
// usuário de teste é gerada na hora e impressa uma vez (não é gravada em arquivo).
import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const REF_STAGING = 'qzcqwovbbylqxljcrqhk'
const senha = randomBytes(12).toString('base64url')
const sql = readFileSync('supabase/seed/staging.sql', 'utf8').replaceAll('__SENHA__', senha)

const dir = mkdtempSync(join(tmpdir(), 'seed-staging-'))
const arquivo = join(dir, 'seed.sql')
try {
  writeFileSync(arquivo, sql)
  execFileSync('supabase', ['db', 'query', '--linked', '--project-ref', REF_STAGING, '-f', arquivo], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })
} finally {
  rmSync(dir, { recursive: true, force: true })
}
console.log('\nSeed aplicado no staging.')
console.log('Usuário de teste: dono@staging.saiae.invalid')
console.log(`Senha (só aparece agora; se o usuário já existia, ela NÃO mudou): ${senha}`)
