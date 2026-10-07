/**
 * Provedores de Pix que o dono pode usar no cardápio digital (cada dono usa a
 * PRÓPRIA conta e cola o token no app; o Sai aê nunca custodia o dinheiro).
 * Espelha as chaves do banco (`barracas.pagamento_provedor`) e dos adaptadores em
 * supabase/functions/_shared/pagamento. Só aparece pro dono o que tem
 * `disponivel: true` (adaptador publicado); os outros entram nas próximas stories.
 */
export type ChaveProvedorPix = 'mercadopago' | 'pagbank' | 'asaas' | 'woovi' | 'abacatepay'

export type ProvedorPixInfo = {
  chave: ChaveProvedorPix
  nome: string
  /** Adaptador implementado e publicado nas functions. */
  disponivel: boolean
  /** Rótulo da credencial no formulário. */
  rotuloToken: string
  /** Explicação curta da conta/credencial. Só o que foi conferido na doc oficial. */
  descricaoConta: string
  /** Onde achar a credencial, no texto da folha de colar o token. */
  ondeAcharToken: string
  /** Segundo dado guardado junto do token (hoje só o Asaas: a chave Pix do dono). */
  campoExtra?: { rotulo: string; ajuda: string }
  /** Custo que o dono deve conhecer antes de escolher, só com o que está na doc oficial. */
  avisoCusto?: string
}

export const PROVEDOR_PIX_PADRAO: ChaveProvedorPix = 'mercadopago'

export const PROVEDORES_PIX: ProvedorPixInfo[] = [
  {
    chave: 'mercadopago',
    nome: 'Mercado Pago',
    disponivel: true,
    rotuloToken: 'Access Token',
    descricaoConta:
      'Crie uma conta no Mercado Pago em nome da sua barraca e cole o Access Token de produção abaixo',
    ondeAcharToken:
      'Gerado no painel de desenvolvedores da sua conta Mercado Pago ("Suas integrações" → credenciais de produção).',
  },
  // Próximas stories (adaptador + instrução conferida na doc oficial de cada um):
  { chave: 'pagbank', nome: 'PagBank', disponivel: false, rotuloToken: 'Token', descricaoConta: '', ondeAcharToken: '' },
  {
    chave: 'asaas',
    nome: 'Asaas',
    disponivel: true,
    rotuloToken: 'Chave de API',
    descricaoConta:
      'Use a sua conta Asaas, com uma chave Pix cadastrada nela. Cole abaixo a chave de API e a chave Pix',
    ondeAcharToken:
      'A chave de API é gerada na sua conta Asaas (confira o caminho na documentação do Asaas).',
    campoExtra: {
      rotulo: 'Chave Pix cadastrada no Asaas',
      ajuda:
        'A chave Pix que recebe os pagamentos na sua conta Asaas. A documentação do Asaas informa a chave no formato UUID (chave aleatória). Na primeira cobrança, o Sai aê cria na sua conta um webhook para ser avisado dos pagamentos.',
    },
    avisoCusto:
      'Confira as tarifas de Pix no Asaas antes de escolher: a página de preços lista R$ 0,99 por Pix recebido nos 3 primeiros meses e R$ 1,99 depois, com franquia mensal de Pix grátis (chave ou QR estático) que pode mudar. Em pedidos pequenos esse valor fixo pesa mais que a taxa percentual do Mercado Pago.',
  },
  { chave: 'woovi', nome: 'Woovi', disponivel: false, rotuloToken: 'AppID', descricaoConta: '', ondeAcharToken: '' },
  { chave: 'abacatepay', nome: 'AbacatePay', disponivel: false, rotuloToken: 'Chave de API', descricaoConta: '', ondeAcharToken: '' },
]

export const PROVEDORES_PIX_DISPONIVEIS = PROVEDORES_PIX.filter((p) => p.disponivel)

/** Provedor da barraca; cache/coluna ausente ou provedor ainda indisponível cai no Mercado Pago. */
export function provedorPixDaBarraca(chave: string | null | undefined): ProvedorPixInfo {
  return (
    PROVEDORES_PIX_DISPONIVEIS.find((p) => p.chave === chave) ??
    PROVEDORES_PIX_DISPONIVEIS.find((p) => p.chave === PROVEDOR_PIX_PADRAO) ??
    PROVEDORES_PIX[0]
  )
}
