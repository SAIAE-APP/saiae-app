// Operações do perfil do cliente final, sempre por token de sessão (nunca por id vindo do cliente).
//   supabase functions deploy cliente-sessao --no-verify-jwt --project-ref <ref>
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { autenticarSessao } from '../_shared/clienteSessao.ts'
import { classificarItensPedirDeNovo } from '../_shared/pedirDeNovo.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const MAX_ENDERECOS = 5

function json(corpo: unknown, status = 200) {
  return new Response(JSON.stringify(corpo), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
}
const texto = (v: unknown, max: number) => String(v ?? '').trim().slice(0, max)
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ erro: 'Método não permitido' }, 405)

  let body: { barraca_slug?: string; token?: string; acao?: string; dados?: Record<string, unknown> }
  try {
    body = await req.json()
  } catch {
    return json({ erro: 'JSON inválido' }, 400)
  }

  const pimenta = Deno.env.get('CLIENTE_HASH_PEPPER') ?? ''
  const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '')
  const slug = texto(body.barraca_slug, 80).toLowerCase()
  const { data: barraca } = await supabase.from('barracas').select('id').eq('slug', slug).maybeSingle()
  const sessao = barraca && pimenta ? await autenticarSessao(supabase, pimenta, barraca.id, body.token) : null
  if (!barraca || !sessao) return json({ erro: 'Sessão expirada', codigo: 'sessao_invalida' }, 401)

  const clienteId = sessao.cliente_id
  const d = body.dados ?? {}

  switch (body.acao) {
    case 'perfil': {
      const [{ data: cliente }, { data: enderecos }] = await Promise.all([
        supabase.from('clientes_finais').select('id, nome, telefone, consentimento_marketing_em, aceita_avisos_pedido').eq('id', clienteId).single(),
        supabase.from('cliente_enderecos').select('id, apelido, rua, numero, bairro, referencia, padrao').eq('cliente_id', clienteId).order('padrao', { ascending: false }).order('criado_em'),
      ])
      return json({
        cliente: cliente && { id: cliente.id, nome: cliente.nome, telefone: cliente.telefone, aceita_promocoes: Boolean(cliente.consentimento_marketing_em), aceita_avisos_pedido: cliente.aceita_avisos_pedido },
        enderecos: enderecos ?? [],
      })
    }

    case 'historico': {
      const { data } = await supabase
        .from('pedidos')
        .select('id, senha, status, criado_em, tipo_atendimento, taxa_entrega_centavos, itens_do_pedido(nome_item, quantidade, preco_centavos_unitario, removido)')
        .eq('cliente_id', clienteId)
        .eq('barraca_id', barraca.id)
        .order('criado_em', { ascending: false })
        .limit(20)
      return json({ pedidos: data ?? [] })
    }

    case 'pedir_de_novo': {
      const pedidoId = texto(d.pedido_id, 40)
      if (!UUID.test(pedidoId)) return json({ erro: 'Pedido inválido' }, 400)
      const { data: pedido } = await supabase
        .from('pedidos')
        .select('id, itens_do_pedido(item_id, nome_item, quantidade, preco_centavos_unitario, removido, opcoes)')
        .eq('id', pedidoId)
        .eq('cliente_id', clienteId)
        .maybeSingle()
      if (!pedido) return json({ erro: 'Pedido não encontrado' }, 404)
      const antigos = (pedido.itens_do_pedido ?? []).filter((i: { removido: boolean }) => !i.removido)
      const ids = antigos.map((i: { item_id: string | null }) => i.item_id).filter(Boolean) as string[]
      const { data: atuais } = ids.length
        ? await supabase.from('itens').select('id, nome, ativo, esgotado, preco_centavos').eq('barraca_id', barraca.id).in('id', ids)
        : { data: [] }
      return json({ linhas: classificarItensPedirDeNovo(antigos, atuais ?? []) })
    }

    case 'salvar_perfil': {
      const nome = texto(d.nome, 80)
      if (nome.length < 2) return json({ erro: 'Informe seu nome' }, 422)
      const { data: atual } = await supabase.from('clientes_finais').select('consentimento_marketing_em').eq('id', clienteId).single()
      const aceita = d.aceita_promocoes === true
      const { error } = await supabase
        .from('clientes_finais')
        .update({
          nome,
          aceita_avisos_pedido: d.aceita_avisos_pedido !== false,
          consentimento_marketing_em: aceita ? (atual?.consentimento_marketing_em ?? new Date().toISOString()) : null,
          atualizado_em: new Date().toISOString(),
        })
        .eq('id', clienteId)
      return error ? json({ erro: 'Não foi possível salvar.' }, 500) : json({ ok: true })
    }

    case 'endereco_salvar': {
      const campos = {
        apelido: texto(d.apelido, 30) || 'Casa',
        rua: texto(d.rua, 120),
        numero: texto(d.numero, 20),
        bairro: texto(d.bairro, 80),
        referencia: texto(d.referencia, 120) || null,
      }
      if (!campos.rua || !campos.numero || !campos.bairro) return json({ erro: 'Informe rua, número e bairro.' }, 422)
      const id = texto(d.id, 40)
      if (id) {
        if (!UUID.test(id)) return json({ erro: 'Endereço inválido' }, 400)
        const { error } = await supabase.from('cliente_enderecos').update(campos).eq('id', id).eq('cliente_id', clienteId)
        if (error) return json({ erro: 'Não foi possível salvar.' }, 500)
        return json({ ok: true, id })
      }
      const { count } = await supabase.from('cliente_enderecos').select('id', { count: 'exact', head: true }).eq('cliente_id', clienteId)
      if ((count ?? 0) >= MAX_ENDERECOS) return json({ erro: `Você pode guardar até ${MAX_ENDERECOS} endereços.` }, 422)
      const { data, error } = await supabase
        .from('cliente_enderecos')
        .insert({ ...campos, cliente_id: clienteId, barraca_id: barraca.id, padrao: (count ?? 0) === 0 })
        .select('id')
        .single()
      return error || !data ? json({ erro: 'Não foi possível salvar.' }, 500) : json({ ok: true, id: data.id })
    }

    case 'endereco_padrao': {
      const id = texto(d.id, 40)
      if (!UUID.test(id)) return json({ erro: 'Endereço inválido' }, 400)
      const { data: dele } = await supabase.from('cliente_enderecos').select('id').eq('id', id).eq('cliente_id', clienteId).maybeSingle()
      if (!dele) return json({ erro: 'Endereço não encontrado' }, 404)
      await supabase.from('cliente_enderecos').update({ padrao: false }).eq('cliente_id', clienteId)
      await supabase.from('cliente_enderecos').update({ padrao: true }).eq('id', id)
      return json({ ok: true })
    }

    case 'endereco_excluir': {
      const id = texto(d.id, 40)
      if (!UUID.test(id)) return json({ erro: 'Endereço inválido' }, 400)
      await supabase.from('cliente_enderecos').delete().eq('id', id).eq('cliente_id', clienteId)
      return json({ ok: true })
    }

    case 'sair': {
      await supabase.from('cliente_sessoes').update({ revogada_em: new Date().toISOString() }).eq('id', sessao.sessao_id)
      return json({ ok: true })
    }

    case 'apagar': {
      const { error } = await supabase.rpc('cliente_apagar_dados', { p_cliente_id: clienteId })
      return error ? json({ erro: 'Não foi possível apagar agora. Tente de novo.' }, 500) : json({ ok: true })
    }

    default:
      return json({ erro: 'Ação inválida' }, 400)
  }
})
