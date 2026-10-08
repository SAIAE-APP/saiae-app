import { useState } from 'react'
import { useBuscaClienteFinal } from '../hooks/useBuscaClienteFinal'
import { clienteParaDadosEntrega } from '../lib/clientesFinais'
import { textoEndereco } from '../lib/enderecoCliente'
import { formatarTelefoneBR, type DadosEntrega, type ErrosEntrega } from '../lib/entrega'
import { Icone } from './ui/Icone'
import { Input } from './ui/Input'

type Campo = keyof DadosEntrega

/**
 * Dados do cliente de uma Entrega. Digitando telefone ou nome aparecem
 * sugestões de clientes já cadastrados na barraca; tocar numa preenche tudo.
 * A busca é só ajuda: offline ou com erro, o caixa digita na mão.
 */
export function FormularioEntrega({
  barracaId,
  dados,
  erros,
  onChange,
  sugestoesBairro = [],
  avisoBairro,
}: {
  barracaId: string
  dados: DadosEntrega
  erros: ErrosEntrega
  onChange: (dados: DadosEntrega) => void
  /** Bairros cadastrados: viram sugestões (o operador ainda pode digitar outro). */
  sugestoesBairro?: string[]
  avisoBairro?: string
}) {
  const [campoBusca, setCampoBusca] = useState<'telefone' | 'nome' | null>(null)
  const termo = campoBusca ? dados[campoBusca] : ''
  const { clientes } = useBuscaClienteFinal(barracaId, termo)

  function alterar(campo: Campo, valor: string) {
    onChange({ ...dados, [campo]: valor })
  }

  return (
    <div className="flex flex-col gap-3">
      <Input
        label="Telefone"
        type="text"
        inputMode="tel"
        autoComplete="off"
        value={dados.telefone}
        onChange={(e) => alterar('telefone', e.target.value)}
        onFocus={() => setCampoBusca('telefone')}
        error={erros.telefone}
      />
      <Input
        label="Nome do cliente"
        autoComplete="off"
        value={dados.nome}
        onChange={(e) => alterar('nome', e.target.value)}
        onFocus={() => setCampoBusca('nome')}
        error={erros.nome}
      />

      {clientes.length > 0 && (
        <ul
          aria-label="Clientes cadastrados"
          className="overflow-hidden rounded-mesa-md border border-mesa-border-subtle bg-mesa-surface"
        >
          {clientes.map((c) => (
            <li key={c.id} className="border-b border-mesa-border-subtle last:border-b-0">
              <button
                type="button"
                onClick={() => {
                  onChange(clienteParaDadosEntrega(c))
                  setCampoBusca(null)
                }}
                className="flex min-h-11 w-full items-center gap-3 px-3 py-2 text-left outline-none"
              >
                <Icone nome="person" size={18} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-mesa-text-primary">
                    {c.nome} · {formatarTelefoneBR(c.telefone)}
                  </span>
                  <span className="block truncate text-xs text-mesa-text-secondary">
                    {textoEndereco(c)}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <Input
        label="Rua"
        autoComplete="off"
        value={dados.rua}
        onChange={(e) => alterar('rua', e.target.value)}
        error={erros.rua}
      />
      <div className="grid grid-cols-[96px_1fr] gap-3">
        <Input
          label="Número"
          autoComplete="off"
          value={dados.numero}
          onChange={(e) => alterar('numero', e.target.value)}
          error={erros.numero}
        />
        <Input
          label="Bairro"
          autoComplete="off"
          list={sugestoesBairro.length > 0 ? 'bairros-entrega-sugeridos' : undefined}
          value={dados.bairro}
          onChange={(e) => alterar('bairro', e.target.value)}
          error={erros.bairro}
        />
      </div>
      {sugestoesBairro.length > 0 && (
        <datalist id="bairros-entrega-sugeridos">
          {sugestoesBairro.map((b) => (
            <option key={b} value={b} />
          ))}
        </datalist>
      )}
      {avisoBairro && <p className="text-sm font-medium text-mesa-warning-700">{avisoBairro}</p>}
      <Input
        label="Referência (opcional)"
        autoComplete="off"
        value={dados.referencia ?? ''}
        onChange={(e) => alterar('referencia', e.target.value)}
      />
    </div>
  )
}
