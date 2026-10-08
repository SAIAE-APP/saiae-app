import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { useBarracaAtual, useSincronizacaoAtual } from '../layouts/contextoBarraca'
import { usePedidosAtual } from '../layouts/contextoPedidos'
import { classesBotaoIcone } from '../lib/estiloBotaoIcone'
import { useAuth } from '../hooks/useAuth'
import { useBarracasDoUsuario } from '../hooks/useBarracasDoUsuario'
import { useTheme } from '../hooks/useTheme'
import { useEhDesktop } from '../hooks/useEhDesktop'
import { formatarDataExtenso, turnoAtual } from '../lib/datas'
import { formatarPrecoBR } from '../lib/preco'
import { calcularTotalBruto } from '../lib/relatorio'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { Icone } from '../components/ui/Icone'
import { BottomSheet } from '../components/ui/BottomSheet'
import { TourGuiado, type PassoTour } from '../components/TourGuiado'
import { marcarTourVisto, tourJaVisto } from '../lib/tourStorage'

function formatarSenha(senha: number): string {
  return String(senha).padStart(3, '0')
}

function calcularEsperaMediaMinutos(emFila: { criado_em: string }[]): number | null {
  if (emFila.length === 0) return null
  const agora = Date.now()
  const somaMinutos = emFila.reduce(
    (soma, p) => soma + (agora - new Date(p.criado_em).getTime()) / 60000,
    0,
  )
  return Math.round(somaMinutos / emFila.length)
}

function IconeCard({ icone }: { icone: string }) {
  return (
    <span className="flex size-11 items-center justify-center rounded-mesa-md bg-mesa-neutral-100 text-mesa-neutral-900 dark:bg-mesa-neutral-700 dark:text-mesa-neutral-50">
      <Icone nome={icone} size={20} />
    </span>
  )
}

function CardDashboard({
  icone,
  titulo,
  subtitulo,
  badge,
  onClick,
}: {
  icone: string
  titulo: string
  subtitulo: string
  badge?: number
  onClick: () => void
}) {
  return (
    <Card interactive onClick={onClick} className="relative flex flex-col items-start gap-3">
      <IconeCard icone={icone} />
      {!!badge && (
        <span
          aria-hidden
          className="absolute right-3 top-3 flex h-6 min-w-6 items-center justify-center rounded-mesa-balao bg-mesa-orange-500 px-1.5 text-xs font-bold leading-none text-mesa-neutral-900"
        >
          {badge > 9 ? '9+' : badge}
        </span>
      )}
      <div>
        <p className="text-lg font-bold text-mesa-text-primary">{titulo}</p>
        <p className="mt-0.5 text-sm text-mesa-text-secondary">{subtitulo}</p>
      </div>
    </Card>
  )
}

