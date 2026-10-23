import { Capacitor } from '@capacitor/core'

/** App iOS nativo (Capacitor). A Apple (diretriz 3.1.1, revisão de 2026-10-23) recusa o app se ele
 * deixa criar conta de empresa ou contratar/mudar plano por fora da compra dentro do app. No iOS o
 * app só serve quem já tem conta: some "Criar conta", "Nova barraca", o assistente de configuração,
 * planos, assinatura e convites de upgrade. Web e Android continuam como sempre. */
export function ehAppIOS(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'ios'
}
