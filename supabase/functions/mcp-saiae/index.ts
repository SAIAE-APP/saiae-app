// Ponto de entrada da Edge Function: liga o handler (handler.ts) ao Supabase. Deploy com --no-verify-jwt (o token do MCP não é JWT).
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { criarHandler } from './handler.ts'

// Endereços A e AAAA do nome. Ausência confirmada de registros (NotFound) vale lista vazia; qualquer outra falha numa das
// consultas lança, e o download é recusado: nunca valida só metade das respostas.
async function resolverDns(host: string): Promise<string[]> {
  const consulta = (tipo: 'A' | 'AAAA') =>
    Deno.resolveDns(host, tipo).catch((e: unknown) => {
      if (e instanceof Deno.errors.NotFound) return [] as string[]
      throw e
    })
  const [v4, v6] = await Promise.all([consulta('A'), consulta('AAAA')])
  return [...v4, ...v6]
}

Deno.serve(criarHandler({ criarCliente: createClient, env: Deno.env, fetchFn: fetch, resolverDns }))
