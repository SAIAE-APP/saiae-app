// Regera o subset da fonte de ícones (Material Symbols Rounded) a partir da
// lista em src/assets/fonts/icones.txt (um nome por linha, ordem alfabética).
//
// Uso: node scripts/gerar-fonte-icones.mjs
// Quando usar: SEMPRE que um ícone novo entrar no app. Sem isso ele aparece como
// texto ("LOCATION_ON"). O teste `npm test` (tests/icones.test.ts) falha se um
// ícone usado no código não estiver na lista.
// Precisa de internet (baixa o subset da API do Google Fonts).
import { readFileSync, writeFileSync } from 'node:fs'

const lista = readFileSync(new URL('../src/assets/fonts/icones.txt', import.meta.url), 'utf8')
  .split('\n')
  .map((l) => l.trim())
  .filter(Boolean)
const nomes = [...new Set(lista)].sort()

// Eixos: FILL 0..1 (ativo preenchido), wght 400..700, opsz 20..48, GRAD 0.
const css = `https://fonts.googleapis.com/css2?family=Material+Symbols+Rounded:opsz,wght,FILL,GRAD@20..48,400..700,0..1,0&icon_names=${nomes.join(',')}&display=block`
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130 Safari/537.36'

const resposta = await fetch(css, { headers: { 'User-Agent': UA } })
if (!resposta.ok) throw new Error(`Google Fonts respondeu ${resposta.status}`)
const texto = await resposta.text()
const url = texto.match(/url\(([^)]+)\)/)?.[1]
if (!url) throw new Error('URL da fonte não encontrada na resposta do Google Fonts')

const fonte = Buffer.from(await (await fetch(url)).arrayBuffer())
if (fonte.length < 20000) throw new Error(`Fonte pequena demais (${fonte.length} bytes): lista de ícones vazia ou inválida?`)

writeFileSync(new URL('../src/assets/fonts/material-symbols-rounded.ttf', import.meta.url), fonte)
console.log(`Fonte gerada: ${nomes.length} nomes, ${(fonte.length / 1024).toFixed(1)} KB`)
