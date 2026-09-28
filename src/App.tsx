import { useEffect } from 'react'
import { BrowserRouter, Route, Routes } from 'react-router'
import { useTheme } from './hooks/useTheme'
import { useAuth } from './hooks/useAuth'
import { desbloquearAudio } from './lib/sons'
import { LayoutBarraca } from './layouts/LayoutBarraca'
import { RotaProtegida } from './components/RotaProtegida'
import { GateFaceId } from './components/GateFaceId'
import { ToastProvider } from './components/ui/Toast'
import { Dashboard } from './pages/Dashboard'
import { LancarPedido } from './pages/LancarPedido'
import { ConfirmarPedido } from './pages/ConfirmarPedido'
import { Cozinha } from './pages/Cozinha'
import { Historico } from './pages/Historico'
import { Desktop } from './pages/Desktop'
import { Caixa } from './pages/Caixa'
import { TelaChamada } from './pages/TelaChamada'
import { Ajustes } from './pages/Ajustes'
import { CardapioPublico } from './pages/CardapioPublico'
import { NaoEncontrado } from './pages/NaoEncontrado'
import { Login } from './pages/Login'
import { Cadastro } from './pages/Cadastro'
import { SelecionarBarraca } from './pages/SelecionarBarraca'
import { EsqueciSenha } from './pages/EsqueciSenha'
import { RedefinirSenha } from './pages/RedefinirSenha'
import { Dispatcher } from './pages/Dispatcher'
import { Onboarding } from './pages/Onboarding'
import { Assinar } from './pages/Assinar'
import { Assinatura } from './pages/Assinatura'
import { Planos } from './pages/Planos'

function App() {
  // Fonte única de verdade do tema claro/escuro: preferência manual do
  // usuário (localStorage) > prefers-color-scheme do dispositivo. O campo
  // modo da barraca no Supabase é legado e não é mais lido por nada.
  useTheme()

  const { usuario } = useAuth()

  // Destrava o áudio dos sons de notificação no primeiro toque/clique em
  // qualquer lugar do app — navegadores só liberam reprodução depois de um
  // gesto do usuário. Uma vez só, não precisa remover o listener de novo.
  useEffect(() => {
    window.addEventListener('pointerdown', desbloquearAudio, { once: true })
  }, [])

  return (
    <BrowserRouter>
      {/* key força remontar ao trocar de usuário (login/logout na mesma
          aba) — reseta bloqueado/jaTentouAuto do zero em vez de herdar
          estado de quem usou o aparelho antes. */}
      <ToastProvider>
        <GateFaceId key={usuario?.id ?? 'anon'}>
          <Routes>
            <Route path="/onboarding" element={<Onboarding />} />
            <Route path="/login" element={<Login />} />
            <Route path="/cadastro" element={<Cadastro />} />
            <Route path="/esqueci-senha" element={<EsqueciSenha />} />
            <Route path="/redefinir-senha" element={<RedefinirSenha />} />
            <Route path="/assinar" element={<Assinar />} />

            <Route path="/" element={<Dispatcher />} />

            <Route
              path="/selecionar-barraca"
              element={
                <RotaProtegida>
                  <SelecionarBarraca />
                </RotaProtegida>
              }
            />

            {/* Pública, sem login — cardápio digital Fase 1 (só visualização).
                Precisa vir antes do /:slug protegido pra ganhar a rota. */}
            <Route path="/:slug/cardapio" element={<CardapioPublico />} />

            <Route
              path="/:slug"
              element={
                <RotaProtegida verificarSlug>
                  <LayoutBarraca />
                </RotaProtegida>
              }
            >
              <Route index element={<Dashboard />} />
              <Route path="lancar" element={<LancarPedido />} />
              <Route path="confirmar" element={<ConfirmarPedido />} />
              <Route path="cozinha" element={<Cozinha />} />
              <Route path="historico" element={<Historico />} />
              <Route path="desktop" element={<Desktop />} />
              <Route path="caixa" element={<Caixa />} />
              <Route path="chamada" element={<TelaChamada />} />
              <Route path="ajustes" element={<Ajustes />} />
              <Route path="planos" element={<Planos />} />
              <Route path="assinatura" element={<Assinatura />} />
            </Route>

            <Route path="*" element={<NaoEncontrado />} />
          </Routes>
        </GateFaceId>
      </ToastProvider>
    </BrowserRouter>
  )
}

export default App
