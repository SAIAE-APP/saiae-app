// Texto legal (Política de Privacidade e Exclusão de conta): o que o código usa hoje tem de estar na lista de
// operadores, e o que foi removido (Kirvano) não pode voltar. Rodar: npm test
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { describe, test } from 'node:test'

const ler = (caminho: string) => readFileSync(new URL(caminho, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const privacidade = ler('../src/pages/Privacidade.tsx')
const excluir = ler('../src/pages/ExcluirConta.tsx')
const funcoes = readdirSync(new URL('../supabase/functions', import.meta.url), { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)

describe('operadores citados na Política de Privacidade', () => {
  test('a cobrança da assinatura é da Stripe; a Kirvano saiu dos dois textos', () => {
    assert.ok(funcoes.includes('webhook-stripe') && funcoes.includes('criar-checkout-stripe'))
    assert.ok(!funcoes.some((f) => /kirvano/i.test(f)), 'Kirvano foi removida do backend')
    assert.ok(!existsSync(new URL('../functions/api/webhooks/kirvano.ts', import.meta.url)), 'rota da Kirvano removida')
    assert.ok(!/kirvano/i.test(privacidade), 'Privacidade')
    assert.ok(!/kirvano/i.test(excluir), 'ExcluirConta')
    assert.match(privacidade, /<strong>Stripe<\/strong> — processamento da cobrança de assinatura/)
    assert.match(privacidade, /Assinatura do Sai aê:<\/strong> processada pela Stripe/)
  })

  test('todo operador que o código realmente chama está na lista (seção 10)', () => {
    const codigo = [
      ['api.stripe.com', 'Stripe'],
      ['api.mercadopago.com', 'Mercado Pago'],
      ['focusnfe.com.br', 'FocusNFe'],
      ['api.resend.com', 'Resend'],
      ['brasilapi.com.br', 'BrasilAPI'],
      ['viacep.com.br', 'ViaCEP'],
      ['fonts.googleapis.com', 'Google Fonts'],
    ] as const
    const fontes = [
      // Todo .ts de cada function e do _shared (a lógica pode ficar fora do index.ts, ex.: emitir-nfce/handler.ts).
      ...[...funcoes, '_shared'].flatMap((pasta) =>
        readdirSync(new URL(`../supabase/functions/${pasta}`, import.meta.url), { recursive: true })
          .filter((n) => String(n).endsWith('.ts') && !String(n).includes('.test.'))
          .map((n) => ler(`../supabase/functions/${pasta}/${String(n).replaceAll('\\', '/')}`)),
      ),
      ler('../index.html'),
    ].join('\n')
    for (const [dominio, nome] of codigo) {
      assert.ok(fontes.includes(dominio), `${dominio} deveria aparecer no código`)
      assert.ok(privacidade.includes(`<strong>${nome}</strong>`) || privacidade.includes(`${nome}</strong>`), `${nome} falta na Política`)
    }
    for (const nome of ['Supabase', 'Cloudflare', 'Anthropic', 'Meta', 'Railway']) assert.ok(privacidade.includes(nome), nome)
  })

  test('Exclusão de conta avisa para cancelar a assinatura ANTES (excluir não cancela a cobrança)', () => {
    const exclusao = ler('../supabase/functions/excluir-conta/index.ts')
    assert.ok(!/stripe/i.test(exclusao), 'se a função passar a cancelar na Stripe, atualize o texto')
    assert.match(excluir, /antes<\/strong>/)
    assert.match(excluir, /Excluir a\s+conta não cancela a cobrança na Stripe/)
  })

  test('acesso do suporte descrito conforme a migration (24 h, uso único, 7 dias, itens e categorias, dono encerra)', () => {
    const mig = ler('../supabase/migrations/20261023100000_acesso_suporte.sql')
    assert.match(mig, /interval '24 hours'/)
    assert.match(mig, /interval '7 days'/)
    assert.match(privacidade, /Acesso do suporte/)
    assert.match(privacidade, /vale por 24 horas e só pode ser usado uma vez/)
    assert.match(privacidade, /por até 7 dias/)
    assert.match(privacidade, /itens e as categorias do cardápio/)
    assert.match(privacidade, /encerrar esse acesso a qualquer momento/)
    assert.match(privacidade, /não vê pedidos, caixa, clientes/)
  })

  test('data da última atualização é uma data por extenso do ano em curso', () => {
    assert.match(privacidade, /const DATA_VIGENCIA = '\d{1,2} de [a-zç]+ de 2026'/)
  })
})
