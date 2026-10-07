import { useRef, useState } from 'react'
import { ErroImportacao, importarClientesFinais, listarTelefonesDaBarraca, type ResumoImportacao } from '../lib/clientesFinais'
import { LIMITE_LINHAS_IMPORTACAO, lerTabela, validarClientes, type ResultadoValidacao } from '../lib/importarClientes'
import { ErroArquivoImportacao, lerArquivoDeClientes } from '../lib/importarClientesArquivo'
import { MSG_SEM_INTERNET } from '../hooks/useSalvarBarraca'
import { BottomSheet } from './ui/BottomSheet'
import { Button } from './ui/Button'
import { Checkbox } from './ui/Checkbox'
import { Icone } from './ui/Icone'

type Etapa =
  | { fase: 'escolher' }
  | { fase: 'lendo' }
  | { fase: 'previa'; arquivo: string; r: ResultadoValidacao }
  | { fase: 'importando'; feitos: number; total: number }
  | { fase: 'pronto'; resumo: ResumoImportacao }

const MAX_ERROS_NA_TELA = 50

function offline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false
}

/**
 * Importar clientes de uma planilha (.csv/.xlsx) em 3 passos: escolher o arquivo,
 * PRÉVIA (válidas/inválidas/duplicadas e erro por linha) e confirmar. LGPD: o dono
 * declara ter autorização para guardar os contatos (obrigatório); contatos entram
 * SEM consentimento de marketing, salvo se ele marcar a segunda caixa.
 */
