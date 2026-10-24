// Módulos pagos, tarefa 3: funções do servidor que liam as flags antigas passam a exigir modulo_ativo.
// Migrations reais no PGlite (as tabelas de pedido/cardápio são stubs mínimos). Rodar: npm test
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { after, before, describe, test } from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const sql = (n: string) => readFileSync(new URL(`../supabase/migrations/${n}`, import.meta.url), 'utf8')

const DONO = 'a1000000-0000-4000-8000-000000000001'
const B = 'b1000000-0000-4000-8000-000000000001'
const PEDIDO = 'c1000000-0000-4000-8000-000000000001'
const EVENTO = 'd1000000-0000-4000-8000-000000000001'

let db: PGlite

async function como(papel: 'authenticated' | 'service_role', uid: string | null = DONO) {
  await db.exec(`reset role; select set_config('test.uid', '${uid ?? ''}', false); set role ${papel}`)
}
async function modulos(...linhas: Array<[string, string]>) {
  await db.exec(`reset role; delete from public.modulos_barraca where barraca_id = '${B}'`)
  for (const [modulo, estado] of linhas) {
    await db.exec(`insert into public.modulos_barraca (barraca_id, modulo, estado, origem)
      values ('${B}', '${modulo}', '${estado}', 'cortesia')`)
  }
}
async function um<T>(q: string) {
  return (await db.query<{ r: T }>(q)).rows[0].r
}

before(async () => {
  db = new PGlite()
  await db.exec(`
    create role authenticated; create role anon; create role service_role;
    create schema auth; grant usage on schema auth to authenticated, anon;
    create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
    grant usage on schema public to authenticated, anon, service_role;
    create table public.barracas (
      id uuid primary key default gen_random_uuid(), slug text, nome text,
      fiscal_habilitado boolean not null default false,
      ia_habilitada boolean not null default false,
      ia_whatsapp_dono text, ia_whatsapp_dono_confirmado_em timestamptz, ia_codigo text,
      whatsapp_pedidos text, whatsapp_avisos jsonb,
      modos_atendimento text[], pagar_na_entrega_habilitado boolean, pagamento_online_habilitado boolean,
      perfil_cliente_obrigatorio boolean, bloquear_fora_do_horario boolean, fuso text, opcoes_habilitado boolean default false
    );
    create table public.usuarios_barracas (usuario_id uuid, barraca_id uuid, papel text);
    create table public.superadmins (usuario_id uuid primary key);
    create function public.usuario_tem_acesso_barraca(p uuid) returns boolean language sql stable security definer as $$
      select exists (select 1 from public.usuarios_barracas where usuario_id = auth.uid() and barraca_id = p) $$;
    create function public.sou_superadmin() returns boolean language sql stable security definer as $$
      select exists (select 1 from public.superadmins where usuario_id = auth.uid()) $$;
    create function public.ia_gerar_codigo() returns text language sql as $$ select 'COD123' $$;
    -- stubs mínimos do que as funções recriadas consultam
    create table public.clientes_finais (id uuid primary key default gen_random_uuid(), barraca_id uuid, nome text, telefone text,
      origem text, criado_em timestamptz not null default now(), atualizado_em timestamptz, consentimento_marketing_em timestamptz,
      unique (barraca_id, telefone));
    create table public.pedidos (id uuid primary key, barraca_id uuid, senha int, tipo_atendimento text, viagem boolean, mesa text,
      taxa_entrega_centavos int, desconto_cupom_centavos int, cupom_codigo text, metodo_pagamento text, cliente_nome text,
      entrega_nome text, entrega_telefone text, cliente_telefone text, cliente_id uuid, status text, criado_em timestamptz default now());
    create table public.itens_do_pedido (id serial primary key, pedido_id uuid, nome_item text, quantidade int,
      preco_centavos_unitario int, observacao text, opcoes jsonb, removido boolean default false);
    create table public.eventos_saida (id uuid primary key, pedido_id uuid, barraca_id uuid, tipo text, sequence int,
      ocorrido_em timestamptz default now(), status_pedido text);
    create table public.horarios_funcionamento (barraca_id uuid, dia_semana int, aberto boolean, hora_abertura time, hora_fechamento time);
    create table public.categorias (id uuid primary key, nome text, ordem int);
    create table public.itens (id uuid primary key, barraca_id uuid, nome text, descricao text, preco_centavos int, categoria_id uuid,
      esgotado boolean, ordem int, ativo boolean, preco_aberto boolean);
    create table public.itens_grupos (item_id uuid, grupo_id uuid, barraca_id uuid, ordem int);
    create table public.grupos_opcoes (id uuid primary key, barraca_id uuid, nome text, tipo text, min_escolhas int, max_escolhas int,
      ordem int, ativo boolean);
    create table public.opcoes (id uuid primary key, grupo_id uuid, barraca_id uuid, nome text, preco_centavos int, esgotado boolean,
      ordem int, ativo boolean);
    insert into public.barracas (id, slug, nome, whatsapp_avisos) values ('${B}', 'loja', 'Loja', '{"recebido": true}');
    insert into public.usuarios_barracas values ('${DONO}', '${B}', 'dono');
    insert into public.pedidos (id, barraca_id, senha, status) values ('${PEDIDO}', '${B}', 7, 'novo');
    insert into public.eventos_saida (id, pedido_id, barraca_id, tipo, sequence, status_pedido)
      values ('${EVENTO}', '${PEDIDO}', '${B}', 'order.created', 1, 'novo');
  `)
  await db.exec(sql('20261101100000_disparos_whatsapp.sql'))
  await db.exec(sql('20261103100000_modulos_barraca.sql'))
  await db.exec(sql('20261103120000_modulos_consumidores.sql'))
  await db.exec(`reset role; update public.barracas set avaliacao_ativa = true, avaliacao_texto = 'Oi {nome}' where id = '${B}'`)
})

