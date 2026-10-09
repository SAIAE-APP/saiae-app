import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import clsx from 'clsx'
import { useAuth } from '../hooks/useAuth'
import { useBarracasDoUsuario } from '../hooks/useBarracasDoUsuario'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { Chip } from '../components/ui/Chip'
import { Icone } from '../components/ui/Icone'
import { Input } from '../components/ui/Input'
import { CampoHorarioDia } from '../components/CampoHorarioDia'
import { SeletorMetodos } from '../components/SeletorMetodos'
import { SeletorModos } from '../components/SeletorModos'
import { TODOS_OS_MODOS, modosAtivos } from '../lib/atendimento'
import { urlPublica } from '../lib/urlPublica'
import {
  CATEGORIAS,
  MODELOS_HORARIO,
  NOMES_DIAS,
  ORDEM_FASE_1,
  ORIGENS,
  PASSOS,
  aplicarModelo,
  gerarSlug,
  igualAoDiaAnterior,
  mensagemDoProblemaSlug,
  posicaoNaOrdem,
  problemaDoSlug,
  proximoPassoEm,
  semanaDoBanco,
  semanaFechada,
  sugerirSlugs,
  validarSemana,
  type ChaveModeloHorario,
  type HorarioDia,
} from '../lib/onboardingConfig'
import {
  barracasComOnboardingPendente,
  carregarBarracaCompleta,
  carregarSemana,
  concluirAssistente,
  concluirMarca,
  criarBarraca,
  registrarEvento,
  salvarHorarios,
  salvarMetodos,
  salvarModos,
  salvarOrigem,
  slugDisponivel,
} from '../lib/onboardingApi'
import type { Barraca, TipoAtendimento } from '../types/database'

const ORDEM = ORDEM_FASE_1

function titulo(numero: number): string {
  return PASSOS.find((p) => p.numero === numero)?.titulo ?? ''
}

/** Moldura de um passo: barra de progresso, voltar, conteúdo e rodapé (um primário mostarda por tela). */
function MolduraPasso({
  numero,
  podeVoltar,
  onVoltar,
  children,
}: {
  numero: number
  podeVoltar: boolean
  onVoltar: () => void
  children: React.ReactNode
}) {
  const pos = posicaoNaOrdem(ORDEM, numero)
  const pct = Math.round((pos / ORDEM.length) * 100)
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-xl flex-col bg-mesa-bg-base px-6 pb-8 pt-5">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onVoltar}
          disabled={!podeVoltar}
          aria-label="Voltar"
          className={clsx('flex size-11 items-center justify-center rounded-mesa-full', !podeVoltar && 'invisible')}
        >
          <Icone nome="arrow_back" size={22} />
        </button>
        <div className="flex-1">
          <div
            className="h-2 overflow-hidden rounded-mesa-full bg-mesa-neutral-100 dark:bg-mesa-neutral-700"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={ORDEM.length}
            aria-valuenow={pos}
            aria-label={`Passo ${pos} de ${ORDEM.length}`}
          >
            <div className="h-full rounded-mesa-full bg-mesa-orange-500 transition-all" style={{ width: `${pct}%` }} />
          </div>
          <p className="mt-1.5 text-xs font-medium text-mesa-text-secondary">
            Passo {pos} de {ORDEM.length}
          </p>
        </div>
      </div>
      <h1 className="mt-6 text-[28px] font-bold leading-[34px] text-mesa-text-primary">{titulo(numero)}</h1>
      <div className="mt-4 flex flex-1 flex-col">{children}</div>
    </div>
  )
}

function Rodape({
  textoPrincipal = 'Continuar',
  desabilitado,
  carregando,
  erro,
  onContinuar,
  onPular,
}: {
  textoPrincipal?: string
  desabilitado?: boolean
  carregando?: boolean
  erro?: string | null
  onContinuar: () => void
  onPular?: () => void
}) {
  return (
    <div className="mt-8 flex flex-col gap-2">
      {erro && (
        <p role="alert" className="text-sm font-medium text-mesa-error-500">
          {erro}
        </p>
      )}
      <Button size="xl" className="w-full" onClick={onContinuar} disabled={desabilitado} loading={carregando}>
        {textoPrincipal}
      </Button>
      {onPular && (
        <Button variant="ghost" size="md" className="w-full" onClick={onPular} disabled={carregando}>
          Fazer depois
        </Button>
      )}
    </div>
  )
}

