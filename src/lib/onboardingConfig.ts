// Assistente de configuração inicial (PR 2): lógica PURA, sem React, Supabase nem Capacitor — testável no Node.
// Spec: docs/superpowers/specs/2026-10-08-onboarding-configuracao-design.md
import { ROTULO_MODO } from './atendimento.ts'
import { formatarPrecoBR } from './preco.ts'

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
  /** Sugerido pelo kit de açaí (todos os dias, 12h às 22h). */
  tarde_noite: { rotulo: 'Tarde e noite', dias: [0, 1, 2, 3, 4, 5, 6], abre: '12:00', fecha: '22:00' },
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
  /** Kits iniciais: itens do kit ainda sem preço, e se vale oferecer "Montar um cardápio de exemplo". */
  kit_precos_pendentes?: number
  kit_oferta?: boolean
}

export type ItemChecklist = { chave: string; rotulo: string; feito: boolean; passo: number | null }

const ITENS_CHECKLIST: {
  chave: keyof Progresso | 'marca' | 'kit_precos'
  rotulo: string
  passo: number | null
  aplica?: (p: Progresso) => boolean
  feito?: (p: Progresso) => boolean
}[] = [
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
  // Só existem para barraca com kit: quem não tem kit (inclusive toda barraca antiga) não vê nem muda a porcentagem.
  { chave: 'kit_precos', rotulo: 'Completar os preços do cardápio de exemplo', passo: null, aplica: (p) => (p.kit_precos_pendentes ?? 0) > 0, feito: () => false },
  { chave: 'kit_oferta', rotulo: 'Montar um cardápio de exemplo (opcional)', passo: null, aplica: (p) => p.kit_oferta === true, feito: () => false },
]

/** Todos os itens têm o MESMO peso (decisão do dono): % = concluídos ÷ total aplicável. */
export function calcularChecklist(p: Progresso): { itens: ItemChecklist[]; feitos: number; total: number; porcentagem: number } {
  const itens: ItemChecklist[] = ITENS_CHECKLIST.filter((i) => !i.aplica || i.aplica(p)).map((i) => ({
    chave: i.chave,
    rotulo: i.rotulo,
    passo: i.passo,
    feito: i.feito ? i.feito(p) : i.chave === 'marca' ? true : p[i.chave as keyof Progresso] === true,
  }))
  const feitos = itens.filter((i) => i.feito).length
  return { itens, feitos, total: itens.length, porcentagem: itens.length === 0 ? 100 : Math.floor((feitos * 100) / itens.length) }
}

/** Cartão do Hub: some em 100% e durante o "ocultar por 7 dias". */
export function mostrarChecklist(porcentagem: number, ocultoAte: string | null | undefined, agora: number): boolean {
  if (porcentagem >= 100) return false
  return !(ocultoAte && Date.parse(ocultoAte) > agora)
}

// ---------------------------------------------------------------- Fase 1 do assistente (PR 4)
/** Flag de front: sem VITE_ONBOARDING_CONFIG=1 o fluxo atual (SelecionarBarraca) segue intacto. */
export function onboardingConfigHabilitado(valor: unknown): boolean {
  return valor === '1'
}

/** Ordem dos passos do assistente: o 9 (taxa de entrega) só existe com Entrega ligada. */
export function ordemDoAssistente(entregaAtiva: boolean): number[] {
  return [1, 2, 3, 4, 5, 6, 7, 8, ...(entregaAtiva ? [9] : []), 10]
}

/** Máscara de CNPJ enquanto digita: 00.000.000/0000-00. */
export function formatarCnpjDigitando(texto: string): string {
  const d = String(texto ?? '').replace(/\D/g, '').slice(0, 14)
  return d
    .replace(/^(\d{2})(\d)/, '$1.$2')
    .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1/$2')
    .replace(/(\d{4})(\d)/, '$1-$2')
}

/** Máscara de CEP enquanto digita: 00000-000. */
export function formatarCepDigitando(texto: string): string {
  const d = String(texto ?? '').replace(/\D/g, '').slice(0, 8)
  return d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d
}

