import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { pedirCodigo, verificarCodigo, type SessaoCliente } from '../../lib/clienteApi'
import { validarDadosIdentificacao, type ErrosIdentificacao } from '../../lib/clientePerfil'
import { BottomSheet } from '../ui/BottomSheet'
import { Button } from '../ui/Button'
import { Checkbox } from '../ui/Checkbox'
import { Input } from '../ui/Input'

type Props = {
  slug: string
  nomeInicial?: string
  telefoneInicial?: string
  onConcluir: (s: SessaoCliente) => void
  onCancelar: () => void
}

/** Fechamento do pedido: nome + telefone, depois o código de 6 dígitos recebido no WhatsApp. */
export function ModalIdentificacao({ slug, nomeInicial = '', telefoneInicial = '', onConcluir, onCancelar }: Props) {
  const [etapa, setEtapa] = useState<'dados' | 'codigo'>('dados')
  const [nome, setNome] = useState(nomeInicial)
  const [telefone, setTelefone] = useState(telefoneInicial)
  const [privacidade, setPrivacidade] = useState(false)
  const [promocoes, setPromocoes] = useState(false)
  const [erros, setErros] = useState<ErrosIdentificacao>({})
  const [codigo, setCodigo] = useState('')
  const [mensagem, setMensagem] = useState<string | null>(null)
  const [carregando, setCarregando] = useState(false)
  const [segundosReenvio, setSegundosReenvio] = useState(0)
  const [honeypot, setHoneypot] = useState('')
  const abertoEm = useRef<number | null>(null)

  useEffect(() => {
    abertoEm.current = Date.now()
  }, [])

  useEffect(() => {
    if (segundosReenvio <= 0) return
    const t = setTimeout(() => setSegundosReenvio((s) => s - 1), 1000)
    return () => clearTimeout(t)
  }, [segundosReenvio])

  async function receberCodigo() {
    const e = validarDadosIdentificacao({ nome, telefone, aceitouPrivacidade: privacidade })
    setErros(e)
    if (Object.keys(e).length > 0) return
    setCarregando(true)
    setMensagem(null)
    const r = await pedirCodigo({ slug, nome, telefone, honeypot, msNoCheckout: Date.now() - (abertoEm.current ?? Date.now()) })
    setCarregando(false)
    if (!r.ok) return setMensagem(r.erro)
    setSegundosReenvio(r.reenvio_em_s)
    setEtapa('codigo')
    // Staging com código simulado: preenche sozinho para o teste (nunca existe em produção).
    if (r.codigo_simulado) setCodigo(r.codigo_simulado)
  }

  async function confirmar() {
    setCarregando(true)
    setMensagem(null)
    const r = await verificarCodigo({ slug, nome, telefone, codigo, aceitaPromocoes: promocoes })
    setCarregando(false)
    if (!r.ok) {
      return setMensagem(r.tentativasRestantes !== undefined ? `${r.erro} Restam ${r.tentativasRestantes} tentativas.` : r.erro)
    }
    onConcluir(r.sessao)
  }

  return (
    <BottomSheet open onClose={onCancelar} aria-label={etapa === 'dados' ? 'Seus dados' : 'Digite o código'}>
      {etapa === 'dados' ? (
        <div className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold text-mesa-text-primary">Seus dados</h2>
          <p className="text-sm text-mesa-text-secondary">Para finalizar, confirme seu WhatsApp. Enviamos um código de 6 números.</p>
          <Input label="Nome" value={nome} onChange={(e) => setNome(e.target.value)} error={erros.nome} autoComplete="name" />
          <Input
            label="WhatsApp com DDD"
            value={telefone}
            onChange={(e) => setTelefone(e.target.value)}
            error={erros.telefone}
            inputMode="tel"
            autoComplete="tel"
          />
          {/* honeypot: fora da tela, robô preenche */}
          <input
            tabIndex={-1}
            autoComplete="off"
            aria-hidden
            className="absolute -left-[9999px]"
            value={honeypot}
            onChange={(e) => setHoneypot(e.target.value)}
          />
          <div className="flex items-start gap-1">
            <Checkbox checked={privacidade} onChange={setPrivacidade} aria-label="Aceito a política de privacidade" />
            <span className="pt-2.5 text-sm text-mesa-text-primary">
              Li e aceito a{' '}
              <Link to="/privacidade" target="_blank" className="underline">
                política de privacidade
              </Link>
              . Vamos usar seu telefone para avisar sobre o pedido.
            </span>
          </div>
          {erros.privacidade && (
            <p role="alert" className="text-sm font-medium text-mesa-error-500">
              {erros.privacidade}
            </p>
          )}
          <Checkbox checked={promocoes} onChange={setPromocoes} label="Quero receber promoções da loja (opcional)" />
          {mensagem && (
            <p role="alert" className="text-sm font-medium text-mesa-error-500">
              {mensagem}
            </p>
          )}
          <Button variant="primary" size="xl" className="w-full" loading={carregando} disabled={carregando} onClick={() => void receberCodigo()}>
            Receber código
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold text-mesa-text-primary">Digite o código</h2>
          <p className="text-sm text-mesa-text-secondary">Enviamos um código de 6 números para o seu WhatsApp.</p>
          <Input
            label="Código"
            value={codigo}
            onChange={(e) => setCodigo(e.target.value)}
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={9}
          />
          {mensagem && (
            <p role="alert" className="text-sm font-medium text-mesa-error-500">
              {mensagem}
            </p>
          )}
          <Button
            variant="primary"
            size="xl"
            className="w-full"
            loading={carregando}
            disabled={carregando || codigo.replace(/\D/g, '').length !== 6}
            onClick={() => void confirmar()}
          >
            Confirmar
          </Button>
          <div className="flex justify-between text-sm">
            <button
              type="button"
              className="min-h-11 underline"
              onClick={() => {
                setEtapa('dados')
                setCodigo('')
                setMensagem(null)
              }}
            >
              Trocar número
            </button>
            <button
              type="button"
              className="min-h-11 underline disabled:opacity-50"
              disabled={segundosReenvio > 0 || carregando}
              onClick={() => void receberCodigo()}
            >
              {segundosReenvio > 0 ? `Reenviar em ${segundosReenvio}s` : 'Reenviar código'}
            </button>
          </div>
        </div>
      )}
    </BottomSheet>
  )
}