// ------------------------------------------------------------------ passos
function PassoOrigem({ onSalvar, onPular }: { onSalvar: (origem: string, detalhe: string) => Promise<string | null>; onPular: () => void }) {
  const [origem, setOrigem] = useState<string | null>(null)
  const [detalhe, setDetalhe] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const pedeDetalhe = origem === 'outro' || origem === 'indicacao'

  async function continuar() {
    if (!origem) return
    setSalvando(true)
    setErro(await onSalvar(origem, pedeDetalhe ? detalhe.trim() : ''))
    setSalvando(false)
  }

  return (
    <>
      <p className="text-sm text-mesa-text-secondary">Só para a gente entender de onde você veio. Leva 5 segundos.</p>
      <div className="mt-4 flex flex-wrap gap-2" role="radiogroup" aria-label="Como você conheceu o Sai aê">
        {ORIGENS.map((o) => (
          <Chip key={o.chave} checked={origem === o.chave} onClick={() => setOrigem(o.chave)}>
            {o.rotulo}
          </Chip>
        ))}
      </div>
      {pedeDetalhe && (
        <Input
          className="mt-4"
          label={origem === 'indicacao' ? 'Quem indicou? (opcional)' : 'Qual? (opcional)'}
          maxLength={60}
          value={detalhe}
          onChange={(e) => setDetalhe(e.target.value)}
        />
      )}
      <div className="flex-1" />
      <Rodape desabilitado={!origem} carregando={salvando} erro={erro} onContinuar={continuar} onPular={onPular} />
    </>
  )
}

function PassoCategoria({ onSalvar, onPular }: { onSalvar: (categoria: string) => Promise<string | null>; onPular: () => void }) {
  const [categoria, setCategoria] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  async function continuar() {
    if (!categoria) return
    setSalvando(true)
    setErro(await onSalvar(categoria))
    setSalvando(false)
  }

  return (
    <>
      <p className="text-sm text-mesa-text-secondary">Escolha o que mais combina com a sua barraca.</p>
      <div className="mt-4 grid grid-cols-2 gap-2" role="radiogroup" aria-label="Tipo de negócio">
        {CATEGORIAS.map((c) => (
          <button
            key={c.chave}
            type="button"
            role="radio"
            aria-checked={categoria === c.chave}
            onClick={() => setCategoria(c.chave)}
            className={clsx(
              'min-h-14 rounded-mesa-xl border-2 px-3 py-3 text-left text-sm font-semibold',
              categoria === c.chave
                ? 'border-mesa-neutral-900 bg-mesa-orange-500 text-mesa-neutral-900 dark:border-mesa-neutral-50'
                : 'border-mesa-border-subtle bg-mesa-surface text-mesa-text-primary',
            )}
          >
            {c.rotulo}
          </button>
        ))}
      </div>
      <div className="flex-1" />
      <Rodape desabilitado={!categoria} carregando={salvando} erro={erro} onContinuar={continuar} onPular={onPular} />
    </>
  )
}

type EstadoSlug = 'vazio' | 'verificando' | 'livre' | 'ocupado' | 'invalido' | 'desconhecido'

