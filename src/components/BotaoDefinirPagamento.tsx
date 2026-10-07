import { useState } from 'react'
import clsx from 'clsx'
import { supabase } from '../lib/supabase'
import { mensagemDefinirMetodo } from '../lib/definirMetodo'
import { METODOS_DISPONIVEIS, humanizarMetodo, type MetodoPagamento } from '../lib/metodoPagamento'
import { BottomSheet } from './ui/BottomSheet'
import { Button } from './ui/Button'
import { Icone } from './ui/Icone'
import { useToast } from './ui/Toast'

const MSG_SEM_INTERNET = 'Sem internet. A forma de pagamento não foi definida.'

type RespostaRpc = { estado?: string; metodo?: string } | null

/**
 * Pedido "A definir na entrega" que o entregador não resolveu (link nunca aberto
 * ou expirado em 24h): o operador define a forma real aqui. Sem isso a NFC-e
 * nunca emite (emitir-nfce recusa `na_entrega`). Ação de gestão, só online: sem
 * rede mostra o erro em vez de enfileirar.
 */
export function BotaoDefinirPagamento({
  pedidoId,
  onDefinido,
}: {
  pedidoId: string
  /** Chamado com o método que ficou valendo no servidor (inclusive se já estava definido). */
  onDefinido: (metodo: string) => void
}) {
  const [aberto, setAberto] = useState(false)
  const [escolhido, setEscolhido] = useState<MetodoPagamento | null>(null)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const { mostrarToast } = useToast()

  function fechar() {
    if (salvando) return
    setAberto(false)
    setEscolhido(null)
    setErro(null)
  }

  async function confirmar() {
    if (!escolhido || salvando) return
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      setErro(MSG_SEM_INTERNET)
      return
    }
    setSalvando(true)
    setErro(null)

    let resposta: RespostaRpc = null
    let falhou = false
    try {
      const { data, error } = await supabase.rpc('definir_metodo_pagamento', {
        p_pedido_id: pedidoId,
        p_metodo: escolhido,
      })
      if (error) falhou = true
      else resposta = (data as RespostaRpc) ?? null
    } catch {
      falhou = true
    }
    setSalvando(false)

    if (falhou) {
      setErro(typeof navigator !== 'undefined' && navigator.onLine === false ? MSG_SEM_INTERNET : 'Não foi possível definir a forma de pagamento. Tente de novo.')
      return
    }

    if (resposta?.estado === 'ok' && resposta.metodo) {
      mostrarToast(`Forma de pagamento definida: ${humanizarMetodo(resposta.metodo)}.`, { variante: 'sucesso' })
      onDefinido(resposta.metodo)
      fechar()
      return
    }

    // Outro lugar já definiu (ex.: o entregador pelo link): mostra o que ficou valendo.
    if (resposta?.estado === 'ja_definido' && resposta.metodo) {
      onDefinido(resposta.metodo)
    }
    setErro(mensagemDefinirMetodo(resposta?.estado, resposta?.metodo))
  }

  return (
    <>
      <Button
        variant="outline"
        size="md"
        icon={<Icone nome="payments" size={18} />}
        onClick={() => setAberto(true)}
        className="mt-3 w-full"
      >
        Definir forma de pagamento
      </Button>

      <BottomSheet open={aberto} onClose={fechar} aria-label="Definir forma de pagamento">
        <h2 className="text-lg font-semibold text-mesa-text-primary">Como o cliente pagou?</h2>
        <p className="mt-1 text-sm text-mesa-text-secondary">
          Este pedido estava como “A definir na entrega”. Escolha a forma real: depois disso não dá pra mudar,
          e a nota fiscal passa a poder ser emitida.
        </p>

        <div className="mt-4 grid grid-cols-2 gap-3" role="radiogroup" aria-label="Forma de pagamento">
          {METODOS_DISPONIVEIS.map((metodo) => {
            const selecionado = escolhido === metodo.chave
            return (
              <button
                key={metodo.chave}
                type="button"
                role="radio"
                aria-checked={selecionado}
                disabled={salvando}
                onClick={() => {
                  setEscolhido(metodo.chave)
                  setErro(null)
                }}
                className={clsx(
                  'flex min-h-14 items-center gap-3 rounded-mesa-lg border-2 p-3 text-left outline-none transition-colors',
                  selecionado
                    ? 'border-mesa-neutral-900 bg-mesa-neutral-100 dark:border-mesa-neutral-50 dark:bg-mesa-neutral-800'
                    : 'border-mesa-border-subtle bg-mesa-surface',
                )}
              >
                <Icone nome={metodo.icone} size={20} />
                <span className="text-sm font-semibold text-mesa-text-primary">{metodo.label}</span>
              </button>
            )
          })}
        </div>

        {erro && (
          <p
            role="alert"
            className="mt-3 rounded-mesa-md border-l-[3px] border-mesa-error-500 bg-mesa-error-50 p-3 text-sm font-medium text-mesa-error-700 dark:bg-mesa-error-500/15 dark:text-mesa-error-400"
          >
            {erro}
          </p>
        )}

        <Button size="xl" className="mt-4 w-full" disabled={!escolhido} loading={salvando} onClick={confirmar}>
          Confirmar
        </Button>
        <Button variant="ghost" size="md" className="mt-2 w-full" disabled={salvando} onClick={fechar}>
          Cancelar
        </Button>
      </BottomSheet>
    </>
  )
}
