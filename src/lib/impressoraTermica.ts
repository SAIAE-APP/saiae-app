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

async function autorizarEImprimir(endereco: string, bytes: Uint8Array): Promise<void> {
  await ThermalPrinter.requestPermission({ transport: 'bluetooth', address: endereco })
  await ThermalPrinter.print({
    transport: 'bluetooth',
    address: endereco,
    data: bytesToBase64(bytes),
  })
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
  const encoder = new ReceiptPrinterEncoder({ language: 'esc-pos', columns: COLUNAS_POR_LARGURA[largura] })

  const bytes = encoder
    .initialize()
    .align('center')
    .bold(true)
    .line(nomeBarraca)
    .bold(false)
    .line('Teste de impressão')
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

  let encoder = new ReceiptPrinterEncoder({ language: 'esc-pos', columns: colunas })
    .initialize()
    .align('center')
    .bold(true)
    .line(barraca.nome)
    .bold(false)

  if (barraca.cnpj) encoder = encoder.line(`CNPJ: ${formatarCnpj(barraca.cnpj)}`)

  encoder = encoder
    .line('DANFE NFC-e')
    .line('Documento Auxiliar da Nota Fiscal')
    .line('de Consumidor Eletrônica')
    .newline()
    .align('left')

  for (const item of itensValidos) {
    encoder = encoder.line(item.nome_item).table(
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
    .line(`Forma de pagamento: ${humanizarMetodo(pedido.metodo_pagamento)}`)
    .newline()
    .align('center')
    .line(`Nº ${pedido.nfce_numero ?? '-'}  Série ${pedido.nfce_serie ?? '1'}`)

  if (pedido.nfce_emitida_em) {
    encoder = encoder.line(`Emissão: ${new Date(pedido.nfce_emitida_em).toLocaleString('pt-BR')}`)
  }
  if (pedido.nfce_protocolo) {
    encoder = encoder.line(`Protocolo de autorização: ${pedido.nfce_protocolo}`)
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

  if (labelRegime) encoder = encoder.newline().line(labelRegime)

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