function PassoMarca({
  barracaExistente,
  onCriar,
  onContinuarExistente,
}: {
  barracaExistente: Barraca | null
  onCriar: (nome: string, slug: string) => Promise<string | null>
  onContinuarExistente: () => Promise<string | null>
}) {
  const [nome, setNome] = useState('')
  const [slugManual, setSlugManual] = useState<string | null>(null)
  const [editandoLink, setEditandoLink] = useState(false)
  const [estado, setEstado] = useState<EstadoSlug>('vazio')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const slug = barracaExistente?.slug ?? slugManual ?? gerarSlug(nome)
  const problema = slug ? problemaDoSlug(slug) : null
  const link = urlPublica(`/${slug || 'seu-link'}/cardapio`)

  // Disponibilidade ao digitar (com pausa de meio segundo). Falha de rede não bloqueia: o banco confere ao criar.
  useEffect(() => {
    if (barracaExistente) return
    if (!slug) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setEstado('vazio')
      return
    }
    if (problema) {
      setEstado('invalido')
      return
    }
    setEstado('verificando')
    let cancelado = false
    const t = window.setTimeout(() => {
      slugDisponivel(slug).then((livre) => {
        if (!cancelado) setEstado(livre === null ? 'desconhecido' : livre ? 'livre' : 'ocupado')
      })
    }, 500)
    return () => {
      cancelado = true
      window.clearTimeout(t)
    }
  }, [slug, problema, barracaExistente])

  const sugestoes = useMemo(() => (estado === 'ocupado' ? sugerirSlugs(gerarSlug(nome) || slug) : []), [estado, nome, slug])

  async function continuar() {
    setSalvando(true)
    setErro(null)
    setErro(barracaExistente ? await onContinuarExistente() : await onCriar(nome.trim(), slug))
    setSalvando(false)
  }

  const podeContinuar = barracaExistente
    ? true
    : nome.trim().length >= 2 && !problema && (estado === 'livre' || estado === 'desconhecido')

  return (
    <>
      <Input
        label="Nome da sua marca"
        autoFocus
        maxLength={60}
        value={barracaExistente ? barracaExistente.nome : nome}
        onChange={(e) => {
          setNome(e.target.value)
          setSlugManual(null)
        }}
        disabled={Boolean(barracaExistente)}
      />

      <Card className="mt-4">
        <p className="text-xs font-semibold uppercase tracking-wider text-mesa-text-secondary">Link do seu cardápio</p>
        <p className="mt-1 break-all font-mesa-display text-base font-semibold text-mesa-text-primary" data-testid="link-cardapio">
          {link}
        </p>
        {!barracaExistente && (
          <>
            <p
              className={clsx(
                'mt-2 text-sm font-medium',
                estado === 'livre' && 'text-mesa-success-700 dark:text-mesa-success-500',
                (estado === 'ocupado' || estado === 'invalido') && 'text-mesa-error-500',
                (estado === 'vazio' || estado === 'verificando' || estado === 'desconhecido') && 'text-mesa-text-secondary',
              )}
            >
              {estado === 'vazio' && 'Digite o nome e o link aparece aqui.'}
              {estado === 'verificando' && 'Conferindo se está livre...'}
              {estado === 'livre' && 'Esse link está livre.'}
              {estado === 'ocupado' && 'Esse link já está em uso. Tente outro:'}
              {estado === 'invalido' && problema && mensagemDoProblemaSlug(problema)}
              {estado === 'desconhecido' && 'Não deu para conferir agora. Confirmamos ao continuar.'}
            </p>
            {sugestoes.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2">
                {sugestoes.map((s) => (
                  <Chip key={s} onClick={() => setSlugManual(s)}>
                    {s}
                  </Chip>
                ))}
              </div>
            )}
            <button
              type="button"
              onClick={() => setEditandoLink((v) => !v)}
              className="mt-2 flex min-h-11 items-center text-sm font-medium text-mesa-text-primary underline"
            >
              {editandoLink ? 'Esconder' : 'Editar o link'}
            </button>
            {editandoLink && (
              <>
                <Input
                  label="Endereço"
                  value={slugManual ?? slug}
                  maxLength={40}
                  onChange={(e) => setSlugManual(e.target.value.toLowerCase())}
                />
                <p className="mt-1 text-xs text-mesa-text-secondary">
                  Depois de divulgar o link, trocar faz os links antigos pararem de funcionar.
                </p>
              </>
            )}
          </>
        )}
        {barracaExistente && (
          <p className="mt-2 text-xs text-mesa-text-secondary">Para mudar o nome ou o link depois, use Ajustes.</p>
        )}
      </Card>

      <div className="flex-1" />
      <Rodape desabilitado={!podeContinuar} carregando={salvando} erro={erro} onContinuar={continuar} />
    </>
  )
}

