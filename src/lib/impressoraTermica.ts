// Configuração/teste de impressora térmica Bluetooth (roadmap CLAUDE.md:
// impressão fica fora de escopo standalone até existir essa aba). Diferente
// por completo da v1 removida (src/lib/impressao.ts, HTML + window.print):
// aqui a app monta os bytes ESC/POS ela mesma (@point-of-sale/receipt-
// printer-encoder) e manda crus pro plugin nativo (@devlas/capacitor-
// thermal-printer), que só fala com o Bluetooth clássico (SPP) do Android —
// Web Bluetooth do navegador não serve, só fala BLE, e a maioria das
// térmicas baratas do mercado usa SPP.
//
// Só existe versão Android do app (sem pasta ios/) — por isso o check de
// suporte é "nativo e Android", não só "nativo".

import { Capacitor } from '@capacitor/core'
import { ThermalPrinter, bytesToBase64, type PrinterDevice } from '@devlas/capacitor-thermal-printer'
import ReceiptPrinterEncoder from '@point-of-sale/receipt-printer-encoder'
import type { Barraca, LarguraPapel, PedidoComItens, TipoAtendimento } from '../types/database'
import { faixaImpressao, tipoDoPedido } from './atendimento'
import { formatarTelefoneBR, type DadosEntrega } from './entrega'
import { formatarPrecoBR } from './preco'
import { humanizarMetodo } from './metodoPagamento'
import { AVISO_HOMOLOGACAO, ambienteDaNota, formatarCpf } from './fiscal'
import { linhasRodapeProcon } from './rodapeProcon'
import { semAcento } from './semAcento'

export { semAcento }

const COLUNAS_POR_LARGURA: Record<LarguraPapel, number> = {
  '58mm': 32,
  '80mm': 48,
}

export function impressoraSuportada(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android'
}

/** Dispositivos Bluetooth já PAREADOS no Android — o plugin não descobre
 * dispositivo novo, o dono pareia antes pelo Bluetooth do sistema. */
export async function dispositivosPareados(): Promise<PrinterDevice[]> {
  const { devices } = await ThermalPrinter.list({ transport: 'bluetooth' })
  return devices
}


/** Reset no início de cada impressão: ESC @ (initialize), FS . (sai do modo
 * Kanji/chinês, que embaralha a 1ª linha em impressoras genéricas), fonte A,
 * sem sublinhado/negrito/inversão, alinhamento à esquerda, tamanho normal. */
const RESET_IMPRESSORA = [
  0x1b, 0x40, 0x1c, 0x2e, 0x1b, 0x4d, 0x00, 0x1b, 0x2d, 0x00, 0x1b, 0x45, 0x00, 0x1d, 0x42, 0x00, 0x1b,
  0x61, 0x00, 0x1d, 0x21, 0x00,
]

function novoEncoder(colunas: number): ReceiptPrinterEncoder {
  return new ReceiptPrinterEncoder({ language: 'esc-pos', columns: colunas }).raw(RESET_IMPRESSORA)
}

type ErroPlugin = { code?: string; message?: string }

const EXPLICACAO_POR_CODIGO: Record<string, string> = {
  unavailable: 'Este aparelho não tem Bluetooth disponível.',
  not_found:
    'Impressora não encontrada. Ligue-a, pareie de novo no Bluetooth do celular e escolha o dispositivo outra vez.',
  permission_denied:
    'Falta a permissão de Bluetooth ("Dispositivos próximos", Android 12 ou mais novo). Libere em Configurações > Apps > Sai aê > Permissões.',
  connect_failed:
    'Não conseguiu conectar. Confira se a impressora está ligada e não está conectada a outro celular ou app; se persistir, desligue e ligue a impressora. Em Xiaomi/MIUI, libere "Dispositivos próximos" e tire a restrição de bateria do app.',
  write_failed: 'A conexão caiu durante a impressão. Tente de novo perto da impressora.',
  invalid_data: 'Dados de impressão inválidos.',
}

/** Texto pra tela: explicação em português + causa técnica real do plugin
 * (código e mensagem da exceção), pra um print do erro já dizer o motivo. */
export function descreverErroImpressao(erro: unknown): string {
  const { code, message } = (erro ?? {}) as ErroPlugin
  const explicacao = (code && EXPLICACAO_POR_CODIGO[code]) || 'Não foi possível imprimir.'
  const tecnico = [code, message].filter(Boolean).join(': ')
  return tecnico ? `${explicacao} [${tecnico}]` : explicacao
}

