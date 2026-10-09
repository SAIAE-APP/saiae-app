import { useState } from 'react'
import clsx from 'clsx'
import { supabase } from '../lib/supabase'
import { mensagemCorrigirMetodo } from '../lib/corrigirMetodo'
import { METODOS_DISPONIVEIS, humanizarMetodo, type MetodoPagamento } from '../lib/metodoPagamento'
import { BottomSheet } from './ui/BottomSheet'
import { Button } from './ui/Button'
import { Icone } from './ui/Icone'
import { useToast } from './ui/useToast'

const MSG_SEM_INTERNET = 'Sem internet. A forma de pagamento não foi trocada.'

type RespostaRpc = { estado?: string; metodo?: string } | null

/**
 * Corrige a forma de pagamento de um pedido que já tinha uma forma real, enquanto a NFC-e não foi emitida. Ação de
 * gestão (só o dono, no Histórico que já exige a senha administrativa), só online: sem rede mostra o erro em vez de
 * enfileirar. A troca fica registrada (quem, quando, de qual para qual).
 */
export function BotaoCorrigirPagamento({
  pedidoId,
  metodoAtual,
  onCorrigido,
}: {
  pedidoId: string
  metodoAtual: string
  onCorrigido: (metodo: string) => void
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
      const { data, error } = await supabase.rpc('corrigir_metodo_pagamento', { p_pedido_id: pedidoId, p_metodo: escolhido })
      if (error) falhou = true
      else resposta = (data as RespostaRpc) ?? null
    } catch {
      falhou = true
    }
    setSalvando(false)

    if (falhou) {
      setErro(typeof navigator !== 'undefined' && navigator.onLine === false ? MSG_SEM_INTERNET : mensagemCorrigirMetodo(undefined))
      return
    }

    if (resposta?.estado === 'ok' && resposta.metodo) {
      mostrarToast(`Forma de pagamento corrigida: ${humanizarMetodo(resposta.metodo)}.`, { variante: 'sucesso' })
      onCorrigido(resposta.metodo)
      fechar()
      return
    }
    setErro(mensagemCorrigirMetodo(resposta?.estado))
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
        Corrigir forma de pagamento
      </Button>

      <BottomSheet open={aberto} onClose={fechar} aria-label="Corrigir forma de pagamento">
        <h2 className="text-lg font-semibold text-mesa-text-primary">Qual foi a forma de pagamento?</h2>
        <p className="mt-1 text-sm text-mesa-text-secondary">
          Hoje está como {humanizarMetodo(metodoAtual)}. Só dá pra trocar enquanto a nota fiscal não foi emitida; a troca
          fica registrada.
        </p>

        <div className="mt-4 grid grid-cols-2 gap-3" role="radiogroup" aria-label="Forma de pagamento">
          {METODOS_DISPONIVEIS.filter((m) => m.chave !== metodoAtual).map((metodo) => {
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
          Trocar forma de pagamento
        </Button>
        <Button variant="ghost" size="md" className="mt-2 w-full" disabled={salvando} onClick={fechar}>
          Cancelar
        </Button>
      </BottomSheet>
    </>
  )
}
