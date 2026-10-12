// Grava token FocusNFe, token do Pix e segredo do webhook CIFRADOS (plano 2026-10-12-criptografar-tokens-em-repouso).
// A regra vive em ../_shared/salvarCredencial.ts e é executada em tests/salvarCredencial.test.ts.
// Exige o secret TOKENS_CHAVE_V1 (32 bytes em base64). Deploy só por ordem do dono; ver o PR.
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { tratarSalvarCredencial } from '../_shared/salvarCredencial.ts'

Deno.serve((req: Request) =>
  tratarSalvarCredencial(req, {
    autenticar: async (jwt) => {
      const supabaseAuth = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_ANON_KEY') ?? '')
      const { data, error } = await supabaseAuth.auth.getUser(jwt)
      return error || !data?.user ? null : { id: data.user.id }
    },
    supabase: createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''),
    env: Deno.env,
  }),
)
