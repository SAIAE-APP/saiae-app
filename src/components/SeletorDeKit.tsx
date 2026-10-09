import { useState } from 'react'
import clsx from 'clsx'
import { KIT_NENHUM, kitDoId, kitsRestantes, kitsSugeridos, type KitDef } from '../lib/kitsIniciais'

/**
 * "Quer começar com um cardápio de exemplo?" (passo 2 do assistente, atrás de VITE_ONBOARDING_KITS).
 * O valor é o id do kit, "nenhum" (começar do zero) ou null (ainda não decidiu). Nada é criado aqui: o kit só é
 * aplicado ao fim do passo 3, quando a barraca existe.
 */
export function SeletorDeKit({
  categoria,
  valor,
  onChange,
}: {
  categoria: string | null
  valor: string | null
  onChange: (v: string | null) => void
}) {
  const [verTodos, setVerTodos] = useState(false)
  const sugeridos = kitsSugeridos(categoria)
  const restantes = kitsRestantes(categoria)
  // Sem sugestão para a categoria (Oriental, Bebidas, Churrasco), mostra todos os modelos de uma vez.
  const todosAbertos = verTodos || sugeridos.length === 0
  const escolhido = kitDoId(valor)

  const cartao = (kit: KitDef) => {
    const marcado = valor === kit.id
    return (
      <button
        key={kit.id}
        type="button"
        role="radio"
        aria-checked={marcado}
        onClick={() => onChange(marcado ? null : kit.id)}
        className={clsx(
          'min-h-14 rounded-mesa-xl border-2 px-3 py-3 text-left',
          marcado
            ? 'border-mesa-neutral-900 bg-mesa-orange-500 text-mesa-neutral-900 dark:border-mesa-neutral-50'
            : 'border-mesa-border-subtle bg-mesa-surface text-mesa-text-primary',
        )}
      >
        <span className="block text-sm font-semibold">{kit.rotulo}</span>
        <span className={clsx('block text-xs', marcado ? 'text-mesa-neutral-900' : 'text-mesa-text-secondary')}>{kit.descricao}</span>
      </button>
    )
  }

  return (
    <section className="mt-6" aria-labelledby="titulo-kit">
      <h2 id="titulo-kit" className="text-base font-semibold text-mesa-text-primary">Quer começar com um cardápio de exemplo?</h2>
      <p className="mt-1 text-sm text-mesa-text-secondary">
        Montamos categorias, itens e opções do seu tipo de negócio. Os preços ficam em branco e nada aparece para o cliente
        até você preencher.
      </p>
      <div className="mt-3 flex flex-col gap-2" role="radiogroup" aria-label="Cardápio de exemplo">
        {sugeridos.map(cartao)}
        {todosAbertos && restantes.map(cartao)}
        {!todosAbertos && restantes.length > 0 && (
          <button type="button" onClick={() => setVerTodos(true)} className="min-h-11 text-left text-sm font-medium text-mesa-text-secondary underline">
            Ver outros modelos
          </button>
        )}
        <button
          type="button"
          role="radio"
          aria-checked={valor === KIT_NENHUM}
          onClick={() => onChange(valor === KIT_NENHUM ? null : KIT_NENHUM)}
          className={clsx(
            'min-h-12 rounded-mesa-xl border-2 px-3 py-2 text-left text-sm font-semibold',
            valor === KIT_NENHUM
              ? 'border-mesa-neutral-900 bg-mesa-orange-500 text-mesa-neutral-900 dark:border-mesa-neutral-50'
              : 'border-mesa-border-subtle bg-mesa-surface text-mesa-text-primary',
          )}
        >
          Começar do zero
        </button>
      </div>
      {escolhido?.aviso && <p className="mt-2 text-xs text-mesa-text-tertiary">{escolhido.aviso}</p>}
    </section>
  )
}
