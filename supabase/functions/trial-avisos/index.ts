// Job periódico: manda os avisos do ciclo de vida do trial (dono e suporte) que ainda não saíram. Chamado por um
// agendador (de hora em hora) com o segredo do job em Authorization: Bearer <segredo>; sem o segredo configurado a
// rota não existe. Quem precisa de qual aviso vem de `trial_avisos_pendentes()` (só a chave de serviço executa).
// Segredos: TRIAL_AVISOS_SEGREDO (do job), RESEND_API_KEY e ALERTAS_ADMIN_EMAIL_DESTINO (avisos ao suporte).
//   supabase functions deploy trial-avisos --no-verify-jwt --project-ref <ref>
// Cada (usuário, etapa) é reservado em `trial_avisos_enviados` ANTES do envio; se o envio falha, a reserva sai e a
// próxima rodada tenta de novo. Assim duas rodadas ao mesmo tempo nunca mandam o mesmo aviso duas vezes.
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { segredosIguais } from '../_shared/eventosSaida.ts'
import { emailDoDono, emailDoSuporte, type AvisoTrial } from '../_shared/trialAvisos.ts'

const EMAIL_DE = 'Sai aê <bugs@saiae.com.br>'

const json = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { 'Content-Type': 'application/json' } })

async function enviar(chave: string, para: string, assunto: string, texto: string): Promise<boolean> {
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${chave}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: EMAIL_DE, to: [para], subject: assunto, text: texto }),
    })
    return r.ok
  } catch {
    return false
  }
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return new Response(null, { status: 405 })
  const segredo = Deno.env.get('TRIAL_AVISOS_SEGREDO')
  if (!segredo) return new Response(null, { status: 503 })
  const enviado = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!enviado || !segredosIguais(enviado, segredo)) return new Response(null, { status: 401 })

  const resendApiKey = Deno.env.get('RESEND_API_KEY')
  const suporte = Deno.env.get('ALERTAS_ADMIN_EMAIL_DESTINO')
  if (!resendApiKey) return json({ erro: 'falta RESEND_API_KEY' }, 503)

  const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '')
  const { data, error } = await supabase.rpc('trial_avisos_pendentes')
  if (error || !data) return json({ erro: 'não consegui ler os avisos pendentes' }, 502)
  const avisos = data as AvisoTrial[]

  // Reserva primeiro: só quem entrou agora na tabela é avisado por esta rodada.
  const reservar = async (lista: AvisoTrial[]): Promise<AvisoTrial[]> => {
    if (lista.length === 0) return []
    const { data: novas, error: erroReserva } = await supabase
      .from('trial_avisos_enviados')
      .upsert(lista.map((a) => ({ usuario_id: a.usuario_id, etapa: a.etapa })), {
        onConflict: 'usuario_id,etapa',
        ignoreDuplicates: true,
      })
      .select('usuario_id, etapa')
    if (erroReserva) return []
    const chaves = new Set((novas ?? []).map((n: { usuario_id: string; etapa: string }) => `${n.usuario_id}:${n.etapa}`))
    return lista.filter((a) => chaves.has(`${a.usuario_id}:${a.etapa}`))
  }
  const liberar = (a: AvisoTrial) =>
    supabase.from('trial_avisos_enviados').delete().eq('usuario_id', a.usuario_id).eq('etapa', a.etapa)

  let enviados = 0
  let falhas = 0

  for (const a of await reservar(avisos.filter((x) => x.destino === 'dono' && !!x.email))) {
    const { assunto, texto } = emailDoDono(a)
    if (await enviar(resendApiKey, a.email, assunto, texto)) enviados += 1
    else {
      falhas += 1
      await liberar(a)
    }
  }

  if (suporte) {
    const paraSuporte = await reservar(avisos.filter((x) => x.destino === 'suporte'))
    if (paraSuporte.length > 0) {
      const { assunto, texto } = emailDoSuporte(paraSuporte)
      if (await enviar(resendApiKey, suporte, assunto, texto)) enviados += 1
      else {
        falhas += 1
        for (const a of paraSuporte) await liberar(a)
      }
    }
  }

  return json({ ok: true, enviados, falhas })
})