async function autorizarEImprimir(endereco: string, bytes: Uint8Array): Promise<void> {
  const alvo = { transport: 'bluetooth' as const, address: endereco }
  try {
    const { granted } = await ThermalPrinter.requestPermission(alvo)
    if (granted === false) {
      throw Object.assign(new Error('Permissão BLUETOOTH_CONNECT negada'), { code: 'permission_denied' })
    }

    const data = bytesToBase64(bytes)
    try {
      await ThermalPrinter.print({ ...alvo, data })
    } catch (erro) {
      // Falha de conexão SPP costuma ser transitória (socket ainda preso da
      // conexão anterior, impressora acordando) — uma 2ª tentativa curta
      // resolve boa parte dos casos sem incomodar o operador.
      if ((erro as ErroPlugin).code !== 'connect_failed') throw erro
      console.warn('[impressora] connect_failed, tentando de novo', endereco, erro)
      await new Promise((r) => setTimeout(r, 1200))
      await ThermalPrinter.print({ ...alvo, data })
    }
  } catch (erro) {
    console.error('[impressora] falha ao imprimir', endereco, erro)
    throw erro
  }
}

export async function imprimirTeste({
  endereco,
  largura,
  nomeBarraca,
}: {
  endereco: string
  largura: LarguraPapel
  nomeBarraca: string
}): Promise<void> {
  const bytes = novoEncoder(COLUNAS_POR_LARGURA[largura])
    .align('center')
    .bold(true)
    .line(semAcento(nomeBarraca))
    .bold(false)
    .line('Teste de impressao')
    .newline()
    .align('left')
    .line(new Date().toLocaleString('pt-BR'))
    .line(`Papel: ${largura}`)
    .newline(2)
    .cut()
    .encode()

  await autorizarEImprimir(endereco, bytes)
}

function formatarCnpj(cnpj: string): string {
  const digitos = cnpj.replace(/\D/g, '')
  if (digitos.length !== 14) return cnpj
  return `${digitos.slice(0, 2)}.${digitos.slice(2, 5)}.${digitos.slice(5, 8)}/${digitos.slice(8, 12)}-${digitos.slice(12, 14)}`
}

/** Grupos de 4 dígitos, mesmo formato que a chave de 44 dígitos aparece
 * impressa num cupom de NFC-e de verdade. */
function formatarChaveAcesso(chave: string): string {
  return chave.match(/.{1,4}/g)?.join(' ') ?? chave
}

function labelRegimeTributario(regime: Barraca['fiscal_regime_tributario']): string | null {
  if (regime === 'simples_nacional') return 'Regime: Simples Nacional'
  if (regime === 'mei') return 'Regime: MEI'
  return null
}

export type DadosCupomFiscal = {
  barraca: Pick<
    Barraca,
    | 'nome'
    | 'cnpj'
    | 'fiscal_regime_tributario'
    | 'fiscal_ambiente'
    | 'emitente_razao_social'
    | 'emitente_inscricao_estadual'
    | 'emitente_telefone'
    | 'emitente_endereco'
    | 'procon_endereco'
  >
  pedido: PedidoComItens
}

/**
 * Monta os bytes ESC/POS do cupom fiscal (DANFE NFC-e simplificado) —
 * separado de `imprimirCupomFiscal` pra dar pra testar sem impressora física
 * (chama direto com um pedido/barraca de mentira e confere que não lança
 * exceção). Layout modelado num cupom real de NFC-e (referência: cupom de
 * McDonald's), sem os itens que exigiriam dado que o sistema não calcula
 * (NCM/CFOP por item, valor estimado de tributos) — ver CLAUDE.md.
 *
 * Gatilho: botão "Imprimir cupom fiscal" no CardHistorico (Historico.tsx).
 */
