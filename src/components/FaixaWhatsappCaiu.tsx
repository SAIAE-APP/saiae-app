import { Link } from 'react-router'
import { deveMostrarFaixaCaiu } from '../lib/visibilidadeIaCrm'
import type { Barraca } from '../types/database'

/** Aviso fixo quando o WhatsApp da loja desconectou. Não bloqueia nenhuma tela do operador. */
export function FaixaWhatsappCaiu({ barraca }: { barraca: Barraca }) {
  if (!deveMostrarFaixaCaiu(barraca, import.meta.env.VITE_MOSTRAR_WHATSAPP_AUTOMACAO)) return null
  return (
    <div className="flex min-h-11 w-full flex-wrap items-center justify-center gap-x-2 bg-mesa-neutral-900 px-4 py-2 text-center text-sm font-medium text-white dark:bg-mesa-neutral-800">
      O WhatsApp da loja desconectou. Os avisos automáticos estão parados. Reconecte em Ajustes.
      <Link to={`/${barraca.slug}/ajustes/cardapio?secao=avisos`} className="inline-flex min-h-11 items-center underline underline-offset-2">
        Ir para Ajustes
      </Link>
    </div>
  )
}
