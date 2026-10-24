// integracao-v1: rota SERVIDOR→SERVIDOR do bot de WhatsApp do CRM (contrato docs/contrato/v1/integracao-v1-bot.md).
// Quatro ações: cardapio, rascunho, pedido e pix. A autenticação é a assinatura HMAC de plataforma
// (WHATSAPP_CONEXAO_SEGREDO, lista separada por vírgula para rotação), conferida ANTES de qualquer consulta ao banco.
// O preço, o nome do item e o total saem SEMPRE do resolver_carrinho; o bot nunca informa valor.
// Nunca registra corpo, telefone, nome, itens nem ids. Deploy sem JWT (a autenticação é a assinatura):
//   supabase functions deploy integracao-v1 --no-verify-jwt --project-ref <ref>
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { interpretarResolver, itensAcimaDoEstoque, type LinhaCarrinho, type LinhaResolvida } from '../_shared/carrinho.ts'
import { minutosExpiracaoPix } from '../_shared/pagamento/expiracao.ts'
import { chaveDoProvedor, obterProvedor, urlNotificacaoPagamento } from '../_shared/pagamento/registro.ts'
import { buscarTokenDoProvedor } from '../_shared/pagamento/token.ts'
import { ErroProvedor, ehProvedorValido } from '../_shared/pagamento/tipos.ts'
import { barracaAbertaAgora, type HorarioDia } from '../_shared/horario.ts'
import { TAMANHO_MAX_CORPO } from '../_shared/iaAssinatura.ts'
import {
  type CorpoIntegracao,
  type LojaCrua,
  haSegredoValido,
  lojaDoBot,
  recusaDaAcao,
  telefoneSemPais,
  totalDoPendente,
  validarCorpoIntegracao,
  verificarAssinaturaLista,
} from '../_shared/integracaoV1.ts'

const URL_APP_PADRAO = 'https://app.saiae.com.br'

type Supabase = ReturnType<typeof createClient>
type Corpo<A extends CorpoIntegracao['acao']> = Extract<CorpoIntegracao, { acao: A }>

/** Falha nossa (banco ou resposta inesperada). Só a etapa vai para o log, nunca valores. */
class FalhaInterna extends Error {}

const json = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { 'Content-Type': 'application/json' } })

const negocio = (codigo: string, mensagem: string) => json({ ok: false, codigo, mensagem })
const barracaInvalida = () => negocio('barraca_invalida', 'Loja não encontrada.')

async function carregarLoja(supabase: Supabase, barracaId: string) {
  const { data: barraca, error } = await supabase.from('barracas').select('*').eq('id', barracaId).maybeSingle()
  if (error) throw new FalhaInterna('barracas')
  if (!barraca) return null
  const { data: horarios, error: erroHorarios } = await supabase
    .from('horarios_funcionamento')
    .select('dia_semana, aberto, hora_abertura, hora_fechamento')
    .eq('barraca_id', barracaId)
  if (erroHorarios) throw new FalhaInterna('horarios')
  return { barraca: barraca as LojaCrua & { estoque_bloqueia?: boolean | null; pagamento_provedor?: string | null; pix_expiracao_minutos?: number | null }, horarios: (horarios ?? []) as HorarioDia[] }
}

/** Preço e total vêm do resolver_carrinho. Erro de carrinho vira resposta de negócio, nunca 500. */
async function resolverCarrinho(supabase: Supabase, barracaId: string, linhas: LinhaCarrinho[]) {
  const { data, error } = await supabase.rpc('resolver_carrinho', { p_barraca_id: barracaId, p_linhas: linhas })
  const r = error ? null : interpretarResolver(data)
  if (!r) throw new FalhaInterna('resolver_carrinho')
  if (r.ok) return { ok: true as const, linhas: r.linhas, total: r.total_centavos }
  if (r.erros.some((e) => e.codigo === 'barraca_invalida')) return { ok: false as const, resposta: barracaInvalida() }
  return {
    ok: false as const,
    resposta: json({
      ok: false,
      codigo: 'carrinho_invalido',
      erros: r.erros.map((e) => ({ linha: e.linha, item_id: e.item_id, codigo: e.codigo, mensagem: e.mensagem })),
    }),
  }
}

/** Com o bloqueio de estoque ligado pelo dono, quantidade acima do saldo é recusada (só em pedido novo). */
async function acimaDoEstoque(supabase: Supabase, barracaId: string, linhas: LinhaResolvida[]): Promise<string[]> {
  const { data, error } = await supabase
    .from('itens')
    .select('id, estoque_qtd')
    .eq('barraca_id', barracaId)
    .in('id', [...new Set(linhas.map((l) => l.item_id))])
  if (error) throw new FalhaInterna('estoque')
  const saldos = new Map<string, number | null>(
    ((data ?? []) as { id: string; estoque_qtd: number | null }[]).map((r) => [r.id, r.estoque_qtd]),
  )
  return itensAcimaDoEstoque(linhas, saldos)
}

