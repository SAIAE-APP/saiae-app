import { useEffect, useState } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { urlPublica } from '../lib/urlPublica'

const MENSAGENS_ERRO_LOGIN: Record<string, string> = {
  'Invalid login credentials': 'Email ou senha incorretos',
  'Email not confirmed': 'Confirme seu email antes de entrar',
}

function traduzirErroLogin(mensagem: string): string {
  return MENSAGENS_ERRO_LOGIN[mensagem] ?? 'Não foi possível entrar. Tente novamente.'
}

const MENSAGENS_ERRO_CADASTRO: Record<string, string> = {
  'User already registered': 'Já existe uma conta com esse e-mail',
}

function traduzirErroCadastro(mensagem: string): string {
  return MENSAGENS_ERRO_CADASTRO[mensagem] ?? 'Não foi possível criar a conta. Tente novamente.'
}

export function useAuth() {
  const [sessao, setSessao] = useState<Session | null>(null)
  const [carregando, setCarregando] = useState(true)

  useEffect(() => {
    let cancelado = false

    supabase.auth.getSession().then(({ data }) => {
      if (cancelado) return
      setSessao(data.session)
      setCarregando(false)
    })

    const { data: assinatura } = supabase.auth.onAuthStateChange((_evento, novaSessao) => {
      if (cancelado) return
      setSessao(novaSessao)
      setCarregando(false)
    })

    return () => {
      cancelado = true
      assinatura.subscription.unsubscribe()
    }
  }, [])

  async function entrar(email: string, senha: string): Promise<{ erro?: string }> {
    const { error } = await supabase.auth.signInWithPassword({ email, password: senha })
    if (error) return { erro: traduzirErroLogin(error.message) }
    return {}
  }

  /** precisaConfirmarEmail=true quando o projeto exige confirmação por
   * e-mail antes de liberar sessão (signUp não devolve session nesse caso). */
  async function cadastrar(
    email: string,
    senha: string,
  ): Promise<{ erro?: string; precisaConfirmarEmail?: boolean }> {
    const { data, error } = await supabase.auth.signUp({ email, password: senha })
    if (error) return { erro: traduzirErroCadastro(error.message) }
    return { precisaConfirmarEmail: !data.session }
  }

  async function sair(): Promise<void> {
    await supabase.auth.signOut()
  }

  async function resetarSenha(email: string): Promise<void> {
    await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: urlPublica('/redefinir-senha'),
    })
  }

  const usuario: User | null = sessao?.user ?? null

  return { sessao, usuario, carregando, entrar, cadastrar, sair, resetarSenha }
}
