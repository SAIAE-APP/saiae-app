import { useState } from 'react'
import { BottomSheet } from './ui/BottomSheet'
import { Button } from './ui/Button'
import { Input } from './ui/Input'
import { SegmentedControl } from './ui/SegmentedControl'
import { Toggle } from './ui/Toggle'
import { ErroSalvar } from './BotaoSalvarCampo'
import { filtrarEntradaPreco } from '../lib/preco'
import { validarFormularioCupom, type DadosCupom, type ErrosCupom, type FormularioCupom } from '../lib/cupons'

const CLASSE_DATA =
  'h-11 w-full min-w-0 rounded-mesa-sm border-[1.5px] border-mesa-border-default bg-mesa-surface px-3 text-sm text-mesa-text-primary outline-none focus:border-mesa-orange-500'

/** Formulário único de cupom (criar/editar). Salva por botão; o código repetido volta como erro do banco. */
export function BottomSheetCupom({
  titulo,
  inicial,
  lojaUsaPerfil,
  fuso,
  onClose,
  onSalvar,
}: {
  titulo: string
  inicial: FormularioCupom
  lojaUsaPerfil: boolean
  fuso: string | null | undefined
  onClose: () => void
  onSalvar: (dados: DadosCupom) => Promise<void>
}) {
  const [f, setF] = useState<FormularioCupom>(inicial)
  const [erros, setErros] = useState<ErrosCupom>({})
  const [erroGeral, setErroGeral] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)

  const atualizar = (p: Partial<FormularioCupom>) => setF((atual) => ({ ...atual, ...p }))

  async function salvar() {
    const r = validarFormularioCupom(f, { lojaUsaPerfil, fuso })
    if (!r.ok) {
      setErros(r.erros)
      setErroGeral(null)
      return
    }
    setErros({})
    setErroGeral(null)
    setSalvando(true)
    try {
      await onSalvar(r.dados)
    } catch (e) {
      setErroGeral(e instanceof Error ? e.message : 'Não foi possível salvar.')
    } finally {
      setSalvando(false)
    }
  }

  return (
    <BottomSheet open onClose={() => !salvando && onClose()} aria-label={titulo}>
      <div className="flex max-h-[80dvh] flex-col gap-4 overflow-y-auto">
        <h3 className="text-lg font-semibold text-mesa-text-primary">{titulo}</h3>

        <Input
          label="Código do cupom"
          value={f.codigo}
          maxLength={20}
          autoCapitalize="characters"
          autoComplete="off"
          onChange={(e) => atualizar({ codigo: e.target.value.toUpperCase().replace(/\s/g, '') })}
          placeholder="Ex.: FEIRA10"
          error={erros.codigo}
        />

        <div>
          <p className="mb-1.5 text-xs font-semibold text-mesa-text-secondary">Tipo de desconto</p>
          <SegmentedControl
            aria-label="Tipo de desconto"
            items={[{ label: 'Porcentagem' }, { label: 'Valor fixo' }]}
            activeIndex={f.tipo === 'percentual' ? 0 : 1}
            onChange={(i) => atualizar({ tipo: i === 0 ? 'percentual' : 'fixo', valorTexto: '' })}
          />
        </div>

        <Input
          label={f.tipo === 'percentual' ? 'Desconto (%)' : 'Desconto (R$)'}
          inputMode={f.tipo === 'percentual' ? 'numeric' : 'decimal'}
          value={f.valorTexto}
          onChange={(e) => atualizar({ valorTexto: f.tipo === 'percentual' ? e.target.value.replace(/\D/g, '').slice(0, 3) : filtrarEntradaPreco(e.target.value) })}
          error={erros.valor}
          helpText="O desconto vale só sobre os itens; a taxa de entrega nunca é descontada."
        />

        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col text-xs font-semibold text-mesa-text-secondary">
            Válido a partir de
            <input type="date" value={f.inicioTexto} onChange={(e) => atualizar({ inicioTexto: e.target.value })} className={`${CLASSE_DATA} mt-1.5`} />
            {erros.inicio && <span className="mt-1 text-xs font-medium text-mesa-error-500">{erros.inicio}</span>}
          </label>
          <label className="flex flex-col text-xs font-semibold text-mesa-text-secondary">
            Válido até
            <input type="date" value={f.fimTexto} min={f.inicioTexto || undefined} onChange={(e) => atualizar({ fimTexto: e.target.value })} className={`${CLASSE_DATA} mt-1.5`} />
            {erros.fim && <span className="mt-1 text-xs font-medium text-mesa-error-500">{erros.fim}</span>}
          </label>
        </div>

        <Input
          label="Limite de usos (opcional)"
          inputMode="numeric"
          value={f.limiteTexto}
          onChange={(e) => atualizar({ limiteTexto: e.target.value.replace(/\D/g, '').slice(0, 7) })}
          placeholder="Vazio = ilimitado"
          error={erros.limite}
        />

        <Input
          label="Pedido mínimo em itens (opcional)"
          inputMode="decimal"
          value={f.minimoTexto}
          onChange={(e) => atualizar({ minimoTexto: filtrarEntradaPreco(e.target.value) })}
          placeholder="R$"
          error={erros.minimo}
        />

        <div>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm text-mesa-text-primary">Uma vez por cliente</p>
              {!lojaUsaPerfil && (
                <p className="mt-0.5 text-xs text-mesa-text-secondary">
                  Disponível quando o perfil do cliente estiver ligado na loja (o cliente precisa confirmar o telefone).
                </p>
              )}
            </div>
            <Toggle
              checked={f.umaPorCliente}
              disabled={!lojaUsaPerfil && !f.umaPorCliente}
              onChange={(v) => atualizar({ umaPorCliente: v })}
              aria-label="Uma vez por cliente"
            />
          </div>
          {erros.umaPorCliente && <p className="mt-1 text-xs font-medium text-mesa-error-500">{erros.umaPorCliente}</p>}
        </div>

        <div className="flex items-center justify-between gap-3">
          <span className="text-sm text-mesa-text-primary">Cupom ativo</span>
          <Toggle checked={f.ativo} onChange={(v) => atualizar({ ativo: v })} aria-label="Cupom ativo" />
        </div>

        <ErroSalvar erro={erroGeral} />

        <Button variant="primary" size="xl" className="w-full" loading={salvando} disabled={salvando} onClick={() => void salvar()}>
          Salvar cupom
        </Button>
      </div>
    </BottomSheet>
  )
}
