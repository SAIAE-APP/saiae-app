import { useEffect, useState } from 'react'
import { useLocation } from 'react-router'
import { Button } from './ui/Button'
import { abrirLinkExterno } from '../lib/abrirExternoApp'
import { lerConsentimento, salvarConsentimento, URL_PRIVACIDADE } from '../lib/consentimento'
import { carregarMedicao, rotaComMedicao } from '../lib/medicao'
import type { DocumentoMedicao, JanelaMedicao } from '../lib/medicao'

const carregar = () => carregarMedicao(window as unknown as JanelaMedicao, document as unknown as DocumentoMedicao)

/** Aviso de cookies das telas de entrada (mesma regra do site). Já aceito: só carrega a medição. */
export function AvisoCookies() {
  const { pathname } = useLocation()
  const [escolha, setEscolha] = useState(() => lerConsentimento())
  const naRota = rotaComMedicao(pathname)
  useEffect(() => {
    if (naRota && escolha === 'granted') carregar()
  }, [naRota, escolha])
  if (!naRota || escolha !== null) return null

  function decidir(valor: 'granted' | 'denied') {
    salvarConsentimento(valor)
    setEscolha(valor)
  }

  return (
    <div
      role="region"
      aria-label="Aviso de cookies"
      className="fixed inset-x-4 bottom-[calc(env(safe-area-inset-bottom)+16px)] z-50 mx-auto flex max-w-[560px] flex-wrap items-center justify-between gap-3 rounded-mesa-xl border border-mesa-border-default bg-mesa-surface p-4 shadow-lg"
    >
      <p className="min-w-[240px] flex-1 text-sm text-mesa-text-primary">
        Usamos cookies para medir de onde vêm os cadastros e melhorar o Sai aê. Detalhes na{' '}
        <a
          href={URL_PRIVACIDADE}
          className="font-medium underline"
          onClick={(e) => {
            e.preventDefault()
            abrirLinkExterno(URL_PRIVACIDADE)
          }}
        >
          Política de Privacidade
        </a>
        .
      </p>
      <span className="flex gap-2">
        <Button variant="outline" size="md" onClick={() => decidir('denied')}>
          Recusar
        </Button>
        <Button size="md" onClick={() => decidir('granted')}>
          Aceitar
        </Button>
      </span>
    </div>
  )
}
