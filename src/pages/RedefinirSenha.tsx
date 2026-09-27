import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import { supabase } from '../lib/supabase'
import { REQUISITOS_SENHA, validarSenhaForte } from '../lib/senha'
import { Button } from '../components/ui/Button'
import { Icone } from '../components/ui/Icone'
import { Input } from '../components/ui/Input'

const ATRASO_REDIRECIONAMENTO_MS = 1500

export function RedefinirSenha() {
  const navigate = useNavigate()

  const [novaSenha, setNovaSenha] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [salvo, setSalvo] = useState(false)

  useEffect(() => {
    if (!salvo) return
    const timeout = window.setTimeout(() => navigate('/'), ATRASO_REDIRECIONAMENTO_MS)
    return () => window.clearTimeout(timeout)
  }, [salvo, navigate])

  const { valida: senhaValida } = validarSenhaForte(novaSenha)

  async function aoSubmeter(e: FormEvent) {
    e.preventDefault()
    if (salvando || !senhaValida) return

    setSalvando(true)
    setErro(null)

    const { error } = await supabase.auth.updateUser({ password: novaSenha })

    setSalvando(false)

    if (error) {
      setErro('Não foi possível salvar a nova senha. Tente novamente.')
      return
    }

    setSalvo(true)
  }

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-mesa-bg-base p-6">
      <div className="w-full max-w-[420px]">
        <div className="flex flex-col items-center text-center">
          <div className="flex size-16 items-center justify-center rounded-mesa-full bg-white shadow-mesa-1 dark:bg-mesa-neutral-800">
            <Icone nome="key" size={28} className="text-mesa-orange-500" />
          </div>
          <h1 className="mt-4 text-[32px] font-bold leading-[40px] text-mesa-text-primary">
            Redefinir senha
          </h1>
          {salvo ? (
            <p className="mt-1 flex items-center justify-center gap-1.5 text-sm text-mesa-text-secondary">
              <Icone nome="check_circle" size={16} className="text-mesa-success-700 dark:text-mesa-success-500" />
              Senha atualizada! Te levando pro Sai aê...
            </p>
          ) : (
            <p className="mt-1 text-sm text-mesa-text-secondary">Escolha uma senha nova</p>
          )}
        </div>

        {!salvo && (
          <>
            <form onSubmit={aoSubmeter} className="mt-8 flex flex-col gap-4">
              <Input
                label="Nova senha"
                type="password"
                autoComplete="new-password"
                autoFocus
                required
                value={novaSenha}
                onChange={(e) => setNovaSenha(e.target.value)}
              />

              <ul className="flex flex-col gap-1">
                {REQUISITOS_SENHA.map((requisito) => {
                  const atendido = requisito.testar(novaSenha)
                  return (
                    <li
                      key={requisito.chave}
                      className={`flex items-center gap-1.5 text-xs ${
                        atendido ? 'text-mesa-success-700 dark:text-mesa-success-500' : 'text-mesa-text-tertiary'
                      }`}
                    >
                      <span aria-hidden>{atendido ? '✓' : '✗'}</span>
                      {requisito.label}
                    </li>
                  )
                })}
              </ul>

              {erro && <p className="text-sm font-medium text-mesa-error-500">{erro}</p>}

              <Button
                type="submit"
                size="xl"
                loading={salvando}
                disabled={!senhaValida}
                className="w-full"
              >
                Salvar nova senha
              </Button>
            </form>

            <Link
              to="/login"
              className="mt-4 block text-center text-sm font-medium text-mesa-text-primary"
            >
              Voltar para o login
            </Link>
          </>
        )}
      </div>
    </div>
  )
}
