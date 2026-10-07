import { useState } from 'react'
import { usePedidosAtual } from '../layouts/contextoPedidos'
import { enfileirar } from '../lib/fila'
import {
  modeloMensagemPronto,
  montarMensagemPronto,
  telefoneDoCliente,
  urlWhatsappCliente,
} from '../lib/avisoPronto'
import { nomeDoCliente, tipoDoPedido } from '../lib/atendimento'
import type { Barraca, Pedido } from '../types/database'
import { Icone } from './ui/Icone'

function formatarHora(iso: string): string {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

/**
 * "Avisar cliente" quando o pedido fica pronto: abre o WhatsApp do aparelho com
 * a mensagem da barraca (sem API, sem envio automático: o operador toca em
 * enviar). Só aparece com telefone no pedido e o aviso ligado em Ajustes. Depois
 * do toque grava `cliente_avisado_em` pela fila (best-effort: nunca bloqueia o
 * clique nem a operação) e mostra "Avisado às HH:MM" — dá pra avisar de novo.
 */
export function BotaoAvisarCliente({
  pedido,
  barraca,
  compacto = false,
}: {
  pedido: Pedido
  barraca: Barraca
  compacto?: boolean
}) {
  const { aplicarPatchPedido } = usePedidosAtual()
  const [avisadoLocal, setAvisadoLocal] = useState<string | null>(null)
  const [aviso, setAviso] = useState(false)
  const [copiado, setCopiado] = useState(false)

  const telefone = telefoneDoCliente(pedido)
  if (barraca.aviso_pronto_habilitado === false || !telefone || pedido.status !== 'pronto') return null

  const avisadoEm = avisadoLocal ?? pedido.cliente_avisado_em ?? null
  const mensagem = () =>
    montarMensagemPronto(modeloMensagemPronto(barraca, tipoDoPedido(pedido) === 'entrega'), {
      nome: nomeDoCliente(pedido),
      senha: pedido.senha,
      barraca: barraca.nome,
    })

  function registrarAviso() {
    const agora = new Date().toISOString()
    setAvisadoLocal(agora)
    aplicarPatchPedido(pedido.id, { cliente_avisado_em: agora })
    // Best-effort: se a coluna/rede falhar, só o "Avisado às" não persiste.
    enfileirar('mudar_status', { pedido_id: pedido.id, cliente_avisado_em: agora }).catch(() => {})
  }

  function avisar() {
    setAviso(false)
    window.open(urlWhatsappCliente(telefone as string, mensagem()), '_blank', 'noopener')
    window.setTimeout(() => {
      if (!document.hidden) setAviso(true)
    }, 1500)
    registrarAviso()
  }

  async function copiar() {
    try {
      await navigator.clipboard.writeText(mensagem())
      setCopiado(true)
      window.setTimeout(() => setCopiado(false), 2500)
    } catch {
      setAviso(true)
    }
  }

  return (
    <div className={compacto ? 'mt-3 flex flex-col gap-1' : 'mt-2 flex flex-col gap-1'}>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={avisar}
          className="flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-mesa-btn border-2 border-mesa-border-subtle px-3 text-sm font-semibold text-mesa-text-primary outline-none"
        >
          <Icone nome="chat" size={16} />
          {avisadoEm ? 'Avisar de novo' : 'Avisar cliente'}
        </button>
        <button
          type="button"
          onClick={() => void copiar()}
          aria-label="Copiar mensagem de aviso"
          className="flex min-h-11 min-w-11 items-center justify-center text-mesa-text-secondary"
        >
          <Icone nome={copiado ? 'check' : 'content_copy'} size={16} />
        </button>
      </div>
      {avisadoEm && (
        <p className="text-center text-xs font-medium text-mesa-success-700 dark:text-mesa-success-500">
          Avisado às {formatarHora(avisadoEm)}
        </p>
      )}
      {aviso && (
        <p
          role="alert"
          className="rounded-mesa-md border-l-[3px] border-mesa-warning-500 bg-mesa-warning-50 p-3 text-left text-sm font-medium text-mesa-warning-700 dark:bg-mesa-warning-500/15"
        >
          O WhatsApp não abriu. Confira se ele está instalado neste aparelho ou copie a mensagem.
        </p>
      )}
    </div>
  )
}
