// Kits iniciais (PR 2): lógica pura. Rodar: npm test
// O banco confere os mesmos tetos (tests/kitsBanco.test.ts e tests/kitsIniciais.staging.mjs).
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  KITS,
  KIT_NENHUM,
  TETOS_DO_KIT,
  conteudoDoKit,
  kitDoId,
  kitsRestantes,
  kitsSugeridos,
  mensagemDoEstadoDoKit,
  negociosDaBarraca,
  onboardingKitsHabilitado,
  precoPendente,
  sugestaoDoKit,
} from '../src/lib/kitsIniciais.ts'
import { MODELOS_HORARIO, calcularChecklist, CATEGORIAS } from '../src/lib/onboardingConfig.ts'
import { TODOS_OS_MODOS } from '../src/lib/atendimento.ts'
import { opcaoVazia, rascunhoVazio, validarRascunho } from '../src/lib/opcoesCadastro.ts'

describe('os 8 kits', () => {
  test('são 8, com ids únicos e o rótulo e a descrição preenchidos', () => {
    assert.equal(KITS.length, 8)
    assert.deepEqual(KITS.map((k) => k.id).sort(), ['acai', 'feira', 'hamburgueria', 'lanchonete', 'pastelaria', 'pf', 'pizzaria', 'quermesse'])
    assert.ok(KITS.every((k) => k.rotulo.trim() && k.descricao.trim()))
    assert.ok(!KITS.some((k) => (k.id as string) === KIT_NENHUM))
  })
  test('o valor "começar do zero" é o do CHECK do banco', () => {
    assert.equal(KIT_NENHUM, 'nenhum')
  })
  for (const kit of KITS) {
    describe(kit.id, () => {
      const c = conteudoDoKit(kit.id)
      test('respeita os tetos', () => {
        assert.ok(c.categorias.length >= 1 && c.categorias.length <= TETOS_DO_KIT.categorias)
        assert.ok(c.itens.length >= 1 && c.itens.length <= TETOS_DO_KIT.itens)
        assert.ok(c.grupos.length <= TETOS_DO_KIT.grupos)
        assert.ok(c.grupos.every((g) => g.opcoes.length >= 1 && g.opcoes.length <= TETOS_DO_KIT.opcoesPorGrupo))
        const nomes = [...c.categorias.map((x) => x.nome), ...c.itens.map((x) => x.nome), ...c.grupos.map((x) => x.nome), ...c.grupos.flatMap((g) => g.opcoes.map((o) => o.nome))]
        assert.ok(nomes.every((n) => n.trim() && n.length <= TETOS_DO_KIT.nome))
      })
      test('chaves únicas e no formato aceito pelo banco (a-z, 0-9, _ até 30)', () => {
        const ck = c.categorias.map((x) => x.chave)
        const gk = c.grupos.map((x) => x.chave)
        assert.equal(new Set(ck).size, ck.length)
        assert.equal(new Set(gk).size, gk.length)
        assert.ok([...ck, ...gk].every((k) => /^[a-z0-9_]{1,30}$/.test(k)))
      })
      test('todo item aponta para categoria e grupos que existem, sem repetir grupo, com no máximo uma variação', () => {
        const cats = new Set(c.categorias.map((x) => x.chave))
        const tipos = new Map(c.grupos.map((g) => [g.chave, g.tipo]))
        for (const i of c.itens) {
          assert.ok(cats.has(i.categoria), `${i.nome}: categoria`)
          assert.equal(new Set(i.grupos).size, i.grupos.length, `${i.nome}: grupo repetido`)
          assert.ok(i.grupos.length <= 6)
          assert.ok(i.grupos.every((g) => tipos.has(g)), `${i.nome}: grupo inexistente`)
          assert.ok(i.grupos.filter((g) => tipos.get(g) === 'variacao').length <= 1, `${i.nome}: mais de uma variação`)
        }
      })
      test('toda categoria tem item e todo grupo está ligado a algum item', () => {
        assert.ok(c.categorias.every((x) => c.itens.some((i) => i.categoria === x.chave)))
        assert.ok(c.grupos.every((g) => c.itens.some((i) => i.grupos.includes(g.chave))))
      })
      test('cada grupo passa em validarRascunho (as opções ativas são grátis; as que custam nascem inativas)', () => {
        for (const g of c.grupos) {
          const r = {
            ...rascunhoVazio(g.tipo),
            nome: g.nome,
            obrigatorio: g.obrigatorio,
            maximoTexto: g.tipo === 'adicional' && g.maximo !== null ? String(g.maximo) : '',
            // Espelha o banco: variação e "precisa de preço" nascem inativas; as demais ativas, com preço 0.
            opcoes: g.opcoes.map((o) => ({ ...opcaoVazia(), nome: o.nome, ativo: !(g.tipo === 'variacao' || o.precisaPreco) })),
          }
          // Grupo todo inativo (variação) não tem opção ativa ainda: é o único erro esperado.
          const erros = validarRascunho(r).filter((e) => !/pelo menos uma opção ativa/.test(e))
          assert.deepEqual(erros, [], `${kit.id}/${g.chave}`)
        }
      })
      test('variação sempre obrigatória e escolha única; toda opção de variação precisa de preço', () => {
        for (const g of c.grupos.filter((x) => x.tipo === 'variacao')) {
          assert.equal(g.obrigatorio, true)
          assert.equal(g.maximo, 1)
          assert.ok(g.opcoes.every((o) => o.precisaPreco))
        }
      })
      test('opcoes_habilitado só se o kit usa grupos', () => {
        assert.equal(c.opcoes_habilitado, c.grupos.length > 0)
      })
      test('horário e modos sugeridos existem', () => {
        assert.ok(kit.horario in MODELOS_HORARIO)
        assert.ok(kit.modos.length >= 1 && kit.modos.every((m) => TODOS_OS_MODOS.includes(m)))
      })
      test('o conteúdo é JSON puro (vai para a RPC como jsonb)', () => {
        assert.deepEqual(JSON.parse(JSON.stringify(c)), c)
      })
    })
  }
})

