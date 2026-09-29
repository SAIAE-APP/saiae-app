import { useBarracaAtual } from '../layouts/contextoBarraca'
import { useTheme } from '../hooks/useTheme'
import { classesBotaoIcone } from '../lib/estiloBotaoIcone'
import { SecaoCaixa } from '../components/SecaoCaixa'
import { GateSenhaAdmin } from '../components/GateSenhaAdmin'
import { BotaoHome } from '../components/ui/BotaoHome'
import { Icone } from '../components/ui/Icone'

/**
 * Caixa como rota própria no hub desktop (pedido de produto 2026-09-27,
 * inspirado num print de concorrente onde "Caixa" é item de nav separado
 * de "Faturamento") — antes vivia embutido dentro de Desktop.tsx. Mesmo
 * tratamento "desktop-only, aviso em mobile" que Desktop.tsx já usa.
 */
export function Caixa() {
  const barraca = useBarracaAtual()
  const { tema, alternarTema } = useTheme()
  const escuro = tema === 'escuro'

  return (
    <GateSenhaAdmin key={barraca.id} barracaId={barraca.id} slug={barraca.slug}>
      <div className="flex min-h-dvh flex-col items-center justify-center gap-3 p-6 text-center md:hidden">
        <Icone nome="desktop_windows" size={40} className="text-mesa-text-tertiary" />
        <p className="text-base font-semibold text-mesa-text-primary">Esta área é feita para desktop</p>
        <p className="text-sm text-mesa-text-secondary">Abra o Sai aê num computador para ver o Caixa.</p>
        <BotaoHome className="mt-2" />
      </div>

      <div className="hidden min-h-dvh px-8 pb-24 pt-[calc(env(safe-area-inset-top)+24px)] md:block">
        <div className="mx-auto max-w-4xl">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <BotaoHome />
              <h1 className="text-2xl font-bold leading-tight text-mesa-text-primary">Caixa</h1>
            </div>
            <button
              type="button"
              onClick={alternarTema}
              aria-label={escuro ? 'Mudar para tema claro' : 'Mudar para tema escuro'}
              className={classesBotaoIcone()}
            >
              {escuro ? <Icone nome="light_mode" size={20} /> : <Icone nome="dark_mode" size={20} />}
            </button>
          </div>

          <SecaoCaixa barraca={barraca} />
        </div>
      </div>
    </GateSenhaAdmin>
  )
}
