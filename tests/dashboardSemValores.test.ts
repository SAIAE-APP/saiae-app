// Sprint 2: o Dashboard não pede a senha administrativa, então não pode
// mostrar quanto a loja vendeu (valores ficam no Histórico e no Faturamento,
// ambos atrás do GateSenhaAdmin).
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'

const ler = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')

describe('Dashboard sem valores de venda', () => {
  test('não calcula nem formata total em reais', () => {
    const dashboard = ler('src/pages/Dashboard.tsx')
    assert.doesNotMatch(dashboard, /calcularTotalBruto/)
    assert.doesNotMatch(dashboard, /formatarPrecoBR/)
  })
  test('tem o card Faturamento, sem valor, levando à tela do Faturamento', () => {
    const dashboard = ler('src/pages/Dashboard.tsx')
    assert.match(dashboard, /titulo="Faturamento"\s+subtitulo="Ver faturamento"/)
    assert.match(dashboard, /navigate\(`\/\$\{barraca\.slug\}\/desktop`\)/)
  })
  test('o Faturamento continua atrás da senha administrativa e abre no celular', () => {
    const desktop = ler('src/pages/Desktop.tsx')
    assert.match(desktop, /<GateSenhaAdmin /)
    assert.doesNotMatch(desktop, /Abra o Sai aê num computador/)
  })
  test('barra do celular: Chamada some abaixo de sm; Faturamento e Ajustes ficam', () => {
    const barra = ler('src/components/BarraNavegacao.tsx')
    assert.match(barra, /rota: 'chamada', icone: 'campaign', ocultoNoCelular: true/)
    assert.match(barra, /\{ rotulo: 'Faturamento', rota: 'desktop', icone: 'payments' \}/)
    assert.match(barra, /\{ rotulo: 'Ajustes', rota: 'ajustes', icone: 'settings' \}/)
    assert.equal(barra.match(/ocultoNoCelular: true/g)?.length, 1)
  })
})
