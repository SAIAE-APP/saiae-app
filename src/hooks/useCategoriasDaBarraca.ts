import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Categoria } from '../types/database'

/** Categorias da barraca, na ordem do cardápio (usadas só para agrupar o seletor de produtos). */
export function useCategoriasDaBarraca(barracaId: string): Categoria[] {
  const [categorias, setCategorias] = useState<Categoria[]>([])

  useEffect(() => {
    let cancelado = false

    supabase
      .from('categorias')
      .select('*')
      .eq('barraca_id', barracaId)
      .order('ordem')
      .then(({ data, error }) => {
        if (cancelado || error) return
        setCategorias((data ?? []) as Categoria[])
      })

    return () => {
      cancelado = true
    }
  }, [barracaId])

  return categorias
}
