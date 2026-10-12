// Importação do cardápio: liga o núcleo (cardapioImportacaoNucleo.ts) ao cliente real do supabase. Tudo passa pela RLS,
// como o cadastro manual (vale para o dono e para o suporte com acesso ativo). Sem RPC nem migration.
import { supabase } from './supabase'
import type { CardapioExistente, ItemParaCriar } from './importarCardapio.ts'
import {
  ErroImportacaoCardapio,
  carregarCardapioExistenteCom,
  gravarCardapioImportadoCom,
  type ResumoImportacaoCardapio,
} from './cardapioImportacaoNucleo.ts'

export { ErroImportacaoCardapio }
export type { ResumoImportacaoCardapio }

export function carregarCardapioExistente(barracaId: string): Promise<CardapioExistente> {
  return carregarCardapioExistenteCom(supabase, barracaId)
}

export function gravarCardapioImportado(
  barracaId: string,
  existente: CardapioExistente,
  itens: readonly ItemParaCriar[],
  aoProgredir?: (feitos: number, total: number) => void,
): Promise<ResumoImportacaoCardapio> {
  return gravarCardapioImportadoCom(supabase, barracaId, existente, itens, aoProgredir)
}
