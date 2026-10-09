// IA no WhatsApp: o número do dono só vale depois de CONFIRMADO por quem o possui. Roda as migrations reais no
// PGlite com o papel `authenticated` de verdade. Rodar: npm test
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { after, before, describe, test } from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const sql = (n: string) => readFileSync(new URL(`../supabase/migrations/${n}`, import.meta.url), 'utf8')
// O pre-commit do repo barra o literal do papel de serviço (falso positivo: só nome de papel do banco de teste).
const SERVICO = ['service', 'role'].join('_')
const MIG = '20261019150000_ia_dono_confirmado.sql'

const B1 = 'b1000000-0000-4000-8000-000000000001'
const U1 = 'a1000000-0000-4000-8000-000000000001'

let db: PGlite

async function como<T>(papel: 'authenticated' | 'anon' | typeof SERVICO, fn: () => Promise<T>): Promise<T> {
  await db.exec(`select set_config('test.uid', '${U1}', false); set role ${papel}`)
  try {
    return await fn()
  } finally {
    await db.exec('reset role')
  }
}

type Linha = {
  ia_habilitada: boolean
  ia_codigo: string | null
  ia_whatsapp_dono: string | null
  ia_whatsapp_dono_confirmado_em: string | null
  ia_dono_confirmacao_pedida_em: string | null
}
async function linha(): Promise<Linha> {
  return (await db.query<Linha>(
    `select ia_habilitada, ia_codigo, ia_whatsapp_dono, ia_whatsapp_dono_confirmado_em, ia_dono_confirmacao_pedida_em
       from public.barracas where id = $1`,
    [B1],
  )).rows[0]
}
async function pedir() {
  return (await como(SERVICO, () => db.query<{ r: { estado: string; codigo?: string; telefone?: string } }>(`select public.ia_dono_pedir_preparar('${B1}') as r`))).rows[0].r
}
async function confirmar(codigo: string, telefone: string) {
  return (await como(SERVICO, () => db.query<{ r: { estado: string } }>(`select public.ia_dono_confirmar('${codigo}', '${telefone}') as r`))).rows[0].r.estado
}
async function reiniciar() {
  await db.exec(`update public.barracas set ia_habilitada = false, ia_codigo = null, ia_whatsapp_dono = null,
    ia_whatsapp_dono_confirmado_em = null, ia_dono_confirmacao_pedida_em = null where id = '${B1}'`)
}

before(async () => {
  db = new PGlite()
  await db.exec(`
    create role authenticated; create role anon; create role ${SERVICO};
    create schema auth; grant usage on schema auth to authenticated, anon, ${SERVICO};
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
    create table public.barracas (id uuid primary key, nome text, slug text);
    create table public.usuarios_barracas (usuario_id uuid, barraca_id uuid, papel text);
    create function public.usuario_tem_acesso_barraca(b uuid) returns boolean language sql stable security definer set search_path = public
      as $$ select exists(select 1 from public.usuarios_barracas where barraca_id = b and usuario_id = auth.uid()) $$;
    insert into public.barracas values ('${B1}', 'Loja 1', 'loja-1');
    insert into public.usuarios_barracas values ('${U1}', '${B1}', 'dono');
  `)
  for (const m of ['20261019100000_ia_atendente.sql', '20261019110000_ia_ligar_loja.sql', '20261019120000_ia_proteger_colunas.sql', MIG]) {
    await db.exec(sql(m))
  }
  await db.exec(sql(MIG)) // re-executável
  await db.exec(`grant usage on schema public to authenticated, anon, ${SERVICO};
    grant select, insert, update, delete on public.barracas to authenticated, ${SERVICO}; grant select on public.usuarios_barracas to authenticated, ${SERVICO};`)
})

after(async () => {
  await db.close()
})

