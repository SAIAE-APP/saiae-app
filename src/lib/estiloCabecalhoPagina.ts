import clsx from 'clsx'

/** Classe compartilhada pro <h1> do cabeçalho de página (CabecalhoPagina.tsx).
 * `whitespace-nowrap truncate` evita que o título quebre linha quando os
 * selos/botões à direita disputam espaço em telas estreitas — o ancestor
 * flex precisa de `min-w-0` pro `truncate` funcionar. Fonte menor no
 * mobile (text-2xl, já usado em Cozinha/Histórico/Faturamento), 32px só
 * a partir de md: (tamanho que Lançar Pedido/Ajustes já usavam fixo). */
export function classesTituloCabecalho(): string {
  return clsx(
    'truncate whitespace-nowrap text-2xl font-bold leading-tight text-mesa-text-primary',
    'md:text-[32px] md:leading-[40px]',
  )
}
