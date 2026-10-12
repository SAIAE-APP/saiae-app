// Grava as credenciais das lojas (token FocusNFe por ambiente, token do provedor de Pix e segredo do webhook)
// CIFRADAS. Fase 2 do plano docs/superpowers/plans/2026-10-12-criptografar-tokens-em-repouso.md: o navegador manda o
// valor só para esta função (HTTPS), que cifra com a chave dos secrets e grava com a service role; o valor nunca mais
// passa por RPC/PostgREST nem é devolvido. Fica em _shared, sem imports de jsr:/Deno, para os testes EXECUTAREM o handler
// (tests/salvarCredencial.test.ts); salvar-credencial/index.ts só liga as dependências reais.
//
// Quem pode gravar: só quem tem linha em `usuarios_barracas` da loja (mesmo critério do emitir-nfce). O acesso de
// SUPORTE (`acesso_suporte_ativo`, migration 20261023100000) NÃO cria linha ali e esta função não consulta
// `acessos_suporte`: o suporte nunca grava credencial. Sem chave configurada a função RECUSA (503): nunca grava em texto.
import { cifrar, configDoEnv, ErroSegredo, type EnvMinimo } from './segredoCifrado.ts'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

export const PROVEDORES_PIX = ['mercadopago', 'pagbank', 'asaas', 'woovi', 'abacatepay']
export const AMBIENTES_FISCAIS = ['homologacao', 'producao']
export const LIMITE_GRAVACOES_HORA = 30
export const TAMANHO_MAXIMO_CREDENCIAL = 4096
export const MSG_SALVAR_FALHA = 'Não foi possível salvar agora. Tente novamente em instantes.'
export const MSG_SEM_CHAVE = 'O armazenamento seguro de credenciais ainda não está configurado. Fale com o suporte.'

export type TipoCredencial = 'fiscal' | 'pagamento' | 'segredo_webhook'

type Resultado = PromiseLike<{ data: unknown; error: { message: string } | null }>
export type DepsSalvarCredencial = {
  autenticar: (jwt: string) => Promise<{ id: string } | null>
  // Cliente supabase (service role). Tipado frouxo de propósito: é a fronteira com o supabase-js.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: { from: (tabela: string) => any; rpc: (nome: string, args: Record<string, unknown>) => Resultado }
  env: EnvMinimo
  cripto?: Crypto
  agora?: () => number
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } })
}

type Corpo = { barraca_id?: unknown; tipo?: unknown; ambiente?: unknown; provedor?: unknown; valor?: unknown }

