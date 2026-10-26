import { useState, type FormEvent } from 'react'
import { Button } from './ui/Button'
import { Icone } from './ui/Icone'
import { Input } from './ui/Input'
import { gerarTokenCartao, validarDadosCartao, type CampoCartao, type DadosCartaoTela } from '../lib/cartaoMercadoPago'

export type TokenCartaoGerado = { cardToken: string; paymentMethodId: string; issuerId?: string; email: string }

const VAZIO: DadosCartaoTela = { numero: '', validade: '', cvv: '', nome: '', cpf: '', email: '' }

/**
 * Formulário do cartão de crédito (à vista, sem parcelas). Gera o token no navegador com a chave pública do
 * vendedor; os dados do cartão ficam só no estado deste formulário e são apagados depois de gerar o token.
 * Nada daqui é registrado no console nem guardado no aparelho.
 */
export function CartaoMercadoPago({
  publicKey,
  onGerarToken,
  desabilitado,
  textoBotao,
  onAntesDeGerar,
}: {
  publicKey: string
  onGerarToken: (d: TokenCartaoGerado) => void
  desabilitado: boolean
  textoBotao: string
  /** Validação do resto da tela (ex.: endereço) ANTES de gerar o token, que é de uso único. */
  onAntesDeGerar?: () => boolean
}) {
  const [dados, setDados] = useState<DadosCartaoTela>(VAZIO)
  const [erros, setErros] = useState<Partial<Record<CampoCartao, string>>>({})
  const [erroGeral, setErroGeral] = useState<string | null>(null)
  const [gerando, setGerando] = useState(false)

  function campo(nome: CampoCartao) {
    return {
      value: dados[nome],
      error: erros[nome],
      disabled: desabilitado || gerando,
      onChange: (e: { target: { value: string } }) => {
        setDados((d) => ({ ...d, [nome]: e.target.value }))
        if (erros[nome]) setErros((atual) => ({ ...atual, [nome]: undefined }))
      },
    }
  }

  async function enviar(e: FormEvent) {
    e.preventDefault()
    if (desabilitado || gerando) return
    setErroGeral(null)
    const encontrados = validarDadosCartao(dados, new Date())
    setErros(encontrados)
    if (Object.keys(encontrados).length > 0) return
    if (onAntesDeGerar && !onAntesDeGerar()) return
    setGerando(true)
    const r = await gerarTokenCartao(publicKey, dados)
    setGerando(false)
    if (!r.ok) {
      setErroGeral(r.erro)
      return
    }
    const email = dados.email.trim()
    // Token é de uso único: a próxima tentativa digita de novo número, validade e código.
    setDados((d) => ({ ...d, numero: '', validade: '', cvv: '' }))
    onGerarToken({ cardToken: r.cardToken, paymentMethodId: r.paymentMethodId, ...(r.issuerId ? { issuerId: r.issuerId } : {}), email })
  }

  return (
    <form noValidate onSubmit={enviar} className="flex flex-col gap-3" aria-label="Dados do cartão de crédito">
      <Input label="Número do cartão" inputMode="numeric" autoComplete="cc-number" maxLength={23} {...campo('numero')} />
      <div className="grid grid-cols-2 gap-3">
        <Input label="Validade (MM/AA)" inputMode="numeric" autoComplete="cc-exp" maxLength={7} placeholder="MM/AA" {...campo('validade')} />
        <Input label="Código de segurança" inputMode="numeric" autoComplete="cc-csc" maxLength={4} {...campo('cvv')} />
      </div>
      <Input label="Nome impresso no cartão" autoComplete="cc-name" maxLength={60} {...campo('nome')} />
      <Input label="CPF do titular" inputMode="numeric" autoComplete="off" maxLength={14} {...campo('cpf')} />
      <Input
        label="E-mail"
        type="email"
        autoComplete="email"
        maxLength={254}
        helpText="O Mercado Pago envia o comprovante para este e-mail."
        {...campo('email')}
      />
      <p className="text-xs text-mesa-text-tertiary">Crédito à vista. Os dados do cartão vão direto ao Mercado Pago, sem passar pelo Sai aê.</p>
      {erroGeral && (
        <p
          role="alert"
          className="rounded-mesa-md border-l-[3px] border-mesa-error-500 bg-mesa-error-50 p-3 text-sm font-medium text-mesa-error-700 dark:bg-mesa-error-500/15 dark:text-mesa-error-400"
        >
          {erroGeral}
        </p>
      )}
      <Button type="submit" size="xl" icon={<Icone nome="credit_card" size={20} />} className="w-full" loading={gerando} disabled={desabilitado}>
        {textoBotao}
      </Button>
    </form>
  )
}
