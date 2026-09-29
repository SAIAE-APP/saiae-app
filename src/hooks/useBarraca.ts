import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Barraca } from '../types/database'

type EstadoBarraca = {
  barraca: Barraca | null
  carregando: boolean
  erro: string | null
}

function chaveCache(slug: string): string {
  return `mesaagil:barraca:${slug}`
}

function lerBarracaCache(slug: string): Barraca | null {
  try {
    const bruto = window.localStorage.getItem(chaveCache(slug))
    return bruto ? (JSON.parse(bruto) as Barraca) : null
  } catch {
    return null
  }
}

function salvarBarracaCache(slug: string, barraca: Barraca): void {
  try {
    window.localStorage.setItem(chaveCache(slug), JSON.stringify(barraca))
  } catch {
    // localStorage indisponível (modo privado, quota etc.) — só não cacheia
  }
}

// Última versão conhecida de cada barraca em memória + quem está ouvindo.
// Existe pra que um save bem-sucedido em Ajustes atualize a tela (contexto) e
// o cache de localStorage na hora — sem isso o cache ficava com o valor de
// antes do save e o próximo "fechar e abrir o app" mostrava o dado velho
// primeiro.
const ultimaBarraca = new Map<string, Barraca>()
const ouvintes = new Map<string, Set<(barraca: Barraca) => void>>()

/** Mescla `alteracoes` na barraca conhecida, regrava o cache e avisa quem usa
 * `useBarraca`. Chamar SÓ depois de o banco confirmar o update. */
export function atualizarBarracaCache(slug: string, alteracoes: Partial<Barraca>): void {
  const base = ultimaBarraca.get(slug) ?? lerBarracaCache(slug)
  if (!base) return
  const nova = { ...base, ...alteracoes }
  ultimaBarraca.set(slug, nova)
  salvarBarracaCache(slug, nova)
  ouvintes.get(slug)?.forEach((ouvinte) => ouvinte(nova))
}

export function useBarraca(slug: string) {
  const [estado, setEstado] = useState<EstadoBarraca>({
    barraca: null,
    carregando: true,
    erro: null,
  })

  useEffect(() => {
    let cancelado = false

    // Mostra a última barraca conhecida na hora (sem esperar rede) e
    // deixa a busca de verdade confirmar/atualizar em segundo plano.
    // Isso é o que faz o app instalado abrir de imediato mesmo sem
    // conexão — sem cache, ele ficaria preso em "Carregando..." pra
    // sempre no primeiro load offline.
    const cache = lerBarracaCache(slug)
    if (cache) {
      // TODO(v2): campo modo é legado, remover em migration futura
      ultimaBarraca.set(slug, cache)
      setEstado({ barraca: cache, carregando: false, erro: null })
    } else {
      setEstado({ barraca: null, carregando: true, erro: null })
    }

    const ouvinte = (barraca: Barraca) => {
      if (!cancelado) setEstado({ barraca, carregando: false, erro: null })
    }
    const conjunto = ouvintes.get(slug) ?? new Set<(barraca: Barraca) => void>()
    conjunto.add(ouvinte)
    ouvintes.set(slug, conjunto)

    supabase
      .from('barracas')
      .select('*')
      .eq('slug', slug)
      .single()
      .then(({ data, error }) => {
        if (cancelado) return

        if (error) {
          // já tem cache na tela — provavelmente é só falta de rede,
          // não vale a pena substituir o que já está funcionando por um erro
          if (cache) return
          setEstado({ barraca: null, carregando: false, erro: error.message })
          return
        }

        const barraca = data as Barraca
        // TODO(v2): campo modo é legado, remover em migration futura
        ultimaBarraca.set(slug, barraca)
        salvarBarracaCache(slug, barraca)
        setEstado({ barraca, carregando: false, erro: null })
      })

    return () => {
      cancelado = true
      conjunto.delete(ouvinte)
    }
  }, [slug])

  return estado
}
