// Ajustes > Cashback: aviso fiscal e de passivo, termo antes de ligar, validação por faixa e ligação na página.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'
import { interpretarResumoCashback } from '../src/lib/cashbackResumo.ts'

const secao = readFileSync(new URL('../src/components/SecaoCashback.tsx', import.meta.url), 'utf8')
const ajustes = readFileSync(new URL('../src/pages/Ajustes.tsx', import.meta.url), 'utf8')
const tipos = readFileSync(new URL('../src/types/database.ts', import.meta.url), 'utf8')

describe('SecaoCashback (texto)', () => {
  test('aviso do contador e do passivo antes de ligar (SUPOSIÇÃO-CASHBACK-1 e -2)', () => {
    assert.match(secao, /confirme com seu contador antes de ligar/i)
    assert.match(secao, /Cada real de cashback que você dá é um desconto que você deve ao cliente/)
    assert.match(secao, /SUPOSIÇÃO-CASHBACK-1/)
    assert.match(secao, /SUPOSIÇÃO-CASHBACK-2/)
  })
  test('desligar avisa que os saldos já dados continuam valendo', () => {
    assert.match(secao, /continuam valendo até vencer/)
  })
  test('usa a validação de faixas da regra pura', () => {
    assert.match(secao, /validarConfigCashback/)
    assert.match(secao, /CASHBACK_PADRAO/)
  })
  test('nenhuma gravação liga o cashback sem o termo aceito', () => {
    const ligacoes = [...secao.matchAll(/cashback_habilitado:\s*true/g)]
    assert.equal(ligacoes.length, 1)
    const trecho = secao.slice(ligacoes[0].index!, ligacoes[0].index! + 120)
    assert.match(trecho, /cashback_termo_aceito_em/)
    // o interruptor nunca grava `true` direto: abre o aviso
    assert.doesNotMatch(secao, /salvar\(\{\s*cashback_habilitado:\s*valor\s*\}\)/)
  })
  test('só com o perfil do cliente ligado e some em banco sem a migration', () => {
    assert.match(secao, /perfil_cliente_obrigatorio/)
    assert.match(secao, /Ligue o perfil do cliente para usar o cashback/)
    assert.match(secao, /cashback_habilitado === undefined\) return null/)
    assert.match(secao, /bancoSemRecurso/)
  })
  test('mostra o saldo em aberto', () => {
    assert.match(secao, /Saldo em aberto/)
  })
  test('Barraca ganhou os cinco campos opcionais', () => {
    for (const c of ['cashback_habilitado', 'cashback_percentual_bp', 'cashback_validade_dias', 'cashback_teto_uso_pct', 'cashback_termo_aceito_em']) {
      assert.match(tipos, new RegExp(`${c}\\?:`))
    }
  })
})

describe('ligação em Ajustes', () => {
  test('a seção é registrada uma vez, logo depois de SecaoCupons', () => {
    assert.equal([...ajustes.matchAll(/<SecaoCashback /g)].length, 1)
    assert.match(
      ajustes,
      /<SecaoCupons barraca=\{barraca\} \/>\s*<\/SecaoDaCategoria>\s*<SecaoDaCategoria categoria="cardapio" grupo="cardapio" atual=\{categoria\}>\s*<SecaoCashback barraca=\{barraca\} \/>/,
    )
    assert.match(ajustes, /import \{ SecaoCashback \} from '\.\.\/components\/SecaoCashback'/)
  })
})

describe('interpretarResumoCashback', () => {
  const linha = {
    concedido_centavos: 1000,
    usado_centavos: '300',
    vencido_centavos: 0,
    estornado_centavos: 50,
    excedente_centavos: 0,
    saldo_em_aberto_centavos: 650,
  }
  test('aceita a linha da RPC (array ou objeto, bigint como texto)', () => {
    const esperado = {
      concedidoCentavos: 1000,
      usadoCentavos: 300,
      vencidoCentavos: 0,
      estornadoCentavos: 50,
      excedenteCentavos: 0,
      saldoEmAbertoCentavos: 650,
    }
    assert.deepEqual(interpretarResumoCashback([linha]), esperado)
    assert.deepEqual(interpretarResumoCashback(linha), esperado)
  })
  test('negativo, não inteiro, campo faltando ou vazio viram null', () => {
    assert.equal(interpretarResumoCashback([{ ...linha, usado_centavos: -1 }]), null)
    assert.equal(interpretarResumoCashback([{ ...linha, usado_centavos: 1.5 }]), null)
    assert.equal(interpretarResumoCashback([{ ...linha, saldo_em_aberto_centavos: undefined }]), null)
    assert.equal(interpretarResumoCashback([]), null)
    assert.equal(interpretarResumoCashback(null), null)
  })
})
