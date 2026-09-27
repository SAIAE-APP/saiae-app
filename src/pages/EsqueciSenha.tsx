import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router'
import { useAuth } from '../hooks/useAuth'
import { Button } from '../components/ui/Button'
import { Icone } from '../components/ui/Icone'
import { Input } from '../components/ui/Input'

const COOLDOWN_REENVIO_SEGUNDOS = 30

export function EsqueciSenha() {
  const { resetarSenha } = useAuth()

  const [email, setEmail] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [enviado, setEnviado] = useState(false)
  const [cooldown, setCooldown] = useState(0)
  const intervaloRef = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (intervaloRef.current !== null) window.clearInterval(intervaloRef.current)
    }
  }, [])

  function iniciarCooldown() {
    setCooldown(COOLDOWN_REENVIO_SEGUNDOS)
    if (intervaloRef.current !== null) window.clearInterval(intervaloRef.current)
    intervaloRef.current = window.setInterval(() => {
      setCooldown((atual) => {
        if (atual <= 1) {
          if (intervaloRef.current !== null) window.clearInterval(intervaloRef.current)
          intervaloRef.current = null
          return 0
        }
        return atual - 1
      })
    }, 1000)
  }

  async function aoSubmeter(e: FormEvent) {
    e.preventDefault()
    if (enviando || cooldown > 0) return

    setEnviando(true)
    await resetarSenha(email.trim())
    setEnviando(false)
    setEnviado(true)
    iniciarCooldown()
  }

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-mesa-bg-base p-6">
      <div className="w-full max-w-[420px]">
        <div className="flex flex-col items-center text-center">
          <div className="flex size-16 items-center justify-center rounded-mesa-full bg-white shadow-mesa-1 dark:bg-mesa-neutral-800">
            <Icone nome="mail" size={28} className="text-mesa-orange-500" />
          </div>
          <h1 className="mt-4 text-[32px] font-bold leading-[40px] text-mesa-text-primary">
            Esqueci minha senha
          </h1>
          {enviado ? (
            <p className="mt-1 flex items-center justify-center gap-1.5 text-sm text-mesa-text-secondary">
              <Icone nome="check_circle" size={16} className="text-mesa-success-700 dark:text-mesa-success-500" />
              Enviamos um link para {email.trim()}. Verifique sua caixa de entrada.
            </p>
          ) : (
            <p className="mt-1 text-sm text-mesa-text-secondary">
              Informe seu e-mail e enviaremos um link para recuperar a senha
            </p>
          )}
        </div>

        <form onSubmit={aoSubmeter} className="mt-8 flex flex-col gap-4">
          <Input
            label="E-mail"
            type="email"
            autoComplete="email"
            autoFocus={!enviado}
            required
            readOnly={enviado}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />

          {enviado ? (
            <Button
              type="submit"
              variant="outline"
              size="xl"
              loading={enviando}
              disabled={cooldown > 0}
              className="w-full"
            >
              {cooldown > 0 ? `Reenviar em ${cooldown}s` : 'Reenviar link'}
            </Button>
          ) : (
            <Button type="submit" size="xl" loading={enviando} className="w-full">
              Enviar link de recuperação
            </Button>
          )}
        </form>

        <Link
          to="/login"
          className="mt-4 block text-center text-sm font-medium text-mesa-text-primary"
        >
          Voltar para o login
        </Link>
      </div>
    </div>
  )
}
