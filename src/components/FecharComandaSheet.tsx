import { useRef, useState } from 'react'
import clsx from 'clsx'
import { supabase } from '../lib/supabase'
import { enfileirar } from '../lib/fila'
import { erroOnlineVaiParaFila } from '../lib/fecharComandaFila'
import {
  mensagemFecharComanda,
  percentualDeBps,
  taxaPadraoMarcada,
  textoComandaFechada,
  totalDoFechamento,
  type ComandaAberta,
} from '../lib/comandaAberta'
import { METODOS_DISPONIVEIS, type MetodoPagamento } from '../lib/metodoPagamento'
import { formatarPrecoBR } from '../lib/preco'
import type { Barraca } from '../types/database'
import { BottomSheet } from './ui/BottomSheet'
import { Button } from './ui/Button'
import { Icone } from './ui/Icone'
import { useToast } from './ui/useToast'

const MSG_OFFLINE = 'Sem internet. O fechamento fica na fila e sincroniza quando a conexão voltar.'
const MSG_FILA_FALHOU = 'Não foi possível guardar o fechamento no aparelho. Tente de novo.'

type Resposta = { estado?: string; metodo?: string; total_centavos?: number } | null

/**
 * Fecha a comanda aberta da Mesa: rodadas, subtotal, taxa de serviço (marcada por padrão, o operador pode desmarcar),
 * total e forma de pagamento (só as ativas da barraca). Com rede chama a RPC e mostra o resultado real; sem rede
 * enfileira `fechar_comanda` (a fila sincroniza depois). Comanda sem rodada ativa (todas canceladas) só é encerrada:
 * sem taxa e sem forma de pagamento (o servidor fecha com total 0, migration 20261029140000).
 * `aoFechar(confirmado)`: true quando o servidor confirmou agora; false quando ficou na fila.
 */
export function FecharComandaSheet({
  comanda,
  barraca,
  aoFechar,
  aoCancelar,
}: {
  comanda: ComandaAberta
  barraca: Barraca
  aoFechar: (confirmado: boolean) => void
  aoCancelar: () => void
}) {
  const bps = barraca.taxa_servico_bps ?? 1000
  const [cobrarTaxa, setCobrarTaxa] = useState(taxaPadraoMarcada(barraca))
  const [metodo, setMetodo] = useState<MetodoPagamento | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const emAndamento = useRef(false) // duplo toque não enfileira duas vezes
  const { mostrarToast } = useToast()
  const vazia = comanda.rodadas.length === 0

  const ativos = barraca.metodos_pagamento_ativos ?? METODOS_DISPONIVEIS.map((m) => m.chave)
  const metodos = METODOS_DISPONIVEIS.filter((m) => ativos.includes(m.chave))
  const { taxaCentavos, totalCentavos } = totalDoFechamento(comanda.subtotalCentavos, cobrarTaxa, bps)
  const comTaxa = barraca.taxa_servico_habilitada === true && !vazia
  const metodoEnviado = vazia ? null : metodo
  const cobrarEnviado = vazia ? false : cobrarTaxa

  async function enfileirarFechamento() {
    try {
      await enfileirar('fechar_comanda', { comanda_id: comanda.id, metodo: metodoEnviado, cobrar_taxa_servico: cobrarEnviado })
    } catch {
      setErro(MSG_FILA_FALHOU)
      return
    }
    mostrarToast(MSG_OFFLINE, { variante: 'aviso' })
    aoFechar(false)
  }

  async function fecharComanda() {
    if ((!vazia && !metodo) || emAndamento.current) return
    emAndamento.current = true
    setEnviando(true)
    setErro(null)
    try {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        await enfileirarFechamento()
        return
      }
      let resposta: Resposta = null
      let vaiParaFila = false
      try {
        const { data, error } = await supabase.rpc('fechar_comanda', {
          p_comanda_id: comanda.id,
          p_metodo: metodoEnviado,
          p_cobrar_taxa_servico: cobrarEnviado,
        })
        if (error) {
          // Rede caiu: a fila reenvia (idempotente), nada se perde. Erro do servidor: mostra na tela.
          if (erroOnlineVaiParaFila(error)) vaiParaFila = true
          else {
            setErro(mensagemFecharComanda(undefined))
            return
          }
        } else resposta = (data as Resposta) ?? null
      } catch {
        vaiParaFila = true
      }
      if (vaiParaFila) {
        await enfileirarFechamento()
        return
      }
      if (resposta?.estado === 'ok') {
        mostrarToast(textoComandaFechada(comanda.mesa, resposta.total_centavos, totalCentavos, vazia), { variante: 'sucesso' })
        aoFechar(true)
        return
      }
      // Comanda que parecia vazia ganhou rodada em outro aparelho: o servidor pede a forma de pagamento.
      setErro(
        vazia && resposta?.estado === 'metodo_invalido'
          ? 'Esta comanda recebeu uma rodada nova. Volte às mesas e abra de novo para cobrar.'
          : mensagemFecharComanda(resposta?.estado, resposta?.metodo),
      )
    } finally {
      emAndamento.current = false
      setEnviando(false)
    }
  }

  return (
    <BottomSheet open onClose={() => !enviando && aoCancelar()} aria-label={`Fechar comanda da Mesa ${comanda.mesa}`}>
      <h2 className="text-lg font-semibold text-mesa-text-primary">Fechar Mesa {comanda.mesa}</h2>

      {vazia && (
        <p className="mt-3 text-sm text-mesa-text-secondary">
          Nenhuma rodada ativa (todas canceladas). Encerrar libera a mesa sem cobrar nada.
        </p>
      )}

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

      {!vazia && <p className="mt-4 text-sm font-semibold text-mesa-text-primary">Como o cliente pagou?</p>}
      {!vazia && (
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
      )}

      {erro && (
        <p
          role="alert"
          className="mt-3 rounded-mesa-md border-l-[3px] border-mesa-error-500 bg-mesa-error-50 p-3 text-sm font-medium text-mesa-error-700 dark:bg-mesa-error-500/15 dark:text-mesa-error-400"
        >
          {erro}
        </p>
      )}

      <Button size="xl" className="mt-4 w-full" disabled={!vazia && !metodo} loading={enviando} onClick={fecharComanda}>
        {vazia ? 'Encerrar comanda vazia' : 'Fechar comanda'}
      </Button>
      <Button variant="ghost" size="md" className="mt-2 w-full" disabled={enviando} onClick={aoCancelar}>
        Cancelar
      </Button>
    </BottomSheet>
  )
}
