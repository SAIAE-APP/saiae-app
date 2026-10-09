// Kits iniciais por tipo de negócio (PR 2): lógica PURA, sem React nem Supabase.
// Spec: docs/superpowers/specs/2026-10-09-kits-iniciais-design.md
//
// Um kit é uma receita: categorias, itens de exemplo e grupos de opções (modelos de `modelosDeOpcoes.ts`), mais o
// horário e os modos de atendimento típicos do tipo. O banco (`onboarding_aplicar_kit`) só insere, só com catálogo
// vazio, e NADA nasce vendável: itens inativos e sem preço, opções que custam dinheiro inativas.
// Horário e modos são só SUGESTÃO nos passos 6 e 8 (o dono confirma); o kit não os grava.
import type { TipoAtendimento } from '../types/database'
import {
  conteudoDoGrupo,
  modeloDeOpcoes,
  type AjusteDeModelo,
  type GrupoDoKit,
} from './modelosDeOpcoes.ts'
import type { ChaveModeloHorario } from './onboardingConfig.ts'

export type KitId = 'feira' | 'quermesse' | 'lanchonete' | 'acai' | 'hamburgueria' | 'pizzaria' | 'pastelaria' | 'pf'

/** Valor "Começar do zero" guardado em `perfis_usuario.kit_inicial`. */
export const KIT_NENHUM = 'nenhum'

/** Tetos que o banco também confere (migration 20261021110000). */
export const TETOS_DO_KIT = { categorias: 8, itens: 30, grupos: 6, opcoesPorGrupo: 12, nome: 60 } as const

export type KitDef = {
  id: KitId
  rotulo: string
  /** Uma linha: o que vem no kit (aparece no chip de escolha). */
  descricao: string
  /** O que o app ainda NÃO resolve neste tipo de negócio (aparece na escolha do kit). */
  aviso: string | null
  modos: TipoAtendimento[]
  horario: ChaveModeloHorario
  categorias: { chave: string; nome: string }[]
  grupos: { chave: string; modelo: string; ajuste?: AjusteDeModelo }[]
  itens: { nome: string; categoria: string; grupos?: string[] }[]
}

/** O corpo que a RPC `onboarding_aplicar_kit` recebe em `p_conteudo`. */
export type ConteudoDoKit = {
  categorias: { chave: string; nome: string }[]
  grupos: GrupoDoKit[]
  itens: { nome: string; categoria: string; grupos: string[] }[]
  opcoes_habilitado: boolean
}

