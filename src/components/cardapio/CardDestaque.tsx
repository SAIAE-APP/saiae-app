import type { ReactNode } from 'react'
import { Icone } from '../ui/Icone'
import type { LinhaCardapioPublico } from '../../pages/CardapioPublico'

/** Herói mostarda do item em destaque. Todo texto é tinta (nunca branco sobre mostarda);
 * o botão chega pronto da página, em tinta, porque mostarda sobre mostarda não aparece. */
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
      className="mx-6 mb-5 rounded-mesa-xl bg-mesa-orange-500 p-3 text-mesa-neutral-900 shadow-mesa-1"
    >
      <p id={idRotulo} className="mb-2 text-xs font-bold uppercase tracking-wide">
        Destaque da casa
      </p>
      <div className="flex gap-3">
        <span className="flex size-24 shrink-0 items-center justify-center overflow-hidden rounded-mesa-md bg-mesa-neutral-900/10 min-[400px]:size-28">
          {item.item_foto_url ? (
            <img src={item.item_foto_url} alt="" className="size-full object-cover" />
          ) : (
            <Icone nome="image" size={28} />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-base font-bold leading-snug">{item.item_nome}</p>
          {item.item_descricao && <p className="mt-0.5 line-clamp-2 text-xs">{item.item_descricao}</p>}
          <p className="mt-1.5 flex flex-col font-mesa-display text-base font-bold">
            {item.a_partir_de && item.item_preco_centavos > 0 && <span className="text-xs font-normal">a partir de</span>}
            <span className="whitespace-nowrap">
              {item.item_preco_centavos > 0 ? formatarPreco(item.item_preco_centavos) : 'Sob consulta'}
            </span>
          </p>
        </div>
      </div>
      {textoFechado && <p className="mt-3 text-sm font-medium">{textoFechado}</p>}
      <div className="mt-3">{botao}</div>
    </section>
  )
}
