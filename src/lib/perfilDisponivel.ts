// O app (Cloudflare) pode ir ao ar ANTES da migration e das functions do perfil do cliente. Decide, pela
// resposta da RPC `perfil_cliente_config(slug)`, se o recurso existe nesta loja e se é obrigatório.
// PURO (sem imports): testável no Node. Qualquer dúvida = indisponível, e o app fica como sempre foi.
export type PerfilConfig = { disponivel: boolean; obrigatorio: boolean }

export const PERFIL_INDISPONIVEL: PerfilConfig = { disponivel: false, obrigatorio: false }

export function decidirPerfil(resposta: { data: unknown; error: unknown }): PerfilConfig {
  // Erro (função inexistente PGRST202/42883, rede, permissão) ou resposta vazia: recurso indisponível.
  if (resposta.error) return PERFIL_INDISPONIVEL
  const linha = Array.isArray(resposta.data) ? resposta.data[0] : null
  if (typeof linha !== 'object' || linha === null) return PERFIL_INDISPONIVEL
  const obrigatorio = (linha as { obrigatorio?: unknown }).obrigatorio
  if (typeof obrigatorio !== 'boolean') return PERFIL_INDISPONIVEL
  return { disponivel: true, obrigatorio }
}
