import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import clsx from 'clsx'
import { useBarracaAtual } from '../layouts/contextoBarraca'
import { usePedidosAtual } from '../layouts/contextoPedidos'
import { tocarSomPedidoNaChamada } from '../lib/sons'
import { rotuloAtendimento } from '../lib/atendimento'
import { Icone } from '../components/ui/Icone'

const OPACIDADES_ANTERIORES = [0.7, 0.5, 0.3]

function formatarSenha(senha: number): string {
  return String(senha).padStart(3, '0')
}

export function TelaChamada() {
  const barraca = useBarracaAtual()
  const navigate = useNavigate()
  const { pedidos, pedidosCarregados } = usePedidosAtual()

  const pedidosProntos = useMemo(
    () =>
      pedidos
        .filter((p) => p.status === 'pronto')
        .sort((a, b) => {
          const tempoA = a.pronto_em ? new Date(a.pronto_em).getTime() : 0
          const tempoB = b.pronto_em ? new Date(b.pronto_em).getTime() : 0
          return tempoB - tempoA
        }),
    [pedidos],
  )

  const hero = pedidosProntos[0] ?? null
  const anteriores = pedidosProntos.slice(1, 4)

  // Fade simples (250ms) quando a senha em destaque muda — ajuste durante o
  // render (não em efeito) para não brigar com react-hooks/set-state-in-effect;
  // o próprio useEffect só reagenda o frame que volta a opacidade a 1.
  const [prevHeroId, setPrevHeroId] = useState(hero?.id ?? null)
  const [visivel, setVisivel] = useState(true)

  if ((hero?.id ?? null) !== prevHeroId) {
    setPrevHeroId(hero?.id ?? null)
    setVisivel(false)
  }

  useEffect(() => {
    if (visivel) return
    const raf = requestAnimationFrame(() => setVisivel(true))
    return () => cancelAnimationFrame(raf)
  }, [visivel])

  // Toca só pra pedidos que ficaram prontos com a tela já aberta. Espera
  // `pedidosCarregados` (useRealtimePedidos.ts) antes de registrar a
  // primeira leitura — sem isso, `pedidos` começa vazio ([]) até o fetch
  // inicial responder, e os prontos que já existiam apareceriam de uma vez
  // parecendo "todos novos" toda vez que a Chamada abre ou recarrega.
  // Acompanha a lista toda (não só o hero) pra não soar de novo quando uma
  // entrega reorganiza a fila e outro pedido já avisado assume o topo.
  const idsAvisadosRef = useRef<Set<string> | null>(null)

  useEffect(() => {
    if (!pedidosCarregados) return

    if (idsAvisadosRef.current === null) {
      idsAvisadosRef.current = new Set(pedidosProntos.map((p) => p.id))
      return
    }

    const chegouProntoNovo = pedidosProntos.some((p) => !idsAvisadosRef.current?.has(p.id))
    if (chegouProntoNovo) tocarSomPedidoNaChamada()

    idsAvisadosRef.current = new Set(pedidosProntos.map((p) => p.id))
  }, [pedidosProntos, pedidosCarregados])

  return (
    <div className="relative flex min-h-dvh flex-col gap-8 bg-mesa-neutral-900 px-6 pt-[calc(env(safe-area-inset-top)+16px)] pb-[calc(env(safe-area-inset-bottom)+24px)] sm:flex-row sm:items-center sm:px-12">
      <button
        type="button"
        onClick={() => navigate(`/${barraca.slug}`)}
        aria-label="Sair da tela de chamada"
        className="absolute right-3 top-3 z-10 flex size-11 items-center justify-center text-mesa-neutral-400 opacity-40 outline-none transition-opacity duration-[var(--mesa-duration-micro)] hover:opacity-70 focus-visible:opacity-70"
      >
        <Icone nome="close" size={20} />
      </button>

      <div className="flex flex-1 flex-col justify-center gap-4">
        {hero ? (
          <>
            <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.08em] text-mesa-neutral-500">
              <Icone nome="campaign" size={16} />
              Senha chamada
            </span>
            <div
              className={clsx(
                'flex w-fit items-center justify-center rounded-mesa-lg bg-mesa-orange-500 px-8 py-3',
                'transition-opacity duration-[250ms]',
                visivel ? 'opacity-100' : 'opacity-0',
              )}
            >
              <span
                aria-live="polite"
                className="font-mesa-display text-[96px] font-extrabold leading-[104px] tracking-tight text-mesa-neutral-900"
              >
                {formatarSenha(hero.senha)}
              </span>
            </div>
            {hero.viagem && (
              <span className="text-xs font-bold tracking-widest text-mesa-neutral-400">
                {rotuloAtendimento(hero).toUpperCase()}
              </span>
            )}
            <span className="text-2xl font-bold text-white">Pode retirar!</span>
          </>
        ) : (
          <p className="text-3xl font-medium text-mesa-neutral-600">Aguardando pedidos...</p>
        )}

        {barraca.logo_url && (
          <img
            src={barraca.logo_url}
            alt=""
            className="mt-4 size-9 rounded-mesa-full object-cover"
            onError={(e) => {
              e.currentTarget.style.display = 'none'
            }}
          />
        )}
      </div>

      {anteriores.length > 0 && (
        <div className="flex flex-col gap-4 sm:h-full sm:justify-center sm:border-l sm:border-mesa-neutral-800 sm:pl-10">
          <span className="text-xs font-semibold uppercase tracking-[0.08em] text-mesa-neutral-500">
            Últimas
          </span>
          <div className="flex flex-row gap-6 sm:flex-col">
            {anteriores.map((pedido, indice) => (
              <span
                key={pedido.id}
                className="font-mesa-display text-2xl font-bold text-white"
                style={{ opacity: OPACIDADES_ANTERIORES[indice] }}
              >
                {formatarSenha(pedido.senha)}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
