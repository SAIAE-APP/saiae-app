export function formatarDataISO(data: Date): string {
  const ano = data.getFullYear()
  const mes = String(data.getMonth() + 1).padStart(2, '0')
  const dia = String(data.getDate()).padStart(2, '0')
  return `${ano}-${mes}-${dia}`
}

export function hojeISO(): string {
  return formatarDataISO(new Date())
}

export function deslocarDias(iso: string, dias: number): string {
  const [ano, mes, dia] = iso.split('-').map(Number)
  const data = new Date(ano, mes - 1, dia)
  data.setDate(data.getDate() + dias)
  return formatarDataISO(data)
}

/** "05/03" — pra faixas e rótulos curtos de validade (acesso de suporte, por ex.). */
export function formatarDataCurta(data: Date): string {
  const dia = String(data.getDate()).padStart(2, '0')
  const mes = String(data.getMonth() + 1).padStart(2, '0')
  return `${dia}/${mes}`
}

/** "Sábado, 5 de setembro" — Intl já devolve nesse formato em pt-BR, só falta maiúscula inicial. */
export function formatarDataExtenso(data: Date): string {
  const texto = new Intl.DateTimeFormat('pt-BR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(data)
  return texto.charAt(0).toUpperCase() + texto.slice(1)
}

/** Cosmético — não é horário de funcionamento real, só rótulo do período
 * do dia (Dashboard, Cozinha). */
export function turnoAtual(): string {
  const hora = new Date().getHours()
  if (hora < 12) return 'Turno Manhã'
  if (hora < 18) return 'Turno Tarde'
  return 'Turno Noite'
}
