// Apaga de vez as barracas arquivadas há mais de 30 dias: Storage (cardapio-fotos e logo-barraca) e depois os
// dados (RPC apagar_dados_barraca). Acionada por pg_cron (disparar_worker_apagar_barracas) com o cabeçalho
// x-worker-secret = secret APAGAR_BARRACAS_SECRET da function. Nunca chamada pelo navegador.
//
// Deploy: sem JWT (a autenticação é o x-worker-secret):
//   supabase functions deploy apagar-barracas-arquivadas --no-verify-jwt --project-ref <ref>
//   supabase secrets set APAGAR_BARRACAS_SECRET=<mesmo valor de app_config 'apagar_barracas_secret'> --project-ref <ref>
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { apagarBarracasArquivadas, segredoAutorizado } from '../_shared/apagarBarracasArquivadas.ts'

function json(corpo: unknown, status = 200): Response {
  return new Response(JSON.stringify(corpo), { status, headers: { 'Content-Type': 'application/json' } })
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ erro: 'método' }, 405)
  if (!segredoAutorizado(req.headers.get('x-worker-secret'), Deno.env.get('APAGAR_BARRACAS_SECRET'))) {
    return json({ erro: 'não autorizado' }, 401)
  }

  const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '')
  try {
    const resultado = await apagarBarracasArquivadas({
      listarBarracas: async () => {
        const { data, error } = await supabase.rpc('barracas_para_apagar')
        if (error) throw new Error(error.message)
        return ((data ?? []) as { barraca_id: string }[]).map((l) => l.barraca_id)
      },
      listarPasta: async (bucket, pasta, limite) => {
        const { data, error } = await supabase.storage.from(bucket).list(pasta, { limit: limite })
        if (error) throw new Error(error.message)
        // Subpasta (ex.: banners/) vem sem id.
        return (data ?? []).map((a) => ({ nome: a.name, pasta: a.id === null }))
      },
      removerArquivos: async (bucket, caminhos) => {
        const { error } = await supabase.storage.from(bucket).remove(caminhos)
        if (error) throw new Error(error.message)
      },
      apagarDados: async (barracaId) => {
        const { error } = await supabase.rpc('apagar_dados_barraca', { p_barraca_id: barracaId })
        if (error) throw new Error(error.message)
      },
      registrarErro: (mensagem, barracaId, erro) =>
        console.error(mensagem, barracaId, erro instanceof Error ? erro.message : String(erro)),
    })
    return json(resultado)
  } catch (erro) {
    console.error('apagar-barracas-arquivadas: listar barracas', erro instanceof Error ? erro.message : String(erro))
    return json({ erro: 'listar' }, 500)
  }
})
