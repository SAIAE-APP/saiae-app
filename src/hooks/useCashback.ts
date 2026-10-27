import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { chamarSessao } from '../lib/clienteApi'
import {
  corpoCashback,
  decidirCashbackConfig,
  interpretarCashback,
  type ConfigCashback,
  type DadosCashback,
} from '../lib/cashbackApi'
import { MSG_CUPOM_E_SALDO } from '../lib/cashbackTexto'
import { calcularCredito, calcularResgate, itensLiquidosCentavos } from '../lib/cashbackRegras'

const CONFIG_DESLIGADA: ConfigCashback = { habilitado: false, percentualBp: 0, tetoUsoPct: 0, validadeDias: 0 }

/**
 * Cashback no checkout do cardápio digital (spec 2026-10-27). SÓ PRÉVIA: o servidor recalcula o saldo, o desconto e o
 * ganho, e responde 409 com o novo total se divergir. O hook não depende do hook de cupom: a exclusão cupom OU saldo vem pela
 * prop `cupomAplicado` (e o servidor recusa os dois com 422). Sem sessão confirmada (`token`) nada aparece e o uso é 0.
 *
 * SUPOSIÇÃO-CASHBACK-2: saldo já concedido continua usável com o cashback desligado na loja; por isso `habilitado` (mostrar
 * o bloco) vale também com a loja desligada se o cliente tem saldo, mas o "você ganha" só aparece com a loja ligada.
 * SUPOSIÇÃO-CASHBACK-4: um benefício por pedido (cupom OU saldo) e o saldo nasce desmarcado.
 */
export function useCashback(a: {
  slug: string | undefined
  token: string | null
  itensCentavos: number
  cupomAplicado: boolean
  pagamentoOnline: boolean
}) {
  const { slug, token, itensCentavos, cupomAplicado, pagamentoOnline } = a
  const [config, setConfig] = useState<ConfigCashback>(CONFIG_DESLIGADA)
  const [dadosBrutos, setDados] = useState<DadosCashback | null>(null)
  const [carregouPara, setCarregouPara] = useState<string | null>(null)
  const [usar, setUsar] = useState(false)
  const [cupomVisto, setCupomVisto] = useState(cupomAplicado)

  // Quando o cupom entra, o saldo desmarca (um benefício por pedido). Ajuste durante a renderização, sem efeito.
  if (cupomVisto !== cupomAplicado) {
    setCupomVisto(cupomAplicado)
    if (cupomAplicado) setUsar(false)
  }

  useEffect(() => {
    if (!slug) return
    let cancelado = false
    void supabase.rpc('cashback_config', { p_slug: slug }).then((resposta) => {
      if (!cancelado) setConfig(decidirCashbackConfig(resposta))
    })
    return () => {
      cancelado = true
    }
  }, [slug])

  useEffect(() => {
    if (!slug || !token) return
    let cancelado = false
    void chamarSessao(slug, 'cashback').then((resposta) => {
      if (cancelado) return
      setDados(resposta.ok ? interpretarCashback(resposta.dados) : null)
      setCarregouPara(token)
    })
    return () => {
      cancelado = true
    }
  }, [slug, token])

  // Sem sessão, o que veio antes não vale mais (cliente saiu): nunca mostrar saldo de outra pessoa.
  const dados = token ? dadosBrutos : null
  const carregando = Boolean(token) && carregouPara !== token

  const habilitado = dados !== null && (config.habilitado || dados.disponivelCentavos > 0)

  const usadoCentavos =
    habilitado && dados && usar && pagamentoOnline && !cupomAplicado
      ? calcularResgate({ saldoDisponivel: dados.disponivelCentavos, itens: itensCentavos, tetoUsoPct: dados.tetoUsoPct })
      : 0

  const percentualBp = config.habilitado ? config.percentualBp : 0
  const ganhoCentavos =
    habilitado && config.habilitado && pagamentoOnline
      ? calcularCredito(itensLiquidosCentavos(itensCentavos, usadoCentavos), percentualBp)
      : 0

  // O que o saldo pagaria se o cliente marcar, para o rótulo e para saber se há algo a oferecer.
  const resgatePossivelCentavos =
    habilitado && dados && pagamentoOnline && !cupomAplicado
      ? calcularResgate({ saldoDisponivel: dados.disponivelCentavos, itens: itensCentavos, tetoUsoPct: dados.tetoUsoPct })
      : 0

  const aviso = cupomAplicado && habilitado && dados !== null && dados.disponivelCentavos > 0 ? MSG_CUPOM_E_SALDO : null

  const corpo = useCallback(
    () => corpoCashback(usadoCentavos > 0),
    [usadoCentavos],
  )

  return {
    habilitado,
    dados,
    usar: usar && !cupomAplicado,
    setUsar,
    usadoCentavos,
    resgatePossivelCentavos,
    ganhoCentavos,
    aviso,
    corpoCashback: corpo,
    carregando,
  }
}

export type EstadoCashback = ReturnType<typeof useCashback>
