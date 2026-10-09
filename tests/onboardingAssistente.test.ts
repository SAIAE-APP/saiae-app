// PR 4 do onboarding: assistente /configurar atrás da flag, sem tocar em quem já tem barraca. Rodar: npm test
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'

const ler = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const dispatcher = ler('src/pages/Dispatcher.tsx')
const pagina = ler('src/pages/Configurar.tsx')
const api = ler('src/lib/onboardingApi.ts')
const hook = ler('src/hooks/useOnboardingPendente.ts')
const app = ler('src/App.tsx')

describe('flag e roteamento', () => {
  test('Dispatcher só olha o assistente com VITE_ONBOARDING_CONFIG=1', () => {
    assert.match(dispatcher, /onboardingConfigHabilitado\(import\.meta\.env\.VITE_ONBOARDING_CONFIG\)/)
    assert.match(dispatcher, /navigate\('\/configurar', \{ replace: true \}\)/)
  })
  test('o desvio para o assistente vem DEPOIS de carregar as barracas e do erro (nunca antes)', () => {
    const iBarracas = dispatcher.indexOf('if (carregandoBarracas) return')
    const iErro = dispatcher.indexOf('if (erro) return')
    const iPendente = dispatcher.indexOf('if (onboardingPendente)')
    assert.ok(iBarracas > 0 && iErro > iBarracas && iPendente > iErro)
  })
  test('rota /configurar é protegida (exige login)', () => {
    assert.match(app, /path="\/configurar"[\s\S]*?<RotaProtegida>\s*<Configurar \/>/)
  })
})

describe('nunca bloqueia quem já tem barraca', () => {
  test('hook: sem flag => não pendente; funcionário sem barraca própria => não pendente', () => {
    assert.match(hook, /useState<boolean \| null>\(habilitado \? null : false\)/)
    assert.match(hook, /if \(donas\.length === 0\) \{\s+setPendente\(false\)/)
  })
  test('só barraca com onboarding_concluido_em nulo é pendente; erro de leitura vale como concluído', () => {
    assert.match(api, /onboarding_concluido_em === null/)
    const bloco = api.slice(api.indexOf('export async function barracasComOnboardingPendente'))
    assert.match(bloco.slice(0, 900), /if \(error \|\| !data\) return \[\]/)
    assert.match(bloco.slice(0, 900), /catch \{\s+return \[\]/)
  })
  test('barraca antiga (backfill) que cai na página é mandada embora', () => {
    assert.match(pagina, /if \(barracas\.length > 0\) \{\s+navigate\('\/', \{ replace: true \}\)/)
  })
})

describe('passos e persistência', () => {
  test('cada passo salva na hora pelas RPCs e mostra erro em frase simples', () => {
    for (const rpc of ['criar_barraca', 'onboarding_salvar_origem', 'onboarding_salvar_passo', 'slug_disponivel']) {
      assert.ok(api.includes(`'${rpc}'`), rpc)
    }
    assert.match(api, /mensagemErroOnboarding\(error\.message\)/)
  })
  test('só os opcionais 1 e 2 têm "Fazer depois"; os obrigatórios (3, 6, 7, 8) não', () => {
    assert.match(pagina, /onPular=\{\(\) => pular\(1\)\}/)
    assert.match(pagina, /onPular=\{\(\) => pular\(2\)\}/)
    for (const n of [3, 6, 7, 8]) assert.doesNotMatch(pagina, new RegExp(`pular\\(${n}\\)`))
    const rodapeMarca = pagina.slice(pagina.indexOf('function PassoMarca'), pagina.indexOf('const MODELOS'))
    assert.doesNotMatch(rodapeMarca, /onPular/)
  })
  test('nome e link: o link final aparece, disponibilidade é conferida e sugestões aparecem quando ocupado', () => {
    assert.match(pagina, /data-testid="link-cardapio"/)
    assert.match(pagina, /slugDisponivel\(slug\)/)
    assert.match(pagina, /sugerirSlugs\(/)
    assert.match(pagina, /problemaDoSlug\(slug\)/)
  })
  test('falha de rede ao conferir o link não bloqueia (o banco confere ao criar)', () => {
    assert.match(pagina, /estado === 'livre' \|\| estado === 'desconhecido'/)
    assert.match(api, /return r\.ok \? r\.dados === true : null/)
  })
  test('barraca criada é recarregada no cache antes de seguir (evita "sem acesso")', () => {
    assert.match(pagina, /await recarregar\(\)\s+const r = await concluirMarca/)
  })
  test('horário usa os modelos, "igual ao dia anterior" e valida antes de salvar', () => {
    assert.match(pagina, /onIgualAoAnterior=\{i > 0/)
    assert.match(pagina, /aplicarModelo\(m\)/)
    assert.match(pagina, /validarSemana\(semana\)/)
    assert.match(pagina, /if \(!validacao\.ok\) return/)
  })
  test('pagamento e modos: ao menos 1 ativo, sem vales; Pix online só é citado (token fica em Ajustes)', () => {
    assert.match(pagina, /ao menos uma forma de pagamento/)
    assert.match(pagina, /ao menos um jeito de atender/)
    assert.doesNotMatch(pagina, /vale/i)
    assert.doesNotMatch(pagina, /access_token|token/i)
  })
  test('tela final conclui no banco (passo 10) com pelo menos 2,5 s e respeita movimento reduzido', () => {
    assert.match(pagina, /concluirAssistente\(barraca\.id\)/)
    assert.match(pagina, /setTimeout\(r, 2500\)/)
    assert.match(pagina, /motion-reduce:animate-none/)
  })
  test('toda tela tem barra de progresso acessível e botão voltar de 44 px', () => {
    assert.match(pagina, /role="progressbar"/)
    assert.match(pagina, /size-11/)
  })
})

describe('telemetria sem dado pessoal', () => {
  test('só passo e ação; falha nunca atrapalha', () => {
    assert.match(api, /registrarEvento\(barracaId: string \| null, passo: number, acao:/)
    assert.match(api, /void rpc\('onboarding_evento'/)
    assert.doesNotMatch(api.slice(api.indexOf('export function registrarEvento'), api.indexOf('export const slugDisponivel')), /nome|slug|cnpj|email/i)
  })
})
