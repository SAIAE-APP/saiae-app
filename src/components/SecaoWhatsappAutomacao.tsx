import { useState } from 'react'
import { mensagemErroSalvar, useRascunho } from '../hooks/useSalvarBarraca'
import { atualizarBarracaCache } from '../hooks/useBarraca'
import { useWhatsappConexao } from '../hooks/useWhatsappConexao'
import { supabase } from '../lib/supabase'
import {
  AVISO_TIPOS,
  MAX_TEXTO_AVISO,
  normalizarAvisos,
  textoDoAviso,
  type AvisoTipo,
  type AvisosConfig,
} from '../lib/avisosWhatsapp'
import type { AvisoHistorico } from '../lib/estadoWhatsapp'
import { BotaoSalvarCampo, ErroSalvar } from './BotaoSalvarCampo'
import { QrCodeSvg } from './QrCodeSvg'
import { Button } from './ui/Button'
import { Card } from './ui/Card'
import { Icone } from './ui/Icone'
import { Textarea } from './ui/Textarea'
import { Toggle } from './ui/Toggle'
import type { Barraca } from '../types/database'

const ROTULOS: Record<AvisoTipo, string> = {
  recebido: 'Pedido recebido',
  pronto: 'Pedido pronto',
  saiu_entrega: 'Saiu para entrega',
  entregue: 'Pedido entregue',
  cancelado: 'Pedido cancelado',
}

const ESTADOS_AVISO: Record<AvisoHistorico['estado'], string> = {
  pendente: 'Na fila',
  enviado: 'Enviado',
  falhou: 'Falhou',
  pulado_sem_telefone: 'Sem telefone',
  pulado_optout: 'Cliente pediu para sair',
  pulado_desconectado: 'WhatsApp desconectado',
}

const iguaisAvisos = (a: AvisosConfig, b: AvisosConfig) => JSON.stringify(a) === JSON.stringify(b)

function EditorAvisos({ barraca }: { barraca: Barraca }) {
  const servidor = normalizarAvisos(barraca.whatsapp_avisos)
  const rascunho = useRascunho<AvisosConfig>(servidor, iguaisAvisos)
  const [salvando, setSalvando] = useState(false)
  const [salvo, setSalvo] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  function mudar(tipo: AvisoTipo, parte: Partial<AvisosConfig[AvisoTipo]>) {
    setSalvo(false)
    rascunho.definir({ ...rascunho.valor, [tipo]: { ...rascunho.valor[tipo], ...parte } })
  }

  async function salvar() {
    setErro(null)
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      setErro('Sem internet. Não foi salvo.')
      return
    }
    setSalvando(true)
    try {
      const { data, error } = await supabase.rpc('whatsapp_avisos_salvar', {
        p_barraca_id: barraca.id,
        p_avisos: rascunho.valor,
      })
      if (error) throw error
      const estado = (data as { estado?: string } | null)?.estado
      if (estado !== 'ok') {
        setErro(
          estado === 'dados_invalidos'
            ? 'Não foi possível salvar: confira os textos (até 500 caracteres cada).'
            : 'Não foi possível salvar: sem permissão para alterar esta barraca.',
        )
        return
      }
      atualizarBarracaCache(barraca.slug, { whatsapp_avisos: rascunho.valor })
      rascunho.descartar()
      setSalvo(true)
    } catch (e) {
      setErro(mensagemErroSalvar(e as { message?: string }))
    } finally {
      setSalvando(false)
    }
  }

  return (
    <div className="mt-4 border-t border-mesa-border-subtle pt-4">
      <p className="text-sm font-medium text-mesa-text-primary">Avisos para o cliente</p>
      <p className="text-xs text-mesa-text-tertiary">
        Variáveis: {'{nome}'} {'{senha}'} {'{barraca}'}. Campo em branco = mensagem padrão.
      </p>
      {AVISO_TIPOS.map((tipo) => {
        const c = rascunho.valor[tipo]
        const previa = textoDoAviso(tipo, rascunho.valor, { nome: 'Maria', senha: 42, barraca: barraca.nome })
        return (
          <div key={tipo} className="mt-4">
            <label htmlFor={`aviso-${tipo}`} className="flex min-h-11 cursor-pointer items-center justify-between gap-3">
              <span className="text-base text-mesa-text-primary">{ROTULOS[tipo]}</span>
              <Toggle
                id={`aviso-${tipo}`}
                checked={c.ativo}
                onChange={(v) => mudar(tipo, { ativo: v })}
                aria-label={`Enviar aviso: ${ROTULOS[tipo]}`}
              />
            </label>
            <Textarea
              value={c.texto ?? ''}
              onChange={(e) => mudar(tipo, { texto: e.target.value || null })}
              rows={2}
              maxLength={MAX_TEXTO_AVISO}
              disabled={!c.ativo}
              aria-label={`Texto do aviso: ${ROTULOS[tipo]}`}
            />
            <p className="mt-1 rounded-mesa-md bg-mesa-neutral-100 p-3 text-sm text-mesa-text-secondary dark:bg-mesa-neutral-800">
              <span className="block text-xs font-semibold uppercase tracking-wider text-mesa-text-tertiary">Prévia</span>
              {previa}
            </p>
          </div>
        )
      })}
      <BotaoSalvarCampo
        alterado={rascunho.alterado}
        salvando={salvando}
        salvo={salvo}
        erro={erro}
        onSalvar={() => void salvar()}
        rotulo="Salvar avisos"
        className="mt-4"
      />
    </div>
  )
}

