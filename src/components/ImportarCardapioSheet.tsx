import { useRef, useState } from 'react'
import {
  ErroImportacaoCardapio,
  carregarCardapioExistente,
  gravarCardapioImportado,
  type ResumoImportacaoCardapio,
} from '../lib/cardapioImportacao'
import { baixarArquivo } from '../lib/exportarClientes'
import {
  LIMITE_LINHAS_CARDAPIO,
  gerarCsvModeloCardapio,
  lerTabelaCardapio,
  validarCardapio,
  type CardapioExistente,
  type ResultadoValidacaoCardapio,
} from '../lib/importarCardapio'
import { ErroArquivoImportacao, lerArquivoDeTabela } from '../lib/importarClientesArquivo'
import { formatarPrecoBR } from '../lib/preco'
import { MSG_SEM_INTERNET } from '../hooks/useSalvarBarraca'
import { BottomSheet } from './ui/BottomSheet'
import { Button } from './ui/Button'
import { Icone } from './ui/Icone'

type Etapa =
  | { fase: 'escolher' }
  | { fase: 'lendo' }
  | { fase: 'previa'; arquivo: string; r: ResultadoValidacaoCardapio; existente: CardapioExistente }
  | { fase: 'importando'; feitos: number; total: number }
  | { fase: 'pronto'; resumo: ResumoImportacaoCardapio; jaExistiam: number; comErro: number }

const MAX_ERROS_NA_TELA = 50
const MAX_LINHAS_NA_PREVIA = 8

function offline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false
}

/**
 * Importar o cardápio de uma planilha (.csv/.xlsx) em etapas: escolher o arquivo, PRÉVIA (contagens, primeiras linhas
 * e erro por linha em português) e confirmar. Nada é gravado antes da confirmação; linha com erro não entra; item que
 * já existe (mesma categoria + nome) é pulado, nunca sobrescrito. Fotos e campos fiscais ficam para depois.
 */
