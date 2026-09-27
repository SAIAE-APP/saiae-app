import { NavLink } from 'react-router'
import clsx from 'clsx'
import { Icone } from './ui/Icone'
import { useBarracaAtual } from '../layouts/contextoBarraca'
import { usePedidosAtual } from '../layouts/contextoPedidos'

// Ícones da barra inferior: mesmo conjunto que a IDV Sai aê especifica
// pra navegação principal (receipt_long/skillet/campaign/bar_chart) —
// ver redesign_ux_ui_app/saiae/DESIGN.md.
const ITENS: { rotulo: string; rota: string; icone: string; apenasDesktop?: boolean }[] = [
  { rotulo: 'Lançar', rota: 'lancar', icone: 'receipt_long' },
  { rotulo: 'Cozinha', rota: 'cozinha', icone: 'skillet' },
  { rotulo: 'Chamada', rota: 'chamada', icone: 'campaign' },
  { rotulo: 'Histórico', rota: 'historico', icone: 'bar_chart' },
  // Hub desktop (Faturamento hoje, Caixa/Estoque/Fiscal no roadmap) —
  // some da barra em telas estreitas porque o conteúdo não cabe lá.
  { rotulo: 'Faturamento', rota: 'desktop', icone: 'payments', apenasDesktop: true },
  { rotulo: 'Ajustes', rota: 'ajustes', icone: 'settings' },
]

export function BarraNavegacao() {
  const barraca = useBarracaAtual()
  const { contagemAFazer } = usePedidosAtual()

  return (
    <nav
      className={clsx(
        'fixed inset-x-0 bottom-0 z-[var(--mesa-z-nav)] flex h-16 pb-[env(safe-area-inset-bottom)]',
        'bg-white/85 dark:bg-mesa-neutral-800/85 shadow-mesa-nav-top',
      )}
    >
      {ITENS.map((item) => {
        const mostrarBadge = item.rota === 'cozinha' && contagemAFazer > 0

        return (
          <NavLink
            key={item.rota}
            to={`/${barraca.slug}/${item.rota}`}
            className={({ isActive }) =>
              clsx(
                'min-h-11 flex-1 flex-col items-center justify-center gap-0.5',
                item.apenasDesktop ? 'hidden md:flex' : 'flex',
                'transition-colors duration-[var(--mesa-duration-micro)]',
                // Tinta pro estado ativo, não mostarda — a cor de marca
                // não pode vazar pra dentro da tela da Cozinha, e essa
                // barra também aparece lá.
                isActive ? 'text-mesa-neutral-900 dark:text-mesa-neutral-50' : 'text-mesa-neutral-500',
              )
            }
          >
            <span className="relative inline-flex">
              <Icone nome={item.icone} size={24} />
              {mostrarBadge && (
                <span
                  aria-hidden
                  className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-mesa-full bg-mesa-orange-500 px-0.5 text-[10px] font-bold leading-none text-mesa-neutral-900"
                >
                  {contagemAFazer > 9 ? '9+' : contagemAFazer}
                </span>
              )}
            </span>
            <span className="text-[11px] leading-[14px]">
              {item.rotulo}
              {mostrarBadge && (
                <span className="sr-only"> — {contagemAFazer} pedido(s) a fazer</span>
              )}
            </span>
          </NavLink>
        )
      })}
    </nav>
  )
}