export const KITS: KitDef[] = [
  {
    id: 'feira',
    rotulo: 'Barraca de feira',
    descricao: 'Salgados, doces e bebidas para vender rápido no balcão.',
    aviso: 'Venda por peso ainda não existe.',
    modos: ['balcao'],
    horario: 'fim_de_semana',
    categorias: [
      { chave: 'salgados', nome: 'Salgados' },
      { chave: 'doces', nome: 'Doces' },
      { chave: 'bebidas', nome: 'Bebidas' },
    ],
    grupos: [],
    itens: [
      { nome: 'Pastel de carne', categoria: 'salgados' },
      { nome: 'Pastel de queijo', categoria: 'salgados' },
      { nome: 'Bolo (fatia)', categoria: 'doces' },
      { nome: 'Caldo de cana', categoria: 'bebidas' },
      { nome: 'Refrigerante', categoria: 'bebidas' },
    ],
  },
  {
    id: 'quermesse',
    rotulo: 'Quermesse ou festa',
    descricao: 'Fichas, salgados, doces e bebidas para o balcão da festa.',
    aviso: 'A ficha aqui é um item comum. Saldo de ficha e visão do evento ainda não existem.',
    modos: ['balcao'],
    horario: 'fim_de_semana',
    categorias: [
      { chave: 'fichas', nome: 'Fichas' },
      { chave: 'salgados', nome: 'Salgados' },
      { chave: 'doces', nome: 'Doces' },
      { chave: 'bebidas', nome: 'Bebidas' },
    ],
    grupos: [],
    itens: [
      { nome: 'Ficha', categoria: 'fichas' },
      { nome: 'Pastel', categoria: 'salgados' },
      { nome: 'Bolo (fatia)', categoria: 'doces' },
      { nome: 'Refrigerante', categoria: 'bebidas' },
      { nome: 'Suco', categoria: 'bebidas' },
    ],
  },
  {
    id: 'lanchonete',
    rotulo: 'Lanchonete',
    descricao: 'Lanches, porções e bebidas, com adicionais.',
    aviso: 'Conta aberta por mesa ainda não existe: cada envio é um pedido novo.',
    modos: ['mesa', 'balcao', 'retirada'],
    horario: 'almoco',
    categorias: [
      { chave: 'lanches', nome: 'Lanches' },
      { chave: 'porcoes', nome: 'Porções' },
      { chave: 'bebidas', nome: 'Bebidas' },
      { chave: 'sobremesas', nome: 'Sobremesas' },
    ],
    grupos: [{ chave: 'adicionais', modelo: 'adicionais' }],
    itens: [
      { nome: 'X-Burger', categoria: 'lanches', grupos: ['adicionais'] },
      { nome: 'X-Salada', categoria: 'lanches', grupos: ['adicionais'] },
      { nome: 'Batata frita', categoria: 'porcoes' },
      { nome: 'Refrigerante', categoria: 'bebidas' },
      { nome: 'Suco', categoria: 'bebidas' },
      { nome: 'Pudim', categoria: 'sobremesas' },
    ],
  },
  {
    id: 'acai',
    rotulo: 'Açaí',
    descricao: 'Açaí e cremes com tamanho, acompanhamentos, coberturas e extras.',
    aviso: 'Venda por peso ainda não existe. Para açaí no quilo, use o valor livre quando ele chegar.',
    modos: ['balcao', 'entrega'],
    horario: 'tarde_noite',
    categorias: [
      { chave: 'acai', nome: 'Açaí' },
      { chave: 'cremes', nome: 'Cremes' },
      { chave: 'bebidas', nome: 'Bebidas' },
    ],
    grupos: [
      { chave: 'tamanho', modelo: 'tamanho_ml' },
      { chave: 'acompanhamentos', modelo: 'acompanhamentos_acai' },
      { chave: 'coberturas', modelo: 'coberturas_acai' },
      { chave: 'extras', modelo: 'extras_acai' },
    ],
    itens: [
      { nome: 'Açaí no copo', categoria: 'acai', grupos: ['tamanho', 'acompanhamentos', 'coberturas', 'extras'] },
      { nome: 'Creme de cupuaçu', categoria: 'cremes', grupos: ['tamanho', 'coberturas', 'extras'] },
      { nome: 'Refrigerante', categoria: 'bebidas' },
    ],
  },
  {
    id: 'hamburgueria',
    rotulo: 'Hamburgueria',
    descricao: 'Hambúrgueres e combos com carnes, ponto da carne e adicionais.',
    aviso: 'O combo escolhe a bebida, mas não baixa o estoque dos componentes.',
    modos: ['mesa', 'balcao', 'entrega'],
    horario: 'jantar',
    categorias: [
      { chave: 'burgers', nome: 'Hambúrgueres' },
      { chave: 'combos', nome: 'Combos' },
      { chave: 'porcoes', nome: 'Porções' },
      { chave: 'bebidas', nome: 'Bebidas' },
    ],
    grupos: [
      { chave: 'carnes', modelo: 'carnes', ajuste: { somente: ['Simples', 'Duplo'] } },
      { chave: 'ponto', modelo: 'ponto_carne' },
      { chave: 'adicionais', modelo: 'adicionais_lanche' },
      { chave: 'bebida_combo', modelo: 'bebida_combo', ajuste: { somente: ['Refrigerante', 'Suco'] } },
    ],
    itens: [
      { nome: 'Burger clássico', categoria: 'burgers', grupos: ['carnes', 'ponto', 'adicionais'] },
      { nome: 'Burger bacon', categoria: 'burgers', grupos: ['carnes', 'ponto', 'adicionais'] },
      { nome: 'Combo clássico', categoria: 'combos', grupos: ['ponto', 'adicionais', 'bebida_combo'] },
      { nome: 'Batata frita', categoria: 'porcoes' },
      { nome: 'Refrigerante', categoria: 'bebidas' },
    ],
  },
  {
    id: 'pizzaria',
    rotulo: 'Pizzaria',
    descricao: 'Pizzas salgadas e doces com tamanho e borda.',
    aviso: 'Meio a meio e preço da borda por tamanho ainda não existem. O kit não inventa um contorno para isso.',
    modos: ['mesa', 'balcao', 'retirada', 'entrega'],
    horario: 'jantar',
    categorias: [
      { chave: 'salgadas', nome: 'Pizzas salgadas' },
      { chave: 'doces', nome: 'Pizzas doces' },
      { chave: 'bebidas', nome: 'Bebidas' },
    ],
    grupos: [
      { chave: 'tamanho', modelo: 'tamanho_pizza', ajuste: { somente: ['Broto', 'Média', 'Grande'] } },
      { chave: 'borda', modelo: 'borda' },
    ],
    itens: [
      { nome: 'Calabresa', categoria: 'salgadas', grupos: ['tamanho', 'borda'] },
      { nome: 'Mussarela', categoria: 'salgadas', grupos: ['tamanho', 'borda'] },
      { nome: 'Frango com catupiry', categoria: 'salgadas', grupos: ['tamanho', 'borda'] },
      { nome: 'Chocolate', categoria: 'doces', grupos: ['tamanho', 'borda'] },
      { nome: 'Refrigerante 2 L', categoria: 'bebidas' },
    ],
  },
  {
    id: 'pastelaria',
    rotulo: 'Pastelaria',
    descricao: 'Pastéis por sabor, com tamanho comum ou gigante.',
    aviso: 'Combo de 3 pastéis com sabores repetidos e pastel meio a meio ainda não existem.',
    modos: ['balcao', 'retirada'],
    horario: 'fim_de_semana',
    categorias: [
      { chave: 'salgados', nome: 'Pastéis salgados' },
      { chave: 'doces', nome: 'Pastéis doces' },
      { chave: 'bebidas', nome: 'Bebidas' },
    ],
    grupos: [{ chave: 'tamanho', modelo: 'tamanho_pastel' }],
    itens: [
      { nome: 'Pastel de carne', categoria: 'salgados', grupos: ['tamanho'] },
      { nome: 'Pastel de queijo', categoria: 'salgados', grupos: ['tamanho'] },
      { nome: 'Pastel de frango com catupiry', categoria: 'salgados', grupos: ['tamanho'] },
      { nome: 'Pastel de pizza', categoria: 'salgados', grupos: ['tamanho'] },
      { nome: 'Pastel de chocolate', categoria: 'doces', grupos: ['tamanho'] },
      { nome: 'Caldo de cana', categoria: 'bebidas' },
      { nome: 'Refrigerante', categoria: 'bebidas' },
    ],
  },
  {
    id: 'pf',
    rotulo: 'PF / marmita',
    descricao: 'Prato feito e marmita com tamanho, mistura e acompanhamentos.',
    aviso: 'Cardápio do dia e venda por quilo ainda não existem. Para mudar a mistura do dia, edite o grupo Mistura.',
    modos: ['balcao', 'retirada', 'entrega'],
    horario: 'almoco',
    categorias: [
      { chave: 'pratos', nome: 'Pratos do dia' },
      { chave: 'marmitas', nome: 'Marmitas' },
      { chave: 'bebidas', nome: 'Bebidas' },
      { chave: 'sobremesas', nome: 'Sobremesas' },
    ],
    grupos: [
      { chave: 'tamanho', modelo: 'tamanho_marmita' },
      { chave: 'mistura', modelo: 'mistura_pf' },
      { chave: 'acompanhamentos', modelo: 'acompanhamentos_pf', ajuste: { maximo: 3 } },
      { chave: 'bebida', modelo: 'bebida_opcional' },
    ],
    itens: [
      { nome: 'Prato feito', categoria: 'pratos', grupos: ['mistura', 'acompanhamentos', 'bebida'] },
      { nome: 'Marmita', categoria: 'marmitas', grupos: ['tamanho', 'mistura', 'acompanhamentos', 'bebida'] },
      { nome: 'Suco', categoria: 'bebidas' },
      { nome: 'Refrigerante', categoria: 'bebidas' },
      { nome: 'Sobremesa do dia', categoria: 'sobremesas' },
    ],
  },
]

