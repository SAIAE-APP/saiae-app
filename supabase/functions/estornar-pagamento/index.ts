// Estorno TOTAL do pedido pago online, disparado pelo dono ao cancelar no Histórico. Exige o JWT do dono da barraca
// do pedido; corpo { pedido_id }. Resposta { ok: true } (com codigo 'ja_estornado' na repetição) ou
// { erro, codigo? }. As regras ficam em _shared/pagamento/estorno.ts; aqui só a ligação com banco e provedor.
// O pedido NÃO é cancelado aqui: o app cancela pelo caminho de sempre depois do { ok: true }.
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { estornarPedido } from '../_shared/pagamento/estorno.ts'
import { obterProvedor } from '../_shared/pagamento/registro.ts'
import { buscarTokenDoProvedor, obterTokenVendedor } from '../_shared/pagamento/token.ts'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function json(corpo: unknown, status = 200) {
  return new Response(JSON.stringify(corpo), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ erro: 'Método não permitido' }, 405)

  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!jwt) return json({ erro: 'Não autenticado' }, 401)

  let pedidoId: string
  try {
    const corpo = (await req.json()) as { pedido_id?: unknown }
    pedidoId = typeof corpo.pedido_id === 'string' ? corpo.pedido_id : ''
  } catch {
    return json({ erro: 'JSON inválido' }, 400)
  }
  if (!UUID.test(pedidoId)) return json({ erro: 'Pedido inválido' }, 400)

  const supabaseAuth = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_ANON_KEY') ?? '')
  const { data: sessao, error: erroSessao } = await supabaseAuth.auth.getUser(jwt)
  if (erroSessao || !sessao?.user) return json({ erro: 'Não autenticado' }, 401)
  const usuarioId = sessao.user.id

  const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '')

  // Erro de banco vira exceção: cai no catch abaixo com resposta genérica.
  const exigir = <T>(r: { data: T; error: { message: string } | null }): T => {
    if (r.error) throw new Error(r.error.message)
    return r.data
  }

  try {
    const resposta = await estornarPedido(pedidoId, {
      barracaDoPedido: async (id) =>
        (exigir(await supabase.from('pedidos').select('barraca_id').eq('id', id).maybeSingle()) as { barraca_id: string } | null)
          ?.barraca_id ?? null,
      // A service role ignora RLS: a checagem de dono é explícita.
      ehDono: async (barracaId) =>
        !!exigir(
          await supabase
            .from('usuarios_barracas')
            .select('usuario_id')
            .eq('usuario_id', usuarioId)
            .eq('barraca_id', barracaId)
            .eq('papel', 'dono')
            .maybeSingle(),
        ),
      pendentesDoPedido: async (id, barracaId) =>
        (exigir(
          await supabase
            .from('pagamentos_pendentes')
            .select('id, status, mercadopago_order_id, provedor, taxa_plataforma_centavos, estornado_em')
            .eq('pedido_id', id)
            .eq('barraca_id', barracaId),
        ) ?? []) as Record<string, unknown>[],
      vendedor: (barracaId) => obterTokenVendedor(supabase, barracaId, Deno.env),
      colado: (barracaId, provedor) => buscarTokenDoProvedor(supabase, barracaId, provedor, Deno.env),
      provedor: obterProvedor,
      marcarEstornado: async (pendenteId) => {
        const { error } = await supabase
          .from('pagamentos_pendentes')
          .update({ estornado_em: new Date().toISOString() }).eq('id', pendenteId).is('estornado_em', null)
        if (error) console.error('estornar-pagamento: falha ao gravar o estorno', error.message)
        return !error
      },
      // Estorno total reverte o crédito (até o saldo atual) e devolve o saldo usado. Idempotente no banco; erro só em log.
      aposEstorno: async (id) => {
        const { error } = await supabase.rpc('cashback_estornar_pedido', { p_pedido_id: id })
        if (error) console.error('estornar-pagamento: cashback não revertido', error.message)
      },
    })
    return json(resposta.corpo, resposta.status)
  } catch (e) {
    console.error('estornar-pagamento: falha inesperada', e instanceof Error ? e.message : 'erro')
    return json({ erro: 'Não foi possível estornar agora. Tente de novo.' }, 500)
  }
})