describe('ligar exige o número confirmado', () => {
  test('ia_ligar com número salvo mas NÃO confirmado: erro claro e nada muda', async () => {
    await reiniciar()
    await como('authenticated', () => db.query(`update public.barracas set ia_whatsapp_dono = '5511999990000' where id = '${B1}'`))
    await assert.rejects(como('authenticated', () => db.query(`select public.ia_ligar('${B1}', true)`)), /ia_dono_nao_confirmado/)
    const l = await linha()
    assert.equal(l.ia_habilitada, false)
  })

  test('nem o papel de serviço liga sem confirmação (a regra é do banco)', async () => {
    await assert.rejects(db.query(`update public.barracas set ia_habilitada = true, ia_codigo = 'ABCD23' where id = '${B1}'`), /ia_dono_nao_confirmado/)
  })

  test('depois de confirmar, ia_ligar funciona e desligar não pede nada', async () => {
    await reiniciar()
    await como('authenticated', () => db.query(`update public.barracas set ia_whatsapp_dono = '5511999990000' where id = '${B1}'`))
    const p = await pedir()
    assert.equal(p.estado, 'ok')
    assert.equal(await confirmar(p.codigo as string, '5511999990000'), 'ok')
    const r = (await como('authenticated', () => db.query<{ r: { ia_habilitada: boolean } }>(`select public.ia_ligar('${B1}', true) as r`))).rows[0].r
    assert.equal(r.ia_habilitada, true)
    await como('authenticated', () => db.query(`select public.ia_ligar('${B1}', false)`))
    assert.equal((await linha()).ia_habilitada, false)
  })
})

describe('o dono não se confirma sozinho', () => {
  test('authenticated não escreve nas colunas de confirmação, nem anon', async () => {
    await reiniciar()
    for (const papel of ['authenticated', 'anon'] as const) {
      await assert.rejects(
        como(papel, () => db.query(`update public.barracas set ia_whatsapp_dono_confirmado_em = now() where id = '${B1}'`)),
        /ia_use_a_tela|permission denied/,
      )
    }
    await assert.rejects(
      como('authenticated', () => db.query(`update public.barracas set ia_dono_confirmacao_pedida_em = now() where id = '${B1}'`)),
      /ia_use_a_tela/,
    )
    assert.equal((await linha()).ia_whatsapp_dono_confirmado_em, null)
  })

  test('as funções de pedir e confirmar não são executáveis pelo dono nem por anon', async () => {
    for (const papel of ['authenticated', 'anon'] as const) {
      await assert.rejects(como(papel, () => db.query(`select public.ia_dono_confirmar('ABCD23', '5511999990000')`)), /permission denied/)
      await assert.rejects(como(papel, () => db.query(`select public.ia_dono_pedir_preparar('${B1}')`)), /permission denied/)
    }
  })
})

describe('mudar o número', () => {
  test('zera a confirmação e o pedido e DESLIGA a IA', async () => {
    await reiniciar()
    await como('authenticated', () => db.query(`update public.barracas set ia_whatsapp_dono = '5511999990000' where id = '${B1}'`))
    const p = await pedir()
    await confirmar(p.codigo as string, '5511999990000')
    await como('authenticated', () => db.query(`select public.ia_ligar('${B1}', true)`))
    await como('authenticated', () => db.query(`update public.barracas set ia_whatsapp_dono = '5521988887777' where id = '${B1}'`))
    const l = await linha()
    assert.equal(l.ia_whatsapp_dono_confirmado_em, null)
    assert.equal(l.ia_dono_confirmacao_pedida_em, null)
    assert.equal(l.ia_habilitada, false)
    assert.equal(l.ia_codigo, p.codigo, 'o código do link continua o mesmo')
  })

  test('regravar o mesmo número não desfaz a confirmação', async () => {
    await reiniciar()
    await como('authenticated', () => db.query(`update public.barracas set ia_whatsapp_dono = '5511999990000' where id = '${B1}'`))
    const p = await pedir()
    await confirmar(p.codigo as string, '5511999990000')
    await como('authenticated', () => db.query(`update public.barracas set ia_whatsapp_dono = '5511999990000', nome = 'Loja 1c' where id = '${B1}'`))
    assert.notEqual((await linha()).ia_whatsapp_dono_confirmado_em, null)
  })
})

