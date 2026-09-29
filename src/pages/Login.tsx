import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { useAuth } from '../hooks/useAuth'
import { LayoutAuth } from '../components/LayoutAuth'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'

export function Login() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const { entrar } = useAuth()

  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [entrando, setEntrando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  async function aoSubmeter(e: FormEvent) {
    e.preventDefault()
    if (entrando) return

    setEntrando(true)
    setErro(null)

    const resultado = await entrar(email.trim(), senha)

    if (resultado.erro) {
      setErro(resultado.erro)
      setEntrando(false)
      return
    }

    // /assinar redireciona pro login preservando plano/ciclo — depois de
    // logar, volta exatamente pra lá em vez de cair na tela padrão.
    const voltar = params.get('voltar')
    if (voltar) {
      const resto = new URLSearchParams(params)
      resto.delete('voltar')
      navigate(`${voltar}?${resto.toString()}`)
      return
    }

    navigate('/')
  }

  return (
    <LayoutAuth>
      <h1 className="text-[32px] font-bold leading-[40px] text-mesa-text-primary">Bem-vindo de volta</h1>
      <p className="mt-1 text-sm text-mesa-text-secondary">Entre pra continuar na sua barraca</p>

      <form onSubmit={aoSubmeter} className="mt-8 flex flex-col gap-4">
        <Input
          label="E-mail"
          type="email"
          autoComplete="email"
          autoFocus
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />

        <div>
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <label htmlFor="login-senha" className="text-sm font-medium text-mesa-text-primary">
              Senha
            </label>
            <Link to="/esqueci-senha" className="text-sm font-medium text-mesa-text-primary underline">
              Esqueceu a senha?
            </Link>
          </div>
          <Input
            id="login-senha"
            type="password"
            autoComplete="current-password"
            required
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
          />
        </div>

        {erro && <p className="text-sm font-medium text-mesa-error-500">{erro}</p>}

        <Button type="submit" size="xl" loading={entrando} className="w-full">
          Entrar
        </Button>
      </form>

      <div className="my-6 flex items-center gap-3 text-xs text-mesa-text-tertiary">
        <span className="h-px flex-1 bg-mesa-border-subtle" />
        ou
        <span className="h-px flex-1 bg-mesa-border-subtle" />
      </div>

      <p className="text-center text-sm text-mesa-text-secondary">
        Não tem conta?{' '}
        <Link to={`/cadastro?${params.toString()}`}className="font-medium text-mesa-text-primary underline">
          Criar conta
        </Link>
      </p>
    </LayoutAuth>
  )
}
