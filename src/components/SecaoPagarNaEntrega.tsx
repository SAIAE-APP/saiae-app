import { useState } from 'react'
import { useRascunho, useSalvarBarraca } from '../hooks/useSalvarBarraca'
import { formatarTelefoneBR } from '../lib/entrega'
import { BotaoSalvarCampo, ErroSalvar } from './BotaoSalvarCampo'
import { Card } from './ui/Card'
import { Icone } from './ui/Icone'
import { Input } from './ui/Input'
import { Toggle } from './ui/Toggle'
import type { Barraca } from '../types/database'

/**
 * "Pagar na entrega" no cardápio digital: o cliente monta o pedido, ele cai na
 * Cozinha na hora e o celular dele abre o WhatsApp do dono com o resumo. O
 * número é só dígitos (DDD + número) e a opção só aparece pro cliente se o
 * número estiver salvo E o toggle ligado.
 */
export function SecaoPagarNaEntrega({ barraca }: { barraca: Barraca }) {
  const numeroR = useRascunho(barraca.whatsapp_pedidos ?? '', (a, b) => a.replace(/\D/g, '') === b.replace(/\D/g, ''))
  const habilitadoR = useRascunho(Boolean(barraca.pagar_na_entrega_habilitado))
  const [aviso, setAviso] = useState<string | null>(null)
  const toggle = useSalvarBarraca(barraca)
  const numeroSalvador = useSalvarBarraca(barraca)

  const numeroSalvo = (barraca.whatsapp_pedidos ?? '').length > 0

  async function alternarHabilitado(valor: boolean) {
    if (valor && !numeroSalvo) {
      setAviso('Salve o número do WhatsApp antes de ligar.')
      return
    }
    setAviso(null)
    habilitadoR.definir(valor)
    await toggle.salvar({ pagar_na_entrega_habilitado: valor })
    habilitadoR.descartar()
  }

  async function salvarNumero() {
    const digitos = numeroR.valor.replace(/\D/g, '')
    if (digitos && (digitos.length < 10 || digitos.length > 13)) {
      setAviso('Informe o número com DDD, ex.: (11) 91234-5678.')
      return
    }
    setAviso(null)
    // Número em branco desliga a opção junto (não faz sentido ligada sem número).
    const ok = await numeroSalvador.salvar({
      whatsapp_pedidos: digitos || null,
      ...(digitos ? {} : { pagar_na_entrega_habilitado: false }),
    })
    if (ok) numeroR.descartar()
  }

  return (
    <section>
      <h2 className="mb-3 flex items-center gap-1.5 font-mesa-sans text-xs font-semibold uppercase tracking-wider text-mesa-text-secondary">
        <Icone nome="chat" size={14} />
        Pagar na entrega (cardápio digital)
      </h2>
      <Card>
        <p className="text-sm text-mesa-text-secondary">
          O cliente monta o pedido no cardápio, ele cai na Cozinha na hora e o WhatsApp dele abre com
          o resumo pra você. O pagamento é combinado na entrega.
        </p>

        <div className="mt-4">
          <Input
            label="WhatsApp que recebe os pedidos"
            type="text"
            inputMode="tel"
            autoComplete="off"
            placeholder="(11) 91234-5678"
            value={numeroR.valor}
            onChange={(e) => numeroR.definir(e.target.value)}
            helpText={
              barraca.whatsapp_pedidos
                ? `Número salvo: ${formatarTelefoneBR(barraca.whatsapp_pedidos)}`
                : 'Nenhum número salvo'
            }
          />
          <BotaoSalvarCampo
            alterado={numeroR.alterado}
            salvando={numeroSalvador.salvando}
            salvo={numeroSalvador.salvo}
            erro={numeroSalvador.erro}
            onSalvar={salvarNumero}
            rotulo="Salvar número"
            className="mt-3"
          />
        </div>

        <label
          htmlFor="pagar-na-entrega-habilitado"
          className="mt-4 flex min-h-11 cursor-pointer items-center justify-between gap-3 border-t border-mesa-border-subtle pt-3"
        >
          <span className="min-w-0">
            <span className="block text-base text-mesa-text-primary">Oferecer "Pagar na entrega"</span>
            <span className="block text-xs text-mesa-text-secondary">
              Aparece no checkout do cardápio digital
            </span>
          </span>
          <Toggle
            id="pagar-na-entrega-habilitado"
            checked={habilitadoR.valor}
            onChange={alternarHabilitado}
            aria-label="Oferecer pagar na entrega no cardápio digital"
          />
        </label>
        {aviso && <p className="mt-2 text-sm font-medium text-mesa-warning-700">{aviso}</p>}
        <ErroSalvar erro={toggle.erro} className="mt-2" />
      </Card>
    </section>
  )
}
