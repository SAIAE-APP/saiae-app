// H7 (3/4): campo "Endereço do cardápio" em Ajustes. A regra de formato e a lista de reservados são as do assistente de
// configuração (onboardingConfig), sem duplicar. Rodar: npm test
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'
import {
  AVISO_TROCA,
  erroDoCampoSlug,
  mensagemTrocarSlug,
  normalizarSlugDigitado,
  podeSalvarSlug,
  slugDoNome,
  slugParaSalvar,
} from '../src/lib/trocarSlug.ts'

describe('digitar o endereço', () => {
  test('minúsculo, sem acento, símbolo e espaço viram hífen; hífen do fim fica enquanto digita', () => {
    assert.equal(normalizarSlugDigitado("D'Helena Cozinha"), 'd-helena-cozinha')
    assert.equal(normalizarSlugDigitado('Pastéis do Zé'), 'pasteis-do-ze')
    assert.equal(normalizarSlugDigitado('pastel-'), 'pastel-', 'dá para continuar digitando')
    assert.equal(normalizarSlugDigitado('pastel- do'), 'pastel-do')
    assert.equal(normalizarSlugDigitado('--abc'), 'abc')
    assert.equal(normalizarSlugDigitado('a   b'), 'a-b')
    assert.equal(normalizarSlugDigitado('x'.repeat(60)).length, 40)
  })
  test('para salvar, o hífen pendurado cai', () => {
    assert.equal(slugParaSalvar('pastel-'), 'pastel')
    assert.equal(slugParaSalvar('  Meu Cardápio! '), 'meu-cardapio')
  })
  test('"Usar o nome da barraca" usa o mesmo gerarSlug do assistente', () => {
    assert.equal(slugDoNome("D'Helena Cozinha Afetiva"), 'd-helena-cozinha-afetiva')
    assert.equal(slugDoNome('Pastelão do Zé!'), 'pastelao-do-ze')
  })
})

describe('validação do campo', () => {
  test('curto, reservado e vazio dão mensagem; válido não', () => {
    assert.match(erroDoCampoSlug('ab') ?? '', /pelo menos 3/)
    assert.match(erroDoCampoSlug('login') ?? '', /reservado/)
    assert.match(erroDoCampoSlug('configurar') ?? '', /reservado/)
    assert.equal(erroDoCampoSlug('dhelena-cozinha'), null)
    assert.match(erroDoCampoSlug('') ?? '', /Escolha um endereço/)
  })
  test('só habilita salvar quando muda de verdade e é válido', () => {
    assert.equal(podeSalvarSlug('restaurante-paulo', 'restaurante-paulo'), false)
    assert.equal(podeSalvarSlug('restaurante-paulo', 'restaurante-paulo-'), false, 'hífen pendurado = igual ao atual')
    assert.equal(podeSalvarSlug('restaurante-paulo', ''), false)
    assert.equal(podeSalvarSlug('restaurante-paulo', 'ab'), false)
    assert.equal(podeSalvarSlug('restaurante-paulo', 'login'), false)
    assert.equal(podeSalvarSlug('restaurante-paulo', 'dhelena-cozinha'), true)
  })
})

describe('mensagens da RPC', () => {
  test('cada estado tem frase própria; desconhecido cai na genérica', () => {
    for (const e of ['em_uso', 'reservado', 'invalido', 'muito_cedo', 'limite_apelidos', 'sem_acesso', 'nao_autenticado']) {
      assert.notEqual(mensagemTrocarSlug(e), mensagemTrocarSlug(undefined), e)
    }
    assert.match(mensagemTrocarSlug('muito_cedo'), /24 horas/)
    assert.match(mensagemTrocarSlug('sem_acesso'), /dono/)
    assert.match(AVISO_TROCA, /continuam funcionando/)
  })
})

describe('tela (guardas estáticas)', () => {
  const ler = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
  test('usa a RPC de troca, só o dono edita e a confirmação mostra o aviso', () => {
    const c = ler('components/EnderecoCardapio.tsx')
    assert.match(c, /rpc\('barraca_trocar_slug', \{ p_barraca_id: barracaId, p_novo: slugFinal \}\)/)
    assert.match(c, /papel\?: string \} \| null\)\?\.papel === 'dono'/)
    assert.match(c, /\{AVISO_TROCA\}/)
    assert.match(c, /Sem internet\. O endereço não foi trocado\./)
    assert.match(ler('pages/Ajustes.tsx'), /<EnderecoCardapio barraca=\{barraca\} \/>/)
  })
  test('não duplica a regra do assistente: importa de onboardingConfig', () => {
    assert.match(ler('lib/trocarSlug.ts'), /from '\.\/onboardingConfig\.ts'/)
    assert.doesNotMatch(ler('lib/trocarSlug.ts'), /SLUGS_RESERVADOS/)
  })
})