const MODELOS: ChaveModeloHorario[] = ['almoco', 'jantar', 'fim_de_semana']

function PassoHorario({
  inicial,
  onSalvar,
}: {
  inicial: HorarioDia[]
  onSalvar: (semana: HorarioDia[]) => Promise<string | null>
}) {
  const [semana, setSemana] = useState<HorarioDia[]>(inicial)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [tentou, setTentou] = useState(false)
  const validacao = validarSemana(semana)

  async function continuar() {
    setTentou(true)
    if (!validacao.ok) return
    setSalvando(true)
    setErro(await onSalvar(semana))
    setSalvando(false)
  }

  function alterar(dia: number, a: Partial<{ aberto: boolean; hora_abertura: string; hora_fechamento: string }>) {
    setSemana((atual) =>
      atual.map((h) =>
        h.dia !== dia
          ? h
          : {
              ...h,
              ...(a.aberto !== undefined ? { aberto: a.aberto, abre: a.aberto && !h.abre ? '18:00' : h.abre, fecha: a.aberto && !h.fecha ? '23:00' : h.fecha } : {}),
              ...(a.hora_abertura !== undefined ? { abre: a.hora_abertura } : {}),
              ...(a.hora_fechamento !== undefined ? { fecha: a.hora_fechamento } : {}),
            },
      ),
    )
  }

  return (
    <>
      <p className="text-sm text-mesa-text-secondary">Aparece no seu cardápio como &quot;Aberto agora&quot; ou &quot;Fechado&quot;. Comece por um modelo e ajuste.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {MODELOS.map((m) => (
          <Chip key={m} onClick={() => setSemana(aplicarModelo(m))}>
            {MODELOS_HORARIO[m].rotulo}
          </Chip>
        ))}
        <Chip onClick={() => setSemana(semanaFechada())}>Limpar</Chip>
      </div>
      <Card className="mt-4">
        <ul className="flex flex-col gap-3 divide-y divide-mesa-border-subtle">
          {semana.map((h, i) => (
            <CampoHorarioDia
              key={h.dia}
              rotulo={NOMES_DIAS[h.dia]}
              linha={{ aberto: h.aberto, hora_abertura: h.abre || '18:00', hora_fechamento: h.fecha || '23:00' }}
              primeiro={i === 0}
              onAlterar={(a) => alterar(h.dia, a)}
              onIgualAoAnterior={i > 0 ? () => setSemana((s) => igualAoDiaAnterior(s, h.dia)) : undefined}
            />
          ))}
        </ul>
      </Card>
      {tentou && validacao.geral === 'nenhum_dia_aberto' && (
        <p role="alert" className="mt-3 text-sm font-medium text-mesa-error-500">
          Marque pelo menos um dia em que você abre.
        </p>
      )}
      {tentou && Object.keys(validacao.erros).length > 0 && (
        <p role="alert" className="mt-3 text-sm font-medium text-mesa-error-500">
          Confira os horários: cada dia aberto precisa de hora de abrir e de fechar diferentes.
        </p>
      )}
      <div className="flex-1" />
      <Rodape carregando={salvando} erro={erro} onContinuar={continuar} />
    </>
  )
}

