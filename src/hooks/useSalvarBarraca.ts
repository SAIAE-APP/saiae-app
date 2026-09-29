import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { atualizarBarracaCache } from './useBarraca'
import type { Barraca } from '../types/database'

export const MSG_SEM_INTERNET = 'Sem internet. Não foi salvo.'

/** Traduz erro do Supabase/fetch pra texto que o dono da barraca entende,
 * sem esconder a causa real (vai junto, pra ele poder me mandar por print). */
export function mensagemErroSalvar(erro: { message?: string } | null | undefined): string {
  const bruta = erro?.message ?? ''
  if (/failed to fetch|networkerror|network request failed|load failed/i.test(bruta)) {
    return MSG_SEM_INTERNET
  }
  return bruta ? `Não foi possível salvar: ${bruta}` : 'Não foi possível salvar. Tente novamente.'
}

/**
 * Rascunho de um campo de Ajustes. Sem rascunho, o valor mostrado é SEMPRE o
 * que veio do servidor/cache (então quando o dado fresco chega depois do
 * cache, a tela acompanha — o bug do CNPJ "sumido" era um useState que só
 * lia o valor inicial). Com rascunho, o que o usuário digitou é preservado e
 * `alterado` diz se difere do servidor: só isso habilita o botão Salvar, e
 * nada é salvo sem o usuário ter editado.
 */
export function useRascunho<T>(valorServidor: T, iguais: (a: T, b: T) => boolean = Object.is) {
  const [rascunho, setRascunho] = useState<{ valor: T } | null>(null)
  const valor = rascunho ? rascunho.valor : valorServidor
  const alterado = rascunho !== null && !iguais(rascunho.valor, valorServidor)
  return {
    valor,
    alterado,
    definir: (novo: T) => setRascunho({ valor: novo }),
    descartar: () => setRascunho(null),
  }
}

/**
 * Salva colunas da barraca com feedback de verdade: offline avisa, erro do
 * banco aparece, update que não afetou nenhuma linha (RLS) conta como erro, e
 * só depois da confirmação o cache/contexto da barraca é atualizado.
 * Use uma instância por campo/grupo de campos.
 */
export function useSalvarBarraca(barraca: Pick<Barraca, 'id' | 'slug'>) {
  const [salvando, setSalvando] = useState(false)
  const [salvo, setSalvo] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const timerSalvo = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (timerSalvo.current !== null) window.clearTimeout(timerSalvo.current)
    }
  }, [])

  const salvar = useCallback(
    async (alteracoes: Partial<Barraca>): Promise<boolean> => {
      setErro(null)
      setSalvo(false)

      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        setErro(MSG_SEM_INTERNET)
        return false
      }

      setSalvando(true)
      let mensagem: string | null = null
      try {
        const { data, error } = await supabase
          .from('barracas')
          .update(alteracoes)
          .eq('id', barraca.id)
          .select('id')
        if (error) mensagem = mensagemErroSalvar(error)
        else if (!data || data.length === 0) {
          mensagem = 'Não foi possível salvar: sem permissão para alterar esta barraca.'
        }
      } catch (e) {
        mensagem = mensagemErroSalvar(e instanceof Error ? e : null)
      }
      setSalvando(false)

      if (mensagem) {
        setErro(mensagem)
        return false
      }

      atualizarBarracaCache(barraca.slug, alteracoes)
      setSalvo(true)
      if (timerSalvo.current !== null) window.clearTimeout(timerSalvo.current)
      timerSalvo.current = window.setTimeout(() => setSalvo(false), 2500)
      return true
    },
    [barraca.id, barraca.slug],
  )

  const limparErro = useCallback(() => setErro(null), [])

  return { salvar, salvando, salvo, erro, limparErro }
}