export function kitDoId(id: string | null | undefined): KitDef | undefined {
  return KITS.find((k) => k.id === id)
}

/** Categoria do passo 2 do onboarding → kits sugeridos (os demais ficam em "Ver outros modelos"). */
const KITS_POR_CATEGORIA: Record<string, KitId[]> = {
  lanches: ['lanchonete', 'hamburgueria'],
  pizza: ['pizzaria'],
  marmita: ['pf'],
  acai: ['acai'],
  pastel: ['pastelaria', 'feira'],
  doces: ['feira'],
  outra: ['quermesse', 'feira'],
}

export function kitsSugeridos(categoria: string | null | undefined): KitDef[] {
  const ids = (categoria && KITS_POR_CATEGORIA[categoria]) || []
  return ids.map((id) => kitDoId(id)!).filter(Boolean)
}

/** Os kits que não foram sugeridos, para "Ver outros modelos". */
export function kitsRestantes(categoria: string | null | undefined): KitDef[] {
  const sugeridos = new Set(kitsSugeridos(categoria).map((k) => k.id))
  return KITS.filter((k) => !sugeridos.has(k.id))
}

/** Horário e modos para PRÉ-SELECIONAR nos passos 6 e 8. O kit nunca os grava sozinho. */
export function sugestaoDoKit(id: string | null | undefined): { modos: TipoAtendimento[]; horario: ChaveModeloHorario } | null {
  const k = kitDoId(id)
  return k ? { modos: [...k.modos], horario: k.horario } : null
}

