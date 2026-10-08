import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import {
  decidirCupomConfig,
  interpretarValidacao,
  montarCorpoValidacao,
  normalizarCodigoCupom,
  type ItemParaCupom,
  type ResultadoCupom,
} from '../lib/cupomApi'

export type CupomAplicado = Extract<ResultadoCupom, { ok: true }>

/** Chama `cupom-validar` e devolve status + corpo (com status não-2xx o corpo fica em error.context). */
async function validarNoServidor(slug: string, codigo: string, itens: ItemParaCupom[], token: string | null): Promise<ResultadoCupom> {
  try {
    const { data, error } = await supabase.functions.invoke('cupom-validar', {
      body: montarCorpoValidacao({ slug, codigo, itens, token }),
    })
    if (!error) return interpretarValidacao(codigo, { status: 200, corpo: data })
    const contexto = (error as { context?: unknown }).context
    if (contexto instanceof Response) {
      const corpo = await contexto.json().catch(() => null)
      return interpretarValidacao(codigo, { status: contexto.status, corpo })
    }
    return interpretarValidacao(codigo, { status: 0, corpo: null })
  } catch {
    return interpretarValidacao(codigo, { status: 0, corpo: null })
  }
}

/**
 * Cupom do cardápio digital. `habilitado` só é verdadeiro quando a loja ligou os cupons E o banco tem a função
 * `cupom_config` (senão o campo nem aparece e o cardápio fica como sempre foi). O desconto vem SEMPRE do servidor;
 * quando o carrinho muda, o cupom é revalidado e, se deixou de valer, sai com um aviso.
 */
export function useCupom(slug: string | undefined, itens: ItemParaCupom[], token: string | null) {
  const [habilitado, setHabilitado] = useState(false)
  const [aplicado, setAplicado] = useState<CupomAplicado | null>(null)
  const [validando, setValidando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const chamada = useRef(0)
  const chaveItens = JSON.stringify(itens)
  const itensRef = useRef(itens)
  const tokenRef = useRef(token)
  useEffect(() => {
    itensRef.current = itens
    tokenRef.current = token
  })

  useEffect(() => {
    if (!slug) return
    let cancelado = false
    void supabase.rpc('cupom_config', { p_slug: slug }).then((resposta) => {
      if (!cancelado) setHabilitado(decidirCupomConfig(resposta))
    })
    return () => {
      cancelado = true
    }
  }, [slug])

  const aplicar = useCallback(
    async (texto: string) => {
      if (!slug) return
      const codigo = normalizarCodigoCupom(texto)
      setAviso(null)
      if (!codigo) {
        setErro('Cupom inválido')
        return
      }
      const minha = ++chamada.current
      setValidando(true)
      setErro(null)
      const r = await validarNoServidor(slug, codigo, itensRef.current, tokenRef.current)
      if (minha !== chamada.current) return
      setValidando(false)
      if (r.ok) setAplicado(r)
      else setErro(r.mensagem)
    },
    [slug],
  )

  const remover = useCallback(() => {
    chamada.current++
    setAplicado(null)
    setErro(null)
    setAviso(null)
    setValidando(false)
  }, [])

  // Carrinho mudou com um cupom aplicado: revalida; carrinho vazio limpa.
  useEffect(() => {
    if (!slug || !aplicado) return
    if (itensRef.current.length === 0) {
      setAplicado(null)
      return
    }
    const minha = ++chamada.current
    void validarNoServidor(slug, aplicado.codigo, itensRef.current, tokenRef.current).then((r) => {
      if (minha !== chamada.current) return
      if (r.ok) setAplicado(r)
      else {
        setAplicado(null)
        setAviso(`O cupom ${aplicado.codigo} saiu do pedido: ${r.mensagem}.`)
      }
    })
    // Só quando os itens mudam (o próprio `aplicado` se atualiza dentro do efeito).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, chaveItens])

  return { habilitado, aplicado, validando, erro, aviso, aplicar, remover }
}
