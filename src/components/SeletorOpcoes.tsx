import { useMemo, useState } from 'react'
import { BottomSheet } from './ui/BottomSheet'
import { Button } from './ui/Button'
import { Checkbox } from './ui/Checkbox'
import { Radio } from './ui/Radio'
import { Textarea } from './ui/Textarea'
import { formatarPrecoBR } from '../lib/preco'
import { alternarOpcao, precoUnitario, validarEscolhas, type GrupoItem } from '../lib/opcoes'

const MAX_OBSERVACAO = 120

/** Seletor de variação e adicionais de um item (cardápio público). Mínimo/máximo validados ao vivo
 * com as mesmas regras do servidor (`resolver_carrinho`, que recalcula o preço). O pai deve montar
 * este componente com `key` do item, para o estado zerar a cada abertura. */
export function SeletorOpcoes({
  nomeItem,
  precoBaseCentavos,
  grupos,
  onClose,
  onConfirmar,
}: {
  nomeItem: string
  precoBaseCentavos: number
  grupos: GrupoItem[]
  onClose: () => void
  onConfirmar: (opcaoIds: string[], observacao: string) => void
}) {
  const [ids, setIds] = useState<string[]>([])
  const [observacao, setObservacao] = useState('')

  const validacao = useMemo(() => validarEscolhas(grupos, ids), [grupos, ids])
  const total = useMemo(() => precoUnitario(precoBaseCentavos, grupos, ids), [precoBaseCentavos, grupos, ids])

  return (
    <BottomSheet open onClose={onClose} aria-label={`Escolher opções de ${nomeItem}`}>
      <div className="flex max-h-[80dvh] flex-col gap-4 overflow-y-auto">
        <h2 className="text-lg font-semibold text-mesa-text-primary">{nomeItem}</h2>

        {grupos.map((grupo) => {
          const unico = grupo.max === 1
          const erro = validacao.erros[grupo.id]
          return (
            <fieldset key={grupo.id} className="flex flex-col gap-1">
              <legend className="mb-1 flex w-full items-baseline justify-between gap-2">
                <span className="text-sm font-semibold text-mesa-text-primary">{grupo.nome}</span>
                <span className="text-xs text-mesa-text-secondary">
                  {grupo.min >= 1 ? 'Obrigatório' : 'Opcional'}
                  {!unico && grupo.max !== null ? ` · até ${grupo.max}` : ''}
                </span>
              </legend>

              {grupo.opcoes.map((opcao) => {
                const marcada = ids.includes(opcao.id)
                const rotulo = opcao.esgotado ? `${opcao.nome} (acabou)` : opcao.nome
                const preco =
                  grupo.tipo === 'variacao'
                    ? formatarPrecoBR(opcao.precoCentavos)
                    : opcao.precoCentavos > 0
                      ? `+ ${formatarPrecoBR(opcao.precoCentavos)}`
                      : ''
                const alternar = () => setIds((atual) => alternarOpcao(grupos, atual, grupo.id, opcao.id))
                return (
                  <div key={opcao.id} className="flex items-center justify-between gap-3">
                    {unico ? (
                      <Radio
                        name={`grupo-${grupo.id}`}
                        value={opcao.id}
                        checked={marcada}
                        disabled={opcao.esgotado}
                        onChange={alternar}
                        label={rotulo}
                      />
                    ) : (
                      <Checkbox checked={marcada} disabled={opcao.esgotado} onChange={alternar} label={rotulo} />
                    )}
                    <span className="shrink-0 font-mesa-display text-sm text-mesa-text-secondary">{preco}</span>
                  </div>
                )
              })}

              {erro && grupo.min >= 1 && (
                <p role="status" className="text-xs text-mesa-text-secondary">
                  {erro}
                </p>
              )}
              {erro && grupo.min < 1 && (
                <p role="alert" className="text-xs font-medium text-mesa-error-500">
                  {erro}
                </p>
              )}
            </fieldset>
          )
        })}

        <Textarea
          label="Alguma observação? (opcional)"
          value={observacao}
          maxLength={MAX_OBSERVACAO}
          onChange={(e) => setObservacao(e.target.value)}
          placeholder="Ex.: sem cebola"
        />

        <Button
          variant="primary"
          size="xl"
          className="w-full"
          disabled={!validacao.ok}
          onClick={() => onConfirmar(ids, observacao.trim())}
        >
          Adicionar · {formatarPrecoBR(total)}
        </Button>
      </div>
    </BottomSheet>
  )
}
