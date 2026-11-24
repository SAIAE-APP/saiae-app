// Baixar nota: devolve o XML autorizado e o DANFCe (HTML) de uma NFC-e já AUTORIZADA, para o dono enviar ao cliente.
// Recebe { pedido_id }. Mesmo padrão de emitir-nfce: JWT de usuário + acesso à barraca + módulo fiscal + bloqueio de vigência.
// Só lê da FocusNFe (GET /nfce/{ref}); nunca emite nem grava nada.
import { comCors } from '../_shared/cors.ts'
import { configDoEnv, lerSegredo } from '../_shared/segredoCifrado.ts'
import { moduloAtivo } from '../_shared/modulos.ts'

// Origem (sem /v2) de onde a FocusNFe serve os arquivos; a API fica em `${origem}/v2`.
const ORIGEM_HOMOLOGACAO = 'https://homologacao.focusnfe.com.br'
const ORIGEM_PRODUCAO = 'https://api.focusnfe.com.br'
const TAMANHO_MAXIMO_BYTES = 2 * 1024 * 1024

const CORS_HEADERS = {
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  })
}

export type DependenciasBaixarNota = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  criarCliente: (url: string, chave: string) => any
  env: { get: (nome: string) => string | undefined }
  buscar: typeof fetch
}

/** Baixa um arquivo da FocusNFe; null em qualquer falha (caminho suspeito, HTTP != 2xx, rede, grande demais). */
async function baixarArquivo(
  buscar: typeof fetch,
  origem: string,
  caminho: unknown,
  basic: string,
): Promise<string | null> {
  // Anti-SSRF: só caminho relativo ao host da FocusNFe. "//host" e "\" viram outro host em new URL.
  if (typeof caminho !== 'string' || !caminho.startsWith('/') || caminho.startsWith('//') || caminho.includes('\\')) return null
  let url: URL
  try {
    url = new URL(caminho, origem)
  } catch {
    return null
  }
  if (url.origin !== origem) return null

  async function tentar(comAuth: boolean): Promise<Response | null> {
    return buscar(url.href, comAuth ? { headers: { Authorization: `Basic ${basic}` } } : undefined).catch(() => null)
  }
  // não verificado: se o download dos arquivos exige Basic Auth (tenta com; em 401/403 tenta sem).
  // não verificado: se o host dos arquivos é o mesmo da API (assume a origem da API sem /v2).
  let res = await tentar(true)
  if (res && (res.status === 401 || res.status === 403)) res = await tentar(false)
  if (!res || !res.ok) return null
  const declarado = Number(res.headers.get('content-length') ?? 0)
  if (declarado > TAMANHO_MAXIMO_BYTES) return null
  const texto = await res.text().catch(() => null)
  if (texto === null || new TextEncoder().encode(texto).length > TAMANHO_MAXIMO_BYTES) return null
  return texto
}

