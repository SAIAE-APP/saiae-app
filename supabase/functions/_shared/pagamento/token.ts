// Leitura do token do dono por provedor (tabela barracas_pagamento_token).
//
// Tolerante à ordem de deploy: busca as linhas da barraca e escolhe a do provedor
// em código, tratando linha sem a coluna `provedor` (antes da migration) como
// Mercado Pago. Assim a function nova não quebra se subir antes da migration.
import { cifrar, configDoEnv, lerSegredo, type EnvMinimo } from '../segredoCifrado.ts'
import { ErroOauthMp, precisaRenovar, renovar, type TokensMp } from './oauthMercadoPago.ts'
import { PROVEDOR_PADRAO, type ProvedorChave } from './tipos.ts'

type ClienteSupabase = {
  from: (tabela: string) => {
    select: (colunas: string) => {
      eq: (coluna: string, valor: string) => PromiseLike<{
        data: Record<string, unknown>[] | null
        error: { message: string } | null
      }>
    }
  }
}

/** Segredo de assinatura do webhook do provedor (opcional), ou null se o dono não cadastrou. */
export async function buscarSegredoWebhook(
  supabase: unknown,
  barracaId: string,
  provedor: ProvedorChave,
  env?: EnvMinimo,
): Promise<string | null> {
  const { data, error } = await (supabase as ClienteSupabase)
    .from('barracas_pagamento_token')
    .select('*')
    .eq('barraca_id', barracaId)
  if (error || !data) return null
  const linha = data.find((l) => String(l.provedor ?? PROVEDOR_PADRAO) === provedor)
  if (!linha) return null
  return (await lerSegredo({ texto: linha.segredo_webhook, cifrado: linha.segredo_webhook_cifrado }, { barracaId, campo: 'segredo_webhook' }, configDoEnv(env))).valor
}

export async function buscarTokenDoProvedor(
  supabase: unknown,
  barracaId: string,
  provedor: ProvedorChave,
  env?: EnvMinimo,
): Promise<string | null> {
  const { data, error } = await (supabase as ClienteSupabase)
    .from('barracas_pagamento_token')
    .select('*')
    .eq('barraca_id', barracaId)
  if (error || !data) return null
  const linha = data.find((l) => String(l.provedor ?? PROVEDOR_PADRAO) === provedor)
  if (!linha) return null
  return (await lerSegredo({ texto: linha.access_token, cifrado: linha.access_token_cifrado }, { barracaId, campo: 'access_token' }, configDoEnv(env))).valor
}

// --- Token do VENDEDOR (marketplace, OAuth do Mercado Pago) ---------------------------------------------------

type ClienteOauth = {
  from: (tabela: string) => {
    select: (colunas: string) => {
      eq: (coluna: string, valor: string) => PromiseLike<{ data: Record<string, unknown>[] | null; error: { message: string } | null }>
    }
    update: (valores: Record<string, unknown>) => {
      eq: (coluna: string, valor: string) => {
        eq: (coluna: string, valor: unknown) => {
          select: (colunas: string) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>
        }
      }
    }
  }
}

export type ResultadoTokenVendedor =
  | { ok: true; token: string; publicKey: string | null }
  | { ok: false; motivo: 'nao_conectada' | 'renovacao_falhou' }

type DepsTokenVendedor = {
  agora?: () => Date
  renovar?: (p: { clientId: string; clientSecret: string; refreshToken: string }) => Promise<TokensMp>
}

const ctx = (barracaId: string, campo: string) => ({ barracaId, campo })

/**
 * Token de acesso da conta Mercado Pago da barraca, renovado se estiver perto de vencer.
 *
 * Corrida: o refresh token rotaciona, então duas renovações simultâneas se invalidariam. Quem renova primeiro
 * "reivindica" a linha com `update ... where atualizado_em = <leitura>`; quem perde relê a linha e usa o que o
 * vencedor gravou (sem chamar o MP). Recusa definitiva do MP (4xx) marca a barraca como desconectada; erro de rede
 * ou 5xx só devolve falha, sem derrubar a conexão.
 */
