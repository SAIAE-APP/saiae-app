// Estado da tela "WhatsApp e Automação" a partir da resposta do proxy `whatsapp-conexao` (Task 4).
export type AvisoHistorico = {
  pedido_id: string
  tipo: 'recebido' | 'pronto' | 'saiu_entrega' | 'entregue' | 'cancelado'
  estado: 'pendente' | 'enviado' | 'falhou' | 'pulado_sem_telefone' | 'pulado_optout' | 'pulado_desconectado' | 'pulado_nao_aplica'
  motivo: string | null
  em: string
}
export type RespostaConexao = {
  estado: 'sem_sessao' | 'aguardando_qr' | 'conectado' | 'desconectado'
  qr: string | null
  numero: string | null
  avisos: AvisoHistorico[]
}
export type TelaConexao = {
  tipo: 'carregando' | 'erro' | 'sem_sessao' | 'qr' | 'conectado' | 'desconectado'
  qr?: string
  numeroMascarado?: string
}

/** `5561999990001` → `(61) 9••••-0001`: o número completo nunca vai para a tela. */
export function mascararNumero(digitos: string): string {
  const d = digitos.replace(/\D/g, '')
  const nacional = d.length > 11 && d.startsWith('55') ? d.slice(2) : d
  if (nacional.length < 10) return '••••'
  const ddd = nacional.slice(0, 2)
  const primeiro = nacional.length === 11 ? nacional[2] : ''
  return `(${ddd}) ${primeiro}••••-${nacional.slice(-4)}`
}

export function telaDaConexao(r: RespostaConexao | null, erro: boolean): TelaConexao {
  if (erro) return { tipo: 'erro' }
  if (!r) return { tipo: 'carregando' }
  switch (r.estado) {
    case 'aguardando_qr':
      // QR ainda não gerado: tratado como sem sessão para a tela nunca mostrar um QR vazio.
      return r.qr ? { tipo: 'qr', qr: r.qr } : { tipo: 'sem_sessao' }
    case 'conectado':
      return { tipo: 'conectado', numeroMascarado: r.numero ? mascararNumero(r.numero) : undefined }
    case 'desconectado':
      return { tipo: 'desconectado' }
    default:
      return { tipo: 'sem_sessao' }
  }
}

/** Só a ação `historico` devolve os avisos (contrato §2); os outros estados precisam apenas do status. */
export function acaoDoPoll(estado: RespostaConexao['estado'] | undefined): 'status' | 'historico' {
  return estado === 'conectado' ? 'historico' : 'status'
}
