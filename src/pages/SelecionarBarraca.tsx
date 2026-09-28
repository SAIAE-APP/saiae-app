import { useEffect, useState } from 'react'
import type { FormEvent, MouseEvent } from 'react'
import { useNavigate } from 'react-router'
import clsx from 'clsx'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { useBarracasDoUsuario } from '../hooks/useBarracasDoUsuario'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { Icone } from '../components/ui/Icone'
import { Input } from '../components/ui/Input'
import { BottomSheet } from '../components/ui/BottomSheet'

function gerarSlug(nome: string): string {
  return nome
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // remove acentos
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function CartaoBarraca({
  nome,
  logoUrl,
  emFila,
  onAcessar,
  onExcluir,
}: {
  nome: string
  logoUrl: string | null
  emFila: number
  onAcessar: () => void
  onExcluir?: () => void
}) {
  return (
    <Card className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        {logoUrl ? (
          <img src={logoUrl} alt="" className="size-11 shrink-0 rounded-mesa-full object-cover" />
        ) : (
          <span className="flex size-11 shrink-0 items-center justify-center rounded-mesa-full bg-mesa-neutral-100 text-lg font-bold text-mesa-neutral-900 dark:bg-mesa-neutral-700 dark:text-mesa-neutral-50">
            {nome.charAt(0).toUpperCase()}
          </span>
        )}
        <span className="min-w-0 flex-1 truncate text-base font-semibold text-mesa-text-primary">{nome}</span>
        {onExcluir && (
          <button
            type="button"
            onClick={(e: MouseEvent) => {
              e.stopPropagation()
              onExcluir()
            }}
            aria-label={`Apagar ${nome}`}
            className="flex size-11 shrink-0 items-center justify-center rounded-mesa-full text-mesa-text-tertiary outline-none hover:bg-[var(--mesa-state-hover-bg)] hover:text-mesa-error-500"
          >
            <Icone nome="delete" size={20} />
          </button>
        )}
      </div>

      <div className="flex items-center gap-2">
        <span
          className={clsx(
            'size-2 shrink-0 rounded-mesa-full',
            emFila > 0 ? 'bg-mesa-neutral-900 dark:bg-mesa-neutral-50' : 'bg-mesa-neutral-300 dark:bg-mesa-neutral-600',
          )}
          aria-hidden
        />
        <span className="text-xs text-mesa-text-secondary">
          {emFila > 0 ? `${emFila} em fila` : 'Sem fila agora'}
        </span>
      </div>

      <Button
        variant="confirm"
        size="lg"
        icon={<Icone nome="arrow_forward" size={16} />}
        iconPosition="right"
        onClick={onAcessar}
        className="w-full"
      >
        Acessar {nome}
      </Button>
    </Card>
  )
}

function BottomSheetNovaBarraca({
  open,
  onClose,
  onCriada,
}: {
  open: boolean
  onClose: () => void
  onCriada: (slug: string) => void
}) {
  const [nome, setNome] = useState('')
  const [slug, setSlug] = useState('')
  const [slugEditadoAMao, setSlugEditadoAMao] = useState(false)
  const [criando, setCriando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  function aoMudarNome(valor: string) {
    setNome(valor)
    if (!slugEditadoAMao) setSlug(gerarSlug(valor))
  }

  function aoMudarSlug(valor: string) {
    setSlugEditadoAMao(true)
    setSlug(gerarSlug(valor))
  }

  function fechar() {
    setNome('')
    setSlug('')
    setSlugEditadoAMao(false)
    setErro(null)
    onClose()
  }

  async function criar(e: FormEvent) {
    e.preventDefault()
    if (!nome.trim() || !slug || criando) return

    setCriando(true)
    setErro(null)

    const { data, error } = await supabase.rpc('criar_barraca', {
      p_nome: nome.trim(),
      p_slug: slug,
    })

    setCriando(false)

    if (error) {
      setErro(
        error.message.includes('endereço') ||
          error.message.includes('vazio') ||
          error.message.includes('Essencial')
          ? error.message
          : 'Não foi possível criar a barraca. Tente novamente.',
      )
      return
    }

    const novoSlug = (data as { slug: string }).slug
    fechar()
    onCriada(novoSlug)
  }

  return (
    <BottomSheet open={open} onClose={fechar} aria-label="Criar nova barraca">
      <h2 className="text-lg font-semibold text-mesa-text-primary">Nova barraca</h2>
      <p className="mt-1 text-sm text-mesa-text-secondary">
        Cada barraca tem seu próprio cardápio, comandas e relatórios — nada se mistura entre elas.
      </p>

      <form onSubmit={criar} className="mt-4 flex flex-col gap-4">
        <Input
          label="Nome da barraca"
          autoFocus
          required
          value={nome}
          onChange={(e) => aoMudarNome(e.target.value)}
        />

        <Input
          label="Endereço"
          required
          value={slug}
          onChange={(e) => aoMudarSlug(e.target.value)}
          helpText={slug ? `saiae.com.br/${slug}` : 'só letras minúsculas, números e hífen'}
        />

        {erro && <p className="text-sm font-medium text-mesa-error-500">{erro}</p>}

        <Button type="submit" size="xl" loading={criando} disabled={!nome.trim() || !slug} className="w-full">
          Criar barraca
        </Button>
      </form>
    </BottomSheet>
  )
}

function BottomSheetApagarBarraca({
  barraca,
  onClose,
  onApagada,
}: {
  barraca: { id: string; nome: string } | null
  onClose: () => void
  onApagada: () => void
}) {
  const [confirmacao, setConfirmacao] = useState('')
  const [apagando, setApagando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  function fechar() {
    setConfirmacao('')
    setErro(null)
    onClose()
  }

  async function apagar() {
    if (!barraca || confirmacao.trim() !== barraca.nome || apagando) return

    setApagando(true)
    setErro(null)

    const { error } = await supabase.rpc('apagar_barraca', { p_barraca_id: barraca.id })

    setApagando(false)

    if (error) {
      setErro('Não foi possível apagar a barraca. Tente novamente.')
      return
    }

    setConfirmacao('')
    onApagada()
  }

  return (
    <BottomSheet open={!!barraca} onClose={fechar} aria-label="Apagar barraca">
      <h2 className="text-lg font-semibold text-mesa-text-primary">Apagar {barraca?.nome}?</h2>
      <p className="mt-1 text-sm text-mesa-text-secondary">
        Isso apaga pra sempre o cardápio, o histórico de pedidos e tudo mais dessa barraca. Não tem
        como desfazer.
      </p>

      <div className="mt-4 flex flex-col gap-4">
        <Input
          label={`Digite "${barraca?.nome}" pra confirmar`}
          autoFocus
          value={confirmacao}
          onChange={(e) => setConfirmacao(e.target.value)}
        />

        {erro && <p className="text-sm font-medium text-mesa-error-500">{erro}</p>}

        <Button
          variant="destructive"
          size="xl"
          loading={apagando}
          disabled={confirmacao.trim() !== barraca?.nome}
          onClick={apagar}
          className="w-full"
        >
          Apagar barraca
        </Button>
        <Button variant="ghost" size="md" onClick={fechar} className="w-full">
          Cancelar
        </Button>
      </div>
    </BottomSheet>
  )
}

export function SelecionarBarraca() {
  const navigate = useNavigate()
  const { usuario, sair } = useAuth()
  const { barracas, carregando, recarregar } = useBarracasDoUsuario(usuario)
  const [criandoBarraca, setCriandoBarraca] = useState(false)
  const [barracaParaApagar, setBarracaParaApagar] = useState<{ id: string; nome: string } | null>(null)
  const [filaPorBarraca, setFilaPorBarraca] = useState<Record<string, number>>({})
  const [online, setOnline] = useState(() => navigator.onLine)

  useEffect(() => {
    function aoMudarConexao() {
      setOnline(navigator.onLine)
    }
    window.addEventListener('online', aoMudarConexao)
    window.addEventListener('offline', aoMudarConexao)
    return () => {
      window.removeEventListener('online', aoMudarConexao)
      window.removeEventListener('offline', aoMudarConexao)
    }
  }, [])

  useEffect(() => {
    if (barracas.length === 0) return

    let cancelado = false
    const ids = barracas.map(({ barraca }) => barraca.id)

    supabase
      .from('pedidos')
      .select('barraca_id')
      .in('barraca_id', ids)
      .eq('status', 'a_fazer')
      .then(({ data, error }) => {
        if (cancelado || error || !data) return
        const contagem: Record<string, number> = {}
        for (const linha of data as { barraca_id: string }[]) {
          contagem[linha.barraca_id] = (contagem[linha.barraca_id] ?? 0) + 1
        }
        setFilaPorBarraca(contagem)
      })

    return () => {
      cancelado = true
    }
  }, [barracas])

  async function aoCriarBarraca(slug: string) {
    // Espera recarregar terminar antes de navegar: o cache de barracas do
    // usuário (compartilhado com RotaProtegida) só passa a incluir a
    // barraca recém-criada depois que essa busca resolve. Navegar antes
    // fazia RotaProtegida checar acesso com a lista antiga e mostrar
    // "você não tem acesso a esta barraca" por engano.
    await recarregar()
    navigate(`/${slug}`)
  }

  if (carregando) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-mesa-bg-base">
        <p className="text-sm text-mesa-text-secondary">Carregando...</p>
      </div>
    )
  }

  if (barracas.length === 0) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-mesa-bg-base p-6 text-center">
        <span className="flex size-16 items-center justify-center rounded-mesa-full bg-mesa-neutral-100 dark:bg-mesa-neutral-800">
          <Icone nome="storefront" size={28} className="text-mesa-neutral-900 dark:text-mesa-neutral-50" />
        </span>
        <div>
          <h1 className="text-xl font-bold text-mesa-text-primary">Vamos criar sua barraca</h1>
          <p className="mt-1 text-sm text-mesa-text-secondary">
            Sua conta ainda não tem nenhuma barraca vinculada.
          </p>
        </div>
        <Button size="xl" onClick={() => setCriandoBarraca(true)} className="w-full max-w-xs">
          Criar minha primeira barraca
        </Button>
        <Button
          variant="ghost"
          size="md"
          onClick={async () => {
            await sair()
            navigate('/login')
          }}
        >
          Sair
        </Button>

        <BottomSheetNovaBarraca
          open={criandoBarraca}
          onClose={() => setCriandoBarraca(false)}
          onCriada={aoCriarBarraca}
        />
      </div>
    )
  }

  return (
    <div className="flex min-h-dvh flex-col bg-mesa-bg-base p-6 md:mx-auto md:w-full md:max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold text-mesa-text-primary">Qual barraca?</h1>
        <p className="mt-1 text-sm text-mesa-text-secondary">Escolha a barraca que você vai operar agora.</p>
      </div>

      <div className="mt-6 flex flex-col gap-3">
        <div className="flex flex-col gap-3 md:grid md:grid-cols-2 md:items-start md:gap-4 xl:grid-cols-3">
          {barracas.map(({ barraca, papel }) => (
            <CartaoBarraca
              key={barraca.id}
              nome={barraca.nome}
              logoUrl={barraca.logo_url}
              emFila={filaPorBarraca[barraca.id] ?? 0}
              onAcessar={() => navigate(`/${barraca.slug}`)}
              onExcluir={
                papel === 'dono' ? () => setBarracaParaApagar({ id: barraca.id, nome: barraca.nome }) : undefined
              }
            />
          ))}

          <button
            type="button"
            onClick={() => setCriandoBarraca(true)}
            className="flex items-center gap-3 rounded-mesa-lg border-2 border-dashed border-mesa-border-default p-4 text-left outline-none hover:bg-[var(--mesa-state-hover-bg)] md:h-full"
          >
            <span className="flex size-11 shrink-0 items-center justify-center rounded-mesa-full bg-mesa-neutral-100 text-mesa-text-secondary dark:bg-mesa-neutral-700">
              <Icone nome="add" size={20} />
            </span>
            <span>
              <span className="block text-base font-semibold text-mesa-text-primary">Nova barraca</span>
              <span className="block text-sm text-mesa-text-secondary">
                Criar mais uma barraca pra você operar
              </span>
            </span>
          </button>
        </div>

        <div className="flex items-start gap-2.5 rounded-mesa-lg bg-mesa-neutral-100 p-4 text-sm text-mesa-text-secondary dark:bg-mesa-neutral-800">
          <Icone nome="info" size={16} className="mt-0.5 text-mesa-text-tertiary" />
          <span>Cada barraca tem seu próprio cardápio, comandas e histórico — nada se mistura entre elas.</span>
        </div>
      </div>

      <div className="mt-auto flex flex-col items-center gap-3 pt-6">
        <Button
          variant="ghost"
          size="md"
          onClick={async () => {
            await sair()
            navigate('/login')
          }}
        >
          Sair
        </Button>
        <Badge variant={online ? 'success' : 'warning'} dot>
          {online ? 'Online' : 'Offline'}
        </Badge>
      </div>

      <BottomSheetNovaBarraca
        open={criandoBarraca}
        onClose={() => setCriandoBarraca(false)}
        onCriada={aoCriarBarraca}
      />

      <BottomSheetApagarBarraca
        barraca={barracaParaApagar}
        onClose={() => setBarracaParaApagar(null)}
        onApagada={async () => {
          setBarracaParaApagar(null)
          await recarregar()
        }}
      />
    </div>
  )
}
