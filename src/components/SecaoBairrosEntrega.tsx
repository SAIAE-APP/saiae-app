import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { classesBotaoIcone } from '../lib/estiloBotaoIcone'
import {
  atualizarTaxaBairro,
  listarTaxasBairro,
  parsearListaBairros,
  removerTaxaBairro,
  salvarTaxasBairro,
  type ResultadoListaColada,
} from '../lib/bairros'
import { filtrarEntradaPreco, formatarPrecoBR, reaisParaCentavos } from '../lib/preco'
import { modosAtivos } from '../lib/atendimento'
import { MSG_SEM_INTERNET, mensagemErroSalvar, useRascunho, useSalvarBarraca } from '../hooks/useSalvarBarraca'
import { BotaoSalvarCampo, ErroSalvar } from './BotaoSalvarCampo'
import { BottomSheet } from './ui/BottomSheet'
import { Button } from './ui/Button'
import { Card } from './ui/Card'
import { Icone } from './ui/Icone'
import { Input } from './ui/Input'
import { Textarea } from './ui/Textarea'
import { Toggle } from './ui/Toggle'
import type { Barraca, PoliticaBairroNaoListado, TaxaEntregaBairro } from '../types/database'

function RotuloSecao({ icone, children }: { icone?: string; children: ReactNode }) {
  return (
    <h2 className="mb-3 flex items-center gap-1.5 font-mesa-sans text-xs font-semibold uppercase tracking-wider text-mesa-text-secondary">
      {icone && <Icone nome={icone} size={14} />}
      {children}
    </h2>
  )
}

function reaisParaTexto(centavos: number): string {
  return (centavos / 100).toFixed(2).replace('.', ',')
}

function mensagemErro(erro: unknown): string {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return MSG_SEM_INTERNET
  return mensagemErroSalvar(erro instanceof Error ? erro : null)
}

function LinhaBairro({
  bairro,
  onAtualizar,
  onRemover,
}: {
  bairro: TaxaEntregaBairro
  onAtualizar: (id: string, campos: { valor_centavos?: number; ativo?: boolean }) => Promise<string | null>
  onRemover: (b: TaxaEntregaBairro) => void
}) {
  const valorR = useRascunho(
    reaisParaTexto(bairro.valor_centavos),
    (a, b) => reaisParaCentavos(a) === reaisParaCentavos(b),
  )
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  async function salvarValor() {
    if (!valorR.valor.trim()) {
      setErro('Informe o valor (use 0 para entrega grátis).')
      return
    }
    setSalvando(true)
    const falha = await onAtualizar(bairro.id, { valor_centavos: reaisParaCentavos(valorR.valor) })
    setSalvando(false)
    setErro(falha)
    if (!falha) valorR.descartar()
  }

  async function alternarAtivo(valor: boolean) {
    setErro(await onAtualizar(bairro.id, { ativo: valor }))
  }

  return (
    <li className="border-b border-mesa-border-subtle py-3 last:border-b-0">
      <div className="flex items-center justify-between gap-3">
        <span className="min-w-0 truncate text-base font-semibold text-mesa-text-primary">{bairro.bairro}</span>
        <div className="flex shrink-0 items-center gap-1">
          <Toggle
            checked={bairro.ativo}
            onChange={(v) => void alternarAtivo(v)}
            aria-label={`Bairro ${bairro.bairro} ativo`}
          />
          <button
            type="button"
            onClick={() => onRemover(bairro)}
            aria-label={`Remover bairro ${bairro.bairro}`}
            className={classesBotaoIcone()}
          >
            <Icone nome="delete" size={20} />
          </button>
        </div>
      </div>
      <div className="mt-2 flex items-end gap-2">
        <div className="min-w-0 flex-1">
          <Input
            type="currency"
            label="Taxa"
            inputMode="decimal"
            value={valorR.valor}
            onChange={(e) => valorR.definir(filtrarEntradaPreco(e.target.value))}
          />
        </div>
        <Button variant="outline" size="md" loading={salvando} disabled={!valorR.alterado || salvando} onClick={() => void salvarValor()}>
          Salvar
        </Button>
      </div>
      {erro && <ErroSalvar erro={erro} className="mt-1" />}
    </li>
  )
}