export async function tratarSalvarCredencial(req: Request, deps: DepsSalvarCredencial): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS })
  if (req.method !== 'POST') return json({ erro: 'Método não permitido' }, 405)

  let corpo: Corpo
  try {
    corpo = (await req.json()) as Corpo
  } catch {
    return json({ erro: 'JSON inválido' }, 400)
  }

  const usuario = await deps.autenticar((req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, ''))
  if (!usuario) return json({ erro: 'Não autenticado' }, 401)

  const barracaId = typeof corpo?.barraca_id === 'string' ? corpo.barraca_id : ''
  const tipo = corpo?.tipo as TipoCredencial
  const valor = typeof corpo?.valor === 'string' ? corpo.valor.trim() : ''
  const provedor = typeof corpo?.provedor === 'string' ? corpo.provedor : 'mercadopago'
  const ambiente = typeof corpo?.ambiente === 'string' ? corpo.ambiente : ''

  if (!/^[0-9a-f-]{36}$/i.test(barracaId) || !['fiscal', 'pagamento', 'segredo_webhook'].includes(tipo)) {
    return json({ erro: 'Dados inválidos' }, 400)
  }
  if (!valor || valor.length > TAMANHO_MAXIMO_CREDENCIAL) return json({ erro: 'Dados inválidos' }, 400)
  if (tipo === 'fiscal' && !AMBIENTES_FISCAIS.includes(ambiente)) return json({ erro: 'Ambiente inválido' }, 400)
  if (tipo !== 'fiscal' && !PROVEDORES_PIX.includes(provedor)) return json({ erro: 'Provedor de pagamento inválido' }, 400)

  const { supabase } = deps

  // Acesso: pertence à loja (a service role ignora RLS, então a checagem é explícita). Suporte não entra.
  const { data: acesso, error: erroAcesso } = await supabase
    .from('usuarios_barracas')
    .select('usuario_id')
    .eq('usuario_id', usuario.id)
    .eq('barraca_id', barracaId)
    .maybeSingle()
  if (erroAcesso) {
    console.error('salvar-credencial: acesso', erroAcesso.message)
    return json({ erro: MSG_SALVAR_FALHA }, 500)
  }
  if (!acesso) return json({ erro: 'Sem acesso a esta barraca' }, 403)

  const { data: cabe, error: erroLimite } = await supabase.rpc('consulta_externa_registrar', {
    p_usuario_id: usuario.id,
    p_tipo: 'salvar_credencial',
    p_limite: LIMITE_GRAVACOES_HORA,
  })
  if (erroLimite) {
    console.error('salvar-credencial: limite', erroLimite.message)
    return json({ erro: MSG_SALVAR_FALHA }, 503)
  }
  if (cabe !== true) return json({ erro: 'Muitas tentativas. Tente de novo mais tarde.' }, 429)

  // Campo que recebe o valor (também é o contexto/AAD da cifra: tem que ser o mesmo nome que a leitura usa).
  const campo = tipo === 'fiscal' ? (ambiente === 'producao' ? 'token_producao' : 'token_homologacao') : tipo === 'pagamento' ? 'access_token' : 'segredo_webhook'

  let cifrado: { valor: string; kid: string }
  try {
    cifrado = await cifrar(valor, { barracaId, campo }, configDoEnv(deps.env), deps.cripto ?? globalThis.crypto)
  } catch (erro) {
    const codigo = erro instanceof ErroSegredo ? erro.codigo : 'falha_cifrar'
    console.error('salvar-credencial: cifra', codigo)
    return json({ erro: codigo === 'sem_chave' ? MSG_SEM_CHAVE : MSG_SALVAR_FALHA }, codigo === 'sem_chave' ? 503 : 500)
  }

  const agoraIso = new Date((deps.agora ?? Date.now)()).toISOString()
  const meta = { cifrado_em: agoraIso, cifrado_chave: cifrado.kid, atualizado_em: agoraIso }

  if (tipo === 'fiscal') {
    // O texto do MESMO ambiente é zerado junto; o do outro ambiente não é tocado.
    const { error } = await supabase
      .from('barracas_fiscal_token')
      .upsert({ barraca_id: barracaId, [campo]: null, [`${campo}_cifrado`]: cifrado.valor, ...meta }, { onConflict: 'barraca_id' })
    if (error) {
      console.error('salvar-credencial: gravar fiscal', error.message)
      return json({ erro: MSG_SALVAR_FALHA }, 500)
    }
  } else if (tipo === 'pagamento') {
    // Trocar o token mantém o segredo do webhook (o upsert só toca as colunas enviadas).
    const { error } = await supabase
      .from('barracas_pagamento_token')
      .upsert({ barraca_id: barracaId, provedor, access_token: null, access_token_cifrado: cifrado.valor, ...meta }, { onConflict: 'barraca_id,provedor' })
    if (error) {
      console.error('salvar-credencial: gravar pagamento', error.message)
      return json({ erro: MSG_SALVAR_FALHA }, 500)
    }
  } else {
    // Segredo só existe depois do token do provedor (mesma regra da RPC antiga).
    const { data: atualizadas, error } = await supabase
      .from('barracas_pagamento_token')
      .update({ segredo_webhook: null, segredo_webhook_cifrado: cifrado.valor, ...meta })
      .eq('barraca_id', barracaId)
      .eq('provedor', provedor)
      .select('barraca_id')
    if (error) {
      console.error('salvar-credencial: gravar segredo', error.message)
      return json({ erro: MSG_SALVAR_FALHA }, 500)
    }
    if (!Array.isArray(atualizadas) || atualizadas.length === 0) {
      return json({ erro: 'Salve o token do provedor antes do segredo.' }, 409)
    }
  }

  return json({ ok: true })
}