function PassoPagamento({ inicial, onSalvar }: { inicial: string[]; onSalvar: (metodos: string[]) => Promise<string | null> }) {
  const [ativos, setAtivos] = useState<string[]>(inicial)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)

  function alternar(chave: string) {
    if (ativos.includes(chave) && ativos.length === 1) {
      setAviso('Você precisa ter ao menos uma forma de pagamento.')
      return
    }
    setAviso(null)
    setAtivos((a) => (a.includes(chave) ? a.filter((x) => x !== chave) : [...a, chave]))
  }

  async function continuar() {
    setSalvando(true)
    setErro(await onSalvar(ativos))
    setSalvando(false)
  }

  return (
    <>
      <p className="text-sm text-mesa-text-secondary">O que você aceita no balcão, na retirada e na entrega.</p>
      <Card className="mt-4">
        {aviso && <p className="mb-2 text-sm font-medium text-mesa-warning-700">{aviso}</p>}
        <SeletorMetodos ativos={ativos} onAlternar={alternar} prefixoId="onb-metodo" />
      </Card>
      <p className="mt-3 text-xs text-mesa-text-secondary">
        Pix online, com o dinheiro caindo direto na sua conta, você ativa depois em Ajustes › Pagamento online.
      </p>
      <div className="flex-1" />
      <Rodape carregando={salvando} erro={erro} onContinuar={continuar} />
    </>
  )
}

function PassoModos({ inicial, onSalvar }: { inicial: TipoAtendimento[]; onSalvar: (modos: TipoAtendimento[]) => Promise<string | null> }) {
  const [ativos, setAtivos] = useState<TipoAtendimento[]>(inicial)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)

  function alternar(modo: TipoAtendimento) {
    const esta = ativos.includes(modo)
    if (esta && ativos.length === 1) {
      setAviso('Você precisa ter ao menos um jeito de atender.')
      return
    }
    setAviso(null)
    setAtivos(TODOS_OS_MODOS.filter((m) => (m === modo ? !esta : ativos.includes(m))))
  }

  async function continuar() {
    setSalvando(true)
    setErro(await onSalvar(ativos))
    setSalvando(false)
  }

  return (
    <>
      <p className="text-sm text-mesa-text-secondary">Ligue só o que a sua barraca usa. Dá para mudar depois em Ajustes.</p>
      <Card className="mt-4">
        {aviso && <p className="mb-2 text-sm font-medium text-mesa-warning-700">{aviso}</p>}
        <SeletorModos ativos={ativos} onAlternar={alternar} prefixoId="onb-modo" />
      </Card>
      {ativos.includes('entrega') && (
        <p className="mt-3 text-xs text-mesa-text-secondary">
          A taxa de entrega você define depois, em Ajustes › Cardápio e operação.
        </p>
      )}
      <div className="flex-1" />
      <Rodape carregando={salvando} erro={erro} onContinuar={continuar} />
    </>
  )
}

