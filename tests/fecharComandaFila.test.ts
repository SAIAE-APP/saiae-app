// Fechar comanda pela fila offline: o que a fila faz com a resposta da RPC fechar_comanda. Rodar: npm test
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'
import { desfechoFecharComanda } from '../src/lib/fecharComandaFila.ts'

describe('desfechoFecharComanda', () => {
  test('ok (inclusive o reenvio com o mesmo método) sai da fila', () => {
    assert.equal(desfechoFecharComanda(null, { estado: 'ok' }), 'concluida')
  })

  test('banco sem a RPC (PGRST202) adia sem travar a fila', () => {
    assert.equal(desfechoFecharComanda({ code: 'PGRST202' }, null), 'adiar')
  })

  test('estados que reenviar nunca resolve: falha (sai da fila e avisa)', () => {
    for (const estado of ['sem_acesso', 'ja_fechada', 'sem_itens', 'metodo_invalido']) {
      assert.equal(desfechoFecharComanda(null, { estado }), 'falha', estado)
    }
  })

  test('erro de rede/sessão e resposta estranha repetem (nunca perdem o fechamento)', () => {
    assert.equal(desfechoFecharComanda({ code: '', message: 'Failed to fetch' }, null), 'repetir')
    for (const r of [{ estado: 'nao_autenticado' }, { estado: 'outra_coisa' }, {}, null, undefined]) {
      assert.equal(desfechoFecharComanda(null, r as never), 'repetir', JSON.stringify(r))
    }
  })
})

describe('fiação (guardas estáticas)', () => {
  const ler = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')

  test('a operação fechar_comanda chama a RPC, adia sem travar e não desiste de erro de rede', () => {
    const s = ler('hooks/useSincronizacao.ts')
    const caso = s.slice(s.indexOf("case 'fechar_comanda'"), s.indexOf("case 'salvar_cliente'"))
    assert.match(caso, /rpc\('fechar_comanda', \{\s*p_comanda_id: comanda_id,\s*p_metodo: metodo,\s*p_cobrar_taxa_servico: cobrar_taxa_servico,?\s*\}\)/)
    assert.match(caso, /throw new OperacaoAdiadaError\(/)
    assert.match(caso, /registrarErroApp\(/)
    assert.match(caso, /throw error \?\? new Error\(/)
    assert.match(ler('lib/fila.ts'), /'fechar_comanda'/)
  })
})
