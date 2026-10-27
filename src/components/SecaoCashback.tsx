import { useEffect, useState } from 'react'
import { useRascunho, useSalvarBarraca } from '../hooks/useSalvarBarraca'
import { CASHBACK_FAIXAS, CASHBACK_PADRAO, validarConfigCashback } from '../lib/cashbackRegras'
import type { ResumoCashback } from '../lib/cashbackResumo'
import { carregarResumoCashback } from '../lib/cashbackResumoDados'
import { formatarPrecoBR } from '../lib/preco'
import { bancoSemRecurso } from '../lib/semMigration'
import { BotaoSalvarCampo, ErroSalvar } from './BotaoSalvarCampo'
import { BottomSheet } from './ui/BottomSheet'
import { Button } from './ui/Button'
import { Card } from './ui/Card'
import { Checkbox } from './ui/Checkbox'
import { Icone } from './ui/Icone'
import { Input } from './ui/Input'
import { Toggle } from './ui/Toggle'
import type { Barraca } from '../types/database'

/** 500 -> "5"; 250 -> "2,5". O percentual é guardado em pontos-base, mas o dono pensa em porcentagem. */
function bpParaTexto(bp: number): string {
  return String(bp / 100).replace('.', ',')
}

/** "2,5" -> 250. Texto vazio ou inválido vira NaN, que `validarConfigCashback` recusa. */
function textoParaBp(texto: string): number {
  const n = Number(texto.trim().replace(',', '.'))
  return texto.trim() === '' || !Number.isFinite(n) ? NaN : Math.round(n * 100)
}

function textoParaInteiro(texto: string): number {
  return texto.trim() === '' ? NaN : Number(texto.trim())
}

const soDigitos = (t: string) => t.replace(/\D/g, '')
const percentualDigitado = (t: string) => t.replace(/[^\d,]/g, '').replace(/,(?=.*,)/g, '')

/**
 * Cashback do cardápio digital (spec 2026-10-27-cashback-design.md): o cliente identificado que pagou online ganha saldo
 * para o pedido seguinte. A BARRACA financia (SUPOSIÇÃO-CASHBACK-1): o saldo é um desconto futuro que ela deve ao cliente,
 * por isso ligar exige ler o aviso e aceitar o termo, e o aceite é gravado na MESMA gravação que liga. Nasce desligado e
 * desligar não cancela o que já foi dado (SUPOSIÇÃO-CASHBACK-2). Salva por botão explícito. Banco sem a migration = some.
 */