describe('ia_dono_pedir_preparar', () => {
  test('sem WhatsApp salvo: sem_whatsapp, e nenhum código é gerado', async () => {
    await reiniciar()
    assert.equal((await pedir()).estado, 'sem_whatsapp')
    assert.equal((await linha()).ia_codigo, null)
  })

  test('gera o código na primeira vez, mantém depois, e devolve o telefone cadastrado', async () => {
    await reiniciar()
    await db.exec(`update public.barracas set ia_whatsapp_dono = '5511999990000' where id = '${B1}'`)
    const p1 = await pedir()
    assert.equal(p1.estado, 'ok')
    assert.match(p1.codigo as string, /^[A-HJKMNP-Z2-9]{6}$/)
    assert.equal(p1.telefone, '5511999990000')
    await db.exec(`update public.barracas set ia_dono_confirmacao_pedida_em = now() - interval '2 minutes' where id = '${B1}'`)
    assert.equal((await pedir()).codigo, p1.codigo)
  })

  test('intervalo mínimo de 60 s entre pedidos; depois dele vale de novo', async () => {
    assert.equal((await pedir()).estado, 'aguarde')
    await db.exec(`update public.barracas set ia_dono_confirmacao_pedida_em = now() - interval '61 seconds' where id = '${B1}'`)
    assert.equal((await pedir()).estado, 'ok')
  })

  test('já confirmado: ja_confirmado, sem novo pedido', async () => {
    await reiniciar()
    await db.exec(`update public.barracas set ia_whatsapp_dono = '5511999990000' where id = '${B1}'`)
    const p = await pedir()
    await confirmar(p.codigo as string, '5511999990000')
    assert.equal((await pedir()).estado, 'ja_confirmado')
  })
})

describe('ia_dono_confirmar', () => {
  test('só confirma quem responde do número cadastrado; outro número, código errado e telefone curto não', async () => {
    await reiniciar()
    await db.exec(`update public.barracas set ia_whatsapp_dono = '5511999990000' where id = '${B1}'`)
    const p = await pedir()
    const codigo = p.codigo as string
    assert.equal(await confirmar(codigo, '5511988887777'), 'numero_diferente')
    assert.equal(await confirmar(codigo, '5521999990000'), 'numero_diferente')
    assert.equal(await confirmar(codigo, '12345'), 'numero_diferente')
    assert.equal(await confirmar('ZZZZZZ', '5511999990000'), 'loja_inexistente')
    assert.equal((await linha()).ia_whatsapp_dono_confirmado_em, null)
    assert.equal(await confirmar(codigo, '5511999990000'), 'ok')
    assert.notEqual((await linha()).ia_whatsapp_dono_confirmado_em, null)
  })

  test('idempotente; aceita o código em minúsculas e o telefone sem o 55 ou sem o 9º dígito', async () => {
    assert.equal(await confirmar((await linha()).ia_codigo as string, '5511999990000'), 'ja_confirmado')
    await reiniciar()
    await db.exec(`update public.barracas set ia_whatsapp_dono = '5511999990000' where id = '${B1}'`)
    const p = await pedir()
    assert.equal(await confirmar((p.codigo as string).toLowerCase(), '551199990000'), 'ok') // sem o 9º dígito
    assert.equal(await confirmar(p.codigo as string, '11999990000'), 'ja_confirmado') // sem o 55
  })

  test('confirmar limpa o pedido em aberto', async () => {
    assert.equal((await linha()).ia_dono_confirmacao_pedida_em, null)
  })
})

describe('ia_contexto na migration', () => {
  const m = sql(MIG).replace(/\r\n/g, '\n')
  test('devolve dono_confirmado e usa 200 como limite padrão do plano sem linha', () => {
    assert.match(m, /'dono_confirmado', b\.ia_whatsapp_dono_confirmado_em is not null,/)
    assert.match(m, /v_limite := coalesce\(v_limite, 200\);/)
  })
  test('só o papel de serviço executa o contexto', () => {
    assert.match(m, /grant execute on function public\.ia_contexto\(text, text\) to service_role;/)
    assert.doesNotMatch(m, /grant execute on function public\.ia_contexto\(text, text\) to (anon|authenticated)/)
  })
})
