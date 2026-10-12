// supabase.functions.invoke com resposta não-2xx devolve data = null e o corpo em error.context (um Response).
// As edge functions de assinatura respondem 409/429 com { erro } em português: é essa frase que o usuário deve ver.
export async function mensagemDoErroFuncao(error: unknown, padrao: string): Promise<string> {
  const contexto = (error as { context?: unknown } | null)?.context
  if (contexto instanceof Response) {
    const corpo = (await contexto.json().catch(() => null)) as { erro?: unknown } | null
    if (typeof corpo?.erro === 'string' && corpo.erro.trim() !== '') return corpo.erro
  }
  return padrao
}
