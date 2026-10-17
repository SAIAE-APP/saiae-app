import { Component, type ReactNode } from 'react'
import { registrarErroApp } from '../lib/erroApp'

/** Em vez de tela branca quando um erro de renderização derruba o app: registra e oferece recarregar. */
export class GuardaErroApp extends Component<{ children: ReactNode }, { caiu: boolean }> {
  state = { caiu: false }

  static getDerivedStateFromError() {
    return { caiu: true }
  }

  componentDidCatch(erro: Error) {
    registrarErroApp('tela_branca', erro)
  }

  render() {
    if (!this.state.caiu) return this.props.children
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 p-6 text-center">
        <p className="text-base">Algo deu errado. Toque para tentar de novo.</p>
        <button type="button" className="rounded-lg border px-4 py-2" onClick={() => window.location.reload()}>
          Recarregar
        </button>
      </div>
    )
  }
}
