import { useEffect, useState } from 'react'
import { Capacitor, SystemBars, SystemBarsStyle } from '@capacitor/core'

export type Tema = 'claro' | 'escuro'

const CHAVE_STORAGE = 'mesa-theme'

function lerPreferenciaSalva(): Tema | null {
  try {
    const valor = window.localStorage.getItem(CHAVE_STORAGE)
    return valor === 'claro' || valor === 'escuro' ? valor : null
  } catch {
    return null
  }
}

function preferenciaDoSistema(): Tema {
  if (typeof window === 'undefined' || !window.matchMedia) return 'claro'
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'escuro' : 'claro'
}

function aplicarClasseDark(tema: Tema): void {
  document.documentElement.classList.toggle('dark', tema === 'escuro')
}

/**
 * SystemBars.setStyle() por padrão segue o modo escuro/claro do SISTEMA
 * (Android), não o tema que o app define aqui (que pode divergir — ex.:
 * celular no claro do sistema, app no escuro). Sem essa sincronização os
 * ícones da status bar (hora, bateria, sinal) podem ficar com contraste
 * errado sobre o fundo do app. Só roda em app nativo — no PWA/navegador
 * não existe status bar pra controlar.
 */
function sincronizarStatusBarNativa(tema: Tema): void {
  if (!Capacitor.isNativePlatform()) return
  void SystemBars.setStyle({
    style: tema === 'escuro' ? SystemBarsStyle.Dark : SystemBarsStyle.Light,
  })
}

/**
 * Preferência de tema do dispositivo (não confundir com o campo `modo`
 * da barraca, que é o padrão definido por nós via Supabase). Ainda não
 * é consumido por nenhum componente — ver anotação de pendência da
 * Fase 0 sobre a precedência entre os dois mecanismos.
 */
export function useTheme() {
  const [tema, setTemaState] = useState<Tema>(
    () => lerPreferenciaSalva() ?? preferenciaDoSistema(),
  )

  useEffect(() => {
    aplicarClasseDark(tema)
    sincronizarStatusBarNativa(tema)
  }, [tema])

  function definirTema(novoTema: Tema): void {
    setTemaState(novoTema)
    try {
      window.localStorage.setItem(CHAVE_STORAGE, novoTema)
    } catch {
      // localStorage indisponível (modo privado, quota etc.) — a escolha
      // só vale para esta sessão, sem persistir entre recarregamentos.
    }
  }

  function alternarTema(): void {
    definirTema(tema === 'escuro' ? 'claro' : 'escuro')
  }

  return { tema, definirTema, alternarTema }
}
