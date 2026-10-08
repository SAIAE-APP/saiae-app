import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { MSG_SEM_INTERNET } from '../hooks/useSalvarBarraca'
import { bancoSemRecurso } from '../lib/semMigration'
import { Button } from './ui/Button'
import { Card } from './ui/Card'
import { Icone } from './ui/Icone'
import { Input } from './ui/Input'
import { Toggle } from './ui/Toggle'
import type { Barraca } from '../types/database'

type Estado = {
  url: string | null
  ativo: boolean
  segredo_configurado: boolean
  pendentes: number
  falhos: number
  ultimo_erro: string | null
  ultimo_envio_em: string | null
}

function mensagemDeErro(erro: unknown): string {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return MSG_SEM_INTERNET
  const m = erro instanceof Error ? erro.message : typeof erro === 'object' && erro && 'message' in erro ? String((erro as { message: unknown }).message) : ''
  return m || 'Não foi possível concluir. Tente novamente.'
}

/**
 * Integração com o CRM (SAI-013): a cada pedido novo, mudança de status e pagamento, a Comanda avisa o
 * CRM (WhatsApp) por um endereço seguro. O "segredo" é a senha que assina os avisos: aparece UMA vez,
 * ao gerar, e deve ser colado no CRM. Falha de envio nunca atrapalha o pedido: os avisos ficam numa
 * fila e são reenviados sozinhos.
 */