/** O JSON que a RPC recebe: grupos montados dos modelos da biblioteca, com os ajustes do kit. */
export function conteudoDoKit(id: KitId): ConteudoDoKit {
  const k = kitDoId(id)
  if (!k) throw new Error(`Kit desconhecido: ${id}`)
  const grupos = k.grupos.map((g) => {
    const modelo = modeloDeOpcoes(g.modelo)
    if (!modelo) throw new Error(`Modelo desconhecido no kit ${id}: ${g.modelo}`)
    return conteudoDoGrupo(g.chave, modelo, g.ajuste)
  })
  return {
    categorias: k.categorias.map((c) => ({ ...c })),
    grupos,
    itens: k.itens.map((i) => ({ nome: i.nome, categoria: i.categoria, grupos: [...(i.grupos ?? [])] })),
    opcoes_habilitado: grupos.length > 0,
  }
}

/** Itens do kit que ainda não têm preço (para a tela "Revisar cardápio de exemplo"). */
export function precoPendente(item: { kit_exemplo?: boolean; preco_centavos: number }): boolean {
  return item.kit_exemplo === true && item.preco_centavos === 0
}

/** Mensagens simples para os estados da RPC. */
export function mensagemDoEstadoDoKit(estado: string): string {
  switch (estado) {
    case 'ok':
      return 'Montamos um cardápio de exemplo. Você completa os preços no final.'
    case 'ja_aplicado':
      return 'O cardápio de exemplo já foi montado.'
    case 'catalogo_nao_vazio':
      return 'Seu cardápio já tem itens, então não montamos o exemplo para não misturar.'
    case 'nao_elegivel':
      return 'O cardápio de exemplo só vale para contas novas.'
    default:
      return 'Não deu para montar o cardápio de exemplo agora. Você faz isso depois no Hub.'
  }
}
