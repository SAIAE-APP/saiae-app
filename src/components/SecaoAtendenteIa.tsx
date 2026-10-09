import { useEffect, useState } from 'react'
import { atualizarBarracaCache } from '../hooks/useBarraca'
import { MSG_SEM_INTERNET, useRascunho, useSalvarBarraca } from '../hooks/useSalvarBarraca'
import { supabase } from '../lib/supabase'
import {
  MAX_TEXTO_LIVRE,
  estadoConfirmacaoDono,
  lerPedidoConfirmacao,
  linkWhatsappDaLoja,
  mensagemErroIa,
  validarTextoLivre,
  validarWhatsappDono,
} from '../lib/atendenteIa'
import { formatarTelefoneBR } from '../lib/entrega'
import { BotaoSalvarCampo, ErroSalvar } from './BotaoSalvarCampo'
import { ConsumoIa } from './ConsumoIa'
import { Button } from './ui/Button'
import { Card } from './ui/Card'
import { Icone } from './ui/Icone'
import { Input } from './ui/Input'
import { QrCodeSvg } from './QrCodeSvg'
import { Textarea } from './ui/Textarea'
import { Toggle } from './ui/Toggle'
import type { Barraca } from '../types/database'

const EXEMPLOS =
  'Exemplos: "Aceitamos encomenda de salgados para festa com 2 dias de antecedência." · "Não entregamos aos domingos." · "O pastel de carne é vendido só até as 20h." · "Estacionamento grátis na rua de trás."'

/**
 * Atendente IA do WhatsApp (fase 1, spec 2026-10-08-ia-whatsapp-design.md): o dono liga, diz o que a IA deve saber,
 * informa o WhatsApp para os avisos e pega o link da loja. A IA só LÊ os dados da loja e passa para o dono quando
 * não sabe. Nasce desligada; ligar exige o WhatsApp do dono salvo. Salva por botão explícito. Banco ou app sem as
 * colunas = a seção não aparece.
 */