/** Resposta da função consultar-externo (já só com o necessário). */
export type RespostaConsulta<T> = { ok: true; dados: T } | { ok: false; motivo: 'invalido' | 'nao_encontrado' | 'indisponivel' | 'limite' | 'nao_autenticado' }

export function mensagemDaConsulta(motivo: string): string {
  switch (motivo) {
    case 'nao_encontrado':
      return 'Não encontramos esse número. Confira ou preencha à mão.'
    case 'limite':
      return 'Muitas consultas seguidas. Preencha à mão ou tente em alguns minutos.'
    case 'invalido':
      return 'Confira o número digitado.'
    default:
      return 'Não deu para buscar agora. Preencha à mão.'
  }
}

/** Próximo passo da ordem depois do último concluído; ao fim, o último (a tela final). */
export function proximoPassoEm(ordem: readonly number[], etapaConcluida: number): number {
  const seguinte = ordem.find((n) => n > etapaConcluida)
  return seguinte ?? ordem[ordem.length - 1]
}

/** Posição (1-based) do passo na barra de progresso. */
export function posicaoNaOrdem(ordem: readonly number[], numero: number): number {
  const i = ordem.indexOf(numero)
  return i < 0 ? 1 : i + 1
}

/** Erros das RPCs do assistente em frase simples (nunca texto técnico do banco). */
export function mensagemErroOnboarding(mensagem: string | null | undefined): string {
  const m = String(mensagem ?? '')
  if (/horario_vazio/.test(m)) return 'Marque pelo menos um dia em que você abre.'
  if (/horarios_invalidos/.test(m)) return 'Confira os horários. Cada dia aberto precisa de hora de abrir e de fechar.'
  if (/metodos_invalidos/.test(m)) return 'Escolha pelo menos uma forma de pagamento.'
  if (/modos_invalidos/.test(m)) return 'Escolha pelo menos um jeito de atender.'
  if (/obrigatorios_pendentes/.test(m)) return 'Faltam passos obrigatórios (horário, pagamento ou atendimento).'
  if (/já está em uso|ja esta em uso/i.test(m)) return 'Esse endereço já está em uso. Escolha outro.'
  if (/plano Essencial/i.test(m)) return 'O plano Essencial permite só 1 barraca.'
  if (/failed to fetch|network|load failed/i.test(m)) return 'Sem internet. Tente de novo.'
  return 'Não foi possível salvar agora. Tente de novo.'
}

/** Para onde cada pendência do checklist leva. `null` = abre a oferta do kit no próprio Hub (não é uma rota). */
export function rotaDoItemChecklist(slug: string, chave: string): string | null {
  if (chave === 'kit_oferta') return null
  if (chave === 'kit_precos') return `/${slug}/ajustes/cardapio/exemplo`
  return `/${slug}/ajustes${destinoDoItemChecklist(chave) === 'cardapio' ? '/cardapio' : ''}`
}

/** Em qual categoria de Ajustes cada pendência do checklist se resolve (a rota /:slug/ajustes é "conta"). */
export function destinoDoItemChecklist(chave: string): 'conta' | 'cardapio' {
  switch (chave) {
    case 'horario':
    case 'modos':
    case 'item':
    case 'taxa':
    case 'endereco':
      return 'cardapio'
    default:
      return 'conta' // pagamento, cnpj (Fiscal), pix_online, logo (Identidade)
  }
}

// ---------------------------------------------------------------- trava do assistente e resumo final
/** Sem barraca ainda, retoma depois do último passo respondido: categoria => passo 3; só origem => passo 2; nada => 1. */
export function passoInicialSemBarraca(perfil: { origem: string | null; categoria: string | null }): number {
  if (perfil.categoria) return 3
  if (perfil.origem) return 2
  return 1
}

export type BarracaParaGuarda = { barraca_id: string; papel: string; slug: string }