export function montarCupomFiscal({ barraca, pedido }: DadosCupomFiscal, largura: LarguraPapel): Uint8Array {
  if (pedido.nfce_status !== 'autorizado' || !pedido.nfce_chave) {
    throw new Error('Cupom fiscal só pode ser impresso de um pedido com NFC-e autorizada.')
  }

  const colunas = COLUNAS_POR_LARGURA[largura]
  const itensValidos = pedido.itens_do_pedido.filter((item) => !item.removido)
  const totalCentavos = itensValidos.reduce(
    (soma, item) => soma + item.preco_centavos_unitario * item.quantidade,
    0,
  )
  const labelRegime = labelRegimeTributario(barraca.fiscal_regime_tributario)
  // Nota de homologação não tem valor fiscal: o aviso sai no topo e antes do corte.
  const homologacao = ambienteDaNota(pedido.nfce_ambiente, barraca.fiscal_ambiente) === 'homologacao'

  let encoder = novoEncoder(colunas).align('center')
  if (homologacao) encoder = encoder.rule().bold(true).line(AVISO_HOMOLOGACAO).bold(false).rule().newline()

  encoder = encoder
    .bold(true)
    .line(semAcento(barraca.emitente_razao_social?.trim() || barraca.nome))
    .bold(false)

  // Emitente completo: nome fantasia (se a razão social foi preenchida),
  // CNPJ, IE, endereço e telefone.
  if (barraca.emitente_razao_social?.trim() && barraca.emitente_razao_social.trim() !== barraca.nome) {
    encoder = encoder.line(semAcento(barraca.nome))
  }
  const linhaDocumentos = [
    barraca.cnpj ? `CNPJ: ${formatarCnpj(barraca.cnpj)}` : null,
    barraca.emitente_inscricao_estadual?.trim() ? `IE: ${barraca.emitente_inscricao_estadual.trim()}` : null,
  ].filter(Boolean)
  for (const linha of linhaDocumentos) encoder = encoder.line(semAcento(linha as string))
  if (barraca.emitente_endereco?.trim()) encoder = encoder.line(semAcento(barraca.emitente_endereco.trim()))
  if (barraca.emitente_telefone?.trim()) encoder = encoder.line(semAcento(`Tel: ${barraca.emitente_telefone.trim()}`))

  encoder = encoder
    .line('DANFE NFC-e')
    .line('Documento Auxiliar da Nota Fiscal')
    .line('de Consumidor Eletronica')
    .newline()
    .align('left')

  for (const item of itensValidos) {
    encoder = encoder.line(semAcento(item.nome_item)).table(
      [{ width: colunas - 10 }, { width: 10, align: 'right' }],
      [
        [
          `  ${item.quantidade}x ${formatarPrecoBR(item.preco_centavos_unitario)}`,
          formatarPrecoBR(item.preco_centavos_unitario * item.quantidade),
        ],
      ],
    )
  }

  encoder = encoder
    .rule()
    .align('right')
    .bold(true)
    .line(`TOTAL ${formatarPrecoBR(totalCentavos)}`)
    .bold(false)
    .align('left')
    .line(semAcento(`Forma de pagamento: ${humanizarMetodo(pedido.metodo_pagamento)}`))
    .newline()
    .bold(true)
    // CPF é opcional na nota, mas o campo SEMPRE aparece no cupom.
    .line(
      pedido.nfce_cpf_consumidor
        ? `CONSUMIDOR CPF: ${formatarCpf(pedido.nfce_cpf_consumidor)}`
        : 'CONSUMIDOR NAO IDENTIFICADO',
    )
    .bold(false)
    .newline()
    .align('center')
    .line(`No ${pedido.nfce_numero ?? '-'}  Serie ${pedido.nfce_serie ?? '1'}`)

  if (pedido.nfce_emitida_em) {
    encoder = encoder.line(`Emissao: ${new Date(pedido.nfce_emitida_em).toLocaleString('pt-BR')}`)
  }
  if (pedido.nfce_protocolo) {
    encoder = encoder.line(`Protocolo de autorizacao: ${pedido.nfce_protocolo}`)
  }

  encoder = encoder
    .newline()
    .line('Chave de acesso')
    .line(formatarChaveAcesso(pedido.nfce_chave))
    .newline()

  if (pedido.nfce_qrcode_url) {
    encoder = encoder.qrcode(pedido.nfce_qrcode_url, { model: 2, errorlevel: 'm' }).newline()
  }

  encoder = encoder.line('Consulte pela Chave de Acesso')

  // Lei 12.741/2012: valor aproximado dos tributos. A fonte é a alíquota
  // informada pelo emitente (a FocusNFe não calcula IBPT) — marcada no cupom.
  if (pedido.nfce_tributos_centavos !== null && pedido.nfce_tributos_centavos !== undefined) {
    encoder = encoder
      .newline()
      .line(semAcento('Tributos Totais Incidentes'))
      .line(semAcento('(Lei Federal 12.741/2012):'))
      .bold(true)
      .line(formatarPrecoBR(pedido.nfce_tributos_centavos))
      .bold(false)
      .line('Fonte: aliquota informada pelo emitente')
  }

  if (labelRegime) encoder = encoder.newline().line(semAcento(labelRegime))

  // PROCON: telefone 151 fixo + endereço da sede (texto livre da barraca).
  const [linhaProcon, ...linhasSede] = linhasRodapeProcon(barraca.procon_endereco, colunas)
  encoder = encoder.newline().rule().bold(true).line(linhaProcon).bold(false)
  for (const linha of linhasSede) encoder = encoder.line(linha)

  if (homologacao) {
    encoder = encoder.newline().align('center').rule().bold(true).line(AVISO_HOMOLOGACAO).bold(false).rule()
  }

  return encoder.newline(2).cut().encode()
}