export function ImportarCardapioSheet({
  aberto,
  barracaId,
  onFechar,
  aoImportar,
}: {
  aberto: boolean
  barracaId: string
  onFechar: () => void
  /** Chamado depois de gravar (ou de uma gravação parcial) para a lista recarregar. */
  aoImportar: () => void
}) {
  const [etapa, setEtapa] = useState<Etapa>({ fase: 'escolher' })
  const [erro, setErro] = useState<string | null>(null)
  const entrada = useRef<HTMLInputElement>(null)

  const ocupado = etapa.fase === 'lendo' || etapa.fase === 'importando'

  function fechar() {
    if (ocupado) return
    setEtapa({ fase: 'escolher' })
    setErro(null)
    onFechar()
  }

  function baixarModelo() {
    baixarArquivo(gerarCsvModeloCardapio(), 'text/csv;charset=utf-8', 'modelo-cardapio.csv')
  }

  async function aoEscolherArquivo(arquivo: File | undefined) {
    if (!arquivo) return
    if (offline()) {
      setErro(MSG_SEM_INTERNET)
      return
    }
    setErro(null)
    setEtapa({ fase: 'lendo' })
    try {
      const tabela = await lerArquivoDeTabela(arquivo, LIMITE_LINHAS_CARDAPIO)
      const lida = lerTabelaCardapio(tabela)
      if (!lida.ok) {
        setErro(lida.mensagem)
        setEtapa({ fase: 'escolher' })
        return
      }
      const existente = await carregarCardapioExistente(barracaId)
      setEtapa({ fase: 'previa', arquivo: arquivo.name, r: validarCardapio(lida.linhas, lida.colunas, existente), existente })
    } catch (e) {
      setErro(e instanceof ErroArquivoImportacao ? e.message : `Não foi possível ler o arquivo: ${e instanceof Error ? e.message : 'tente de novo'}`)
      setEtapa({ fase: 'escolher' })
    }
  }

  async function confirmar() {
    if (etapa.fase !== 'previa') return
    if (offline()) {
      setErro(MSG_SEM_INTERNET)
      return
    }
    const { r, existente } = etapa
    setErro(null)
    setEtapa({ fase: 'importando', feitos: 0, total: r.paraCriar.length })
    try {
      const resumo = await gravarCardapioImportado(barracaId, existente, r.paraCriar, (feitos, total) =>
        setEtapa({ fase: 'importando', feitos, total }),
      )
      setEtapa({ fase: 'pronto', resumo, jaExistiam: r.jaExistiam + r.duplicadasNoArquivo.length, comErro: r.invalidas.length })
      aoImportar()
    } catch (e) {
      const parcial = e instanceof ErroImportacaoCardapio ? e.parcial : null
      setErro(
        `A importação parou: ${e instanceof Error ? e.message : 'erro desconhecido'}.` +
          (parcial && parcial.itensCriados + parcial.categoriasCriadas > 0
            ? ` Já foram gravados ${parcial.itensCriados} itens e ${parcial.categoriasCriadas} categorias. Pode importar o mesmo arquivo de novo: o que já entrou é pulado.`
            : ' Nada foi gravado. Pode tentar de novo.'),
      )
      setEtapa({ fase: 'escolher' })
      aoImportar()
    }
  }

  return (
    <BottomSheet open={aberto} onClose={fechar} aria-label="Importar cardápio de planilha">
      <h2 className="text-lg font-semibold text-mesa-text-primary">Importar cardápio</h2>

      {etapa.fase === 'escolher' && (
        <>
          <p className="mt-1 text-sm text-mesa-text-secondary">
            Envie uma planilha .csv ou .xlsx com as colunas <strong>Nome</strong> e <strong>Preço</strong>. Categoria,
            Descrição e Ativo são opcionais (Ativo vazio = sim; Categoria vazia = sem categoria). Máximo de{' '}
            {LIMITE_LINHAS_CARDAPIO} linhas. Fotos você adiciona depois, item por item.
          </p>
          <Button
            variant="ghost"
            size="md"
            icon={<Icone nome="download" size={18} />}
            onClick={baixarModelo}
            className="mt-2 w-full"
          >
            Baixar planilha modelo
          </Button>
          <input
            ref={entrada}
            type="file"
            accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="hidden"
            onChange={(e) => {
              const arquivo = e.target.files?.[0]
              e.target.value = ''
              void aoEscolherArquivo(arquivo)
            }}
          />
          <Button
            variant="outline"
            size="xl"
            icon={<Icone nome="description" size={20} />}
            className="mt-2 w-full"
            onClick={() => entrada.current?.click()}
          >
            Escolher arquivo
          </Button>
        </>
      )}

      {etapa.fase === 'lendo' && <p className="mt-4 text-sm text-mesa-text-secondary">Lendo o arquivo...</p>}

      {etapa.fase === 'previa' && (
        <>
          <p className="mt-1 text-sm text-mesa-text-secondary">
            Prévia de <span className="font-semibold text-mesa-text-primary">{etapa.arquivo}</span>. Nada foi
            gravado ainda.
          </p>
          <ul className="mt-3 grid grid-cols-2 gap-2 text-sm">
            <Contagem valor={etapa.r.paraCriar.length} rotulo="itens novos" destaque />
            <Contagem valor={etapa.r.categoriasNovas.length} rotulo="categorias novas" />
            <Contagem valor={etapa.r.jaExistiam + etapa.r.duplicadasNoArquivo.length} rotulo="já existem ou repetidos (pulados)" />
            <Contagem valor={etapa.r.invalidas.length} rotulo="com erro (ignorados)" erro={etapa.r.invalidas.length > 0} />
          </ul>

          {etapa.r.paraCriar.length > 0 && (
            <div className="mt-3 overflow-x-auto rounded-mesa-md border border-mesa-border-subtle">
              <table className="w-full min-w-[20rem] text-left text-xs">
                <thead className="bg-mesa-surface text-mesa-text-secondary">
                  <tr>
                    <th className="px-2 py-1.5 font-medium">Categoria</th>
                    <th className="px-2 py-1.5 font-medium">Nome</th>
                    <th className="px-2 py-1.5 text-right font-medium">Preço</th>
                    <th className="px-2 py-1.5 font-medium">Ativo</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-mesa-border-subtle text-mesa-text-primary">
                  {etapa.r.paraCriar.slice(0, MAX_LINHAS_NA_PREVIA).map((i) => (
                    <tr key={i.linha}>
                      <td className="px-2 py-1.5">{i.categoria ?? 'Sem categoria'}</td>
                      <td className="px-2 py-1.5">{i.nome}</td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-right">{i.precoAberto ? 'Preço aberto' : formatarPrecoBR(i.precoCentavos)}</td>
                      <td className="px-2 py-1.5">{i.ativo ? 'sim' : 'não'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {etapa.r.paraCriar.length > MAX_LINHAS_NA_PREVIA && (
                <p className="px-2 py-1.5 text-xs text-mesa-text-secondary">
                  ...e mais {etapa.r.paraCriar.length - MAX_LINHAS_NA_PREVIA} itens.
                </p>
              )}
            </div>
          )}

          {etapa.r.invalidas.length > 0 && (
            <div className="mt-3 max-h-40 overflow-y-auto rounded-mesa-md border-l-[3px] border-mesa-error-500 bg-mesa-error-50 p-3 text-sm text-mesa-error-700 dark:bg-mesa-error-500/15 dark:text-mesa-error-400">
              <p className="font-semibold">Linhas com erro (não entram)</p>
              <ul className="mt-1">
                {etapa.r.invalidas.slice(0, MAX_ERROS_NA_TELA).map((l) => (
                  <li key={l.linha}>
                    Linha {l.linha}: {l.motivo}
                  </li>
                ))}
              </ul>
              {etapa.r.invalidas.length > MAX_ERROS_NA_TELA && (
                <p className="mt-1">...e mais {etapa.r.invalidas.length - MAX_ERROS_NA_TELA}.</p>
              )}
            </div>
          )}

          {etapa.r.paraCriar.length === 0 && (
            <p className="mt-3 text-sm font-medium text-mesa-text-secondary">Não há nenhum item novo para importar.</p>
          )}
        </>
      )}

      {etapa.fase === 'importando' && (
        <p className="mt-4 text-sm font-medium text-mesa-text-primary" role="status">
          Importando... {etapa.feitos} de {etapa.total}
        </p>
      )}

      {etapa.fase === 'pronto' && (
        <div className="mt-3 text-sm text-mesa-text-secondary" role="status">
          <p className="flex items-center gap-1.5 font-semibold text-mesa-success-700 dark:text-mesa-success-500">
            <Icone nome="check_circle" size={18} preenchido /> Importação concluída
          </p>
          <p className="mt-2 text-mesa-text-primary">
            {etapa.resumo.itensCriados} {etapa.resumo.itensCriados === 1 ? 'item criado' : 'itens criados'},{' '}
            {etapa.resumo.categoriasCriadas} {etapa.resumo.categoriasCriadas === 1 ? 'categoria criada' : 'categorias criadas'},{' '}
            {etapa.jaExistiam} já existiam, {etapa.comErro} com erro.
          </p>
        </div>
      )}

      {erro && (
        <p role="alert" className="mt-3 rounded-mesa-md border-l-[3px] border-mesa-error-500 bg-mesa-error-50 p-3 text-sm font-medium text-mesa-error-700 dark:bg-mesa-error-500/15 dark:text-mesa-error-400">
          {erro}
        </p>
      )}

      <div className="mt-5 flex flex-col gap-2">
        {etapa.fase === 'previa' && etapa.r.paraCriar.length > 0 && (
          <Button size="xl" onClick={() => void confirmar()} className="w-full">
            Importar {etapa.r.paraCriar.length} {etapa.r.paraCriar.length === 1 ? 'item' : 'itens'}
          </Button>
        )}
        {etapa.fase === 'previa' && (
          <Button variant="outline" size="xl" onClick={() => setEtapa({ fase: 'escolher' })} className="w-full">
            Escolher outro arquivo
          </Button>
        )}
        <Button variant="ghost" size="md" disabled={ocupado} onClick={fechar} className="w-full">
          {etapa.fase === 'pronto' ? 'Fechar' : 'Cancelar'}
        </Button>
      </div>
    </BottomSheet>
  )
}

function Contagem({ valor, rotulo, destaque, erro }: { valor: number; rotulo: string; destaque?: boolean; erro?: boolean }) {
  return (
    <li className="rounded-mesa-md border border-mesa-border-subtle bg-mesa-surface p-2">
      <span
        className={`font-mesa-display text-xl font-bold ${
          erro ? 'text-mesa-error-700 dark:text-mesa-error-400' : destaque ? 'text-mesa-text-primary' : 'text-mesa-text-secondary'
        }`}
      >
        {valor}
      </span>
      <span className="block text-xs text-mesa-text-secondary">{rotulo}</span>
    </li>
  )
}
