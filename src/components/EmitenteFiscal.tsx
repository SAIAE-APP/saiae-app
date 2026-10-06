import { useState } from 'react'
import { useRascunho, useSalvarBarraca } from '../hooks/useSalvarBarraca'
import { bpsParaPercentual, percentualParaBps } from '../lib/taxas'
import { TELEFONE_PROCON } from '../lib/fiscal'
import type { Barraca } from '../types/database'
import { BotaoSalvarCampo } from './BotaoSalvarCampo'
import { Input } from './ui/Input'
import { Textarea } from './ui/Textarea'

const ALIQUOTA_MAX_BPS = 10000

function vazioParaNull(valor: string): string | null {
  const limpo = valor.trim()
  return limpo ? limpo : null
}

/**
 * Cadastro do emitente (Ajustes > Fiscal): dados que saem no cupom da NFC-e
 * e as exigências do PROCON (telefone 151 fixo + endereço da sede, texto livre
 * por barraca) e da Lei 12.741 (alíquota aproximada de tributos). Um botão
 * Salvar só pro grupo, como o resto de Ajustes.
 */
export function EmitenteFiscal({ barraca }: { barraca: Barraca }) {
  const razaoR = useRascunho(barraca.emitente_razao_social ?? '')
  const ieR = useRascunho(barraca.emitente_inscricao_estadual ?? '')
  const telefoneR = useRascunho(barraca.emitente_telefone ?? '')
  const enderecoR = useRascunho(barraca.emitente_endereco ?? '')
  const proconR = useRascunho(barraca.procon_endereco ?? '')
  const aliquotaR = useRascunho(bpsParaPercentual(barraca.tributos_aprox_bps ?? null))
  const { salvar, salvando, salvo, erro } = useSalvarBarraca(barraca)
  const [erroAliquota, setErroAliquota] = useState<string | null>(null)

  const alterado =
    razaoR.alterado ||
    ieR.alterado ||
    telefoneR.alterado ||
    enderecoR.alterado ||
    proconR.alterado ||
    aliquotaR.alterado

  async function aoSalvar() {
    const bps = percentualParaBps(aliquotaR.valor)
    if (bps !== null && (bps < 0 || bps > ALIQUOTA_MAX_BPS)) {
      setErroAliquota('Informe um percentual entre 0 e 100.')
      return
    }
    setErroAliquota(null)

    const ok = await salvar({
      emitente_razao_social: vazioParaNull(razaoR.valor),
      emitente_inscricao_estadual: vazioParaNull(ieR.valor),
      emitente_telefone: vazioParaNull(telefoneR.valor),
      emitente_endereco: vazioParaNull(enderecoR.valor),
      procon_endereco: vazioParaNull(proconR.valor),
      tributos_aprox_bps: bps,
    })
    if (ok) {
      razaoR.descartar()
      ieR.descartar()
      telefoneR.descartar()
      enderecoR.descartar()
      proconR.descartar()
      aliquotaR.descartar()
    }
  }

  return (
    <div className="mt-4 border-t border-mesa-border-subtle pt-4">
      <p className="text-sm font-medium text-mesa-text-primary">Dados do emitente (saem no cupom)</p>
      <div className="mt-3 flex flex-col gap-3">
        <Input
          label="Razão social"
          value={razaoR.valor}
          onChange={(e) => razaoR.definir(e.target.value)}
          maxLength={120}
          className="max-w-md"
        />
        <Input
          label="Inscrição estadual"
          value={ieR.valor}
          onChange={(e) => ieR.definir(e.target.value)}
          maxLength={30}
          className="max-w-xs"
        />
        <Input
          label="Telefone"
          inputMode="tel"
          value={telefoneR.valor}
          onChange={(e) => telefoneR.definir(e.target.value)}
          maxLength={20}
          placeholder="(00) 00000-0000"
          className="max-w-xs"
        />
        <Textarea
          label="Endereço do estabelecimento"
          value={enderecoR.valor}
          onChange={(e) => enderecoR.definir(e.target.value)}
          maxLength={200}
          placeholder="Rua, número, bairro, cidade/UF"
        />
      </div>

      <p className="mt-5 text-sm font-medium text-mesa-text-primary">PROCON e tributos (exigência na nota)</p>
      <div className="mt-3 flex flex-col gap-3">
        <Textarea
          label="Endereço da sede do PROCON"
          helpText={`O telefone ${TELEFONE_PROCON} já sai fixo no cupom. Informe o endereço da sede do PROCON da sua cidade.`}
          value={proconR.valor}
          onChange={(e) => proconR.definir(e.target.value)}
          maxLength={200}
          placeholder="Rua, número, bairro, cidade/UF"
        />
        <Input
          label="Alíquota aproximada de tributos (%)"
          helpText="Lei 12.741: a FocusNFe não calcula o valor sozinha. Use o percentual da tabela IBPT (ibpt.com.br) pro seu produto; o cupom marca a fonte como informada pelo emitente."
          inputMode="decimal"
          value={aliquotaR.valor}
          onChange={(e) => {
            setErroAliquota(null)
            aliquotaR.definir(e.target.value.replace(/[^\d.,]/g, ''))
          }}
          placeholder="Ex.: 18,50"
          error={erroAliquota ?? undefined}
          className="max-w-xs"
        />
      </div>

      <BotaoSalvarCampo
        alterado={alterado}
        salvando={salvando}
        salvo={salvo}
        erro={erro}
        onSalvar={aoSalvar}
        rotulo="Salvar dados do emitente"
        className="mt-3"
      />
    </div>
  )
}
