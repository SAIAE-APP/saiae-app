import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { GuardaErroApp } from './components/GuardaErroApp'
import { instalarCapturaDeErros } from './lib/erroApp'
import { capturarUtm } from './lib/utm'
import { instalarRecargaPorPedacoAusente } from './lib/recargaPorPedacoAusente'

instalarCapturaDeErros()
instalarRecargaPorPedacoAusente()
capturarUtm(window.location.search)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <GuardaErroApp>
      <App />
    </GuardaErroApp>
  </StrictMode>,
)
