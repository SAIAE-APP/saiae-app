import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { classesBotaoIcone } from '../lib/estiloBotaoIcone'
import { excluirClienteFinal, listarClientesFinais } from '../lib/clientesFinais'
import { formatarTelefoneBR } from '../lib/entrega'
import { modosAtivos } from '../lib/atendimento'
import { MSG_SEM_INTERNET, mensagemErroSalvar } from '../hooks/useSalvarBarraca'
import { BottomSheet } from './ui/BottomSheet'
import { Button } from './ui/Button'
import { Card } from './ui/Card'
import { Icone } from './ui/Icone'
import { Input } from './ui/Input'
import type { Barraca, ClienteFinal } from '../types/database'

function RotuloSecao({ icone, children }: { icone?: string; children: ReactNode }) {
  return (
    <h2 className="mb-3 flex items-center gap-1.5 font-mesa-sans text-xs font-semibold uppercase tracking-wider text-mesa-text-secondary">
      {icone && <Icone nome={icone} size={14} />}
      {children}
    </h2>
  )
}

function enderecoDoCliente(c: ClienteFinal): string {
  const base = `${c.rua}, ${c.numero} - ${c.bairro}`
  return c.referencia ? `${base} (${c.referencia})` : base
}

/**
 * Clientes de entrega salvos (nome, telefone, endereço). Existe pra cumprir a
 * LGPD: o lojista consegue ver e EXCLUIR o cadastro de um cliente. Excluir
 * apaga só o cadastro; os pedidos já feitos mantêm os dados da entrega copiados
 * (são registro de venda). Só aparece quando a barraca usa Entrega ou já tem
 * algum cliente salvo.
 */
export function SecaoClientesEntrega({ barraca }: { barraca: Barraca }) {
  const [busca, setBusca] = useState('')
  const [clientes, setClientes] = useState<ClienteFinal[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erroLista, setErroLista] = useState<string | null>(null)
  const [paraExcluir, setParaExcluir] = useState<ClienteFinal | null>(null)
  const [excluindo, setExcluindo] = useState(false)
  const [erroExcluir, setErroExcluir] = useState<string | null>(null)
  const [recarga, setRecarga] = useState(0)

  const barracaId = barraca.id
  const usaEntrega = modosAtivos(barraca).includes('entrega')

  useEffect(() => {
    let cancelado = false
    // Debounce só quando há termo; a lista inicial carrega na hora.
    const espera = busca.trim() ? 300 : 0
    const timer = window.setTimeout(() => {
      listarClientesFinais(barracaId, busca)
        .then((lista) => {
          if (cancelado) return
          setClientes(lista)
          setErroLista(null)
        })
        .catch((erro: Error) => {
          if (cancelado) return
          setErroLista(
            typeof navigator !== 'undefined' && navigator.onLine === false
              ? MSG_SEM_INTERNET
              : `Não foi possível carregar os clientes: ${erro.message}`,
          )
        })
        .finally(() => {
          if (!cancelado) setCarregando(false)
        })
    }, espera)
    return () => {
      cancelado = true
      window.clearTimeout(timer)
    }
  }, [barracaId, busca, recarga])

  const fecharConfirmacao = useCallback(() => {
    if (excluindo) return
    setParaExcluir(null)
    setErroExcluir(null)
  }, [excluindo])

  async function confirmarExclusao() {
    if (!paraExcluir || excluindo) return
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      setErroExcluir(MSG_SEM_INTERNET)
      return
    }
    setExcluindo(true)
    setErroExcluir(null)
    try {
      await excluirClienteFinal(barracaId, paraExcluir.id)
      setParaExcluir(null)
      setRecarga((n) => n + 1)
    } catch (erro) {
      setErroExcluir(mensagemErroSalvar(erro instanceof Error ? erro : null))
    } finally {
      setExcluindo(false)
    }
  }

  // Sem Entrega e sem nenhum cliente guardado não há o que gerir.
  if (!usaEntrega && !carregando && clientes.length === 0 && !busca.trim() && !erroLista) return null

  return (
    <section>
      <RotuloSecao icone="contacts">Clientes de entrega</RotuloSecao>
      <Card>
        <p className="text-sm text-mesa-text-secondary">
          Nome, telefone e endereço guardados pra preencher a entrega sozinho. Você pode excluir o
          cadastro de um cliente a qualquer momento.
        </p>

        <Input
          type="search"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          onClear={() => setBusca('')}
          placeholder="Buscar por nome ou telefone"
          aria-label="Buscar cliente de entrega"
          className="mt-3"
        />

        {erroLista && (
          <p className="mt-3 rounded-mesa-md border-l-[3px] border-mesa-error-500 bg-mesa-error-50 p-3 text-sm font-medium text-mesa-error-700 dark:bg-mesa-error-500/15 dark:text-mesa-error-400">
            {erroLista}
          </p>
        )}

        {carregando && !erroLista && (
          <p className="py-6 text-center text-sm text-mesa-text-secondary">Carregando clientes...</p>
        )}

        {!carregando && !erroLista && clientes.length === 0 && (
          <p className="py-6 text-center text-sm text-mesa-text-secondary">
            {busca.trim() ? 'Nenhum cliente encontrado.' : 'Nenhum cliente salvo ainda.'}
          </p>
        )}

        {clientes.length > 0 && (
          <ul className="mt-2 divide-y divide-mesa-border-subtle">
            {clientes.map((cliente) => (
              <li key={cliente.id} className="flex items-center gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-base font-semibold text-mesa-text-primary">{cliente.nome}</p>
                  <p className="font-mesa-display text-sm text-mesa-text-secondary">
                    {formatarTelefoneBR(cliente.telefone)}
                  </p>
                  <p className="line-clamp-2 text-xs text-mesa-text-tertiary">{enderecoDoCliente(cliente)}</p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setErroExcluir(null)
                    setParaExcluir(cliente)
                  }}
                  aria-label={`Excluir cadastro de ${cliente.nome}`}
                  className={classesBotaoIcone('danger')}
                >
                  <Icone nome="delete" size={20} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <BottomSheet
        open={paraExcluir !== null}
        onClose={fecharConfirmacao}
        aria-label="Confirmar exclusão do cadastro do cliente"
      >
        <h2 className="text-lg font-semibold text-mesa-text-primary">
          Excluir o cadastro de {paraExcluir?.nome}?
        </h2>
        <p className="mt-1 text-sm text-mesa-text-secondary">
          Apaga nome, telefone e endereço guardados deste cliente. Os pedidos que ele já fez continuam
          no Histórico com os dados da entrega. Se ele pedir de novo, um cadastro novo é criado.
        </p>
        {erroExcluir && (
          <p className="mt-3 rounded-mesa-md border-l-[3px] border-mesa-error-500 bg-mesa-error-50 p-3 text-sm font-medium text-mesa-error-700 dark:bg-mesa-error-500/15 dark:text-mesa-error-400">
            {erroExcluir}
          </p>
        )}
        <div className="mt-6 flex flex-col gap-2">
          <Button
            variant="destructive"
            size="xl"
            onClick={confirmarExclusao}
            disabled={excluindo}
            className="w-full"
          >
            {excluindo ? 'Excluindo...' : 'Excluir cadastro'}
          </Button>
          <Button variant="ghost" size="xl" onClick={fecharConfirmacao} disabled={excluindo} className="w-full">
            Cancelar
          </Button>
        </div>
      </BottomSheet>
    </section>
  )
}