function TelaFinal({ barraca, onIrParaHub, onCadastrarItens }: { barraca: Barraca; onIrParaHub: () => void; onCadastrarItens: () => void }) {
  const [fase, setFase] = useState<'preparando' | 'pronto' | 'erro'>('preparando')
  const [erro, setErro] = useState<string | null>(null)
  const [copiado, setCopiado] = useState(false)
  const link = urlPublica(`/${barraca.slug}/cardapio`)

  useEffect(() => {
    let cancelado = false
    const minimo = new Promise((r) => window.setTimeout(r, 2500))
    Promise.all([concluirAssistente(barraca.id), minimo]).then(([r]) => {
      if (cancelado) return
      if (r.ok) {
        registrarEvento(barraca.id, 10, 'concluido')
        setFase('pronto')
      } else {
        setErro(r.erro)
        setFase('erro')
      }
    })
    return () => {
      cancelado = true
    }
  }, [barraca.id])

  async function copiar() {
    try {
      await navigator.clipboard.writeText(link)
      setCopiado(true)
    } catch {
      setCopiado(false)
    }
  }

  if (fase === 'preparando') {
    return (
      <div className="mx-auto flex min-h-dvh max-w-xl flex-col items-center justify-center gap-4 bg-mesa-bg-base px-6 text-center">
        <span className="size-12 animate-spin rounded-mesa-full border-4 border-mesa-neutral-100 border-t-mesa-orange-500 motion-reduce:animate-none dark:border-mesa-neutral-700" aria-hidden />
        <h1 className="text-2xl font-bold text-mesa-text-primary">Preparando a cozinha...</h1>
        <p className="text-sm text-mesa-text-secondary">Já já tudo fica pronto para o primeiro pedido.</p>
      </div>
    )
  }

  if (fase === 'erro') {
    return (
      <div className="mx-auto flex min-h-dvh max-w-xl flex-col items-center justify-center gap-4 bg-mesa-bg-base px-6 text-center">
        <h1 className="text-2xl font-bold text-mesa-text-primary">Quase lá</h1>
        <p role="alert" className="text-sm font-medium text-mesa-error-500">{erro}</p>
        <Button size="xl" className="w-full" onClick={onIrParaHub}>Ir para o início</Button>
      </div>
    )
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center gap-4 bg-mesa-bg-base px-6 py-8">
      <span className="flex size-14 items-center justify-center rounded-mesa-full bg-mesa-orange-500 text-mesa-neutral-900">
        <Icone nome="check_circle" size={32} preenchido />
      </span>
      <h1 className="text-[28px] font-bold leading-[34px] text-mesa-text-primary">Tudo pronto, {barraca.nome}!</h1>
      <p className="text-sm text-mesa-text-secondary">Esse é o link do seu cardápio. Guarde e divulgue.</p>
      <Card>
        <p className="break-all font-mesa-display text-base font-semibold text-mesa-text-primary">{link}</p>
        <Button variant="outline" size="md" className="mt-3 w-full" onClick={copiar} icon={<Icone nome="content_copy" size={16} />}>
          {copiado ? 'Copiado' : 'Copiar link'}
        </Button>
      </Card>
      <Button size="xl" className="w-full" onClick={onIrParaHub}>Ir para o início</Button>
      <Button variant="outline" size="md" className="w-full" onClick={onCadastrarItens}>Cadastrar meus itens</Button>
    </div>
  )
}