async function acaoCardapio(supabase: Supabase, c: Corpo<'cardapio'>) {
  const { data, error } = await supabase.rpc('integracao_cardapio', { p_barraca_id: c.barracaId })
  if (error) throw new FalhaInterna('integracao_cardapio')
  if (!data) return barracaInvalida()
  const { loja, horarios, itens } = data as { loja: LojaCrua; horarios: HorarioDia[]; itens: unknown[] }
  const urlApp = Deno.env.get('URL_APP_PUBLICA') ?? URL_APP_PADRAO
  return json({ ok: true, loja: lojaDoBot(loja, horarios, urlApp), itens })
}

async function acaoRascunho(supabase: Supabase, c: Corpo<'rascunho'>) {
  const r = await resolverCarrinho(supabase, c.barracaId, c.itens)
  if (!r.ok) return r.resposta
  return json({ ok: true, linhas: r.linhas, total_centavos: r.total })
}

/** Pedido já criado com este client_uuid (reentrega, duplo "sim"): devolve o MESMO pedido, sem consultar a loja. */
async function pedidoJaCriado(supabase: Supabase, clientUuid: string, barracaId: string) {
  const { data: pedido, error } = await supabase
    .from('pedidos')
    .select('id, senha, barraca_id, taxa_entrega_centavos')
    .eq('client_uuid', clientUuid)
    .maybeSingle()
  if (error) throw new FalhaInterna('pedidos')
  if (!pedido) return null
  // O client_uuid é único no banco inteiro: de outra loja é conflito, nunca o pedido alheio.
  if (pedido.barraca_id !== barracaId) return negocio('client_uuid_em_uso', 'Identificador de pedido já usado.')
  const { data: linhas, error: erroLinhas } = await supabase
    .from('itens_do_pedido')
    .select('quantidade, preco_centavos_unitario')
    .eq('pedido_id', pedido.id)
    .eq('removido', false)
  if (erroLinhas) throw new FalhaInterna('itens_do_pedido')
  const itens = ((linhas ?? []) as { quantidade: number; preco_centavos_unitario: number }[]).reduce(
    (soma, l) => soma + l.quantidade * l.preco_centavos_unitario,
    0,
  )
  return json({ ok: true, senha: pedido.senha, total_centavos: itens + Number(pedido.taxa_entrega_centavos ?? 0) })
}

async function acaoPedido(supabase: Supabase, c: Corpo<'pedido'>) {
  const repetido = await pedidoJaCriado(supabase, c.clientUuid, c.barracaId)
  if (repetido) return repetido

  const loja = await carregarLoja(supabase, c.barracaId)
  if (!loja) return barracaInvalida()
  const recusa = recusaDaAcao('pedido', c.tipoAtendimento, loja.barraca, barracaAbertaAgora(loja.horarios, loja.barraca.fuso))
  if (recusa) return negocio(recusa.codigo, recusa.mensagem)

  const r = await resolverCarrinho(supabase, c.barracaId, c.itens)
  if (!r.ok) return r.resposta
  if (r.total <= 0) return negocio('carrinho_vazio', 'O pedido não tem valor a cobrar.')

  // A taxa é SEMPRE calculada no banco; falha ao calcular nunca cai em taxa 0 (é dinheiro).
  let taxa = 0
  if (c.entrega) {
    const { data, error } = await supabase.rpc('taxa_entrega_do_bairro', { p_barraca_id: c.barracaId, p_bairro: c.entrega.bairro })
    const t = (Array.isArray(data) ? data[0] : data) as { permitido: boolean; taxa_centavos: number } | null
    if (error || !t || !Number.isInteger(t.taxa_centavos) || t.taxa_centavos < 0) throw new FalhaInterna('taxa_entrega')
    if (!t.permitido) return negocio('bairro_nao_atendido', 'Não entregamos nesse bairro.')
    taxa = t.taxa_centavos
  }

  if (loja.barraca.estoque_bloqueia === true) {
    const acima = await acimaDoEstoque(supabase, c.barracaId, r.linhas)
    if (acima.length > 0) return json({ ok: false, codigo: 'sem_estoque', mensagem: 'Sem estoque suficiente.', itens: acima })
  }

  const telefone = telefoneSemPais(c.clienteTelefone)
  const { data, error } = await supabase
    .rpc('criar_pedido', {
      p_barraca_id: c.barracaId,
      p_mesa: null,
      p_viagem: true,
      p_observacao: null,
      p_client_uuid: c.clientUuid,
      p_metodo_pagamento: 'na_entrega',
      p_itens: r.linhas,
      p_tipo_atendimento: c.tipoAtendimento,
      p_entrega: c.entrega ? { nome: c.clienteNome, telefone, ...c.entrega } : null,
      p_taxa_entrega_centavos: taxa,
      p_cliente_nome: c.clienteNome,
      p_cliente_telefone: telefone,
    })
    .single()
  const criado = data as { pedido_id?: string; senha?: number } | null
  if (error || !criado?.pedido_id || typeof criado.senha !== 'number') throw new FalhaInterna('criar_pedido')
  return json({ ok: true, senha: criado.senha, total_centavos: r.total + taxa })
}

