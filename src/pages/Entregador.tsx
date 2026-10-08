import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router'
import clsx from 'clsx'
import {
  METODOS_ENTREGADOR,
  buscarPedidoDoEntregador,
  confirmarEntrega,
  type MetodoEntregador,
  type PedidoDoEntregador,
} from '../lib/entregador'
import { formatarTelefoneBR } from '../lib/entrega'
import { formatarPrecoBR } from '../lib/preco'
import { humanizarMetodo } from '../lib/metodoPagamento'
import { Button } from '../components/ui/Button'
import { Icone } from '../components/ui/Icone'

type Estado =
  | { fase: 'carregando' }
  | { fase: 'erro_rede' }
  | { fase: 'pronto'; pedido: PedidoDoEntregador }
  | { fase: 'confirmado'; senha: number | null }

function Tela({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col bg-mesa-bg-base px-4 pb-[calc(env(safe-area-inset-bottom)+24px)] pt-[calc(env(safe-area-inset-top)+20px)]">
      {children}
    </div>
  )
}

function Aviso({ icone, titulo, texto }: { icone: string; titulo: string; texto?: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
      <Icone nome={icone} size={40} className="text-mesa-text-tertiary" />
      <p className="text-lg font-semibold text-mesa-text-primary">{titulo}</p>
      {texto && <p className="text-sm text-mesa-text-secondary">{texto}</p>}
    </div>
  )
}

/**
 * Link público do entregador (motoboy próprio, sem cadastro): vê o pedido de
 * Entrega, informa como o cliente pagou (só quando era "pagar na entrega") e
 * confirma. Sem troco. Depois de confirmar, o link só mostra "já confirmado".
 */
