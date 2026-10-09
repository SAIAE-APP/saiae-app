// Login com Google (Fase 1, web/PWA): lógica pura e garantias de que o resto do login não muda. Rodar: npm test
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'
import {
  caminhoInternoSeguro,
  caminhoRetornoGoogle,
  destinoAposLogin,
  loginGoogleHabilitado,
  mensagemErroRetorno,
  temSenhaNaConta,
} from '../src/lib/loginGoogle.ts'

const ler = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')

describe('flag', () => {
  test('só "1" liga o botão', () => {
    assert.equal(loginGoogleHabilitado('1'), true)
    for (const v of [undefined, '', '0', 'true', 1, null]) assert.equal(loginGoogleHabilitado(v), false, String(v))
  })
})

describe('caminhoRetornoGoogle', () => {
  test('sem parâmetros: raiz', () => {
    assert.equal(caminhoRetornoGoogle(new URLSearchParams()), '/')
  })
  test('leva voltar e o resto (plano/ciclo) para o fluxo de assinatura não se perder', () => {
    assert.equal(caminhoRetornoGoogle(new URLSearchParams('voltar=/assinar&plano=pro&ciclo=anual')), '/?voltar=%2Fassinar&plano=pro&ciclo=anual')
  })
  test('voltar perigoso é descartado', () => {
    for (const v of ['//evil.com', 'https://evil.com', '/\\evil.com', 'javascript:alert(1)']) {
      assert.equal(caminhoRetornoGoogle(new URLSearchParams({ voltar: v, plano: 'pro' })), '/', v)
    }
  })
})

describe('destinoAposLogin', () => {
  test('retoma o fluxo com o resto dos parâmetros', () => {
    assert.equal(destinoAposLogin('?voltar=%2Fassinar&plano=pro&ciclo=anual'), '/assinar?plano=pro&ciclo=anual')
    assert.equal(destinoAposLogin('?voltar=/assinar'), '/assinar')
  })
  test('sem voltar, ou voltar para fora do app: null (fluxo normal do Dispatcher)', () => {
    assert.equal(destinoAposLogin(''), null)
    assert.equal(destinoAposLogin('?plano=pro'), null)
    assert.equal(destinoAposLogin('?voltar=//evil.com'), null)
    assert.equal(destinoAposLogin('?voltar=https://evil.com'), null)
  })
})

describe('caminhoInternoSeguro', () => {
  test('só caminhos do próprio app', () => {
    assert.equal(caminhoInternoSeguro('/assinar'), true)
    assert.equal(caminhoInternoSeguro('/'), true)
    for (const v of ['', 'assinar', '//x', '/\\x', 'http://x', '/a\nb']) assert.equal(caminhoInternoSeguro(v), false, JSON.stringify(v))
  })
})

describe('mensagemErroRetorno', () => {
  test('cancelar no Google não é erro', () => {
    assert.equal(mensagemErroRetorno('?error=access_denied&error_description=User+denied'), null)
    assert.equal(mensagemErroRetorno('#error=access_denied'), null)
  })
  test('outros erros viram frase simples, sem texto técnico', () => {
    const m = mensagemErroRetorno('?error=server_error&error_description=Unable+to+exchange+external+code')
    assert.equal(m, 'Não foi possível entrar com o Google. Tente de novo.')
    assert.doesNotMatch(m ?? '', /exchange|server_error/)
  })
  test('sem erro: null', () => {
    assert.equal(mensagemErroRetorno(''), null)
    assert.equal(mensagemErroRetorno('#access_token=abc&type=bearer'), null)
  })
})

describe('temSenhaNaConta', () => {
  test('conta só-Google não tem senha; e-mail/senha ou os dois têm', () => {
    assert.equal(temSenhaNaConta({ app_metadata: { providers: ['google'], provider: 'google' } }), false)
    assert.equal(temSenhaNaConta({ app_metadata: { providers: ['email'], provider: 'email' } }), true)
    assert.equal(temSenhaNaConta({ app_metadata: { providers: ['google', 'email'] } }), true)
  })
  test('sem informação: comportamento de sempre (tem senha)', () => {
    assert.equal(temSenhaNaConta(null), true)
    assert.equal(temSenhaNaConta({}), true)
  })
})

describe('o resto do login não muda', () => {
  const login = ler('src/pages/Login.tsx')
  const cadastro = ler('src/pages/Cadastro.tsx')
  test('botão só aparece com a flag, nas duas telas', () => {
    for (const f of [login, cadastro]) {
      assert.match(f, /loginGoogleHabilitado\(import\.meta\.env\.VITE_LOGIN_GOOGLE\)/)
      assert.match(f, /\{comGoogle && \(/)
    }
  })
  test('com a flag desligada o formulário mantém o espaçamento de antes', () => {
    assert.match(login, /comGoogle \? 'flex flex-col gap-4' : 'mt-8 flex flex-col gap-4'/)
  })
  test('login por senha continua chamando signInWithPassword', () => {
    assert.match(ler('src/hooks/useAuth.ts'), /signInWithPassword\(\{ email, password: senha \}\)/)
  })
  test('OAuth do Google: provedor, retorno pela raiz e escolha de conta', () => {
    const hook = ler('src/hooks/useAuth.ts')
    assert.match(hook, /signInWithOAuth\(\{\s+provider: 'google'/)
    assert.match(hook, /redirectTo: urlPublica\(caminhoRetornoGoogle\(parametros\)\)/)
    assert.match(hook, /prompt: 'select_account'/)
  })
  test('conta só-Google: o modal não pede senha atual', () => {
    const modal = ler('src/components/ModalTrocarSenha.tsx')
    assert.match(modal, /\{temSenha && \(\s+<Input\s+label="Senha atual"/)
    assert.match(modal, /\(!temSenha \|\| senhaAtual\.length > 0\)/)
  })
  test('Dispatcher só desvia quando há voltar', () => {
    assert.match(ler('src/pages/Dispatcher.tsx'), /const destinoSalvo = destinoAposLogin\(params\.toString\(\)\)/)
  })
})
