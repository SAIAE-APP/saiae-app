import { urlPublica } from './urlPublica.ts'

/** Link público que o motoboy abre. Usa `urlPublica`: no app Android nativo
 * `window.location.origin` é "https://localhost" e o link não abriria no celular dele. */
export function linkDoEntregador(token: string): string {
  return urlPublica(`/e/${token}`)
}

export function mensagemLinkEntregador(senha: number | null, token: string): string {
  const titulo = senha !== null ? `*Entrega - Pedido #${senha}*` : '*Entrega*'
  return `${titulo}\nAbra o link pra ver o pedido e confirmar a entrega:\n${linkDoEntregador(token)}`
}
