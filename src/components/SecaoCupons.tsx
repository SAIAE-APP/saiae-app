import { useCallback, useEffect, useState } from 'react'
import { MSG_SEM_INTERNET, useRascunho, useSalvarBarraca } from '../hooks/useSalvarBarraca'
import { apagarCupom, carregarCupons, definirAtivo, salvarCupom, type CuponsDaLoja } from '../lib/cuponsDados'
import {
  formularioDoCupom,
  formularioVazio,
  podeApagar,
  seloDoCupom,
  textoDescontoDoCupom,
  textoUsos,
  textoValidade,
  type Cupom,
  type DadosCupom,
  type FormularioCupom,
  type SeloCupom,
} from '../lib/cupons'
import { bancoSemRecurso } from '../lib/semMigration'
import { formatarPrecoBR } from '../lib/preco'
import { BottomSheetCupom } from './BottomSheetCupom'
import { ErroSalvar } from './BotaoSalvarCampo'
import { BottomSheet } from './ui/BottomSheet'
import { Badge, type BadgeVariant } from './ui/Badge'
import { Button } from './ui/Button'
import { Card } from './ui/Card'
import { Icone } from './ui/Icone'
import { Toggle } from './ui/Toggle'
import type { Barraca } from '../types/database'

const VARIANTE_DO_SELO: Record<SeloCupom, BadgeVariant> = {
  Ativo: 'success',
  Pausado: 'neutral',
  Vencido: 'danger',
  Esgotado: 'warning',
  Agendado: 'info',
}

type Edicao = { id: string | null; titulo: string; inicial: FormularioCupom }

/**
 * Cupons por código (spec 2026-10-08-cupons-design.md): o dono liga os cupons da loja, cria, edita, pausa e apaga
 * (só sem uso). O desconto de cada pedido é sempre calculado no servidor; aqui só se cadastra a regra. Cupom
 * com uso nunca é apagado, só pausado. Salva por botão explícito. Banco sem a migration = a seção some.
 */