export function ImportarClientesSheet({
  aberto,
  barracaId,
  onFechar,
  aoImportar,
}: {
  aberto: boolean
  barracaId: string
  onFechar: () => void
  aoImportar: () => void
}) {
  const [etapa, setEtapa] = useState<Etapa>({ fase: 'escolher' })
  const [erro, setErro] = useState<string | null>(null)
  const [autorizacao, setAutorizacao] = useState(false)
  const [marketing, setMarketing] = useState(false)
  const entrada = useRef<HTMLInputElement>(null)

  const ocupado = etapa.fase === 'lendo' || etapa.fase === 'importando'

  function fechar() {
    if (ocupado) return
    setEtapa({ fase: 'escolher' })
    setErro(null)
    setAutorizacao(false)
    setMarketing(false)
    onFechar()
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
      const tabela = await lerArquivoDeClientes(arquivo)
      const lida = lerTabela(tabela)
      if (!lida.ok) {
        setErro(lida.mensagem)
        setEtapa({ fase: 'escolher' })
        return
      }
      const existentes = await listarTelefonesDaBarraca(barracaId)
      setEtapa({ fase: 'previa', arquivo: arquivo.name, r: validarClientes(lida.linhas, lida.colunas, existentes) })
    } catch (e) {
      setErro(e instanceof ErroArquivoImportacao ? e.message : `Não foi possível ler o arquivo: ${e instanceof Error ? e.message : 'tente de novo'}`)
      setEtapa({ fase: 'escolher' })
    }
  }

  async function confirmar() {
    if (etapa.fase !== 'previa' || !autorizacao) return
    if (offline()) {
      setErro(MSG_SEM_INTERNET)
      return
    }
    const { validos } = etapa.r
    setErro(null)
    setEtapa({ fase: 'importando', feitos: 0, total: validos.length })
    try {
      const resumo = await importarClientesFinais(barracaId, validos, marketing, (feitos, total) =>
        setEtapa({ fase: 'importando', feitos, total }),
      )
      setEtapa({ fase: 'pronto', resumo })
      aoImportar()
    } catch (e) {
      const parcial = e instanceof ErroImportacao ? e.parcial : null
      setErro(
        `A importação parou: ${e instanceof Error ? e.message : 'erro desconhecido'}.` +
          (parcial && parcial.inseridos + parcial.atualizados > 0
            ? ` Já foram gravados ${parcial.inseridos} novos e ${parcial.atualizados} completados. Pode importar o mesmo arquivo de novo: ninguém é duplicado.`
            : ' Nada foi gravado. Pode tentar de novo.'),
      )
      setEtapa({ fase: 'escolher' })
      aoImportar()
    }
  }

  return (
    <BottomSheet open={aberto} onClose={fechar} aria-label="Importar clientes de entrega">
      <h2 className="text-lg font-semibold text-mesa-text-primary">Importar clientes</h2>

      {etapa.fase === 'escolher' && (
        <>
          <p className="mt-1 text-sm text-mesa-text-secondary">
            Envie uma planilha .csv ou .xlsx com as colunas Nome e Telefone (Rua, Número, Bairro e Referência são
            opcionais). Dá pra exportar, editar e importar de volta. Máximo de {LIMITE_LINHAS_IMPORTACAO} linhas.
          </p>
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
            className="mt-4 w-full"
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
            <Contagem valor={etapa.r.novos} rotulo="novos" destaque />
            <Contagem valor={etapa.r.jaExistentes} rotulo="já cadastrados (só completa campos vazios)" />
            <Contagem valor={etapa.r.duplicadasNoArquivo.length} rotulo="repetidos no arquivo (ignorados)" />
            <Contagem valor={etapa.r.invalidas.length} rotulo="com erro (ignorados)" erro={etapa.r.invalidas.length > 0} />
          </ul>

          {etapa.r.invalidas.length > 0 && (
            <div className="mt-3 max-h-40 overflow-y-auto rounded-mesa-md border-l-[3px] border-mesa-error-500 bg-mesa-error-50 p-3 text-sm text-mesa-error-700 dark:bg-mesa-error-500/15 dark:text-mesa-error-400">
              <p className="font-semibold">Linhas com erro</p>
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

          {etapa.r.validos.length === 0 ? (
            <p className="mt-3 text-sm font-medium text-mesa-text-secondary">Não há nenhuma linha válida para importar.</p>
          ) : (
            <div className="mt-3 flex flex-col">
              <label className="flex min-h-11 cursor-pointer items-start gap-3 py-1 text-sm text-mesa-text-secondary">
                <Checkbox
                  checked={autorizacao}
                  onChange={() => setAutorizacao((v) => !v)}
                  aria-label="Declaro que tenho autorização para guardar estes contatos"
                />
                <span>Declaro que tenho autorização para guardar estes contatos.</span>
              </label>
              <label className="flex min-h-11 cursor-pointer items-start gap-3 py-1 text-sm text-mesa-text-secondary">
                <Checkbox
                  checked={marketing}
                  onChange={() => setMarketing((v) => !v)}
                  aria-label="Estes clientes autorizaram receber mensagens"
                />
                <span>
                  Estes clientes autorizaram receber mensagens (opcional). Sem marcar, eles entram só para
                  entrega e não aparecem na exportação para contato comercial. Vale só para os novos.
                </span>
              </label>
            </div>
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
          <ul className="mt-2 list-disc pl-5">
            <li>{etapa.resumo.inseridos} clientes novos</li>
            <li>{etapa.resumo.atualizados} já cadastrados, com campos vazios completados</li>
            <li>{etapa.resumo.semMudanca} já cadastrados, sem mudança</li>
          </ul>
        </div>
      )}

      {erro && (
        <p role="alert" className="mt-3 rounded-mesa-md border-l-[3px] border-mesa-error-500 bg-mesa-error-50 p-3 text-sm font-medium text-mesa-error-700 dark:bg-mesa-error-500/15 dark:text-mesa-error-400">
          {erro}
        </p>
      )}

      <div className="mt-5 flex flex-col gap-2">
        {etapa.fase === 'previa' && etapa.r.validos.length > 0 && (
          <Button size="xl" disabled={!autorizacao} onClick={() => void confirmar()} className="w-full">
            Importar {etapa.r.validos.length} {etapa.r.validos.length === 1 ? 'cliente' : 'clientes'}
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
