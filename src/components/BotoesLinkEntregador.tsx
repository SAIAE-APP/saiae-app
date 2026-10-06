import { useState } from 'react'
import { linkDoEntregador, mensagemLinkEntregador, whatsappLinkEntregador } from '../lib/entregador'
import { Button } from './ui/Button'
import { Icone } from './ui/Icone'

/**
 * "Enviar link ao entregador" (WhatsApp sem número, o operador escolhe o
 * contato — mesmo padrão de "Chamar entregador") e "Copiar link". Sem token
 * não renderiza nada.
 */
export function BotoesLinkEntregador({
  token,
  senha,
  compacto = false,
}: {
  token: string | null | undefined
  senha: number | null
  compacto?: boolean
}) {
  const [copiado, setCopiado] = useState(false)
  const [aviso, setAviso] = useState(false)
  if (!token) return null

  function enviar() {
    setAviso(false)
    window.open(whatsappLinkEntregador(senha, token as string), '_blank', 'noopener')
    window.setTimeout(() => {
      if (!document.hidden) setAviso(true)
    }, 1500)
  }

  async function copiar() {
    try {
      await navigator.clipboard.writeText(mensagemLinkEntregador(senha, token as string))
      setCopiado(true)
      window.setTimeout(() => setCopiado(false), 2500)
    } catch {
      setAviso(true)
    }
  }

  const aviso_ = aviso && (
    <p
      role="alert"
      className="rounded-mesa-md border-l-[3px] border-mesa-warning-500 bg-mesa-warning-50 p-3 text-left text-sm font-medium text-mesa-warning-700 dark:bg-mesa-warning-500/15"
    >
      O WhatsApp não abriu. Copie o link e envie por onde preferir:
      <span className="mt-1 block break-all font-normal">{linkDoEntregador(token)}</span>
    </p>
  )

  if (compacto) {
    return (
      <div className="mt-2 flex flex-col gap-1">
        <div className="flex justify-center gap-2">
          <button
            type="button"
            onClick={enviar}
            className="flex min-h-11 items-center gap-1 px-2 text-sm font-semibold text-mesa-text-primary"
          >
            <Icone nome="two_wheeler" size={14} />
            Enviar link ao entregador
          </button>
          <button
            type="button"
            onClick={() => void copiar()}
            className="flex min-h-11 items-center gap-1 px-2 text-sm font-semibold text-mesa-text-secondary"
          >
            <Icone nome="content_copy" size={14} />
            {copiado ? 'Copiado' : 'Copiar link'}
          </button>
        </div>
        {aviso_}
      </div>
    )
  }

  return (
    <div className="mt-2 flex w-full max-w-xs flex-col gap-2">
      <Button
        variant="outline"
        size="xl"
        icon={<Icone nome="share" size={20} />}
        onClick={enviar}
        className="w-full"
      >
        Enviar link ao entregador
      </Button>
      {aviso_}
      <button
        type="button"
        onClick={() => void copiar()}
        className="min-h-11 text-center text-sm font-semibold text-mesa-text-secondary"
      >
        {copiado ? 'Link copiado' : 'Copiar link'}
      </button>
    </div>
  )
}
