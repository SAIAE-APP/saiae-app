import type { ReactNode } from 'react'

/**
 * Moldura das telas de entrada (Login/Cadastro). Mobile: foto de fundo com o
 * formulário num card ancorado embaixo. Desktop: fundo papel sólido, logo no
 * topo esquerdo e um card central em duas metades — formulário à esquerda,
 * foto à direita.
 */
export function LayoutAuth({ children }: { children: ReactNode }) {
  return (
    <div className="relative flex min-h-dvh flex-col md:items-center md:justify-center md:bg-mesa-bg-base md:p-6">
      <div className="hidden md:absolute md:left-8 md:top-6 md:block">
        <img src="/brand/saiae-wordmark-horizontal-preto.svg" alt="Sai aê" className="h-8 w-auto dark:hidden" />
        <img
          src="/brand/saiae-wordmark-horizontal.svg"
          alt="Sai aê"
          className="hidden h-8 w-auto dark:block"
        />
      </div>

      <div className="relative flex min-h-dvh flex-1 flex-col md:min-h-[600px] md:w-full md:max-w-5xl md:flex-none md:flex-row md:overflow-hidden md:rounded-mesa-2xl md:border md:border-mesa-border-subtle md:bg-mesa-surface">
        <div className="absolute inset-0 overflow-hidden md:relative md:order-2 md:w-1/2">
          <img
            src="/login/feirante.webp"
            alt="Dona de barraca sorrindo, segurando o celular, com banca de frutas e verduras ao fundo"
            className="size-full object-cover object-[60%_20%]"
          />
        </div>

        <div
          className={[
            'relative z-10 mt-auto flex max-h-[76dvh] flex-col overflow-y-auto',
            'rounded-t-mesa-2xl bg-mesa-surface p-6 pb-[calc(env(safe-area-inset-bottom)+24px)] shadow-mesa-3',
            'md:order-1 md:mt-0 md:max-h-none md:w-1/2 md:justify-center md:overflow-visible',
            'md:rounded-none md:p-12 md:shadow-none',
          ].join(' ')}
        >
          <div className="mx-auto w-full max-w-[400px]">
            <div className="mb-6 flex flex-col items-center md:hidden">
              <img src="/brand/saiae-icone-cor.svg" alt="" className="size-14" />
              <img
                src="/brand/saiae-wordmark-horizontal-preto.svg"
                alt="Sai aê"
                className="mt-3 h-7 w-auto dark:hidden"
              />
              <img
                src="/brand/saiae-wordmark-horizontal.svg"
                alt="Sai aê"
                className="mt-3 hidden h-7 w-auto dark:block"
              />
            </div>
            {children}
          </div>
        </div>
      </div>
    </div>
  )
}
