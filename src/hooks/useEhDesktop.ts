import { useEffect, useState } from 'react'

// Mesmo breakpoint `md` do Tailwind (768px, default do projeto — sem
// override em tokens.css/@theme).
const CONSULTA_MD = '(min-width: 768px)'

/**
 * Única forma confiável de saber em JS se a tela está no breakpoint
 * desktop (`md:` pra cima) — necessário porque coisas como SidebarDesktop
 * são só CSS (`hidden md:flex`): um elemento com `display: none` continua
 * existindo no DOM (e uma ref pra ele continua "válida"), então checar só
 * a presença do elemento não diz se ele está de fato visível pro usuário.
 */
export function useEhDesktop(): boolean {
  const [ehDesktop, setEhDesktop] = useState(() => window.matchMedia(CONSULTA_MD).matches)

  useEffect(() => {
    const mql = window.matchMedia(CONSULTA_MD)
    function aoMudar() {
      setEhDesktop(mql.matches)
    }
    mql.addEventListener('change', aoMudar)
    return () => mql.removeEventListener('change', aoMudar)
  }, [])

  return ehDesktop
}
