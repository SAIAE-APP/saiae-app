// Ponto de entrada da Edge Function: liga o handler (handler.ts) ao Supabase e ao fetch de verdade.
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { criarHandler } from './handler.ts'

Deno.serve(criarHandler({ criarCliente: createClient, env: Deno.env, buscar: fetch }))