after(async () => {
  await db.close()
})

const config = () => um<{ ativo: boolean }>(`select public.integracao_avaliacao_config('${B}') as r`)
const salvar = () => um<{ estado: string }>(`select public.whatsapp_avaliacao_salvar('${B}', true, 'Oi {nome}') as r`)
const contagem = () => db.query(`select public.disparos_publico_contagem('${B}', 'promocao', null) as r`)

describe('consumidores exigem módulo vigente', () => {
  test('avaliação: config.ativo é falso sem módulo avisos mesmo com avaliacao_ativa', async () => {
    await modulos()
    // a flag antiga de disparos ligada não vale mais
    await db.exec(`update public.barracas set whatsapp_disparos_habilitado = true where id = '${B}'`)
    assert.equal((await config()).ativo, false)
    await modulos(['whatsapp_avisos', 'suspenso'])
    assert.equal((await config()).ativo, false)
  })

  test('avaliação: config.ativo é verdadeiro com avisos vigente, sem depender de disparos', async () => {
    await modulos(['whatsapp_avisos', 'ativo'])
    await db.exec(`update public.barracas set whatsapp_disparos_habilitado = false where id = '${B}'`)
    assert.equal((await config()).ativo, true)
  })

  test('avaliacao_salvar recusa sem módulo', async () => {
    await modulos()
    await como('authenticated')
    assert.equal((await salvar()).estado, 'modulo_desligado')
    await db.exec('reset role')
    await modulos(['whatsapp_avisos', 'ativo'])
    await como('authenticated')
    assert.equal((await salvar()).estado, 'ok')
  })

  test('disparos_publico_contagem recusa sem módulo disparos e com avisos suspenso', async () => {
    await como('service_role')
    await modulos(['whatsapp_avisos', 'ativo'])
    await como('service_role')
    await assert.rejects(contagem(), /modulo_desligado/)
    await assert.rejects(db.query(`select * from public.disparos_publico('${B}', 'promocao', null)`), /modulo_desligado/)
    await modulos(['whatsapp_avisos', 'suspenso'], ['whatsapp_disparos', 'ativo'])
    await como('service_role')
    await assert.rejects(contagem(), /modulo_desligado/)
    await modulos(['whatsapp_avisos', 'ativo'], ['whatsapp_disparos', 'ativo'])
    await como('service_role')
    assert.equal((await contagem()).rows[0].r, 0)
  })

  test('registrar_contato_marketing recusa sem módulo disparos', async () => {
    await modulos(['whatsapp_avisos', 'ativo'])
    await como('authenticated')
    const r = (await um<{ estado: string }>(`select public.registrar_contato_marketing('${B}', '11999990000', 'Ana') as r`)).estado
    assert.equal(r, 'modulo_desligado')
    await modulos(['whatsapp_avisos', 'ativo'], ['whatsapp_disparos', 'ativo'])
    await como('authenticated')
    assert.equal((await um<{ estado: string }>(`select public.registrar_contato_marketing('${B}', '11999990000', 'Ana') as r`)).estado, 'ok')
  })

  test('eventos saem sem data.avisos quando avisos não vigente', async () => {
    const evento = () => um<{ data: { avisos?: unknown } }>(`select public.montar_evento_saida('${EVENTO}') as r`)
    await modulos(['whatsapp_avisos', 'suspenso'])
    assert.equal('avisos' in (await evento()).data, false)
    await modulos(['whatsapp_avisos', 'ativo'])
    assert.deepEqual((await evento()).data.avisos, { recebido: true })
  })

  test('cardápio v1 devolve ia_habilitada=false sem módulo bot', async () => {
    const ia = async () => (await um<{ loja: { ia_habilitada: boolean } }>(`select public.integracao_cardapio('${B}') as r`)).loja.ia_habilitada
    const ligar = () => db.exec(`reset role; update public.barracas set ia_habilitada = true where id = '${B}'`)
    await modulos()
    await ligar()
    assert.equal(await ia(), false)
    await modulos(['whatsapp_bot', 'ativo'])
    await ligar() // o espelho desliga ia ao trocar módulos
    assert.equal(await ia(), true)
  })

  test('ia_ligar recusa ligar sem módulo bot e permite desligar', async () => {
    await modulos()
    await db.exec(`reset role; update public.barracas set ia_habilitada = false, ia_whatsapp_dono = '5511999990000',
      ia_whatsapp_dono_confirmado_em = now() where id = '${B}'`)
    await como('authenticated')
    await assert.rejects(db.query(`select public.ia_ligar('${B}', true)`), /modulo_desligado/)
    // loja que já estava ligada e perdeu o módulo consegue desligar
    await db.exec(`reset role; update public.barracas set ia_habilitada = true where id = '${B}'`)
    await como('authenticated')
    assert.equal((await um<{ ia_habilitada: boolean }>(`select public.ia_ligar('${B}', false) as r`)).ia_habilitada, false)
    await db.exec('reset role')
    await modulos(['whatsapp_bot', 'ativo'])
    await como('authenticated')
    assert.equal((await um<{ ia_habilitada: boolean }>(`select public.ia_ligar('${B}', true) as r`)).ia_habilitada, true)
  })
})
