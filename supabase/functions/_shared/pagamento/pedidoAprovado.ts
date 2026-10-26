// Gravações do pagamento aprovado, comuns ao webhook (webhook-mercadopago) e à resposta síncrona do cartão
// (criar-pagamento-pix). O cliente do banco é injetado: testado em Node com um cliente falso (pagamento.test.ts).
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2'
import type { TipoConciliacao } from './conciliacao.ts'
import { desfechoDaCriacao } from './corrida.ts'
import type { ProvedorPix } from './tipos.ts'
import { decidirAprovadoDoPendente, metodoDoPedido } from './webhookAprovado.ts'

export type BaseConciliacao = {
  supabase: SupabaseClient
  barracaId: string
  pendenteId: string
  provedor: string
  idExterno: string
  /** Prefixo dos logs (nome da edge function). */
  origem: string
}

export type ExtraConciliacao = {
  situacao?: string
  pedido_id?: string | null
  detalhe?: string
  valor_pago_centavos?: number
  valor_esperado_centavos?: number
}

/** Registro de conciliação. Idempotente: a mesma notificação repetida não duplica (unique provedor+id+tipo). */
export async function registrarConciliacao(base: BaseConciliacao, tipo: TipoConciliacao, extra: ExtraConciliacao = {}): Promise<boolean> {
  const { error } = await base.supabase.from('pagamentos_conciliacao').upsert(
    {
      barraca_id: base.barracaId,
      pendente_id: base.pendenteId,
      provedor: base.provedor,
      id_externo: base.idExterno,
      tipo,
      ...extra,
    },
    { onConflict: 'provedor,id_externo,tipo', ignoreDuplicates: true },
  )
  if (error) console.error(`${base.origem}: conciliação não registrada`, error.message)
  return !error
}

type EntregaPendente = {
  nome: string
  telefone: string
  rua: string
  numero: string
  bairro: string
  referencia: string | null
  consentimento_lgpd_em?: string | null
  consentimento_marketing_em?: string | null
}

/** Linha de pagamentos_pendentes (select '*'); colunas novas podem faltar em pendente antigo. */
export type PendenteAprovado = {
  id: string
  barraca_id: string
  client_uuid: string
  status: string
  itens: unknown
  mesa?: unknown
  viagem?: unknown
  observacao?: unknown
  tipo_atendimento?: unknown
  entrega?: unknown
  cliente_nome?: unknown
  cliente_telefone?: unknown
  cliente_id?: unknown
  cupom_uso_id?: unknown
  meio_pagamento?: unknown
  taxa_entrega_centavos?: unknown
  desconto_cupom_centavos?: unknown
  taxa_plataforma_centavos?: unknown
}

export type ContextoAprovado = BaseConciliacao & {
  pendente: PendenteAprovado
  valorPagoCentavos: number
  totalCentavos: number
  taxaEntregaCentavos: number
  taxaPlataformaCentavos: number
}

export type ResultadoPedidoAprovado =
  | { ok: true; pedidoId: string; senha: number | null }
  /** `pedido`: criar_pedido falhou (quem chama decide 500 + conciliação). `cupom`: cupom não confirmado (500). */
  | { ok: false; etapa: 'pedido' | 'cupom'; detalhe: string }

/**
 * Pagamento aprovado e conferido (decisão 'criar_pedido'): cria o pedido pelo `criar_pedido` (idempotente por
 * client_uuid; corrida = sucesso), confirma o cupom, copia cliente e taxa Sai aê, marca o pendente aprovado e grava
 * os registros informativos. Mesmo caminho para o webhook e para o cartão aprovado na resposta síncrona.
 */