/**
 * Aba "WhatsApp e Automação": conectar o WhatsApp da loja por QR Code, configurar os cinco avisos de status
 * e ver o histórico. O envio é feito pelo CRM; aqui só se conecta e se configura.
 */
export function SecaoWhatsappAutomacao({ barraca }: { barraca: Barraca }) {
  const { tela, avisos, iniciar, desconectar, recarregar } = useWhatsappConexao(barraca.id)
  const [ocupado, setOcupado] = useState(false)

  async function agir(acao: () => Promise<void>) {
    setOcupado(true)
    try {
      await acao()
    } finally {
      setOcupado(false)
    }
  }

  return (
    <section>
      <h2 className="mb-3 flex items-center gap-1.5 font-mesa-sans text-xs font-semibold uppercase tracking-wider text-mesa-text-secondary">
        <Icone nome="chat" size={14} />
        WhatsApp e Automação
      </h2>
      <Card>
        {tela.tipo === 'carregando' && <p className="text-sm text-mesa-text-secondary">Carregando…</p>}

        {tela.tipo === 'erro' && (
          <>
            <ErroSalvar erro="Não foi possível falar com o WhatsApp agora." />
            <Button variant="outline" size="md" className="mt-3" onClick={recarregar}>
              Tentar de novo
            </Button>
          </>
        )}

        {(tela.tipo === 'sem_sessao' || tela.tipo === 'desconectado') && (
          <>
            <p className="text-sm text-mesa-text-secondary">
              {tela.tipo === 'desconectado'
                ? 'O WhatsApp da loja está desconectado. Os avisos automáticos estão parados.'
                : 'Conecte o WhatsApp da loja para avisar os clientes sobre o pedido.'}
            </p>
            <p className="mt-2 text-xs text-mesa-text-tertiary">
              A conexão usa o WhatsApp comum, sem a API oficial. Evite mandar muitas mensagens iguais seguidas: o
              WhatsApp pode bloquear o número se desconfiar de spam.
            </p>
            <Button
              variant="primary"
              size="md"
              className="mt-3"
              loading={ocupado}
              onClick={() => void agir(iniciar)}
            >
              Conectar WhatsApp
            </Button>
          </>
        )}

        {tela.tipo === 'qr' && tela.qr && (
          <>
            <ol className="list-decimal space-y-1 pl-5 text-sm text-mesa-text-secondary">
              <li>Abra o WhatsApp no celular da loja.</li>
              <li>Toque em Aparelhos conectados e depois em Conectar aparelho.</li>
              <li>Aponte a câmera para este código.</li>
            </ol>
            <div className="mt-3 flex justify-center">
              <QrCodeSvg texto={tela.qr} tamanho={240} rotulo="QR Code para conectar o WhatsApp da loja" />
            </div>
          </>
        )}

        {tela.tipo === 'conectado' && (
          <>
            <p className="flex items-center gap-1.5 text-base text-mesa-text-primary">
              <Icone nome="check" size={16} />
              Conectado{tela.numeroMascarado ? `: ${tela.numeroMascarado}` : ''}
            </p>
            <Button
              variant="textDanger"
              size="md"
              className="mt-2"
              loading={ocupado}
              onClick={() => {
                if (window.confirm('Desconectar o WhatsApp da loja? Os avisos automáticos param até reconectar.')) {
                  void agir(desconectar)
                }
              }}
            >
              Desconectar
            </Button>
            <EditorAvisos barraca={barraca} />
            <div className="mt-4 border-t border-mesa-border-subtle pt-4">
              <p className="text-sm font-medium text-mesa-text-primary">Últimos avisos</p>
              {avisos.length === 0 ? (
                <p className="text-sm text-mesa-text-secondary">Nenhum aviso enviado ainda.</p>
              ) : (
                <ul className="mt-2 space-y-1">
                  {avisos.map((a) => (
                    <li key={`${a.pedido_id}-${a.tipo}-${a.em}`} className="flex justify-between gap-3 text-sm">
                      <span className="text-mesa-text-primary">{ROTULOS[a.tipo]}</span>
                      <span className="text-mesa-text-secondary">{ESTADOS_AVISO[a.estado]}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </Card>
    </section>
  )
}
