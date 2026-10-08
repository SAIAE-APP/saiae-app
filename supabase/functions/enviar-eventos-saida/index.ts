// Worker do outbox (SAI-013): pega os eventos devidos (RPC reservar_eventos_saida), assina com o
// segredo da barraca e envia ao CRM. 2xx = entregue; qualquer outra resposta ou erro de rede = o
// banco agenda o retry (1 min, 5 min, 30 min, 2 h, 12 h) e, esgotado, manda para a fila de falhas.
//
// Acionada por pg_cron (disparar_worker_eventos) com o cabeçalho x-worker-secret = secret
// EVENTOS_WORKER_SECRET da function. Nunca chamada pelo navegador. Falha aqui NUNCA afeta pedido:
// o pedido já foi gravado antes e o evento fica na fila.
//
// Deploy: sem JWT (a autenticação é o x-worker-secret):
//   supabase functions deploy enviar-eventos-saida --no-verify-jwt --project-ref <ref>
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { cabecalhosDoEvento, segredosIguais, urlPermitida } from '../_shared/eventosSaida.ts'

const LIMITE_POR_RODADA = 20
const RODADAS_MAX = 5
const TIMEOUT_MS = 10_000

type Reservado = { evento_id: string; url: string; segredo: string; corpo: Record<string, unknown> | null }

function json(corpo: unknown, status = 200): Response {
  return new Response(JSON.stringify(corpo), { status, headers: { 'Content-Type': 'application/json' } })
}

async function enviar(ev: Reservado): Promise<{ ok: boolean; erro: string }> {
  if (!ev.corpo) return { ok: false, erro: 'pedido não encontrado' }
  if (!urlPermitida(ev.url)) return { ok: false, erro: 'URL do CRM não permitida (precisa ser https público)' }
  try {
    const corpo = JSON.stringify(ev.corpo)
    const timestamp = Math.floor(Date.now() / 1000)
    const resposta = await fetch(ev.url, {
      method: 'POST',
      headers: await cabecalhosDoEvento(ev.segredo, ev.evento_id, timestamp, corpo),
      body: corpo,
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    await resposta.body?.cancel()
    const ok = resposta.status >= 200 && resposta.status < 300
    return { ok, erro: ok ? '' : `CRM respondeu ${resposta.status}` }
  } catch (e) {
    return { ok: false, erro: `erro de rede: ${e instanceof Error ? e.message : String(e)}`.slice(0, 200) }
  }
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ erro: 'método' }, 405)
  if (!segredosIguais(req.headers.get('x-worker-secret'), Deno.env.get('EVENTOS_WORKER_SECRET'))) {
    return json({ erro: 'não autorizado' }, 401)
  }

  const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '')
  let enviados = 0
  let falhas = 0

  for (let rodada = 0; rodada < RODADAS_MAX; rodada++) {
    const { data, error } = await supabase.rpc('reservar_eventos_saida', { p_limite: LIMITE_POR_RODADA })
    if (error) return json({ erro: 'reservar', detalhe: error.message.slice(0, 200), enviados, falhas }, 500)
    const lote = (data ?? []) as Reservado[]
    if (lote.length === 0) break

    // Um evento por vez: o banco já garante a ordem por pedido e o volume é baixo.
    for (const ev of lote) {
      const { ok, erro } = await enviar(ev)
      const { error: erroConcluir } = await supabase.rpc('concluir_evento_saida', {
        p_evento_id: ev.evento_id,
        p_ok: ok,
        p_erro: ok ? null : erro,
      })
      // Se não deu para registrar, o aluguel de 3 min do banco devolve o evento à fila sozinho.
      if (erroConcluir) console.warn('concluir_evento_saida falhou', erroConcluir.message)
      if (ok) enviados++
      else falhas++
    }
    if (lote.length < LIMITE_POR_RODADA) break
  }

  return json({ ok: true, enviados, falhas })
})
