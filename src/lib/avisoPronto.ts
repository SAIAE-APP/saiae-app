import { normalizarTelefone } from './entrega'
import { numeroWhatsapp } from './pagarNaEntrega'
import type { Barraca, Pedido } from '../types/database'

export const MSG_PRONTO_PADRAO = 'Olá {nome}! Seu pedido {senha} da {barraca} está pronto. Pode retirar!'
export const MSG_PRONTO_ENTREGA_PADRAO =
  'Olá {nome}! Seu pedido {senha} da {barraca} está pronto e já vai sair para a entrega.'

export const VARIAVEIS_MSG_PRONTO = ['{nome}', '{senha}', '{barraca}'] as const

/** Telefone pra avisar: o do aviso (`cliente_telefone`) ou, em pedido de Entrega/antigo, o da entrega. */
export function telefoneDoCliente(
  pedido: Pick<Pedido, 'cliente_telefone' | 'entrega_telefone'>,
): string | null {
  const bruto = pedido.cliente_telefone || pedido.entrega_telefone || ''
  const digitos = normalizarTelefone(bruto)
  return digitos.length >= 8 && digitos.length <= 15 ? digitos : null
}

/** Primeiro nome só (a mensagem é curta e informal). */
function primeiroNome(nome: string | null | undefined): string {
  return (nome ?? '').trim().split(/\s+/)[0] ?? ''
}

/**
 * Preenche {nome} {senha} {barraca}. Variável sem valor some junto do espaço
 * antes dela ("Olá {nome}!" sem nome vira "Olá!").
 */
export function montarMensagemPronto(
  modelo: string,
  valores: { nome?: string | null; senha: number | string | null; barraca: string },
): string {
  const nome = primeiroNome(valores.nome)
  const senha = valores.senha === null || valores.senha === '' ? '' : `#${valores.senha}`
  let texto = modelo
  const trocar = (chave: string, valor: string) => {
    texto = valor
      ? texto.split(chave).join(valor)
      : texto.replace(new RegExp(`\\s*${chave.replace(/[{}]/g, '\\$&')}`, 'g'), '')
  }
  trocar('{nome}', nome)
  trocar('{senha}', senha)
  trocar('{barraca}', valores.barraca.trim())
  return texto
    .replace(/\s+([!?.,])/g, '$1')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/^[\s,;:]+/, '')
    .trim()
}

export function modeloMensagemPronto(
  barraca: Pick<Barraca, 'msg_pedido_pronto' | 'msg_pedido_pronto_entrega'>,
  ehEntrega: boolean,
): string {
  const personalizada = ehEntrega ? barraca.msg_pedido_pronto_entrega : barraca.msg_pedido_pronto
  return personalizada?.trim() || (ehEntrega ? MSG_PRONTO_ENTREGA_PADRAO : MSG_PRONTO_PADRAO)
}

export function urlWhatsappCliente(telefone: string, mensagem: string): string {
  return `https://wa.me/${numeroWhatsapp(telefone)}?text=${encodeURIComponent(mensagem)}`
}