export async function criarPedidoAprovado(
  ctx: ContextoAprovado,
  decisao: { tardio: boolean; comissaoNaoInformada?: true },
): Promise<ResultadoPedidoAprovado> {
  const { supabase, pendente, origem, taxaEntregaCentavos, taxaPlataformaCentavos } = ctx
  const registrar = (tipo: TipoConciliacao, extra: ExtraConciliacao) =>
    registrarConciliacao(ctx, tipo, { valor_pago_centavos: ctx.valorPagoCentavos, valor_esperado_centavos: ctx.totalCentavos, ...extra })

  // Argumentos de sempre; os de entrega só entram quando o pendente é de
  // Entrega, pra pedido comum chamar criar_pedido EXATAMENTE como hoje.
  const entrega: EntregaPendente | null =
    pendente.tipo_atendimento === 'entrega' && pendente.entrega ? (pendente.entrega as EntregaPendente) : null
  const argsPedido: Record<string, unknown> = {
    p_barraca_id: pendente.barraca_id,
    p_mesa: pendente.mesa,
    p_viagem: pendente.viagem,
    p_observacao: pendente.observacao,
    p_client_uuid: pendente.client_uuid,
    p_metodo_pagamento: metodoDoPedido(pendente),
    p_itens: pendente.itens,
  }
  if (entrega) {
    argsPedido.p_tipo_atendimento = 'entrega'
    argsPedido.p_entrega = {
      nome: entrega.nome,
      telefone: entrega.telefone,
      rua: entrega.rua,
      numero: entrega.numero,
      bairro: entrega.bairro,
      referencia: entrega.referencia,
    }
    argsPedido.p_taxa_entrega_centavos = taxaEntregaCentavos
    if (pendente.cliente_nome) argsPedido.p_cliente_nome = pendente.cliente_nome
  }
  // Telefone do aviso "pedido pronto": só entra quando existe (sem ele a chamada
  // é IDÊNTICA à de antes).
  if (pendente.cliente_telefone) argsPedido.p_cliente_telefone = pendente.cliente_telefone

  const { data: resultadoPedido, error: erroPedido } = await supabase.rpc('criar_pedido', argsPedido).single()

  // Corrida de notificações: se outra já criou o pedido (23505 em pedidos_client_uuid_key), busca-o
  // e segue como sucesso idempotente. Qualquer outro erro continua sendo falha.
  const desfecho = await desfechoDaCriacao(resultadoPedido as { pedido_id?: string } | null, erroPedido, async () => {
    const { data } = await supabase
      .from('pedidos')
      .select('id')
      .eq('barraca_id', pendente.barraca_id)
      .eq('client_uuid', pendente.client_uuid)
      .maybeSingle()
    return (data as { id: string } | null)?.id ?? null
  })
  if (desfecho.acao === 'falha') return { ok: false, etapa: 'pedido', detalhe: desfecho.detalhe }

  const pedidoId = desfecho.pedidoId
  const senhaCriada = desfecho.acao === 'criado' ? (resultadoPedido as { senha?: unknown } | null)?.senha : null
  // Cupom: o uso vira CONFIRMADO só com o pagamento aprovado (mesmo se a reserva já venceu ou foi liberada:
  // pagamento aprovado vale mais que a validade). Idempotente: webhook duplicado não confirma de novo.
  // Se falhar, devolve a falha ANTES de marcar o pendente aprovado: o provedor reenvia e tentamos de novo.
  if (pendente.cupom_uso_id) {
    const { error: erroCupom } = await supabase.rpc('cupom_confirmar', { p_uso_id: pendente.cupom_uso_id, p_pedido_id: pedidoId })
    if (erroCupom) {
      console.error(`${origem}: cupom não confirmado`, erroCupom.message)
      return { ok: false, etapa: 'cupom', detalhe: erroCupom.message }
    }
  }
  // Vínculo com o perfil do cliente (a cobrança carrega o cliente_id). Best-effort.
  if (pendente.cliente_id) {
    const { error: erroVinculo } = await supabase.from('pedidos').update({ cliente_id: pendente.cliente_id }).eq('id', pedidoId)
    if (erroVinculo) console.error(`${origem}: falha ao vincular cliente ao pedido`, erroVinculo.message)
  }
  // Taxa Sai aê copiada para o pedido (mesmo padrão do cliente_id). Best-effort: o pedido já existe e foi pago.
  if (taxaPlataformaCentavos > 0) {
    const { error: erroTaxa } = await supabase.from('pedidos').update({ taxa_plataforma_centavos: taxaPlataformaCentavos }).eq('id', pedidoId)
    if (erroTaxa) console.error(`${origem}: falha ao gravar a taxa Sai aê no pedido`, erroTaxa.message)
  }
  await supabase.from('pagamentos_pendentes').update({ status: 'aprovado', pedido_id: pedidoId }).eq('id', pendente.id)

  // Registros de conciliação (best-effort: o pedido já existe e foi pago, então
  // NADA aqui pode falhar a resposta ao provedor).
  try {
    // Uma falha anterior de criar_pedido (ou da credencial), agora resolvida.
    await supabase
      .from('pagamentos_conciliacao')
      .update({ situacao: 'resolvido', pedido_id: pedidoId, resolvido_em: new Date().toISOString() })
      .eq('provedor', ctx.provedor)
      .eq('id_externo', ctx.idExterno)
      .eq('tipo', 'pedido_nao_criado')
    // Pago depois de expirar, com valor certo: o pedido nasceu; o registro
    // informa o dono de que ele chegou fora do prazo.
    if (decisao.tardio) {
      await registrar('pago_apos_expirar', {
        situacao: 'pedido_criado',
        pedido_id: pedidoId,
        detalhe: 'Pix pago depois do prazo; o pedido foi criado normalmente.',
      })
    }
    // Valor e referência certos, mas o provedor não devolveu a comissão: o pedido nasceu e a taxa fica para conferir.
    if (decisao.comissaoNaoInformada) {
      await registrar('comissao_nao_informada', {
        situacao: 'pedido_criado',
        pedido_id: pedidoId,
        detalhe: `taxa Sai aê ${taxaPlataformaCentavos}; comissão não informada pelo provedor; o pedido foi criado normalmente.`,
      })
    }
  } catch (erroConciliacao) {
    console.warn(`${origem}: conciliação não atualizada`, String(erroConciliacao))
  }

  // Entrega: guarda/atualiza o cliente (endereço pra próximos pedidos), com o
  // consentimento LGPD que ele deu no formulário. Best-effort: o pedido já
  // existe e foi pago, então NADA aqui pode falhar a resposta ao MP.
  if (entrega?.consentimento_lgpd_em) {
    try {
      // Perfil já confirmado por código: o pedido NÃO sobrescreve nome nem aceite (só endereço).
      const { data: existente } = await supabase
        .from('clientes_finais')
        .select('telefone_confirmado_em')
        .eq('barraca_id', pendente.barraca_id)
        .eq('telefone', entrega.telefone)
        .maybeSingle()
      const confirmado = Boolean((existente as { telefone_confirmado_em?: string | null } | null)?.telefone_confirmado_em)
      const { error: erroCliente } = await supabase.from('clientes_finais').upsert(
        {
          barraca_id: pendente.barraca_id,
          ...(confirmado ? {} : { nome: entrega.nome }),
          telefone: entrega.telefone,
          rua: entrega.rua,
          numero: entrega.numero,
          bairro: entrega.bairro,
          referencia: entrega.referencia,
          origem: 'cardapio',
          ...(confirmado ? {} : { consentimento_lgpd_em: entrega.consentimento_lgpd_em }),
          ...(entrega.consentimento_marketing_em ? { consentimento_marketing_em: entrega.consentimento_marketing_em } : {}),
        },
        { onConflict: 'barraca_id,telefone' },
      )
      if (erroCliente) console.warn(`${origem}: cliente_final não salvo`, erroCliente.message)
    } catch (erroCliente) {
      console.warn(`${origem}: cliente_final não salvo`, String(erroCliente))
    }
  }

  return { ok: true, pedidoId, senha: typeof senhaCriada === 'number' ? senhaCriada : null }
}

