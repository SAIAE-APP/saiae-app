// Assistente de configuração inicial (PR 2): lógica PURA, sem React, Supabase nem Capacitor — testável no Node.
// Spec: docs/superpowers/specs/2026-10-08-onboarding-configuracao-design.md

// ---------------------------------------------------------------- slug do cardápio
/** Slugs que colidem com rotas do app. TEM que ser igual a `slug_reservado()` da migration 20261020100000
 * (tests/onboardingConfig.test.ts compara as duas listas). */
export const SLUGS_RESERVADOS = [
  'login', 'cadastro', 'onboarding', 'esqueci-senha', 'redefinir-senha', 'assinar', 'e', 'privacidade',
  'excluir-conta', 'selecionar-barraca', 'configurar', 'brand', 'assets', 'api', 'admin', 'app', 'www',
  'suporte', 'ajuda', 'termos',
] as const

export const SLUG_MAX = 40

/** "Pastelão do Zé!" -> "pastelao-do-ze": sem acento, minúsculo, só a-z0-9 e hífen, sem hífen nas pontas. */
export function gerarSlug(nome: string): string {
  const base = String(nome ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  if (base.length <= SLUG_MAX) return base
  // corta no limite sem deixar hífen pendurado nem palavra pela metade quando der
  const corte = base.slice(0, SLUG_MAX).replace(/-+$/g, '')
  const ultimoHifen = corte.lastIndexOf('-')
  return ultimoHifen >= 12 ? corte.slice(0, ultimoHifen) : corte
}

export function slugReservado(slug: string): boolean {
  return (SLUGS_RESERVADOS as readonly string[]).includes(slug)
}

export type ProblemaSlug = 'vazio' | 'formato' | 'longo' | 'reservado'

/** Formato aceito pelo banco (`criar_barraca`): ^[a-z0-9]+(-[a-z0-9]+)*$, até 40, fora da lista de reservados. */
export function problemaDoSlug(slug: string): ProblemaSlug | null {
  if (!slug) return 'vazio'
  if (slug.length > SLUG_MAX) return 'longo'
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) return 'formato'
  if (slugReservado(slug)) return 'reservado'
  return null
}

export function mensagemDoProblemaSlug(p: ProblemaSlug): string {
  switch (p) {
    case 'vazio':
      return 'Escolha um endereço para o seu cardápio.'
    case 'longo':
      return `Use até ${SLUG_MAX} caracteres.`
    case 'formato':
      return 'Use só letras minúsculas, números e hífen.'
    case 'reservado':
      return 'Esse endereço é reservado. Escolha outro.'
  }
}

/** Sugestões quando o link já existe: "-2", "-3" e o bairro (quando informado). Sempre válidas e sem repetir. */
export function sugerirSlugs(slugBase: string, bairro?: string | null, ocupados: string[] = []): string[] {
  const base = slugBase.slice(0, SLUG_MAX - 3).replace(/-+$/g, '')
  if (!base) return []
  const bairroSlug = bairro ? gerarSlug(bairro) : ''
  const candidatos = [
    ...(bairroSlug ? [`${base}-${bairroSlug}`.slice(0, SLUG_MAX).replace(/-+$/g, '')] : []),
    `${base}-2`,
    `${base}-3`,
  ]
  const vistos = new Set<string>(ocupados)
  const saida: string[] = []
  for (const c of candidatos) {
    if (!vistos.has(c) && problemaDoSlug(c) === null) {
      vistos.add(c)
      saida.push(c)
    }
  }
  return saida.slice(0, 3)
}

// ---------------------------------------------------------------- listas do passo 1 e 2
export const ORIGENS = [
  { chave: 'anuncio', rotulo: 'Anúncio' },
  { chave: 'instagram', rotulo: 'Instagram' },
  { chave: 'tiktok', rotulo: 'TikTok' },
  { chave: 'youtube', rotulo: 'YouTube' },
  { chave: 'google', rotulo: 'Google' },
  { chave: 'indicacao', rotulo: 'Indicação' },
  { chave: 'panfleto', rotulo: 'Panfleto' },
  { chave: 'outro', rotulo: 'Outro' },
] as const

export const CATEGORIAS = [
  { chave: 'lanches', rotulo: 'Lanches' },
  { chave: 'pizza', rotulo: 'Pizza' },
  { chave: 'marmita', rotulo: 'Marmita / PF' },
  { chave: 'oriental', rotulo: 'Oriental' },
  { chave: 'acai', rotulo: 'Açaí' },
  { chave: 'doces', rotulo: 'Doces e bolos' },
  { chave: 'pastel', rotulo: 'Pastel e salgados' },
  { chave: 'bebidas', rotulo: 'Bebidas' },
  { chave: 'churrasco', rotulo: 'Churrasco' },
  { chave: 'outra', rotulo: 'Outra' },
] as const