function criarHandlerInterno(deps: DependenciasBaixarNota) {
  const createClient = deps.criarCliente
  return async (req: Request): Promise<Response> => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS })

    let pedidoId: string | undefined
    try {
      pedidoId = (await req.json())?.pedido_id
    } catch {
      return jsonResponse({ erro: 'JSON inválido' }, 400)
    }
    if (!pedidoId || typeof pedidoId !== 'string') return jsonResponse({ erro: 'pedido_id é obrigatório' }, 400)

    const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
    const supabaseAuth = createClient(deps.env.get('SUPABASE_URL') ?? '', deps.env.get('SUPABASE_ANON_KEY') ?? '')
    const { data: userData, error: erroUser } = await supabaseAuth.auth.getUser(jwt)
    if (erroUser || !userData?.user) return jsonResponse({ erro: 'Não autenticado' }, 401)

    const supabase = createClient(deps.env.get('SUPABASE_URL') ?? '', deps.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '')

    const { data: pedido, error: erroPedido } = await supabase
      .from('pedidos')
      .select('id, barraca_id, nfce_status, nfce_chave, nfce_numero, nfce_ambiente')
      .eq('id', pedidoId)
      .single()
    if (erroPedido || !pedido) return jsonResponse({ erro: 'Pedido não encontrado' }, 404)

    // Mesma regra do emitir-nfce: quem tem acesso à barraca do pedido.
    const { data: acesso } = await supabase
      .from('usuarios_barracas')
      .select('usuario_id')
      .eq('usuario_id', userData.user.id)
      .eq('barraca_id', pedido.barraca_id)
      .maybeSingle()
    if (!acesso) return jsonResponse({ erro: 'Sem acesso a esta barraca' }, 403)

    if (pedido.nfce_status !== 'autorizado') {
      return jsonResponse({ erro: 'Só dá para baixar uma nota já autorizada.' }, 422)
    }

    const { data: barraca, error: erroBarraca } = await supabase
      .from('barracas')
      .select('id, fiscal_ambiente')
      .eq('id', pedido.barraca_id)
      .single()
    if (erroBarraca || !barraca) return jsonResponse({ erro: 'Barraca não encontrada' }, 404)

    if (!(await moduloAtivo(supabase, barraca.id, 'fiscal'))) return jsonResponse({ erro: 'modulo_desligado' }, 403)

    const { data: bloqueio, error: erroBloqueio } = await supabase.rpc('fiscal_emissao_bloqueio', { p_barraca_id: barraca.id })
    if (erroBloqueio) {
      console.error('baixar-nota-fiscal: fiscal_emissao_bloqueio', erroBloqueio.message)
      return jsonResponse({ erro: 'Não foi possível conferir a vigência do módulo Fiscal agora. Tente de novo em instantes.' }, 503)
    }
    if (typeof bloqueio === 'string' && bloqueio) {
      return jsonResponse(
        {
          erro: bloqueio,
          mensagem:
            bloqueio === 'cnpj_divergente'
              ? 'O CNPJ da barraca é diferente do CNPJ contratado no módulo Fiscal. Volte ao CNPJ contratado ou fale com o suporte.'
              : 'A assinatura do Sai aê não está ativa e em dia, então o módulo Fiscal está suspenso. Regularize a assinatura para voltar a baixar notas.',
        },
        403,
      )
    }

    // Ambiente GRAVADO na nota (a nota vive lá); só nota antiga, sem o campo, cai no ambiente atual da barraca.
    const producao = (pedido.nfce_ambiente ?? barraca.fiscal_ambiente) === 'producao'
    const colunaToken = producao ? 'token_producao' : 'token_homologacao'
    const origem = producao ? ORIGEM_PRODUCAO : ORIGEM_HOMOLOGACAO

    const { data: tokenRow, error: erroToken } = await supabase
      .from('barracas_fiscal_token')
      .select('*')
      .eq('barraca_id', barraca.id)
      .maybeSingle()
    const linhaToken = (tokenRow ?? {}) as Record<string, unknown>
    const token = erroToken
      ? null
      : (
          await lerSegredo(
            { texto: linhaToken[colunaToken], cifrado: linhaToken[`${colunaToken}_cifrado`] },
            { barracaId: barraca.id, campo: colunaToken },
            configDoEnv(deps.env),
          )
        ).valor
    if (erroToken || !token) {
      return jsonResponse({ erro: `Token de ${producao ? 'produção' : 'homologação'} não configurado` }, 422)
    }
    const basic = btoa(`${token}:`)

    const resConsulta = await deps
      .buscar(`${origem}/v2/nfce/${encodeURIComponent(pedidoId)}`, { headers: { Authorization: `Basic ${basic}` } })
      .catch(() => null)
    const nota = resConsulta?.ok ? ((await resConsulta.json().catch(() => null)) as Record<string, unknown> | null) : null
    if (!nota) return jsonResponse({ erro: 'Não foi possível consultar a nota agora. Tente de novo em instantes.' }, 502)
    if (nota.status !== 'autorizado') return jsonResponse({ erro: 'A nota ainda não está autorizada na FocusNFe.' }, 422)

    const xml = await baixarArquivo(deps.buscar, origem, nota.caminho_xml_nota_fiscal, basic)
    if (xml === null) return jsonResponse({ erro: 'Não foi possível baixar o XML da nota agora. Tente de novo em instantes.' }, 502)
    // O DANFCe é opcional: sem ele o dono ainda leva o XML.
    const danfceHtml = await baixarArquivo(deps.buscar, origem, nota.caminho_danfe, basic)

    const chave = String(pedido.nfce_chave ?? nota.chave_nfe ?? '')
    const numero = String(pedido.nfce_numero ?? nota.numero ?? '')
    const nomeBase = `nfce-${numero}-${chave.slice(-8)}`.replace(/[^A-Za-z0-9-]/g, '')

    return jsonResponse({ xml, danfce_html: danfceHtml, nome_base: nomeBase })
  }
}

export function criarHandler(deps: DependenciasBaixarNota) {
  const interno = criarHandlerInterno(deps)
  return (req: Request): Promise<Response> => comCors(req, interno(req))
}