describe('conteúdo específico (spec)', () => {
  test('feira e quermesse não têm grupos', () => {
    assert.equal(conteudoDoKit('feira').grupos.length, 0)
    assert.equal(conteudoDoKit('quermesse').grupos.length, 0)
  })
  test('hamburgueria: Carnes (variação), Ponto da carne obrigatório, Adicionais e Bebida do combo', () => {
    const g = Object.fromEntries(conteudoDoKit('hamburgueria').grupos.map((x) => [x.chave, x]))
    assert.equal(g.carnes.tipo, 'variacao')
    assert.deepEqual(g.carnes.opcoes.map((o) => o.nome), ['Simples', 'Duplo'])
    assert.equal(g.ponto.obrigatorio, true)
    assert.equal(g.ponto.maximo, 1)
    assert.ok(g.adicionais.opcoes.every((o) => o.precisaPreco))
    assert.deepEqual(g.bebida_combo.opcoes.map((o) => o.nome), ['Refrigerante', 'Suco'])
  })
  test('lanchonete NÃO tem variação (variação é sempre obrigatória)', () => {
    assert.ok(conteudoDoKit('lanchonete').grupos.every((g) => g.tipo === 'adicional'))
  })
  test('pizzaria: borda é grupo, não categoria; tamanho sem Gigante no kit', () => {
    const c = conteudoDoKit('pizzaria')
    assert.ok(!c.categorias.some((x) => /borda/i.test(x.nome)))
    assert.deepEqual(c.grupos.find((g) => g.chave === 'tamanho')!.opcoes.map((o) => o.nome), ['Broto', 'Média', 'Grande'])
    assert.equal(c.grupos.find((g) => g.chave === 'borda')!.maximo, 1)
  })
  test('açaí: tamanho em ml, acompanhamentos até 3, coberturas até 2, extras pagos', () => {
    const g = Object.fromEntries(conteudoDoKit('acai').grupos.map((x) => [x.chave, x]))
    assert.deepEqual(g.tamanho.opcoes.map((o) => o.nome), ['300 ml', '500 ml', '700 ml'])
    assert.equal(g.acompanhamentos.maximo, 3)
    assert.equal(g.coberturas.maximo, 2)
    assert.ok(g.extras.opcoes.every((o) => o.precisaPreco))
  })
  test('PF: acompanhamentos limitados a 3; mistura obrigatória de escolha única', () => {
    const g = Object.fromEntries(conteudoDoKit('pf').grupos.map((x) => [x.chave, x]))
    assert.equal(g.acompanhamentos.maximo, 3)
    assert.equal(g.mistura.obrigatorio, true)
    assert.equal(g.mistura.maximo, 1)
    assert.ok(g.mistura.opcoes.every((o) => !o.precisaPreco))
  })
  test('os modos e horários sugeridos seguem a auditoria', () => {
    assert.deepEqual(sugestaoDoKit('feira'), { modos: ['balcao'], horario: 'fim_de_semana' })
    assert.deepEqual(sugestaoDoKit('pizzaria'), { modos: ['mesa', 'balcao', 'retirada', 'entrega'], horario: 'jantar' })
    assert.deepEqual(sugestaoDoKit('acai'), { modos: ['balcao', 'entrega'], horario: 'tarde_noite' })
    assert.equal(sugestaoDoKit('pf')!.horario, 'almoco')
    assert.equal(sugestaoDoKit('nenhum'), null)
    assert.equal(sugestaoDoKit(null), null)
  })
  test('tarde_noite é todos os dias, 12h às 22h', () => {
    assert.deepEqual([...MODELOS_HORARIO.tarde_noite.dias], [0, 1, 2, 3, 4, 5, 6])
    assert.equal(MODELOS_HORARIO.tarde_noite.abre, '12:00')
    assert.equal(MODELOS_HORARIO.tarde_noite.fecha, '22:00')
  })
})