type Pendente = {
  id: string
  barraca_id: string
  status: string
  pedido_id: string | null
  provedor: string | null
  mercadopago_order_id: string | null
  expira_em: string | null
  itens: { quantidade: number; preco_centavos_unitario: number }[] | null
  taxa_entrega_centavos: number | null
}

const copiaCola = (r: { copiaECola: string | null }) => {
  if (!r.copiaECola) throw new FalhaInterna('pix_sem_copia_cola')
  return r.copiaECola
}

/** Pix do bot: grava o pendente a partir do rascunho resolvido no banco e cria a cobrança. O PEDIDO não nasce aqui:
 * só o webhook-mercadopago cria, depois que o provedor confirma o pagamento (o aviso "recebido" do CRM cobre a confirmação). */
async function acaoPix(supabase: Supabase, c: Corpo<'pix'>) {
  const { data: existente, error: erroExistente } = await supabase
    .from('pagamentos_pendentes')
    .select('*')
    .eq('client_uuid', c.clientUuid)
    .maybeSingle()
  if (erroExistente) throw new FalhaInterna('pagamentos_pendentes')
  const pendenteAntigo = existente as Pendente | null

  if (pendenteAntigo) {
    // O client_uuid é único no banco inteiro: de outra loja é conflito, nunca a cobrança alheia.
    if (pendenteAntigo.barraca_id !== c.barracaId) return negocio('client_uuid_em_uso', 'Identificador de pedido já usado.')
    if (pendenteAntigo.status === 'aprovado') return negocio('ja_pago', 'Este pagamento já foi confirmado.')
    if (pendenteAntigo.status !== 'pendente' || (pendenteAntigo.expira_em && Date.parse(pendenteAntigo.expira_em) <= Date.now())) {
      return negocio('pix_expirado', 'O Pix venceu. Peça pelo cardápio ou gere um novo pedido.')
    }
    if (pendenteAntigo.mercadopago_order_id) {
      // Retry: devolve o QR JÁ emitido, no mesmo provedor em que nasceu.
      const emitido = obterProvedor(chaveDoProvedor(pendenteAntigo.provedor))
      const tokenEmitido = emitido ? await buscarTokenDoProvedor(supabase, c.barracaId, emitido.chave, Deno.env) : null
      if (!emitido || !tokenEmitido) return negocio('sem_pix', 'Pix indisponível nesta loja.')
      try {
        const qr = await emitido.recuperarQr({ token: tokenEmitido, idExterno: pendenteAntigo.mercadopago_order_id })
        return json({
          ok: true,
          copia_cola: copiaCola(qr),
          expira_em: pendenteAntigo.expira_em,
          total_centavos: totalDoPendente(pendenteAntigo.itens, pendenteAntigo.taxa_entrega_centavos),
          pendente_id: pendenteAntigo.id,
        })
      } catch (erro) {
        if (erro instanceof ErroProvedor) return negocio('provedor_indisponivel', 'Não foi possível recuperar o Pix agora.')
        throw erro
      }
    }
  }

  const loja = await carregarLoja(supabase, c.barracaId)
  if (!loja) return barracaInvalida()
  const recusa = recusaDaAcao('pix', c.tipoAtendimento, loja.barraca, barracaAbertaAgora(loja.horarios, loja.barraca.fuso))
  if (recusa) return negocio(recusa.codigo, recusa.mensagem)

  const provedorChave = chaveDoProvedor(loja.barraca.pagamento_provedor)
  const provedor = ehProvedorValido(provedorChave) ? obterProvedor(provedorChave) : null
  const token = provedor ? await buscarTokenDoProvedor(supabase, c.barracaId, provedor.chave, Deno.env) : null
  if (!provedor || !token) return negocio('sem_pix', 'A loja não configurou o Pix.')

  const r = await resolverCarrinho(supabase, c.barracaId, c.itens)
  if (!r.ok) return r.resposta
  if (r.total <= 0) return negocio('carrinho_vazio', 'O pedido não tem valor a cobrar.')
  if (loja.barraca.estoque_bloqueia === true) {
    const acima = await acimaDoEstoque(supabase, c.barracaId, r.linhas)
    if (acima.length > 0) return json({ ok: false, codigo: 'sem_estoque', mensagem: 'Sem estoque suficiente.', itens: acima })
  }

  // Cobrança anterior sem QR (falha do provedor): reaproveita a linha em vez de estourar a unique do client_uuid.
  const telefone = telefoneSemPais(c.clienteTelefone)
  const dados = {
    mesa: null,
    viagem: true,
    observacao: null,
    itens: r.linhas,
    tipo_atendimento: 'retirada',
    cliente_nome: c.clienteNome,
    cliente_telefone: telefone,
    conversa_id: c.conversaId,
    provedor: provedor.chave,
  }
  const gravacao = pendenteAntigo
    ? supabase.from('pagamentos_pendentes').update(dados).eq('id', pendenteAntigo.id).eq('status', 'pendente')
    : supabase.from('pagamentos_pendentes').insert({ ...dados, barraca_id: c.barracaId, client_uuid: c.clientUuid })
  const { data: gravado, error: erroGravar } = await gravacao.select('id').single()
  if (erroGravar || !gravado) throw new FalhaInterna('gravar_pendente')
  const pendente = gravado as { id: string }

  const expiraEm = new Date(Date.now() + minutosExpiracaoPix(loja.barraca.pix_expiracao_minutos) * 60 * 1000)
  const { error: erroExpira } = await supabase.from('pagamentos_pendentes').update({ expira_em: expiraEm.toISOString() }).eq('id', pendente.id)
  if (erroExpira) throw new FalhaInterna('expira_em')

  let cobranca
  try {
    cobranca = await provedor.criarCobranca({
      token,
      valorCentavos: r.total,
      referencia: pendente.id,
      descricao: 'Pedido por WhatsApp',
      expiraEm,
      urlNotificacao: urlNotificacaoPagamento(Deno.env.get('SUPABASE_URL') ?? '', pendente.id, provedor.chave),
    })
  } catch (erro) {
    // O detalhe do provedor pode conter dados do cliente: nada dele sai nem vai para o log.
    if (erro instanceof ErroProvedor) return negocio('provedor_indisponivel', 'Não foi possível gerar o Pix agora.')
    throw erro
  }
  // Coluna histórica: guarda o id externo de QUALQUER provedor.
  const { error: erroOrder } = await supabase
    .from('pagamentos_pendentes')
    .update({ mercadopago_order_id: cobranca.idExterno })
    .eq('id', pendente.id)
  if (erroOrder) throw new FalhaInterna('gravar_cobranca')

  return json({
    ok: true,
    copia_cola: copiaCola(cobranca),
    expira_em: expiraEm.toISOString(),
    total_centavos: r.total,
    pendente_id: pendente.id,
  })
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return new Response(null, { status: 405 })

  // Sem segredo de verdade a rota não existe: nunca aceita nada.
  const segredos = Deno.env.get('WHATSAPP_CONEXAO_SEGREDO')
  if (!haSegredoValido(segredos)) return new Response(null, { status: 503 })

  // O corpo é lido UMA vez, em texto: é exatamente esse texto que foi assinado.
  const corpoBruto = await req.text()
  if (new TextEncoder().encode(corpoBruto).length > TAMANHO_MAX_CORPO) return new Response(null, { status: 413 })
  const autentico = await verificarAssinaturaLista(
    segredos,
    req.headers.get('x-saiae-timestamp'),
    req.headers.get('x-saiae-signature'),
    corpoBruto,
  )
  if (!autentico) return new Response(null, { status: 401 })

  let corpo: unknown
  try {
    corpo = JSON.parse(corpoBruto)
  } catch {
    return new Response(null, { status: 422 })
  }
  const v = validarCorpoIntegracao(corpo)
  if (!v.ok) return new Response(null, { status: 422 })

  // Só depois da assinatura o banco é tocado.
  const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '')
  try {
    switch (v.valor.acao) {
      case 'cardapio':
        return await acaoCardapio(supabase, v.valor)
      case 'rascunho':
        return await acaoRascunho(supabase, v.valor)
      case 'pedido':
        return await acaoPedido(supabase, v.valor)
      case 'pix':
        return await acaoPix(supabase, v.valor)
    }
  } catch (erro) {
    const etapa = erro instanceof FalhaInterna ? erro.message : 'desconhecida'
    console.error('integracao-v1: falha na etapa', etapa)
    return json({ erro: 'Erro interno' }, 500)
  }
})
