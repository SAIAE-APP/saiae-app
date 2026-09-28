import { NavLink, useNavigate } from 'react-router'
import clsx from 'clsx'
import { useBarracaAtual } from '../layouts/contextoBarraca'
import { useAuth } from '../hooks/useAuth'
import { useTheme } from '../hooks/useTheme'
import { Icone } from './ui/Icone'

type ItemNav = { rotulo: string; rota: string; icone: string }

// Agrupamento visual (pedido de produto 2026-09-27, inspirado num print de
// concorrente) — só reorganiza os 4 itens que já existem, não inventa item
// novo (Mesas/Entregadores/Estoque do concorrente não existem aqui). `id`
// dá um alvo estável (document.getElementById) pro tour guiado desktop do
// Hub (Dashboard.tsx) apontar pro grupo — não dá pra usar ref={} direto de
// lá porque SidebarDesktop é irmã de Dashboard na árvore, não filha.
const GRUPOS: { id: string; rotulo: string; itens: ItemNav[] }[] = [
  {
    id: 'sidebar-grupo-operacao',
    rotulo: 'Operação',
    itens: [
      { rotulo: 'Dashboard', rota: '', icone: 'home' },
      { rotulo: 'Caixa', rota: 'caixa', icone: 'point_of_sale' },
    ],
  },
  {
    id: 'sidebar-grupo-gestao',
    rotulo: 'Gestão',
    itens: [
      { rotulo: 'Histórico', rota: 'historico', icone: 'bar_chart' },
      { rotulo: 'Faturamento', rota: 'desktop', icone: 'payments' },
      { rotulo: 'Cardápio', rota: 'ajustes/cardapio', icone: 'restaurant_menu' },
    ],
  },
  {
    id: 'sidebar-grupo-conta',
    rotulo: 'Conta',
    itens: [{ rotulo: 'Conta', rota: 'ajustes', icone: 'settings' }],
  },
]

const CLASSE_ITEM =
  'flex min-h-11 items-center gap-3 rounded-mesa-md px-3 text-sm font-semibold outline-none transition-colors duration-[var(--mesa-duration-micro)]'

/**
 * Navegação lateral só pras telas de gestão (Dashboard/Histórico/
 * Faturamento/Cardápio/Conta) em telas ≥md — substitui a BarraNavegacao
 * inferior nessas rotas quando há espaço de sobra. Lançar Pedido,
 * Cozinha e Chamada continuam só com a BarraNavegacao em qualquer
 * largura (ver LayoutBarraca.tsx). "Cardápio" e "Conta" são as duas
 * categorias em que Ajustes.tsx se separa só no desktop (ver
 * Ajustes.tsx) — no mobile as duas rotas mostram a mesma página cheia.
 */
export function SidebarDesktop() {
  const barraca = useBarracaAtual()
  const navigate = useNavigate()
  const { sair } = useAuth()
  const { tema, alternarTema } = useTheme()
  const escuro = tema === 'escuro'

  return (
    <aside className="fixed inset-y-0 left-0 z-[var(--mesa-z-nav)] hidden w-64 flex-col border-r border-mesa-border-subtle bg-mesa-surface md:flex">
      <div className="flex items-center gap-2.5 px-5 pt-[calc(env(safe-area-inset-top)+20px)] pb-6">
        {/* Ícone colorido em qualquer tema (mesma decisão do Login,
            2026-09-27) — a versão branca lia como "sumida" no escuro. */}
        <img src="/brand/saiae-icone-cor.svg" alt="" className="size-8 shrink-0" />
        <img
          src="/brand/saiae-wordmark-horizontal-preto.svg"
          alt="Sai aê"
          className="h-5 w-auto dark:hidden"
        />
        <img
          src="/brand/saiae-wordmark-horizontal.svg"
          alt="Sai aê"
          className="hidden h-5 w-auto dark:block"
        />
      </div>

      <nav className="flex flex-col gap-4 px-3">
        {GRUPOS.map((grupo) => (
          <div key={grupo.rotulo} id={grupo.id} className="flex flex-col gap-1">
            <p className="mb-1 px-3 font-mesa-sans text-xs font-semibold uppercase tracking-wider text-mesa-text-secondary">
              {grupo.rotulo}
            </p>
            {grupo.itens.map((item) => (
              <NavLink
                key={item.rota}
                to={`/${barraca.slug}${item.rota ? `/${item.rota}` : ''}`}
                end={item.rota === '' || item.rota === 'ajustes'}
                className={({ isActive }) =>
                  clsx(
                    CLASSE_ITEM,
                    isActive
                      ? 'bg-[var(--mesa-state-selected-bg)] text-mesa-text-primary'
                      : 'text-mesa-text-secondary hover:bg-[var(--mesa-state-hover-bg)]',
                  )
                }
              >
                <Icone nome={item.icone} size={20} />
                {item.rotulo}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>

      <div className="mt-auto flex flex-col gap-1 px-3 pb-[calc(env(safe-area-inset-bottom)+16px)]">
        <button
          type="button"
          onClick={alternarTema}
          aria-label={escuro ? 'Mudar para tema claro' : 'Mudar para tema escuro'}
          className={clsx(CLASSE_ITEM, 'text-mesa-text-secondary hover:bg-[var(--mesa-state-hover-bg)]')}
        >
          <Icone nome={escuro ? 'light_mode' : 'dark_mode'} size={20} />
          {escuro ? 'Tema claro' : 'Tema escuro'}
        </button>
        <button
          type="button"
          onClick={async () => {
            await sair()
            navigate('/login')
          }}
          className={clsx(CLASSE_ITEM, 'text-mesa-error-500 hover:bg-[var(--mesa-state-hover-bg)]')}
        >
          <Icone nome="logout" size={20} />
          Sair
        </button>
      </div>
    </aside>
  )
}
