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
import type { Barraca, LarguraPapel, PedidoComItens } from '../types/database'
import { formatarPrecoBR } from './preco'
import { humanizarMetodo } from './metodoPagamento'

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

/** Impressoras térmicas genéricas (as "BlueTooth Printer" chinesas) quase
 * nunca têm a tabela de caracteres que o encoder assume — acento saía "?".
 * Tirar o acento é o único jeito garantido em qualquer modelo. */
export function semAcento(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/×/g, 'x')
    .replace(/[–—]/g, '-')
    .replace(/[^\x20-\x7E]/g, '')
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
    'Falta a permissão de Bluetooth ("Dispositivos próximos"). Libere em Configurações > Apps > Sai aê > Permissões.',
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
  barraca: Pick<Barraca, 'nome' | 'cnpj' | 'fiscal_regime_tributario'>
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
 * Ainda sem gatilho de UI que chame isso (decisão de produto em aberto,
 * ver CLAUDE.md) — só o modelo pronto, como pedido.
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

  let encoder = novoEncoder(colunas)
    .align('center')
    .bold(true)
    .line(semAcento(barraca.nome))
    .bold(false)

  if (barraca.cnpj) encoder = encoder.line(`CNPJ: ${formatarCnpj(barraca.cnpj)}`)

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
    .align('center')
    .line(`No ${pedido.nfce_numero ?? '-'}  Série ${pedido.nfce_serie ?? '1'}`)

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

  if (labelRegime) encoder = encoder.newline().line(semAcento(labelRegime))

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
  senha: number | null
  criadoEm: string
  mesa: string | null
  viagem: boolean
  observacao: string | null
  itens: { nome: string; quantidade: number; observacao: string | null; precoCentavos: number }[]
}

/** Comanda de cozinha (não fiscal): senha grande, mesa/viagem, itens com
 * observação, total. Separado de `imprimirComanda` pra testar sem impressora. */
export function montarComanda(dados: DadosComanda, largura: LarguraPapel): Uint8Array {
  const total = dados.itens.reduce((soma, i) => soma + i.precoCentavos * i.quantidade, 0)

  let encoder = novoEncoder(COLUNAS_POR_LARGURA[largura])
    .align('center')
    .bold(true)
    .line(semAcento(dados.nomeBarraca))
    .bold(false)
    .newline()
    .line('SENHA')
    .size(3, 3)
    .bold(true)
    .line(dados.senha !== null ? String(dados.senha).padStart(3, '0') : '---')
    .bold(false)
    .size(1, 1)
    .newline()
    .align('left')
    .line(new Date(dados.criadoEm).toLocaleString('pt-BR'))
    .bold(true)
    .line(dados.viagem ? 'VIAGEM' : dados.mesa ? semAcento(`Mesa ${dados.mesa}`) : 'Sem mesa')
    .bold(false)
    .rule()

  for (const item of dados.itens) {
    encoder = encoder.bold(true).line(semAcento(`${item.quantidade}x ${item.nome}`)).bold(false)
    if (item.observacao) encoder = encoder.line(semAcento(`  > ${item.observacao}`))
  }

  encoder = encoder.rule()
  if (dados.observacao) encoder = encoder.line('Obs:').line(semAcento(dados.observacao)).rule()

  return encoder
    .align('right')
    .bold(true)
    .line(`TOTAL ${formatarPrecoBR(total)}`)
    .bold(false)
    .newline(3)
    .cut()
    .encode()
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