export function SecaoCashback({ barraca }: { barraca: Barraca }) {
  const habilitado = Boolean(barraca.cashback_habilitado)
  const lojaUsaPerfil = Boolean(barraca.perfil_cliente_obrigatorio)

  const percentualR = useRascunho(bpParaTexto(barraca.cashback_percentual_bp ?? CASHBACK_PADRAO.percentualBp))
  const validadeR = useRascunho(String(barraca.cashback_validade_dias ?? CASHBACK_PADRAO.validadeDias))
  const tetoR = useRascunho(String(barraca.cashback_teto_uso_pct ?? CASHBACK_PADRAO.tetoUsoPct))
  const flag = useSalvarBarraca(barraca)
  const config = useSalvarBarraca(barraca)

  const [avisoAberto, setAvisoAberto] = useState(false)
  const [entendi, setEntendi] = useState(false)
  const [erroConfig, setErroConfig] = useState<string | null>(null)
  const [resumo, setResumo] = useState<ResumoCashback | null>(null)
  const [resumoIndisponivel, setResumoIndisponivel] = useState(false)

  useEffect(() => {
    if (barraca.cashback_habilitado === undefined) return
    let cancelado = false
    const agora = new Date()
    carregarResumoCashback(barraca.id, new Date(agora.getTime() - 30 * 24 * 3600 * 1000), agora)
      .then((r) => {
        if (!cancelado) setResumo(r)
      })
      .catch((e) => {
        // o saldo em aberto é só informativo: sem a função no banco ou sem rede, a linha some sem atrapalhar a seção
        if (!cancelado && bancoSemRecurso(e)) setResumoIndisponivel(true)
      })
    return () => {
      cancelado = true
    }
  }, [barraca.id, barraca.cashback_habilitado])

  // Banco ou cache ainda sem as colunas: nada a mostrar (o app pode subir antes da migration).
  if (barraca.cashback_habilitado === undefined) return null

  function pedirLigar() {
    setEntendi(false)
    setAvisoAberto(true)
  }

  async function confirmarLigar() {
    // O check do banco exige o termo para ligar: o aceite e o interruptor vão juntos, nunca separados.
    const ok = await flag.salvar({ cashback_habilitado: true, cashback_termo_aceito_em: new Date().toISOString() })
    if (ok) setAvisoAberto(false)
  }

  async function desligar() {
    await flag.salvar({ cashback_habilitado: false })
  }

  async function salvarConfig() {
    const novo = {
      percentualBp: textoParaBp(percentualR.valor),
      validadeDias: textoParaInteiro(validadeR.valor),
      tetoUsoPct: textoParaInteiro(tetoR.valor),
    }
    const validacao = validarConfigCashback(novo)
    if (!validacao.ok) {
      setErroConfig(validacao.mensagem)
      return
    }
    setErroConfig(null)
    const ok = await config.salvar({
      cashback_percentual_bp: novo.percentualBp,
      cashback_validade_dias: novo.validadeDias,
      cashback_teto_uso_pct: novo.tetoUsoPct,
    })
    if (ok) {
      percentualR.descartar()
      validadeR.descartar()
      tetoR.descartar()
    }
  }

  const alterado = percentualR.alterado || validadeR.alterado || tetoR.alterado
  const [pMin, pMax] = CASHBACK_FAIXAS.percentualBp
  const [vMin, vMax] = CASHBACK_FAIXAS.validadeDias
  const [tMin, tMax] = CASHBACK_FAIXAS.tetoUsoPct

  return (
    <section>
      <h2 className="mb-3 flex items-center gap-1.5 font-mesa-sans text-xs font-semibold uppercase tracking-wider text-mesa-text-secondary">
        <Icone nome="paid" size={14} />
        Cashback
      </h2>
      <Card>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-base text-mesa-text-primary">Dar cashback no cardápio digital</p>
            <p className="mt-1 text-sm text-mesa-text-secondary">
              {habilitado
                ? 'Ligado: o cliente que pagar online ganha saldo para usar no pedido seguinte.'
                : 'Desligado: ninguém ganha saldo novo. Os saldos já dados continuam valendo até vencer.'}
            </p>
            {!lojaUsaPerfil && !habilitado && (
              <p className="mt-2 text-sm font-medium text-mesa-warning-700">Ligue o perfil do cliente para usar o cashback.</p>
            )}
          </div>
          <Toggle
            checked={habilitado}
            onChange={(v) => (v ? pedirLigar() : void desligar())}
            disabled={flag.salvando || (!habilitado && !lojaUsaPerfil)}
            aria-label="Dar cashback no cardápio digital"
          />
        </div>
        <ErroSalvar erro={flag.erro} className="mt-2" />

        {habilitado && (
          <p className="mt-2 text-sm text-mesa-text-secondary">
            Se você desligar, os saldos já dados continuam valendo até vencer.
          </p>
        )}

        <div className="mt-4 flex flex-col gap-4 border-t border-mesa-border-subtle pt-4">
          <Input
            label="Percentual de volta (%)"
            inputMode="decimal"
            value={percentualR.valor}
            onChange={(e) => percentualR.definir(percentualDigitado(e.target.value))}
            helpText={`Sobre os itens pagos em dinheiro. De ${pMin / 100}% a ${pMax / 100}%. Padrão ${CASHBACK_PADRAO.percentualBp / 100}%.`}
          />
          <Input
            label="Validade do saldo (dias)"
            inputMode="numeric"
            value={validadeR.valor}
            onChange={(e) => validadeR.definir(soDigitos(e.target.value))}
            helpText={`Vence depois do último ganho. De ${vMin} a ${vMax} dias. Padrão ${CASHBACK_PADRAO.validadeDias}.`}
          />
          <Input
            label="Teto de uso por pedido (% dos itens)"
            inputMode="numeric"
            value={tetoR.valor}
            onChange={(e) => tetoR.definir(soDigitos(e.target.value))}
            helpText={`Quanto do pedido o saldo pode pagar. De ${tMin}% a ${tMax}%. Padrão ${CASHBACK_PADRAO.tetoUsoPct}%.`}
          />
          {erroConfig && (
            <p role="alert" className="text-sm font-medium text-mesa-error-500">
              {erroConfig}
            </p>
          )}
          <BotaoSalvarCampo
            alterado={alterado}
            salvando={config.salvando}
            salvo={config.salvo}
            erro={config.erro}
            onSalvar={salvarConfig}
            rotulo="Salvar cashback"
          />
          <p className="text-xs text-mesa-text-secondary">
            Mudar o percentual ou a validade vale só para os próximos pedidos. O saldo já dado não muda.
          </p>
        </div>

        {!resumoIndisponivel && resumo && (
          <div className="mt-4 border-t border-mesa-border-subtle pt-4">
            <p className="text-sm text-mesa-text-secondary">Saldo em aberto</p>
            <p className="font-mesa-display text-xl font-bold text-mesa-text-primary">
              {formatarPrecoBR(resumo.saldoEmAbertoCentavos)}
            </p>
            <p className="text-xs text-mesa-text-secondary">É o desconto que você ainda deve aos clientes.</p>
          </div>
        )}
      </Card>

      <BottomSheet open={avisoAberto} onClose={() => !flag.salvando && setAvisoAberto(false)} aria-label="Ligar cashback">
        <h3 className="text-lg font-semibold text-mesa-text-primary">Antes de ligar o cashback</h3>
        <p className="mt-2 text-sm text-mesa-text-primary">
          Cada real de cashback que você dá é um desconto que você deve ao cliente. O dinheiro não sai da sua conta agora;
          ele sai menos quando o cliente voltar e usar. Saldo que vence deixa de ser dívida. Se você desligar, os saldos já
          dados continuam valendo até vencer.
        </p>
        <p className="mt-2 text-sm text-mesa-text-primary">
          O cashback pode ter efeito fiscal e contábil. Confirme com seu contador antes de ligar. O Sai aê mostra os números,
          mas não faz a contabilidade da sua barraca.
        </p>
        <div className="mt-4">
          <Checkbox
            checked={entendi}
            onChange={setEntendi}
            label="Entendi e vou conferir com meu contador"
            size="lg"
          />
        </div>
        <ErroSalvar erro={flag.erro} className="mt-3" />
        <div className="mt-6 flex flex-col gap-2">
          <Button variant="primary" size="xl" className="w-full" loading={flag.salvando} disabled={!entendi} onClick={() => void confirmarLigar()}>
            Ligar cashback
          </Button>
          <Button variant="ghost" size="md" className="w-full" disabled={flag.salvando} onClick={() => setAvisoAberto(false)}>
            Agora não
          </Button>
        </div>
      </BottomSheet>
    </section>
  )
}