export async function imprimirCupomFiscal({
  endereco,
  largura,
  barraca,
  pedido,
}: {
  endereco: string
  largura: LarguraPapel
} & DadosCupomFiscal): Promise<void> {
  const bytes = montarCupomFiscal({ barraca, pedido }, largura)
  await autorizarEImprimir(endereco, bytes)
}

export type DadosComanda = {
  nomeBarraca: string
  cnpj?: string | null
  /** Endereço da sede do PROCON (`barracas.procon_endereco`); vazio imprime só "PROCON 151". */
  proconEndereco?: string | null
  senha: number | null
  criadoEm: string
  mesa: string | null
  /** Nome do cliente (opcional, qualquer modo). Na Entrega já sai em "ENTREGAR PARA". */
  clienteNome?: string | null
  viagem: boolean
  /** Opcional: sem ele deriva de mesa/viagem (pedido antigo, cardápio digital). */
  tipo?: TipoAtendimento | null
  observacao: string | null
  metodoPagamento?: string | null
  /** Pedido de Entrega: nome, telefone e endereço abaixo da faixa. */
  entrega?: DadosEntrega | null
  /** Taxa cobrada, em linha separada do total (que já a inclui). */
  taxaEntregaCentavos?: number
  itens: { nome: string; quantidade: number; observacao: string | null; precoCentavos: number }[]
}

function centralizar(texto: string, largura: number): string {
  const sobra = Math.max(0, largura - texto.length)
  const esquerda = Math.floor(sobra / 2)
  return ' '.repeat(esquerda) + texto + ' '.repeat(sobra - esquerda)
}

/** Comanda (cupom NÃO fiscal): barra preta com a senha em branco no topo,
 * dados da barraca, tipo, itens em QTD/DESCRIÇÃO/VALOR com observação
 * embaixo, total e forma de pagamento. Sem dado fiscal (chave, QR,
 * protocolo, tributos). Separado de `imprimirComanda` pra testar sem impressora. */
