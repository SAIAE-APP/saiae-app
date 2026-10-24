// Visibilidade da aba "WhatsApp e Automação" (escondida em todas as barracas, menos as liberadas abaixo, até o João liberar).
// As telas de Atendente IA e Integração com o CRM foram removidas; backend, eventos SAI-001 e RPCs seguem como estavam.

/** Barracas que veem a aba: a de testes do João, a do João (sai-ae-uma-barraca) e a D'Helena (piloto do módulo, liberada em 2026-10-24). */
export const SLUGS_COM_IA_E_CRM: readonly string[] = ['qa-teste-varredura', 'dhelenarestaurante', 'sai-ae-uma-barraca']

function slugLiberado(slug: string | null | undefined): boolean {
  return !!slug && SLUGS_COM_IA_E_CRM.includes(slug)
}

/** VITE_MOSTRAR_WHATSAPP_AUTOMACAO=1 (só staging/teste) reabre a aba para todos. */
export function mostrarWhatsappAutomacao(barraca: { slug?: string | null }, flag: unknown): boolean {
  return flag === '1' || slugLiberado(barraca.slug)
}

/** Faixa de queda: só quando o CRM avisou que a conexão caiu e a aba está liberada para a loja. */
export function deveMostrarFaixaCaiu(
  barraca: { slug?: string | null; whatsapp_status?: string | null },
  flag: unknown,
): boolean {
  return barraca.whatsapp_status === 'caiu' && mostrarWhatsappAutomacao(barraca, flag)
}
