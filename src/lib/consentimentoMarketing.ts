import { supabase } from './supabase'
import { bancoSemRecurso } from './semMigration'
import { lerConsentimento } from './consentimento'
import { gaClientIdDoCookie, lerCookie } from './cookiesMedicao'

/**
 * Grava no cadastro (assinaturas) se a pessoa aceitou os cookies de medição e, só nesse caso, os identificadores do
 * navegador (_fbp, _fbc, _ga). O webhook da Stripe só envia o Purchase à Meta/GA4 quando isto estiver true.
 * Roda a cada login (o aceite pode mudar). NUNCA lança nem atrasa o login; migration ausente = ignora.
 */
export async function registrarConsentimentoMarketing(): Promise<void> {
  try {
    const aceitou = lerConsentimento() === 'granted'
    const cookies = aceitou ? document.cookie : ''
    const { error } = await supabase.rpc('registrar_consentimento_marketing', {
      p_consentimento: aceitou,
      p_fbp: lerCookie(cookies, '_fbp'),
      p_fbc: lerCookie(cookies, '_fbc'),
      p_ga_client_id: gaClientIdDoCookie(lerCookie(cookies, '_ga')),
    })
    if (error && !bancoSemRecurso(error)) console.warn('[marketing] consentimento não gravado', error.message)
  } catch {
    // tolerante por desenho
  }
}
