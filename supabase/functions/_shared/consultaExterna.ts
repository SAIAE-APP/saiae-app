// Consulta de CNPJ (BrasilAPI) e CEP (ViaCEP) para o assistente de configuração. Funções puras (Deno e Node).
// Só os campos necessários saem daqui (minimização): nada de sócios, capital, telefone etc.

export function soDigitos(texto: unknown): string {
  return String(texto ?? '').replace(/\D/g, '')
}

/** Dígitos verificadores do CNPJ (14 dígitos, sem todos iguais). Mesma regra de src/lib/onboardingConfig.ts. */
export function cnpjValido(texto: unknown): boolean {
  const d = soDigitos(texto)
  if (d.length !== 14 || /^(\d)\1+$/.test(d)) return false
  const digito = (base: string, pesos: number[]) => {
    const soma = base.split('').reduce((s, n, i) => s + Number(n) * pesos[i], 0)
    const r = soma % 11
    return r < 2 ? 0 : 11 - r
  }
  const d1 = digito(d.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])
  const d2 = digito(d.slice(0, 12) + d1, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])
  return d1 === Number(d[12]) && d2 === Number(d[13])
}

export const cepValido = (texto: unknown): boolean => /^\d{8}$/.test(soDigitos(texto)) && soDigitos(texto) !== '00000000'

const texto = (v: unknown, max: number): string => String(v ?? '').trim().slice(0, max)

export type DadosCnpj = {
  razao_social: string
  nome_fantasia: string
  ativa: boolean
  situacao: string
  endereco: { cep: string; rua: string; numero: string; complemento: string; bairro: string; cidade: string; uf: string }
}

/** Resposta da BrasilAPI (/cnpj/v1/{cnpj}) -> só o que o assistente usa. null se não for reconhecível. */
export function normalizarBrasilApi(json: unknown): DadosCnpj | null {
  if (typeof json !== 'object' || json === null) return null
  const j = json as Record<string, unknown>
  const razao = texto(j.razao_social, 120)
  if (!razao) return null
  const situacao = texto(j.descricao_situacao_cadastral, 40)
  return {
    razao_social: razao,
    nome_fantasia: texto(j.nome_fantasia, 120),
    // 2 = ATIVA na tabela da Receita; aceita também o texto
    ativa: Number(j.situacao_cadastral) === 2 || /^ativa$/i.test(situacao),
    situacao,
    endereco: {
      cep: soDigitos(j.cep).slice(0, 8),
      rua: [texto(j.descricao_tipo_de_logradouro, 30), texto(j.logradouro, 120)].filter(Boolean).join(' ').slice(0, 120),
      numero: texto(j.numero, 20),
      complemento: texto(j.complemento, 80),
      bairro: texto(j.bairro, 80),
      cidade: texto(j.municipio, 80),
      uf: texto(j.uf, 2).toUpperCase(),
    },
  }
}

export type DadosCep = { cep: string; rua: string; bairro: string; cidade: string; uf: string }

/** Resposta do ViaCEP (/ws/{cep}/json/) -> endereço. `{"erro": true}` ou formato estranho => null. */
export function normalizarViaCep(json: unknown): DadosCep | null {
  if (typeof json !== 'object' || json === null) return null
  const j = json as Record<string, unknown>
  if (j.erro === true || j.erro === 'true') return null
  const cidade = texto(j.localidade, 80)
  if (!cidade) return null
  return {
    cep: soDigitos(j.cep).slice(0, 8),
    rua: texto(j.logradouro, 120),
    bairro: texto(j.bairro, 80),
    cidade,
    uf: texto(j.uf, 2).toUpperCase(),
  }
}
