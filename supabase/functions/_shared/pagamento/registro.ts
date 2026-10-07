// Registro dos provedores Pix por chave. Provedor novo = um arquivo seu + uma linha aqui.
import { mercadoPago } from './mercadopago.ts'
import { PROVEDOR_PADRAO, ehProvedorValido, type ProvedorChave, type ProvedorPix } from './tipos.ts'

const REGISTRO: Partial<Record<ProvedorChave, ProvedorPix>> = {
  mercadopago: mercadoPago,
}

/** Provedor implementado, ou null (chave inválida ou ainda sem adaptador). */
export function obterProvedor(chave: unknown): ProvedorPix | null {
  return ehProvedorValido(chave) ? (REGISTRO[chave] ?? null) : null
}

/** Chave vinda de URL/coluna: ausente ou vazia = Mercado Pago (pendentes e URLs antigos). */
export function chaveDoProvedor(valor: unknown): string {
  const texto = typeof valor === 'string' ? valor.trim() : ''
  return texto || PROVEDOR_PADRAO
}

/** URL que o provedor chama. O endpoint continua `webhook-mercadopago` (nome histórico, já
 * emitido em cobranças antigas); `p` diz qual provedor interpretar. */
export function urlNotificacaoPagamento(supabaseUrl: string, pendenteId: string, provedor: ProvedorChave): string {
  return `${supabaseUrl}/functions/v1/webhook-mercadopago?pendente=${pendenteId}&p=${provedor}`
}
