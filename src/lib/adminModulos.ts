// Painel de módulos do superadmin: constantes e regras puras (sem acesso ao banco; ver adminModulosRpc.ts).
import type { Modulo } from './modulos'

export const ROTULO_MODULO: Record<Modulo, string> = {
  whatsapp_avisos: 'WhatsApp: avisos',
  whatsapp_disparos: 'WhatsApp: disparos',
  whatsapp_bot: 'WhatsApp: bot',
  fiscal: 'Nota fiscal',
}

export const PRECO_MODULO_CENTAVOS: Record<Modulo, number> = {
  whatsapp_avisos: 3990,
  whatsapp_disparos: 3990,
  whatsapp_bot: 6990,
  fiscal: 6990,
}
export const PRECO_PACOTE_WHATSAPP_CENTAVOS = 13990
export const TAXA_ATIVACAO_FISCAL_CENTAVOS = 9900

const MENSAGENS: Record<string, string> = {
  ok: 'Salvo.',
  termo_obrigatorio: 'Informe a versão do termo aceito antes de ligar este módulo.',
  dependencia: 'Disparos exige o módulo de avisos ativo. Ative os avisos primeiro.',
  invalido: 'Dados inválidos. Confira o estado, a origem e as datas.',
  nao_autorizado: 'Sem permissão. Só o superadmin pode fazer isso.',
}

export function mensagemDoEstado(estado: string): string {
  return MENSAGENS[estado] ?? 'Resposta inesperada. Tente de novo.'
}

/** ISO de agora + 30 dias exatos (em ms, sem depender de fuso). */
export function teste30Dias(agora: Date): string {
  return new Date(agora.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString()
}
