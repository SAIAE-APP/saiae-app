import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { useBarracaAtual } from '../layouts/contextoBarraca'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { Checkbox } from '../components/ui/Checkbox'
import { Icone } from '../components/ui/Icone'
import { Input } from '../components/ui/Input'
import { onboardingKitsHabilitado } from '../lib/kitsIniciais'
import { filtrarEntradaPreco } from '../lib/preco'
import { montarPlano, podeSalvar, type LinhaItemRevisao, type LinhaOpcaoRevisao } from '../lib/revisarKit'
import { carregarRevisao, salvarRevisao, type DadosDaRevisao } from '../lib/revisarKitDados'

/**
 * "Completar o cardápio de exemplo" (kits iniciais, atrás de VITE_ONBOARDING_KITS): o kit cria itens inativos e sem
 * preço. Aqui o dono marca o que vai usar e informa o preço; só então o item (e a opção) é ativado. Item sem preço
 * nunca vai ao ar. Usa as mesmas tabelas do cadastro de itens e de opções.
 */
export function RevisarCardapioExemplo() {
  const barraca = useBarracaAtual()
  const navigate = useNavigate()
  const ligado = onboardingKitsHabilitado(import.meta.env.VITE_ONBOARDING_KITS)
  const [dados, setDados] = useState<DadosDaRevisao | null>(null)
  const [itens, setItens] = useState<LinhaItemRevisao[]>([])
  const [opcoes, setOpcoes] = useState<LinhaOpcaoRevisao[]>([])
  const [erroCarga, setErroCarga] = useState<string | null>(null)
  const [erroSalvar, setErroSalvar] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)
  const [tentou, setTentou] = useState(false)
  const [salvou, setSalvou] = useState(false)
  const [recarga, setRecarga] = useState(0)

  useEffect(() => {
    if (!ligado) return
    let cancelado = false
    carregarRevisao(barraca.id).then((r) => {
      if (cancelado) return
      if (!r.ok) {
        setErroCarga(r.erro)
        return
      }
      setErroCarga(null)
      setDados(r.dados)
      setItens(r.dados.itens)
      setOpcoes(r.dados.opcoes)
    })
    return () => {
      cancelado = true
    }
  }, [barraca.id, ligado, recarga])

  const plano = useMemo(() => montarPlano(itens, opcoes, dados?.variacoesAtivas), [itens, opcoes, dados])
  const porCategoria = useMemo(() => {
    const mapa = new Map<string, LinhaItemRevisao[]>()
    for (const i of itens) mapa.set(i.categoria, [...(mapa.get(i.categoria) ?? []), i])
    return [...mapa.entries()]
  }, [itens])
  const porGrupo = useMemo(() => {
    const mapa = new Map<string, LinhaOpcaoRevisao[]>()
    for (const o of opcoes) mapa.set(o.grupoNome, [...(mapa.get(o.grupoNome) ?? []), o])
    return [...mapa.entries()]
  }, [opcoes])

  const voltar = () => navigate(`/${barraca.slug}/ajustes/cardapio`)

  if (!ligado) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-mesa-bg-base p-6 text-center">
        <p className="text-sm text-mesa-text-secondary">Esta tela ainda não está disponível.</p>
        <Button variant="outline" size="md" onClick={voltar}>Voltar</Button>
      </div>
    )
  }

  async function salvar() {
    setTentou(true)
    setErroSalvar(null)
    if (!podeSalvar(plano)) return
    setSalvando(true)
    const r = await salvarRevisao(barraca.id, plano)
    setSalvando(false)
    if (!r.ok) {
      setErroSalvar(r.erro)
      return
    }
    setSalvou(true)
    setDados(null)
    setRecarga((n) => n + 1)
  }

  function mudarItem(id: string, parcial: Partial<LinhaItemRevisao>) {
    setSalvou(false)
    setItens((l) => l.map((i) => (i.id === id ? { ...i, ...parcial } : i)))
  }
  function mudarOpcao(id: string, parcial: Partial<LinhaOpcaoRevisao>) {
    setSalvou(false)
    setOpcoes((l) => l.map((o) => (o.id === id ? { ...o, ...parcial } : o)))
  }

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[720px] flex-col gap-5 bg-mesa-bg-base px-6 py-6 pb-28">
      <header className="flex items-start gap-3">
        <button type="button" onClick={voltar} aria-label="Voltar" className="flex size-11 shrink-0 items-center justify-center rounded-mesa-full text-mesa-text-primary">
          <Icone nome="arrow_back" size={22} />
        </button>
        <div>
          <h1 className="text-[24px] font-bold leading-8 text-mesa-text-primary">Completar o cardápio de exemplo</h1>
          <p className="mt-1 text-sm text-mesa-text-secondary">
            Marque o que você vai vender e informe o preço. O que ficar sem marca continua escondido: ninguém vê item sem preço.
          </p>
        </div>
      </header>

      {erroCarga && (
        <Card>
          <p role="alert" className="text-sm text-mesa-error-500">{erroCarga}</p>
          <Button variant="outline" size="md" className="mt-3" onClick={() => setRecarga((n) => n + 1)}>Tentar de novo</Button>
        </Card>
      )}

      {!erroCarga && !dados && <p className="text-sm text-mesa-text-secondary">Carregando...</p>}

      {dados && itens.length === 0 && opcoes.length === 0 && (
        <Card>
          <p className="text-sm text-mesa-text-primary">
            {salvou ? 'Pronto! Seus itens estão no ar.' : 'Não há mais nada para completar no cardápio de exemplo.'}
          </p>
          <Button size="md" className="mt-3" onClick={voltar}>Ir para o cardápio</Button>
        </Card>
      )}

      {salvou && (itens.length > 0 || opcoes.length > 0) && (
        <p role="status" className="rounded-mesa-lg bg-mesa-surface p-3 text-sm text-mesa-text-primary">Salvo. O que você marcou já está no ar.</p>
      )}

      {porCategoria.map(([categoria, lista]) => (
        <section key={categoria} className="flex flex-col gap-3">
          <h2 className="text-base font-semibold text-mesa-text-primary">{categoria}</h2>
          {lista.map((i) => (
            <Card key={i.id}>
              <div className="flex flex-col gap-3">
                <Checkbox checked={i.usar} onChange={(v) => mudarItem(i.id, { usar: v })} label="Usar este item" />
                <Input label="Nome" value={i.nome} maxLength={60} onChange={(e) => mudarItem(i.id, { nome: e.target.value })} />
                <Input
                  type="currency"
                  label={i.variacaoId ? 'Preço (os tamanhos abaixo substituem este valor)' : 'Preço'}
                  inputMode="decimal"
                  value={i.precoTexto}
                  error={tentou ? plano.erros[`item:${i.id}`] : undefined}
                  onChange={(e) => mudarItem(i.id, { precoTexto: filtrarEntradaPreco(e.target.value), usar: true })}
                />
              </div>
            </Card>
          ))}
        </section>
      ))}

      {porGrupo.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-base font-semibold text-mesa-text-primary">Opções com preço</h2>
          <p className="text-sm text-mesa-text-secondary">
            Tamanhos e extras do seu cardápio. Em tamanho, o preço substitui o do item; em extra, é o acréscimo (vazio = grátis).
          </p>
          {porGrupo.map(([grupo, lista]) => (
            <Card key={grupo}>
              <p className="text-sm font-semibold text-mesa-text-primary">{grupo}</p>
              <div className="mt-2 flex flex-col gap-3">
                {lista.map((o) => (
                  <div key={o.id} className="flex flex-col gap-2 border-t border-mesa-border-subtle pt-3 first:border-t-0 first:pt-0">
                    <Checkbox checked={o.usar} onChange={(v) => mudarOpcao(o.id, { usar: v })} label={`Usar "${o.nome}"`} />
                    <Input
                      type="currency"
                      label={o.tipo === 'variacao' ? 'Preço' : 'Acréscimo'}
                      inputMode="decimal"
                      value={o.precoTexto}
                      error={tentou ? plano.erros[`opcao:${o.id}`] : undefined}
                      onChange={(e) => mudarOpcao(o.id, { precoTexto: filtrarEntradaPreco(e.target.value), usar: true })}
                    />
                  </div>
                ))}
              </div>
            </Card>
          ))}
        </section>
      )}

      {plano.avisos.length > 0 && (
        <ul className="flex flex-col gap-1 text-sm text-mesa-warning-700">
          {plano.avisos.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
      )}
      {erroSalvar && <p role="alert" className="text-sm text-mesa-error-500">{erroSalvar}</p>}

      {(itens.length > 0 || opcoes.length > 0) && (
        <div className="fixed inset-x-0 bottom-0 border-t border-mesa-border-subtle bg-mesa-bg-base p-4">
          <div className="mx-auto max-w-[720px]">
            <Button size="xl" className="w-full" loading={salvando} disabled={salvando} onClick={salvar}>
              Salvar e ativar o que marquei
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