export function Entregador() {
  const { token = '' } = useParams<{ token: string }>()
  const [estado, setEstado] = useState<Estado>({ fase: 'carregando' })
  const [metodo, setMetodo] = useState<MetodoEntregador | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [erroEnvio, setErroEnvio] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    setEstado({ fase: 'carregando' })
    try {
      setEstado({ fase: 'pronto', pedido: await buscarPedidoDoEntregador(token) })
    } catch {
      setEstado({ fase: 'erro_rede' })
    }
  }, [token])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void carregar()
  }, [carregar])

  async function confirmar(pedido: Extract<PedidoDoEntregador, { estado: 'ok' }>) {
    if (enviando) return
    if (pedido.metodo_definivel && !metodo) {
      setErroEnvio('Escolha como o cliente pagou.')
      return
    }
    setEnviando(true)
    setErroEnvio(null)
    try {
      const r = await confirmarEntrega(token, pedido.metodo_definivel ? metodo : null)
      if (r.estado === 'confirmado' || r.estado === 'ja_confirmado') {
        setEstado({ fase: 'confirmado', senha: r.senha ?? pedido.senha })
      } else if (r.estado === 'metodo_obrigatorio' || r.estado === 'metodo_invalido') {
        setErroEnvio('Escolha como o cliente pagou.')
      } else if (r.estado === 'bloqueado') {
        setErroEnvio('Muitas tentativas. Aguarde alguns minutos.')
      } else {
        await carregar()
      }
    } catch {
      // Sem rede: nada foi enviado; tocar de novo é seguro (a confirmação é idempotente).
      setErroEnvio('Sem conexão. Toque de novo pra tentar.')
    } finally {
      setEnviando(false)
    }
  }

  if (estado.fase === 'carregando') {
    return (
      <Tela>
        <Aviso icone="progress_activity" titulo="Carregando pedido..." />
      </Tela>
    )
  }

  if (estado.fase === 'erro_rede') {
    return (
      <Tela>
        <Aviso icone="wifi_off" titulo="Sem conexão" texto="Não deu pra carregar o pedido." />
        <Button size="xl" className="w-full" onClick={() => void carregar()}>
          Tentar de novo
        </Button>
      </Tela>
    )
  }

  if (estado.fase === 'confirmado') {
    return (
      <Tela>
        <Aviso
          icone="check_circle"
          titulo="Entrega confirmada!"
          texto={estado.senha !== null ? `Pedido #${estado.senha}. Obrigado!` : 'Obrigado!'}
        />
      </Tela>
    )
  }

  const pedido = estado.pedido

  if (pedido.estado === 'invalido') {
    return (
      <Tela>
        <Aviso icone="link_off" titulo="Link inválido" texto="Peça à barraca pra enviar o link de novo." />
      </Tela>
    )
  }
  if (pedido.estado === 'bloqueado') {
    return (
      <Tela>
        <Aviso icone="lock_clock" titulo="Muitas tentativas" texto="Aguarde alguns minutos e tente de novo." />
      </Tela>
    )
  }
  if (pedido.estado === 'ja_confirmado') {
    return (
      <Tela>
        <Aviso
          icone="check_circle"
          titulo="Entrega já confirmada"
          texto={`Pedido #${pedido.senha}. Não há mais nada a fazer neste link.`}
        />
      </Tela>
    )
  }
  if (pedido.estado === 'cancelado' || pedido.estado === 'expirado') {
    return (
      <Tela>
        <Aviso
          icone="block"
          titulo={pedido.estado === 'cancelado' ? 'Pedido cancelado' : 'Link expirado'}
          texto="Fale com a barraca."
        />
      </Tela>
    )
  }

  if (pedido.estado !== 'ok') return null

  const enderecoLinha = [
    [pedido.rua, pedido.numero].filter(Boolean).join(', '),
    pedido.bairro,
  ]
    .filter(Boolean)
    .join(' - ')

  return (
    <Tela>
      <p className="text-xs font-semibold uppercase tracking-wider text-mesa-text-secondary">
        {pedido.barraca_nome ?? 'Entrega'}
      </p>
      <h1 className="font-mesa-display text-4xl font-black text-mesa-text-primary">Pedido #{pedido.senha}</h1>
      {pedido.status === 'a_fazer' && (
        <p className="mt-1 text-sm font-medium text-mesa-warning-700">Ainda em preparo na cozinha</p>
      )}

      <section className="mt-5 rounded-mesa-lg border border-mesa-border-subtle bg-mesa-surface p-4">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-mesa-text-secondary">Entregar para</h2>
        {pedido.cliente_nome && <p className="text-lg font-semibold text-mesa-text-primary">{pedido.cliente_nome}</p>}
        {enderecoLinha && <p className="mt-1 text-base text-mesa-text-primary">{enderecoLinha}</p>}
        {pedido.referencia && <p className="mt-1 text-sm text-mesa-text-secondary">Ref.: {pedido.referencia}</p>}
        {pedido.observacao && (
          <p className="mt-2 rounded-mesa-md bg-mesa-warning-50 p-2 text-sm font-medium text-mesa-warning-700 dark:bg-mesa-warning-500/15">
            {pedido.observacao}
          </p>
        )}
        {pedido.telefone && (
          <a
            href={`tel:${pedido.telefone}`}
            className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-mesa-btn border border-mesa-border-subtle px-4 text-base font-semibold text-mesa-text-primary"
          >
            <Icone nome="call" size={18} />
            {formatarTelefoneBR(pedido.telefone)}
          </a>
        )}
      </section>

      <section className="mt-4 rounded-mesa-lg border border-mesa-border-subtle bg-mesa-surface p-4">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-mesa-text-secondary">Itens</h2>
        <ul className="flex flex-col gap-1">
          {pedido.itens.map((item, i) => (
            <li key={i} className="text-base text-mesa-text-primary">
              <span className="font-mesa-display font-bold">{item.quantidade}x</span> {item.nome_item}
              {item.opcoes && item.opcoes.length > 0 && (
                <span className="block text-sm text-mesa-text-secondary">{item.opcoes.join(', ')}</span>
              )}
              {item.observacao && <span className="block text-sm text-mesa-text-secondary">{item.observacao}</span>}
            </li>
          ))}
        </ul>
        {pedido.taxa_entrega_centavos > 0 && (
          <p className="mt-3 flex justify-between text-sm text-mesa-text-secondary">
            <span>Taxa de entrega</span>
            <span>{formatarPrecoBR(pedido.taxa_entrega_centavos)}</span>
          </p>
        )}
        <p className="mt-2 flex justify-between border-t border-mesa-border-subtle pt-2 text-lg font-bold text-mesa-text-primary">
          <span>Total</span>
          <span className="font-mesa-display">{formatarPrecoBR(pedido.total_centavos)}</span>
        </p>
      </section>

      {pedido.metodo_definivel ? (
        <section className="mt-4">
          <h2 className="mb-2 text-sm font-semibold text-mesa-text-primary">Como o cliente pagou?</h2>
          <div className="grid grid-cols-2 gap-3" role="radiogroup" aria-label="Forma de pagamento">
            {METODOS_ENTREGADOR.map((m) => {
              const selecionado = metodo === m.chave
              return (
                <button
                  key={m.chave}
                  type="button"
                  role="radio"
                  aria-checked={selecionado}
                  onClick={() => {
                    setMetodo(m.chave)
                    setErroEnvio(null)
                  }}
                  className={clsx(
                    'flex min-h-14 items-center justify-center gap-2 rounded-mesa-lg border-2 px-3 text-base font-semibold outline-none',
                    selecionado
                      ? 'border-mesa-neutral-900 bg-mesa-orange-500 text-mesa-neutral-900'
                      : 'border-mesa-border-subtle bg-mesa-surface text-mesa-text-primary',
                  )}
                >
                  <Icone nome={m.icone} size={20} />
                  {m.label}
                </button>
              )
            })}
          </div>
        </section>
      ) : (
        <p className="mt-4 text-base font-semibold text-mesa-text-primary">
          Pagamento: {humanizarMetodo(pedido.metodo_pagamento)}
        </p>
      )}

      {erroEnvio && (
        <p role="alert" className="mt-3 rounded-mesa-md border-l-[3px] border-mesa-error-500 bg-mesa-error-50 p-3 text-sm font-medium text-mesa-error-700 dark:bg-mesa-error-500/15 dark:text-mesa-error-400">
          {erroEnvio}
        </p>
      )}

      <Button
        size="xl"
        className="mt-5 w-full"
        icon={<Icone nome="check" size={20} />}
        loading={enviando}
        onClick={() => void confirmar(pedido)}
      >
        Confirmar entrega
      </Button>
    </Tela>
  )
}
