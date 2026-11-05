// Certificados de desenvolvimento que o build iOS cria no App Store Connect.
// O Mac do GitHub começa vazio a cada build, então a assinatura automática do
// archive cria um certificado "Apple Development" novo toda vez. A Apple limita
// a quantidade e o build seguinte falha ("maximum number of certificates").
// O workflow anota os existentes antes do archive e revoga só os novos no fim.
//
// Uso: node scripts/certificados-asc.mjs listar
//      node scripts/certificados-asc.mjs revogar-novos <arquivo-com-os-de-antes>
// Env: ASC_KEY_ID, ASC_ISSUER_ID, ASC_KEY_PATH (arquivo .p8)
import { readFileSync, existsSync } from 'node:fs'
import { createSign } from 'node:crypto'

const [comando, arquivoAntes] = process.argv.slice(2)
const { ASC_KEY_ID, ASC_ISSUER_ID, ASC_KEY_PATH } = process.env
const chave = readFileSync(ASC_KEY_PATH, 'utf8')

function token() {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
  const agora = Math.floor(Date.now() / 1000)
  const corpo = `${b64({ alg: 'ES256', kid: ASC_KEY_ID, typ: 'JWT' })}.${b64({ iss: ASC_ISSUER_ID, iat: agora, exp: agora + 600, aud: 'appstoreconnect-v1' })}`
  return `${corpo}.${createSign('SHA256').update(corpo).sign({ key: chave, dsaEncoding: 'ieee-p1363' }).toString('base64url')}`
}

async function api(metodo, caminho) {
  const r = await fetch(`https://api.appstoreconnect.apple.com/v1${caminho}`, { method: metodo, headers: { Authorization: `Bearer ${token()}` } })
  const texto = await r.text()
  if (!r.ok) throw new Error(`${metodo} ${caminho} -> ${r.status}\n${texto}`)
  return texto ? JSON.parse(texto) : null
}

// Só os de desenvolvimento criados por API (os do CI); nunca o de distribuição.
async function certificadosDoCI() {
  const r = await api('GET', '/certificates?limit=200&fields[certificates]=certificateType,displayName,name')
  return r.data.filter((c) => c.attributes.certificateType === 'DEVELOPMENT' && /Created via API/i.test(c.attributes.displayName ?? c.attributes.name ?? '')).map((c) => c.id)
}

if (comando === 'listar') {
  console.log((await certificadosDoCI()).join('\n'))
} else if (comando === 'revogar-novos') {
  const antes = new Set(existsSync(arquivoAntes) ? readFileSync(arquivoAntes, 'utf8').split('\n').filter(Boolean) : [])
  const novos = (await certificadosDoCI()).filter((id) => !antes.has(id))
  for (const id of novos) {
    await api('DELETE', `/certificates/${id}`)
    console.log('revogado', id)
  }
  if (novos.length === 0) console.log('nenhum certificado novo')
} else {
  console.error('Uso: listar | revogar-novos <arquivo>')
  process.exit(1)
}