// ------------------------------------------------------------------ página
export function Configurar() {
  const navigate = useNavigate()
  const { usuario, carregando: carregandoAuth, sair } = useAuth()
  const { barracas, carregando: carregandoBarracas, recarregar } = useBarracasDoUsuario(usuario)

  const [pronto, setPronto] = useState(false)
  const [barraca, setBarraca] = useState<Barraca | null>(null)
  const [passo, setPasso] = useState(1)
  const [semanaInicial, setSemanaInicial] = useState<HorarioDia[]>(semanaFechada())

  // Retomada: acha a barraca própria com o assistente por concluir e vai para o passo seguinte ao último feito.
  useEffect(() => {
    if (carregandoAuth || carregandoBarracas || !usuario || pronto) return
    let cancelado = false
    ;(async () => {
      const donas = barracas.filter((b) => b.papel === 'dono').map((b) => b.barraca_id)
      const pendentes = await barracasComOnboardingPendente(donas)
      if (cancelado) return
      if (pendentes.length === 0) {
        if (barracas.length > 0) {
          navigate('/', { replace: true })
          return
        }
        setPasso(1)
        setPronto(true)
        return
      }
      const completa = await carregarBarracaCompleta(pendentes[0].id)
      if (cancelado || !completa) {
        setPronto(true)
        return
      }
      setBarraca(completa)
      setSemanaInicial(semanaDoBanco(await carregarSemana(completa.id)))
      if ((completa.onboarding_etapa ?? 0) < 3) await concluirMarca(completa.id)
      setPasso(proximoPassoEm(ORDEM, Math.max(completa.onboarding_etapa ?? 0, 3)))
      setPronto(true)
    })()
    return () => {
      cancelado = true
    }
  }, [carregandoAuth, carregandoBarracas, usuario, barracas, pronto, navigate])

  useEffect(() => {
    if (!pronto) return
    registrarEvento(barraca?.id ?? null, passo, 'visto')
  }, [pronto, passo, barraca?.id])

  const irPara = useCallback((n: number) => setPasso(n), [])
  const seguinte = useCallback((feito: number) => setPasso(proximoPassoEm(ORDEM, feito)), [])
  const anterior = useCallback(() => {
    const i = ORDEM.indexOf(passo)
    if (i > 0) setPasso(ORDEM[i - 1])
  }, [passo])

  // Voltar só até o 1º passo, e nunca para trás do passo 3 depois que a barraca existe (nome e link não mudam aqui).
  const podeVoltar = ORDEM.indexOf(passo) > 0 && !(barraca && passo <= 6 && ORDEM[ORDEM.indexOf(passo) - 1] < 3)

  if (carregandoAuth || carregandoBarracas || !pronto) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-mesa-bg-base">
        <p className="text-sm text-mesa-text-secondary">Carregando...</p>
      </div>
    )
  }

  async function aposSalvar<T>(r: { ok: true; dados: T } | { ok: false; erro: string }, passoFeito: number): Promise<string | null> {
    if (!r.ok) return r.erro
    registrarEvento(barraca?.id ?? null, passoFeito, 'concluido')
    seguinte(passoFeito)
    return null
  }

  function pular(n: number) {
    registrarEvento(barraca?.id ?? null, n, 'pulado')
    seguinte(n)
  }

  if (passo === 10 && barraca) {
    return (
      <TelaFinal
        barraca={barraca}
        onIrParaHub={async () => {
          await recarregar()
          navigate(`/${barraca.slug}`, { replace: true })
        }}
        onCadastrarItens={async () => {
          await recarregar()
          navigate(`/${barraca.slug}/ajustes/cardapio`, { replace: true })
        }}
      />
    )
  }

  return (
    <MolduraPasso numero={passo} podeVoltar={podeVoltar} onVoltar={anterior}>
      {passo === 1 && (
        <PassoOrigem
          onPular={() => pular(1)}
          onSalvar={async (origem, detalhe) => aposSalvar(await salvarOrigem(origem, detalhe, null), 1)}
        />
      )}
      {passo === 2 && (
        <PassoCategoria
          onPular={() => pular(2)}
          onSalvar={async (categoria) => aposSalvar(await salvarOrigem(null, null, categoria), 2)}
        />
      )}
      {passo === 3 && (
        <PassoMarca
          barracaExistente={barraca}
          onCriar={async (nome, slug) => {
            const criada = await criarBarraca(nome, slug)
            if (!criada.ok) return criada.erro
            const completa = (await carregarBarracaCompleta(criada.dados.id)) ?? criada.dados
            setBarraca(completa)
            await recarregar()
            const r = await concluirMarca(criada.dados.id)
            registrarEvento(criada.dados.id, 3, 'concluido')
            if (!r.ok) {
              // A barraca já existe; a retomada completa o passo 3 na próxima abertura.
              irPara(6)
              return null
            }
            seguinte(3)
            return null
          }}
          onContinuarExistente={async () => {
            seguinte(3)
            return null
          }}
        />
      )}
      {passo === 6 && barraca && (
        <PassoHorario inicial={semanaInicial} onSalvar={async (semana) => aposSalvar(await salvarHorarios(barraca.id, semana), 6)} />
      )}
      {passo === 7 && barraca && (
        <PassoPagamento
          inicial={barraca.metodos_pagamento_ativos ?? ['dinheiro', 'debito', 'credito', 'pix']}
          onSalvar={async (metodos) => {
            const r = await salvarMetodos(barraca.id, metodos)
            if (r.ok) setBarraca({ ...barraca, metodos_pagamento_ativos: metodos })
            return aposSalvar(r, 7)
          }}
        />
      )}
      {passo === 8 && barraca && (
        <PassoModos
          inicial={modosAtivos(barraca)}
          onSalvar={async (modos) => {
            const r = await salvarModos(barraca.id, modos)
            if (r.ok) setBarraca({ ...barraca, modos_atendimento: modos })
            return aposSalvar(r, 8)
          }}
        />
      )}
      <div className="mt-6 text-center">
        <button type="button" onClick={() => void sair().then(() => navigate('/login'))} className="min-h-11 text-xs font-medium text-mesa-text-tertiary underline">
          Sair da conta
        </button>
      </div>
    </MolduraPasso>
  )
}