export function montarComanda(dados: DadosComanda, largura: LarguraPapel): Uint8Array {
  const colunas = COLUNAS_POR_LARGURA[largura]
  const taxa = dados.taxaEntregaCentavos ?? 0
  const total = dados.itens.reduce((soma, i) => soma + i.precoCentavos * i.quantidade, 0) + taxa

  // Barra preta = texto invertido (GS B 1) em tamanho 4x na largura, que divide
  // 32 e 48 colunas exatamente: a linha de espaços pinta a largura toda.
  // Linhas de espaço acima/abaixo (altura normal) dão corpo à barra.
  const colunasBarra = colunas / 4
  const espacosBarra = ' '.repeat(colunasBarra)
  const senhaTexto = dados.senha !== null ? String(dados.senha).padStart(3, '0') : '---'

  let encoder = novoEncoder(colunas)
    .align('left')
    .invert(true)
    .size(4, 1)
    .line(espacosBarra)
    .size(4, 3)
    .line(centralizar(senhaTexto, colunasBarra))
    .size(4, 1)
    .line(espacosBarra)
    .size(1, 1)
    .invert(false)
    .newline()
    .align('center')

  // Retirada x Entrega em destaque logo abaixo da senha: 2x de largura e
  // altura, "*** RETIRADA ***" (16 colunas) ainda cabe nas 32 do papel 58mm.
  const tipo = dados.tipo ?? tipoDoPedido({ tipo_atendimento: null, mesa: dados.mesa, viagem: dados.viagem })
  const faixa = faixaImpressao(tipo)
  if (faixa) encoder = encoder.bold(true).size(2, 2).line(faixa).size(1, 1).bold(false).newline()

  encoder = encoder.bold(true).line(semAcento(dados.nomeBarraca)).bold(false)

  if (dados.cnpj) encoder = encoder.line(`CNPJ: ${formatarCnpj(dados.cnpj)}`)

  encoder = encoder.line(new Date(dados.criadoEm).toLocaleString('pt-BR'))
  if (!faixa) {
    encoder = encoder
      .bold(true)
      .line(dados.mesa ? semAcento(`Mesa ${dados.mesa}`) : 'BALCAO')
      .bold(false)
  }
  const nomeCliente = dados.entrega ? '' : (dados.clienteNome ?? '').trim()
  if (nomeCliente) {
    encoder = encoder.bold(true).line(semAcento(`Cliente: ${nomeCliente}`)).bold(false)
  }
  encoder = encoder.align('left').rule()

  if (dados.entrega) {
    encoder = encoder.bold(true).line('ENTREGAR PARA:').bold(false)
    encoder = encoder.line(semAcento(dados.entrega.nome.trim()))
    encoder = encoder.line(semAcento(formatarTelefoneBR(dados.entrega.telefone)))
    if (dados.entrega.rua.trim()) {
      encoder = encoder.line(
        semAcento(`${dados.entrega.rua.trim()}, ${dados.entrega.numero.trim()} - ${dados.entrega.bairro.trim()}`),
      )
    }
    if (dados.entrega.referencia?.trim()) {
      encoder = encoder.line(semAcento(`Ref: ${dados.entrega.referencia.trim()}`))
    }
    encoder = encoder.rule()
  }

  const colunasTabela = [{ width: 4 }, { width: colunas - 14 }, { width: 10, align: 'right' as const }]
  encoder = encoder.bold(true).table(colunasTabela, [['QTD', 'DESCRICAO', 'VALOR']]).bold(false).rule()

  for (const item of dados.itens) {
    encoder = encoder.table(colunasTabela, [
      [`${item.quantidade}x`, semAcento(item.nome), formatarPrecoBR(item.precoCentavos * item.quantidade)],
    ])
    if (item.observacao) encoder = encoder.line(semAcento(`  > ${item.observacao}`))
  }

  encoder = encoder.rule()
  if (dados.observacao) encoder = encoder.line('Obs:').line(semAcento(dados.observacao)).rule()

  if (taxa > 0) {
    const valorTaxa = formatarPrecoBR(taxa)
    const rotuloTaxa = 'Taxa de entrega'
    encoder = encoder.line(`${rotuloTaxa}${' '.repeat(Math.max(1, colunas - rotuloTaxa.length - valorTaxa.length))}${valorTaxa}`)
  }

  // TOTAL em dobro de largura/altura: metade das colunas, rótulo à esquerda e valor à direita.
  const valorTotal = formatarPrecoBR(total)
  const espacoTotal = Math.max(1, colunas / 2 - 'TOTAL'.length - valorTotal.length)
  encoder = encoder
    .bold(true)
    .size(2, 2)
    .line(`TOTAL${' '.repeat(espacoTotal)}${valorTotal}`)
    .size(1, 1)
    .bold(false)

  if (dados.metodoPagamento) {
    encoder = encoder.line(semAcento(`Pagamento: ${humanizarMetodo(dados.metodoPagamento)}`))
  }

  // PROCON: a autuação exige o 151 e a sede em tudo que é entregue ao consumidor.
  const [linhaProcon, ...linhasSede] = linhasRodapeProcon(dados.proconEndereco, colunas)
  encoder = encoder.newline().rule().align('center').bold(true).line(linhaProcon).bold(false)
  for (const linha of linhasSede) encoder = encoder.line(linha)

  return encoder.newline().line('Obrigado! Sai ae').newline(3).cut().encode()
}

export async function imprimirComanda({
  endereco,
  largura,
  dados,
}: {
  endereco: string
  largura: LarguraPapel
  dados: DadosComanda
}): Promise<void> {
  await autorizarEImprimir(endereco, montarComanda(dados, largura))
}
