import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import clsx from 'clsx'
import { Button } from '../components/ui/Button'
import { Icone } from '../components/ui/Icone'

// Só existe pra marcar "já viu" — nunca é lido pra decidir NADA de acesso
// (isso é `useAuth`/Dispatcher). Se falhar (modo privado etc.), o pior
// caso é mostrar o onboarding de novo, sem quebrar nada.
const CHAVE_ONBOARDING_VISTO = 'saiae:onboarding_visto'

export function marcarOnboardingVisto() {
  try {
    window.localStorage.setItem(CHAVE_ONBOARDING_VISTO, '1')
  } catch {
    // localStorage indisponível — sem problema, só mostra de novo depois
  }
}

export function onboardingJaVisto(): boolean {
  try {
    return window.localStorage.getItem(CHAVE_ONBOARDING_VISTO) === '1'
  } catch {
    return false
  }
}

const TOTAL_SLIDES = 4
const ULTIMO_SLIDE = TOTAL_SLIDES - 1

/** Tela cheia de mockup fiel ao componente real (Caixa/Cozinha), só que
 * não-interativa — puramente ilustrativa pro onboarding. */
function CardMockup({ children, legenda }: { children: React.ReactNode; legenda: string }) {
  return (
    <div className="w-full max-w-[320px] rounded-mesa-xl border border-[#34323C] bg-mesa-neutral-800 p-3.5">
      <p className="mb-2.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-mesa-neutral-400">
        {legenda}
      </p>
      {children}
    </div>
  )
}

function SlideBoasVindas() {
  return (
    <div className="relative aspect-[4/5] max-h-full w-full max-w-[320px] overflow-hidden rounded-[28px_28px_28px_8px] bg-mesa-neutral-800">
      <img
        src="/onboarding/feirante.webp"
        alt="Dona de barraca de feira sorrindo com o celular na mão"
        className="size-full object-cover object-[60%_20%]"
      />
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-mesa-neutral-900/85" />
      <div className="absolute bottom-3.5 left-3.5 inline-flex items-center gap-2 rounded-mesa-balao bg-white px-3.5 py-2.5 text-[15px] font-bold text-mesa-neutral-900 shadow-mesa-2">
        <Icone nome="check_circle" size={20} preenchido className="text-mesa-success-500" />
        Sai aê! Senha 042
      </div>
    </div>
  )
}

function SlideCaixa() {
  return (
    <CardMockup legenda="Caixa · Pedido #132">
      <div className="mb-1.5 grid grid-cols-3 gap-1 rounded-mesa-md bg-mesa-neutral-700 p-1 text-xs font-semibold">
        <span className="flex h-8 items-center justify-center rounded-mesa-sm bg-mesa-orange-500 text-mesa-neutral-900">
          Balcão
        </span>
        <span className="flex h-8 items-center justify-center rounded-mesa-sm text-mesa-neutral-300">Mesa</span>
        <span className="flex h-8 items-center justify-center rounded-mesa-sm text-mesa-neutral-300">Viagem</span>
      </div>

      {[
        { nome: 'Pastel de carne', preco: 'R$ 12,00', qtd: 2 },
        { nome: 'Caldo de cana', preco: 'R$ 8,00', qtd: 1 },
      ].map((item) => (
        <div key={item.nome} className="flex items-center gap-2.5 border-b border-[#34323C] py-2.5 text-sm last:border-b-0">
          <b className="flex-1 font-semibold text-mesa-neutral-50">{item.nome}</b>
          <small className="font-mesa-display text-[13px] text-mesa-neutral-400">{item.preco}</small>
          <span className="inline-flex items-center gap-1.5">
            <span className="flex size-7 items-center justify-center rounded-mesa-sm bg-mesa-neutral-700">
              <Icone nome="remove" size={18} className="text-mesa-neutral-50" />
            </span>
            <em className="min-w-3.5 text-center font-mesa-display font-bold not-italic text-mesa-neutral-50">
              {item.qtd}
            </em>
            <span className="flex size-7 items-center justify-center rounded-mesa-sm bg-mesa-orange-500">
              <Icone nome="add" size={18} className="text-mesa-neutral-900" />
            </span>
          </span>
        </div>
      ))}

      <div className="mt-3 flex items-center justify-between">
        <div>
          <small className="block text-xs text-mesa-neutral-400">Total · Pix</small>
          <strong className="font-mesa-display text-[22px] font-extrabold text-mesa-neutral-50">R$ 32,00</strong>
        </div>
        <span className="inline-flex h-[42px] items-center gap-1.5 rounded-mesa-md bg-mesa-orange-500 px-3.5 text-sm font-bold text-mesa-neutral-900">
          <Icone nome="add" size={16} />
          Lançar
        </span>
      </div>
    </CardMockup>
  )
}