export function Dashboard() {
  const barraca = useBarracaAtual()
  const navigate = useNavigate()
  const { online } = useSincronizacaoAtual()
  const { pedidos, contagemAFazer } = usePedidosAtual()
  const { tema, alternarTema } = useTheme()
  const { usuario, sair } = useAuth()
  const { barracas: barracasDoUsuario } = useBarracasDoUsuario(usuario)
  const escuro = tema === 'escuro'
  const [confirmandoSaida, setConfirmandoSaida] = useState(false)
  const [mostrarMenuConta, setMostrarMenuConta] = useState(false)

  // Tour guiado: só na primeira vez que alguém chega no Hub, pra mostrar o
  // caminho certo antes do operador leigo cair de cara num Lançar Pedido
  // sem nenhum item cadastrado — pedido real de produto, 2026-09-27.
  // Desktop ganhou tour próprio em 2026-09-27: a sidebar (Operação/Gestão/
  // Conta) mudou o caminho de verdade, os passos do mobile (que apontam pra
  // cards do Hub mobile) não fazem mais sentido lá. Chave de "já visto"
  // separada (hub-desktop vs hub) — são experiências diferentes, cada uma
  // aparece uma vez, independente da outra (alguém pode ver o mobile no
  // celular e o desktop no computador, ou vice-versa).
  const ehDesktop = useEhDesktop()
  const ajustesRef = useRef<HTMLAnchorElement>(null)
  const caixaRef = useRef<HTMLDivElement>(null)
  const cozinhaRef = useRef<HTMLDivElement>(null)
  // Alvos da SidebarDesktop (componente irmão, não filho, daqui) — achados
  // por id via document.getElementById em vez de ref={} direto.
  const sidebarOperacaoRef = useRef<HTMLElement | null>(null)
  const sidebarGestaoRef = useRef<HTMLElement | null>(null)
  const sidebarContaRef = useRef<HTMLElement | null>(null)
  const [mostrarTour, setMostrarTour] = useState(false)
  const chaveTourAtivoRef = useRef<'hub' | 'hub-desktop'>('hub')

  useEffect(() => {
    const chave = ehDesktop ? 'hub-desktop' : 'hub'
    if (tourJaVisto(chave)) return

    if (ehDesktop) {
      // SidebarDesktop só existe visível em telas md+, mas o elemento
      // continua no DOM (display:none) abaixo disso — sem achar os 3
      // grupos, não mostra o tour com um spotlight apontando pro nada.
      const operacao = document.getElementById('sidebar-grupo-operacao')
      const gestao = document.getElementById('sidebar-grupo-gestao')
      const conta = document.getElementById('sidebar-grupo-conta')
      if (!operacao || !gestao || !conta) return
      sidebarOperacaoRef.current = operacao
      sidebarGestaoRef.current = gestao
      sidebarContaRef.current = conta
    }

    chaveTourAtivoRef.current = chave
    setMostrarTour(true)
    // Decide 1x, no mount, olhando o ehDesktop desse primeiro render —
    // virar a tela durante a sessão não deve trocar o tour no meio da
    // interação, por isso closure intencional sem reagir a mudança depois.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function fecharTour() {
    marcarTourVisto(chaveTourAtivoRef.current)
    setMostrarTour(false)
  }

  const passosTourMobile: PassoTour[] = [
    {
      alvo: ajustesRef,
      titulo: 'Comece por aqui: cadastre seu cardápio',
      texto: 'Antes de lançar o primeiro pedido, adicione os itens que sua barraca vende em Ajustes → Cardápio.',
    },
    {
      alvo: caixaRef,
      titulo: 'Depois, lance os pedidos aqui',
      texto: 'Escolha os itens do cardápio, escolha o tipo de atendimento e envie pra cozinha.',
    },
    {
      alvo: cozinhaRef,
      titulo: 'Acompanhe o preparo',
      texto: 'Os pedidos aparecem aqui em tempo real, organizados por tempo de espera — o cronômetro avisa quando algo está atrasando.',
    },
  ]

  const passosTourDesktop: PassoTour[] = [
    {
      alvo: sidebarOperacaoRef,
      titulo: 'Operação: o dia a dia da barraca',
      texto: 'Dashboard te traz de volta aqui, e Caixa é onde você lança os pedidos e controla a abertura/fechamento do caixa.',
    },
    {
      alvo: sidebarGestaoRef,
      titulo: 'Gestão: histórico e faturamento',
      texto: 'Veja o histórico completo de comandas e o relatório de vendas, custo e lucro — inclusive por produto.',
    },
    {
      alvo: sidebarContaRef,
      titulo: 'Conta: dados da barraca e cardápio',
      texto: 'Assinatura, identidade e pagamento ficam aqui — o cardápio, banners e aparência têm sua própria aba "Cardápio" dentro de Conta.',
    },
  ]

  const passosTour = ehDesktop ? passosTourDesktop : passosTourMobile

  // Mesmas fontes já assinadas em tempo real por LayoutBarraca (nenhuma
  // busca nova): contagemAFazer já vem pronta do contexto, a última senha
  // chamada é a mesma derivação client-side que TelaChamada já faz, e o
  // total do dia usa calcularTotalBruto sobre os pedidos do dia que
  // useRealtimePedidos já carrega inteiros (todos os status, não só os
  // ativos) — três métricas "de graça", sem nenhum fetch extra na tela.
  const ultimaChamada = useMemo(
    () =>
      pedidos
        .filter((p) => p.status === 'pronto')
        .sort((a, b) => {
          const tempoA = a.pronto_em ? new Date(a.pronto_em).getTime() : 0
          const tempoB = b.pronto_em ? new Date(b.pronto_em).getTime() : 0
          return tempoB - tempoA
        })[0] ?? null,
    [pedidos],
  )

  const totalHojeCentavos = useMemo(() => calcularTotalBruto(pedidos), [pedidos])
  const dataFormatada = useMemo(() => formatarDataExtenso(new Date()), [])
  const turno = useMemo(() => turnoAtual(), [])

  const vendasHojeCount = useMemo(
    () => pedidos.filter((p) => p.status !== 'cancelado').length,
    [pedidos],
  )

  const esperaMediaMinutos = useMemo(
    () => calcularEsperaMediaMinutos(pedidos.filter((p) => p.status === 'a_fazer')),
    [pedidos],
  )

  return (
    <div className="flex min-h-dvh flex-col">
      <div className="flex items-start justify-between gap-3 px-6 pt-[calc(env(safe-area-inset-top)+20px)]">
        <div className="min-w-0">
          {barracasDoUsuario.length > 1 ? (
            <button
              type="button"
              onClick={() => navigate('/selecionar-barraca')}
              className="flex w-full min-w-0 min-h-11 items-center gap-1 text-left outline-none"
              aria-label={`Trocar de barraca (atual: ${barraca.nome})`}
            >
              <h1 className="min-w-0 truncate text-[28px] font-bold leading-[36px] text-mesa-text-primary">
                {barraca.nome}
              </h1>
              <Icone nome="expand_more" size={20} className="text-mesa-text-secondary" />
            </button>
          ) : (
            <h1 className="text-[28px] font-bold leading-[36px] text-mesa-text-primary">
              Bem-vindo, {barraca.nome}
            </h1>
          )}
          <p className="mt-1 text-sm text-mesa-text-secondary">
            {dataFormatada} <span aria-hidden>·</span> {turno}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2 pt-1">
          <Badge variant={online ? 'success' : 'warning'} dot>
            {online ? 'Online' : 'Offline'}
          </Badge>
          <button
            type="button"
            onClick={alternarTema}
            aria-label={escuro ? 'Mudar para tema claro' : 'Mudar para tema escuro'}
            className={classesBotaoIcone()}
          >
            {escuro ? <Icone nome="light_mode" size={20} /> : <Icone nome="dark_mode" size={20} />}
          </button>
          <Link
            ref={ajustesRef}
            to={`/${barraca.slug}/ajustes`}
            aria-label="Ajustes"
            className={classesBotaoIcone()}
          >
            <Icone nome="settings" size={20} />
          </Link>
          <button
            type="button"
            onClick={() => setMostrarMenuConta(true)}
            aria-label="Conta"
            className={classesBotaoIcone('danger')}
          >
            <Icone nome="logout" size={20} />
          </button>
        </div>
      </div>

      <div className="px-6 pt-6">
        <p className="text-base font-semibold text-mesa-text-primary">O que você vai fazer agora?</p>
        <p className="mt-0.5 text-sm text-mesa-text-secondary">
          Selecione o módulo de trabalho ou acompanhe o ritmo da loja
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 px-6 pb-4 pt-4 md:grid-cols-4">
        <div ref={caixaRef}>
          <CardDashboard
            icone="receipt_long"
            titulo="Caixa"
            subtitulo="Lançar pedidos"
            onClick={() => navigate(`/${barraca.slug}/lancar`)}
          />
        </div>
        <div ref={cozinhaRef}>
          <CardDashboard
            icone="skillet"
            titulo="Cozinha"
            subtitulo={`${contagemAFazer} pedido${contagemAFazer === 1 ? '' : 's'} em preparo`}
            badge={contagemAFazer}
            onClick={() => navigate(`/${barraca.slug}/cozinha`)}
          />
        </div>
        <CardDashboard
          icone="campaign"
          titulo="Chamada"
          subtitulo={
            ultimaChamada ? `Última: senha ${formatarSenha(ultimaChamada.senha)}` : 'Nenhuma senha ainda'
          }
          onClick={() => navigate(`/${barraca.slug}/chamada`)}
        />
        <CardDashboard
          icone="bar_chart"
          titulo="Histórico"
          subtitulo={`${vendasHojeCount} venda${vendasHojeCount === 1 ? '' : 's'} · ${formatarPrecoBR(totalHojeCentavos)} hoje`}
          onClick={() => navigate(`/${barraca.slug}/historico`)}
        />
      </div>

      <div className="px-6 pb-4 md:max-w-2xl">
        <Card className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2 text-sm font-semibold text-mesa-text-primary">
              <span className="size-2 rounded-mesa-full bg-mesa-neutral-900 dark:bg-mesa-neutral-50" aria-hidden />
              Ritmo da Operação
            </span>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-mesa-md bg-mesa-surface-alt p-3">
              <p className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-mesa-text-tertiary">
                <Icone nome="schedule" size={12} />
                Espera média
              </p>
              <p className="mt-1 font-mesa-display text-lg font-bold text-mesa-text-primary">
                {esperaMediaMinutos === null ? '—' : `${esperaMediaMinutos} min`}
              </p>
            </div>
            <div className="rounded-mesa-md bg-mesa-surface-alt p-3">
              <p className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-mesa-text-tertiary">
                <Icone nome="format_list_numbered" size={12} />
                Em fila
              </p>
              <p className="mt-1 font-mesa-display text-lg font-bold text-mesa-text-primary">
                {contagemAFazer} comanda{contagemAFazer === 1 ? '' : 's'}
              </p>
            </div>
          </div>
        </Card>
      </div>

      <BottomSheet open={mostrarMenuConta} onClose={() => setMostrarMenuConta(false)} aria-label="Conta">
        <h2 className="text-lg font-semibold text-mesa-text-primary">Conta</h2>
        {usuario?.email && (
          <p className="mt-1 truncate text-sm text-mesa-text-secondary">{usuario.email}</p>
        )}
        <div className="mt-6 flex flex-col gap-1">
          <Button
            variant="ghost"
            size="md"
            className="w-full"
            onClick={() => {
              setMostrarMenuConta(false)
              navigate('/selecionar-barraca')
            }}
          >
            Trocar ou adicionar barraca
          </Button>
          <Button
            variant="textDanger"
            size="md"
            className="w-full"
            onClick={() => {
              setMostrarMenuConta(false)
              setConfirmandoSaida(true)
            }}
          >
            Sair da conta
          </Button>
        </div>
      </BottomSheet>

      <BottomSheet
        open={confirmandoSaida}
        onClose={() => setConfirmandoSaida(false)}
        aria-label="Confirmar saída"
      >
        <h2 className="text-lg font-semibold text-mesa-text-primary">Você quer mesmo sair?</h2>
        <p className="mt-1 text-sm text-mesa-text-secondary">
          Vai precisar entrar com e-mail e senha de novo.
        </p>
        <div className="mt-6 flex flex-col gap-2">
          <Button
            variant="destructive"
            size="xl"
            icon={<Icone nome="logout" size={20} />}
            className="w-full"
            onClick={async () => {
              await sair()
              navigate('/login')
            }}
          >
            Sair
          </Button>
          <Button
            variant="ghost"
            size="md"
            className="w-full"
            onClick={() => setConfirmandoSaida(false)}
          >
            Cancelar
          </Button>
        </div>
      </BottomSheet>

      {mostrarTour && <TourGuiado passos={passosTour} onFechar={fecharTour} />}
    </div>
  )
}
