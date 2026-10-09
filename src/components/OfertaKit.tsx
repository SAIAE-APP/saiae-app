import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { supabase } from '../lib/supabase'
import { aplicarKit, salvarOrigem } from '../lib/onboardingApi'
import { KIT_NENHUM, kitDoId, mensagemDoEstadoDoKit, type KitId } from '../lib/kitsIniciais'
import { BottomSheet } from './ui/BottomSheet'
import { Button } from './ui/Button'
import { SeletorDeKit } from './SeletorDeKit'

/**
 * "Montar um cardápio de exemplo" no Hub, para quem pulou o kit no assistente e ainda tem a barraca vazia. A mesma
 * escolha do passo 2. A RPC recusa barraca antiga ou com itens (catálogo nunca é misturado ou sobrescrito).
 * "Começar do zero" só registra a decisão para a oferta sumir do checklist.
 */
export function OfertaKit({ barracaId, slug, aberto, onFechar, onResolvido }: { barracaId: string; slug: string; aberto: boolean; onFechar: () => void; onResolvido: () => void }) {
  const navigate = useNavigate()
  const [categoria, setCategoria] = useState<string | null>(null)
  const [kit, setKit] = useState<string | null>(null)
  const [trabalhando, setTrabalhando] = useState(false)
  const [mensagem, setMensagem] = useState<string | null>(null)

  useEffect(() => {
    if (!aberto) return
    let cancelado = false
    supabase
      .from('barracas')
      .select('categoria_negocio')
      .eq('id', barracaId)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelado) setCategoria((data as { categoria_negocio: string | null } | null)?.categoria_negocio ?? null)
      })
      .then(undefined, () => {})
    return () => {
      cancelado = true
    }
  }, [aberto, barracaId])

  async function confirmar() {
    if (!kit) return
    setTrabalhando(true)
    setMensagem(null)
    if (kit === KIT_NENHUM) {
      const r = await salvarOrigem(null, null, null, KIT_NENHUM)
      setTrabalhando(false)
      if (!r.ok) {
        setMensagem('Não foi possível salvar agora. Tente de novo.')
        return
      }
      onResolvido()
      onFechar()
      return
    }
    if (!kitDoId(kit)) {
      setTrabalhando(false)
      return
    }
    const r = await aplicarKit(barracaId, kit as KitId)
    setTrabalhando(false)
    const estado = r.ok ? r.dados.estado : 'dados_invalidos'
    if (estado === 'ok' || estado === 'ja_aplicado') {
      onResolvido()
      onFechar()
      navigate(`/${slug}/ajustes/cardapio/exemplo`)
      return
    }
    setMensagem(mensagemDoEstadoDoKit(estado))
  }

  return (
    <BottomSheet open={aberto} onClose={() => !trabalhando && onFechar()} aria-label="Montar um cardápio de exemplo">
      <div className="flex max-h-[80dvh] flex-col gap-3 overflow-y-auto">
        <h3 className="text-lg font-semibold text-mesa-text-primary">Montar um cardápio de exemplo</h3>
        <SeletorDeKit categoria={categoria} valor={kit} onChange={setKit} />
        {mensagem && <p role="alert" className="text-sm text-mesa-text-primary">{mensagem}</p>}
        <Button size="xl" className="w-full" disabled={!kit || trabalhando} loading={trabalhando} onClick={confirmar}>
          {kit === KIT_NENHUM ? 'Começar do zero' : 'Montar cardápio'}
        </Button>
      </div>
    </BottomSheet>
  )
}
