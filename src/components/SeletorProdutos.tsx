import { useMemo, useState } from 'react'
import {
  alternarCategoria,
  alternarProduto,
  estadoDaCategoria,
  rotuloDaSelecao,
} from '../lib/selecaoProdutos'
import { BottomSheet } from './ui/BottomSheet'
import { Button } from './ui/Button'
import { Checkbox } from './ui/Checkbox'
import { Icone } from './ui/Icone'
import type { Categoria, Item } from '../types/database'

type Grupo = { chave: string; nome: string; itens: Item[] }

const SEM_CATEGORIA = 'sem-categoria'

export function SeletorProdutos({
  itens,
  categorias,
  selecionados,
  onChange,
  className,
}: {
  itens: Item[]
  categorias: Categoria[]
  selecionados: ReadonlySet<string>
  onChange: (proximo: Set<string>) => void
  className?: string
}) {
  const [aberto, setAberto] = useState(false)

  const nomesPorId = useMemo(() => new Map(itens.map((i) => [i.id, i.nome])), [itens])

  // Categoria sem produto ativo não aparece. Produto sem categoria (ou de
  // categoria que não existe mais) vai para "Sem categoria", no fim.
  const grupos = useMemo<Grupo[]>(() => {
    const idsDeCategorias = new Set(categorias.map((c) => c.id))
    const resultado: Grupo[] = categorias
      .map((c) => ({ chave: c.id, nome: c.nome, itens: itens.filter((i) => i.categoria_id === c.id) }))
      .filter((g) => g.itens.length > 0)
    const orfaos = itens.filter((i) => !i.categoria_id || !idsDeCategorias.has(i.categoria_id))
    if (orfaos.length > 0) resultado.push({ chave: SEM_CATEGORIA, nome: 'Sem categoria', itens: orfaos })
    return resultado
  }, [itens, categorias])

  const rotulo = rotuloDaSelecao(selecionados, nomesPorId) ?? 'Todos os produtos'

  return (
    <>
      <button
        type="button"
        onClick={() => setAberto(true)}
        aria-haspopup="dialog"
        className={`flex h-11 w-full items-center justify-between gap-2 rounded-mesa-sm border-[1.5px] border-mesa-border-default bg-mesa-surface px-3 text-left text-sm text-mesa-text-primary outline-none focus:border-mesa-orange-500 md:h-10 md:w-auto md:min-w-56 ${className ?? ''}`}
      >
        <span className="truncate">{rotulo}</span>
        <Icone nome="expand_more" size={16} />
      </button>

      <BottomSheet open={aberto} onClose={() => setAberto(false)} aria-label="Escolher produtos">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-mesa-text-primary">Produtos</h2>
          <button
            type="button"
            onClick={() => onChange(new Set())}
            disabled={selecionados.size === 0}
            className="min-h-11 px-2 text-sm font-semibold text-mesa-text-secondary disabled:opacity-40"
          >
            Limpar
          </button>
        </div>
        <p className="mt-1 text-sm text-mesa-text-secondary">
          Marque produtos ou uma categoria inteira. Sem nada marcado, mostra todos.
        </p>

        <div className="mt-3 flex max-h-[60dvh] flex-col gap-4 overflow-y-auto">
          {grupos.map((grupo) => {
            const ids = grupo.itens.map((i) => i.id)
            const estado = estadoDaCategoria(selecionados, ids)
            return (
              <div key={grupo.chave}>
                <Checkbox
                  checked={estado === 'todos'}
                  indeterminate={estado === 'alguns'}
                  onChange={() => onChange(alternarCategoria(selecionados, ids))}
                  label={grupo.nome}
                />
                <div className="mt-2 flex flex-col gap-2 pl-8">
                  {grupo.itens.map((item) => (
                    <Checkbox
                      key={item.id}
                      checked={selecionados.has(item.id)}
                      onChange={() => onChange(alternarProduto(selecionados, item.id))}
                      label={item.nome}
                    />
                  ))}
                </div>
              </div>
            )
          })}
        </div>

        <div className="mt-4">
          <Button size="xl" className="w-full" onClick={() => setAberto(false)}>
            Pronto
          </Button>
        </div>
      </BottomSheet>
    </>
  )
}