// ---------------------------------------------------------------- horários
export type HorarioDia = { dia: number; aberto: boolean; abre: string; fecha: string }

export const NOMES_DIAS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'] as const

/** Um intervalo por dia (decisão do dono: sem dois turnos nesta fase). 0 = domingo. */
export const MODELOS_HORARIO = {
  almoco: { rotulo: 'Almoço', dias: [1, 2, 3, 4, 5, 6], abre: '11:00', fecha: '15:00' },
  jantar: { rotulo: 'Jantar', dias: [1, 2, 3, 4, 5, 6], abre: '18:00', fecha: '23:00' },
  fim_de_semana: { rotulo: 'Fim de semana', dias: [0, 6], abre: '11:00', fecha: '23:00' },
} as const
export type ChaveModeloHorario = keyof typeof MODELOS_HORARIO

export function semanaFechada(): HorarioDia[] {
  return NOMES_DIAS.map((_, dia) => ({ dia, aberto: false, abre: '', fecha: '' }))
}

export function aplicarModelo(chave: ChaveModeloHorario): HorarioDia[] {
  const m = MODELOS_HORARIO[chave]
  return semanaFechada().map((h) =>
    (m.dias as readonly number[]).includes(h.dia) ? { ...h, aberto: true, abre: m.abre, fecha: m.fecha } : h,
  )
}

/** "Igual ao dia anterior": copia o dia de cima da lista (domingo, o primeiro, não tem anterior). */
export function igualAoDiaAnterior(semana: HorarioDia[], dia: number): HorarioDia[] {
  if (dia <= 0 || dia > 6) return semana
  const anterior = semana.find((h) => h.dia === dia - 1)
  if (!anterior) return semana
  return semana.map((h) => (h.dia === dia ? { ...h, aberto: anterior.aberto, abre: anterior.abre, fecha: anterior.fecha } : h))
}

const HORA = /^([01]\d|2[0-3]):[0-5]\d$/

export type ErroHorario = 'nenhum_dia_aberto' | 'horario_incompleto' | 'horario_invalido' | 'abre_igual_fecha'

/** Regras do passo (o banco confere de novo). Fechar depois da meia-noite é permitido (18:00–02:00), como
 * já é no app; só não faz sentido abrir e fechar na mesma hora. */
export function validarSemana(semana: HorarioDia[]): { ok: boolean; erros: Record<number, ErroHorario>; geral: ErroHorario | null } {
  const erros: Record<number, ErroHorario> = {}
  for (const h of semana) {
    if (!h.aberto) continue
    if (!h.abre || !h.fecha) erros[h.dia] = 'horario_incompleto'
    else if (!HORA.test(h.abre) || !HORA.test(h.fecha)) erros[h.dia] = 'horario_invalido'
    else if (h.abre === h.fecha) erros[h.dia] = 'abre_igual_fecha'
  }
  const geral: ErroHorario | null = semana.some((h) => h.aberto) ? null : 'nenhum_dia_aberto'
  return { ok: geral === null && Object.keys(erros).length === 0, erros, geral }
}

/** Formato da RPC `onboarding_salvar_passo` (etapa 6). Dia fechado vai sem horários. */
export function horariosParaRpc(semana: HorarioDia[]): { dia: number; aberto: boolean; abre?: string; fecha?: string }[] {
  return semana.map((h) => (h.aberto ? { dia: h.dia, aberto: true, abre: h.abre, fecha: h.fecha } : { dia: h.dia, aberto: false }))
}

/** Lê o que está salvo em `horarios_funcionamento` (hora "HH:MM:SS") para o formato do passo. */
export function semanaDoBanco(linhas: { dia_semana: number; aberto: boolean; hora_abertura: string | null; hora_fechamento: string | null }[]): HorarioDia[] {
  const base = semanaFechada()
  for (const l of linhas) {
    const alvo = base.find((h) => h.dia === l.dia_semana)
    if (alvo) {
      alvo.aberto = l.aberto
      alvo.abre = l.hora_abertura ? l.hora_abertura.slice(0, 5) : ''
      alvo.fecha = l.hora_fechamento ? l.hora_fechamento.slice(0, 5) : ''
    }
  }
  return base
}

