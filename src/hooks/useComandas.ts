import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { agruparComandas, type ComandaAberta, type LinhaBanco } from '../lib/comandaAberta'

const chaveCache = (barracaId: string) => `saiae-comandas-abertas:${barracaId}`

function lerCache(barracaId: string): ComandaAberta[] {
  try {
    const bruto = localStorage.getItem(chaveCache(barracaId))
    const lista = bruto ? (JSON.parse(bruto) as ComandaAberta[]) : []
    return Array.isArray(lista) ? lista : []
  } catch {
    return []
  }
}

type LinhaPedido = {
  id: string
  senha: number | null
  criado_em: string
  status: string
  comandas: { id: string; mesa: string; aberta_em: string } | null
  itens_do_pedido: LinhaBanco['itens'] | null
}

async function buscarComandasAbertas(barracaId: string): Promise<ComandaAberta[]> {
  const { data, error } = await supabase
    .from('pedidos')
    .select(
      'id, senha, criado_em, status, comandas!inner(id, mesa, aberta_em, status), itens_do_pedido(nome_item, quantidade, preco_centavos_unitario, removido)',
    )
    .eq('barraca_id', barracaId)
    .eq('comandas.status', 'aberta')
    .not('comanda_id', 'is', null)
    .returns<LinhaPedido[]>()
  if (error) throw error
  const linhas: LinhaBanco[] = []
  for (const p of data ?? []) {
    if (!p.comandas) continue
    linhas.push({
      comanda_id: p.comandas.id,
      mesa: p.comandas.mesa,
      aberta_em: p.comandas.aberta_em,
      pedido_id: p.id,
      senha: p.senha,
      criado_em: p.criado_em,
      status: p.status,
      itens: p.itens_do_pedido ?? [],
    })
  }
  return agruparComandas(linhas)
}

/**
 * Comandas abertas da barraca (Mesa). Mostra na hora o último cache do aparelho e atualiza pela rede e pelo
 * Realtime; sem rede fica o cache (erro só informativo). Nunca bloqueia a operação.
 */
export function useComandasAbertas(barracaId: string): {
  comandas: ComandaAberta[]
  carregando: boolean
  erro: string | null
  recarregar: () => void
} {
  const [estado, setEstado] = useState<{
    barracaId: string
    comandas: ComandaAberta[]
    carregando: boolean
    erro: string | null
  }>(() => ({ barracaId, comandas: lerCache(barracaId), carregando: true, erro: null }))
  const [versao, setVersao] = useState(0)
  const recarregar = useCallback(() => setVersao((v) => v + 1), [])

  useEffect(() => {
    let cancelado = false
    buscarComandasAbertas(barracaId)
      .then((comandas) => {
        if (cancelado) return
        setEstado({ barracaId, comandas, carregando: false, erro: null })
        try {
          localStorage.setItem(chaveCache(barracaId), JSON.stringify(comandas))
        } catch {
          // sem storage: só não guarda cache.
        }
      })
      .catch(() => {
        if (!cancelado)
          setEstado({
            barracaId,
            comandas: lerCache(barracaId),
            carregando: false,
            erro: 'Não foi possível atualizar as mesas. Mostrando o último que o aparelho guardou.',
          })
      })
    return () => {
      cancelado = true
    }
  }, [barracaId, versao])

  useEffect(() => {
    const canal = supabase.channel(`comandas-abertas-${barracaId}`)
    for (const table of ['comandas', 'pedidos', 'itens_do_pedido']) {
      canal.on('postgres_changes', { event: '*', schema: 'public', table, filter: `barraca_id=eq.${barracaId}` }, recarregar)
    }
    canal.subscribe()
    return () => {
      void supabase.removeChannel(canal)
    }
  }, [barracaId, recarregar])

  if (estado.barracaId !== barracaId) {
    return { comandas: lerCache(barracaId), carregando: true, erro: null, recarregar }
  }
  return { comandas: estado.comandas, carregando: estado.carregando, erro: estado.erro, recarregar }
}
