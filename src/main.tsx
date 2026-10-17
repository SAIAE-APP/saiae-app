import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { GuardaErroApp } from './components/GuardaErroApp'
import { instalarCapturaDeErros } from './lib/erroApp'

instalarCapturaDeErros()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <GuardaErroApp>
      <App />
    </GuardaErroApp>
  </StrictMode>,
)
