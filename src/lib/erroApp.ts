import { Capacitor } from '@capacitor/core'
import { supabase } from './supabase'
import { deveReportar, textoDoErro, type EstadoLimite } from './erroAppNucleo'

export type TipoErroApp = 'js' | 'sync' | 'impressao' | 'tela_branca'

const estado: EstadoLimite = { enviados: 0, ultimaVez: new Map() }
let barracaId: string | null = null

/** O erro precisa de uma barraca para ser gravado; sem ela (antes do login, por exemplo) é descartado. */
export function definirBarracaDoErro(id: string | null): void {
  barracaId = id
}

export function plataformaDoApp(): 'android' | 'ios' | 'web' {
  const p = Capacitor.getPlatform()
  return p === 'android' || p === 'ios' ? p : 'web'
}

/** Identificação do build (vite.config.ts: VITE_APP_VERSION ou o commit). */
export function versaoDoApp(): string {
  return __APP_VERSION__
}

/** Nunca lança e nunca espera: reportar erro não pode atrapalhar o app. */
export function registrarErroApp(tipo: TipoErroApp, erro: unknown): void {
  try {
    if (!barracaId) return
    const mensagem = textoDoErro(erro)
    if (!deveReportar(estado, `${tipo}:${mensagem}`, Date.now())) return
    void Promise.resolve(
      supabase.rpc('registrar_erro_app', {
        p_barraca_id: barracaId,
        p_tipo: tipo,
        p_mensagem: mensagem,
        p_versao: versaoDoApp(),
        p_plataforma: plataformaDoApp(),
      }),
    ).catch(() => {})
  } catch {
    // reportar é opcional
  }
}

export function registrarVersaoApp(id: string): void {
  try {
    void Promise.resolve(
      supabase.rpc('registrar_versao_app', {
        p_barraca_id: id,
        p_versao: versaoDoApp(),
        p_plataforma: plataformaDoApp(),
      }),
    ).catch(() => {})
  } catch {
    // reportar é opcional
  }
}

/** Erros de JavaScript que ninguém tratou. Chamar uma vez, na abertura do app. */
export function instalarCapturaDeErros(): void {
  window.addEventListener('error', (e) => registrarErroApp('js', e.error ?? e.message))
  window.addEventListener('unhandledrejection', (e) => registrarErroApp('js', e.reason))
}
