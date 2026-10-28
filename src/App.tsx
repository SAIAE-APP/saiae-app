import { lazy, Suspense, useEffect } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router'
import { ehAppIOS } from './lib/plataforma'
import { useTheme } from './hooks/useTheme'
import { useAuth } from './hooks/useAuth'
import { desbloquearAudio } from './lib/sons'
import { LayoutBarraca } from './layouts/LayoutBarraca'
import { RotaProtegida } from './components/RotaProtegida'
import { GateFaceId } from './components/GateFaceId'
import { ToastProvider } from './components/ui/Toast'
import { AvisoNovaVersao } from './components/AvisoNovaVersao'
import { AvisoCookies } from './components/AvisoCookies'
import { Dashboard } from './pages/Dashboard'
import { LancarPedido } from './pages/LancarPedido'
import { ConfirmarPedido } from './pages/ConfirmarPedido'
import { Cozinha } from './pages/Cozinha'
import { Mesas } from './pages/Mesas'
import { TelaChamada } from './pages/TelaChamada'
import { GuardaAssistente } from './components/GuardaAssistente'
import { NaoEncontrado } from './pages/NaoEncontrado'
import { Login } from './pages/Login'
import { Dispatcher } from './pages/Dispatcher'

// Telas fora do balcão carregam sob demanda (o cliente do cardápio público não baixa Ajustes, Fiscal, Caixa...).
// FICAM FIXAS (lançar pedido e cozinha funcionam offline): Dashboard, LancarPedido, ConfirmarPedido, Cozinha,
// Mesas, TelaChamada, LayoutBarraca, e Login/Dispatcher/NaoEncontrado (porta de entrada). O service worker
// pré-guarda os pedaços (globPatterns **/*.js), então as telas lazy abrem offline depois da primeira carga.
// Pedaço que sumiu num deploy novo: ver lib/recargaPorPedacoAusente.ts.
const Historico = lazy(() => import('./pages/Historico').then((m) => ({ default: m.Historico })))
const Desktop = lazy(() => import('./pages/Desktop').then((m) => ({ default: m.Desktop })))
const Caixa = lazy(() => import('./pages/Caixa').then((m) => ({ default: m.Caixa })))
const Ajustes = lazy(() => import('./pages/Ajustes').then((m) => ({ default: m.Ajustes })))
const CardapioPublico = lazy(() => import('./pages/CardapioPublico').then((m) => ({ default: m.CardapioPublico })))
const PerfilCliente = lazy(() => import('./pages/PerfilCliente').then((m) => ({ default: m.PerfilCliente })))
const Privacidade = lazy(() => import('./pages/Privacidade').then((m) => ({ default: m.Privacidade })))
const RevisarCardapioExemplo = lazy(() => import('./pages/RevisarCardapioExemplo').then((m) => ({ default: m.RevisarCardapioExemplo })))
const ExcluirConta = lazy(() => import('./pages/ExcluirConta').then((m) => ({ default: m.ExcluirConta })))
const Cadastro = lazy(() => import('./pages/Cadastro').then((m) => ({ default: m.Cadastro })))
const SelecionarBarraca = lazy(() => import('./pages/SelecionarBarraca').then((m) => ({ default: m.SelecionarBarraca })))
const RetornoMercadoPago = lazy(() => import('./pages/RetornoMercadoPago').then((m) => ({ default: m.RetornoMercadoPago })))
const Configurar = lazy(() => import('./pages/Configurar').then((m) => ({ default: m.Configurar })))
const EsqueciSenha = lazy(() => import('./pages/EsqueciSenha').then((m) => ({ default: m.EsqueciSenha })))
const RedefinirSenha = lazy(() => import('./pages/RedefinirSenha').then((m) => ({ default: m.RedefinirSenha })))
const Onboarding = lazy(() => import('./pages/Onboarding').then((m) => ({ default: m.Onboarding })))
const Assinar = lazy(() => import('./pages/Assinar').then((m) => ({ default: m.Assinar })))
const Assinatura = lazy(() => import('./pages/Assinatura').then((m) => ({ default: m.Assinatura })))
const Planos = lazy(() => import('./pages/Planos').then((m) => ({ default: m.Planos })))
const Entregador = lazy(() => import('./pages/Entregador').then((m) => ({ default: m.Entregador })))
const AdminBarracas = lazy(() => import('./pages/AdminBarracas').then((m) => ({ default: m.AdminBarracas })))
const AdminBarracaLeitura = lazy(() => import('./pages/AdminBarracaLeitura').then((m) => ({ default: m.AdminBarracaLeitura })))