export async function obterTokenVendedor(
  supabase: unknown,
  barracaId: string,
  env?: EnvMinimo,
  deps: DepsTokenVendedor = {},
): Promise<ResultadoTokenVendedor> {
  const db = supabase as ClienteOauth
  const agora = deps.agora ?? (() => new Date())
  const renovarFn = deps.renovar ?? renovar
  const cfg = configDoEnv(env)

  const ler = async () => {
    const { data, error } = await db.from('barracas_mp_oauth').select('*').eq('barraca_id', barracaId)
    return error || !data?.length ? null : data[0]
  }
  const decifrarCampo = async (linha: Record<string, unknown>, coluna: string, campo: string) =>
    (await lerSegredo({ cifrado: linha[coluna] }, ctx(barracaId, campo), cfg)).valor
  const publicKeyDe = (l: Record<string, unknown>) => (typeof l.public_key === 'string' && l.public_key ? l.public_key : null)
  const vigente = async (l: Record<string, unknown> | null): Promise<ResultadoTokenVendedor | null> => {
    if (!l || l.status !== 'conectada' || typeof l.expira_em !== 'string' || precisaRenovar(l.expira_em, agora())) return null
    const token = await decifrarCampo(l, 'access_token_cifrado', 'mp_access_token')
    return token ? { ok: true, token, publicKey: publicKeyDe(l) } : null
  }

  const linha = await ler()
  if (!linha || linha.status !== 'conectada') return { ok: false, motivo: 'nao_conectada' }
  const valido = await vigente(linha)
  if (valido) return valido

  const refreshToken = await decifrarCampo(linha, 'refresh_token_cifrado', 'mp_refresh_token')
  const clientId = env?.get('MP_CLIENT_ID')
  const clientSecret = env?.get('MP_CLIENT_SECRET')
  if (!refreshToken || !clientId || !clientSecret) return { ok: false, motivo: 'renovacao_falhou' }

  // Reivindica a renovação.
  const reivindicado = agora().toISOString()
  const lido = String(linha.atualizado_em)
  const disputa = await db
    .from('barracas_mp_oauth')
    .update({ atualizado_em: reivindicado })
    .eq('barraca_id', barracaId)
    .eq('atualizado_em', lido)
    .select('barraca_id')
  if (disputa.error) return { ok: false, motivo: 'renovacao_falhou' }
  if (!disputa.data?.length) {
    // Perdeu a corrida: usa o que o vencedor gravou.
    const atual = await ler()
    if (!atual || atual.status !== 'conectada') return { ok: false, motivo: 'nao_conectada' }
    return (await vigente(atual)) ?? { ok: false, motivo: 'renovacao_falhou' }
  }

  const gravar = (valores: Record<string, unknown>) =>
    db.from('barracas_mp_oauth').update(valores).eq('barraca_id', barracaId).eq('atualizado_em', reivindicado).select('barraca_id')

  let novos: TokensMp
  try {
    novos = await renovarFn({ clientId, clientSecret, refreshToken })
  } catch (e) {
    if (e instanceof ErroOauthMp && e.definitivo) {
      const r = await gravar({ status: 'desconectada', atualizado_em: agora().toISOString() })
      if (r.error) console.error('obterTokenVendedor: falha ao marcar desconectada', r.error.message)
    }
    return { ok: false, motivo: 'renovacao_falhou' }
  }

  try {
    const acesso = await cifrar(novos.accessToken, ctx(barracaId, 'mp_access_token'), cfg)
    const refresh = await cifrar(novos.refreshToken, ctx(barracaId, 'mp_refresh_token'), cfg)
    const r = await gravar({
      access_token_cifrado: acesso.valor,
      refresh_token_cifrado: refresh.valor,
      mp_user_id: novos.userId,
      public_key: novos.publicKey ?? publicKeyDe(linha),
      expira_em: new Date(agora().getTime() + novos.expiraEmSegundos * 1000).toISOString(),
      status: 'conectada',
      atualizado_em: agora().toISOString(),
    })
    if (r.error || !r.data?.length) {
      console.error('obterTokenVendedor: falha ao gravar a renovação', r.error?.message ?? 'nenhuma linha atualizada')
      return { ok: false, motivo: 'renovacao_falhou' }
    }
  } catch {
    return { ok: false, motivo: 'renovacao_falhou' }
  }
  return { ok: true, token: novos.accessToken, publicKey: novos.publicKey ?? publicKeyDe(linha) }
}
