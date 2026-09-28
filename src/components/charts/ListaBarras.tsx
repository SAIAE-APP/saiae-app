import clsx from 'clsx'

export type ItemListaBarras = {
  chave: string
  rotulo: string
  valor: number
  rotuloValor: string
}

/** Lista de barras horizontais — proporção, não sinal operacional (não é
 * kanban), então a cor não pode ser mesa-success genérico. Barra neutra
 * (tinta) pra todo item; só a de maior valor ganha mostarda — mesmo "um
 * acento por card" do resto do app (ver CardItemHorizontal "Top 1"). */
export function ListaBarras({ itens }: { itens: ItemListaBarras[] }) {
  const maximo = Math.max(1, ...itens.map((i) => i.valor))

  return (
    <ul className="mt-2 flex flex-col gap-2.5">
      {itens.map((item) => {
        const destaque = item.valor > 0 && item.valor === maximo
        return (
          <li key={item.chave}>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="truncate text-mesa-text-primary">{item.rotulo}</span>
              <span className="shrink-0 font-mesa-display font-semibold text-mesa-text-primary">
                {item.rotuloValor}
              </span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-mesa-full bg-mesa-neutral-100 dark:bg-mesa-neutral-800">
              <div
                className={clsx(
                  'h-full rounded-mesa-full',
                  destaque ? 'bg-mesa-orange-500' : 'bg-mesa-neutral-400 dark:bg-mesa-neutral-600',
                )}
                style={{ width: `${Math.max((item.valor / maximo) * 100, item.valor > 0 ? 3 : 0)}%` }}
              />
            </div>
          </li>
        )
      })}
    </ul>
  )
}
