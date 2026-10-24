// O editor de avisos é configuração local: não pode sumir (e perder o rascunho) quando a conexão cai ou oscila.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const c = readFileSync(new URL('../src/components/SecaoWhatsappAutomacao.tsx', import.meta.url), 'utf8')

test('EditorAvisos fica fora dos blocos condicionais por estado da conexão', () => {
  const uso = c.lastIndexOf('<EditorAvisos')
  assert.ok(uso > 0)
  assert.ok(!c.slice(c.indexOf("tela.tipo === 'conectado' &&"), uso).includes('<EditorAvisos barraca={barraca} />\n            <div'), 'editor dentro do bloco conectado')
  assert.match(c.slice(uso - 30, uso + 60), /<EditorAvisos barraca=\{barraca\} \/>\s*\}?\s*<\/Card>/)
})

test('texto em branco vira null ao salvar', () => {
  assert.match(c, /texto\?\.trim\(\) \|\| null/)
})