/**
 * Cartão APROVADO na resposta síncrona da cobrança: lê o pagamento de volta (como o webhook), aplica a MESMA decisão
 * sobre o snapshot do pendente e cria o pedido pelo mesmo caminho idempotente. Qualquer coisa fora do caminho feliz
 * (não aprovado na leitura, referência ou valor que não conferem, falha ao criar) devolve null e fica para o webhook:
 * a cobrança já foi feita, então isto nunca falha a resposta ao cliente.
 */
export async function concluirCartaoAprovado(p: {
  supabase: SupabaseClient
  provedor: Pick<ProvedorPix, 'chave' | 'consultarPagamento'>
  token: string
  idExterno: string
  pendenteId: string
  origem: string
}): Promise<{ pedidoId: string; senha: number | null } | null> {
  try {
    const leitura = await p.provedor.consultarPagamento({ token: p.token, idExterno: p.idExterno })
    if (leitura.status !== 'aprovado' || leitura.referencia !== p.pendenteId) return null
    const { data } = await p.supabase.from('pagamentos_pendentes').select('*').eq('id', p.pendenteId).maybeSingle()
    const pendente = data as PendenteAprovado | null
    if (!pendente) return null
    const { decisao, totalCentavos, taxaEntregaCentavos, taxaPlataformaCentavos } = decidirAprovadoDoPendente(pendente, leitura)
    if (decisao.acao !== 'criar_pedido') return null
    const criado = await criarPedidoAprovado(
      {
        supabase: p.supabase,
        barracaId: pendente.barraca_id,
        pendenteId: pendente.id,
        provedor: p.provedor.chave,
        idExterno: p.idExterno,
        origem: p.origem,
        pendente,
        valorPagoCentavos: leitura.valorCentavos,
        totalCentavos,
        taxaEntregaCentavos,
        taxaPlataformaCentavos,
      },
      decisao,
    )
    return criado.ok ? { pedidoId: criado.pedidoId, senha: criado.senha } : null
  } catch (erro) {
    console.warn(`${p.origem}: pedido do cartão fica para o webhook`, erro instanceof Error ? erro.name : 'erro')
    return null
  }
}