/**
 * Trava real do assistente (atrás de VITE_ONBOARDING_CONFIG): o dono de uma barraca com o assistente por concluir só
 * usa o sistema depois da tela final. `escopo: 'slug'` guarda qualquer URL /:slug/... daquela barraca; `'lista'` guarda
 * a tela de escolher/criar barraca (conta sem barraca ou com barraca pendente). Funcionário e barraca concluída
 * (inclusive toda barraca antiga) nunca são travados. `pendentesIds` já vem sem erro de leitura (falha = vazio).
 */
export function precisaVoltarAoAssistente(p: {
  flagLigada: boolean
  escopo: 'slug' | 'lista'
  slug?: string
  barracas: BarracaParaGuarda[]
  pendentesIds: readonly string[]
}): boolean {
  if (!p.flagLigada) return false
  if (p.escopo === 'lista') return p.barracas.length === 0 || p.pendentesIds.length > 0
  const b = p.barracas.find((x) => x.slug === p.slug)
  return !!b && b.papel === 'dono' && p.pendentesIds.includes(b.barraca_id)
}

const ROTULO_METODO: Record<string, string> = { dinheiro: 'Dinheiro', debito: 'Débito', credito: 'Crédito', pix: 'Pix' }

/** O que o dono informou, em linhas curtas, para a tela "Tudo pronto". Só mostra o que existe. */
export function resumoDoAssistente(
  b: {
    nome: string
    modos_atendimento?: string[] | null
    metodos_pagamento_ativos?: string[] | null
    endereco_rua?: string | null
    endereco_numero?: string | null
    endereco_bairro?: string | null
    endereco_cidade?: string | null
    endereco_uf?: string | null
    cnpj?: string | null
    sem_cnpj?: boolean
    taxa_entrega_habilitada?: boolean
    taxa_entrega_centavos?: number
    kit_aplicado?: string | null
  },
  semana: HorarioDia[],
): { rotulo: string; valor: string }[] {
  const linhas: { rotulo: string; valor: string }[] = []
  const abertos = semana.filter((h) => h.aberto)
  if (abertos.length > 0) {
    const igual = abertos.every((h) => h.abre === abertos[0].abre && h.fecha === abertos[0].fecha)
    linhas.push({
      rotulo: 'Horário',
      valor: `${abertos.length} ${abertos.length === 1 ? 'dia' : 'dias'} por semana${igual ? `, das ${abertos[0].abre} às ${abertos[0].fecha}` : ''}`,
    })
  }
  const metodos = (b.metodos_pagamento_ativos ?? []).map((m) => ROTULO_METODO[m] ?? m)
  if (metodos.length > 0) linhas.push({ rotulo: 'Pagamento', valor: metodos.join(', ') })
  const modos = (b.modos_atendimento ?? []).map((m) => ROTULO_MODO[m as keyof typeof ROTULO_MODO] ?? m)
  if (modos.length > 0) linhas.push({ rotulo: 'Atendimento', valor: modos.join(', ') })
  if ((b.modos_atendimento ?? []).includes('entrega') && b.taxa_entrega_habilitada && (b.taxa_entrega_centavos ?? 0) > 0) {
    linhas.push({ rotulo: 'Taxa de entrega', valor: formatarPrecoBR(b.taxa_entrega_centavos ?? 0) })
  }
  const rua = b.endereco_rua && b.endereco_numero ? `${b.endereco_rua}, ${b.endereco_numero}` : b.endereco_rua
  const cidade = b.endereco_cidade && b.endereco_uf ? `${b.endereco_cidade}/${b.endereco_uf}` : b.endereco_cidade
  const endereco = [rua, b.endereco_bairro, cidade].filter(Boolean).join(' · ')
  if (endereco) linhas.push({ rotulo: 'Endereço', valor: endereco })
  if (b.cnpj) linhas.push({ rotulo: 'CNPJ', valor: formatarCnpjDigitando(b.cnpj) })
  else if (b.sem_cnpj) linhas.push({ rotulo: 'CNPJ', valor: 'Ainda não tenho' })
  if (b.kit_aplicado) linhas.push({ rotulo: 'Cardápio de exemplo', valor: 'montado; falta preencher os preços' })
  return linhas
}
