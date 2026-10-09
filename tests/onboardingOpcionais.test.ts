// Onboarding PR 6: consulta de CNPJ/CEP (BrasilAPI/ViaCEP), passos opcionais 4, 5 e 9. Rodar: npm test
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'
import {
  cepValido,
  cnpjValido,
  normalizarBrasilApi,
  normalizarViaCep,
  soDigitos,
} from '../supabase/functions/_shared/consultaExterna.ts'
import {
  cnpjValido as cnpjValidoApp,
  formatarCepDigitando,
  formatarCnpjDigitando,
  mensagemDaConsulta,
} from '../src/lib/onboardingConfig.ts'

const ler = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')

describe('validação (servidor == app)', () => {
  test('mesmos veredictos para CNPJ', () => {
    for (const c of ['11.222.333/0001-81', '11222333000181', '11222333000182', '00000000000000', '123', '', 'abc']) {
      assert.equal(cnpjValido(c), cnpjValidoApp(c), c)
    }
    assert.equal(cnpjValido('11.222.333/0001-81'), true)
  })
  test('CEP: 8 dígitos e não zerado', () => {
    assert.equal(cepValido('70040-010'), true)
    for (const c of ['7004001', '00000-000', 'abcdefgh', '']) assert.equal(cepValido(c), false, c)
    assert.equal(soDigitos('70.040-010'), '70040010')
  })
})

describe('normalizarBrasilApi (só o necessário)', () => {
  const resposta = {
    cnpj: '11222333000181',
    razao_social: 'PASTELARIA DO ZE LTDA',
    nome_fantasia: 'Pastelão do Zé',
    situacao_cadastral: 2,
    descricao_situacao_cadastral: 'ATIVA',
    descricao_tipo_de_logradouro: 'RUA',
    logradouro: 'DAS FLORES',
    numero: '100',
    complemento: 'LOJA 2',
    bairro: 'CENTRO',
    municipio: 'BRASILIA',
    uf: 'df',
    cep: '70040010',
    qsa: [{ nome_socio: 'FULANO', cpf_cnpj_socio: '***123456**' }],
    capital_social: 100000,
    ddd_telefone_1: '6133334444',
    email: 'zé@example.com',
  }
  test('extrai razão social, situação e endereço; descarta sócios, capital, telefone e e-mail', () => {
    const d = normalizarBrasilApi(resposta)
    assert.ok(d)
    assert.equal(d.razao_social, 'PASTELARIA DO ZE LTDA')
    assert.equal(d.ativa, true)
    assert.deepEqual(d.endereco, { cep: '70040010', rua: 'RUA DAS FLORES', numero: '100', complemento: 'LOJA 2', bairro: 'CENTRO', cidade: 'BRASILIA', uf: 'DF' })
    assert.doesNotMatch(JSON.stringify(d), /FULANO|capital|6133334444|example\.com/)
  })
  test('empresa baixada/inapta não vem como ativa', () => {
    assert.equal(normalizarBrasilApi({ ...resposta, situacao_cadastral: 8, descricao_situacao_cadastral: 'BAIXADA' })?.ativa, false)
  })
  test('resposta estranha => null (o passo cai no preenchimento à mão)', () => {
    for (const v of [null, undefined, 'x', 3, {}, { razao_social: '' }]) assert.equal(normalizarBrasilApi(v), null)
  })
  test('campos grandes são cortados', () => {
    const d = normalizarBrasilApi({ ...resposta, razao_social: 'A'.repeat(500) })
    assert.equal(d?.razao_social.length, 120)
  })
})

describe('normalizarViaCep', () => {
  test('endereço do CEP', () => {
    assert.deepEqual(normalizarViaCep({ cep: '70040-010', logradouro: 'Esplanada dos Ministérios', bairro: 'Zona Cívico-Administrativa', localidade: 'Brasília', uf: 'DF', ibge: '5300108', ddd: '61' }), {
      cep: '70040010', rua: 'Esplanada dos Ministérios', bairro: 'Zona Cívico-Administrativa', cidade: 'Brasília', uf: 'DF',
    })
  })
  test('CEP inexistente ({"erro": true}) ou formato estranho => null', () => {
    for (const v of [{ erro: true }, { erro: 'true' }, null, 'x', {}, { localidade: '' }]) assert.equal(normalizarViaCep(v), null)
  })
  test('CEP geral de cidade pequena (sem rua/bairro) ainda serve', () => {
    const d = normalizarViaCep({ cep: '72000-000', logradouro: '', bairro: '', localidade: 'Taguatinga', uf: 'DF' })
    assert.equal(d?.cidade, 'Taguatinga')
    assert.equal(d?.rua, '')
  })
})

