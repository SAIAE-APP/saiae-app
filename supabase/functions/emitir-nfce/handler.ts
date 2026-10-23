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
import { comCors } from '../_shared/cors.ts'
import { configDoEnv, lerSegredo } from '../_shared/segredoCifrado.ts'
import { MENSAGEM_PEDIDO_GRATIS, ratearDesconto, totalDaNotaCentavos } from '../_shared/descontoNfce.ts'
import { ratearTaxaServico } from '../_shared/taxaServicoNfce.ts'

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

// O Allow-Origin vem da allowlist (comCors, _shared/cors.ts), nunca `*`.
const CORS_HEADERS = {
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
  /** Observação do item; no item de Preço aberto é "o que foi vendido" (valor livre). */
  observacao?: string | null
}

// NFC-e: UMA linha por item do pedido; as opções vão só na descrição (preço, NCM e CFOP são os do
// item pai, e preco_centavos_unitario já é o preço final da unidade). Limite de 120 da descrição.
function descricaoDoItem(nome: string, opcoes: unknown, valorLivre?: string | null): string {
  const nomes = Array.isArray(opcoes)
    ? opcoes
        .map((o) => (o && typeof o === 'object' && typeof (o as { nome?: unknown }).nome === 'string' ? (o as { nome: string }).nome.trim() : ''))
        .filter((n) => n !== '')
    : []
  const base = nomes.length > 0 ? `${nome} (${nomes.join(', ')})` : nome
  // Valor livre (Preço aberto): descrição = nome do item + o que foi vendido (spec, decisão 2). Nunca vaga.
  const livre = (valorLivre ?? '').trim()
  const texto = livre ? `${base} - ${livre}` : base
  return texto.length > 120 ? `${texto.slice(0, 117)}...` : texto
}

type ItemCadastroRow = {
  id: string
  ncm: string | null
  cfop: string | null
  unidade_comercial: string | null
  preco_aberto?: boolean
}

// Tudo que toca o mundo (Supabase, FocusNFe, relógio, env) entra por aqui, para os testes EXECUTAREM o handler
// com supabase e fetch simulados (tests/emitirNfceTrava.test.ts). index.ts liga as peças de verdade.
export type DependenciasNfce = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  criarCliente: (url: string, chave: string) => any
  env: { get: (nome: string) => string | undefined }
  buscar: typeof fetch
  agora: () => number
  esperar: (ms: number) => Promise<void>
}

// Trava de emissão: quem reivindica o pedido segura a vez por este tempo. Passado o prazo outra chamada pode
// assumir (a primeira morreu), mas SEMPRE reconcilia com a FocusNFe antes de enviar de novo.
export const TRAVA_NFCE_MS = 2 * 60 * 1000

