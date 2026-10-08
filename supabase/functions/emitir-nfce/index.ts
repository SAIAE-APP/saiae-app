// Emissão de verdade da NFC-e via FocusNFe — CLAUDE.md, roadmap de
// 2026-09-26. Recebe { pedido_id }, valida os dados fiscais do pedido, dos
// itens e da barraca, chama a API da FocusNFe e grava o resultado em
// `pedidos` (ver migração 20260926170000_add_nfce_pedidos.sql).
//
// Usa a service role key (não a anon key): lê `barracas_fiscal_token`
// direto, sem passar pelas funções SECURITY DEFINER pensadas pro client
// autenticado (definir_token_fiscal/token_fiscal_configurado) — a service
// role já ignora RLS.
//
// SEGURANÇA (correção 2026-09-27, achado CRÍTICO da auditoria): como a
// função roda com service role, ela ignora RLS por completo — sem a
// checagem de acesso abaixo, qualquer pessoa que soubesse/adivinhasse um
// pedido_id (só precisa de `verify_jwt`, que aceita até a anon key
// pública) conseguia forçar a emissão de uma NFC-e de verdade pra
// qualquer barraca com fiscal habilitado, inclusive em ambiente de
// produção. Agora exige um JWT de usuário válido E que esse usuário
// pertença à barraca do pedido (mesma checagem de `usuario_tem_acesso_barraca`
// usada em todo o resto do app).
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { ratearDesconto } from '../_shared/descontoNfce.ts'

const FOCUSNFE_URL_HOMOLOGACAO = 'https://homologacao.focusnfe.com.br/v2'
const FOCUSNFE_URL_PRODUCAO = 'https://api.focusnfe.com.br/v2'

// Tabela de formas de pagamento da NFC-e (Nota Técnica 2020.005/2021,
// mesma usada pela FocusNFe). Só cobre os métodos que o Sai aê oferece
// em Confirmar Pedido (ver src/lib/metodoPagamento.ts) — um método novo
// lá precisa ganhar uma entrada aqui.
const FORMA_PAGAMENTO_POR_METODO: Record<string, string> = {
  dinheiro: '01',
  credito: '03',
  debito: '04',
  pix: '17', // Pagamento Instantâneo (PIX) – Dinâmico
}

// Default razoável pro regime do primeiro cliente (Simples Nacional/MEI,
// sem crédito de ICMS) — constante isolada de propósito, não espalhar
// pelo payload se um cliente futuro precisar de outro CST.
const ICMS_ORIGEM = '0'
const ICMS_SITUACAO_TRIBUTARIA = '102'

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

// Dígitos verificadores do CPF (mesma regra de src/lib/fiscal.ts).
function cpfValido(d: string): boolean {
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false
  for (const tamanho of [9, 10]) {
    let soma = 0
    for (let i = 0; i < tamanho; i++) soma += Number(d[i]) * (tamanho + 1 - i)
    if (((soma * 10) % 11) % 10 !== Number(d[tamanho])) return false
  }
  return true
}

type ItemDoPedidoRow = {
  id: string
  item_id: string | null
  nome_item: string
  quantidade: number
  preco_centavos_unitario: number
  removido: boolean
  /** SAI-010a: snapshot de variação/adicionais ([] em item simples). */
  opcoes?: unknown
}

// NFC-e: UMA linha por item do pedido; as opções vão só na descrição (preço, NCM e CFOP são os do
// item pai, e preco_centavos_unitario já é o preço final da unidade). Limite de 120 da descrição.
function descricaoDoItem(nome: string, opcoes: unknown): string {
  const nomes = Array.isArray(opcoes)
    ? opcoes
        .map((o) => (o && typeof o === 'object' && typeof (o as { nome?: unknown }).nome === 'string' ? (o as { nome: string }).nome.trim() : ''))
        .filter((n) => n !== '')
    : []
  const texto = nomes.length > 0 ? `${nome} (${nomes.join(', ')})` : nome
  return texto.length > 120 ? `${texto.slice(0, 117)}...` : texto
}

