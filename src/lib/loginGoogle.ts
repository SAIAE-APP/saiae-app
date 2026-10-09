// Login com Google (Fase 1, web/PWA). Funções puras, sem Capacitor nem Supabase, para testar no Node.
// Spec: docs/superpowers/specs/2026-10-08-login-google-design.md

/** O botão "Continuar com Google" só aparece com VITE_LOGIN_GOOGLE=1 (desligado por padrão). */
export function loginGoogleHabilitado(valor: unknown): boolean {
  return valor === '1'
}

/** Caminho para onde o Google devolve o usuário: a raiz (o Dispatcher resolve o destino), levando junto os
 * parâmetros da tela de entrada (ex.: `voltar=/assinar&plano=pro`) para o fluxo de assinatura não se perder. */
export function caminhoRetornoGoogle(params: URLSearchParams): string {
  const resto = new URLSearchParams()
  const voltar = params.get('voltar')
  if (voltar && caminhoInternoSeguro(voltar)) {
    resto.set('voltar', voltar)
    params.forEach((valor, chave) => {
      if (chave !== 'voltar') resto.set(chave, valor)
    })
  }
  const texto = resto.toString()
  return texto ? `/?${texto}` : '/'
}

/** Só caminhos do próprio app: começa com uma barra e não é "//host" nem "/\\host" (redirecionamento aberto). */
export function caminhoInternoSeguro(caminho: string): boolean {
  return /^\/(?![/\\])/.test(caminho) && !/[\r\n]/.test(caminho)
}

/** Depois do retorno do Google com sessão: se a URL trouxe `voltar`, devolve o destino (com o resto dos
 * parâmetros); senão null (o Dispatcher segue o fluxo normal). */
export function destinoAposLogin(search: string): string | null {
  const params = new URLSearchParams(search)
  const voltar = params.get('voltar')
  if (!voltar || !caminhoInternoSeguro(voltar)) return null
  params.delete('voltar')
  const resto = params.toString()
  return resto ? `${voltar}?${resto}` : voltar
}

/** O Google/Supabase devolve `error`/`error_description` na URL quando o usuário cancela ou algo falha.
 * Cancelar não é erro (null); o resto vira frase simples, sem texto técnico. */
export function mensagemErroRetorno(textoDaUrl: string): string | null {
  const params = new URLSearchParams(textoDaUrl.replace(/^[?#]/, '').replace(/#/g, '&'))
  const erro = params.get('error')
  if (!erro) return null
  if (erro === 'access_denied') return null
  return 'Não foi possível entrar com o Google. Tente de novo.'
}

/** A conta tem login por e-mail? (conta só-Google ainda não criou uma credencial própria: o modal vira "Criar"). */
export function temSenhaNaConta(usuario: { app_metadata?: { providers?: unknown; provider?: unknown } } | null | undefined): boolean {
  const meta = usuario?.app_metadata
  if (!meta) return true // sem informação: comportamento de sempre
  if (Array.isArray(meta.providers)) return meta.providers.includes('email')
  return meta.provider === undefined || meta.provider === 'email'
}
