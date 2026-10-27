// Retorno do OAuth do Mercado Pago. SEM JWT (o navegador chega aqui redirecionado pelo MP):
//   supabase functions deploy mp-oauth-callback --no-verify-jwt --project-ref <ref>
// (não há supabase/config.toml no repo; o --no-verify-jwt do deploy é o que vale, como em webhook-mercadopago).
// A identidade vem do `state`: de uso único (a linha é apagada ao consumir) e válido por 10 min. Troca o código,
// grava os tokens CIFRADOS e redireciona para /ajustes?mp=ok ou ?mp=erro. Nada sensível em log.
// Secrets: MP_CLIENT_ID, MP_CLIENT_SECRET, MP_OAUTH_REDIRECT_URI, TOKENS_CHAVE_V1..; opcional APP_PUBLIC_URL.
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { cifrar, configDoEnv } from '../_shared/segredoCifrado.ts'
import { contaMpAlterada, ErroOauthMp, trocarCodigo, urlRetornoApp } from '../_shared/pagamento/oauthMercadoPago.ts'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function voltar(ok: boolean) {
  const base = Deno.env.get('APP_PUBLIC_URL') ?? 'https://app.saiae.com.br'
  return new Response(null, { status: 302, headers: { Location: urlRetornoApp(base, ok) } })
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'GET') return new Response('Método não permitido', { status: 405 })

  const url = new URL(req.url)
  const state = url.searchParams.get('state') ?? ''
  const codigo = url.searchParams.get('code') ?? ''
  if (!UUID.test(state)) return voltar(false)

  const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '')

  // Consome o state ANTES de tudo (uso único, mesmo se o dono recusou ou o MP falhar).
  const { data: consumido, error: erroState } = await supabase.from('mp_oauth_estados').delete().eq('state', state).select('barraca_id, expira_em')
  if (erroState || !consumido?.length) return voltar(false)
  const { barraca_id: barracaId, expira_em: expiraEm } = consumido[0] as { barraca_id: string; expira_em: string }
  if (new Date(expiraEm).getTime() < Date.now()) return voltar(false)
  if (!codigo || url.searchParams.get('error')) return voltar(false)

  const clientId = Deno.env.get('MP_CLIENT_ID')
  const clientSecret = Deno.env.get('MP_CLIENT_SECRET')
  const redirectUri = Deno.env.get('MP_OAUTH_REDIRECT_URI')
  if (!clientId || !clientSecret || !redirectUri) {
    console.error('mp-oauth-callback: configuração do Mercado Pago ausente')
    return voltar(false)
  }

  try {
    const novos = await trocarCodigo({ clientId, clientSecret, redirectUri, code: codigo })
    const cfg = configDoEnv(Deno.env)
    const acesso = await cifrar(novos.accessToken, { barracaId, campo: 'mp_access_token' }, cfg)
    const renovacao = await cifrar(novos.refreshToken, { barracaId, campo: 'mp_refresh_token' }, cfg)
    // Conta anterior: reconectar com OUTRA conta não é bloqueado, mas fica no log (sem ids nem tokens).
    const { data: anterior } = await supabase.from('barracas_mp_oauth').select('mp_user_id').eq('barraca_id', barracaId).maybeSingle()
    const { error } = await supabase.from('barracas_mp_oauth').upsert(
      {
        barraca_id: barracaId,
        access_token_cifrado: acesso.valor,
        refresh_token_cifrado: renovacao.valor,
        mp_user_id: novos.userId,
        public_key: novos.publicKey,
        expira_em: new Date(Date.now() + novos.expiraEmSegundos * 1000).toISOString(),
        status: 'conectada',
        atualizado_em: new Date().toISOString(),
      },
      { onConflict: 'barraca_id' },
    )
    if (error) {
      console.error('mp-oauth-callback: falha ao gravar conexão', error.message)
      return voltar(false)
    }
    if (contaMpAlterada((anterior as { mp_user_id?: unknown } | null)?.mp_user_id, novos.userId)) {
      console.warn('mp-oauth-callback: reconexão com outra conta do Mercado Pago', { conta_alterada: true })
    }
  } catch (e) {
    // Só a classe do erro (ErroOauthMp traz o status HTTP); nunca a mensagem nem dados do MP.
    console.error('mp-oauth-callback: falha ao conectar', e instanceof ErroOauthMp ? `${e.name} status=${e.status}` : e instanceof Error ? e.name : 'erro')
    return voltar(false)
  }
  return voltar(true)
})
