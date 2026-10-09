// Biblioteca de modelos de grupos de opções (kits iniciais, PR 2). Lógica PURA, sem React nem Supabase.
// Spec: docs/superpowers/specs/2026-10-09-kits-iniciais-design.md ("Biblioteca de modelos de opções").
//
// Um modelo é um grupo pronto (Tamanho, Ponto da carne, Molhos...) com regra e opções padrão. Serve a dois usos:
//   * Ajustes › Opções › "Usar modelo": `criar()` devolve o rascunho que abre o formulário já preenchido;
//   * kits do onboarding: `conteudoDoGrupo()` devolve o grupo no formato que a RPC `onboarding_aplicar_kit` recebe.
// Opção com `precisaPreco` custa dinheiro (ou, na variação, substitui o preço do item): vem SEM preço e, no kit,
// nasce inativa até o dono preencher. Opção sem isso é grátis por natureza (preço 0).
import { opcaoVazia, rascunhoVazio, type RascunhoGrupo, type TipoGrupo } from './opcoesCadastro.ts'

/** Tipos de negócio a que um modelo pertence: os 8 kits e as categorias do onboarding sem kit. */
export type NegocioId =
  | 'feira'
  | 'quermesse'
  | 'lanchonete'
  | 'acai'
  | 'hamburgueria'
  | 'pizzaria'
  | 'pastelaria'
  | 'pf'
  | 'oriental'
  | 'bebidas'
  | 'churrasco'
  | 'doces'

export const TODOS_OS_NEGOCIOS: NegocioId[] = [
  'feira', 'quermesse', 'lanchonete', 'acai', 'hamburgueria', 'pizzaria', 'pastelaria', 'pf',
  'oriental', 'bebidas', 'churrasco', 'doces',
]

export type OpcaoDeModelo = { nome: string; precisaPreco?: boolean }

export type ModeloDeOpcoes = {
  id: string
  /** Nome na lista "Usar modelo". */
  titulo: string
  descricao: string
  /** Nome do grupo no formulário. */
  nomeGrupo: string
  tipo: TipoGrupo
  obrigatorio: boolean
  /** null = sem limite (só adicional). Variação é sempre 1. */
  maximo: number | null
  opcoes: OpcaoDeModelo[]
  negocios: NegocioId[]
}

/** O grupo no formato da RPC `onboarding_aplicar_kit`. */
export type GrupoDoKit = {
  chave: string
  nome: string
  tipo: TipoGrupo
  obrigatorio: boolean
  maximo: number | null
  opcoes: { nome: string; precisaPreco: boolean }[]
}

const P = true // opção que precisa de preço

type Def = Omit<ModeloDeOpcoes, 'tipo' | 'obrigatorio' | 'maximo'> & Partial<Pick<ModeloDeOpcoes, 'maximo'>>

const variacao = (d: Def): ModeloDeOpcoes => ({ ...d, tipo: 'variacao', obrigatorio: true, maximo: 1 })
const escolhaUnica = (d: Def): ModeloDeOpcoes => ({ ...d, tipo: 'adicional', obrigatorio: true, maximo: 1 })
const opcional = (d: Def): ModeloDeOpcoes => ({ ...d, tipo: 'adicional', obrigatorio: false, maximo: d.maximo ?? null })

