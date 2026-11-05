// Alertas do painel do superadmin por e-mail (docs/roadmap-admin-e-observabilidade.md, funcionalidade 4).
// Puro: sem Deno nem rede, para testar com `npm test`.

export type AlertasSistema = {
  parou: { barraca_id: string; nome: string; ultimo_pedido_em: string }[]
  pico_erros: { versao: string; erros: number }[]
  webhook_falhas: number
}

export type AlertaItem = { chave: string; texto: string }

/** Cada aviso ganha uma chave por dia, para o mesmo problema não gerar e-mail a cada rodada do agendador. */
export function itensDeAlerta(a: AlertasSistema, dia: string): AlertaItem[] {
  return [
    ...a.parou.map((b) => ({
      chave: `parou:${b.barraca_id}:${dia}`,
      texto: `${b.nome} vendia quase todo dia e está há 3 dias sem pedido.`,
    })),
    ...a.pico_erros.map((p) => ({
      chave: `pico:${p.versao}:${dia}`,
      texto: `${p.erros} erros na última hora na versão ${p.versao} do app.`,
    })),
    ...(a.webhook_falhas > 0
      ? [{ chave: `webhook:${dia}`, texto: `${a.webhook_falhas} falhas de webhook de pagamento (Stripe) nas últimas 24 h.` }]
      : []),
  ]
}

export function assuntoDoAlerta(n: number): string {
  return n === 1 ? 'Sai aê: 1 alerta' : `Sai aê: ${n} alertas`
}

export function corpoDoAlerta(itens: AlertaItem[]): string {
  return ['Alertas do painel de administração:', '', ...itens.map((i) => `- ${i.texto}`), ''].join('\n')
}