describe('categoria do onboarding → kits', () => {
  test('sugestões da spec', () => {
    const ids = (c: string) => kitsSugeridos(c).map((k) => k.id)
    assert.deepEqual(ids('lanches'), ['lanchonete', 'hamburgueria'])
    assert.deepEqual(ids('pizza'), ['pizzaria'])
    assert.deepEqual(ids('marmita'), ['pf'])
    assert.deepEqual(ids('acai'), ['acai'])
    assert.deepEqual(ids('pastel'), ['pastelaria', 'feira'])
    assert.deepEqual(ids('doces'), ['feira'])
    assert.deepEqual(ids('outra'), ['quermesse', 'feira'])
  })
  test('oriental, bebidas, churrasco e sem categoria não sugerem nenhum', () => {
    for (const c of ['oriental', 'bebidas', 'churrasco', null, undefined, 'inexistente']) assert.equal(kitsSugeridos(c).length, 0, String(c))
  })
  test('para toda categoria do passo 2, sugeridos + restantes completam os 8', () => {
    for (const c of CATEGORIAS) {
      assert.equal(kitsSugeridos(c.chave).length + kitsRestantes(c.chave).length, 8, c.chave)
    }
  })
  test('kitDoId', () => {
    assert.equal(kitDoId('pf')?.rotulo, 'PF / marmita')
    assert.equal(kitDoId('nenhum'), undefined)
  })
  test('conteudoDoKit recusa kit desconhecido', () => {
    assert.throws(() => conteudoDoKit('foguete' as never))
  })
})

describe('checklist com kit', () => {
  const base = { horario: true, pagamento: true, modos: true, item: true, endereco: true, cnpj: true, entrega_ativa: false, pix_online: true, logo: true }
  test('sem as chaves novas (barraca antiga) a porcentagem não muda', () => {
    const r = calcularChecklist(base)
    assert.equal(r.total, 9)
    assert.equal(r.porcentagem, 100)
    assert.ok(!r.itens.some((i) => i.chave.startsWith('kit')))
  })
  test('com preços pendentes aparece o item e a porcentagem cai', () => {
    const r = calcularChecklist({ ...base, kit_precos_pendentes: 3 })
    const item = r.itens.find((i) => i.chave === 'kit_precos')!
    assert.equal(item.feito, false)
    assert.equal(r.total, 10)
    assert.equal(r.porcentagem, 90)
  })
  test('sem pendência e sem oferta, nada aparece; com oferta, aparece', () => {
    assert.equal(calcularChecklist({ ...base, kit_precos_pendentes: 0, kit_oferta: false }).total, 9)
    const r = calcularChecklist({ ...base, kit_oferta: true })
    assert.ok(r.itens.some((i) => i.chave === 'kit_oferta'))
  })
})

describe('apoio', () => {
  test('preço pendente: só item de kit com preço 0', () => {
    assert.equal(precoPendente({ kit_exemplo: true, preco_centavos: 0 }), true)
    assert.equal(precoPendente({ kit_exemplo: true, preco_centavos: 1500 }), false)
    assert.equal(precoPendente({ kit_exemplo: false, preco_centavos: 0 }), false)
    assert.equal(precoPendente({ preco_centavos: 0 }), false)
  })
  test('mensagens dos estados da RPC (nunca texto técnico)', () => {
    for (const e of ['ok', 'ja_aplicado', 'catalogo_nao_vazio', 'nao_elegivel', 'dados_invalidos', 'sem_acesso', 'qualquer']) {
      assert.ok(mensagemDoEstadoDoKit(e).length > 10 && !/rpc|sql|erro/i.test(mensagemDoEstadoDoKit(e)), e)
    }
  })
})

describe('negócio da barraca (ordem dos modelos em Ajustes)', () => {
  test('o kit aplicado vale mais que a categoria', () => {
    assert.deepEqual(negociosDaBarraca('hamburgueria', 'pizza'), ['hamburgueria'])
  })
  test('sem kit, a categoria do onboarding indica o(s) negócio(s)', () => {
    assert.deepEqual(negociosDaBarraca(null, 'lanches'), ['lanchonete', 'hamburgueria'])
    assert.deepEqual(negociosDaBarraca(undefined, 'oriental'), ['oriental'])
    assert.deepEqual(negociosDaBarraca(null, 'marmita'), ['pf'])
  })
  test('sem nada, nenhum negócio (a lista fica toda em "todos os modelos")', () => {
    assert.deepEqual(negociosDaBarraca(null, null), [])
    assert.deepEqual(negociosDaBarraca('nenhum', 'inexistente'), [])
  })
  test('toda categoria do passo 2 tem negócio conhecido pela biblioteca', () => {
    for (const c of CATEGORIAS) assert.ok(negociosDaBarraca(null, c.chave).length >= 1, c.chave)
  })
})

describe('interruptor dos kits', () => {
  test('só o valor 1 liga', () => {
    assert.equal(onboardingKitsHabilitado('1'), true)
    for (const v of [undefined, '', '0', 'true', 1, null]) assert.equal(onboardingKitsHabilitado(v), false, String(v))
  })
})
