// CORS com allowlist para as edge functions AUTENTICADAS (auditoria B8): emitir-nfce, reportar-bug, excluir-conta,
// consultar-externo, criar-checkout-stripe e cancelar-assinatura-stripe. As funções PÚBLICAS do cardápio e os
// webhooks continuam com `*` (não usam cookie nem credencial do navegador). O JWT vai em header, então o risco do
// `*` era baixo; a allowlist só tira a abertura sem custo.
//
// ALLOWED_ORIGINS (secret/env da function, lista separada por vírgula) SUBSTITUI o padrão quando definida. Sem a
// variável (ou vazia) vale o padrão abaixo, que já cobre produção, o app Android (Capacitor) e dev/staging: não
// precisa configurar nada para o app continuar funcionando. Se for definir, inclua TODAS as origens do app,
// inclusive https://localhost e capacitor://localhost.
//
// Sem imports de Deno/jsr: roda nos testes (tests/cors.test.ts).

export const ORIGENS_PADRAO = [
  'https://app.saiae.com.br',
  'https://localhost', // app Android (Capacitor, androidScheme https)
  'capacitor://localhost', // Capacitor iOS / esquema antigo
  'http://localhost:5173', // dev (vite)
  'http://localhost:4173', // dev (vite preview; mesma lista do retorno do checkout)
  'http://127.0.0.1:5199', // staging local
]

const CABECALHOS_PERMITIDOS = 'authorization, x-client-info, apikey, content-type'
const METODOS_PERMITIDOS = 'POST, OPTIONS'

/** Lista efetiva: `valor` (ALLOWED_ORIGINS) se tiver ao menos uma origem; senão o padrão. */
export function origensPermitidas(valor: string | undefined | null): string[] {
  const lista = String(valor ?? '')
    .split(',')
    .map((o) => o.trim().replace(/\/+$/, ''))
    .filter((o) => o.length > 0 && o !== '*')
  return lista.length > 0 ? lista : ORIGENS_PADRAO
}

function lerAmbiente(): string | undefined {
  const deno = (globalThis as { Deno?: { env?: { get?: (k: string) => string | undefined } } }).Deno
  try {
    return deno?.env?.get?.('ALLOWED_ORIGINS')
  } catch {
    return undefined // sem permissão de env: padrão
  }
}

/** Cabeçalhos CORS para este pedido. Origem fora da lista (ou sem Origin) NÃO recebe Allow-Origin. */
export function corsHeaders(req: Request, ambiente: string | undefined | null = lerAmbiente()): Record<string, string> {
  const origem = req.headers.get('Origin') ?? ''
  const base: Record<string, string> = {
    'Access-Control-Allow-Headers': CABECALHOS_PERMITIDOS,
    'Access-Control-Allow-Methods': METODOS_PERMITIDOS,
    Vary: 'Origin',
  }
  if (origem && origensPermitidas(ambiente).includes(origem)) base['Access-Control-Allow-Origin'] = origem
  return base
}

/** Aplica o CORS da allowlist à resposta de um handler (troca qualquer Allow-Origin que ele tenha posto). */
export async function comCors(
  req: Request,
  resposta: Response | Promise<Response>,
  ambiente: string | undefined | null = lerAmbiente(),
): Promise<Response> {
  const original = await resposta
  const cabecalhos = new Headers(original.headers)
  cabecalhos.delete('Access-Control-Allow-Origin')
  for (const [k, v] of Object.entries(corsHeaders(req, ambiente))) {
    if (k === 'Vary') {
      const atual = cabecalhos.get('Vary')
      cabecalhos.set('Vary', atual && !/\bOrigin\b/i.test(atual) ? `${atual}, Origin` : (atual ?? v))
    } else {
      cabecalhos.set(k, v)
    }
  }
  return new Response(original.body, { status: original.status, statusText: original.statusText, headers: cabecalhos })
}
