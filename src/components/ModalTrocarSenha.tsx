import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { REQUISITOS_SENHA, validarSenhaForte } from '../lib/senha'
import { BottomSheet } from './ui/BottomSheet'
import { Button } from './ui/Button'
import { Icone } from './ui/Icone'
import { Input } from './ui/Input'

const MENSAGENS_ERRO_ATUALIZAR: Record<string, string> = {
  'New password should be different from the old password.':
    'A nova senha precisa ser diferente da atual.',
}

function traduzirErroAtualizar(mensagem: string): string {
  return MENSAGENS_ERRO_ATUALIZAR[mensagem] ?? 'Não foi possível trocar a senha. Tente novamente.'
}

export function ModalTrocarSenha({
  email,
  temSenha = true,
  onFechar,
  onSucesso,
}: {
  email: string
  /** Conta só-Google não tem senha ainda: não pede a atual e o texto vira "Criar uma senha". */
  temSenha?: boolean
  onFechar: () => void
  onSucesso: () => void
}) {
  const [senhaAtual, setSenhaAtual] = useState('')
  const [novaSenha, setNovaSenha] = useState('')
  const [confirmarSenha, setConfirmarSenha] = useState('')
  const [processando, setProcessando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const { valida: novaSenhaValida } = validarSenhaForte(novaSenha)
  const mostraDivergencia = confirmarSenha.length > 0 && confirmarSenha !== novaSenha

  const podeTrocar =
    novaSenhaValida && confirmarSenha === novaSenha && (!temSenha || senhaAtual.length > 0) && !processando

  async function trocarSenha() {
    if (!podeTrocar) return
    setProcessando(true)
    setErro(null)

    // reautentica com a senha atual antes de trocar — supabase-js so troca a
    // sessao ativa por uma nova (mesmo usuario, tokens renovados) quando o
    // login da certo; se der errado, nao mexe na sessao existente. Validado
    // via Playwright na etapa de testes, nao so por inspecao de codigo.
    const { error: erroLogin } = temSenha
      ? await supabase.auth.signInWithPassword({ email, password: senhaAtual })
      : { error: null }

    if (erroLogin) {
      setErro('Senha atual incorreta')
      setProcessando(false)
      return
    }

    const { error: erroUpdate } = await supabase.auth.updateUser({ password: novaSenha })

    if (erroUpdate) {
      setErro(traduzirErroAtualizar(erroUpdate.message))
      setProcessando(false)
      return
    }

    setProcessando(false)
    onSucesso()
  }

  return (
    <BottomSheet open onClose={onFechar} aria-label={temSenha ? 'Trocar senha' : 'Criar uma senha'}>
      <h2 className="text-lg font-semibold text-mesa-text-primary">{temSenha ? 'Trocar senha' : 'Criar uma senha'}</h2>
      <p className="mt-1 text-sm text-mesa-text-secondary">
        {temSenha
          ? 'Digite sua senha atual e escolha uma nova segura.'
          : 'Você entra com o Google. Crie uma senha se quiser poder entrar também com e-mail e senha.'}
      </p>

      <div className="mt-4 flex flex-col gap-4">
        {temSenha && (
          <Input
            label="Senha atual"
            type="password"
            value={senhaAtual}
            onChange={(e) => setSenhaAtual(e.target.value)}
            autoComplete="current-password"
            autoFocus
          />
        )}

        <Input
          label="Nova senha"
          type="password"
          value={novaSenha}
          onChange={(e) => setNovaSenha(e.target.value)}
          autoComplete="new-password"
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

        <Input
          label="Confirmar nova senha"
          type="password"
          value={confirmarSenha}
          onChange={(e) => setConfirmarSenha(e.target.value)}
          autoComplete="new-password"
          error={mostraDivergencia ? 'As senhas não conferem' : undefined}
        />

        {erro && <p className="text-sm font-medium text-mesa-error-500">{erro}</p>}

        <Button
          size="xl"
          icon={<Icone nome="key" size={20} />}
          disabled={!podeTrocar}
          loading={processando}
          onClick={trocarSenha}
          className="w-full"
        >
          {temSenha ? 'Trocar senha' : 'Criar senha'}
        </Button>
        <Button variant="ghost" size="md" onClick={onFechar} className="w-full">
          Voltar
        </Button>
      </div>
    </BottomSheet>
  )
}
