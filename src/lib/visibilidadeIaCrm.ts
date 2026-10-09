// Atendente IA e Integração com CRM ficam ESCONDIDOS em Ajustes para clientes novos (decisão do João, 2026-10-09:
// produto focado em um app redondo; a integração app + CRM é fase futura). Só a TELA some: o backend, os eventos
// SAI-001, as RPCs e as functions não mudam, e as mensagens automáticas de status (aviso de pedido pronto etc.,
// enviadas pelo CRM) continuam funcionando. Quem já usa não perde o acesso; o João reabre por variável.

/** VITE_MOSTRAR_ATENDENTE_IA=1 (staging) reabre a seção para todos. */
export function mostrarAtendenteIa(barraca: { ia_habilitada?: boolean | null }, flag: unknown): boolean {
  return flag === '1' || barraca.ia_habilitada === true
}

/** VITE_MOSTRAR_INTEGRACAO_CRM=1 (staging) reabre a seção para todos. Sem a flag, só aparece se a barraca JÁ está
 * conectada (URL salva, segredo gerado ou envio ligado). Enquanto o estado não chegou, fica escondida. */
export function mostrarIntegracaoCrm(
  estado: { url?: string | null; ativo?: boolean; segredo_configurado?: boolean } | null,
  flag: unknown,
): boolean {
  if (flag === '1') return true
  if (!estado) return false
  return Boolean(estado.ativo || estado.segredo_configurado || (estado.url ?? '').trim() !== '')
}