/**
 * Taxa de entrega por bairro: lista de bairros atendidos (um por um ou colando
 * uma lista) e política pra bairro fora da lista (cobrar a taxa padrão ou
 * bloquear). O valor "padrão" é o de `SecaoTaxaEntrega`. Todo salvamento é por
 * botão, com erro real na tela. Só aparece com Entrega ligada ou bairro salvo.
 */
export function SecaoBairrosEntrega({ barraca }: { barraca: Barraca }) {
  const [bairros, setBairros] = useState<TaxaEntregaBairro[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erroLista, setErroLista] = useState<string | null>(null)
  const [recarga, setRecarga] = useState(0)

  const [novoBairro, setNovoBairro] = useState('')
  const [novoValor, setNovoValor] = useState('')
  const [adicionando, setAdicionando] = useState(false)
  const [erroAdicionar, setErroAdicionar] = useState<string | null>(null)

  const [colando, setColando] = useState(false)
  const [textoColado, setTextoColado] = useState('')
  const [importando, setImportando] = useState(false)
  const [erroImportar, setErroImportar] = useState<string | null>(null)
  const [aposImportar, setAposImportar] = useState<ResultadoListaColada | null>(null)

  const [paraRemover, setParaRemover] = useState<TaxaEntregaBairro | null>(null)
  const [removendo, setRemovendo] = useState(false)
  const [erroRemover, setErroRemover] = useState<string | null>(null)

  const politicaR = useRascunho<PoliticaBairroNaoListado>(barraca.entrega_bairro_nao_listado ?? 'taxa_padrao')
  const politicaSalvador = useSalvarBarraca(barraca)

  const usaEntrega = modosAtivos(barraca).includes('entrega')

  useEffect(() => {
    let cancelado = false
    listarTaxasBairro(barraca.id)
      .then((lista) => {
        if (cancelado) return
        setBairros(lista)
        setErroLista(null)
      })
      .catch((erro: Error) => {
        if (cancelado) return
        setErroLista(
          typeof navigator !== 'undefined' && navigator.onLine === false
            ? MSG_SEM_INTERNET
            : `Não foi possível carregar os bairros: ${erro.message}`,
        )
      })
      .finally(() => {
        if (!cancelado) setCarregando(false)
      })
    return () => {
      cancelado = true
    }
  }, [barraca.id, recarga])

  const recarregar = useCallback(() => setRecarga((n) => n + 1), [])

  if (!usaEntrega && !carregando && bairros.length === 0 && !erroLista) return null

  async function adicionar() {
    const nome = novoBairro.trim().replace(/\s+/g, ' ')
    if (!nome) {
      setErroAdicionar('Informe o nome do bairro.')
      return
    }
    if (!novoValor.trim()) {
      setErroAdicionar('Informe o valor da taxa (use 0 para entrega grátis).')
      return
    }
    setAdicionando(true)
    setErroAdicionar(null)
    try {
      // Mesmo bairro já cadastrado (ignorando acento/caixa): atualiza o valor.
      await salvarTaxasBairro(barraca.id, [{ bairro: nome, valorCentavos: reaisParaCentavos(novoValor) }])
      setNovoBairro('')
      setNovoValor('')
      recarregar()
    } catch (erro) {
      setErroAdicionar(mensagemErro(erro))
    } finally {
      setAdicionando(false)
    }
  }

  async function atualizar(id: string, campos: { valor_centavos?: number; ativo?: boolean }): Promise<string | null> {
    try {
      await atualizarTaxaBairro(barraca.id, id, campos)
      recarregar()
      return null
    } catch (erro) {
      return mensagemErro(erro)
    }
  }

  async function confirmarRemocao() {
    if (!paraRemover) return
    setRemovendo(true)
    setErroRemover(null)
    try {
      await removerTaxaBairro(barraca.id, paraRemover.id)
      setParaRemover(null)
      recarregar()
    } catch (erro) {
      setErroRemover(mensagemErro(erro))
    } finally {
      setRemovendo(false)
    }
  }

  const previa = parsearListaBairros(textoColado)

  async function importar() {
    if (previa.validos.length === 0) {
      setErroImportar('Nenhuma linha válida pra importar.')
      return
    }
    setImportando(true)
    setErroImportar(null)
    try {
      await salvarTaxasBairro(barraca.id, previa.validos)
      setAposImportar(previa)
      setTextoColado('')
      recarregar()
    } catch (erro) {
      setErroImportar(mensagemErro(erro))
    } finally {
      setImportando(false)
    }
  }

  function fecharColar() {
    setColando(false)
    setTextoColado('')
    setErroImportar(null)
    setAposImportar(null)
  }

  async function salvarPolitica() {
    const ok = await politicaSalvador.salvar({ entrega_bairro_nao_listado: politicaR.valor })
    if (ok) politicaR.descartar()
  }

  return (
    <section>
      <RotuloSecao icone="location_on">Taxa por bairro</RotuloSecao>
      <Card>
        <p className="text-sm text-mesa-text-secondary">
          Cadastre os bairros que você atende e a taxa de cada um. Bairro fora da lista segue a regra
          abaixo; o valor padrão é o de "Taxa de entrega".
        </p>

        <div className="mt-4 grid grid-cols-[1fr_120px] gap-3">
          <Input
            label="Bairro"
            autoComplete="off"
            value={novoBairro}
            maxLength={80}
            onChange={(e) => setNovoBairro(e.target.value)}
          />
          <Input
            type="currency"
            label="Taxa"
            inputMode="decimal"
            value={novoValor}
            onChange={(e) => setNovoValor(filtrarEntradaPreco(e.target.value))}
          />
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="outline" size="md" loading={adicionando} onClick={() => void adicionar()}>
            Adicionar bairro
          </Button>
          <Button variant="ghost" size="md" icon={<Icone nome="content_paste" size={16} />} onClick={() => setColando(true)}>
            Colar lista
          </Button>
        </div>
        <ErroSalvar erro={erroAdicionar} className="mt-2" />

        <div className="mt-4 border-t border-mesa-border-subtle pt-2">
          {carregando ? (
            <p className="py-3 text-sm text-mesa-text-secondary">Carregando bairros...</p>
          ) : erroLista ? (
            <div className="py-3">
              <ErroSalvar erro={erroLista} />
              <Button variant="ghost" size="sm" className="mt-1" onClick={recarregar}>
                Tentar de novo
              </Button>
            </div>
          ) : bairros.length === 0 ? (
            <p className="py-3 text-sm text-mesa-text-secondary">
              Nenhum bairro cadastrado: toda entrega usa a taxa padrão.
            </p>
          ) : (
            <ul aria-label="Bairros atendidos">
              {bairros.map((b) => (
                <LinhaBairro key={b.id + b.valor_centavos} bairro={b} onAtualizar={atualizar} onRemover={setParaRemover} />
              ))}
            </ul>
          )}
        </div>

        <div className="mt-4 border-t border-mesa-border-subtle pt-4">
          <p className="mb-2 text-sm font-medium text-mesa-text-primary">Bairro que não está na lista</p>
          <div className="grid grid-cols-2 gap-3" role="radiogroup" aria-label="Bairro que não está na lista">
            {(
              [
                ['taxa_padrao', 'Cobrar a taxa padrão'],
                ['bloquear', 'Não entregar'],
              ] as [PoliticaBairroNaoListado, string][]
            ).map(([valor, rotulo]) => {
              const selecionado = politicaR.valor === valor
              return (
                <button
                  key={valor}
                  type="button"
                  role="radio"
                  aria-checked={selecionado}
                  onClick={() => politicaR.definir(valor)}
                  className={
                    selecionado
                      ? 'min-h-11 rounded-mesa-md border-2 border-mesa-neutral-900 bg-mesa-neutral-100 px-3 text-sm font-semibold text-mesa-text-primary dark:border-mesa-neutral-50 dark:bg-mesa-neutral-800'
                      : 'min-h-11 rounded-mesa-md border-2 border-mesa-border-subtle bg-mesa-surface px-3 text-sm font-semibold text-mesa-text-secondary'
                  }
                >
                  {rotulo}
                </button>
              )
            })}
          </div>
          <p className="mt-2 text-xs text-mesa-text-secondary">
            {politicaR.valor === 'bloquear'
              ? 'O cardápio digital recusa o pedido ("não entregamos nesse bairro"). No app do operador, você ainda pode lançar com a taxa que quiser.'
              : 'Cobra a taxa padrão da barraca (zero se a taxa de entrega estiver desligada).'}
          </p>
          <BotaoSalvarCampo
            alterado={politicaR.alterado}
            salvando={politicaSalvador.salvando}
            salvo={politicaSalvador.salvo}
            erro={politicaSalvador.erro}
            onSalvar={() => void salvarPolitica()}
            rotulo="Salvar regra"
            className="mt-3"
          />
        </div>
      </Card>

      <BottomSheet open={colando} onClose={fecharColar} aria-label="Colar lista de bairros">
        <h2 className="text-lg font-semibold text-mesa-text-primary">Colar lista de bairros</h2>
        <p className="mt-1 text-sm text-mesa-text-secondary">
          Um por linha, assim: <strong>Centro; 5,00</strong> ou <strong>Centro;5.00</strong>. Bairro que
          já existe tem o valor atualizado.
        </p>
        <Textarea
          value={textoColado}
          onChange={(e) => {
            setTextoColado(e.target.value)
            setAposImportar(null)
          }}
          rows={8}
          placeholder={'Centro; 5,00\nVila Nova; 7,50'}
          aria-label="Lista de bairros"
          className="mt-3"
        />
        {textoColado.trim() && (
          <div className="mt-3 text-sm">
            <p className="font-semibold text-mesa-text-primary">
              {previa.validos.length} {previa.validos.length === 1 ? 'bairro válido' : 'bairros válidos'}
              {previa.invalidas.length > 0 && ` · ${previa.invalidas.length} com problema`}
            </p>
            {previa.invalidas.length > 0 && (
              <ul className="mt-1 text-mesa-error-500">
                {previa.invalidas.slice(0, 8).map((l) => (
                  <li key={l.numero}>
                    Linha {l.numero}: {l.motivo} ({l.texto})
                  </li>
                ))}
                {previa.invalidas.length > 8 && <li>e mais {previa.invalidas.length - 8}...</li>}
              </ul>
            )}
          </div>
        )}
        {aposImportar && (
          <p className="mt-3 text-sm font-semibold text-mesa-success-700 dark:text-mesa-success-500">
            {aposImportar.validos.length} importados ({formatarPrecoBR(aposImportar.validos[0]?.valorCentavos ?? 0)} no primeiro).
            {aposImportar.invalidas.length > 0 && ` ${aposImportar.invalidas.length} linha(s) ignorada(s).`}
          </p>
        )}
        <ErroSalvar erro={erroImportar} className="mt-2" />
        <div className="mt-5 flex flex-col gap-2">
          <Button
            variant="outline"
            size="xl"
            loading={importando}
            disabled={previa.validos.length === 0}
            onClick={() => void importar()}
            className="w-full"
          >
            Importar
          </Button>
          <Button variant="ghost" size="md" onClick={fecharColar} className="w-full">
            Fechar
          </Button>
        </div>
      </BottomSheet>

      <BottomSheet open={paraRemover !== null} onClose={() => setParaRemover(null)} aria-label="Remover bairro">
        <h2 className="text-lg font-semibold text-mesa-text-primary">Remover {paraRemover?.bairro}?</h2>
        <p className="mt-1 text-sm text-mesa-text-secondary">
          Pedidos antigos não mudam. Esse bairro passa a seguir a regra de "bairro fora da lista".
        </p>
        <ErroSalvar erro={erroRemover} className="mt-2" />
        <div className="mt-5 flex flex-col gap-2">
          <Button variant="destructive" size="xl" loading={removendo} onClick={() => void confirmarRemocao()} className="w-full">
            Remover
          </Button>
          <Button variant="ghost" size="md" onClick={() => setParaRemover(null)} className="w-full">
            Cancelar
          </Button>
        </div>
      </BottomSheet>
    </section>
  )
}
