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
import type { LarguraPapel } from '../types/database'

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
