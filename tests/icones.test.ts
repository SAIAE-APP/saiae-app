// Garante que todo ícone usado no código está no subset da fonte (icones.txt).
// Ícone fora da lista aparece como texto na tela ("LOCATION_ON").
// Se este teste falhar: acrescente o nome em src/assets/fonts/icones.txt e rode
// `node scripts/gerar-fonte-icones.mjs` (precisa de internet).
// Rodar: npm test
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

function arquivos(dir: string): string[] {
  return readdirSync(dir).flatMap((nome) => {
    const caminho = join(dir, nome)
    return statSync(caminho).isDirectory() ? arquivos(caminho) : /\.(ts|tsx)$/.test(nome) ? [caminho] : []
  })
}

const naLista = new Set(
  readFileSync('src/assets/fonts/icones.txt', 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean),
)

// Usos estáticos: <Icone nome="x" />, icone="x", icone: 'x', icon: 'x', nome: 'x'
// (o que não casa aqui, por exemplo ícone montado por template, vai por `icone`/`icon` literal).
const PADROES = [
  /\b(?:nome|icone|icon)=["']([a-z][a-z0-9_]*)["']/g,
  /\b(?:nome|icone|icon)\s*:\s*["'`]([a-z][a-z0-9_]*)["'`]/g,
]

test('todo ícone usado no código está no subset da fonte', () => {
  const faltando = new Map<string, string>()
  for (const arquivo of arquivos('src')) {
    const texto = readFileSync(arquivo, 'utf8')
    for (const padrao of PADROES) {
      for (const m of texto.matchAll(padrao)) {
        if (!naLista.has(m[1]) && !faltando.has(m[1])) faltando.set(m[1], arquivo)
      }
    }
  }
  assert.deepEqual(
    [...faltando].map(([nome, arq]) => `${nome} (${arq})`),
    [],
    'Ícones fora da fonte: acrescente em src/assets/fonts/icones.txt e rode node scripts/gerar-fonte-icones.mjs',
  )
})
