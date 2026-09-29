import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { useAuth } from '../hooks/useAuth'
import { REQUISITOS_SENHA, validarSenhaForte } from '../lib/senha'
import { LayoutAuth } from '../components/LayoutAuth'
import { Button } from '../components/ui/Button'
import { Icone } from '../components/ui/Icone'
import { Input } from '../components/ui/Input'

export function Cadastro() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const { cadastrar } = useAuth()

  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [confirmarSenha, setConfirmarSenha] = useState('')
  const [cadastrando, setCadastrando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [precisaConfirmarEmail, setPrecisaConfirmarEmail] = useState(false)

  const { valida: senhaValida } = validarSenhaForte(senha)
  const mostraDivergencia = confirmarSenha.length > 0 && confirmarSenha !== senha
  const podeEnviar = email.trim().length > 0 && senhaValida && confirmarSenha === senha

  async function aoSubmeter(e: FormEvent) {
    e.preventDefault()
    if (!podeEnviar || cadastrando) return

    setCadastrando(true)
    setErro(null)

    const resultado = await cadastrar(email.trim(), senha)

    if (resultado.erro) {
      setErro(resultado.erro)
      setCadastrando(false)
      return
    }

    if (resultado.precisaConfirmarEmail) {
      setPrecisaConfirmarEmail(true)
      setCadastrando(false)
      return
    }

    // /assinar redireciona pro cadastro preservando plano/ciclo — depois
    // de criar a conta, volta exatamente pra lá em vez de cair na tela
    // padrão (só quando não precisa confirmar e-mail antes).
    const voltar = params.get('voltar')
    if (voltar) {
      const resto = new URLSearchParams(params)
      resto.delete('voltar')
      navigate(`${voltar}?${resto.toString()}`)
      return
    }

    navigate('/')
  }

  if (precisaConfirmarEmail) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center bg-mesa-bg-base p-6 text-center">
        <div className="w-full max-w-[380px]">
          <div className="mx-auto flex size-16 items-center justify-center rounded-mesa-full bg-white shadow-mesa-1 dark:bg-mesa-neutral-800">
            <Icone nome="mail" size={24} className="text-mesa-orange-500" />
          </div>
          <h1 className="mt-4 text-2xl font-bold leading-[32px] text-mesa-text-primary">
            Confirme seu e-mail
          </h1>
          <p className="mt-2 text-sm text-mesa-text-secondary">
            Mandamos um link de confirmação pra <strong>{email}</strong>. Toca nele e volta aqui
            pra entrar.
          </p>
          <Button size="xl" className="mt-8 w-full" onClick={() => navigate(`/login?${params.toString()}`)}>
            Ir para o login
          </Button>
        </div>
      </div>
    )
  }

  return (
    <LayoutAuth>
      <h1 className="text-[32px] font-bold leading-[40px] text-mesa-text-primary">Criar conta</h1>
      <p className="mt-1 text-sm text-mesa-text-secondary">Comece a usar o Sai aê na sua barraca</p>

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
          <Input
            label="Senha"
            type="password"
            autoComplete="new-password"
            required
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
          />
          <ul className="mt-2 flex flex-col gap-1">
            {REQUISITOS_SENHA.map((requisito) => {
              const atendido = requisito.testar(senha)
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
        </div>

        <div>
          <Input
            label="Confirmar senha"
            type="password"
            autoComplete="new-password"
            required
            value={confirmarSenha}
            onChange={(e) => setConfirmarSenha(e.target.value)}
          />
          {mostraDivergencia && (
            <p className="mt-1 text-xs font-medium text-mesa-error-500">
              As senhas não conferem
            </p>
          )}
        </div>

        {erro && <p className="text-sm font-medium text-mesa-error-500">{erro}</p>}

        <Button type="submit" size="xl" loading={cadastrando} disabled={!podeEnviar} className="w-full">
          Criar conta
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-mesa-text-secondary">
        Já tem conta?{' '}
        <Link to="/login" className="font-medium text-mesa-text-primary">
          Entrar
        </Link>
      </p>
    </LayoutAuth>
  )
}
