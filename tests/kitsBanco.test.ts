// Kits iniciais (PR 1, banco): a migration é aditiva, reexecutável e fechada. Rodar: npm test
// A prova de comportamento está em tests/kitsIniciais.staging.mjs (contra o staging).
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'

const sql = readFileSync(new URL('../supabase/migrations/20261021110000_kits_iniciais.sql', import.meta.url), 'utf8')
const semComentarios = sql.replace(/^\s*--.*$/gm, '')

describe('aditiva e reexecutável', () => {
  test('nada de drop table/column, truncate nem delete de dados; não mexe em pedidos', () => {
    assert.doesNotMatch(semComentarios, /drop table|drop column|truncate|delete from/i)
    assert.doesNotMatch(semComentarios, /alter table public\.pedidos|alter table public\.itens_do_pedido/i)
  })
  test('não recria o que é de outra frente (cardápio público, resolver, criar_pedido)', () => {
    assert.doesNotMatch(semComentarios, /function public\.(cardapio_publico|resolver_carrinho|criar_pedido|criar_barraca)/i)
  })
  test('colunas novas: add column if not exists, com default constante', () => {
    assert.match(semComentarios, /perfis_usuario add column if not exists kit_inicial text/)
    assert.match(semComentarios, /barracas add column if not exists kit_aplicado text/)
    assert.match(semComentarios, /barracas add column if not exists kit_aplicado_em timestamptz/)
    assert.match(semComentarios, /itens add column if not exists kit_exemplo boolean not null default false/)
    assert.doesNotMatch(semComentarios, /default (now\(\)|gen_random_uuid\(\)|random\(\))/i)
  })
  test('barraca existente nunca é elegível: backfill false só na primeira execução', () => {
    const bloco = semComentarios.slice(semComentarios.indexOf('do $$'), semComentarios.indexOf('alter table public.barracas add column if not exists kit_aplicado text'))
    assert.match(bloco, /if not exists \(\s+select 1 from information_schema\.columns[\s\S]*?column_name = 'kit_elegivel'/)
    assert.match(bloco, /add column kit_elegivel boolean not null default true/)
    assert.match(bloco, /update public\.barracas set kit_elegivel = false/)
  })
  test('a assinatura antiga de onboarding_salvar_origem sai e a nova tem p_kit com default', () => {
    assert.match(semComentarios, /drop function if exists public\.onboarding_salvar_origem\(text, text, text\)/)
    assert.match(semComentarios, /onboarding_salvar_origem\(p_origem text, p_detalhe text, p_categoria text, p_kit text default null\)/)
  })
})

describe('onboarding_aplicar_kit', () => {
  const corpo = semComentarios.slice(
    semComentarios.indexOf('function public.onboarding_aplicar_kit'),
    semComentarios.indexOf('function public.onboarding_progresso'),
  )
  test('security definer com search_path fixo; só autenticado executa', () => {
    assert.match(corpo, /security definer\s+set search_path = public, pg_temp/)
    assert.match(semComentarios, /'onboarding_aplicar_kit\(uuid, text, jsonb\)'/)
    assert.match(semComentarios, /revoke all on function public\.%s from public, anon/)
    assert.match(semComentarios, /grant execute on function public\.%s to authenticated/)
  })
  test('só o dono aplica e uma aplicação por vez por barraca (lock)', () => {
    assert.match(corpo, /papel = 'dono'/)
    assert.match(corpo, /pg_advisory_xact_lock/)
    assert.match(corpo, /for update/)
  })
  test('estados devolvidos', () => {
    for (const e of ['ok', 'ja_aplicado', 'nao_elegivel', 'catalogo_nao_vazio', 'dados_invalidos', 'sem_acesso', 'nao_autenticado']) {
      assert.match(corpo, new RegExp(`'estado', '${e}'`), e)
    }
  })
  test('recusa catálogo não vazio e só insere (nunca update/delete em categorias, itens ou grupos)', () => {
    assert.match(corpo, /from public\.categorias where barraca_id = p_barraca_id/)
    assert.match(corpo, /from public\.itens where barraca_id = p_barraca_id/)
    assert.match(corpo, /from public\.grupos_opcoes where barraca_id = p_barraca_id/)
    assert.doesNotMatch(corpo, /update public\.(categorias|itens|grupos_opcoes|opcoes|itens_grupos)/)
    assert.doesNotMatch(corpo, /delete from/)
  })
  test('nada nasce vendável: item inativo e sem preço; variação e opção "precisa de preço" inativas', () => {
    assert.match(corpo, /values \(\s+p_barraca_id, btrim\(i ->> 'nome'\), 0, false, v_ordem,/)
    assert.match(corpo, /not \(v_tipo = 'variacao' or coalesce\(o ->> 'precisaPreco', 'false'\) = 'true'\)/)
    assert.match(corpo, /kit_exemplo/)
  })
  test('tetos validados antes de gravar', () => {
    assert.match(corpo, /jsonb_array_length\(c -> 'categorias'\) > 8/)
    assert.match(corpo, /jsonb_array_length\(c -> 'itens'\) not between 1 and 30/)
    assert.match(corpo, /jsonb_array_length\(c -> 'grupos'\) > 6/)
    assert.match(corpo, /jsonb_array_length\(g -> 'opcoes'\) not between 1 and 12/)
    assert.match(corpo, /char_length\(v_nome\) > 60/)
    assert.match(corpo, /v_var > 1/)
    assert.ok(sql.indexOf('-- ---- validação') < sql.indexOf('-- ---- gravação'))
  })
  test('só liga opcoes_habilitado se o kit tem grupos; nunca desliga', () => {
    assert.match(corpo, /v_liga := coalesce\(c ->> 'opcoes_habilitado', 'false'\) = 'true' and v_n_grupos > 0/)
    assert.match(corpo, /opcoes_habilitado = opcoes_habilitado or v_liga/)
  })
})

describe('onboarding_progresso', () => {
  const corpo = semComentarios.slice(semComentarios.indexOf('function public.onboarding_progresso'))
  test('chaves novas só com contagem/booleano e "item" ignora item de kit sem preço', () => {
    assert.match(corpo, /'kit_precos_pendentes'/)
    assert.match(corpo, /'kit_oferta'/)
    assert.match(corpo, /not \(i\.kit_exemplo and i\.preco_centavos = 0\)/)
  })
  test('mantém todas as chaves anteriores', () => {
    for (const k of ['etapa', 'concluido', 'checklist_oculto_ate', 'horario', 'pagamento', 'modos', 'item', 'endereco', 'cnpj', 'entrega_ativa', 'taxa', 'pix_online', 'logo']) {
      assert.match(corpo, new RegExp(`'${k}'`), k)
    }
  })
  test('a oferta respeita "começar do zero" e catálogo vazio', () => {
    assert.match(corpo, /v_kit_inicial is distinct from 'nenhum'/)
  })
})
