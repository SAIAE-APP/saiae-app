// Endereço de cliente final que pode estar VAZIO (perfil criado só por telefone no cardápio).
// PURO (sem imports): testável no Node.
export type EnderecoParcial = {
  rua?: string | null
  numero?: string | null
  bairro?: string | null
  referencia?: string | null
}

export const SEM_ENDERECO = 'Sem endereço'

const texto = (v: string | null | undefined) => (v ?? '').trim()

/** "Rua A, 10 - Centro (perto da praça)"; sem nada cadastrado, "Sem endereço" (nunca "null, null - null"). */
export function textoEndereco(e: EnderecoParcial): string {
  const rua = texto(e.rua)
  const numero = texto(e.numero)
  const bairro = texto(e.bairro)
  if (!rua && !numero && !bairro) return SEM_ENDERECO
  const ruaNumero = [rua, numero].filter(Boolean).join(', ')
  const base = [ruaNumero, bairro].filter(Boolean).join(' - ')
  const referencia = texto(e.referencia)
  return referencia ? `${base} (${referencia})` : base
}

/** Campos do formulário de entrega: nulo vira vazio (o operador completa). */
export function camposDeEndereco(e: EnderecoParcial): { rua: string; numero: string; bairro: string; referencia: string | null } {
  return {
    rua: texto(e.rua),
    numero: texto(e.numero),
    bairro: texto(e.bairro),
    referencia: texto(e.referencia) || null,
  }
}