type ItemCadastroRow = {
  id: string
  ncm: string | null
  cfop: string | null
  unidade_comercial: string | null
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS })
  }

  let pedidoId: string | undefined
  let cpfConsumidor: string | null
  try {
    const body = await req.json()
    pedidoId = body?.pedido_id
    // CPF na nota é SEMPRE opcional; vazio = consumidor não identificado.
    cpfConsumidor = String(body?.cpf_consumidor ?? '').replace(/\D/g, '') || null
  } catch {
    return jsonResponse({ erro: 'JSON inválido' }, 400)
  }

  if (!pedidoId) {
    return jsonResponse({ erro: 'pedido_id é obrigatório' }, 400)
  }

  if (cpfConsumidor && !cpfValido(cpfConsumidor)) {
    return jsonResponse({ erro: 'CPF do consumidor inválido. Corrija ou deixe em branco.' }, 422)
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

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  )

  const { data: pedido, error: erroPedido } = await supabase
    .from('pedidos')
    .select(
      'id, barraca_id, metodo_pagamento, nfce_status, nfce_chave, nfce_numero, ' +
        'itens_do_pedido(id, item_id, nome_item, quantidade, preco_centavos_unitario, removido, opcoes)',
    )
    .eq('id', pedidoId)
    .single()

  if (erroPedido || !pedido) {
    return jsonResponse({ erro: 'Pedido não encontrado' }, 404)
  }

  const { data: acesso } = await supabase
    .from('usuarios_barracas')
    .select('usuario_id')
    .eq('usuario_id', userData.user.id)
    .eq('barraca_id', pedido.barraca_id)
    .maybeSingle()

  if (!acesso) {
    return jsonResponse({ erro: 'Sem acesso a esta barraca' }, 403)
  }

  if (pedido.nfce_status === 'autorizado') {
    return jsonResponse({ status: pedido.nfce_status, chave: pedido.nfce_chave, numero: pedido.nfce_numero })
  }

  const { data: barraca, error: erroBarraca } = await supabase
    .from('barracas')
    .select('id, cnpj, fiscal_habilitado, fiscal_ambiente, tributos_aprox_bps')
    .eq('id', pedido.barraca_id)
    .single()

  if (erroBarraca || !barraca) {
    return jsonResponse({ erro: 'Barraca não encontrada' }, 404)
  }

  if (!barraca.fiscal_habilitado) {
    return jsonResponse({ erro: 'Emissão fiscal não habilitada para esta barraca' }, 422)
  }

  if (!barraca.cnpj) {
    return jsonResponse({ erro: 'CNPJ da barraca não configurado' }, 422)
  }

  // A FocusNFe emite um token POR AMBIENTE (token_homologacao e
  // token_producao são credenciais distintas, não o mesmo valor com URL
  // diferente) — sempre lê a coluna que corresponde ao ambiente
  // configurado na barraca, nunca mistura os dois.
  const colunaToken = barraca.fiscal_ambiente === 'producao' ? 'token_producao' : 'token_homologacao'
  const { data: tokenRow, error: erroToken } = await supabase
    .from('barracas_fiscal_token')
    .select(colunaToken)
    .eq('barraca_id', barraca.id)
    .maybeSingle()

  const token = (tokenRow as Record<string, string | null> | null)?.[colunaToken]
  if (erroToken || !token) {
    return jsonResponse(
      { erro: `Token de ${barraca.fiscal_ambiente === 'producao' ? 'produção' : 'homologação'} não configurado` },
      422,
    )
  }

  const itensAtivos = ((pedido.itens_do_pedido ?? []) as ItemDoPedidoRow[]).filter((item) => !item.removido)
  if (itensAtivos.length === 0) {
    return jsonResponse({ erro: 'Pedido sem itens para emitir' }, 422)
  }

  // "Pagar na entrega": o método real só existe depois que o entregador
  // confirma (grava o final em pedidos.metodo_pagamento). Antes disso a nota
  // sairia com forma de pagamento errada, e NFC-e autorizada não se corrige.
  if (pedido.metodo_pagamento === 'na_entrega') {
    return jsonResponse(
      {
        erro: 'A forma de pagamento deste pedido será definida na entrega. Emita a nota depois que o entregador confirmar o pagamento.',
      },
      422,
    )
  }

  const formaPagamento = pedido.metodo_pagamento
    ? FORMA_PAGAMENTO_POR_METODO[pedido.metodo_pagamento]
    : undefined
  if (!formaPagamento) {
    return jsonResponse(
      {
        erro: `Forma de pagamento "${pedido.metodo_pagamento ?? 'não informada'}" não é suportada pra emissão fiscal`,
      },
      422,
    )
  }

  const idsItens = itensAtivos.map((item) => item.item_id).filter((id): id is string => id !== null)
  const { data: itensCadastro, error: erroItensCadastro } = await supabase
    .from('itens')
    .select('id, ncm, cfop, unidade_comercial')
    .in('id', idsItens.length > 0 ? idsItens : ['00000000-0000-0000-0000-000000000000'])

  if (erroItensCadastro) {
    return jsonResponse({ erro: 'Falha ao carregar dados fiscais dos itens' }, 500)
  }

  const cadastroPorId = new Map<string, ItemCadastroRow>(
    ((itensCadastro ?? []) as ItemCadastroRow[]).map((item) => [item.id, item]),
  )

  const faltando: string[] = []
  for (const item of itensAtivos) {
    if (!item.item_id) {
      faltando.push(`"${item.nome_item}": sem item de cardápio vinculado`)
      continue
    }
    const cadastro = cadastroPorId.get(item.item_id)
    const camposFaltando: string[] = []
    if (!cadastro?.ncm) camposFaltando.push('NCM')
    if (!cadastro?.cfop) camposFaltando.push('CFOP')
    if (!cadastro?.unidade_comercial) camposFaltando.push('unidade')
    if (camposFaltando.length > 0) {
      faltando.push(`"${item.nome_item}": falta ${camposFaltando.join(', ')}`)
    }
  }

  if (faltando.length > 0) {
    return jsonResponse({ erro: `Dados fiscais incompletos: ${faltando.join('; ')}` }, 422)
  }

  // Cupom: o desconto do pedido (só nos itens) é rateado entre os itens, porque a FocusNFe recebe o
  // desconto POR ITEM (`valor_desconto`, opcional, junto de `valor_bruto`). A nota reflete o que o cliente
  // pagou; a taxa de entrega continua FORA. Lido à parte para não quebrar antes da migration dos cupons.
  // ATENÇÃO: nenhuma nota com desconto foi emitida ainda; na primeira emissão real conferir a nota e o
  // `resultado` bruto da FocusNFe (valor_total = soma dos brutos − descontos).
  const { data: descontoRow } = await supabase.from('pedidos').select('desconto_cupom_centavos').eq('id', pedidoId).maybeSingle()
  const descontoCupomCentavos = Math.max(0, Math.floor(Number((descontoRow as { desconto_cupom_centavos?: number } | null)?.desconto_cupom_centavos ?? 0)))
  const descontosPorItem = ratearDesconto(
    itensAtivos.map((i) => i.preco_centavos_unitario * i.quantidade),
    descontoCupomCentavos,
  )

  const itemsPayload = itensAtivos.map((item, indice) => {
    const cadastro = cadastroPorId.get(item.item_id as string) as ItemCadastroRow
    const valorUnitario = item.preco_centavos_unitario / 100
    const valorBruto = (item.preco_centavos_unitario * item.quantidade) / 100
    // Lei 12.741: a FocusNFe não calcula IBPT; usa a alíquota do dono
    // (mesma conta de src/lib/fiscal.ts).
    const tributosCentavos =
      barraca.tributos_aprox_bps === null || barraca.tributos_aprox_bps === undefined
        ? null
        : Math.round(((item.preco_centavos_unitario * item.quantidade - descontosPorItem[indice]) * barraca.tributos_aprox_bps) / 10000)

    return {
      tributosCentavos,
      numero_item: String(indice + 1),
      codigo_produto: item.item_id,
      descricao: descricaoDoItem(item.nome_item, item.opcoes),
      codigo_ncm: cadastro.ncm,
      cfop: cadastro.cfop,
      quantidade_comercial: item.quantidade,
      quantidade_tributavel: item.quantidade,
      valor_unitario_comercial: valorUnitario,
      valor_unitario_tributavel: valorUnitario,
      valor_bruto: valorBruto,
      ...(descontosPorItem[indice] > 0 ? { valor_desconto: descontosPorItem[indice] / 100 } : {}),
      unidade_comercial: cadastro.unidade_comercial,
      unidade_tributavel: cadastro.unidade_comercial,
      icms_origem: ICMS_ORIGEM,
      icms_situacao_tributaria: ICMS_SITUACAO_TRIBUTARIA,
      ...(tributosCentavos !== null ? { valor_total_tributos: tributosCentavos / 100 } : {}),
    }
  })

  const tributosTotalCentavos = itemsPayload.some((i) => i.tributosCentavos === null)
    ? null
    : itemsPayload.reduce((soma, i) => soma + (i.tributosCentavos ?? 0), 0)

  // Em centavos inteiros (sem somar float): soma dos brutos − desconto do cupom.
  const valorTotal =
    (itensAtivos.reduce((soma, i) => soma + i.preco_centavos_unitario * i.quantidade, 0) - descontosPorItem.reduce((a, b) => a + b, 0)) / 100

  const payload = {
    cnpj_emitente: barraca.cnpj.replace(/\D/g, ''),
    data_emissao: new Date().toISOString(),
    presenca_comprador: '1',
    modalidade_frete: '9',
    local_destino: '1',
    natureza_operacao: 'VENDA AO CONSUMIDOR',
    // CPF só vai se informado; dados de entrega NUNCA entram na NFC-e.
    ...(cpfConsumidor ? { cpf_destinatario: cpfConsumidor } : {}),
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    items: itemsPayload.map(({ tributosCentavos, ...item }) => item),
    formas_pagamento: [{ forma_pagamento: formaPagamento, valor_pagamento: valorTotal }],
  }

  // Ambiente NUNCA forçado pra produção — respeita sempre o que a
  // barraca configurou em Ajustes (default é homologação, sem validade
  // fiscal, até o dono trocar conscientemente).
  const baseUrl = barraca.fiscal_ambiente === 'producao' ? FOCUSNFE_URL_PRODUCAO : FOCUSNFE_URL_HOMOLOGACAO
  const auth = btoa(`${token}:`)

  let respostaFocusNFe: Response
  try {
    respostaFocusNFe = await fetch(`${baseUrl}/nfce?ref=${pedidoId}`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })
  } catch (erroRede) {
    return jsonResponse({ erro: `Falha ao contatar a FocusNFe: ${String(erroRede)}` }, 502)
  }

  let resultado = await respostaFocusNFe.json().catch(() => null)

  // Pode ficar em processando_autorizacao: consulta a mesma ref algumas
  // vezes antes de desistir (a nota segue sendo processada na FocusNFe).
  for (let tentativa = 0; tentativa < 4 && resultado?.status === 'processando_autorizacao'; tentativa++) {
    await new Promise((r) => setTimeout(r, 1500))
    const consulta = await fetch(`${baseUrl}/nfce/${pedidoId}`, {
      headers: { Authorization: `Basic ${auth}` },
    }).catch(() => null)
    const corpo = await consulta?.json().catch(() => null)
    if (corpo) resultado = corpo
  }

  if (!respostaFocusNFe.ok) {
    const mensagem =
      resultado?.mensagem ??
      resultado?.erros?.map((e: { mensagem: string }) => e.mensagem).join('; ') ??
      'Erro desconhecido na FocusNFe'
    await supabase.from('pedidos').update({ nfce_status: 'erro', nfce_mensagem: mensagem }).eq('id', pedidoId)
    return jsonResponse({ erro: mensagem, detalhe: resultado }, 502)
  }

  const status = resultado?.status ?? 'desconhecido'
  const autorizado = status === 'autorizado'

  await supabase
    .from('pedidos')
    .update({
      nfce_status: status,
      nfce_chave: resultado?.chave_nfe ?? null,
      nfce_numero: resultado?.numero ?? null,
      nfce_mensagem: resultado?.mensagem_sefaz ?? null,
      nfce_emitida_em: autorizado ? new Date().toISOString() : null,
      // Ambiente USADO nesta chamada (mesma regra do baseUrl acima). O cupom e o
      // Histórico leem isto, nunca o fiscal_ambiente atual da barraca.
      nfce_ambiente: barraca.fiscal_ambiente === 'producao' ? 'producao' : 'homologacao',
      // Nomes de campo conforme documentação da FocusNFe — ainda não
      // confirmados numa emissão real (nenhuma nota emitida de verdade até
      // agora), por isso aceita variantes prováveis em vez de travar num só.
      nfce_serie: resultado?.serie ?? null,
      // Nomes conferidos na doc oficial (consultar_nfce, 2026-10-06): serie,
      // protocolo (= numero_protocolo), qrcode_url, url_consulta_nf.
      nfce_protocolo: resultado?.protocolo ?? resultado?.numero_protocolo ?? null,
      nfce_qrcode_url: resultado?.qrcode_url ?? null,
      ...(autorizado ? { nfce_cpf_consumidor: cpfConsumidor, nfce_tributos_centavos: tributosTotalCentavos } : {}),
    })
    .eq('id', pedidoId)

  return jsonResponse({
    status,
    chave: resultado?.chave_nfe ?? null,
    numero: resultado?.numero ?? null,
    mensagem: resultado?.mensagem_sefaz ?? null,
  })
})
