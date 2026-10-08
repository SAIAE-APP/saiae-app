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
  /** Provedor do Pix online ('mercadopago' = padrão; cache antigo sem o campo vale Mercado Pago). */
  pagamento_provedor?: string
  /** Validade do QR do Pix em minutos (35..60; ausente = 35). */
  pix_expiracao_minutos?: number
  /** WhatsApp do dono (só dígitos) e liga/desliga do "Pagar na entrega" no cardápio. */
  whatsapp_pedidos?: string | null
  pagar_na_entrega_habilitado?: boolean
  /** Estoque: true = bloqueia a venda acima do saldo; false/ausente = só avisa (padrão). */
  estoque_bloqueia?: boolean
  /** SAI-010a: a loja usa variações/adicionais no cardápio (padrão false). Ausente em cache antigo. */
  opcoes_habilitado?: boolean
  /** Fuso da barraca (padrão America/Sao_Paulo; só os do Brasil) e interruptor de bloqueio fora do horário. */
  fuso?: string
  bloquear_fora_do_horario?: boolean
  imagem_capa_url: string | null
  mostrar_horario_pedido: boolean
  /** Emitente fiscal e PROCON (cupom da NFC-e). Opcionais: cache local anterior à migration não tem. */
  emitente_razao_social?: string | null
  emitente_inscricao_estadual?: string | null
  emitente_telefone?: string | null
  emitente_endereco?: string | null
  procon_endereco?: string | null
  /** Alíquota aproximada de tributos (Lei 12.741) em pontos-base. */
  tributos_aprox_bps?: number | null
  /** Opcional: cache local de antes da migration não tem o campo — usar `modosAtivos()`. */
  modos_atendimento?: TipoAtendimento[]
  /** Opcionais: cache local de antes da migration não tem os campos — usar `configTaxaEntrega()`. */
  taxa_entrega_habilitada?: boolean
  taxa_entrega_centavos?: number
  taxa_entrega_editavel?: boolean
  /** Aviso "pedido pronto" por WhatsApp: liga/desliga (padrão ligado) e mensagens com {nome} {senha} {barraca}. */
  aviso_pronto_habilitado?: boolean
  msg_pedido_pronto?: string | null
  msg_pedido_pronto_entrega?: string | null
  /** Bairro fora da lista: cobra a taxa padrão ou bloqueia (cache antigo sem o campo = taxa padrão). */
  entrega_bairro_nao_listado?: PoliticaBairroNaoListado
}

/** Cliente final da barraca (cadastro pra pedidos de entrega). */
export type PoliticaBairroNaoListado = 'taxa_padrao' | 'bloquear'

export type TaxaEntregaBairro = {
  id: string
  barraca_id: string
  /** Como o dono digitou. */
  bairro: string
  /** Minúsculo, sem acento (gerado por trigger). */
  bairro_normalizado: string
  valor_centavos: number
  ativo: boolean
  criado_em: string
}

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
  /** Saldo do estoque; NULL = não controla estoque. Opcional: cache/linha antiga não tem. */
  estoque_qtd?: number | null
  /** true quando o `esgotado` foi ligado pelo sistema (saldo <= 0), não pelo dono. */
  estoque_esgotado_auto?: boolean
}

export type MotivoMovimentoEstoque = 'venda' | 'cancelamento' | 'remocao' | 'ajuste'

export type MovimentoEstoque = {
  id: string
  barraca_id: string
  item_id: string
  item_pedido_id: string | null
  pedido_id: string | null
  delta: number
  motivo: MotivoMovimentoEstoque
  saldo_apos: number | null
  observacao: string | null
  criado_em: string
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
  /** Nome do cliente, opcional em qualquer modo (criar_pedido v7). */
  cliente_nome?: string | null
  /** WhatsApp opcional (só dígitos) só pra avisar "pedido pronto" (criar_pedido v8). */
  cliente_telefone?: string | null
  cliente_avisado_em?: string | null
  entrega_nome?: string | null
  entrega_telefone?: string | null
  entrega_rua?: string | null
  entrega_numero?: string | null
  entrega_bairro?: string | null
  entrega_referencia?: string | null
  taxa_entrega_centavos?: number
  /** Link do entregador (/e/:token): só pedido de Entrega novo; NULL nos antigos. */
  entrega_token?: string | null
  entrega_confirmada_em?: string | null
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
  /** Ambiente em que a nota foi emitida; NULL em nota anterior à migration — usar `ambienteDaNota`. */
  nfce_ambiente?: AmbienteFiscal | null
  nfce_cpf_consumidor?: string | null
  nfce_tributos_centavos?: number | null
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
  /** SAI-010a: foto das opções escolhidas ([] em item simples; ausente em cache/consulta antiga). */
  opcoes?: { grupo_nome?: string; tipo?: 'variacao' | 'adicional'; nome: string; preco_centavos?: number }[]
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
  /** `app_config.cobranca_ativa`. false = cobrança desligada (estado neutro active/pro).
   * Ausente em servidor/cache antigo: vale como ativa (`cobrancaAtiva`, src/lib/cobranca.ts). */
  cobranca_ativa?: boolean
}

export type OfertaPublica = {
  plano: PlanoAssinatura
  ciclo: CicloAssinatura
  checkout_url: string
}