function SlideCozinha() {
  const pedidos = [
    { numero: '#132', tempo: '02:10', cor: 'bg-mesa-success-500', itens: ['2 Pastel de carne'] },
    { numero: '#129', tempo: '08:45', cor: 'bg-mesa-warning-500', itens: ['3 Coxinha · sem cebola'] },
    { numero: '#127', tempo: '13:20', cor: 'bg-mesa-error-500', itens: ['1 Açaí 500ml'] },
  ]

  return (
    <CardMockup legenda="Cozinha">
      <div className="flex flex-col gap-2">
        {pedidos.map((p) => (
          <div key={p.numero} className="flex flex-col gap-1.5 rounded-mesa-md bg-mesa-neutral-700 px-3 py-2.5 text-[13px]">
            <div className="flex items-center justify-between">
              <b className="font-mesa-display text-lg font-extrabold text-mesa-neutral-50">{p.numero}</b>
              <span
                className={clsx(
                  'inline-flex h-6 items-center gap-1 rounded-mesa-full px-2.5 text-xs font-bold text-white',
                  p.cor,
                )}
              >
                <Icone nome="timer" size={14} />
                {p.tempo}
              </span>
            </div>
            <ul className="text-mesa-neutral-300">
              {p.itens.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="mt-2.5 flex flex-wrap gap-1.5 text-[11px] font-semibold text-mesa-neutral-300">
        <span className="inline-flex h-6 items-center gap-1.5 rounded-mesa-full bg-mesa-neutral-700 px-2.5">
          <i className="size-2 rounded-full bg-mesa-success-500" />
          No prazo
        </span>
        <span className="inline-flex h-6 items-center gap-1.5 rounded-mesa-full bg-mesa-neutral-700 px-2.5">
          <i className="size-2 rounded-full bg-mesa-warning-500" />
          Atenção
        </span>
        <span className="inline-flex h-6 items-center gap-1.5 rounded-mesa-full bg-mesa-neutral-700 px-2.5">
          <i className="size-2 rounded-full bg-mesa-error-500" />
          Atrasado
        </span>
      </div>
    </CardMockup>
  )
}

function SlideSenhaRelatorio() {
  return (
    <div className="flex w-full max-w-[320px] flex-col gap-2.5">
      <div className="rounded-mesa-xl border border-[#34323C] bg-[#0F0E12] p-4.5 text-center">
        <p className="mb-1 flex items-center justify-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-mesa-neutral-400">
          <Icone nome="campaign" size={16} />
          Senha chamada
        </p>
        <div className="font-mesa-display text-[84px] font-extrabold leading-none tracking-tight text-mesa-orange-500">
          042
        </div>
        <p className="mt-1 font-bold text-mesa-neutral-50">Pode retirar!</p>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {[
          { rotulo: 'Vendas', valor: 'R$ 1.284' },
          { rotulo: 'Pedidos', valor: '48' },
          { rotulo: 'Preparo', valor: '7 min' },
        ].map((kpi) => (
          <div key={kpi.rotulo} className="rounded-mesa-md border border-[#34323C] bg-mesa-neutral-800 p-2.5">
            <small className="block text-[10px] font-bold uppercase tracking-[0.06em] text-mesa-neutral-400">
              {kpi.rotulo}
            </small>
            <b className="whitespace-nowrap font-mesa-display text-[17px] font-extrabold text-mesa-neutral-50">
              {kpi.valor}
            </b>
          </div>
        ))}
      </div>
    </div>
  )
}

const SLIDES = [
  {
    arte: <SlideBoasVindas />,
    kicker: 'Bem-vindo ao Sai aê',
    titulo: (
      <>
        Sem papel, <Destaque>sem grito</Destaque>, sem pedido esquecido.
      </>
    ),
    texto: 'Caixa, cozinha e chamada de senha no celular que você já tem.',
  },
  {
    arte: <SlideCaixa />,
    kicker: 'Caixa',
    titulo: (
      <>
        Lance o pedido em <Destaque>segundos</Destaque>.
      </>
    ),
    texto: 'Escolha no cardápio, marque balcão, mesa ou viagem e receba no Pix, dinheiro ou cartão.',
  },
  {
    arte: <SlideCozinha />,
    kicker: 'Cozinha',
    titulo: (
      <>
        A cozinha vê <Destaque>na hora</Destaque>.
      </>
    ),
    texto: 'O pedido chega com número e itens, e o cronômetro muda de cor pra ninguém ficar esquecido.',
  },
  {
    arte: <SlideSenhaRelatorio />,
    kicker: 'Senha e relatório',
    titulo: (
      <>
        Chame a senha e <Destaque>feche o dia</Destaque>.
      </>
    ),
    texto: 'A senha aparece na TV e, no fim do dia, você vê quanto vendeu e o que mais saiu.',
  },
]

function Destaque({ children }: { children: React.ReactNode }) {
  return (
    <em className="rounded-[0.28em_0.28em_0.28em_0.08em] bg-mesa-orange-500 px-[0.14em] not-italic text-mesa-neutral-900">
      {children}
    </em>
  )
}

export function Onboarding() {
  const navigate = useNavigate()
  const trackRef = useRef<HTMLDivElement>(null)
  const [atual, setAtual] = useState(0)

  // Marca "visto" ao montar — é o que faz essa tela nunca mais aparecer
  // pra esse aparelho depois da primeira vez (Dispatcher só manda pra cá
  // quando ainda não tinha visto).
  useEffect(() => {
    marcarOnboardingVisto()
  }, [])

  function irPara(indice: number) {
    trackRef.current?.scrollTo({ left: indice * trackRef.current.clientWidth, behavior: 'smooth' })
  }

  function aoRolar() {
    const el = trackRef.current
    if (!el) return
    const indice = Math.round(el.scrollLeft / el.clientWidth)
    if (indice !== atual) setAtual(indice)
  }

  const noUltimo = atual === ULTIMO_SLIDE

  function aoClicarProximo() {
    if (noUltimo) {
      navigate('/cadastro')
      return
    }
    irPara(atual + 1)
  }

  return (
    <div className="flex min-h-dvh flex-col bg-mesa-neutral-900 text-mesa-neutral-50">
      <div className="relative z-10 flex items-center justify-between px-5 pt-[calc(env(safe-area-inset-top)+14px)]">
        <img src="/brand/saiae-wordmark-horizontal.svg" alt="Sai aê" className="h-[30px] w-auto" />
        <button
          type="button"
          onClick={() => irPara(ULTIMO_SLIDE)}
          className={clsx(
            'min-h-11 rounded-mesa-md px-3 text-[15px] font-semibold text-mesa-neutral-300 outline-none hover:text-mesa-neutral-50',
            noUltimo && 'invisible',
          )}
        >
          Pular
        </button>
      </div>

      <div
        ref={trackRef}
        onScroll={aoRolar}
        className="rolagem-sem-barra relative z-[1] flex flex-1 snap-x snap-mandatory overflow-x-auto overscroll-x-contain"
        role="group"
        aria-roledescription="carrossel"
        aria-label="Apresentação do Sai aê"
      >
        {SLIDES.map((slide, indice) => (
          <section
            key={indice}
            className="flex w-full shrink-0 snap-start flex-col px-6 pt-3"
            aria-roledescription="tela"
            aria-label={`${indice + 1} de ${TOTAL_SLIDES}`}
          >
            <div className="flex min-h-0 flex-1 items-center justify-center py-2">{slide.arte}</div>
            <div className="py-2 pb-1">
              <p className="mb-2.5 text-xs font-bold uppercase tracking-[0.08em] text-mesa-orange-500">
                {slide.kicker}
              </p>
              <h1 className="mb-2.5 text-balance font-mesa-display text-[30px] font-extrabold leading-[1.1] tracking-tight">
                {slide.titulo}
              </h1>
              <p className="text-pretty text-base leading-[1.55] text-mesa-neutral-300">{slide.texto}</p>
            </div>
          </section>
        ))}
      </div>

      <div className="relative z-10 flex flex-col gap-3.5 px-6 pb-[calc(env(safe-area-inset-bottom)+20px)] pt-4.5">
        <div className="flex justify-center gap-1" role="tablist" aria-label="Telas">
          {SLIDES.map((_, indice) => (
            <button
              key={indice}
              type="button"
              role="tab"
              aria-label={`Tela ${indice + 1}`}
              aria-current={indice === atual}
              onClick={() => irPara(indice)}
              className="flex size-7 items-center justify-center outline-none"
            >
              <span
                className={clsx(
                  'block h-2 rounded-full transition-[width,background-color] duration-[var(--mesa-duration-short)]',
                  indice === atual ? 'w-[26px] bg-mesa-orange-500' : 'w-2 bg-mesa-neutral-700',
                )}
              />
            </button>
          ))}
        </div>

        <Button size="xl" onClick={aoClicarProximo} className="w-full shadow-[0_12px_28px_-8px_rgba(255,194,26,.55)]">
          {noUltimo ? 'Criar conta grátis' : 'Próximo'}
          <Icone nome="arrow_forward" size={20} />
        </Button>

        {noUltimo && (
          <button
            type="button"
            onClick={() => navigate('/login')}
            className="min-h-11 text-center text-[15px] font-semibold text-mesa-neutral-50 outline-none"
          >
            Já tenho conta · <b className="text-mesa-orange-500">Entrar</b>
          </button>
        )}
      </div>
    </div>
  )
}
