// Disparos de WhatsApp da loja (campanhas "reativar quem sumiu" e "promoção do dia" + avaliação). Chamada pelo app com o
// login: confere o vínculo, o módulo pago (barracas.whatsapp_disparos_habilitado) e o papel, calcula o público no banco
// e repassa ao CRM (contrato v1: docs/contrato/v1/whatsapp-disparos.md). Enviar e cancelar são só do dono.
// Nunca devolve telefones nem erro cru do CRM ao navegador.
// Segredos: WHATSAPP_CONEXAO_SEGREDO (= COMANDA_WHATSAPP_SEGREDO do CRM); CRM_WHATSAPP_DISPAROS_URL, ou
// CRM_WHATSAPP_CONEXAO_URL (a URL de disparos é derivada trocando o final `whatsapp-conexao` por `whatsapp-disparos`).
//   supabase functions deploy whatsapp-disparos --project-ref <ref>   (com JWT: quem chama é o usuário logado)
import { createClient } from 'jsr:@supabase/supabase-js@2'
import {
  type AcaoDisparo,
  type CorpoCrm,
  chamarDisparosCrm,
  MAX_DESTINATARIOS,
  montarDestinatarios,
  podeDisparar,
  requestIdValido,
  urlDisparos,
  validarEnvio,
  validarPublico,
} from '../_shared/disparosCrm.ts'
import { primeiroSegredo } from '../_shared/integracaoV1.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ACOES: readonly string[] = ['previa', 'enviar', 'historico', 'cancelar']

// Histórico em cache curto por loja: o polling das telas não consome o limite de 30 chamadas/min do CRM, e o cancelar
// nunca fica refém do 429. Vale por instância da function (best effort); enviar e cancelar limpam.
const CACHE_HISTORICO_MS = 10_000
const cacheHistorico = new Map<string, { em: number; dados: unknown }>()