describe('máscaras', () => {
  test('CNPJ e CEP enquanto digita', () => {
    assert.equal(formatarCnpjDigitando('11222333000181'), '11.222.333/0001-81')
    assert.equal(formatarCnpjDigitando('112223'), '11.222.3')
    assert.equal(formatarCnpjDigitando('11.222.333/0001-81999'), '11.222.333/0001-81')
    assert.equal(formatarCepDigitando('70040010'), '70040-010')
    assert.equal(formatarCepDigitando('7004'), '7004')
  })
  test('mensagens da consulta em frase simples', () => {
    assert.match(mensagemDaConsulta('nao_encontrado'), /Não encontramos/)
    assert.match(mensagemDaConsulta('limite'), /Muitas consultas/)
    assert.match(mensagemDaConsulta('qualquer-coisa'), /Preencha à mão/)
    assert.doesNotMatch(mensagemDaConsulta('indisponivel'), /erro|500|brasilapi|viacep/i)
  })
})

describe('função consultar-externo', () => {
  const fn = ler('supabase/functions/consultar-externo/index.ts')
  test('exige login e valida o número ANTES de gastar o limite ou chamar terceiro', () => {
    assert.match(fn, /auth\.getUser\(jwt\)/)
    assert.ok(fn.indexOf('cnpjValido(digitos)') < fn.indexOf("rpc('consulta_externa_registrar'"))
    assert.ok(fn.indexOf("rpc('consulta_externa_registrar'") < fn.indexOf('brasilapi.com.br'))
  })
  test('terceiros fixos (BrasilAPI e ViaCEP), com timeout e sem seguir redirecionamento; nada de segredo', () => {
    assert.match(fn, /https:\/\/brasilapi\.com\.br\/api\/cnpj\/v1\//)
    assert.match(fn, /https:\/\/viacep\.com\.br\/ws\//)
    assert.match(fn, /AbortSignal\.timeout/)
    assert.match(fn, /redirect: 'error'/)
    assert.doesNotMatch(fn, /console\.(log|error|warn)/)
  })
  test('falha do terceiro vira "indisponivel", nunca erro que trava o passo', () => {
    assert.match(fn, /motivo: 'indisponivel'/)
  })
})

describe('migration do limite', () => {
  const sql = ler('supabase/migrations/20261020110000_consultas_externas.sql')
  test('guarda só usuário/tipo/hora (nunca o CNPJ ou CEP), fechada para a API', () => {
    assert.doesNotMatch(sql, /cnpj text|cep text|valor text/i)
    assert.match(sql, /revoke all on table public\.consultas_externas_log from anon, authenticated/)
    assert.match(sql, /grant execute on function public\.consulta_externa_registrar\(uuid, text, integer\) to service_role/)
    assert.doesNotMatch(sql, /to authenticated|to anon/)
  })
  test('aditiva e com lock por usuário+tipo', () => {
    assert.doesNotMatch(sql, /drop table|truncate|drop column/i)
    assert.match(sql, /pg_advisory_xact_lock/)
  })
})

describe('passos 4, 5 e 9 no assistente', () => {
  const pagina = ler('src/pages/Configurar.tsx')
  test('opcionais têm "Fazer depois"; o CNPJ aceita "Sou MEI / ainda não tenho CNPJ"', () => {
    for (const n of [4, 5, 9]) assert.match(pagina, new RegExp(`onPular=\\{\\(\\) => pular\\(${n}\\)\\}`), String(n))
    assert.match(pagina, /Sou MEI \/ ainda não tenho CNPJ/)
  })
  test('só consulta CNPJ com dígitos verificadores válidos; falha da consulta nunca trava', () => {
    assert.match(pagina, /d\.length === 14 && cnpjValido\(d\)/)
    assert.match(pagina, /setBusca\('falhou'\)/)
    const botao = pagina.slice(pagina.indexOf('function PassoCnpj'), pagina.indexOf('type CamposEndereco'))
    assert.match(botao, /const pode = semCnpj \|\| valido/)
  })
  test('o passo da taxa só entra com Entrega ligada (ordem dinâmica)', () => {
    assert.match(pagina, /ordemDoAssistente\(entregaAtiva\)/)
    assert.match(pagina, /modosAtivos\(barraca\)\.includes\('entrega'\)/)
  })
  test('taxa: única (valor > 0) ou por bairro (configura em Ajustes); nada de raio/rota', () => {
    assert.match(pagina, /Taxa única/)
    assert.match(pagina, /Por bairro/)
    assert.doesNotMatch(pagina, /raio|rota/i)
  })
  test('Pix online: só um atalho para Ajustes na tela final (token nunca passa pelo assistente)', () => {
    assert.match(pagina, /Ativar o Pix online/)
    assert.doesNotMatch(pagina, /access_token|token/i)
  })
  test('CNPJ e CEP consultados pela função nossa, não direto do navegador', () => {
    const api = ler('src/lib/onboardingApi.ts')
    assert.match(api, /functions\.invoke\('consultar-externo'/)
    assert.doesNotMatch(api + pagina, /brasilapi|viacep/i)
  })
})