export function SecaoAtendenteIa({ barraca }: { barraca: Barraca }) {
  const [ligando, setLigando] = useState(false)
  const [erroLigar, setErroLigar] = useState<string | null>(null)
  const [copiado, setCopiado] = useState(false)
  const [pedindo, setPedindo] = useState(false)
  const [avisoConfirmacao, setAvisoConfirmacao] = useState<{ texto: string; ok: boolean } | null>(null)
  const confirmacao = estadoConfirmacaoDono(barraca)
  const aguardando = confirmacao === 'aguardando'
  const barracaId = barraca.id
  const slug = barraca.slug

  // Enquanto espera o dono responder no WhatsApp, relê só as duas colunas da confirmação (a resposta chega pelo CRM).
  useEffect(() => {
    if (!aguardando) return
    const id = window.setInterval(() => {
      void supabase
        .from('barracas')
        .select('ia_whatsapp_dono_confirmado_em, ia_dono_confirmacao_pedida_em')
        .eq('id', barracaId)
        .single()
        .then(({ data }) => {
          if (data) atualizarBarracaCache(slug, data as Partial<Barraca>)
        })
    }, 8000)
    return () => window.clearInterval(id)
  }, [aguardando, barracaId, slug])

  const textoR = useRascunho(barraca.ia_texto_livre ?? '')
  const donoR = useRascunho(barraca.ia_whatsapp_dono ? formatarTelefoneBR(barraca.ia_whatsapp_dono) : '')
  const salvarTexto = useSalvarBarraca(barraca)
  const salvarDono = useSalvarBarraca(barraca)
  const [erroTexto, setErroTexto] = useState<string | null>(null)
  const [erroDono, setErroDono] = useState<string | null>(null)

  // App novo e banco antigo (ou cache de antes da migration): as colunas não existem, então não há o que mostrar.
  if (barraca.ia_habilitada === undefined) return null

  const ligada = barraca.ia_habilitada === true
  const temDono = Boolean(barraca.ia_whatsapp_dono)
  const podeLigar = confirmacao === 'confirmado'
  const link = linkWhatsappDaLoja(import.meta.env.VITE_WHATSAPP_NUMERO_SAIAE as string | undefined, barraca.ia_codigo)

  async function alternar(valor: boolean) {
    setErroLigar(null)
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      setErroLigar(MSG_SEM_INTERNET)
      return
    }
    setLigando(true)
    const { data, error } = await supabase.rpc('ia_ligar', { p_barraca_id: barraca.id, p_habilitada: valor })
    setLigando(false)
    if (error) {
      setErroLigar(mensagemErroIa(error))
      return
    }
    const r = data as { ia_habilitada?: boolean; ia_codigo?: string | null } | null
    atualizarBarracaCache(barraca.slug, { ia_habilitada: r?.ia_habilitada === true, ia_codigo: r?.ia_codigo ?? null })
  }

  async function pedirConfirmacao() {
    setAvisoConfirmacao(null)
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      setAvisoConfirmacao({ texto: MSG_SEM_INTERNET, ok: false })
      return
    }
    setPedindo(true)
    const { data, error } = await supabase.functions.invoke('ia-dono-pedir-confirmacao', { body: { barraca_id: barraca.id } })
    setPedindo(false)
    const r = error ? { enviado: false, texto: 'Não foi possível enviar a confirmação agora. Tente de novo em instantes.' } : lerPedidoConfirmacao(data)
    setAvisoConfirmacao({ texto: r.texto, ok: r.enviado })
    if (r.enviado) atualizarBarracaCache(barraca.slug, { ia_dono_confirmacao_pedida_em: new Date().toISOString() })
  }

  async function aoSalvarTexto() {
    const v = validarTextoLivre(textoR.valor)
    if (!v.ok) {
      setErroTexto(v.motivo)
      return
    }
    setErroTexto(null)
    if (await salvarTexto.salvar({ ia_texto_livre: v.texto })) textoR.descartar()
  }

  async function aoSalvarDono() {
    const v = validarWhatsappDono(donoR.valor)
    if (!v.ok) {
      setErroDono(v.motivo)
      return
    }
    setErroDono(null)
    if (await salvarDono.salvar({ ia_whatsapp_dono: v.digitos })) donoR.descartar()
  }

  async function copiar() {
    if (!link) return
    try {
      await navigator.clipboard.writeText(link)
      setCopiado(true)
      window.setTimeout(() => setCopiado(false), 2500)
    } catch {
      setCopiado(false)
    }
  }

  return (
    <section>
      <h2 className="mb-3 flex items-center gap-1.5 font-mesa-sans text-xs font-semibold uppercase tracking-wider text-mesa-text-secondary">
        <Icone nome="chat" size={14} />
        Atendente IA
      </h2>
      <Card>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-base text-mesa-text-primary">Atendente automática no WhatsApp</p>
            <p className="mt-1 text-sm text-mesa-text-secondary">
              {ligada
                ? 'Ligada: o cliente que entrar pelo link da sua loja tira dúvidas (cardápio, preços, horário, entrega) e é levado ao cardápio para pedir.'
                : 'Desligada. Ao ligar, uma assistente automática responde dúvidas dos clientes. Ela só lê os dados da loja: nunca cria pedido nem muda preço, e chama você quando não sabe ou o assunto é sensível.'}
            </p>
            {!ligada && !podeLigar && (
              <p className="mt-1 text-xs text-mesa-text-tertiary">
                {temDono ? 'Para ligar, confirme antes o WhatsApp do dono, abaixo.' : 'Para ligar, salve e confirme antes o WhatsApp do dono, abaixo.'}
              </p>
            )}
          </div>
          <Toggle
            checked={ligada}
            onChange={(v) => void alternar(v)}
            disabled={ligando || (!ligada && !podeLigar)}
            aria-label="Ligar a atendente automática no WhatsApp"
          />
        </div>
        <ErroSalvar erro={erroLigar} className="mt-2" />

        <div className="mt-5 flex flex-col gap-2">
          <Input
            label="WhatsApp do dono (para os avisos)"
            inputMode="tel"
            autoComplete="off"
            value={donoR.valor}
            onChange={(e) => donoR.definir(e.target.value)}
            error={erroDono ?? undefined}
            helpText="Quando a IA precisar de você (reclamação, dúvida que ela não sabe), o aviso chega neste número."
          />
          <BotaoSalvarCampo
            alterado={donoR.alterado}
            salvando={salvarDono.salvando}
            salvo={salvarDono.salvo}
            erro={salvarDono.erro}
            onSalvar={() => void aoSalvarDono()}
          />
          {temDono && confirmacao !== 'sem_numero' && !donoR.alterado && (
            <div className="flex flex-col items-start gap-2" aria-live="polite">
              {confirmacao === 'confirmado' ? (
                <p className="flex items-center gap-1.5 text-sm text-mesa-text-primary">
                  <Icone nome="check_circle" size={16} className="text-mesa-success-500" />
                  WhatsApp confirmado
                </p>
              ) : (
                <>
                  <p className="text-sm text-mesa-text-secondary">
                    {aguardando
                      ? 'Aguardando confirmação: abra o WhatsApp deste número e responda CONFIRMAR à mensagem do Sai aê.'
                      : 'Este número ainda não foi confirmado. A IA só liga depois que o dono do número responder CONFIRMAR.'}
                  </p>
                  <Button variant="outline" size="md" loading={pedindo} onClick={() => void pedirConfirmacao()}>
                    {aguardando ? 'Enviar de novo' : 'Enviar confirmação'}
                  </Button>
                </>
              )}
              {avisoConfirmacao && (
                <p role="status" className={`text-xs ${avisoConfirmacao.ok ? 'text-mesa-text-secondary' : 'text-mesa-error-500'}`}>
                  {avisoConfirmacao.texto}
                </p>
              )}
            </div>
          )}
        </div>

        <div className="mt-5 flex flex-col gap-2">
          <Textarea
            label="O que a IA deve saber"
            value={textoR.valor}
            maxLength={MAX_TEXTO_LIVRE}
            onChange={(e) => textoR.definir(e.target.value)}
            error={erroTexto ?? undefined}
            helpText={EXEMPLOS}
            placeholder="Informações que não estão no cardápio: encomendas, prazos, regras da casa…"
          />
          <p className="text-xs text-mesa-text-tertiary">
            {textoR.valor.length} / {MAX_TEXTO_LIVRE}. A IA usa este texto como informação, nunca como ordem. Se algo não estiver
            aqui nem no cardápio, ela avisa que vai confirmar e chama você.
          </p>
          <BotaoSalvarCampo
            alterado={textoR.alterado}
            salvando={salvarTexto.salvando}
            salvo={salvarTexto.salvo}
            erro={salvarTexto.erro}
            onSalvar={() => void aoSalvarTexto()}
          />
        </div>

        {barraca.ia_codigo && (
          <div className="mt-5">
            <p className="text-sm font-semibold text-mesa-text-primary">Uso da atendente</p>
            <ConsumoIa barracaId={barraca.id} />
          </div>
        )}

        <div className="mt-5">
          <p className="text-sm font-semibold text-mesa-text-primary">Link da sua loja no WhatsApp</p>
          {barraca.ia_codigo ? (
            link ? (
              <>
                <p className="mt-1 break-all rounded-mesa-md bg-mesa-neutral-100 p-3 text-xs text-mesa-text-secondary dark:bg-mesa-neutral-800">{link}</p>
                <Button variant="outline" size="md" className="mt-2" icon={<Icone nome="content_copy" size={16} />} onClick={() => void copiar()}>
                  {copiado ? 'Link copiado' : 'Copiar link'}
                </Button>
                <div className="mt-3 flex flex-col items-start gap-1">
                  <QrCodeSvg texto={link} rotulo="QR code do link da sua loja no WhatsApp" />
                  <p className="text-xs text-mesa-text-tertiary">QR code do mesmo link: imprima no cartaz ou na mesa.</p>
                </div>
                <p className="mt-2 text-xs text-mesa-text-tertiary">
                  Código da loja: {barraca.ia_codigo}. Ponha o link na bio, no cartaz ou no cardápio. {ligada ? '' : 'Só responde com a IA ligada.'}
                </p>
              </>
            ) : (
              <p className="mt-1 text-sm text-mesa-text-secondary">Link indisponível ainda. Assim que o número do Sai aê for configurado, ele aparece aqui.</p>
            )
          ) : (
            <p className="mt-1 text-sm text-mesa-text-secondary">O link é gerado quando você liga a atendente pela primeira vez.</p>
          )}
        </div>
      </Card>
    </section>
  )
}