function Carregando() {
  return (
    <div className="flex min-h-dvh items-center justify-center p-6">
      <p className="text-mesa-text-secondary">Carregando...</p>
    </div>
  )
}

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
        <AvisoNovaVersao />
        <AvisoCookies />
        <GateFaceId key={usuario?.id ?? 'anon'}>
          <Suspense fallback={<Carregando />}>
            <Routes>
              <Route path="/onboarding" element={<Onboarding />} />
              <Route path="/login" element={<Login />} />
              {/* iOS: sem cadastro nem compra no app (Apple 3.1.1, ver lib/plataforma). */}
              <Route path="/cadastro" element={ehAppIOS() ? <Navigate to="/login" replace /> : <Cadastro />} />
              <Route path="/esqueci-senha" element={<EsqueciSenha />} />
              <Route path="/redefinir-senha" element={<RedefinirSenha />} />
              <Route path="/assinar" element={ehAppIOS() ? <Navigate to="/login" replace /> : <Assinar />} />

              {/* Páginas públicas exigidas pela Play Store (política de
                  privacidade e exclusão de conta) — segmento estático, ganha
                  de /:slug (dinâmico) na prioridade de rota do React Router
                  mesmo assim, mas fica perto das outras rotas públicas por
                  clareza. */}
              {/* Link público do entregador (sem login, fora do layout da barraca). */}
              <Route path="/e/:token" element={<Entregador />} />
              <Route path="/privacidade" element={<Privacidade />} />
              <Route path="/excluir-conta" element={<ExcluirConta />} />

              <Route path="/" element={<Dispatcher />} />

              {/* Painel do dono do sistema (superadmin). A tela esconde para quem não é, mas a barreira é o banco. */}
              <Route
                path="/admin"
                element={
                  <RotaProtegida>
                    <AdminBarracas />
                  </RotaProtegida>
                }
              />
              <Route
                path="/admin/barraca/:barracaId"
                element={
                  <RotaProtegida>
                    <AdminBarracaLeitura />
                  </RotaProtegida>
                }
              />

              {/* Assistente de configuração inicial (atrás da flag VITE_ONBOARDING_CONFIG; sem ela o Dispatcher nunca vem aqui). */}
              <Route
                path="/configurar"
                element={
                  <RotaProtegida>
                    <Configurar />
                  </RotaProtegida>
                }
              />

              {/* Callback do OAuth do Mercado Pago (sem slug): leva aos Ajustes da loja. */}
              <Route path="/ajustes" element={<RetornoMercadoPago />} />

              <Route
                path="/selecionar-barraca"
                element={
                  <RotaProtegida>
                    <GuardaAssistente escopo="lista">
                      <SelecionarBarraca />
                    </GuardaAssistente>
                  </RotaProtegida>
                }
              />

              {/* Pública, sem login — cardápio digital Fase 1 (só visualização).
                  Precisa vir antes do /:slug protegido pra ganhar a rota. */}
              <Route path="/:slug/cardapio" element={<CardapioPublico />} />
              <Route path="/:slug/perfil" element={<PerfilCliente />} />

              <Route
                path="/:slug"
                element={
                  <RotaProtegida verificarSlug>
                    <GuardaAssistente escopo="slug">
                      <LayoutBarraca />
                    </GuardaAssistente>
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
                <Route path="mesas" element={<Mesas />} />
                <Route path="chamada" element={<TelaChamada />} />
                <Route path="ajustes" element={<Ajustes categoria="conta" />} />
                <Route path="ajustes/cardapio" element={<Ajustes categoria="cardapio" />} />
                <Route path="ajustes/cardapio/exemplo" element={<RevisarCardapioExemplo />} />
                <Route path="planos" element={ehAppIOS() ? <Navigate to=".." replace /> : <Planos />} />
                <Route path="assinatura" element={ehAppIOS() ? <Navigate to=".." replace /> : <Assinatura />} />
              </Route>

              <Route path="*" element={<NaoEncontrado />} />
            </Routes>
          </Suspense>
        </GateFaceId>
      </ToastProvider>
    </BrowserRouter>
  )
}

export default App
