// Leitura dos cookies de medição (puro, testado em tests/consentimentoMarketing.test.ts).

/** Valor de um cookie pelo nome (null se não houver). */
export function lerCookie(cookies: string, nome: string): string | null {
  const achado = cookies.split(';').map((c) => c.trim()).find((c) => c.startsWith(`${nome}=`))
  return achado ? decodeURIComponent(achado.slice(nome.length + 1)) || null : null
}

/** `_ga` = GA1.1.<id>.<timestamp>; o client_id do GA4 é "<id>.<timestamp>". */
export function gaClientIdDoCookie(valor: string | null): string | null {
  const m = valor?.match(/^GA\d\.\d\.(\d+\.\d+)$/)
  return m ? m[1] : null
}
