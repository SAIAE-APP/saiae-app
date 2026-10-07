import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { classesBotaoIcone } from '../lib/estiloBotaoIcone'
import { excluirClienteFinal, listarClientesFinais } from '../lib/clientesFinais'
import { formatarTelefoneBR } from '../lib/entrega'
import { modosAtivos } from '../lib/atendimento'
import { exportarClientes, type FiltroExportar, type FormatoExportar } from '../lib/exportarClientes'
import { useAssinaturaBarraca } from '../hooks/useAssinaturaBarraca'
import { MSG_SEM_INTERNET, mensagemErroSalvar } from '../hooks/useSalvarBarraca'
import { ImportarClientesSheet } from './ImportarClientesSheet'
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

  // Exportar pra prospecção: mesma regra de plano do Histórico (Essencial não exporta;
  // trial nasce 'pro').
  const { assinatura } = useAssinaturaBarraca(barraca.slug)
  const planoEssencial = assinatura?.plano === 'essencial'
  const [exportando, setExportando] = useState(false)
  const [abrirExportar, setAbrirExportar] = useState(false)
  const [abrirImportar, setAbrirImportar] = useState(false)
  const [filtroExportar, setFiltroExportar] = useState<FiltroExportar>('aceitaram')
  const [formatoExportar, setFormatoExportar] = useState<FormatoExportar>('xlsx')
  const [erroExportar, setErroExportar] = useState<string | null>(null)
  const [resultadoExportar, setResultadoExportar] = useState<string | null>(null)

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

  async function fazerExportacao() {
    if (exportando) return
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      setErroExportar(MSG_SEM_INTERNET)
      return
    }
    setExportando(true)
    setErroExportar(null)
    setResultadoExportar(null)
    try {
      const total = await exportarClientes(barracaId, barraca.slug, filtroExportar, formatoExportar)
      setResultadoExportar(
        total === 0
          ? 'Nenhum cliente nesse filtro: o arquivo saiu só com o cabeçalho.'
          : `${total} ${total === 1 ? 'cliente exportado' : 'clientes exportados'}.`,
      )
    } catch (erro) {
      setErroExportar(`Não foi possível exportar: ${erro instanceof Error ? erro.message : 'tente de novo'}`)
    } finally {
      setExportando(false)
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

        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            icon={<Icone nome="description" size={16} />}
            onClick={() => setAbrirImportar(true)}
          >
            Importar
          </Button>
          <Button
            variant="outline"
            size="sm"
            icon={<Icone nome="download" size={16} />}
            disabled={planoEssencial}
            title={planoEssencial ? 'Exportar clientes é exclusivo do plano Pro' : undefined}
            onClick={() => {
              setErroExportar(null)
              setResultadoExportar(null)
              setAbrirExportar(true)
            }}
          >
            Exportar
          </Button>
        </div>
        {planoEssencial && (
          <p className="mt-1.5 text-xs text-mesa-text-tertiary">Exportar clientes é exclusivo do plano Pro.</p>
        )}

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

      <ImportarClientesSheet
        aberto={abrirImportar}
        barracaId={barracaId}
        onFechar={() => setAbrirImportar(false)}
        aoImportar={() => setRecarga((n) => n + 1)}
      />

      <BottomSheet open={abrirExportar} onClose={() => !exportando && setAbrirExportar(false)} aria-label="Exportar clientes de entrega">
        <h2 className="text-lg font-semibold text-mesa-text-primary">Exportar clientes</h2>
        <p className="mt-1 text-sm text-mesa-text-secondary">
          Baixa uma planilha com nome, telefone, endereço, nº de pedidos, último pedido e ticket médio.
          O app não envia mensagens: a lista é pra você usar.
        </p>

        <p className="mt-4 text-sm font-medium text-mesa-text-primary">Incluir</p>
        <div className="mt-2 flex flex-col gap-2" role="radiogroup" aria-label="Quem incluir">
          {(
            [
              ['aceitaram', 'Só quem aceitou contato comercial (recomendado)'],
              ['todos', 'Todos os clientes'],
            ] as [FiltroExportar, string][]
          ).map(([valor, rotulo]) => (
            <button
              key={valor}
              type="button"
              role="radio"
              aria-checked={filtroExportar === valor}
              onClick={() => setFiltroExportar(valor)}
              className={
                filtroExportar === valor
                  ? 'min-h-11 rounded-mesa-md border-2 border-mesa-neutral-900 bg-mesa-neutral-100 px-3 text-left text-sm font-semibold text-mesa-text-primary dark:border-mesa-neutral-50 dark:bg-mesa-neutral-800'
                  : 'min-h-11 rounded-mesa-md border-2 border-mesa-border-subtle bg-mesa-surface px-3 text-left text-sm font-semibold text-mesa-text-secondary'
              }
            >
              {rotulo}
            </button>
          ))}
        </div>
        {filtroExportar === 'todos' && (
          <p className="mt-2 rounded-mesa-md border-l-[3px] border-mesa-warning-500 bg-mesa-warning-50 p-3 text-sm font-medium text-mesa-warning-700 dark:bg-mesa-warning-500/15">
            Atenção (LGPD): quem não aceitou contato comercial deu os dados só pra entrega. Mandar
            ofertas a essas pessoas sem autorização pode violar a lei. Use "todos" apenas para
            organizar a base, não para disparar mensagens.
          </p>
        )}

        <p className="mt-4 text-sm font-medium text-mesa-text-primary">Formato</p>
        <div className="mt-2 grid grid-cols-2 gap-2" role="radiogroup" aria-label="Formato do arquivo">
          {(
            [
              ['xlsx', 'Excel (.xlsx)'],
              ['csv', 'CSV (.csv)'],
            ] as [FormatoExportar, string][]
          ).map(([valor, rotulo]) => (
            <button
              key={valor}
              type="button"
              role="radio"
              aria-checked={formatoExportar === valor}
              onClick={() => setFormatoExportar(valor)}
              className={
                formatoExportar === valor
                  ? 'min-h-11 rounded-mesa-md border-2 border-mesa-neutral-900 bg-mesa-neutral-100 px-3 text-sm font-semibold text-mesa-text-primary dark:border-mesa-neutral-50 dark:bg-mesa-neutral-800'
                  : 'min-h-11 rounded-mesa-md border-2 border-mesa-border-subtle bg-mesa-surface px-3 text-sm font-semibold text-mesa-text-secondary'
              }
            >
              {rotulo}
            </button>
          ))}
        </div>

        {erroExportar && (
          <p role="alert" className="mt-3 text-sm font-medium text-mesa-error-500">
            {erroExportar}
          </p>
        )}
        {resultadoExportar && (
          <p className="mt-3 text-sm font-semibold text-mesa-success-700 dark:text-mesa-success-500">{resultadoExportar}</p>
        )}
        <div className="mt-5 flex flex-col gap-2">
          <Button
            variant="outline"
            size="xl"
            icon={<Icone nome="download" size={20} />}
            loading={exportando}
            onClick={() => void fazerExportacao()}
            className="w-full"
          >
            Baixar
          </Button>
          <Button variant="ghost" size="md" disabled={exportando} onClick={() => setAbrirExportar(false)} className="w-full">
            Fechar
          </Button>
        </div>
      </BottomSheet>

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
