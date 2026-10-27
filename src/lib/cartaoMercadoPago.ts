// Cartão de crédito no cardápio digital: valida os campos e gera o token DIRETO no Mercado Pago, no navegador,
// com a chave pública do VENDEDOR (vinda de `criar-pagamento-pix` acao 'chave_publica'). Número, validade, CVV,
// nome e CPF vão só para api.mercadopago.com; o servidor do Sai aê recebe apenas o token, o meio e o e-mail.
// Chamada direta à API (sem carregar o SDK JS): nenhum script de terceiro na página e nada além destas duas
// requisições. Nunca registrar estes dados em console, storage ou analytics. Testado em tests/cartaoMercadoPago.test.ts.

export type DadosCartaoTela = {
  numero: string
  /** MM/AA */
  validade: string
  cvv: string
  nome: string
  cpf: string
  email: string
}

export type CampoCartao = keyof DadosCartaoTela

const API = 'https://api.mercadopago.com/v1'

const soDigitos = (v: string) => v.replace(/\D/g, '')

function luhnOk(numero: string): boolean {
  let soma = 0
  for (let i = 0; i < numero.length; i++) {
    let d = Number(numero[numero.length - 1 - i])
    if (i % 2 === 1) {
      d *= 2
      if (d > 9) d -= 9
    }
    soma += d
  }
  return soma % 10 === 0
}

function cpfOk(cpf: string): boolean {
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false
  for (const tamanho of [9, 10]) {
    let soma = 0
    for (let i = 0; i < tamanho; i++) soma += Number(cpf[i]) * (tamanho + 1 - i)
    const digito = ((soma * 10) % 11) % 10
    if (digito !== Number(cpf[tamanho])) return false
  }
  return true
}

function lerValidade(validade: string): { mes: number; ano: number } | null {
  const m = validade.trim().match(/^(\d{1,2})\s*\/\s*(\d{2}|\d{4})$/)
  if (!m) return null
  const mes = Number(m[1])
  const ano = m[2].length === 2 ? 2000 + Number(m[2]) : Number(m[2])
  return mes >= 1 && mes <= 12 ? { mes, ano } : null
}

/** Erros por campo, em português, para mostrar ao lado de cada campo. Vazio = pode gerar o token. */
export function validarDadosCartao(d: DadosCartaoTela, agora: Date): Partial<Record<CampoCartao, string>> {
  const erros: Partial<Record<CampoCartao, string>> = {}
  const numero = soDigitos(d.numero)
  if (numero.length < 13 || numero.length > 19 || !luhnOk(numero)) erros.numero = 'Confira o número do cartão.'
  const validade = lerValidade(d.validade)
  // Vale até o último dia do mês impresso.
  if (!validade || validade.ano * 12 + validade.mes < agora.getFullYear() * 12 + agora.getMonth() + 1) {
    erros.validade = 'Informe a validade como MM/AA.'
  }
  if (!/^\d{3,4}$/.test(d.cvv.trim())) erros.cvv = 'O código tem 3 ou 4 números.'
  if (d.nome.trim().length < 2) erros.nome = 'Informe o nome como está no cartão.'
  if (!cpfOk(soDigitos(d.cpf))) erros.cpf = 'Confira o CPF do titular.'
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(d.email.trim())) erros.email = 'Informe um e-mail válido.'
  return erros
}

export type ResultadoToken =
  | { ok: true; cardToken: string; paymentMethodId: string; issuerId?: string }
  | { ok: false; erro: string }

type Buscar = (url: string, init?: RequestInit) => Promise<Response>

const ERRO_DADOS = 'Não conseguimos validar o cartão. Confira os dados ou pague com Pix.'
const ERRO_REDE = 'Não conseguimos falar com o processador do cartão. Confira sua internet e tente de novo.'

/** Descobre a bandeira pelo BIN e gera o token. Só crédito (à vista); mensagens nunca expõem a resposta do provedor. */
export async function gerarTokenCartao(publicKey: string, d: DadosCartaoTela, buscar: Buscar = fetch): Promise<ResultadoToken> {
  const numero = soDigitos(d.numero)
  const validade = lerValidade(d.validade)
  if (!validade) return { ok: false, erro: ERRO_DADOS }
  const chave = encodeURIComponent(publicKey)
  try {
    const rMeio = await buscar(`${API}/payment_methods/search?public_key=${chave}&bins=${numero.slice(0, 8)}`)
    if (!rMeio.ok) return { ok: false, erro: ERRO_DADOS }
    const meios = ((await rMeio.json().catch(() => null)) as { results?: { id?: string; payment_type_id?: string; issuer?: { id?: number | string } }[] } | null)?.results ?? []
    const credito = meios.find((m) => m.payment_type_id === 'credit_card' && m.id)
    if (!credito?.id) return { ok: false, erro: 'Use um cartão de crédito. Débito não é aceito aqui.' }

    const rToken = await buscar(`${API}/card_tokens?public_key=${chave}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        card_number: numero,
        expiration_month: validade.mes,
        expiration_year: validade.ano,
        security_code: d.cvv.trim(),
        cardholder: { name: d.nome.trim(), identification: { type: 'CPF', number: soDigitos(d.cpf) } },
      }),
    })
    const token = (await rToken.json().catch(() => null)) as { id?: unknown } | null
    if (!rToken.ok || typeof token?.id !== 'string') return { ok: false, erro: ERRO_DADOS }
    const issuer = credito.issuer?.id
    return { ok: true, cardToken: token.id, paymentMethodId: credito.id, ...(issuer !== undefined && issuer !== null ? { issuerId: String(issuer) } : {}) }
  } catch {
    return { ok: false, erro: ERRO_REDE }
  }
}
