// Módulos pagos: quem ativa é o admin (servidor); o app só mostra ou esconde. `null` = ainda sem resposta = desligado.
export type Modulo = 'whatsapp_avisos' | 'whatsapp_disparos' | 'whatsapp_bot' | 'fiscal'

const WHATSAPP: readonly Modulo[] = ['whatsapp_avisos', 'whatsapp_disparos', 'whatsapp_bot']

export function temModulo(modulos: readonly string[] | null, m: Modulo): boolean {
  return modulos?.includes(m) === true
}

/** Aba "WhatsApp e Automação": qualquer um dos três módulos de WhatsApp. */
export function mostrarWhatsappAutomacao(modulos: readonly string[] | null): boolean {
  return WHATSAPP.some((m) => temModulo(modulos, m))
}

/** Faixa de queda: só quando o CRM avisou que a conexão caiu e a loja tem algum módulo de WhatsApp. */
export function deveMostrarFaixaCaiu(barraca: { whatsapp_status?: string | null }, modulos: readonly string[] | null): boolean {
  return barraca.whatsapp_status === 'caiu' && mostrarWhatsappAutomacao(modulos)
}

/** Caixa "cliente aceitou promoções" do Confirmar Pedido: só com o módulo de disparos. */
export function mostrarCaixaPromocoes(modulos: readonly string[] | null): boolean {
  return temModulo(modulos, 'whatsapp_disparos')
}
