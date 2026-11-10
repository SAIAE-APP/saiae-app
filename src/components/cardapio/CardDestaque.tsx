import type { ReactNode } from 'react'
import { Icone } from '../ui/Icone'
import type { LinhaCardapioPublico } from '../../pages/CardapioPublico'

/** Item em destaque: foto grande com nome e preço sobre um degradê de tinta (texto branco
 * sobre tinta, nunca sobre mostarda), selo mostarda em canto balão e o botão de pedir logo abaixo.
 * Cores só por tokens. */
export function CardDestaque({
  item,
  formatarPreco,
  botao,
  textoFechado,
}: {
  item: LinhaCardapioPublico
  formatarPreco: (centavos: number) => string
  botao: ReactNode
  textoFechado?: string
}) {
  const idRotulo = 'rotulo-destaque'
  return (
    <section
      aria-labelledby={idRotulo}
      className="mx-6 mb-6 overflow-hidden rounded-mesa-2xl border border-mesa-border-default bg-mesa-surface shadow-mesa-3"
    >
      <div className="relative aspect-[4/3] w-full sm:aspect-[16/9] bg-mesa-neutral-800">
        {item.item_foto_url ? (
          <img src={item.item_foto_url} alt="" className="size-full object-cover" />
        ) : (
          <span className="flex size-full items-center justify-center text-mesa-neutral-500">
            <Icone nome="image" size={48} />
          </span>
        )}
        <div
          aria-hidden="true"
          className="absolute inset-x-0 bottom-0 h-3/5 bg-gradient-to-t from-mesa-neutral-900/90 via-mesa-neutral-900/50 to-transparent"
        />
        <span
          id={idRotulo}
          className="absolute left-3 top-3 flex items-center gap-1 rounded-mesa-balao bg-mesa-orange-500 px-3 py-1.5 text-xs font-bold text-mesa-neutral-900 shadow-mesa-2"
        >
          <Icone nome="star" size={14} />
          Destaque da casa
        </span>
        <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 p-4 text-white">
          <p className="min-w-0 text-xl font-bold leading-tight">{item.item_nome}</p>
          <p className="flex shrink-0 flex-col items-end font-mesa-display font-bold">
            {item.a_partir_de && item.item_preco_centavos > 0 && (
              <span className="text-xs font-normal text-white/80">a partir de</span>
            )}
            <span className="whitespace-nowrap text-xl">
              {item.item_preco_centavos > 0 ? formatarPreco(item.item_preco_centavos) : 'Sob consulta'}
            </span>
          </p>
        </div>
      </div>
      <div className="flex flex-col gap-3 p-4">
        {item.item_descricao && (
          <p className="line-clamp-3 text-sm text-mesa-text-secondary">{item.item_descricao}</p>
        )}
        {textoFechado && <p className="text-sm font-medium text-mesa-text-secondary">{textoFechado}</p>}
        {botao}
      </div>
    </section>
  )
}