export const MODELOS_DE_OPCOES: ModeloDeOpcoes[] = [
  // ---- Variações (tamanho e porte): obrigatórias, escolha única, o preço da opção SUBSTITUI o do item
  variacao({
    id: 'tamanho', titulo: 'Tamanho (P / M / G)', nomeGrupo: 'Tamanho',
    descricao: 'O cliente escolhe um tamanho; o preço de cada um substitui o preço do item.',
    opcoes: [{ nome: 'Pequeno', precisaPreco: P }, { nome: 'Médio', precisaPreco: P }, { nome: 'Grande', precisaPreco: P }],
    negocios: TODOS_OS_NEGOCIOS,
  }),
  variacao({
    id: 'tamanho_pizza', titulo: 'Tamanho da pizza', nomeGrupo: 'Tamanho',
    descricao: 'Broto, média, grande e gigante, cada um com o seu preço.',
    opcoes: [{ nome: 'Broto', precisaPreco: P }, { nome: 'Média', precisaPreco: P }, { nome: 'Grande', precisaPreco: P }, { nome: 'Gigante', precisaPreco: P }],
    negocios: ['pizzaria'],
  }),
  variacao({
    id: 'tamanho_ml', titulo: 'Tamanho em ml', nomeGrupo: 'Tamanho',
    descricao: 'Copos de 300, 500 e 700 ml (açaí, vitaminas, milk-shake).',
    opcoes: [{ nome: '300 ml', precisaPreco: P }, { nome: '500 ml', precisaPreco: P }, { nome: '700 ml', precisaPreco: P }],
    negocios: ['acai', 'bebidas', 'lanchonete'],
  }),
  variacao({
    id: 'tamanho_marmita', titulo: 'Tamanho da marmita', nomeGrupo: 'Tamanho',
    descricao: 'Marmita P, M ou G.',
    opcoes: [{ nome: 'P', precisaPreco: P }, { nome: 'M', precisaPreco: P }, { nome: 'G', precisaPreco: P }],
    negocios: ['pf'],
  }),
  variacao({
    id: 'tamanho_pastel', titulo: 'Tamanho do pastel', nomeGrupo: 'Tamanho',
    descricao: 'Pastel comum ou gigante.',
    opcoes: [{ nome: 'Comum', precisaPreco: P }, { nome: 'Gigante', precisaPreco: P }],
    negocios: ['pastelaria', 'feira', 'quermesse'],
  }),
  variacao({
    id: 'carnes', titulo: 'Quantidade de carnes', nomeGrupo: 'Carnes',
    descricao: 'Hambúrguer simples, duplo ou triplo, cada um com o seu preço.',
    opcoes: [{ nome: 'Simples', precisaPreco: P }, { nome: 'Duplo', precisaPreco: P }, { nome: 'Triplo', precisaPreco: P }],
    negocios: ['hamburgueria', 'lanchonete'],
  }),
  variacao({
    id: 'porcao', titulo: 'Porção (meia / inteira)', nomeGrupo: 'Porção',
    descricao: 'Meia porção ou porção inteira.',
    opcoes: [{ nome: 'Meia', precisaPreco: P }, { nome: 'Inteira', precisaPreco: P }],
    negocios: ['lanchonete', 'hamburgueria', 'churrasco'],
  }),
  variacao({
    id: 'dose_copo', titulo: 'Tamanho do copo', nomeGrupo: 'Copo',
    descricao: 'Copo pequeno, grande ou litro.',
    opcoes: [{ nome: 'Pequeno 300 ml', precisaPreco: P }, { nome: 'Grande 500 ml', precisaPreco: P }, { nome: 'Litro', precisaPreco: P }],
    negocios: ['bebidas', 'feira', 'quermesse'],
  }),

  // ---- Adicionais de escolha obrigatória (min 1, máx 1, preço 0 por natureza)
  escolhaUnica({
    id: 'ponto_carne', titulo: 'Ponto da carne', nomeGrupo: 'Ponto da carne',
    descricao: 'O cliente escolhe o ponto; não muda o preço.',
    opcoes: [{ nome: 'Mal passado' }, { nome: 'Ao ponto' }, { nome: 'Bem passado' }],
    negocios: ['hamburgueria', 'lanchonete', 'churrasco'],
  }),
  escolhaUnica({
    id: 'tipo_pao', titulo: 'Tipo de pão', nomeGrupo: 'Tipo de pão',
    descricao: 'Pão tradicional, australiano ou sem glúten (este com preço).',
    opcoes: [{ nome: 'Tradicional' }, { nome: 'Australiano' }, { nome: 'Sem glúten', precisaPreco: P }],
    negocios: ['hamburgueria', 'lanchonete'],
  }),
  escolhaUnica({
    id: 'mistura_pf', titulo: 'Mistura do PF', nomeGrupo: 'Mistura',
    descricao: 'A mistura do dia: o cliente escolhe uma. Edite as opções quando o cardápio mudar.',
    opcoes: [{ nome: 'Frango grelhado' }, { nome: 'Carne de panela' }, { nome: 'Peixe frito' }],
    negocios: ['pf'],
  }),
  escolhaUnica({
    id: 'bebida_combo', titulo: 'Bebida do combo', nomeGrupo: 'Bebida do combo',
    descricao: 'O cliente escolhe a bebida que acompanha o combo.',
    opcoes: [{ nome: 'Refrigerante' }, { nome: 'Suco' }, { nome: 'Água' }],
    negocios: ['hamburgueria', 'lanchonete', 'pf', 'pastelaria'],
  }),
  escolhaUnica({
    id: 'acompanhamento_combo', titulo: 'Acompanhamento do combo', nomeGrupo: 'Acompanhamento do combo',
    descricao: 'O cliente escolhe o acompanhamento do combo.',
    opcoes: [{ nome: 'Batata frita' }, { nome: 'Salada' }, { nome: 'Arroz' }],
    negocios: ['hamburgueria', 'lanchonete'],
  }),
  escolhaUnica({
    id: 'temperatura', titulo: 'Temperatura', nomeGrupo: 'Temperatura',
    descricao: 'Gelado ou natural.',
    opcoes: [{ nome: 'Gelado' }, { nome: 'Natural' }],
    negocios: ['bebidas', 'feira', 'quermesse', 'acai'],
  }),
  escolhaUnica({
    id: 'sabor_suco', titulo: 'Sabor do suco', nomeGrupo: 'Sabor do suco',
    descricao: 'O cliente escolhe o sabor.',
    opcoes: [{ nome: 'Laranja' }, { nome: 'Limão' }, { nome: 'Maracujá' }, { nome: 'Abacaxi' }],
    negocios: ['bebidas', 'pf', 'lanchonete', 'feira'],
  }),
  escolhaUnica({
    id: 'sabor_doce', titulo: 'Sabor do doce ou bolo', nomeGrupo: 'Sabor',
    descricao: 'O cliente escolhe o sabor.',
    opcoes: [{ nome: 'Chocolate' }, { nome: 'Cenoura' }, { nome: 'Fubá' }],
    negocios: ['doces', 'feira', 'quermesse'],
  }),
  escolhaUnica({
    id: 'leite', titulo: 'Tipo de leite', nomeGrupo: 'Leite',
    descricao: 'Integral, desnatado ou vegetal (este com preço).',
    opcoes: [{ nome: 'Integral' }, { nome: 'Desnatado' }, { nome: 'Vegetal', precisaPreco: P }],
    negocios: ['bebidas'],
  }),

  // ---- Adicionais opcionais
  opcional({
    id: 'adicionais', titulo: 'Adicionais', nomeGrupo: 'Adicionais',
    descricao: 'Extras opcionais somados ao preço do item.',
    opcoes: [{ nome: 'Queijo extra', precisaPreco: P }, { nome: 'Bacon', precisaPreco: P }, { nome: 'Ovo', precisaPreco: P }],
    negocios: TODOS_OS_NEGOCIOS,
  }),
  opcional({
    id: 'adicionais_lanche', titulo: 'Adicionais de lanche', nomeGrupo: 'Adicionais',
    descricao: 'Bacon, cheddar, ovo e cebola caramelizada.',
    opcoes: [{ nome: 'Bacon', precisaPreco: P }, { nome: 'Cheddar', precisaPreco: P }, { nome: 'Ovo', precisaPreco: P }, { nome: 'Cebola caramelizada', precisaPreco: P }],
    negocios: ['hamburgueria', 'lanchonete'],
  }),
  opcional({
    id: 'borda', titulo: 'Borda recheada', nomeGrupo: 'Borda',
    descricao: 'O cliente pode escolher uma borda recheada.', maximo: 1,
    opcoes: [{ nome: 'Catupiry', precisaPreco: P }, { nome: 'Cheddar', precisaPreco: P }, { nome: 'Chocolate', precisaPreco: P }],
    negocios: ['pizzaria'],
  }),
  opcional({
    id: 'molhos', titulo: 'Molhos', nomeGrupo: 'Molhos',
    descricao: 'Até 3 molhos, sem custo.', maximo: 3,
    opcoes: [{ nome: 'Ketchup' }, { nome: 'Maionese' }, { nome: 'Mostarda' }, { nome: 'Barbecue' }, { nome: 'Molho verde' }],
    negocios: ['lanchonete', 'hamburgueria', 'pastelaria', 'feira', 'quermesse'],
  }),
  opcional({
    id: 'acompanhamentos_pf', titulo: 'Acompanhamentos do PF', nomeGrupo: 'Acompanhamentos',
    descricao: 'Até 4 acompanhamentos, sem custo.', maximo: 4,
    opcoes: [{ nome: 'Arroz' }, { nome: 'Feijão' }, { nome: 'Farofa' }, { nome: 'Salada' }],
    negocios: ['pf', 'churrasco'],
  }),
  opcional({
    id: 'bebida_opcional', titulo: 'Bebida (opcional)', nomeGrupo: 'Bebida',
    descricao: 'O cliente pode acrescentar uma bebida.', maximo: 1,
    opcoes: [{ nome: 'Suco', precisaPreco: P }, { nome: 'Refrigerante', precisaPreco: P }],
    negocios: ['pf', 'lanchonete', 'pastelaria'],
  }),
  opcional({
    id: 'acompanhamentos_acai', titulo: 'Acompanhamentos do açaí', nomeGrupo: 'Acompanhamentos',
    descricao: 'Até 3 acompanhamentos grátis.', maximo: 3,
    opcoes: [{ nome: 'Leite em pó' }, { nome: 'Granola' }, { nome: 'Banana' }, { nome: 'Paçoca' }],
    negocios: ['acai'],
  }),
  opcional({
    id: 'coberturas_acai', titulo: 'Coberturas do açaí', nomeGrupo: 'Coberturas',
    descricao: 'Até 2 coberturas grátis.', maximo: 2,
    opcoes: [{ nome: 'Leite condensado' }, { nome: 'Calda de chocolate' }, { nome: 'Calda de morango' }],
    negocios: ['acai'],
  }),
  opcional({
    id: 'extras_acai', titulo: 'Extras do açaí', nomeGrupo: 'Extras',
    descricao: 'Extras pagos.',
    opcoes: [{ nome: 'Nutella', precisaPreco: P }, { nome: 'Morango', precisaPreco: P }, { nome: 'Ovomaltine', precisaPreco: P }],
    negocios: ['acai'],
  }),
  opcional({
    id: 'preferencias_bebida', titulo: 'Preferências da bebida', nomeGrupo: 'Preferências',
    descricao: 'Sem gelo, pouco gelo, sem açúcar (até 2).', maximo: 2,
    opcoes: [{ nome: 'Sem gelo' }, { nome: 'Pouco gelo' }, { nome: 'Sem açúcar' }],
    negocios: ['bebidas', 'feira', 'quermesse', 'acai'],
  }),
  opcional({
    id: 'extras_oriental', titulo: 'Extras de comida oriental', nomeGrupo: 'Extras',
    descricao: 'Shoyu, wasabi, gengibre e hashi, sem custo.',
    opcoes: [{ nome: 'Shoyu extra' }, { nome: 'Wasabi' }, { nome: 'Gengibre' }, { nome: 'Hashi' }],
    negocios: ['oriental'],
  }),
  opcional({
    id: 'acompanhamentos_churrasco', titulo: 'Acompanhamentos do churrasco', nomeGrupo: 'Acompanhamentos',
    descricao: 'Até 3 acompanhamentos, sem custo.', maximo: 3,
    opcoes: [{ nome: 'Vinagrete' }, { nome: 'Farofa' }, { nome: 'Pão de alho' }],
    negocios: ['churrasco'],
  }),
  opcional({
    id: 'embalagem_presente', titulo: 'Embalagem para presente', nomeGrupo: 'Embalagem',
    descricao: 'Caixa ou sacola de presente.', maximo: 1,
    opcoes: [{ nome: 'Caixa de presente', precisaPreco: P }, { nome: 'Sacola de papel', precisaPreco: P }],
    negocios: ['doces'],
  }),
]

