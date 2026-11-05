import { supabase } from './supabase'
import { bancoSemRecurso } from './semMigration'
import { utmDoCadastro } from './utm'

const chaveFeito = (usuarioId: string) => `saiae:origem-registrada:${usuarioId}`

/**
 * Grava no cadastro (assinaturas) a origem guardada em localStorage. Uma vez por usuário/aparelho; o servidor também só
 * grava a primeira vez. NUNCA lança e nunca atrasa o login: sem UTM, sem rede ou com a migration ainda não aplicada
 * (função inexistente) o cadastro segue igual.
 */
export async function registrarOrigemCadastro(usuarioId: string): Promise<void> {
  try {
    if (window.localStorage.getItem(chaveFeito(usuarioId))) return
    const utm = utmDoCadastro()
    if (!utm) return
    const { error } = await supabase.rpc('registrar_origem_cadastro', {
      p_utm_source: utm.utm_source ?? null,
      p_utm_medium: utm.utm_medium ?? null,
      p_utm_campaign: utm.utm_campaign ?? null,
      p_utm_content: utm.utm_content ?? null,
      p_utm_term: utm.utm_term ?? null,
    })
    if (error) {
      if (!bancoSemRecurso(error)) console.warn('[origem] não gravada', error.message)
      return
    }
    window.localStorage.setItem(chaveFeito(usuarioId), '1')
  } catch {
    // tolerante por desenho
  }
}
