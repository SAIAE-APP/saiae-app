import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { lerConsumo, textoConsumo, type ConsumoIa as Consumo } from '../lib/atendenteIa'

/** "X de Y conversas este mês" (lido do CRM pela function `ia-consumo`). Qualquer falha vira "consumo indisponível",
 * sem quebrar a tela nem mostrar erro técnico. Só carrega quando a loja já tem o link (a IA já foi ligada alguma vez). */
export function ConsumoIa({ barracaId }: { barracaId: string }) {
  const [estado, setEstado] = useState<{ barracaId: string; consumo: Consumo | null } | null>(null)

  useEffect(() => {
    let cancelado = false
    void supabase.functions.invoke('ia-consumo', { body: { barraca_id: barracaId } }).then(({ data, error }) => {
      if (!cancelado) setEstado({ barracaId, consumo: error ? null : lerConsumo(data) })
    })
    return () => {
      cancelado = true
    }
  }, [barracaId])

  const pronto = estado !== null && estado.barracaId === barracaId
  if (!pronto) return <p className="mt-1 text-sm text-mesa-text-secondary">Consumo do mês: carregando…</p>
  if (!estado.consumo) return <p className="mt-1 text-sm text-mesa-text-secondary">Consumo do mês: indisponível no momento.</p>
  const { texto, atingiu } = textoConsumo(estado.consumo)
  return (
    <>
      <p className="mt-1 text-sm text-mesa-text-primary">Consumo do mês: {texto}.</p>
      {atingiu && (
        <p role="status" className="mt-1 text-xs text-mesa-text-secondary">
          Limite do plano atingido: até o mês virar, a atendente só envia o link do cardápio.
        </p>
      )}
    </>
  )
}
