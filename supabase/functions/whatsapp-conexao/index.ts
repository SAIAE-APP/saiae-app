// Conexão do WhatsApp da loja com o CRM (aba "WhatsApp e Automação"). Chamada pelo app com o login: confere o vínculo
// com a loja, assina e repassa a ação ao CRM (contrato v1) e devolve { ok, estado, qr, numero, avisos }.
// Iniciar e desconectar são só do dono. Nunca devolve erro cru do CRM.
// Segredos: WHATSAPP_CONEXAO_SEGREDO (= COMANDA_WHATSAPP_SEGREDO do CRM), CRM_WHATSAPP_CONEXAO_URL.
//   supabase functions deploy whatsapp-conexao --project-ref <ref>   (com JWT: quem chama é o usuário logado)
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { criarHandler } from './handler.ts'

Deno.serve(criarHandler({ criarCliente: createClient, env: Deno.env }))
