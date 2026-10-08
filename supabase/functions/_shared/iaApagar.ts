// Apagar a conversa da IA no CRM (LGPD): contrato docs/contrato/v1/ia-apagar-conversas.md. A Comanda enfileira o pedido
// no próprio banco (ia_apagar_fila) e este módulo envia ao CRM, assinado como o SAI-002, com retentativa. Falha do CRM
// NUNCA impede o apagamento na Comanda: o pedido já está na fila. Funções puras/injetáveis, testadas em
// tests/iaApagar.test.ts. Nada aqui registra telefone, código ou corpo.
import { assinarEvento, urlPermitida } from './eventosSaida.ts'

export type PedidoApagar = { id: string; codigo_loja: string; telefone: string | null }
export type ResultadoEnvioApagar =
  | { ok: true; apagadas: number }
  // `definitivo`: erro de contrato (400); retentar não adianta, o pedido sai da fila.
  | { ok: false; definitivo: boolean; motivo: string }

/** Corpo do contrato: `{codigo_loja}` (loja inteira, exclusão de conta) ou `{codigo_loja, telefone}`. */
export function corpoDoApagar(codigoLoja: string, telefone: string | null): string | null {
  if (!/^[A-Z0-9]{6}$/.test(codigoLoja)) return null
  if (telefone === null) return JSON.stringify({ codigo_loja: codigoLoja })
  if (!/^[0-9]{10,13}$/.test(telefone)) return null
  return JSON.stringify({ codigo_loja: codigoLoja, telefone })
}

export async function enviarApagarAoCrm(
  a: { url: string | undefined; segredo: string | undefined; codigoLoja: string; telefone: string | null; timeoutMs?: number },
  fetchFn: typeof fetch = fetch,
  agoraMs: number = Date.now(),
): Promise<ResultadoEnvioApagar> {
  if (!a.url || !a.segredo) return { ok: false, definitivo: false, motivo: 'não configurado' }
  if (!urlPermitida(a.url)) return { ok: false, definitivo: false, motivo: 'URL do CRM não permitida' }
  const corpo = corpoDoApagar(a.codigoLoja, a.telefone)
  if (!corpo) return { ok: false, definitivo: true, motivo: 'dados inválidos' }
  const timestamp = Math.floor(agoraMs / 1000)
  try {
    const resposta = await fetchFn(a.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Saiae-Timestamp': String(timestamp),
        'X-Saiae-Signature': await assinarEvento(a.segredo, timestamp, corpo),
      },
      body: corpo,
      redirect: 'manual',
      signal: AbortSignal.timeout(a.timeoutMs ?? 8_000),
    })
    if (resposta.status === 200) {
      const j = (await resposta.json().catch(() => null)) as { apagadas?: unknown } | null
      // O CRM é idempotente (n pode ser 0). 200 sem o formato do contrato = não confia: retenta.
      if (j && typeof j.apagadas === 'number' && Number.isInteger(j.apagadas) && j.apagadas >= 0) return { ok: true, apagadas: j.apagadas }
      return { ok: false, definitivo: false, motivo: 'resposta fora do formato' }
    }
    await resposta.body?.cancel()
    return { ok: false, definitivo: resposta.status === 400, motivo: `CRM respondeu ${resposta.status}` }
  } catch {
    return { ok: false, definitivo: false, motivo: 'erro de rede' }
  }
}

/** Uma rodada da fila: pega os vencidos, envia, e tira da fila o que o CRM confirmou (ou recusou em definitivo).
 * Nunca lança: quem chama (cliente-sessao, excluir-conta) segue a vida mesmo se tudo falhar. */
export async function processarFilaApagar(deps: {
  pegar: (limite: number) => Promise<PedidoApagar[]>
  concluir: (id: string) => Promise<void>
  enviar: (p: PedidoApagar) => Promise<ResultadoEnvioApagar>
  limite?: number
}): Promise<{ enviados: number; falhas: number }> {
  let enviados = 0
  let falhas = 0
  try {
    const itens = await deps.pegar(deps.limite ?? 10)
    for (const p of itens) {
      try {
        const r = await deps.enviar(p)
        if (r.ok || r.definitivo) {
          await deps.concluir(p.id)
          if (r.ok) enviados++
          else falhas++
        } else {
          falhas++
        }
      } catch {
        falhas++
      }
    }
  } catch {
    // fila indisponível: o pedido continua na tabela e o job periódico tenta de novo
  }
  return { enviados, falhas }
}
