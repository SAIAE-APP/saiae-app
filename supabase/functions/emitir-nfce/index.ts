// Ponto de entrada da Edge Function: liga o handler (handler.ts) ao Supabase, ao fetch e ao relógio de verdade.
// Toda a regra mora em handler.ts para poder ser testada com dependências simuladas.
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { criarHandler } from './handler.ts'

Deno.serve(
  criarHandler({
    criarCliente: createClient,
    env: Deno.env,
    buscar: fetch,
    agora: () => Date.now(),
    esperar: (ms) => new Promise((r) => setTimeout(r, ms)),
  }),
)