export function SecaoIntegracaoCrm({ barraca }: { barraca: Barraca }) {
  const [estado, setEstado] = useState<Estado | null>(null)
  // Banco sem a migration da SAI-013 (app no ar antes dela): a seção some, sem erro.
  const [semBanco, setSemBanco] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [url, setUrl] = useState('')
  const [urlEditada, setUrlEditada] = useState(false)
  const [ocupado, setOcupado] = useState(false)
  const [segredoNovo, setSegredoNovo] = useState<string | null>(null)
  const [copiado, setCopiado] = useState(false)

  const carregar = useCallback(async () => {
    const { data, error } = await supabase.rpc('integracao_crm_estado', { p_barraca_id: barraca.id })
    if (error) {
      if (bancoSemRecurso(error)) setSemBanco(true)
      else setErro(mensagemDeErro(error))
      return
    }
    setErro(null)
    setEstado(data as Estado)
  }, [barraca.id])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void carregar()
  }, [carregar])

  async function executar(acao: () => Promise<void>) {
    setOcupado(true)
    setErro(null)
    try {
      await acao()
      await carregar()
    } catch (e) {
      setErro(mensagemDeErro(e))
    } finally {
      setOcupado(false)
    }
  }

  const urlAtual = urlEditada ? url : (estado?.url ?? '')
  const urlValida = /^https:\/\/\S+$/.test(urlAtual.trim())

  async function salvar(ativo: boolean) {
    await executar(async () => {
      const { error } = await supabase.rpc('integracao_crm_salvar', {
        p_barraca_id: barraca.id,
        p_url: urlAtual.trim(),
        p_ativo: ativo,
      })
      if (error) throw error
      setUrlEditada(false)
    })
  }

  async function gerarSegredo() {
    if (estado?.segredo_configurado && !window.confirm('Gerar um novo segredo? O atual deixa de valer e o CRM precisa receber o novo.')) return
    await executar(async () => {
      const { data, error } = await supabase.rpc('integracao_crm_novo_segredo', { p_barraca_id: barraca.id })
      if (error) throw error
      setSegredoNovo(data as string)
      setCopiado(false)
    })
  }

  async function reenviar() {
    await executar(async () => {
      const { error } = await supabase.rpc('integracao_crm_reenviar_falhos', { p_barraca_id: barraca.id })
      if (error) throw error
    })
  }

  async function copiar() {
    if (!segredoNovo) return
    try {
      await navigator.clipboard.writeText(segredoNovo)
      setCopiado(true)
    } catch {
      setErro('Não consegui copiar. Selecione o texto e copie à mão.')
    }
  }

  if (semBanco) return null

  return (
    <section>
      <h2 className="mb-3 flex items-center gap-1.5 font-mesa-sans text-xs font-semibold uppercase tracking-wider text-mesa-text-secondary">
        <Icone nome="chat" size={14} />
        Integração com o CRM
      </h2>
      <Card>
        <p className="text-sm text-mesa-text-secondary">
          Avisa o CRM (WhatsApp) quando um pedido é criado, muda de status ou é pago. Se o CRM estiver fora do ar,
          os avisos ficam numa fila e são reenviados sozinhos. Isso nunca atrapalha o pedido.
        </p>

        {erro && (
          <p role="alert" className="mt-3 text-sm font-medium text-mesa-error-500">
            {erro}
          </p>
        )}

        <div className="mt-4">
          <Input
            label="Endereço do CRM (https)"
            type="text"
            inputMode="url"
            autoComplete="off"
            placeholder="https://crm.saiae.com.br/api/integracao/comanda/v1/eventos"
            value={urlAtual}
            onChange={(e) => {
              setUrl(e.target.value)
              setUrlEditada(true)
            }}
            helpText={urlAtual.trim() && !urlValida ? 'O endereço precisa começar com https://' : undefined}
          />
          <Button
            variant="outline"
            size="md"
            className="mt-3"
            disabled={ocupado || !urlEditada || (urlAtual.trim() !== '' && !urlValida)}
            onClick={() => void salvar(estado?.ativo ?? false)}
          >
            Salvar endereço
          </Button>
        </div>

        <div className="mt-5">
          <p className="text-sm font-medium text-mesa-text-primary">Segredo de assinatura</p>
          <p className="mt-0.5 text-xs text-mesa-text-secondary">
            {estado?.segredo_configurado ? 'Já existe um segredo gerado.' : 'Ainda não há segredo.'} Ele aparece uma vez só,
            ao gerar. Cole-o no CRM e não envie por chat.
          </p>
          <Button variant="outline" size="md" className="mt-2" disabled={ocupado} onClick={() => void gerarSegredo()}>
            {estado?.segredo_configurado ? 'Gerar novo segredo' : 'Gerar segredo'}
          </Button>
          {segredoNovo && (
            <div className="mt-3 rounded-mesa-md bg-mesa-neutral-100 p-3 dark:bg-mesa-neutral-700">
              <p className="break-all font-mesa-mono text-xs text-mesa-text-primary" data-testid="segredo-novo">
                {segredoNovo}
              </p>
              <div className="mt-2 flex gap-2">
                <Button variant="primary" size="md" onClick={() => void copiar()}>
                  {copiado ? 'Copiado' : 'Copiar'}
                </Button>
                <Button variant="ghost" size="md" onClick={() => setSegredoNovo(null)}>
                  Já copiei, esconder
                </Button>
              </div>
            </div>
          )}
        </div>

        <label className="mt-5 flex min-h-11 items-center justify-between gap-3">
          <span className="text-sm font-medium text-mesa-text-primary">Enviar avisos ao CRM</span>
          <Toggle
            checked={estado?.ativo ?? false}
            disabled={ocupado || !estado || (!estado.ativo && (!estado.segredo_configurado || !(estado.url ?? '').trim()))}
            onChange={(valor: boolean) => void salvar(valor)}
            aria-label="Enviar avisos ao CRM"
          />
        </label>
        {estado && !estado.ativo && (!estado.segredo_configurado || !estado.url) && (
          <p className="text-xs text-mesa-text-secondary">Salve o endereço e gere o segredo para poder ligar.</p>
        )}

        {estado && (estado.ativo || estado.pendentes > 0 || estado.falhos > 0) && (
          <div className="mt-4 border-t border-mesa-border-subtle pt-3 text-sm text-mesa-text-secondary">
            <p>
              Na fila: <strong className="text-mesa-text-primary">{estado.pendentes}</strong> · Com falha:{' '}
              <strong className="text-mesa-text-primary">{estado.falhos}</strong>
              {estado.ultimo_envio_em &&
                ` · Último envio: ${new Date(estado.ultimo_envio_em).toLocaleString('pt-BR')}`}
            </p>
            {estado.ultimo_erro && <p className="mt-1 text-xs">Último erro: {estado.ultimo_erro}</p>}
            {estado.falhos > 0 && (
              <Button variant="outline" size="md" className="mt-2" disabled={ocupado} onClick={() => void reenviar()}>
                Reenviar os {estado.falhos} com falha
              </Button>
            )}
          </div>
        )}
      </Card>
    </section>
  )
}
