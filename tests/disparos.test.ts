// Disparos de WhatsApp: regras puras da tela de campanhas e avaliação. Rodar: npm test
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  DIAS_REATIVACAO,
  fraseMotivo,
  fraseMotivoSalvar,
  fraseDaPrevia,
  fraseErroDisparo,
  fraseVariaveis,
  variaveisInvalidas,
  VARIAVEIS_AVALIACAO,
  VARIAVEIS_CAMPANHA,
  mediaAvaliacoes,
  MAX_TEXTO_DISPARO,
  previaDoTexto,
  resumoCampanha,
  rotuloEstadoCampanha,
  estrelas,
  TEXTOS_SUGERIDOS,
  TIPOS_DISPARO,
  textoDisparoValido,
} from '../src/lib/disparos.ts'

describe('textoDisparoValido', () => {
  test('1 a 600 caracteres depois do trim', () => {
    assert.equal(textoDisparoValido(''), false)
    assert.equal(textoDisparoValido('   \n '), false)
    assert.equal(textoDisparoValido('a'), true)
    assert.equal(textoDisparoValido('a'.repeat(MAX_TEXTO_DISPARO)), true)
    assert.equal(textoDisparoValido('a'.repeat(MAX_TEXTO_DISPARO + 1)), false)
    assert.equal(textoDisparoValido(`  ${'a'.repeat(MAX_TEXTO_DISPARO)}  `), true)
  })
})

describe('constantes', () => {
  test('dias e tipos do contrato; dois textos sugeridos por tipo, cada um válido', () => {
    assert.deepEqual([...DIAS_REATIVACAO], [15, 30, 60, 90])
    assert.deepEqual([...TIPOS_DISPARO], ['reativacao', 'promocao'])
    for (const t of TIPOS_DISPARO) {
      assert.equal(TEXTOS_SUGERIDOS[t].length, 2)
      for (const s of TEXTOS_SUGERIDOS[t]) {
        assert.equal(textoDisparoValido(s), true)
        assert.match(s, /\{nome\}/)
        assert.match(s, /\{barraca\}/)
      }
    }
  })
})

describe('campanha', () => {
  const c = { id: 'c', tipo: 'promocao' as const, estado: 'em_andamento' as const, criada_em: '2026-10-24T12:00:00.000Z', total: 20, enviados: 12, falhas: 1, pulados: 2, na_fila: 5 }
  test('resumo e rótulo de estado', () => {
    assert.equal(resumoCampanha(c), '12 de 20 enviadas')
    assert.equal(resumoCampanha({ ...c, total: 0, enviados: 0 }), '0 de 0 enviadas')
    assert.equal(rotuloEstadoCampanha('em_andamento'), 'Em andamento')
    assert.equal(rotuloEstadoCampanha('concluida'), 'Concluída')
    assert.equal(rotuloEstadoCampanha('cancelada'), 'Cancelada')
    assert.equal(rotuloEstadoCampanha('expirada'), 'Expirada')
  })
})

describe('avaliações', () => {
  test('média vazia e com notas (uma casa decimal)', () => {
    assert.equal(mediaAvaliacoes([]), null)
    assert.equal(mediaAvaliacoes([{ nota: 5 }, { nota: 4 }]), 4.5)
    assert.equal(mediaAvaliacoes([{ nota: 5 }, { nota: 5 }, { nota: 4 }]), 4.7)
    assert.equal(mediaAvaliacoes([{ nota: 1 }]), 1)
  })
  test('estrelas sempre com cinco posições', () => {
    assert.equal(estrelas(5), '★★★★★')
    assert.equal(estrelas(2), '★★☆☆☆')
    assert.equal(estrelas(0), '☆☆☆☆☆')
    assert.equal(estrelas(9), '★★★★★')
  })
})

describe('prévia', () => {
  test('frase de prévia: singular, plural, zero e acima de 500', () => {
    assert.equal(fraseDaPrevia({ total: 1, enviaveis: 1 }), 'Vai para 1 cliente que aceitou receber ofertas.')
    assert.equal(fraseDaPrevia({ total: 12, enviaveis: 12 }), 'Vai para 12 clientes que aceitaram receber ofertas.')
    assert.match(fraseDaPrevia({ total: 0, enviaveis: 0 }), /Nenhum cliente/)
    assert.match(fraseDaPrevia({ total: 800, enviaveis: 500 }), /Mostrando 500 de 800; envie de novo depois/)
  })
  test('texto da prévia preenche {nome} e {barraca} e nunca deixa "Olá !"', () => {
    assert.equal(previaDoTexto('Olá {nome}! Promoção na {barraca}.', 'Loja do Zé'), 'Olá Maria! Promoção na Loja do Zé.')
    assert.doesNotMatch(previaDoTexto('{nome}', 'X'), /\{/)
  })
})

describe('variáveis e erros da function', () => {
  test('campanha aceita {nome} e {barraca}; avaliação também {senha}', () => {
    assert.deepEqual(variaveisInvalidas('Oi {nome} da {barraca}', VARIAVEIS_CAMPANHA), [])
    assert.deepEqual(variaveisInvalidas('Pedido {senha}', VARIAVEIS_CAMPANHA), ['senha'])
    assert.deepEqual(variaveisInvalidas('Pedido {senha} {nome} {barraca}', VARIAVEIS_AVALIACAO), [])
    assert.deepEqual(variaveisInvalidas('{cupom} {cupom}', VARIAVEIS_AVALIACAO), ['cupom'])
    assert.match(fraseVariaveis(['cupom']), /{cupom}/)
  })
  test('erros 403 da function viram frase própria', () => {
    assert.match(fraseErroDisparo('modulo_desligado'), /não está ativo/)
    assert.match(fraseErroDisparo('sem_permissao'), /dono/)
    assert.match(fraseErroDisparo(undefined), /Tente de novo/)
  })
})

describe('mensagens de erro por motivo', () => {
  test('motivos do CRM e do app viram frase em português', () => {
    for (const m of ['whatsapp_desconectado', 'campanha_em_andamento', 'limite_campanhas_dia', 'sem_destinatarios_validos', 'sem_publico']) {
      const f = fraseMotivo(m)
      assert.ok(f.length > 10, m)
      assert.doesNotMatch(f, /_/, m)
    }
    assert.match(fraseMotivo('inventado'), /Não foi possível/)
    assert.match(fraseMotivo(undefined), /Não foi possível/)
  })
  test('estados da RPC da avaliação', () => {
    assert.match(fraseMotivoSalvar('modulo_desligado'), /não está ativo/i)
    assert.match(fraseMotivoSalvar('dados_invalidos'), /500/)
    assert.match(fraseMotivoSalvar('sem_acesso'), /permissão/)
    assert.match(fraseMotivoSalvar('qualquer'), /Não foi possível/)
  })
})
