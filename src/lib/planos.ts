// Modelo de preço único do Sai aê (puro e testável). Os valores aqui são só
// EXIBIÇÃO: quem decide o que é cobrado é o servidor (criar-checkout-stripe e
// criar-checkout-fiscal), nunca o cliente.
import type { AssinaturaBarraca, CicloAssinatura, PlanoAssinatura } from '../types/database'
import { formatarPrecoBR } from './preco.ts'

export const PRECO_BASE_MENSAL_CENTAVOS = 5790
export const PRECO_BASE_ANUAL_CENTAVOS = 49900
/** Módulo de nota fiscal: por CNPJ, sempre cobrado por mês (mesmo com a base anual). */
export const PRECO_FISCAL_MENSAL_CENTAVOS = 6990

/** Plano vendido hoje. Essencial/Pro só existem para assinantes antigos. */
export const PLANO_VENDA: PlanoAssinatura = 'ponto'

/** Recursos incluídos na assinatura (antes divididos entre Essencial e Pro). */
export const RECURSOS_INCLUIDOS = [
  '1 ponto de venda',
  'Lançar pedido (mesa, balcão e viagem)',
  'Cozinha em tempo real com cronômetro',
  'Chamada de senha com seu logo',
  'Pix, dinheiro, débito e crédito',
  'Relatório do dia e histórico completo',
  'Exportar relatórios',
  'Custo do dia, lucro e taxas da maquininha',
  'Senha de operador e senha administrativa',
] as const

const NOME_PLANO: Record<PlanoAssinatura, string> = { essencial: 'Essencial', pro: 'Pro', ponto: 'Sai aê' }

/** Nome de exibição; null (sem plano) vira 'Sai aê'. */
export function nomePlano(plano: PlanoAssinatura | null | undefined): string {
  return plano ? NOME_PLANO[plano] : NOME_PLANO.ponto
}

export function formatarPreco(centavos: number): string {
  return formatarPrecoBR(centavos)
}

/** Equivalente mensal do anual, arredondado ao centavo (49900 / 12 = 41,58). */
export const ANUAL_EQUIVALENTE_MES_CENTAVOS = Math.round(PRECO_BASE_ANUAL_CENTAVOS / 12)
/** Economia do anual frente a 12 mensalidades (69480 - 49900 = 195,80). */
export const ANUAL_ECONOMIA_CENTAVOS = PRECO_BASE_MENSAL_CENTAVOS * 12 - PRECO_BASE_ANUAL_CENTAVOS
export const ANUAL_ECONOMIA_PERCENTUAL = Math.round(
  (ANUAL_ECONOMIA_CENTAVOS / (PRECO_BASE_MENSAL_CENTAVOS * 12)) * 100,
)

export type ResumoCobranca = {
  /** Linhas explícitas, cada uma com a sua periodicidade. */
  linhas: { rotulo: string; texto: string }[]
  /** Frase única: "R$ 127,80 por mês" ou "R$ 499,00 por ano + R$ 69,90 por mês". */
  total: string
  /** Só no anual. */
  economia: string | null
}

export function resumoCobranca(ciclo: CicloAssinatura, comFiscal: boolean): ResumoCobranca {
  const anual = ciclo === 'anual'
  const base = anual
    ? `${formatarPreco(PRECO_BASE_ANUAL_CENTAVOS)} por ano`
    : `${formatarPreco(PRECO_BASE_MENSAL_CENTAVOS)} por mês`
  const fiscal = `${formatarPreco(PRECO_FISCAL_MENSAL_CENTAVOS)} por mês`
  const linhas = [{ rotulo: anual ? 'Sai aê (anual)' : 'Sai aê (mensal)', texto: base }]
  if (comFiscal) linhas.push({ rotulo: 'Nota fiscal (por CNPJ, cobrança mensal)', texto: fiscal })

  let total = base
  if (comFiscal) {
    total = anual
      ? `${base} + ${fiscal}`
      : `${formatarPreco(PRECO_BASE_MENSAL_CENTAVOS + PRECO_FISCAL_MENSAL_CENTAVOS)} por mês`
  }
  const economia = anual
    ? `Equivale a ${formatarPreco(ANUAL_EQUIVALENTE_MES_CENTAVOS)} por mês: economia de ${formatarPreco(ANUAL_ECONOMIA_CENTAVOS)} (${ANUAL_ECONOMIA_PERCENTUAL}%) frente a 12 mensalidades.`
    : null
  return { linhas, total, economia }
}

export function linkAssinar(plano: PlanoAssinatura, ciclo: CicloAssinatura): string {
  return `/assinar?plano=${plano}&ciclo=${ciclo}`
}

/** Links antigos (`plano=essencial|pro`) e links sem plano valem como `PLANO_VENDA`
 * (`ponto`): vendas novas não vendem mais Essencial/Pro. Só o ciclo do link importa.
 * Ciclo ausente vale mensal; valor desconhecido devolve null (erro na tela). */
export function cicloDoLink(ciclo: string | null): CicloAssinatura | null {
  if (ciclo === null || ciclo === '') return 'mensal'
  return ciclo === 'mensal' || ciclo === 'anual' ? ciclo : null
}

/** Mensagem da conta bloqueada pelo admin; null se não bloqueada. Só `true`
 * conta: cache antigo sem o campo vale como não bloqueada. */
export function textoContaBloqueada(a: AssinaturaBarraca): string | null {
  return a.bloqueada === true ? 'Sua conta está bloqueada. Fale com o suporte do Sai aê.' : null
}

/** Versão do termo de contratação dos módulos; o servidor recusa (422 `termo_nao_aceito`) se for diferente. */
export const TERMO_MODULOS_VERSAO = 'termos-2026-10-v1'
