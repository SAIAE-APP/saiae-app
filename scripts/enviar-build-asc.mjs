// Envia um .ipa ao App Store Connect pela API oficial de upload de builds
// (buildUploads/buildUploadFiles), usada no workflow iOS no lugar do altool:
// o altool recusava a chave de API ("Cannot verify client's JWT headers") que
// a própria API aceita.
//
// Uso: node scripts/enviar-build-asc.mjs <app.ipa> <versao> <build>
// Env: ASC_KEY_ID, ASC_ISSUER_ID, ASC_KEY_PATH (arquivo .p8), ASC_APP_ID
import { readFileSync, statSync, openSync, readSync, closeSync } from 'node:fs'
import { createSign, createHash } from 'node:crypto'
import { basename } from 'node:path'

const [ipa, versao, build] = process.argv.slice(2)
const { ASC_KEY_ID, ASC_ISSUER_ID, ASC_KEY_PATH, ASC_APP_ID } = process.env
if (!ipa || !versao || !build || !ASC_KEY_ID || !ASC_ISSUER_ID || !ASC_KEY_PATH || !ASC_APP_ID) {
  console.error('Uso: node scripts/enviar-build-asc.mjs <app.ipa> <versao> <build> (+ ASC_KEY_ID, ASC_ISSUER_ID, ASC_KEY_PATH, ASC_APP_ID)')
  process.exit(1)
}

const API = 'https://api.appstoreconnect.apple.com/v1'
const chave = readFileSync(ASC_KEY_PATH, 'utf8')

// Token novo a cada chamada: o upload pode passar dos 20 min de validade máxima.
function token() {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
  const agora = Math.floor(Date.now() / 1000)
  const corpo = `${b64({ alg: 'ES256', kid: ASC_KEY_ID, typ: 'JWT' })}.${b64({ iss: ASC_ISSUER_ID, iat: agora, exp: agora + 600, aud: 'appstoreconnect-v1' })}`
  const assinatura = createSign('SHA256').update(corpo).sign({ key: chave, dsaEncoding: 'ieee-p1363' }).toString('base64url')
  return `${corpo}.${assinatura}`
}

async function api(metodo, caminho, corpo) {
  const r = await fetch(`${API}${caminho}`, {
    method: metodo,
    headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
    body: corpo ? JSON.stringify(corpo) : undefined,
  })
  const texto = await r.text()
  if (!r.ok) throw new Error(`${metodo} ${caminho} -> ${r.status}\n${texto}`)
  return texto ? JSON.parse(texto) : null
}

const tamanho = statSync(ipa).size
const md5 = createHash('md5').update(readFileSync(ipa)).digest('hex')
console.log(`Enviando ${basename(ipa)} (${(tamanho / 1048576).toFixed(1)} MB), versão ${versao} build ${build}`)

const upload = await api('POST', '/buildUploads', {
  data: {
    type: 'buildUploads',
    attributes: { cfBundleShortVersionString: versao, cfBundleVersion: build, platform: 'IOS' },
    relationships: { app: { data: { type: 'apps', id: ASC_APP_ID } } },
  },
})
const uploadId = upload.data.id

const arquivo = await api('POST', '/buildUploadFiles', {
  data: {
    type: 'buildUploadFiles',
    attributes: { assetType: 'ASSET', fileName: basename(ipa), fileSize: tamanho, uti: 'com.apple.ipa' },
    relationships: { buildUpload: { data: { type: 'buildUploads', id: uploadId } } },
  },
})
const operacoes = arquivo.data.attributes.uploadOperations ?? []
console.log(`Upload ${uploadId}: ${operacoes.length} parte(s)`)

const fd = openSync(ipa, 'r')
try {
  for (const op of operacoes) {
    const parte = Buffer.alloc(op.length)
    readSync(fd, parte, 0, op.length, op.offset)
    const headers = Object.fromEntries((op.requestHeaders ?? []).map((h) => [h.name, h.value]))
    let ok = false
    for (let tentativa = 1; tentativa <= 3 && !ok; tentativa++) {
      const r = await fetch(op.url, { method: op.method, headers, body: parte })
      ok = r.ok
      if (!ok) console.warn(`Parte ${op.partNumber ?? '?'} falhou (${r.status}), tentativa ${tentativa}/3`)
    }
    if (!ok) throw new Error(`Falha ao enviar a parte ${op.partNumber ?? '?'}`)
  }
} finally {
  closeSync(fd)
}

await api('PATCH', `/buildUploadFiles/${arquivo.data.id}`, {
  data: {
    type: 'buildUploadFiles',
    id: arquivo.data.id,
    attributes: { uploaded: true, sourceFileChecksums: { file: { algorithm: 'MD5', hash: md5 } } },
  },
})
console.log('Arquivo enviado; aguardando a Apple validar...')

// A validação inicial costuma levar poucos minutos; o processamento completo do
// build (para aparecer no TestFlight) continua depois, fora deste script.
const limite = Date.now() + 20 * 60 * 1000
while (Date.now() < limite) {
  const atual = await api('GET', `/buildUploads/${uploadId}`)
  const estado = atual.data.attributes.state
  const nome = typeof estado === 'string' ? estado : estado?.state
  if (nome === 'COMPLETE') {
    console.log('Upload aceito pela Apple.')
    process.exit(0)
  }
  if (nome === 'FAILED') {
    console.error('A Apple recusou o build:')
    console.error(JSON.stringify(estado, null, 2))
    process.exit(1)
  }
  console.log(`Estado: ${nome ?? JSON.stringify(estado)}`)
  await new Promise((s) => setTimeout(s, 30000))
}
console.log('Ainda processando depois de 20 min; confira o TestFlight no App Store Connect.')