export function modeloDeOpcoes(id: string): ModeloDeOpcoes | undefined {
  return MODELOS_DE_OPCOES.find((m) => m.id === id)
}

/** Rascunho do formulário de grupo (Ajustes). Preços em branco: o dono completa antes de salvar. */
export function rascunhoDoModelo(m: ModeloDeOpcoes): RascunhoGrupo {
  return {
    ...rascunhoVazio(m.tipo),
    nome: m.nomeGrupo,
    obrigatorio: m.obrigatorio,
    maximoTexto: m.tipo === 'adicional' && m.maximo !== null ? String(m.maximo) : '',
    opcoes: m.opcoes.map((o) => ({ ...opcaoVazia(), nome: o.nome })),
  }
}

/** Lista de "Usar modelo": primeiro os do tipo de negócio, depois os demais (cada grupo em ordem alfabética). */
export function modelosParaNegocio(negocio: string | null | undefined): { doNegocio: ModeloDeOpcoes[]; outros: ModeloDeOpcoes[] } {
  const ordenar = (l: ModeloDeOpcoes[]) => [...l].sort((a, b) => a.titulo.localeCompare(b.titulo, 'pt-BR'))
  // Um modelo que serve a todos os negócios (Tamanho, Adicionais) vai primeiro, mesmo sem negócio escolhido.
  const doNegocio = MODELOS_DE_OPCOES.filter((m) => negocio && (m.negocios as string[]).includes(negocio))
  const ids = new Set(doNegocio.map((m) => m.id))
  return { doNegocio: ordenar(doNegocio), outros: ordenar(MODELOS_DE_OPCOES.filter((m) => !ids.has(m.id))) }
}

