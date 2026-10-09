// Onboarding de configuração (PR 1, banco): a migration é aditiva, reexecutável e fechada. Rodar: npm test
// A prova de comportamento está em tests/onboardingBanco.staging.mjs.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'

const sql = readFileSync(new URL('../supabase/migrations/20261020100000_onboarding_config.sql', import.meta.url), 'utf8')

describe('aditiva e reexecutável', () => {
  test('nada de drop table/column, truncate nem delete de dados; não mexe em pedidos', () => {
    assert.doesNotMatch(sql, /drop table|drop column|truncate|delete from/i)
    assert.doesNotMatch(sql, /alter table public\.pedidos/i)
  })
  test('colunas novas só com add column if not exists (sem default volátil)', () => {
    const adds = sql.match(/add column(?! if not exists)/gi) ?? []
    // a única exceção é a coluna do backfill, dentro do guard de "primeira execução"
    assert.equal(adds.length, 1)
    assert.match(sql, /if not exists \(\s+select 1 from information_schema\.columns[\s\S]*?column_name = 'onboarding_concluido_em'/)
    const alterBarracas = sql.slice(sql.indexOf('add column if not exists categoria_negocio'), sql.indexOf('do $$'))
    assert.ok(alterBarracas.length > 100)
    assert.doesNotMatch(alterBarracas, /default (now\(\)|gen_random_uuid\(\)|random\(\))/i)
  })
  test('backfill só na primeira execução: marca as barracas antigas como concluídas', () => {
    const bloco = sql.slice(sql.indexOf('if not exists ('), sql.indexOf('end if;'))
    assert.match(bloco, /update public\.barracas set onboarding_concluido_em = criada_em, onboarding_etapa = 10/)
  })
  test('constraints e políticas são recriadas com drop ... if exists', () => {
    assert.match(sql, /drop constraint if exists barracas_categoria_negocio_valida/)
    assert.match(sql, /drop constraint if exists barracas_endereco_valido/)
    assert.match(sql, /drop policy if exists perfis_usuario_proprio_select/)
  })
})

describe('segurança', () => {
  test('perfis_usuario: RLS, só o próprio usuário, nada para anon', () => {
    assert.match(sql, /alter table public\.perfis_usuario enable row level security/)
    assert.match(sql, /revoke all on table public\.perfis_usuario from anon/)
    assert.equal((sql.match(/using \(usuario_id = auth\.uid\(\)\)/g) ?? []).length >= 1, true)
    assert.match(sql, /with check \(usuario_id = auth\.uid\(\)\)/)
  })
  test('onboarding_eventos: fechada para anon e authenticated, sem policy', () => {
    assert.match(sql, /alter table public\.onboarding_eventos enable row level security/)
    assert.match(sql, /revoke all on table public\.onboarding_eventos from anon, authenticated/)
    assert.doesNotMatch(sql, /create policy[^;]*on public\.onboarding_eventos/)
  })
  test('RPCs: revoke de public/anon e grant só a authenticated', () => {
    assert.match(sql, /revoke all on function public\.%s from public, anon/)
    assert.match(sql, /grant execute on function public\.%s to authenticated/)
    for (const f of ['slug_disponivel(text)', 'onboarding_salvar_passo(uuid, integer, jsonb)', 'onboarding_progresso(uuid)', 'onboarding_salvar_origem(text, text, text)']) {
      assert.ok(sql.includes(`'${f}'`), f)
    }
  })
  test('toda RPC exige usuário autenticado', () => {
    for (const nome of ['slug_disponivel', 'onboarding_salvar_origem', 'onboarding_salvar_passo', 'onboarding_progresso', 'onboarding_ocultar_checklist', 'onboarding_evento']) {
      const ini = sql.indexOf(`function public.${nome}(`)
      assert.ok(ini > 0, nome)
      assert.match(sql.slice(ini, ini + 900), /auth\.uid\(\) is null/, nome)
    }
  })
  test('slug_disponivel devolve só booleano (nenhum slug, nome ou id de outra barraca)', () => {
    const f = sql.slice(sql.indexOf('function public.slug_disponivel'), sql.indexOf('-- 6)'))
    assert.match(f, /returns boolean/)
    assert.doesNotMatch(f, /select (slug|nome|id)\b/)
    assert.match(f, /return not exists \(select 1 from public\.barracas where slug = v_slug\)/)
  })
  test('gravar passos exige o DONO da barraca', () => {
    const f = sql.slice(sql.indexOf('function public.onboarding_salvar_passo'), sql.indexOf('-- 9)'))
    assert.match(f, /papel = 'dono'/)
  })
})

describe('validações do banco (não confiam no cliente)', () => {
  const f = sql.slice(sql.indexOf('function public.onboarding_salvar_passo'), sql.indexOf('-- 9)'))
  test('etapa 3 a 10 e campos conhecidos por passo', () => {
    assert.match(f, /p_etapa not between 3 and 10/)
    for (const p of [3, 4, 5, 6, 7, 8, 9, 10]) assert.match(f, new RegExp(`p_etapa = ${p}`), String(p))
  })
  test('métodos e modos: subconjunto da lista e ao menos 1; sem vales', () => {
    assert.match(f, /array\['dinheiro', 'debito', 'credito', 'pix'\]/)
    assert.match(f, /array\['mesa', 'balcao', 'retirada', 'entrega'\]/)
    assert.doesNotMatch(f, /vale/i)
  })
  test('horário obrigatório: ao menos um dia aberto; upsert por (barraca, dia)', () => {
    assert.match(f, /raise exception 'horario_vazio'/)
    assert.match(f, /on conflict \(barraca_id, dia_semana\) do update/)
  })
  test('concluir (10) só com os obrigatórios de fato preenchidos; nunca baixa a etapa', () => {
    assert.match(f, /raise exception 'obrigatorios_pendentes'/)
    assert.match(f, /greatest\(onboarding_etapa, p_etapa::smallint\)/)
  })
  test('CNPJ com 14 dígitos; sem segredo de pagamento no assistente', () => {
    assert.match(f, /!~ '\^\[0-9\]\{14\}\$'/)
    assert.doesNotMatch(sql, /access_token|segredo/i)
  })
})

describe('slug reservado', () => {
  test('lista cobre as rotas estáticas do app e o novo /configurar', () => {
    const lista = sql.slice(sql.indexOf('function public.slug_reservado'), sql.indexOf('-- 5)'))
    for (const r of ['login', 'cadastro', 'onboarding', 'esqueci-senha', 'redefinir-senha', 'assinar', 'e', 'privacidade', 'excluir-conta', 'selecionar-barraca', 'configurar']) {
      assert.ok(lista.includes(`'${r}'`), r)
    }
  })
  test('criar_barraca recusa slug reservado e mantém as regras de antes (plano, formato, duplicado)', () => {
    const f = sql.slice(sql.indexOf('function public.criar_barraca'), sql.indexOf('grant execute on function public.criar_barraca'))
    assert.match(f, /public\.slug_reservado\(v_slug\)/)
    assert.match(f, /public\.cobranca_ativa\(\) and v_plano = 'essencial'/)
    assert.match(f, /\^\[a-z0-9\]\+\(-\[a-z0-9\]\+\)\*\$/)
    assert.match(f, /Esse endereço já está em uso/)
  })
})
