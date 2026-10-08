import type { AssinaturaBarraca } from '../types/database'

type Cobranca = Pick<AssinaturaBarraca, 'cobranca_ativa'> | null | undefined

/** Chave global `app_config.cobranca_ativa` (docs/cobranca.md). Só o valor
 * `false` explícito desliga: resposta de servidor antigo (sem o campo) ou cache
 * do aparelho de antes da chave valem como cobrança ATIVA, o comportamento de
 * sempre. Com a cobrança desligada o servidor já devolve estado neutro
 * (active/pro, sem trial); estas regras só garantem que a tela nunca mostre
 * trial, banner ou bloqueio de assinatura em cima de um cache velho. */
export function cobrancaAtiva(assinatura: Cobranca): boolean {
  return assinatura?.cobranca_ativa !== false
}

/** Barra a tela só quando já sabemos que o acesso caiu E a cobrança está ligada. */
export function acessoBloqueadoPorAssinatura(
  assinatura: (Cobranca & Pick<AssinaturaBarraca, 'tem_acesso'>) | null,
  emPlanos: boolean,
): boolean {
  return assinatura !== null && cobrancaAtiva(assinatura) && !assinatura.tem_acesso && !emPlanos
}

/** Banner de trial: só para o dono, só em `trialing` e só com a cobrança ligada. */
export function mostraBannerDeTrial(
  assinatura: (Cobranca & Pick<AssinaturaBarraca, 'eh_dono' | 'status'>) | null,
  telaSemBanner: boolean,
): boolean {
  return !telaSemBanner && !!assinatura?.eh_dono && assinatura.status === 'trialing' && cobrancaAtiva(assinatura)
}
