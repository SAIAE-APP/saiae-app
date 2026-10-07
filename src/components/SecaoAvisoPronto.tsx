import { useRascunho, useSalvarBarraca } from '../hooks/useSalvarBarraca'
import {
  MSG_PRONTO_ENTREGA_PADRAO,
  MSG_PRONTO_PADRAO,
  VARIAVEIS_MSG_PRONTO,
  montarMensagemPronto,
} from '../lib/avisoPronto'
import { BotaoSalvarCampo, ErroSalvar } from './BotaoSalvarCampo'
import { Card } from './ui/Card'
import { Icone } from './ui/Icone'
import { Textarea } from './ui/Textarea'
import { Toggle } from './ui/Toggle'
import type { Barraca } from '../types/database'

function Previa({ modelo, barraca }: { modelo: string; barraca: Barraca }) {
  const texto = montarMensagemPronto(modelo, { nome: 'Maria', senha: 42, barraca: barraca.nome })
  return (
    <p className="mt-2 rounded-mesa-md bg-mesa-neutral-100 p-3 text-sm text-mesa-text-secondary dark:bg-mesa-neutral-800">
      <span className="block text-xs font-semibold uppercase tracking-wider text-mesa-text-tertiary">Prévia</span>
      {texto || 'Mensagem vazia: vale a mensagem padrão.'}
    </p>
  )
}

/**
 * Botão "Avisar cliente" (pedido pronto, WhatsApp): liga/desliga e as duas
 * mensagens da barraca. Variáveis {nome} {senha} {barraca}; campo em branco =
 * mensagem padrão. Mensagens salvam pelo botão, o liga/desliga na hora.
 */
export function SecaoAvisoPronto({ barraca }: { barraca: Barraca }) {
  const habilitadoR = useRascunho(barraca.aviso_pronto_habilitado ?? true)
  const retiradaR = useRascunho(barraca.msg_pedido_pronto ?? '')
  const entregaR = useRascunho(barraca.msg_pedido_pronto_entrega ?? '')
  const toggle = useSalvarBarraca(barraca)
  const mensagens = useSalvarBarraca(barraca)

  async function alternar(valor: boolean) {
    habilitadoR.definir(valor)
    await toggle.salvar({ aviso_pronto_habilitado: valor })
    habilitadoR.descartar()
  }

  async function salvarMensagens() {
    const ok = await mensagens.salvar({
      msg_pedido_pronto: retiradaR.valor.trim() || null,
      msg_pedido_pronto_entrega: entregaR.valor.trim() || null,
    })
    if (ok) {
      retiradaR.descartar()
      entregaR.descartar()
    }
  }

  return (
    <section>
      <h2 className="mb-3 flex items-center gap-1.5 font-mesa-sans text-xs font-semibold uppercase tracking-wider text-mesa-text-secondary">
        <Icone nome="chat" size={14} />
        Avisar cliente (pedido pronto)
      </h2>
      <Card>
        <p className="text-sm text-mesa-text-secondary">
          Quando o cliente informa o WhatsApp, o card do pedido pronto ganha o botão "Avisar cliente": ele
          abre o WhatsApp com a mensagem abaixo e você só toca em enviar. O número serve apenas para esse
          aviso.
        </p>

        <label
          htmlFor="aviso-pronto-habilitado"
          className="mt-4 flex min-h-11 cursor-pointer items-center justify-between gap-3"
        >
          <span className="text-base text-mesa-text-primary">Mostrar o botão "Avisar cliente"</span>
          <Toggle
            id="aviso-pronto-habilitado"
            checked={habilitadoR.valor}
            onChange={alternar}
            aria-label="Mostrar o botão Avisar cliente"
          />
        </label>
        <ErroSalvar erro={toggle.erro} className="mt-1" />

        <div className="mt-4 border-t border-mesa-border-subtle pt-4">
          <p className="text-xs text-mesa-text-tertiary">
            Variáveis: {VARIAVEIS_MSG_PRONTO.join('  ')}. Sem nome informado, o "{'{nome}'}" some da frase.
          </p>

          <p className="mt-3 text-sm font-medium text-mesa-text-primary">Mesa, Balcão e Retirada</p>
          <Textarea
            value={retiradaR.valor}
            onChange={(e) => retiradaR.definir(e.target.value)}
            rows={3}
            maxLength={300}
            placeholder={MSG_PRONTO_PADRAO}
            aria-label="Mensagem de pedido pronto (retirada, balcão e mesa)"
            className="mt-1"
          />
          <Previa modelo={retiradaR.valor.trim() || MSG_PRONTO_PADRAO} barraca={barraca} />

          <p className="mt-4 text-sm font-medium text-mesa-text-primary">Entrega</p>
          <Textarea
            value={entregaR.valor}
            onChange={(e) => entregaR.definir(e.target.value)}
            rows={3}
            maxLength={300}
            placeholder={MSG_PRONTO_ENTREGA_PADRAO}
            aria-label="Mensagem de pedido pronto (entrega)"
            className="mt-1"
          />
          <Previa modelo={entregaR.valor.trim() || MSG_PRONTO_ENTREGA_PADRAO} barraca={barraca} />

          <BotaoSalvarCampo
            alterado={retiradaR.alterado || entregaR.alterado}
            salvando={mensagens.salvando}
            salvo={mensagens.salvo}
            erro={mensagens.erro}
            onSalvar={() => void salvarMensagens()}
            rotulo="Salvar mensagens"
            className="mt-4"
          />
        </div>
      </Card>
    </section>
  )
}
