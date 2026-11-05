// Cópia local do conteúdo de planos — mesma fonte da landing page
// (MA_PLANS em D:\mesaagil-landing-kit\mesaagil-landing-kit\src\plans.js),
// fixada aqui de propósito: o app não faz chamada cross-origin pra LP em
// runtime. Se o preço/copy mudar lá, replica aqui também.
import type { AssinaturaBarraca, CicloAssinatura, PlanoAssinatura } from '../types/database'

export type InfoPlano = {
  plano: PlanoAssinatura
  nome: string
  selo?: string
  descricao: string
  mensal: number
  anual: { mes: number; total: number; economia: number; off: string }
  itens: string[]
  cta: string
}

export const PLANOS: Record<PlanoAssinatura, InfoPlano> = {
  essencial: {
    plano: 'essencial',
    nome: 'Essencial',
    descricao: 'Para quem tem uma barraca e quer largar o papel.',
    mensal: 57.9,
    anual: { mes: 49.22, total: 590.58, economia: 104.22, off: '15% OFF' },
    itens: [
      '1 barraca',
      'Lançar pedido (mesa, balcão e viagem)',
      'Cozinha em tempo real com cronômetro',
      'Chamada de senha com seu logo',
      'Pix, dinheiro, débito e crédito',
      'Relatório do dia',
      'Histórico de 7 dias',
      'Tema claro e escuro',
    ],
    cta: 'Começar com o Essencial',
  },
  pro: {
    plano: 'pro',
    nome: 'Pro',
    selo: '★ MAIS COMPLETO',
    descricao: 'Para quem quer controle total ou tem mais de um ponto.',
    mensal: 87.9,
    anual: { mes: 70.32, total: 843.84, economia: 210.96, off: '20% OFF' },
    itens: [
      'Tudo do Essencial',
      'Várias barracas na mesma conta',
      'Histórico completo e por período',
      'Exportar relatórios',
      'Custo do dia, lucro e taxas da maquininha',
      'Mais vendidos, ritmo e pontos de atenção',
      'Senha de operador e senha administrativa',
      'Suporte prioritário no WhatsApp',
    ],
    cta: 'Quero o Pro',
  },
}

export function formatarPreco(valor: number): string {
  return valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

export function linkAssinar(plano: PlanoAssinatura, ciclo: CicloAssinatura): string {
  return `/assinar?plano=${plano}&ciclo=${ciclo}`
}

/** Mensagem da conta bloqueada pelo admin; null se não bloqueada. Só `true`
 * conta: cache antigo sem o campo vale como não bloqueada. */
export function textoContaBloqueada(a: AssinaturaBarraca): string | null {
  return a.bloqueada === true ? 'Sua conta está bloqueada. Fale com o suporte do Sai aê.' : null
}
