// Disparos de WhatsApp da loja (campanhas "reativar quem sumiu" e "promoção do dia" + avaliação). Chamada pelo app com o
// login: confere o vínculo, o módulo pago whatsapp_disparos vigente e o papel, calcula o público no banco
// e repassa ao CRM (contrato v1: docs/contrato/v1/whatsapp-disparos.md). Enviar e cancelar são só do dono.
// Nunca devolve telefones nem erro cru do CRM ao navegador.
// Segredos: WHATSAPP_CONEXAO_SEGREDO (= COMANDA_WHATSAPP_SEGREDO do CRM); CRM_WHATSAPP_DISPAROS_URL, ou
// CRM_WHATSAPP_CONEXAO_URL (a URL de disparos é derivada trocando o final `whatsapp-conexao` por `whatsapp-disparos`).
//   supabase functions deploy whatsapp-disparos --project-ref <ref>   (com JWT: quem chama é o usuário logado)
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { criarHandler } from './handler.ts'

Deno.serve(criarHandler({ criarCliente: createClient, env: Deno.env }))
