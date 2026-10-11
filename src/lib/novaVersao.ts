// Aviso de "nova versão disponível" do PWA. O service worker já se atualiza sozinho (registerType 'autoUpdate':
// skipWaiting + clientsClaim), mas a página aberta segue rodando o JS antigo até recarregar — foi o que fez o app
// "não mostrar" correções já publicadas. Aqui só DETECTAMOS a troca e avisamos; nunca recarregamos sozinhos
// (o operador pode estar no meio de um pedido).

/** Intervalo entre checagens de atualização com o app aberto. */
export const INTERVALO_CHECAGEM_MS = 30 * 60 * 1000

/**
 * Uma troca de controlador é "atualização" só se a página JÁ tinha um service worker no controle ao abrir.
 * Na primeira instalação (sem controlador antes) o `controllerchange` é a instalação, não uma versão nova.
 */
export function trocaEhAtualizacao(tinhaControladorAoAbrir: boolean): boolean {
  return tinhaControladorAoAbrir
}