/** Busca por nome ou descrição, sem acento nem maiúscula. */
export function buscarModelos(texto: string, lista: ModeloDeOpcoes[] = MODELOS_DE_OPCOES): ModeloDeOpcoes[] {
  const limpa = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
  const q = limpa(texto)
  if (!q) return lista
  return lista.filter((m) => limpa(`${m.titulo} ${m.nomeGrupo} ${m.descricao} ${m.opcoes.map((o) => o.nome).join(' ')}`).includes(q))
}

/** Ajustes do kit sobre um modelo: ficar só com algumas opções, outro limite ou outro nome. */
export type AjusteDeModelo = { nome?: string; somente?: string[]; maximo?: number | null }

/** O grupo do modelo, já com os ajustes, no formato que a RPC do kit recebe. */
export function conteudoDoGrupo(chave: string, m: ModeloDeOpcoes, ajuste: AjusteDeModelo = {}): GrupoDoKit {
  const opcoes = ajuste.somente ? m.opcoes.filter((o) => ajuste.somente!.includes(o.nome)) : m.opcoes
  return {
    chave,
    nome: ajuste.nome ?? m.nomeGrupo,
    tipo: m.tipo,
    obrigatorio: m.obrigatorio,
    maximo: m.tipo === 'variacao' ? 1 : ajuste.maximo !== undefined ? ajuste.maximo : m.maximo,
    opcoes: opcoes.map((o) => ({ nome: o.nome, precisaPreco: o.precisaPreco === true })),
  }
}
