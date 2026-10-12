// "Reportar bug" (CLAUDE.md, pedido de produto 2026-09-27): envia um
// e-mail pro time do Sai aê via Resend API quando o usuário aciona o
// formulário em Ajustes > Ajuda e suporte (SecaoAjudaSuporte). Recebe
// { descricao, esperado?, barraca_nome, barraca_slug, user_agent } e o
// contexto de quem reportou vem do JWT (usuário autenticado), nunca do
// body — não dá pra confiar em e-mail que o client mandasse solto.
//
// Precisa de RESEND_API_KEY e BUG_REPORT_EMAIL_DESTINO configurados como
// secret da function (`supabase secrets set ...`) — sem isso, responde
// 500 com uma mensagem clara em vez de falhar silenciosamente. Nenhum dos
// dois é aplicado por esta função; é o dono do produto que roda/aprova
// (mesmo padrão de sempre pra secret de produção).
import { createClient } from 'jsr:@supabase/supabase-js@2'
import {
  LIMITE_RELATOS_POR_HORA,
  TIPO_LIMITE_BUG,
  assuntoDoRelato,
  corpoDoRelato,
  normalizarRelato,
} from '../_shared/reportarBug.ts'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  })
}

// Domínio já verificado no Resend (mesmo usado no SMTP do Supabase Auth
// pro e-mail de confirmação de cadastro) — ajuste aqui se o domínio de
// envio mudar; não é secret porque não é sensível, só configuração.
const EMAIL_DE = 'Sai aê <bugs@saiae.com.br>'

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS })
  }

  let relato: ReturnType<typeof normalizarRelato>

  try {
    // Limites de tamanho (auditoria M4): descrição 4000, esperado 2000, demais campos curtos.
    relato = normalizarRelato(await req.json())
  } catch {
    return jsonResponse({ erro: 'JSON inválido' }, 400)
  }

  if (!relato.descricao) {
    return jsonResponse({ erro: 'Descrição é obrigatória' }, 400)
  }

  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  const supabaseAuth = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
  )
  const { data: userData, error: erroUser } = await supabaseAuth.auth.getUser(jwt)
  if (erroUser || !userData?.user) {
    return jsonResponse({ erro: 'Não autenticado' }, 401)
  }

  // Limite por usuário/hora (mesmo limitador do consultar-externo): o cadastro é aberto, então sem isso qualquer
  // conta dispara e-mails sem fim para o time, pelo remetente do domínio.
  const admin = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '')
  const { data: cabe, error: erroLimite } = await admin.rpc('consulta_externa_registrar', {
    p_usuario_id: userData.user.id,
    p_tipo: TIPO_LIMITE_BUG,
    p_limite: LIMITE_RELATOS_POR_HORA,
  })
  if (erroLimite) return jsonResponse({ erro: 'Não foi possível enviar agora. Tente de novo em instantes.' }, 503)
  if (cabe !== true) return jsonResponse({ erro: 'Muitos relatos em pouco tempo. Tente mais tarde.' }, 429)

  const resendApiKey = Deno.env.get('RESEND_API_KEY')
  const emailDestino = Deno.env.get('BUG_REPORT_EMAIL_DESTINO')
  if (!resendApiKey || !emailDestino) {
    return jsonResponse(
      { erro: 'Reportar bug ainda não está configurado — faltam secrets de infra (RESEND_API_KEY/BUG_REPORT_EMAIL_DESTINO).' },
      500,
    )
  }

  const usuarioEmail = userData.user.email ?? 'sem e-mail cadastrado'
  let respostaResend: Response
  try {
    respostaResend = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: EMAIL_DE,
        to: [emailDestino],
        reply_to: usuarioEmail,
        subject: assuntoDoRelato(userData.user.id),
        text: corpoDoRelato(usuarioEmail, relato),
      }),
    })
  } catch (erroRede) {
    return jsonResponse({ erro: `Falha ao contatar o Resend: ${String(erroRede)}` }, 502)
  }

  if (!respostaResend.ok) {
    const detalhe = await respostaResend.json().catch(() => null)
    return jsonResponse({ erro: detalhe?.message ?? 'Falha ao enviar o e-mail' }, 502)
  }

  return jsonResponse({ ok: true })
})
