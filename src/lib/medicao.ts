// Medição de anúncios no navegador: Pixel do Meta + GA4, SÓ depois do consentimento ('granted'). Sem consentimento
// nenhum script é inserido e nenhum evento é enviado (nem fila). Compra (Purchase/purchase) NÃO é disparada aqui: sai só
// pelo servidor (webhook da Stripe), para o Meta não contar duas vezes. PURO nas decisões, janela/documento injetados;
// testado em tests/medicao.test.ts.
import { lerConsentimento } from './consentimento.ts'

export const PIXEL_ID = '442066388679102'
export const GA4_ID = 'G-R72CK0Q5DV'
const URL_PIXEL = 'https://connect.facebook.net/en_US/fbevents.js'
const URL_GTAG = `https://www.googletagmanager.com/gtag/js?id=${GA4_ID}`

/** Só nas telas de entrada (cadastro/login/assinatura): o cardápio público e a operação nunca carregam medição. */
const ROTAS_DE_MEDICAO = ['/cadastro', '/login', '/assinar', '/onboarding', '/esqueci-senha']
export function rotaComMedicao(pathname: string): boolean {
  return ROTAS_DE_MEDICAO.some((r) => pathname === r || pathname.startsWith(`${r}/`))
}

type Fn = (...args: unknown[]) => void
export type JanelaMedicao = {
  fbq?: Fn & { queue?: unknown[]; loaded?: boolean }
  gtag?: Fn
  dataLayer?: unknown[]
  [chave: string]: unknown
}
export type DocumentoMedicao = {
  createElement: (tag: 'script') => { src: string; async: boolean }
  head: { appendChild: (el: unknown) => unknown }
}

function inserirScript(doc: DocumentoMedicao, src: string) {
  const el = doc.createElement('script')
  el.async = true
  el.src = src
  doc.head.appendChild(el)
}

/** Carrega GA4 e Pixel (uma vez). Devolve false, sem tocar em nada, se não houver consentimento. */
export function carregarMedicao(
  win: JanelaMedicao,
  doc: DocumentoMedicao,
  storage: Pick<Storage, 'getItem'> = window.localStorage,
): boolean {
  if (lerConsentimento(storage) !== 'granted') return false
  if (win.fbq || win.gtag) return true

  win.dataLayer = win.dataLayer ?? []
  win.gtag = function (...args: unknown[]) {
    win.dataLayer!.push(args)
  }
  win.gtag('js', new Date())
  win.gtag('config', GA4_ID)
  inserirScript(doc, URL_GTAG)

  const fbq = ((...args: unknown[]) => {
    fbq.queue.push(args)
  }) as Fn & { queue: unknown[]; loaded: boolean }
  fbq.queue = []
  fbq.loaded = true
  win.fbq = fbq
  fbq('init', PIXEL_ID)
  fbq('track', 'PageView')
  inserirScript(doc, URL_PIXEL)
  return true
}

/** Conta do teste grátis criada: CompleteRegistration (Meta) + sign_up (GA4). Sem consentimento ou sem carga: nada. */
export function registrarCadastroCompleto(
  win: JanelaMedicao,
  eventId: string,
  storage: Pick<Storage, 'getItem'> = window.localStorage,
): boolean {
  if (lerConsentimento(storage) !== 'granted' || !win.fbq || !win.gtag) return false
  try {
    win.fbq('track', 'CompleteRegistration', {}, { eventID: eventId })
    win.gtag('event', 'sign_up', { method: 'email' })
    return true
  } catch {
    return false
  }
}
