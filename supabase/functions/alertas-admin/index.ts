// Job periódico: manda por e-mail (Resend) os alertas do painel do superadmin que ainda não foram avisados hoje.
// Chamado por um agendador (a cada 15 min) com o segredo do job no cabeçalho Authorization: Bearer <segredo>;
// sem o segredo configurado a rota não existe. Os alertas vêm de `alertas_sistema()` (só a chave de serviço executa).
// Segredos: ALERTAS_ADMIN_SEGREDO (do job), RESEND_API_KEY e ALERTAS_ADMIN_EMAIL_DESTINO.
//   supabase functions deploy alertas-admin --no-verify-jwt --project-ref <ref>
// Cada aviso entra em `alertas_enviados` (uma chave por problema e dia) antes do envio; se o envio falha, a chave sai
// de novo, então a próxima rodada tenta outra vez.
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { segredosIguais } from '../_shared/eventosSaida.ts'
import { assuntoDoAlerta, corpoDoAlerta, itensDeAlerta, type AlertasSistema } from '../_shared/alertasAdmin.ts'

const EMAIL_DE = 'Sai aê <bugs@saiae.com.br>'

const json = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { 'Content-Type': 'application/json' } })

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return new Response(null, { status: 405 })
  const segredo = Deno.env.get('ALERTAS_ADMIN_SEGREDO')
  if (!segredo) return new Response(null, { status: 503 })
  const enviado = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!enviado || !segredosIguais(enviado, segredo)) return new Response(null, { status: 401 })

  const resendApiKey = Deno.env.get('RESEND_API_KEY')
  const destino = Deno.env.get('ALERTAS_ADMIN_EMAIL_DESTINO')
  if (!resendApiKey || !destino) return json({ erro: 'faltam RESEND_API_KEY/ALERTAS_ADMIN_EMAIL_DESTINO' }, 503)

  const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '')
  const { data, error } = await supabase.rpc('alertas_sistema')
  if (error || !data) return json({ erro: 'não consegui ler os alertas' }, 502)

  const dia = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
  const itens = itensDeAlerta(data as AlertasSistema, dia)
  if (itens.length === 0) return json({ ok: true, enviados: 0 })

  // upsert com ignoreDuplicates devolve só as linhas que entraram agora: as outras já foram avisadas hoje.
  const { data: novas, error: erroMarca } = await supabase
    .from('alertas_enviados')
    .upsert(itens.map((i) => ({ chave: i.chave })), { onConflict: 'chave', ignoreDuplicates: true })
    .select('chave')
  if (erroMarca) return json({ erro: 'não consegui registrar os avisos' }, 502)
  const chavesNovas = new Set((novas ?? []).map((n: { chave: string }) => n.chave))
  const aEnviar = itens.filter((i) => chavesNovas.has(i.chave))
  if (aEnviar.length === 0) return json({ ok: true, enviados: 0 })

  let ok: boolean
  try {
    const resposta = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${resendApiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: EMAIL_DE, to: [destino], subject: assuntoDoAlerta(aEnviar.length), text: corpoDoAlerta(aEnviar) }),
    })
    ok = resposta.ok
  } catch {
    ok = false
  }
  if (!ok) {
    await supabase.from('alertas_enviados').delete().in('chave', aEnviar.map((i) => i.chave))
    return json({ erro: 'falha ao enviar o e-mail' }, 502)
  }
  return json({ ok: true, enviados: aEnviar.length })
})
