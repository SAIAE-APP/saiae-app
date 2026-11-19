import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

/** `fiscal_contratacao_aberta()`: só o booleano true abre; erro, null ou carregando valem como fechado. */
export function useFiscalContratacaoAberta(): boolean {
  const [aberta, setAberta] = useState(false)

  useEffect(() => {
    let cancelado = false
    supabase
      .rpc('fiscal_contratacao_aberta')
      .then(({ data, error }) => {
        if (!cancelado) setAberta(!error && data === true)
      })
      .then(undefined, () => {
        if (!cancelado) setAberta(false)
      })
    return () => {
      cancelado = true
    }
  }, [])

  return aberta
}