function criarHandlerInterno(deps: DependenciasNfce) {
  const createClient = deps.criarCliente
  const fetch = deps.buscar
  return async (req: Request): Promise<Response> => {
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
    deps.env.get('SUPABASE_URL') ?? '',
    deps.env.get('SUPABASE_ANON_KEY') ?? '',
  )
  const { data: userData, error: erroUser } = await supabaseAuth.auth.getUser(jwt)
  if (erroUser || !userData?.user) {
    return jsonResponse({ erro: 'Não autenticado' }, 401)
  }

  const supabase = createClient(
    deps.env.get('SUPABASE_URL') ?? '',
    deps.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  )

  const { data: pedido, error: erroPedido } = await supabase
    .from('pedidos')
    .select(
      'id, barraca_id, status, metodo_pagamento, nfce_status, nfce_chave, nfce_numero, ' +
        'itens_do_pedido(id, item_id, nome_item, quantidade, preco_centavos_unitario, removido, opcoes, observacao)',
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

  // Pedido cancelado não vende nada: nota fiscal seria sobre uma venda que não houve. A tela já esconde o botão, mas
  // quem manda é o servidor (e a emissão automática/em lote usa a mesma regra). Vem antes da trava e da FocusNFe.
  if (pedido.status === 'cancelado') {
    return jsonResponse({ erro: 'Pedido cancelado não emite nota.', codigo: 'pedido_cancelado' }, 422)
  }

  // Método 'gratis' (cupom de 100%): total R$ 0,00, nada a faturar. Recusa antes de qualquer outra coisa.
  if (pedido.metodo_pagamento === 'gratis') {
    return jsonResponse({ erro: MENSAGEM_PEDIDO_GRATIS, codigo: 'pedido_gratis' }, 422)
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
  // select('*'): tolera subir a function antes da migration das colunas *_cifrado (coluna ausente não quebra a leitura).
  // Lê "cifrado, senão texto"; sem chave configurada o resultado é exatamente o de antes (texto).
  const { data: tokenRow, error: erroToken } = await supabase
    .from('barracas_fiscal_token')
    .select('*')
    .eq('barraca_id', barraca.id)
    .maybeSingle()

  const linhaToken = (tokenRow ?? {}) as Record<string, unknown>
  const token = erroToken
    ? null
    : (
        await lerSegredo(
          { texto: linhaToken[colunaToken], cifrado: linhaToken[`${colunaToken}_cifrado`] },
          { barracaId: barraca.id, campo: colunaToken },
          configDoEnv(deps.env),
        )
      ).valor
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

  // Cupom: desconto do pedido (só nos itens), lido à parte para não quebrar antes da migration dos cupons.
  const { data: descontoRow } = await supabase.from('pedidos').select('desconto_cupom_centavos').eq('id', pedidoId).maybeSingle()
  const descontoCupomCentavos = Math.max(0, Math.floor(Number((descontoRow as { desconto_cupom_centavos?: number } | null)?.desconto_cupom_centavos ?? 0)))

  // Pedido grátis (cupom de 100%): total R$ 0,00, nada a faturar. Sem nota e SEM chamar a FocusNFe.
  if (totalDaNotaCentavos(itensAtivos.map((i) => i.preco_centavos_unitario * i.quantidade), descontoCupomCentavos) === 0) {
    return jsonResponse({ erro: MENSAGEM_PEDIDO_GRATIS, codigo: 'pedido_gratis' }, 422)
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
  const idsConsulta = idsItens.length > 0 ? idsItens : ['00000000-0000-0000-0000-000000000000']
  // `preco_aberto` só existe depois da migration do valor livre: sem ela, repete a consulta sem a coluna.
  let { data: itensCadastro, error: erroItensCadastro } = await supabase
    .from('itens')
    .select('id, ncm, cfop, unidade_comercial, preco_aberto')
    .in('id', idsConsulta)
  if (erroItensCadastro) {
    ;({ data: itensCadastro, error: erroItensCadastro } = await supabase
      .from('itens')
      .select('id, ncm, cfop, unidade_comercial')
      .in('id', idsConsulta))
  }

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
  const descontosPorItem = ratearDesconto(
    itensAtivos.map((i) => i.preco_centavos_unitario * i.quantidade),
    descontoCupomCentavos,
  )

  // Taxa de serviço da comanda (interruptor `nfce_incluir_taxas`, padrão desligado = fora da nota, como sempre).
  // Ligado e o pedido sendo rodada de comanda FECHADA com taxa: a nota leva a parte desta rodada, rateada entre as
  // rodadas não canceladas e depois entre os itens (`valor_outras_despesas` = vOutro por item, campo da FocusNFe
  // para NFe/NFC-e). O contador decide ligar; o sistema não dá parecer fiscal. A taxa de entrega continua fora.
  // Erro de leitura com a taxa possivelmente ligada: 500 ANTES da trava e da FocusNFe. Nota sem a taxa não se corrige.
  const taxaServicoCentavos = await parteDaTaxaServico()
  if (taxaServicoCentavos === null) {
    return jsonResponse({ erro: 'Falha ao carregar a taxa de serviço da comanda. Tente novamente.' }, 500)
  }
  const outrasDespesasPorItem = ratearTaxaServico(
    itensAtivos.map((i) => i.preco_centavos_unitario * i.quantidade),
    taxaServicoCentavos,
  )

  // Coluna ausente (migration ainda não aplicada) = recurso inexistente, vale 0 e a nota sai como hoje. Qualquer
  // outro erro devolve null (quem chama responde 500, nada é emitido).
  function colunaAusente(erro: { code?: string } | null): boolean {
    return erro?.code === '42703' || erro?.code === 'PGRST204'
  }

  async function parteDaTaxaServico(): Promise<number | null> {
    // A parte gravada na trava (antes do POST) é a que foi para a FocusNFe: retry e reconciliação a reaproveitam,
    // mesmo que o interruptor, a taxa ou as rodadas tenham mudado depois. O cupom impresso segue a nota.
    const { data: vinculo, error: erroVinculo } = await supabase
      .from('pedidos')
      .select('comanda_id, nfce_taxa_servico_centavos')
      .eq('id', pedidoId)
      .maybeSingle()
    if (erroVinculo) return colunaAusente(erroVinculo) ? 0 : null
    const v = vinculo as { comanda_id?: string | null; nfce_taxa_servico_centavos?: number | null } | null
    if (typeof v?.nfce_taxa_servico_centavos === 'number') return v.nfce_taxa_servico_centavos
    const comandaId = v?.comanda_id
    if (!comandaId) return 0
    const { data: flag, error: erroFlag } = await supabase
      .from('barracas')
      .select('nfce_incluir_taxas')
      .eq('id', barraca.id)
      .maybeSingle()
    if (erroFlag) return colunaAusente(erroFlag) ? 0 : null
    if ((flag as { nfce_incluir_taxas?: boolean } | null)?.nfce_incluir_taxas !== true) return 0
    const { data: comanda, error: erroComanda } = await supabase
      .from('comandas')
      .select('status, taxa_servico_centavos')
      .eq('id', comandaId)
      .eq('barraca_id', barraca.id)
      .maybeSingle()
    if (erroComanda) return null
    const c = comanda as { status?: string; taxa_servico_centavos?: number } | null
    if (c?.status !== 'fechada' || !((c.taxa_servico_centavos ?? 0) > 0)) return 0
    const { data: rodadas, error: erroRodadas } = await supabase
      .from('pedidos')
      .select('id, status, itens_do_pedido(quantidade, preco_centavos_unitario, removido)')
      .eq('comanda_id', comandaId)
      .eq('barraca_id', barraca.id)
    if (erroRodadas || !Array.isArray(rodadas)) return null
    // Mesma base de fechar_comanda (itens não removidos das rodadas não canceladas), ordenada por id: a parte de
    // cada rodada é a mesma seja qual for a ordem de emissão das notas.
    const validas = (rodadas as Array<{ id: string; status: string; itens_do_pedido: ItemDoPedidoRow[] | null }>)
      .filter((r) => r.status !== 'cancelado')
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    const indice = validas.findIndex((r) => r.id === pedidoId)
    if (indice < 0) return 0
    const totais = validas.map((r) =>
      (r.itens_do_pedido ?? []).filter((i) => !i.removido).reduce((s, i) => s + i.preco_centavos_unitario * i.quantidade, 0),
    )
    return ratearTaxaServico(totais, c.taxa_servico_centavos as number)[indice]
  }

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
      descricao: descricaoDoItem(item.nome_item, item.opcoes, cadastro.preco_aberto ? item.observacao : null),
      codigo_ncm: cadastro.ncm,
      cfop: cadastro.cfop,
      quantidade_comercial: item.quantidade,
      quantidade_tributavel: item.quantidade,
      valor_unitario_comercial: valorUnitario,
      valor_unitario_tributavel: valorUnitario,
      valor_bruto: valorBruto,
      ...(descontosPorItem[indice] > 0 ? { valor_desconto: descontosPorItem[indice] / 100 } : {}),
      ...(outrasDespesasPorItem[indice] > 0 ? { valor_outras_despesas: outrasDespesasPorItem[indice] / 100 } : {}),
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

  // Em centavos inteiros (sem somar float): soma dos brutos − desconto do cupom + parte da taxa de serviço (0 com o
  // interruptor desligado). A FocusNFe calcula vNF = produtos − desconto + outras despesas: o pagamento bate.
  const valorTotal =
    (itensAtivos.reduce((soma, i) => soma + i.preco_centavos_unitario * i.quantidade, 0) -
      descontosPorItem.reduce((a, b) => a + b, 0) +
      taxaServicoCentavos) /
    100

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

  const ambienteUsado = barraca.fiscal_ambiente === 'producao' ? 'producao' : 'homologacao'

  // Consulta a nota da ref (= id do pedido) na FocusNFe. null = não existe (404) ou a consulta falhou: nos dois
  // casos quem chama segue para o POST, e a FocusNFe recusa ref repetida em vez de duplicar a nota; a recusa
  // passa de novo por aqui antes de virar `erro`.
  async function consultarNota(): Promise<Record<string, unknown> | null> {
    const r = await fetch(`${baseUrl}/nfce/${pedidoId}`, { headers: { Authorization: `Basic ${auth}` } }).catch(() => null)
    return r && r.ok ? ((await r.json().catch(() => null)) as Record<string, unknown> | null) : null
  }

  // Grava o resultado no pedido e solta a trava (menos enquanto a SEFAZ ainda processa: a trava segue valendo
  // até expirar). Devolve false se o banco recusou: a nota pode EXISTIR na SEFAZ, então a chave vai pro log.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function gravar(resultado: Record<string, any>, status: string): Promise<boolean> {
    const autorizado = status === 'autorizado'
    const { error } = await supabase
      .from('pedidos')
      .update({
        nfce_status: status,
        nfce_chave: resultado?.chave_nfe ?? null,
        nfce_numero: resultado?.numero ?? null,
        nfce_mensagem: resultado?.mensagem_sefaz ?? null,
        nfce_emitida_em: autorizado ? new Date(deps.agora()).toISOString() : null,
        // Ambiente USADO nesta chamada (mesma regra do baseUrl acima). O cupom e o
        // Histórico leem isto, nunca o fiscal_ambiente atual da barraca.
        nfce_ambiente: ambienteUsado,
        // Nomes de campo conforme documentação da FocusNFe — ainda não
        // confirmados numa emissão real (nenhuma nota emitida de verdade até
        // agora), por isso aceita variantes prováveis em vez de travar num só.
        nfce_serie: resultado?.serie ?? null,
        // Nomes conferidos na doc oficial (consultar_nfce, 2026-10-06): serie,
        // protocolo (= numero_protocolo), qrcode_url, url_consulta_nf.
        nfce_protocolo: resultado?.protocolo ?? resultado?.numero_protocolo ?? null,
        nfce_qrcode_url: resultado?.qrcode_url ?? null,
        ...(status === 'processando_autorizacao' ? {} : { nfce_trava_em: null }),
        ...(autorizado ? { nfce_cpf_consumidor: cpfConsumidor, nfce_tributos_centavos: tributosTotalCentavos } : {}),
        // Só com taxa na nota (interruptor ligado): desligado, o update é o de sempre.
        ...(autorizado && taxaServicoCentavos > 0 ? { nfce_taxa_servico_centavos: taxaServicoCentavos } : {}),
      })
      .eq('id', pedidoId)
    if (error) {
      console.error('emitir-nfce: nota emitida mas não gravada', { pedidoId, chave: resultado?.chave_nfe ?? null, status, erro: error.message })
      return false
    }
    return true
  }

  function erroAoGravar(resultado: Record<string, unknown> | null): Response {
    return jsonResponse(
      { erro: `Nota emitida, mas não foi possível salvar no pedido. Chave: ${resultado?.chave_nfe ?? 'indisponível'}`, chave: resultado?.chave_nfe ?? null },
      500,
    )
  }

  // Nota achada na FocusNFe: autorizada vira `autorizado` no pedido; em processamento devolve 202; senão null.
  async function respostaDaNotaExistente(existente: Record<string, unknown> | null): Promise<Response | null> {
    if (existente?.status === 'autorizado') {
      if (!(await gravar(existente, 'autorizado'))) return erroAoGravar(existente)
      return jsonResponse({
        status: 'autorizado',
        chave: existente.chave_nfe ?? null,
        numero: existente.numero ?? null,
        mensagem: existente.mensagem_sefaz ?? null,
      })
    }
    if (existente?.status === 'processando_autorizacao') {
      return jsonResponse({ status: 'processando_autorizacao', mensagem: 'A nota está sendo autorizada. Aguarde alguns segundos e consulte de novo.' }, 202)
    }
    return null
  }

  // 1) Reconcilia ANTES de enviar: pedido com nota já criada (clique duplo, retry de rede, erro gravado por engano)
  //    nunca vai de novo para a SEFAZ.
  const jaExistente = await respostaDaNotaExistente(await consultarNota())
  if (jaExistente) return jaExistente

  // 2) Trava atômica: o UPDATE só afeta a linha se ninguém segura a vez (trava vazia ou vencida) e a nota ainda não
  //    foi autorizada; o banco serializa duas chamadas simultâneas e só uma recebe a linha de volta.
  const agoraMs = deps.agora()
  const { data: reivindicado, error: erroTrava } = await supabase
    .from('pedidos')
    .update({
      nfce_status: 'processando_autorizacao',
      nfce_trava_em: new Date(agoraMs).toISOString(),
      nfce_mensagem: null,
      // Congela a parte da taxa que vai no POST (só quando há taxa: desligado, o update é o de sempre).
      ...(taxaServicoCentavos > 0 ? { nfce_taxa_servico_centavos: taxaServicoCentavos } : {}),
    })
    .eq('id', pedidoId)
    .or('nfce_status.is.null,nfce_status.neq.autorizado')
    .or(`nfce_trava_em.is.null,nfce_trava_em.lt.${new Date(agoraMs - TRAVA_NFCE_MS).toISOString()}`)
    .select('id')
    .maybeSingle()
  if (erroTrava) {
    return jsonResponse({ erro: 'Não foi possível reservar a emissão da nota. Tente novamente.' }, 500)
  }
  if (!reivindicado) {
    // Perdeu a corrida: se a vencedora já terminou, devolve o resultado dela; senão pede para aguardar.
    const concluida = await respostaDaNotaExistente(await consultarNota())
    if (concluida) return concluida
    return jsonResponse({ erro: 'Emissão em andamento. Aguarde alguns segundos.' }, 409)
  }

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
    // Timeout/queda: a FocusNFe pode ter recebido e emitido. Não solta a trava (a próxima chamada, depois do
    // prazo, reconcilia antes de qualquer reenvio); só tenta já uma consulta, que costuma resolver.
    const existente = await respostaDaNotaExistente(await consultarNota())
    if (existente) return existente
    return jsonResponse(
      { erro: `Falha ao contatar a FocusNFe: ${String(erroRede)}. Confira o status da nota em alguns minutos antes de emitir de novo.` },
      502,
    )
  }

  let resultado = await respostaFocusNFe.json().catch(() => null)

  // Pode ficar em processando_autorizacao: consulta a mesma ref algumas
  // vezes antes de desistir (a nota segue sendo processada na FocusNFe).
  for (let tentativa = 0; tentativa < 4 && resultado?.status === 'processando_autorizacao'; tentativa++) {
    await deps.esperar(1500)
    const corpo = await consultarNota()
    if (corpo) resultado = corpo
  }

  if (!respostaFocusNFe.ok) {
    // "Ref já existe" etc.: antes de gravar `erro`, confere se a nota existe (a primeira chamada pode ter autorizado).
    const existente = await respostaDaNotaExistente(await consultarNota())
    if (existente) return existente
    const mensagem =
      resultado?.mensagem ??
      resultado?.erros?.map((e: { mensagem: string }) => e.mensagem).join('; ') ??
      'Erro desconhecido na FocusNFe'
    const { error: erroGravarErro } = await supabase
      .from('pedidos')
      .update({ nfce_status: 'erro', nfce_mensagem: mensagem, nfce_trava_em: null })
      .eq('id', pedidoId)
    if (erroGravarErro) console.error('emitir-nfce: erro da FocusNFe não gravado', { pedidoId, erro: erroGravarErro.message })
    return jsonResponse({ erro: mensagem, detalhe: resultado }, 502)
  }

  const status = resultado?.status ?? 'desconhecido'

  if (!(await gravar(resultado ?? {}, status))) return erroAoGravar(resultado)

  return jsonResponse({
    status,
    chave: resultado?.chave_nfe ?? null,
    numero: resultado?.numero ?? null,
    mensagem: resultado?.mensagem_sefaz ?? null,
  })
  }
}

export function criarHandler(deps: DependenciasNfce) {
  const interno = criarHandlerInterno(deps)
  return (req: Request): Promise<Response> => comCors(req, interno(req))
}
