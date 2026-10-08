// Correções da revisão do perfil do cliente (PR #71). Rodar: npm test
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'
import {
  STAGING_REF,
  codigoSimuladoPermitido,
  decidirLimiteVerificar,
  precisaAtualizarUso,
} from '../supabase/functions/_shared/clienteCodigo.ts'

const sql = readFileSync(new URL('../supabase/migrations/20261017110000_perfil_cliente_correcoes.sql', import.meta.url), 'utf8')
const ler = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')

describe('B1 — tentativa atômica', () => {
  test('RPC conta numa única instrução e só em código não usado com menos de 5 tentativas', () => {
    assert.match(sql, /update public\.cliente_codigos c\s+set tentativas = c\.tentativas \+ 1\s+where c\.id = p_id and c\.usado_em is null and c\.tentativas < 5\s+returning/)
  })
  test('o verificar usa a RPC e não faz SELECT + UPDATE de tentativas', () => {
    const f = ler('supabase/functions/cliente-verificar-codigo/index.ts')
    assert.match(f, /rpc\('cliente_tentar_codigo'/)
    assert.doesNotMatch(f, /tentativas: reg\.tentativas \+ 1/)
  })
  test('limite próprio da verificação (telefone e IP), com decisão pura', () => {
    assert.equal(decidirLimiteVerificar({ verificacoesTelefoneHora: 0, verificacoesIpHora: 0 }), 'ok')
    assert.equal(decidirLimiteVerificar({ verificacoesTelefoneHora: 20, verificacoesIpHora: 0 }), 'limite')
    assert.equal(decidirLimiteVerificar({ verificacoesTelefoneHora: 0, verificacoesIpHora: 40 }), 'limite')
    assert.equal(decidirLimiteVerificar({ verificacoesTelefoneHora: 19, verificacoesIpHora: 39 }), 'ok')
  })
})

describe('I1 — apagar de verdade', () => {
  test('anonimiza cobranças e pedidos da mesma loja+telefone', () => {
    const fn = sql.slice(sql.indexOf('function public.cliente_apagar_dados'))
    assert.match(fn, /update public\.pagamentos_pendentes\s+set cliente_id = null, cliente_nome = null, cliente_telefone = null, entrega = null/)
    assert.match(fn, /barraca_id = v_barraca and \(cliente_telefone = v_telefone or entrega_telefone = v_telefone\)/)
    assert.match(fn, /delete from public\.clientes_finais/)
  })
})

describe('I2/I3 — limites atômicos e falha de envio', () => {
  test('reserva sob lock, com IP global e teto da loja', () => {
    assert.match(sql, /pg_advisory_xact_lock/)
    assert.match(sql, /ip_hash_global = p_ip_hash_global/)
    assert.match(sql, /'limite_loja'/)
  })
  test('pedir código usa a RPC, devolve mensagem neutra e não apaga a linha quando o CRM falha', () => {
    const f = ler('supabase/functions/cliente-pedir-codigo/index.ts')
    assert.match(f, /rpc\('cliente_reservar_codigo'/)
    assert.doesNotMatch(f, /\.delete\(\)/)
    assert.match(f, /falhou_em/)
    assert.doesNotMatch(f, /limite_loja['"]\s*\)\s*return json\(\{ erro: [^)]*loja/)
  })
})

describe('I5 — pedido anônimo não sobrescreve perfil confirmado', () => {
  for (const p of ['supabase/functions/criar-pedido-cardapio/index.ts', 'supabase/functions/webhook-mercadopago/index.ts']) {
    test(p, () => {
      const f = ler(p)
      assert.match(f, /telefone_confirmado_em/)
      assert.match(f, /\.\.\.\(confirmado \? \{\} : \{ nome:/)
      assert.match(f, /\.\.\.\(confirmado \? \{\} : \{ consentimento_lgpd_em:/)
    })
  }
})

describe('I6 — código simulado só no staging', () => {
  test('exige a flag E o ref de staging na URL', () => {
    const urlStaging = `https://${STAGING_REF}.supabase.co`
    assert.equal(codigoSimuladoPermitido('1', urlStaging), true)
    assert.equal(codigoSimuladoPermitido('1', 'https://vimjwzumjggrlvlxdejr.supabase.co'), false)
    assert.equal(codigoSimuladoPermitido('1', 'https://outro.supabase.co'), false)
    assert.equal(codigoSimuladoPermitido('1', undefined), false)
    assert.equal(codigoSimuladoPermitido(undefined, urlStaging), false)
    assert.equal(codigoSimuladoPermitido('0', urlStaging), false)
  })
})

describe('S1/S2/S3/S4', () => {
  test('S1: mensagem única de código inválido', () => {
    const f = ler('supabase/functions/cliente-verificar-codigo/index.ts')
    assert.match(f, /MENSAGEM_CODIGO_INVALIDO/)
    assert.doesNotMatch(f, /Código incorreto/)
  })
  test('S2: promoções só mudam quando vêm como boolean', () => {
    assert.match(sql, /when p_aceita_promocoes is null then public\.clientes_finais\.consentimento_marketing_em/)
    assert.match(ler('supabase/functions/cliente-verificar-codigo/index.ts'), /typeof body\.aceita_promocoes === 'boolean'/)
    assert.match(ler('supabase/functions/cliente-sessao/index.ts'), /typeof d\.aceita_promocoes === 'boolean'/)
  })
  test('S3: endereços por RPC transacional e excluir o padrão promove outro', () => {
    const f = ler('supabase/functions/cliente-sessao/index.ts')
    for (const r of ['cliente_endereco_novo', 'cliente_endereco_padrao', 'cliente_endereco_excluir']) assert.match(f, new RegExp(`rpc\\('${r}'`))
    assert.match(sql, /update public\.cliente_enderecos set padrao = true\s+where id = \(select id from public\.cliente_enderecos where cliente_id = p_cliente_id order by criado_em limit 1\)/)
  })
  test('S4: ultimo_uso_em no máximo 1x por hora', () => {
    const agora = Date.parse('2026-10-09T12:00:00Z')
    assert.equal(precisaAtualizarUso(null, agora), true)
    assert.equal(precisaAtualizarUso('2026-10-09T11:30:00Z', agora), false)
    assert.equal(precisaAtualizarUso('2026-10-09T10:59:00Z', agora), true)
  })
})

describe('segurança das novas funções', () => {
  test('execução restrita ao papel de serviço; tabela de log fechada', () => {
    assert.match(sql, /revoke all on function public\.%s from public, anon, authenticated/)
    assert.match(sql, /grant execute on function public\.%s to service_role/)
    assert.match(sql, /revoke all on table public\.cliente_verificacoes_log from anon, authenticated/)
    assert.doesNotMatch(sql, /drop table|truncate|drop column/i)
  })
})
