export type RegimeTributario = 'simples_nacional' | 'mei'
export type AmbienteFiscal = 'homologacao' | 'producao'
export type LarguraPapel = '58mm' | '80mm'
export type TipoAtendimento = 'mesa' | 'balcao' | 'retirada' | 'entrega'

export type Barraca = {
  id: string
  nome: string
  slug: string
  logo_url: string | null
  modo: 'claro' | 'escuro'
  verde_ate: number
  amarelo_ate: number
  criada_em: string
  metodos_pagamento_ativos: string[]
  taxa_debito_bps: number | null
  taxa_credito_bps: number | null
  fiscal_habilitado: boolean
  fiscal_regime_tributario: RegimeTributario | null
  fiscal_ambiente: AmbienteFiscal
  cnpj: string | null
  impressora_habilitada: boolean
  impressora_endereco: string | null
  impressora_nome: string | null
  impressora_largura_papel: LarguraPapel
  pagamento_online_habilitado: boolean
  imagem_capa_url: string | null
  mostrar_horario_pedido: boolean
  /** Opcional: cache local de antes da migration não tem o campo — usar `modosAtivos()`. */
  modos_atendimento?: TipoAtendimento[]
  /** Opcionais: cache local de antes da migration não tem os campos — usar `configTaxaEntrega()`. */
  taxa_entrega_habilitada?: boolean
  taxa_entrega_centavos?: number
  taxa_entrega_editavel?: boolean
}

/** Cliente final da barraca (cadastro pra pedidos de entrega). */
export type ClienteFinal = {
  id: string
  barraca_id: string
  nome: string
  /** Só dígitos (DDD + número). */
  telefone: string
  rua: string
  numero: string
  bairro: string
  referencia: string | null
  criado_em: string
  atualizado_em: string
}

export type HorarioFuncionamento = {
  id: string
  barraca_id: string
  dia_semana: number
  aberto: boolean
  hora_abertura: string | null
  hora_fechamento: string | null
}

export type Item = {
  id: string
  barraca_id: string
  nome: string
  ativo: boolean
  ordem: number
  preco_centavos: number
  categoria_id: string | null
  foto_url: string | null
  descricao: string | null
  ncm: string | null
  cfop: string | null
  unidade_comercial: string | null
  esgotado: boolean
  popular: boolean
}

export type BannerCardapio = {
  id: string
  barraca_id: string
  imagem_url: string
  titulo: string | null
  cta_texto: string | null
  ordem: number
  ativo: boolean
  criado_em: string
}

export type Categoria = {
  id: string
  barraca_id: string
  nome: string
  ordem: number
  criada_em: string
}

export type CustoDiario = {
  id: string
  barraca_id: string
  data: string
  valor_centavos: number
}

export type StatusCaixa = 'aberto' | 'fechado'

export type Caixa = {
  id: string
  barraca_id: string
  data: string
  status: StatusCaixa
  valor_abertura_centavos: number
  observacao_abertura: string | null
  aberto_em: string
  valor_fechamento_centavos: number | null
  valor_esperado_centavos: number | null
  diferenca_centavos: number | null
  observacao_fechamento: string | null
  fechado_em: string | null
  criado_em: string
}

export type TipoMovimentoCaixa = 'sangria' | 'suprimento'

export type MovimentoCaixa = {
  id: string
  barraca_id: string
  caixa_id: string
  tipo: TipoMovimentoCaixa
  valor_centavos: number
  motivo: string | null
  criado_em: string
}

export type StatusPedido = 'a_fazer' | 'pronto' | 'entregue' | 'cancelado'

export type Pedido = {
  id: string
  barraca_id: string
  senha: number
  data_operacao: string
  mesa: string | null
  /** "Não consome no local": Retirada OU Entrega. */
  viagem: boolean
  /** NULL em pedido antigo / cardápio digital — derivar com `tipoDoPedido()`. */
  tipo_atendimento: TipoAtendimento | null
  /** Dados de entrega (só em pedido de Entrega) e taxa cobrada, em centavos. */
  entrega_nome?: string | null
  entrega_telefone?: string | null
  entrega_rua?: string | null
  entrega_numero?: string | null
  entrega_bairro?: string | null
  entrega_referencia?: string | null
  taxa_entrega_centavos?: number
  cliente_final_id?: string | null
  observacao: string | null
  status: StatusPedido
  criado_em: string
  pronto_em: string | null
  entregue_em: string | null
  client_uuid: string | null
  motivo_cancelamento: string | null
  cancelado_em: string | null
  metodo_pagamento: string | null
  comanda_impressa_em: string | null
  nfce_status: string | null
  nfce_chave: string | null
  nfce_numero: string | null
  nfce_mensagem: string | null
  nfce_emitida_em: string | null
  nfce_serie: string | null
  nfce_protocolo: string | null
  nfce_qrcode_url: string | null
}

export type ItemDoPedido = {
  id: string
  pedido_id: string
  barraca_id: string
  item_id: string | null
  nome_item: string
  quantidade: number
  removido: boolean
  removido_em: string | null
  motivo_remocao: string | null
  entregue: boolean
  entregue_em: string | null
  entrega_direta: boolean
  preco_centavos_unitario: number
  observacao: string | null
}

export type PedidoComItens = Pedido & { itens_do_pedido: ItemDoPedido[] }

export type StatusAssinatura = 'trialing' | 'active' | 'past_due' | 'canceled' | 'expired'
export type PlanoAssinatura = 'essencial' | 'pro'
export type CicloAssinatura = 'mensal' | 'anual'

/** Linha crua de assinaturas — retorno de minha_assinatura() (RPC), pra
 * tela "Minha assinatura". Plan/cycle podem ser null no expired "de
 * nascença" (quem já tinha usado o trial com esse e-mail antes). */
export type Assinatura = {
  usuario_id: string
  status: StatusAssinatura
  plan: PlanoAssinatura | null
  cycle: CicloAssinatura | null
  trial_ends_at: string | null
  current_period_end: string | null
  grace_until: string | null
  kirvano_customer_email: string | null
  kirvano_sale_id: string | null
  kirvano_offer_id: string | null
  stripe_customer_id: string | null
  stripe_subscription_id: string | null
  canceled_at: string | null
  updated_at: string
}

/** Retorno de assinatura_da_barraca(slug) — status da assinatura do DONO
 * da barraca, não do usuário logado (que pode ser um funcionário). */
export type AssinaturaBarraca = {
  status: StatusAssinatura | null
  plano: PlanoAssinatura | null
  ciclo: CicloAssinatura | null
  tem_acesso: boolean
  dias_restantes_trial: number | null
  trial_ends_at: string | null
  current_period_end: string | null
  eh_dono: boolean
}

export type OfertaPublica = {
  plano: PlanoAssinatura
  ciclo: CicloAssinatura
  checkout_url: string
}
