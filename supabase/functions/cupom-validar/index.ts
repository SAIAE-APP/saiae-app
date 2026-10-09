// Valida um cupom para a tela do cardápio (SÓ CONSULTA: não reserva nada). Endpoint PÚBLICO, sem JWT.
// O cliente manda o código e os itens; o subtotal sai do resolver_carrinho (preço nunca vem do cliente) e
// o desconto sai da regra do banco (cupom_avaliar). Tentativas inválidas são limitadas por IP e por loja.
//   supabase functions deploy cupom-validar --no-verify-jwt --project-ref <ref>
// Segredo: CLIENTE_HASH_PEPPER (identifica o cliente pela sessão, quando houver).
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { buscarBarracaPorSlug } from '../_shared/resolverSlug.ts'
import { hashIp, ipDoCliente } from '../_shared/antiabuso.ts'
import { interpretarResolver, montarLinhas, respostaDeErros } from '../_shared/carrinho.ts'
import { autenticarSessao } from '../_shared/clienteSessao.ts'
import { interpretarAvaliacao, mensagemDoErro, normalizarCodigo } from '../_shared/cupom.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const MAX_LINHAS = 30

function json(corpo: unknown, status = 200) {
  return new Response(JSON.stringify(corpo), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ erro: 'Método não permitido' }, 405)

  let body: { barraca_slug?: string; codigo?: string; itens?: unknown; sessao_token?: string; website?: string }
  try {
    body = await req.json()
  } catch {
    return json({ erro: 'JSON inválido' }, 400)
  }
  // Robô: resposta de cupom inválido, sem consultar nada.
  if (body.website) return json({ ok: false, erro: 'invalido', mensagem: mensagemDoErro('invalido') })

  const slug = String(body.barraca_slug ?? '').trim().toLowerCase().slice(0, 80)
  const codigo = normalizarCodigo(body.codigo)
  if (!slug) return json({ erro: 'Loja inválida' }, 400)

  const montada = montarLinhas(body.itens, { maxLinhas: MAX_LINHAS, maxQuantidade: null })
  if (!montada.ok) return json({ erro: montada.erro }, 400)

  const pimenta = Deno.env.get('CLIENTE_HASH_PEPPER') ?? ''
  const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '')

  const barraca = await buscarBarracaPorSlug<{ id: string; cupons_habilitado: boolean | null }>(supabase, slug, 'id, cupons_habilitado')
  if (!barraca) return json({ erro: 'Loja não encontrada' }, 404)
  const ipHash = await hashIp('cupom-validar', ipDoCliente(req), barraca.id)

  // Subtotal SEMPRE do banco (itens + adicionais), nunca do cliente.
  const { data: dadosResolver, error: erroResolver } = await supabase.rpc('resolver_carrinho', {
    p_barraca_id: barraca.id,
    p_linhas: montada.linhas,
  })
  const resolvido = erroResolver ? null : interpretarResolver(dadosResolver)
  if (!resolvido) {
    console.error('cupom-validar: falha em resolver_carrinho')
    return json({ erro: 'Falha ao carregar o cardápio' }, 500)
  }
  if (!resolvido.ok) {
    const { status, erro } = respostaDeErros(resolvido.erros)
    return json({ erro }, status)
  }
  const subtotal = resolvido.total_centavos

  const sessao = pimenta && body.sessao_token ? await autenticarSessao(supabase, pimenta, barraca.id, body.sessao_token) : null

  // Loja sem cupons e código malformado respondem igual a "inválido" (e contam como tentativa inválida).
  let avaliacao: ReturnType<typeof interpretarAvaliacao> = { ok: false, erro: 'invalido' }
  if (barraca.cupons_habilitado && codigo) {
    const { data, error } = await supabase.rpc('cupom_avaliar', {
      p_barraca_id: barraca.id,
      p_codigo: codigo,
      p_subtotal_centavos: subtotal,
      p_cliente_id: sessao?.cliente_id ?? null,
    })
    if (error) {
      console.error('cupom-validar: falha em cupom_avaliar')
      return json({ erro: 'Não foi possível validar agora. Tente de novo.' }, 500)
    }
    avaliacao = interpretarAvaliacao(data)
  }

  // Adivinhar código: só tentativa INVÁLIDA conta; passou do limite => 429 (mesmo que o palpite estivesse certo).
  const dentroDoLimite = await supabase.rpc('cupom_registrar_tentativa', {
    p_barraca_id: barraca.id,
    p_ip_hash: ipHash,
    p_valida: avaliacao.ok,
  })
  if (dentroDoLimite.error) {
    console.error('cupom-validar: falha ao registrar tentativa')
    return json({ erro: 'Não foi possível validar agora. Tente de novo.' }, 500)
  }
  if (dentroDoLimite.data === false) {
    return json({ ok: false, erro: 'muitas_tentativas', mensagem: 'Muitas tentativas. Tente de novo em alguns minutos.' }, 429)
  }

  if (!avaliacao.ok) {
    return json({ ok: false, erro: avaliacao.erro, mensagem: mensagemDoErro(avaliacao.erro, avaliacao.minimo_centavos) })
  }
  return json({
    ok: true,
    codigo: avaliacao.codigo,
    desconto_centavos: avaliacao.desconto_centavos,
    subtotal_centavos: subtotal,
    total_itens_centavos: subtotal - avaliacao.desconto_centavos,
  })
})
