// Atendente IA e Integração com CRM ficam ESCONDIDOS em Ajustes de TODAS as barracas, exceto a de teste
// (decisão do João, 2026-10-09: produto focado em um app redondo; IA para clientes e integração app + CRM são fase
// futura). Só a TELA some: o backend, os eventos SAI-001, as RPCs e as functions não mudam, e as mensagens
// automáticas de status (aviso de pedido pronto etc., enviadas pelo CRM) continuam funcionando.

/** Única barraca que ainda vê as duas seções (a de testes do João). */
export const SLUGS_COM_IA_E_CRM: readonly string[] = ['qa-teste-varredura']

function slugLiberado(slug: string | null | undefined): boolean {
  return !!slug && SLUGS_COM_IA_E_CRM.includes(slug)
}

/** VITE_MOSTRAR_ATENDENTE_IA=1 (só staging/teste) reabre a seção para todos. */
export function mostrarAtendenteIa(barraca: { slug?: string | null }, flag: unknown): boolean {
  return flag === '1' || slugLiberado(barraca.slug)
}

/** VITE_MOSTRAR_INTEGRACAO_CRM=1 (só staging/teste) reabre a seção para todos. */
export function mostrarIntegracaoCrm(barraca: { slug?: string | null }, flag: unknown): boolean {
  return flag === '1' || slugLiberado(barraca.slug)
}
