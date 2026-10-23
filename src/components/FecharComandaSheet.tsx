import { useRef, useState } from 'react'
import clsx from 'clsx'
import { supabase } from '../lib/supabase'
import { enfileirar } from '../lib/fila'
import { mensagemFecharComanda, percentualDeBps, taxaPadraoMarcada, totalDoFechamento, type ComandaAberta } from '../lib/comandaAberta'
import { METODOS_DISPONIVEIS, type MetodoPagamento } from '../lib/metodoPagamento'
import { formatarPrecoBR } from '../lib/preco'
import type { Barraca } from '../types/database'
import { BottomSheet } from './ui/BottomSheet'
import { Button } from './ui/Button'
import { Icone } from './ui/Icone'
import { useToast } from './ui/useToast'

const MSG_OFFLINE = 'Sem internet. O fechamento fica na fila e sincroniza quando a conexão voltar.'

type Resposta = { estado?: string; metodo?: string } | null

/**
 * Fecha a comanda aberta da Mesa: rodadas, subtotal, taxa de serviço (marcada por padrão, o operador pode desmarcar),
 * total e forma de pagamento (só as ativas da barraca). Com rede chama a RPC e mostra o resultado real; sem rede
 * enfileira `fechar_comanda` (a fila sincroniza depois).
 */
export function FecharComandaSheet({
  comanda,
  barraca,
  aoFechar,
  aoCancelar,
}: {
  comanda: ComandaAberta
  barraca: Barraca
  aoFechar: () => void
  aoCancelar: () => void
}) {
  const bps = barraca.taxa_servico_bps ?? 1000
  const [cobrarTaxa, setCobrarTaxa] = useState(taxaPadraoMarcada(barraca))
  const [metodo, setMetodo] = useState<MetodoPagamento | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const emAndamento = useRef(false) // duplo toque não enfileira duas vezes
  const { mostrarToast } = useToast()

  const ativos = barraca.metodos_pagamento_ativos ?? METODOS_DISPONIVEIS.map((m) => m.chave)
  const metodos = METODOS_DISPONIVEIS.filter((m) => ativos.includes(m.chave))
  const { taxaCentavos, totalCentavos } = totalDoFechamento(comanda.subtotalCentavos, cobrarTaxa, bps)
  const comTaxa = barraca.taxa_servico_habilitada === true

  async function enfileirarFechamento(m: MetodoPagamento) {
    await enfileirar('fechar_comanda', { comanda_id: comanda.id, metodo: m, cobrar_taxa_servico: cobrarTaxa })
    mostrarToast(MSG_OFFLINE, { variante: 'aviso' })
    aoFechar()
  }

  async function fecharComanda() {
    if (!metodo || emAndamento.current) return
    emAndamento.current = true
    setEnviando(true)
    setErro(null)
    try {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        await enfileirarFechamento(metodo)
        return
      }
      let resposta: Resposta = null
      let falhouRede = false
      try {
        const { data, error } = await supabase.rpc('fechar_comanda', {
          p_comanda_id: comanda.id,
          p_metodo: metodo,
          p_cobrar_taxa_servico: cobrarTaxa,
        })
        if (error) falhouRede = true
        else resposta = (data as Resposta) ?? null
      } catch {
        falhouRede = true
      }
      // Erro de rede/servidor: a fila reenvia (idempotente), então nada se perde.
      if (falhouRede) {
        await enfileirarFechamento(metodo)
        return
      }
      if (resposta?.estado === 'ok') {
        mostrarToast(`Mesa ${comanda.mesa} fechada: ${formatarPrecoBR(totalCentavos)}.`, { variante: 'sucesso' })
        aoFechar()
        return
      }
      setErro(mensagemFecharComanda(resposta?.estado, resposta?.metodo))
    } finally {
      emAndamento.current = false
      setEnviando(false)
    }
  }

  return (
    <BottomSheet open onClose={() => !enviando && aoCancelar()} aria-label={`Fechar comanda da Mesa ${comanda.mesa}`}>
      <h2 className="text-lg font-semibold text-mesa-text-primary">Fechar Mesa {comanda.mesa}</h2>

      <ul className="mt-3 text-sm text-mesa-text-secondary">
        {comanda.rodadas.map((r, i) => (
          <li key={r.pedidoId}>
            Rodada {i + 1}: {r.itens.map((it) => `${it.quantidade}x ${it.nome}`).join(', ')}
          </li>
        ))}
      </ul>

      <dl className="mt-4 flex flex-col gap-1 border-t border-mesa-border-subtle pt-3 text-sm">
        <div className="flex justify-between">
          <dt className="text-mesa-text-secondary">Subtotal</dt>
          <dd className="font-mesa-display font-bold text-mesa-text-primary">{formatarPrecoBR(comanda.subtotalCentavos)}</dd>
        </div>
        {comTaxa && (
          <div className="flex justify-between">
            <dt className="text-mesa-text-secondary">Taxa de serviço ({percentualDeBps(bps)}%)</dt>
            <dd className="font-mesa-display font-bold text-mesa-text-primary">{formatarPrecoBR(taxaCentavos)}</dd>
          </div>
        )}
        <div className="flex justify-between text-base">
          <dt className="font-semibold text-mesa-text-primary">Total</dt>
          <dd className="font-mesa-display font-bold text-mesa-text-primary">{formatarPrecoBR(totalCentavos)}</dd>
        </div>
      </dl>

      {comTaxa && (
        <label className="mt-3 flex min-h-11 cursor-pointer items-center gap-3">
          <input
            type="checkbox"
            checked={cobrarTaxa}
            disabled={enviando}
            onChange={(e) => setCobrarTaxa(e.target.checked)}
            className="size-5 accent-mesa-neutral-900"
          />
          <span className="text-base text-mesa-text-primary">Taxa de serviço ({percentualDeBps(bps)}%)</span>
        </label>
      )}

      <p className="mt-4 text-sm font-semibold text-mesa-text-primary">Como o cliente pagou?</p>
      <div className="mt-2 grid grid-cols-2 gap-3" role="radiogroup" aria-label="Forma de pagamento">
        {metodos.map((m) => {
          const selecionado = metodo === m.chave
          return (
            <button
              key={m.chave}
              type="button"
              role="radio"
              aria-checked={selecionado}
              disabled={enviando}
              onClick={() => {
                setMetodo(m.chave)
                setErro(null)
              }}
              className={clsx(
                'flex min-h-14 items-center gap-3 rounded-mesa-lg border-2 p-3 text-left outline-none transition-colors',
                selecionado
                  ? 'border-mesa-neutral-900 bg-mesa-neutral-100 dark:border-mesa-neutral-50 dark:bg-mesa-neutral-800'
                  : 'border-mesa-border-subtle bg-mesa-surface',
              )}
            >
              <Icone nome={m.icone} size={20} />
              <span className="text-sm font-semibold text-mesa-text-primary">{m.label}</span>
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

      <Button size="xl" className="mt-4 w-full" disabled={!metodo} loading={enviando} onClick={fecharComanda}>
        Fechar comanda
      </Button>
      <Button variant="ghost" size="md" className="mt-2 w-full" disabled={enviando} onClick={aoCancelar}>
        Cancelar
      </Button>
    </BottomSheet>
  )
}
