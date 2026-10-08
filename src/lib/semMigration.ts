// O app (Cloudflare) pode ir ao ar ANTES das migrations do banco. Telas que dependem de tabela ou
// função nova usam isto para se esconder, em vez de mostrar erro, quando o banco ainda não as tem.

/** Erro do PostgREST/Postgres de tabela, coluna ou função inexistente (banco sem a migration). */
export function bancoSemRecurso(erro: unknown): boolean {
  const e = erro as { message?: unknown; code?: unknown } | null | undefined
  const texto = `${typeof e?.code === 'string' ? e.code : ''} ${typeof e?.message === 'string' ? e.message : typeof erro === 'string' ? erro : ''}`
  return /PGRST20[2-5]|42P01|42703|42883|could not find the (table|function|'[^']+' column)|does not exist/i.test(texto)
}
