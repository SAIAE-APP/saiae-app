// Conexão do WhatsApp da loja com o CRM (aba "WhatsApp e Automação"). Chamada pelo app com o login: confere o vínculo
// com a loja, assina e repassa a ação ao CRM (contrato v1) e devolve { ok, estado, qr, numero, avisos }.
// Iniciar e desconectar são só do dono. Nunca devolve erro cru do CRM.
// Segredos: WHATSAPP_CONEXAO_SEGREDO (= COMANDA_WHATSAPP_SEGREDO do CRM), CRM_WHATSAPP_CONEXAO_URL.
//   supabase functions deploy whatsapp-conexao --project-ref <ref>   (com JWT: quem chama é o usuário logado)
import { type AcaoConexao, chamarConexaoCrm, podeExecutar } from '../_shared/crmConexao.ts'
import { primeiroSegredo } from '../_shared/integracaoV1.ts'
import { moduloAtivo } from '../_shared/modulos.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ACOES: readonly string[] = ['iniciar', 'status', 'desconectar', 'historico']

function json(corpo: unknown, status = 200) {
  return new Response(JSON.stringify(corpo), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
}

// Dependências injetáveis para os testes executarem o handler (mesmo padrão de emitir-nfce/handler.ts). index.ts liga as de verdade.
export type DependenciasHandler = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  criarCliente: (url: string, chave: string) => any
  env: { get: (nome: string) => string | undefined }
}

export const criarHandler = (deps: DependenciasHandler) => async (req: Request): Promise<Response> => {
  const createClient = deps.criarCliente
  const Deno = { env: deps.env }
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ erro: 'Método não permitido' }, 405)

  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  const supabaseAuth = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_ANON_KEY') ?? '')
  const { data: usuario, error: erroUsuario } = await supabaseAuth.auth.getUser(jwt)
  if (erroUsuario || !usuario?.user) return json({ erro: 'Não autenticado' }, 401)

  let corpo: { barraca_id?: unknown; acao?: unknown }
  try {
    corpo = await req.json()
  } catch {
    return json({ erro: 'JSON inválido' }, 400)
  }
  const barracaId = typeof corpo.barraca_id === 'string' ? corpo.barraca_id : ''
  if (!UUID.test(barracaId)) return json({ erro: 'Loja inválida' }, 400)
  if (typeof corpo.acao !== 'string' || !ACOES.includes(corpo.acao)) return json({ erro: 'Ação inválida' }, 400)
  const acao = corpo.acao as AcaoConexao

  const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '')
  // Sem vínculo: 403 genérico, sem dizer se a loja existe.
  const { data: vinculo } = await supabase
    .from('usuarios_barracas')
    .select('papel')
    .eq('usuario_id', usuario.user.id)
    .eq('barraca_id', barracaId)
    .maybeSingle()
  if (!vinculo || !podeExecutar(acao, vinculo.papel ?? null)) return json({ erro: 'Sem acesso a esta loja' }, 403)
  // Só INICIAR exige módulo: com qualquer um dos três de WhatsApp vigente (fail-closed). Status, histórico e desconectar
  // seguem livres para a loja ver e encerrar a própria sessão mesmo com o módulo vencido.
  if (acao === 'iniciar') {
    let vigente = false
    for (const m of ['whatsapp_avisos', 'whatsapp_disparos', 'whatsapp_bot'] as const) {
      if ((vigente = await moduloAtivo(supabase, barracaId, m))) break
    }
    if (!vigente) return json({ erro: 'modulo_desligado' }, 403)
  }

  const url = Deno.env.get('CRM_WHATSAPP_CONEXAO_URL')
  // Lista de rotação: assina com o primeiro, como o resto das rotas de plataforma.
  const segredo = primeiroSegredo(Deno.env.get('WHATSAPP_CONEXAO_SEGREDO'))
  const r =
    url && segredo.length >= 16
      ? await chamarConexaoCrm({ url, segredo, barracaId, acao, requestId: crypto.randomUUID() })
      : null
  if (!r || !r.ok) {
    console.error('whatsapp-conexao: conexão indisponível')
    return json({ erro: 'Conexão indisponível' }, 502)
  }
  return json({ ok: true, ...r.dados })
}
