// Acesso do suporte: teste estático (sem DOM) de que as peças da UI estão
// de fato ligadas — mesmo estilo de tests/secoesAjustes.test.ts.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const ler = (caminho: string) => readFileSync(new URL(`../${caminho}`, import.meta.url), 'utf8')

test('Ajustes renderiza SecaoAcessoSuporte no grupo conta/ajuda', () => {
  const ajustes = ler('src/pages/Ajustes.tsx')
  assert.match(ajustes, /import \{ SecaoAcessoSuporte \} from '\.\.\/components\/SecaoAcessoSuporte'/)
  assert.match(ajustes, /<SecaoDaCategoria categoria="conta" grupo="ajuda" atual=\{categoria\}>\s*<SecaoAcessoSuporte barraca=\{barraca\} \/>/)
})

test('LayoutBarraca renderiza as duas faixas de suporte', () => {
  const layout = ler('src/layouts/LayoutBarraca.tsx')
  assert.match(layout, /import \{ FaixaSuporteDono, FaixaSuporteVisao \} from '\.\.\/components\/FaixaSuporte'/)
  assert.match(layout, /<FaixaSuporteVisao barracaId=\{barraca\.id\} barracas=\{barracasDoUsuario\} \/>/)
  assert.match(layout, /\{souDonoDestaBarraca && <FaixaSuporteDono barracaId=\{barraca\.id\} \/>\}/)
})

test('GateSenhaAdmin confere acesso de suporte antes do PIN', () => {
  const gate = ler('src/components/GateSenhaAdmin.tsx')
  assert.match(gate, /supabase\s*\.rpc\('suporte_meu_acesso', \{ p_barraca_id: barracaId \}\)/)
  assert.match(gate, /'verificando_suporte'/)
})

test('SelecionarBarraca resgata código de suporte', () => {
  const tela = ler('src/pages/SelecionarBarraca.tsx')
  assert.match(tela, /supabase\.rpc\('suporte_resgatar_codigo', \{ p_codigo: normalizado \}\)/)
  assert.match(tela, /Tenho um código de suporte/)
})

test('useBarracasDoUsuario une as barracas de suporte ativas', () => {
  const hook = ler('src/hooks/useBarracasDoUsuario.ts')
  assert.match(hook, /supabase\.rpc\('suporte_minhas_barracas'\)/)
  assert.match(hook, /papel: 'suporte'/)
})