function json(corpo: unknown, status = 200) {
  return new Response(JSON.stringify(corpo), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ erro: 'Método não permitido' }, 405)

  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  const supabaseAuth = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_ANON_KEY') ?? '')
  const { data: usuario, error: erroUsuario } = await supabaseAuth.auth.getUser(jwt)
  if (erroUsuario || !usuario?.user) return json({ erro: 'Não autenticado' }, 401)

  let corpo: Record<string, unknown>
  try {
    corpo = await req.json()
  } catch {
    return json({ erro: 'JSON inválido' }, 400)
  }
  if (typeof corpo !== 'object' || corpo === null) return json({ erro: 'JSON inválido' }, 400)
  const barracaId = typeof corpo.barraca_id === 'string' ? corpo.barraca_id : ''
  if (!UUID.test(barracaId)) return json({ erro: 'Loja inválida' }, 400)
  if (typeof corpo.acao !== 'string' || !ACOES.includes(corpo.acao)) return json({ erro: 'Ação inválida' }, 400)
  const acao = corpo.acao as AcaoDisparo

  const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '')
  // Sem vínculo: 403 genérico, sem dizer se a loja existe.
  const { data: vinculo } = await supabase
    .from('usuarios_barracas')
    .select('papel')
    .eq('usuario_id', usuario.user.id)
    .eq('barraca_id', barracaId)
    .maybeSingle()
  if (!vinculo) return json({ erro: 'Sem acesso a esta loja' }, 403)
  if (!podeDisparar(acao, vinculo.papel ?? null)) return json({ erro: 'sem_permissao' }, 403)

  const { data: barraca } = await supabase
    .from('barracas')
    .select('nome, whatsapp_disparos_habilitado')
    .eq('id', barracaId)
    .maybeSingle()
  if (!barraca?.whatsapp_disparos_habilitado) return json({ erro: 'modulo_desligado' }, 403)

  // Valida a entrada antes de qualquer consulta pesada ou chamada ao CRM.
  let publico: ReturnType<typeof validarPublico> = null
  let envio: ReturnType<typeof validarEnvio> = null
  let campanhaId = ''
  if (acao === 'previa') publico = validarPublico(corpo)
  if (acao === 'enviar') envio = validarEnvio(corpo)
  if ((acao === 'previa' && !publico) || (acao === 'enviar' && !envio)) return json({ erro: 'Dados inválidos' }, 400)
  // Identificador da intenção de envio, gerado pelo navegador: reenviar a mesma intenção não duplica a campanha.
  const requestId = acao === 'enviar' ? corpo.request_id : crypto.randomUUID()
  if (!requestIdValido(requestId)) return json({ erro: 'Dados inválidos' }, 400)
  if (acao === 'cancelar') {
    campanhaId = typeof corpo.campanha_id === 'string' ? corpo.campanha_id : ''
    if (campanhaId.length < 1 || campanhaId.length > 40) return json({ erro: 'Dados inválidos' }, 400)
  }

  if (acao === 'previa' && publico) {
    const { data, error } = await supabase.rpc('disparos_publico_contagem', {
      p_barraca_id: barracaId,
      p_tipo: publico.tipo,
      p_dias: publico.dias,
    })
    if (error || typeof data !== 'number') {
      console.error('whatsapp-disparos: falha na contagem')
      return json({ erro: 'Público indisponível' }, 500)
    }
    return json({ ok: true, total: data, enviaveis: Math.min(data, MAX_DESTINATARIOS) })
  }

  if (acao === 'historico') {
    const guardado = cacheHistorico.get(barracaId)
    if (guardado && Date.now() - guardado.em < CACHE_HISTORICO_MS) return json(guardado.dados)
  }

  let corpoCrm: CorpoCrm
  if (acao === 'enviar' && envio) {
    const { data, error } = await supabase.rpc('disparos_publico', {
      p_barraca_id: barracaId,
      p_tipo: envio.tipo,
      p_dias: envio.dias,
    })
    if (error || !Array.isArray(data)) {
      console.error('whatsapp-disparos: falha ao montar o público')
      return json({ erro: 'Público indisponível' }, 500)
    }
    const destinatarios = montarDestinatarios(data as { telefone: string | null; nome: string | null }[])
    if (destinatarios.length === 0) return json({ ok: false, motivo: 'sem_publico' })
    corpoCrm = { acao: 'criar', tipo: envio.tipo, texto: envio.texto, barraca_nome: String(barraca.nome ?? '').slice(0, 80) || 'Loja', destinatarios }
  } else if (acao === 'cancelar') {
    corpoCrm = { acao: 'cancelar', campanha_id: campanhaId }
  } else {
    corpoCrm = { acao: 'historico' }
  }

  const url = urlDisparos({ disparos: Deno.env.get('CRM_WHATSAPP_DISPAROS_URL'), conexao: Deno.env.get('CRM_WHATSAPP_CONEXAO_URL') })
  const segredo = primeiroSegredo(Deno.env.get('WHATSAPP_CONEXAO_SEGREDO'))
  const r =
    url && segredo.length >= 16
      ? await chamarDisparosCrm({ url, segredo, barracaId, requestId, corpo: corpoCrm })
      : null
  if (!r || !r.ok) {
    console.error('whatsapp-disparos: CRM indisponível')
    return json({ erro: 'Conexão indisponível' }, 502)
  }
  const dados = r.dados as Record<string, unknown>
  if (acao === 'enviar') {
    cacheHistorico.delete(barracaId)
    return dados.ok === true
      ? json({ ok: true, campanha_id: dados.campanha_id, total: dados.total, repetido: dados.repetido === true })
      : json({ ok: false, motivo: dados.motivo })
  }
  if (acao === 'cancelar') cacheHistorico.delete(barracaId)
  if (acao === 'historico') cacheHistorico.set(barracaId, { em: Date.now(), dados })
  return json(dados)
})
