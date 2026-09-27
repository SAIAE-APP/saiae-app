import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { Link } from 'react-router'
import { supabase } from '../lib/supabase'
import { Button } from './ui/Button'
import { Icone } from './ui/Icone'
import { Input } from './ui/Input'

type Estado = 'verificando' | 'criar' | 'digitar' | 'liberado' | 'erro_inicial'

function chaveSessao(barracaId: string): string {
  return `mesaagil:admin_ok:${barracaId}`
}

function liberadoNaSessao(barracaId: string): boolean {
  try {
    return window.sessionStorage.getItem(chaveSessao(barracaId)) === '1'
  } catch {
    return false
  }
}

function marcarLiberado(barracaId: string): void {
  try {
    window.sessionStorage.setItem(chaveSessao(barracaId), '1')
  } catch {
    // sessionStorage indisponível (modo privado etc.) — só pede de novo
    // na próxima navegação, sem quebrar o fluxo.
  }
}

const PIN_INVALIDO = 'O PIN precisa ter exatamente 4 números'

export function GateSenhaAdmin({
  barracaId,
  slug,
  children,
}: {
  barracaId: string
  slug: string
  children: ReactNode
}) {
  const [estado, setEstado] = useState<Estado>(() =>
    liberadoNaSessao(barracaId) ? 'liberado' : 'verificando',
  )
  const [pin, setPin] = useState('')
  const [pinConfirmacao, setPinConfirmacao] = useState('')
  const [processando, setProcessando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    if (estado !== 'verificando') return
    let cancelado = false

    supabase
      .rpc('senha_admin_configurada', { p_barraca_id: barracaId })
      .then(({ data, error }) => {
        if (cancelado) return
        if (error) {
          setEstado('erro_inicial')
          return
        }
        setEstado(data ? 'digitar' : 'criar')
      })

    return () => {
      cancelado = true
    }
  }, [estado, barracaId])

  async function aoCriarSenha(e: FormEvent) {
    e.preventDefault()
    if (processando) return

    if (!/^[0-9]{4}$/.test(pin)) {
      setErro(PIN_INVALIDO)
      return
    }
    if (pin !== pinConfirmacao) {
      setErro('Os dois PINs não conferem')
      return
    }

    setProcessando(true)
    setErro(null)

    const { error } = await supabase.rpc('definir_senha_admin', {
      p_barraca_id: barracaId,
      p_pin: pin,
    })

    setProcessando(false)

    if (error) {
      setErro('Não foi possível criar a senha. Tente novamente.')
      return
    }

    marcarLiberado(barracaId)
    setEstado('liberado')
  }

  async function aoDigitarSenha(e: FormEvent) {
    e.preventDefault()
    if (processando) return

    if (!/^[0-9]{4}$/.test(pin)) {
      setErro(PIN_INVALIDO)
      return
    }

    setProcessando(true)
    setErro(null)

    const { data, error } = await supabase.rpc('verificar_senha_admin', {
      p_barraca_id: barracaId,
      p_pin: pin,
    })

    setProcessando(false)

    if (error) {
      setErro('Não foi possível conferir o PIN. Tente novamente.')
      return
    }

    if (!data) {
      setErro('PIN incorreto')
      setPin('')
      return
    }

    marcarLiberado(barracaId)
    setEstado('liberado')
  }

  if (estado === 'liberado') return <>{children}</>

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-mesa-bg-base p-6">
      <Link
        to={`/${slug}`}
        aria-label="Voltar para o início"
        className="absolute left-4 top-[calc(env(safe-area-inset-top)+16px)] inline-flex size-11 items-center justify-center text-mesa-text-primary"
      >
        <Icone nome="chevron_left" size={28} />
      </Link>

      <div className="w-full max-w-[360px]">
        <div className="flex flex-col items-center text-center">
          <div className="flex size-16 items-center justify-center rounded-mesa-full bg-white shadow-mesa-1 dark:bg-mesa-neutral-800">
            <Icone nome="lock" size={24} className="text-mesa-orange-500" />
          </div>
          <h1 className="mt-4 text-2xl font-bold leading-[32px] text-mesa-text-primary">
            {estado === 'criar' ? 'Criar senha administrativa' : 'Senha administrativa'}
          </h1>
          <p className="mt-1 text-sm text-mesa-text-secondary">
            {estado === 'criar'
              ? 'Escolha um PIN de 4 números para proteger Ajustes e Histórico.'
              : 'Digite o PIN de 4 números para continuar.'}
          </p>
        </div>

        {estado === 'erro_inicial' && (
          <p className="mt-6 text-center text-sm font-medium text-mesa-error-500">
            Não foi possível carregar. Verifique a conexão e tente de novo.
          </p>
        )}

        {estado === 'criar' && (
          <form onSubmit={aoCriarSenha} className="mt-8 flex flex-col gap-4">
            <Input
              label="Novo PIN"
              type="password"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={4}
              autoFocus
              autoComplete="off"
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
              className="text-center"
            />
            <Input
              label="Confirmar PIN"
              type="password"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={4}
              autoComplete="off"
              value={pinConfirmacao}
              onChange={(e) => setPinConfirmacao(e.target.value.replace(/\D/g, '').slice(0, 4))}
            />
            {erro && <p className="text-sm font-medium text-mesa-error-500">{erro}</p>}
            <Button type="submit" size="xl" loading={processando} className="w-full">
              Criar senha
            </Button>
          </form>
        )}

        {estado === 'digitar' && (
          <form onSubmit={aoDigitarSenha} className="mt-8 flex flex-col gap-4">
            <Input
              label="PIN"
              type="password"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={4}
              autoFocus
              autoComplete="off"
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
              className="text-center"
            />
            {erro && <p className="text-sm font-medium text-mesa-error-500">{erro}</p>}
            <Button type="submit" size="xl" loading={processando} className="w-full">
              Entrar
            </Button>
          </form>
        )}
      </div>
    </div>
  )
}
