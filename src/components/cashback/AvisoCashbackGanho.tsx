import { textoAvisoGanho } from '../../lib/cashbackTexto'

/** Na confirmação do pedido: "Você ganhou R$ X. Vale até DD/MM." Campos opcionais da resposta do pagamento; ausentes = nada. */
export function AvisoCashbackGanho({
  resposta,
}: {
  resposta: { cashback_gerado_centavos?: unknown; cashback_vence_em?: unknown } | null | undefined
}) {
  const texto = textoAvisoGanho(resposta?.cashback_gerado_centavos, resposta?.cashback_vence_em)
  if (!texto) return null
  return (
    <p role="status" className="rounded-mesa-md bg-mesa-success-50 px-3 py-2 text-sm font-medium text-mesa-success-700 dark:bg-mesa-success-500/15 dark:text-mesa-success-500">
      {texto}
    </p>
  )
}