export function SecaoCupons({ barraca }: { barraca: Barraca }) {
  const [dados, setDados] = useState<CuponsDaLoja | null>(null)
  const [indisponivel, setIndisponivel] = useState(false)
  const [erroCarga, setErroCarga] = useState<string | null>(null)
  const [recarga, setRecarga] = useState(0)
  const [edicao, setEdicao] = useState<Edicao | null>(null)
  const [erroAcao, setErroAcao] = useState<string | null>(null)
  const [paraApagar, setParaApagar] = useState<Cupom | null>(null)
  const [apagando, setApagando] = useState(false)

  const habilitadoR = useRascunho(Boolean(barraca.cupons_habilitado))
  const flag = useSalvarBarraca(barraca)
  const lojaUsaPerfil = Boolean(barraca.perfil_cliente_obrigatorio)

  useEffect(() => {
    let cancelado = false
    carregarCupons(barraca.id)
      .then((d) => {
        if (cancelado) return
        setDados(d)
        setErroCarga(null)
      })
      .catch((e) => {
        if (cancelado) return
        if (bancoSemRecurso(e)) setIndisponivel(true)
        else setErroCarga(typeof navigator !== 'undefined' && navigator.onLine === false ? MSG_SEM_INTERNET : `Não foi possível carregar os cupons: ${(e as Error).message}`)
      })
    return () => {
      cancelado = true
    }
  }, [barraca.id, recarga])

  const recarregar = useCallback(() => setRecarga((n) => n + 1), [])

  async function alternarFlag(valor: boolean) {
    habilitadoR.definir(valor)
    await flag.salvar({ cupons_habilitado: valor })
    habilitadoR.descartar() // volta ao valor do servidor; em erro o aviso fica visível abaixo
  }

  async function aoSalvar(dadosCupom: DadosCupom) {
    if (!edicao) return
    await salvarCupom(barraca.id, edicao.id, dadosCupom)
    setEdicao(null)
    recarregar()
  }

  async function pausarOuReativar(c: Cupom) {
    setErroAcao(null)
    try {
      await definirAtivo(barraca.id, c.id, !c.ativo)
      recarregar()
    } catch (e) {
      setErroAcao(e instanceof Error ? e.message : 'Não foi possível salvar.')
    }
  }

  async function confirmarApagar() {
    if (!paraApagar) return
    setApagando(true)
    setErroAcao(null)
    try {
      await apagarCupom(paraApagar.id)
      setParaApagar(null)
      recarregar()
    } catch (e) {
      setErroAcao(e instanceof Error ? e.message : 'Não foi possível apagar.')
      setParaApagar(null)
    } finally {
      setApagando(false)
    }
  }

  // Banco ainda sem as tabelas de cupom: nada a mostrar (o app pode subir antes da migration).
  if (indisponivel) return null

  return (
    <section>
      <h2 className="mb-3 flex items-center gap-1.5 font-mesa-sans text-xs font-semibold uppercase tracking-wider text-mesa-text-secondary">
        <Icone nome="checklist" size={14} />
        Cupons
      </h2>
      <Card>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-base text-mesa-text-primary">Aceitar cupons no cardápio digital</p>
            <p className="mt-1 text-sm text-mesa-text-secondary">
              {habilitadoR.valor
                ? 'Ligado: o cliente digita o código no pedido e paga menos no Pix ou na entrega.'
                : 'Desligado: o campo de cupom não aparece para o cliente.'}
            </p>
          </div>
          <Toggle
            checked={habilitadoR.valor}
            onChange={(v) => void alternarFlag(v)}
            disabled={flag.salvando}
            aria-label="Aceitar cupons no cardápio digital"
          />
        </div>
        <ErroSalvar erro={flag.erro} className="mt-2" />

        {erroCarga && <ErroSalvar erro={erroCarga} className="mt-3" />}
        {!dados && !erroCarga && <p className="mt-4 text-sm text-mesa-text-secondary">Carregando…</p>}
        <ErroSalvar erro={erroAcao} className="mt-3" />

        {dados && (
          <>
            <ul className="mt-4 divide-y divide-mesa-border-subtle">
              {dados.cupons.map((c) => {
                const usos = dados.resumo.get(c.id)
                const confirmados = usos?.usos_confirmados ?? 0
                const selo = seloDoCupom(c, confirmados)
                return (
                  <li key={c.id} className="py-3">
                    <button
                      type="button"
                      onClick={() => {
                        setErroAcao(null)
                        setEdicao({ id: c.id, titulo: 'Editar cupom', inicial: formularioDoCupom(c, barraca.fuso) })
                      }}
                      className="flex min-h-11 w-full items-start justify-between gap-3 text-left"
                    >
                      <span className="min-w-0">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="font-mesa-display text-base font-bold text-mesa-text-primary">{c.codigo}</span>
                          <span className="text-sm font-semibold text-mesa-text-primary">{textoDescontoDoCupom(c)}</span>
                          <Badge variant={VARIANTE_DO_SELO[selo]}>{selo}</Badge>
                        </span>
                        <span className="mt-0.5 block text-xs text-mesa-text-secondary">
                          {textoValidade(c, barraca.fuso)} · {textoUsos(confirmados, c.limite_usos)}
                          {c.pedido_minimo_centavos > 0 ? ` · mínimo ${formatarPrecoBR(c.pedido_minimo_centavos)}` : ''}
                          {c.uma_por_cliente ? ' · 1 por cliente' : ''}
                        </span>
                        {confirmados > 0 && (
                          <span className="block text-xs text-mesa-text-secondary">
                            Desconto dado: {formatarPrecoBR(usos?.desconto_total_centavos ?? 0)}
                          </span>
                        )}
                      </span>
                      <Icone nome="chevron_right" size={20} className="mt-1 shrink-0 text-mesa-text-tertiary" />
                    </button>
                    <div className="mt-1 flex gap-4">
                      <button type="button" className="min-h-11 text-sm underline" onClick={() => void pausarOuReativar(c)}>
                        {c.ativo ? 'Pausar' : 'Reativar'}
                      </button>
                      {podeApagar(confirmados) && (
                        <button type="button" className="min-h-11 text-sm text-mesa-error-500 underline" onClick={() => setParaApagar(c)}>
                          Apagar
                        </button>
                      )}
                    </div>
                  </li>
                )
              })}
              {dados.cupons.length === 0 && <li className="py-3 text-sm text-mesa-text-secondary">Nenhum cupom ainda.</li>}
            </ul>

            <Button
              variant="outline"
              size="md"
              className="mt-4"
              icon={<Icone nome="add" size={16} />}
              onClick={() => {
                setErroAcao(null)
                setEdicao({ id: null, titulo: 'Novo cupom', inicial: formularioVazio() })
              }}
            >
              Novo cupom
            </Button>
          </>
        )}
      </Card>

      {edicao && (
        <BottomSheetCupom
          key={edicao.id ?? 'novo'}
          titulo={edicao.titulo}
          inicial={edicao.inicial}
          lojaUsaPerfil={lojaUsaPerfil}
          fuso={barraca.fuso}
          onClose={() => setEdicao(null)}
          onSalvar={aoSalvar}
        />
      )}

      <BottomSheet open={paraApagar !== null} onClose={() => !apagando && setParaApagar(null)} aria-label="Apagar cupom">
        <h3 className="text-lg font-semibold text-mesa-text-primary">Apagar o cupom {paraApagar?.codigo}?</h3>
        <p className="mt-1 text-sm text-mesa-text-secondary">
          Só é possível apagar cupom que nunca foi usado. Para só parar de aceitar, use Pausar.
        </p>
        <div className="mt-6 flex flex-col gap-2">
          <Button variant="destructive" size="xl" className="w-full" loading={apagando} onClick={() => void confirmarApagar()}>
            Apagar cupom
          </Button>
          <Button variant="ghost" size="md" className="w-full" disabled={apagando} onClick={() => setParaApagar(null)}>
            Manter
          </Button>
        </div>
      </BottomSheet>
    </section>
  )
}
