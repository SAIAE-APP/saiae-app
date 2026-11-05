import type { Barraca } from '../types/database'

export type BarracaComPapel = {
  barraca_id: string
  papel: string
  barraca: Barraca
  /** Só presente quando `papel === 'suporte'` — até quando o acesso vale. */
  expiraEmSuporte?: string
}

/**
 * Barraca arquivada some da leitura de `barracas` (RLS), mas a linha de `usuarios_barracas` continua:
 * o join volta com `barracas: null`. Sem descartar essas linhas, `b.barraca.slug` quebra o app inteiro da conta.
 */
export function montarBarracasDoUsuario(
  linhas: ReadonlyArray<{ barraca_id: unknown; papel: unknown; barracas: unknown }>,
): BarracaComPapel[] {
  return linhas
    .filter((linha) => linha.barracas != null)
    .map((linha) => ({
      barraca_id: linha.barraca_id as string,
      papel: linha.papel as string,
      barraca: linha.barracas as unknown as Barraca,
    }))
}
