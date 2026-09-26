import { useEffect } from 'react'
import { Outlet, useLocation, useParams } from 'react-router'
import clsx from 'clsx'
import { useBarraca } from '../hooks/useBarraca'
import { useSincronizacao } from '../hooks/useSincronizacao'
import { useRealtimePedidos } from '../hooks/useRealtimePedidos'
import { useAssinaturaBarraca } from '../hooks/useAssinaturaBarraca'
import { NaoEncontrado } from '../pages/NaoEncontrado'
import { Planos } from '../pages/Planos'
import { BarraNavegacao } from '../components/BarraNavegacao'
import { SidebarDesktop } from '../components/SidebarDesktop'
import { BannerTrial } from '../components/BannerTrial'
import { BarracaContext, SincronizacaoContext } from './contextoBarraca'
import { PedidosContext } from './contextoPedidos'

export function LayoutBarraca() {
  const { slug } = useParams<{ slug: string }>()
  const { barraca, carregando, erro } = useBarraca(slug ?? '')
  const sincronizacao = useSincronizacao()
  const { pedidos, status, pedidosCarregados, aplicarPatchPedido, aplicarPatchItem } =
    useRealtimePedidos(barraca?.id ?? '')
  const { assinatura } = useAssinaturaBarraca(slug ?? '')
  const location = useLocation()
  const emTelaDeChamada = location.pathname.endsWith('/chamada')
  const emCozinha = location.pathname.endsWith('/cozinha')
  const emConfirmarPedido = location.pathname.endsWith('/confirmar')
  const emDashboard = location.pathname === `/${slug}` || location.pathname === `/${slug}/`
  const emPlanos = location.pathname.endsWith('/planos')
  const emHistorico = location.pathname.endsWith('/historico')
  const emAjustes = location.pathname.endsWith('/ajustes')
  const emFaturamento = location.pathname.endsWith('/desktop')
  // Telas de gestão (dono da barraca) ganham sidebar no desktop em vez da
  // BarraNavegacao inferior; Lançar/Cozinha/Chamada continuam mobile-only
  // em qualquer largura — separação decidida com o dono do produto em
  // 2026-09-26 (ver CLAUDE.md).
  const mostrarSidebar = emDashboard || emHistorico || emAjustes || emFaturamento
  // Regra inviolável do design system (seção 2.2): o glow atmosférico nunca
  // aparece na Cozinha (atrapalha a leitura do semáforo) nem na Chamada
  // (que já tem fundo escuro absoluto próprio, com layout fora daqui).
  const semGradiente = emCozinha || emTelaDeChamada
  // Confirmar Pedido e o Dashboard são telas de destino/fluxo (como a
  // Chamada), não abas — sem bottom nav, igual aos mockups 04-confirmar-
  // pedido e 02-caixa. Dashboard mantém o gradiente (regra acima é só
  // sobre Cozinha/Chamada).
  const semBottomNav = emTelaDeChamada || emConfirmarPedido || emDashboard

  useEffect(() => {
    if (!barraca) return

    document.title = barraca.nome

    document
      .getElementById('app-manifest')
      ?.setAttribute('href', `/${barraca.slug}/manifest.webmanifest`)

    // Cor de marca fixa do Sai aê (mostarda, IDV "Sai aê" — antes âmbar 500, redesign "Speed Bento
    // POS") — não é mais por barraca.
    document.getElementById('app-theme-color')?.setAttribute('content', '#FFC21A')

    document
      .getElementById('app-apple-icon')
      ?.setAttribute('href', barraca.logo_url ?? '/icons/apple-touch-icon.png')
  }, [barraca])

  if (carregando) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-mesa-bg-base">
        <p className="text-mesa-text-secondary">Carregando...</p>
      </div>
    )
  }

  if (erro || !barraca) {
    return <NaoEncontrado />
  }

  const estadoPedidos = {
    pedidos,
    status,
    pedidosCarregados,
    contagemAFazer: pedidos.filter((p) => p.status === 'a_fazer').length,
    contagemPronto: pedidos.filter((p) => p.status === 'pronto').length,
    aplicarPatchPedido,
    aplicarPatchItem,
  }

  // Fail-open enquanto a assinatura ainda não voltou (nunca bloqueia a
  // tela esperando rede — regra técnica inviolável do app): só barra
  // quando já sabemos de verdade que o acesso caiu. A escrita continua
  // protegida no servidor (RLS) mesmo nesse intervalo.
  const acessoBloqueado = assinatura !== null && !assinatura.tem_acesso && !emPlanos
  const mostraBannerTrial =
    !emPlanos && !emCozinha && !emTelaDeChamada && assinatura?.eh_dono && assinatura.status === 'trialing'

  return (
    <BarracaContext.Provider value={barraca}>
      <SincronizacaoContext.Provider value={sincronizacao}>
        <PedidosContext.Provider value={estadoPedidos}>
          {mostraBannerTrial && <BannerTrial assinatura={assinatura} />}
          {mostrarSidebar && !acessoBloqueado && <SidebarDesktop />}
          <div
            className={clsx(
              'min-h-dvh',
              semGradiente ? 'bg-mesa-bg-kanban' : '[background:var(--mesa-gradient-atmosphere)]',
              mostrarSidebar && !acessoBloqueado && 'md:pl-64',
            )}
          >
            {acessoBloqueado ? <Planos /> : <Outlet />}
          </div>
          {!semBottomNav && !acessoBloqueado && (
            <div className={mostrarSidebar ? 'md:hidden' : undefined}>
              <BarraNavegacao />
            </div>
          )}
        </PedidosContext.Provider>
      </SincronizacaoContext.Provider>
    </BarracaContext.Provider>
  )
}
