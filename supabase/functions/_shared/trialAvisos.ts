// E-mails do ciclo de vida do trial (docs/roadmap-admin-e-observabilidade.md, funcionalidade 5).
// Puro: sem Deno nem rede, para testar com `npm test`.

export type EtapaTrial = 'sem_pedido_48h' | 'sem_pedido_7d' | 'faltam_7' | 'faltam_2' | 'fim' | 'retorno'

export type AvisoTrial = {
  usuario_id: string
  email: string
  barraca_nome: string
  barraca_slug: string
  etapa: EtapaTrial
  destino: 'dono' | 'suporte'
  dias_restantes: number
}

// Preço do plano Essencial (o do trial): mesma fonte de src/lib/planos.ts. Se mudar lá, muda aqui.
const PRECO_ESSENCIAL_MENSAL = 'R$ 57,90 por mês'

const BASE_APP = 'https://app.saiae.com.br'

export function linkPlanos(slug: string): string {
  return `${BASE_APP}/${encodeURIComponent(slug)}/planos`
}

export function emailDoDono(a: AvisoTrial): { assunto: string; texto: string } {
  const nome = a.barraca_nome
  const planos = linkPlanos(a.barraca_slug)
  switch (a.etapa) {
    case 'sem_pedido_48h':
      return {
        assunto: `${nome}: monte seu cardápio em 5 minutos`,
        texto: `Oi! Vimos que a ${nome} ainda não recebeu pedidos no Sai aê.\n\nMonte seu cardápio em 5 minutos e já comece a lançar pedidos: ${BASE_APP}/${encodeURIComponent(a.barraca_slug)}/ajustes/cardapio\n\nSe precisar de ajuda, é só responder este e-mail.`,
      }
    case 'faltam_7':
      return {
        assunto: `${nome}: faltam 7 dias do seu teste grátis`,
        texto: `Seu teste grátis do Sai aê termina em ${a.dias_restantes} dias.\n\nPara continuar usando sem interrupção, assine o plano Essencial por ${PRECO_ESSENCIAL_MENSAL}: ${planos}`,
      }
    case 'faltam_2':
      return {
        assunto: `${nome}: faltam 2 dias do seu teste grátis`,
        texto: `Seu teste grátis termina em ${a.dias_restantes <= 1 ? 'menos de 1 dia' : `${a.dias_restantes} dias`}.\n\nDepois disso o acesso é bloqueado até a assinatura (${PRECO_ESSENCIAL_MENSAL}): ${planos}`,
      }
    case 'fim':
      return {
        assunto: `${nome}: seu teste grátis terminou`,
        texto: `Seu teste grátis do Sai aê terminou e o acesso foi bloqueado.\n\nPara voltar a usar, assine o plano Essencial por ${PRECO_ESSENCIAL_MENSAL}: ${planos}\n\nSeus dados continuam guardados.`,
      }
    case 'retorno':
      return {
        assunto: `${nome}: seus dados estão guardados`,
        texto: `Sentimos sua falta! Seu cardápio e seu histórico da ${nome} continuam guardados.\n\nPara voltar de onde parou (${PRECO_ESSENCIAL_MENSAL}): ${planos}`,
      }
    case 'sem_pedido_7d':
      throw new Error('sem_pedido_7d é aviso para o suporte, não para o dono')
  }
}

/** Um único e-mail para o suporte listando quem está há 7+ dias sem nenhum pedido (contato ativo). */
export function emailDoSuporte(avisos: AvisoTrial[]): { assunto: string; texto: string } {
  const linhas = avisos.map((a) => `- ${a.barraca_nome} (${a.email}), ${a.dias_restantes} dias de trial restantes`)
  return {
    assunto: `Sai aê: ${avisos.length} trial${avisos.length === 1 ? '' : 's'} sem nenhum pedido`,
    texto: ['Estes donos têm 7 dias ou mais de cadastro e nenhum pedido. Vale um contato ativo:', '', ...linhas, ''].join('\n'),
  }
}
