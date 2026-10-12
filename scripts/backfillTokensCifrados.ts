// Backfill: cifra os tokens que ainda estão só em texto (plano 2026-10-12-criptografar-tokens-em-repouso, fase 2).
// IDEMPOTENTE (só toca linhas com texto e SEM cifrado; rodar de novo não duplica nem recifra) e NÃO apaga o texto
// (isso é a fase 3, depois da janela de observação). Cada valor é decifrado de volta e comparado com o original ANTES
// de gravar. Só imprime contagens e códigos, nunca valores. Núcleo testado em tests/backfillTokensCifrados.test.ts;
// o CLI é scripts/backfill-tokens-cifrados.ts.
import { cifrar, configDoEnv, decifrar, type ConfigCripto } from '../supabase/functions/_shared/segredoCifrado.ts'

export type CampoBackfill = { tabela: string; chave: string[]; texto: string; cifrado: string }

export const CAMPOS: CampoBackfill[] = [
  { tabela: 'barracas_fiscal_token', chave: ['barraca_id'], texto: 'token_homologacao', cifrado: 'token_homologacao_cifrado' },
  { tabela: 'barracas_fiscal_token', chave: ['barraca_id'], texto: 'token_producao', cifrado: 'token_producao_cifrado' },
  { tabela: 'barracas_pagamento_token', chave: ['barraca_id', 'provedor'], texto: 'access_token', cifrado: 'access_token_cifrado' },
  { tabela: 'barracas_pagamento_token', chave: ['barraca_id', 'provedor'], texto: 'segredo_webhook', cifrado: 'segredo_webhook_cifrado' },
]

export type RelatorioCampo = {
  tabela: string
  campo: string
  /** Linhas com texto e SEM cifrado antes desta execução. */
  pendentes_antes: number
  cifrados_agora: number
  falhas: number
  /** Linhas com texto e SEM cifrado depois (precisa ser 0 para liberar a fase 3). */
  pendentes_depois: number
  /** Linhas que ainda guardam o texto (cai para 0 só na fase 3). */
  com_texto: number
  /** Linhas com o campo cifrado. */
  com_cifrado: number
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = { from: (tabela: string) => any }

async function contar(db: Db, c: CampoBackfill, filtro: 'pendentes' | 'texto' | 'cifrado'): Promise<number> {
  let q = db.from(c.tabela).select(c.chave[0], { count: 'exact', head: true })
  if (filtro === 'cifrado') q = q.not(c.cifrado, 'is', null)
  else {
    q = q.not(c.texto, 'is', null).neq(c.texto, '')
    if (filtro === 'pendentes') q = q.is(c.cifrado, null)
  }
  const { count, error } = await q
  if (error) throw new Error(`contagem ${c.tabela}.${c.texto}: ${error.message}`)
  return count ?? 0
}

export async function executarBackfill(
  db: Db,
  env: { get: (n: string) => string | undefined },
  opcoes: { aplicar: boolean; lote?: number; agora?: () => number; cripto?: Crypto } = { aplicar: false },
): Promise<RelatorioCampo[]> {
  const cfg: ConfigCripto = configDoEnv(env)
  if (opcoes.aplicar && !cfg.atual) throw new Error('TOKENS_CHAVE_V1 não configurada: nada foi alterado')
  const lote = opcoes.lote ?? 100
  const relatorio: RelatorioCampo[] = []

  for (const c of CAMPOS) {
    const r: RelatorioCampo = { tabela: c.tabela, campo: c.texto, pendentes_antes: await contar(db, c, 'pendentes'), cifrados_agora: 0, falhas: 0, pendentes_depois: 0, com_texto: 0, com_cifrado: 0 }
    if (opcoes.aplicar) {
      const jaFalhou = new Set<string>()
      for (;;) {
        let q = db.from(c.tabela).select([...c.chave, c.texto].join(',')).not(c.texto, 'is', null).neq(c.texto, '').is(c.cifrado, null)
        for (const k of c.chave) q = q.order(k)
        const { data, error } = await q.limit(lote + jaFalhou.size)
        if (error) throw new Error(`leitura ${c.tabela}.${c.texto}: ${error.message}`)
        const linhas = ((data ?? []) as Record<string, string>[]).filter((l) => !jaFalhou.has(c.chave.map((k) => l[k]).join('|')))
        if (linhas.length === 0) break
        for (const l of linhas.slice(0, lote)) {
          const id = c.chave.map((k) => l[k]).join('|')
          try {
            const contexto = { barracaId: l.barraca_id, campo: c.texto }
            const { valor, kid } = await cifrar(l[c.texto], contexto, cfg, opcoes.cripto)
            if ((await decifrar(valor, contexto, cfg, opcoes.cripto)) !== l[c.texto]) throw new Error('conferencia')
            let u = db.from(c.tabela).update({ [c.cifrado]: valor, cifrado_em: new Date((opcoes.agora ?? Date.now)()).toISOString(), cifrado_chave: kid })
            for (const k of c.chave) u = u.eq(k, l[k])
            // Só grava se continua sem cifrado (uma gravação nova pela função salvar-credencial não é sobrescrita).
            const { data: tocadas, error: erroUpd } = await u.is(c.cifrado, null).select(c.chave[0])
            if (erroUpd) throw new Error('gravar')
            if (Array.isArray(tocadas) && tocadas.length > 0) r.cifrados_agora++
          } catch {
            r.falhas++
            jaFalhou.add(id)
          }
        }
      }
    }
    r.pendentes_depois = await contar(db, c, 'pendentes')
    r.com_texto = await contar(db, c, 'texto')
    r.com_cifrado = await contar(db, c, 'cifrado')
    relatorio.push(r)
  }
  return relatorio
}

/** true se o backfill está completo: nada pendente e nenhuma falha. */
export const backfillCompleto = (rel: RelatorioCampo[]) => rel.every((r) => r.pendentes_depois === 0 && r.falhas === 0)
