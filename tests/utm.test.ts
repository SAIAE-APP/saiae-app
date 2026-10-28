// Origem do cadastro (UTM): captura em localStorage por 90 dias, sem sobrescrever com vazio. Rodar: npm test
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { capturarUtm, CHAVE_UTM, lerUtmDaUrl, utmDoCadastro, VALIDADE_UTM_MS } from '../src/lib/utm.ts'

function armazenamento() {
  const m = new Map<string, string>()
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  }
}
const T0 = 1_800_000_000_000

describe('lerUtmDaUrl', () => {
  test('pega só os 5 parâmetros da lista e ignora o resto', () => {
    const utm = lerUtmDaUrl('?utm_source=meta&utm_medium=cpc&utm_campaign=lancamento&utm_content=v1&utm_term=comanda&fbclid=abc&ref=x&utm_id=9')
    assert.deepEqual(utm, { utm_source: 'meta', utm_medium: 'cpc', utm_campaign: 'lancamento', utm_content: 'v1', utm_term: 'comanda' })
  })
  test('descarta vazios e só espaços, apara e limita o tamanho', () => {
    const utm = lerUtmDaUrl(`?utm_source=%20meta%20&utm_medium=&utm_campaign=%20%20&utm_term=${'x'.repeat(500)}`)
    assert.equal(utm.utm_source, 'meta')
    assert.equal('utm_medium' in utm, false)
    assert.equal('utm_campaign' in utm, false)
    assert.equal(utm.utm_term?.length, 200)
  })
})

describe('capturarUtm / utmDoCadastro', () => {
  test('guarda e devolve dentro de 90 dias; depois disso expira', () => {
    const s = armazenamento()
    capturarUtm('?utm_source=meta', s, T0)
    assert.deepEqual(utmDoCadastro(s, T0 + VALIDADE_UTM_MS - 1), { utm_source: 'meta' })
    assert.equal(utmDoCadastro(s, T0 + VALIDADE_UTM_MS + 1), null)
  })
  test('abrir o app sem UTM NÃO apaga o que estava guardado', () => {
    const s = armazenamento()
    capturarUtm('?utm_source=meta&utm_campaign=a', s, T0)
    capturarUtm('', s, T0 + 1000)
    capturarUtm('?utm_source=&utm_medium=', s, T0 + 2000)
    assert.deepEqual(utmDoCadastro(s, T0 + 3000), { utm_source: 'meta', utm_campaign: 'a' })
  })
  test('novo toque com UTM substitui o conjunto inteiro (não mistura campanhas)', () => {
    const s = armazenamento()
    capturarUtm('?utm_source=meta&utm_campaign=a&utm_term=x', s, T0)
    capturarUtm('?utm_source=google', s, T0 + 1000)
    assert.deepEqual(utmDoCadastro(s, T0 + 2000), { utm_source: 'google' })
  })
  test('parâmetros fora da lista nunca entram, nem vindos de um storage adulterado', () => {
    const s = armazenamento()
    s.setItem(CHAVE_UTM, JSON.stringify({ guardadoEm: T0, utm: { utm_source: 'meta', email: 'a@b.com', utm_id: '1' } }))
    assert.deepEqual(utmDoCadastro(s, T0 + 1), { utm_source: 'meta' })
  })
  test('storage quebrado ou JSON inválido: não lança, sem UTM', () => {
    const erro = () => {
      throw new Error('bloqueado')
    }
    const quebrado = { getItem: erro, setItem: erro, removeItem: erro }
    assert.doesNotThrow(() => capturarUtm('?utm_source=meta', quebrado, T0))
    assert.equal(utmDoCadastro(quebrado, T0), null)
    const s = armazenamento()
    s.setItem(CHAVE_UTM, '{nao e json')
    assert.equal(utmDoCadastro(s, T0), null)
  })
})