// ---------------------------------------------------------------- CNPJ
/** Dígitos verificadores do CNPJ (14 dígitos, sem todos iguais). */
export function cnpjValido(texto: string): boolean {
  const d = String(texto ?? '').replace(/\D/g, '')
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

// ---------------------------------------------------------------- passos e retomada
export type PassoOnboarding = { numero: number; chave: string; titulo: string; obrigatorio: boolean }

export const PASSOS: PassoOnboarding[] = [
  { numero: 1, chave: 'origem', titulo: 'Como você conheceu o Sai aê?', obrigatorio: false },
  { numero: 2, chave: 'categoria', titulo: 'Qual é o seu tipo de negócio?', obrigatorio: false },
  { numero: 3, chave: 'marca', titulo: 'Nome da marca e link do cardápio', obrigatorio: true },
  { numero: 4, chave: 'cnpj', titulo: 'CNPJ', obrigatorio: false },
  { numero: 5, chave: 'endereco', titulo: 'Endereço da loja', obrigatorio: false },
  { numero: 6, chave: 'horario', titulo: 'Horário de funcionamento', obrigatorio: true },
  { numero: 7, chave: 'pagamento', titulo: 'Formas de pagamento', obrigatorio: true },
  { numero: 8, chave: 'modos', titulo: 'Como você atende', obrigatorio: true },
  { numero: 9, chave: 'taxa', titulo: 'Taxa de entrega', obrigatorio: false },
  { numero: 10, chave: 'final', titulo: 'Preparando a cozinha', obrigatorio: false },
]

/** Próximo passo a mostrar: o seguinte ao último concluído. O passo 9 (taxa) só existe com Entrega ligada. */
export function proximoPasso(etapaConcluida: number, entregaAtiva: boolean): number {
  let n = Math.min(Math.max(Math.floor(etapaConcluida) + 1, 1), 10)
  if (n === 9 && !entregaAtiva) n = 10
  return n
}

/** Passos exibidos na barra de progresso ("Passo 4 de N"): sem o 9 quando não há Entrega. */
export function passosVisiveis(entregaAtiva: boolean): PassoOnboarding[] {
  return PASSOS.filter((p) => p.numero !== 9 || entregaAtiva)
}

/** Só passos opcionais têm "fazer depois". */
export function podePular(numero: number): boolean {
  return PASSOS.find((p) => p.numero === numero)?.obrigatorio === false && numero !== 10
}

/** Conta nova entra no assistente; barraca antiga (concluído) NUNCA é redirecionada nem bloqueada. */
export function deveAbrirAssistente(p: { flagLigada: boolean; concluido: boolean }): boolean {
  return p.flagLigada && !p.concluido
}

// ---------------------------------------------------------------- checklist do Hub
/** Retorno de `onboarding_progresso` (só booleanos). `taxa` vem null quando Entrega não está ligada. */
export type Progresso = {
  etapa?: number
  concluido?: boolean
  horario?: boolean
  pagamento?: boolean
  modos?: boolean
  item?: boolean
  endereco?: boolean
  cnpj?: boolean
  entrega_ativa?: boolean
  taxa?: boolean | null
  pix_online?: boolean
  logo?: boolean
}

export type ItemChecklist = { chave: string; rotulo: string; feito: boolean; passo: number | null }

const ITENS_CHECKLIST: { chave: keyof Progresso | 'marca'; rotulo: string; passo: number | null; aplica?: (p: Progresso) => boolean }[] = [
  { chave: 'marca', rotulo: 'Nome e link do cardápio', passo: 3 },
  { chave: 'horario', rotulo: 'Horário de funcionamento', passo: 6 },
  { chave: 'pagamento', rotulo: 'Formas de pagamento', passo: 7 },
  { chave: 'modos', rotulo: 'Modos de atendimento', passo: 8 },
  { chave: 'item', rotulo: 'Cadastrar o primeiro item', passo: null },
  { chave: 'endereco', rotulo: 'Endereço da loja', passo: 5 },
  { chave: 'cnpj', rotulo: 'CNPJ (ou marcar que não tem)', passo: 4 },
  { chave: 'taxa', rotulo: 'Taxa de entrega', passo: 9, aplica: (p) => p.entrega_ativa === true },
  { chave: 'pix_online', rotulo: 'Ativar o Pix online', passo: 7 },
  { chave: 'logo', rotulo: 'Colocar a logo', passo: null },
]

/** Todos os itens têm o MESMO peso (decisão do dono): % = concluídos ÷ total aplicável. */
export function calcularChecklist(p: Progresso): { itens: ItemChecklist[]; feitos: number; total: number; porcentagem: number } {
  const itens: ItemChecklist[] = ITENS_CHECKLIST.filter((i) => !i.aplica || i.aplica(p)).map((i) => ({
    chave: i.chave,
    rotulo: i.rotulo,
    passo: i.passo,
    feito: i.chave === 'marca' ? true : p[i.chave as keyof Progresso] === true,
  }))
  const feitos = itens.filter((i) => i.feito).length
  return { itens, feitos, total: itens.length, porcentagem: itens.length === 0 ? 100 : Math.floor((feitos * 100) / itens.length) }
}

/** Cartão do Hub: some em 100% e durante o "ocultar por 7 dias". */
export function mostrarChecklist(porcentagem: number, ocultoAte: string | null | undefined, agora: number): boolean {
  if (porcentagem >= 100) return false
  return !(ocultoAte && Date.parse(ocultoAte) > agora)
}
