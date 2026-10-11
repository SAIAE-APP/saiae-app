import { useState } from 'react'
import { BottomSheet } from './ui/BottomSheet'
import { Button } from './ui/Button'
import { Input } from './ui/Input'
import { filtrarEntradaPreco } from '../lib/preco'
import { MAX_OBS_VALOR_LIVRE, validarValorLivre } from '../lib/valorLivre'

/** Folha do item de "Preço aberto": valor + o que foi vendido (obrigatório). O pai monta com `key` do item. */
export function FolhaValorLivre({
  nomeItem,
  onClose,
  onConfirmar,
}: {
  nomeItem: string
  onClose: () => void
  onConfirmar: (centavos: number, observacao: string) => void
}) {
  const [valor, setValor] = useState('')
  const [observacao, setObservacao] = useState('')
  const [erro, setErro] = useState<string | null>(null)

  function confirmar() {
    const r = validarValorLivre(valor, observacao)
    if (!r.ok) {
      setErro(r.erro)
      return
    }
    onConfirmar(r.centavos, r.observacao)
  }

  return (
    <BottomSheet open onClose={onClose} aria-label={`Valor livre de ${nomeItem}`}>
      <div className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold text-mesa-text-primary">{nomeItem}</h2>
        <Input
          autoFocus
          type="currency"
          label="Valor"
          inputMode="decimal"
          value={valor}
          onChange={(e) => {
            setErro(null)
            setValor(filtrarEntradaPreco(e.target.value))
          }}
          placeholder="0,00"
          className="w-full"
        />
        <Input
          label="O que foi vendido"
          value={observacao}
          maxLength={MAX_OBS_VALOR_LIVRE}
          onChange={(e) => {
            setErro(null)
            setObservacao(e.target.value)
          }}
          placeholder="Ex.: bala de menta"
          className="w-full"
        />
        {erro && (
          <p role="alert" className="text-sm font-medium text-mesa-error-500">
            {erro}
          </p>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Button variant="ghost" size="lg" onClick={onClose}>
            Cancelar
          </Button>
          <Button size="lg" onClick={confirmar}>
            Adicionar
          </Button>
        </div>
      </div>
    </BottomSheet>
  )
}
