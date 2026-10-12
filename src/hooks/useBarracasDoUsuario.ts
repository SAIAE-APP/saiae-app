import { useEffect, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import type { Barraca } from '../types/database'

export type BarracaComPapel = {
  barraca_id: string
  papel: string
  barraca: Barraca
  /** Só presente quando `papel === 'suporte'` — até quando o acesso vale. */
  expiraEmSuporte?: string
}

// Cache em memória do módulo — sobrevive a remounts (Dispatcher, RotaProtegida
// e SelecionarBarraca todos chamam esse hook) sem precisar refetch, e é
// automaticamente invalidado quando o usuario_id muda (troca de conta).
let cache: { usuarioId: string; barracas: BarracaComPapel[] } | null = null

// RotaProtegida não desmonta ao trocar de /selecionar-barraca pra /:slug
// (React vê o mesmo componente, só com props/children diferentes), então
// uma instância do hook já montada não reage sozinha quando OUTRA instância
// (ex.: a de SelecionarBarraca, depois de criar uma barraca) atualiza o
// cache. Esses listeners avisam todas as instâncias vivas pra atualizarem
// o próprio estado quando qualquer uma delas busca dados novos.
const listeners = new Set<(barracas: BarracaComPapel[]) => void>()

function publicarCache(usuarioId: string, barracas: BarracaComPapel[]): void {
  cache = { usuarioId, barracas }
  listeners.forEach((ouvinte) => ouvinte(barracas))
}

async function buscarBarracasDoUsuario(usuarioId: string): Promise<{
  barracas: BarracaComPapel[]
  erro: string | null
}> {
  const [normal, suporte] = await Promise.all([
    supabase
      .from('usuarios_barracas')
      .select('barraca_id, papel, barracas(id, nome, slug, logo_url, modo, verde_ate, amarelo_ate, criada_em)')
      .eq('usuario_id', usuarioId),
    // Barracas com acesso de suporte ATIVO agora (não vem de usuarios_barracas
    // — suporte nunca ganha linha lá). Falha aqui não derruba a lista normal:
    // é um extra, não a fonte principal de acesso de ninguém.
    supabase.rpc('suporte_minhas_barracas'),
  ])

  if (normal.error) return { barracas: [], erro: normal.error.message }

  const resultado: BarracaComPapel[] = (normal.data ?? []).map((linha) => ({
    barraca_id: linha.barraca_id as string,
    papel: linha.papel as string,
    barraca: linha.barracas as unknown as Barraca,
  }))

  const idsNormais = new Set(resultado.map((r) => r.barraca_id))
  type LinhaSuporte = { barraca_id: string; nome: string; slug: string; logo_url: string | null; expira_em: string }
  for (const linha of (suporte.data ?? []) as LinhaSuporte[]) {
    if (idsNormais.has(linha.barraca_id)) continue // nunca deveria acontecer — suporte não tem linha em usuarios_barracas
    resultado.push({
      barraca_id: linha.barraca_id,
      papel: 'suporte',
      barraca: { id: linha.barraca_id, nome: linha.nome, slug: linha.slug, logo_url: linha.logo_url } as unknown as Barraca,
      expiraEmSuporte: linha.expira_em,
    })
  }

  return { barracas: resultado, erro: null }
}

export function useBarracasDoUsuario(usuario: User | null) {
  const [barracas, setBarracas] = useState<BarracaComPapel[]>(() => {
    if (usuario && cache?.usuarioId === usuario.id) return cache.barracas
    return []
  })
  const [carregando, setCarregando] = useState(() => {
    if (!usuario) return false
    return cache?.usuarioId !== usuario.id
  })
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    if (!usuario) {
      setBarracas([])
      setCarregando(false)
      setErro(null)
      return
    }

    const usuarioId = usuario.id

    function ouvirAtualizacoes(novasBarracas: BarracaComPapel[]) {
      setBarracas(novasBarracas)
      setCarregando(false)
      setErro(null)
    }
    listeners.add(ouvirAtualizacoes)

    if (cache?.usuarioId === usuarioId) {
      setBarracas(cache.barracas)
      setCarregando(false)
      setErro(null)
      return () => {
        listeners.delete(ouvirAtualizacoes)
      }
    }

    let cancelado = false
    setCarregando(true)
    setErro(null)

    buscarBarracasDoUsuario(usuarioId).then(({ barracas: resultado, erro: erroBusca }) => {
      if (cancelado) return

      if (erroBusca) {
        setErro(erroBusca)
        setCarregando(false)
        return
      }

      publicarCache(usuarioId, resultado)
    })

    return () => {
      cancelado = true
      listeners.delete(ouvirAtualizacoes)
    }
  }, [usuario])

  /** Refaz a busca ignorando o cache — usa depois de criar uma barraca nova,
   * pra ela aparecer na lista (em todas as instâncias do hook já montadas,
   * como a de RotaProtegida) sem precisar recarregar a página. */
  async function recarregar() {
    if (!usuario) return
    setCarregando(true)
    const { barracas: resultado, erro: erroBusca } = await buscarBarracasDoUsuario(usuario.id)
    if (erroBusca) {
      setErro(erroBusca)
      setCarregando(false)
      return
    }
    publicarCache(usuario.id, resultado)
  }

  return { barracas, carregando, erro, recarregar }
}
