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
import { KIT_NENHUM, kitDoId, mensagemDoEstadoDoKit, onboardingKitsHabilitado, sugestoesDoKit, type KitId } from '../lib/kitsIniciais'
import { SeletorDeKit } from '../components/SeletorDeKit'
import { filtrarEntradaPreco, reaisParaCentavos } from '../lib/preco'
import {
  CATEGORIAS,
  MODELOS_HORARIO,
  NOMES_DIAS,
  cnpjValido,
  formatarCepDigitando,
  formatarCnpjDigitando,
  mensagemDaConsulta,
  ordemDoAssistente,
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
  consultarCep,
  consultarCnpj,
  criarBarraca,
  registrarEvento,
  salvarCnpj,
  salvarEndereco,
  salvarHorarios,
  salvarMetodos,
  salvarModos,
  salvarTaxa,
  salvarOrigem,
  slugDisponivel,
  aplicarKit,
  carregarKitEscolhido,
} from '../lib/onboardingApi'
import type { Barraca, TipoAtendimento } from '../types/database'

function titulo(numero: number): string {
  return PASSOS.find((p) => p.numero === numero)?.titulo ?? ''
}

/** Moldura de um passo: barra de progresso, voltar, conteúdo e rodapé (um primário mostarda por tela). */
function MolduraPasso({
  numero,
  ordem,
  podeVoltar,
  onVoltar,
  children,
}: {
  numero: number
  ordem: number[]
  podeVoltar: boolean
  onVoltar: () => void
  children: React.ReactNode
}) {
  const pos = posicaoNaOrdem(ordem, numero)
  const pct = Math.round((pos / ordem.length) * 100)
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
            aria-valuemax={ordem.length}
            aria-valuenow={pos}
            aria-label={`Passo ${pos} de ${ordem.length}`}
          >
            <div className="h-full rounded-mesa-full bg-mesa-orange-500 transition-all" style={{ width: `${pct}%` }} />
          </div>
          <p className="mt-1.5 text-xs font-medium text-mesa-text-secondary">
            Passo {pos} de {ordem.length}
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

function PassoCategoria({
  kitsLigado,
  kitInicial,
  onSalvar,
  onPular,
}: {
  kitsLigado: boolean
  kitInicial: string | null
  onSalvar: (categoria: string, kit: string | null) => Promise<string | null>
  onPular: () => void
}) {
  const [categoria, setCategoria] = useState<string | null>(null)
  const [kit, setKit] = useState<string | null>(kitInicial)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  async function continuar() {
    if (!categoria) return
    setSalvando(true)
    setErro(await onSalvar(categoria, kitsLigado ? kit : null))
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
            onClick={() => {
              if (c.chave !== categoria) setKit(null)
              setCategoria(c.chave)
            }}
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
      {kitsLigado && categoria && <SeletorDeKit categoria={categoria} valor={kit} onChange={setKit} />}
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
  sugestaoDe,
  onSalvar,
}: {
  inicial: HorarioDia[]
  /** Nome do modelo de negócio que sugeriu este horário (kit); null = sem sugestão. */
  sugestaoDe: string | null
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
      {sugestaoDe && (
        <p role="status" className="mt-2 text-xs font-medium text-mesa-text-secondary">
          Sugestão do modelo {sugestaoDe}. Ajuste como quiser; só é gravada quando você tocar em Continuar.
        </p>
      )}
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

function PassoModos({
  inicial,
  sugestaoDe,
  onSalvar,
}: {
  inicial: TipoAtendimento[]
  /** Nome do modelo de negócio que sugeriu estes modos (kit); null = sem sugestão. */
  sugestaoDe: string | null
  onSalvar: (modos: TipoAtendimento[]) => Promise<string | null>
}) {
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
      {sugestaoDe && (
        <p role="status" className="text-xs font-medium text-mesa-text-secondary">
          Sugestão do modelo {sugestaoDe}. Ajuste como quiser; só é gravada quando você tocar em Continuar.
        </p>
      )}
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

type EstadoBusca = 'parado' | 'buscando' | 'achou' | 'falhou'

function PassoCnpj({ inicial, onSalvar, onPular }: { inicial: string; onSalvar: (d: { cnpj: string | null; semCnpj: boolean; razaoSocial: string | null }) => Promise<string | null>; onPular: () => void }) {
  const [texto, setTexto] = useState(formatarCnpjDigitando(inicial))
  const [semCnpj, setSemCnpj] = useState(false)
  const [razao, setRazao] = useState<string | null>(null)
  const [busca, setBusca] = useState<EstadoBusca>('parado')
  const [aviso, setAviso] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const digitos = texto.replace(/\D/g, '')
  const valido = cnpjValido(digitos)

  async function aoDigitar(valor: string) {
    const novo = formatarCnpjDigitando(valor)
    setTexto(novo)
    setRazao(null)
    setAviso(null)
    setBusca('parado')
    const d = novo.replace(/\D/g, '')
    if (d.length === 14 && cnpjValido(d)) {
      setBusca('buscando')
      const r = await consultarCnpj(d)
      if (r.ok) {
        setRazao(r.dados.razao_social)
        setAviso(r.dados.ativa ? null : `Situação na Receita: ${r.dados.situacao || 'não ativa'}.`)
        setBusca('achou')
      } else {
        setAviso(mensagemDaConsulta(r.motivo))
        setBusca('falhou')
      }
    }
  }

  async function continuar() {
    setSalvando(true)
    setErro(await onSalvar(semCnpj ? { cnpj: null, semCnpj: true, razaoSocial: null } : { cnpj: digitos, semCnpj: false, razaoSocial: razao }))
    setSalvando(false)
  }

  const invalidoCompleto = digitos.length === 14 && !valido
  const pode = semCnpj || valido

  return (
    <>
      <p className="text-sm text-mesa-text-secondary">Usado para emitir nota fiscal. Buscamos o nome da empresa sozinhos.</p>
      <Input
        className="mt-4"
        label="CNPJ"
        inputMode="numeric"
        value={semCnpj ? '' : texto}
        disabled={semCnpj}
        onChange={(e) => void aoDigitar(e.target.value)}
        error={invalidoCompleto ? 'CNPJ inválido. Confira os números.' : undefined}
      />
      {busca === 'buscando' && <p className="mt-2 text-sm text-mesa-text-secondary">Buscando...</p>}
      {razao && (
        <Card className="mt-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-mesa-text-secondary">Encontramos</p>
          <p className="mt-1 text-base font-semibold text-mesa-text-primary">{razao}</p>
        </Card>
      )}
      {aviso && <p className="mt-2 text-sm text-mesa-text-secondary">{aviso}</p>}
      <div className="mt-4">
        <Chip checked={semCnpj} onClick={() => setSemCnpj((v) => !v)}>
          Sou MEI / ainda não tenho CNPJ
        </Chip>
      </div>
      <div className="flex-1" />
      <Rodape desabilitado={!pode} carregando={salvando} erro={erro} onContinuar={continuar} onPular={onPular} />
    </>
  )
}

type CamposEndereco = { cep: string; rua: string; numero: string; complemento: string; bairro: string; cidade: string; uf: string }

function PassoEndereco({ inicial, onSalvar, onPular }: { inicial: CamposEndereco; onSalvar: (e: CamposEndereco) => Promise<string | null>; onPular: () => void }) {
  const [e, setE] = useState<CamposEndereco>({ ...inicial, cep: formatarCepDigitando(inicial.cep) })
  const [busca, setBusca] = useState<EstadoBusca>('parado')
  const [aviso, setAviso] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const campo = (k: keyof CamposEndereco) => (ev: { target: { value: string } }) => setE((a) => ({ ...a, [k]: ev.target.value }))

  async function aoDigitarCep(valor: string) {
    const cep = formatarCepDigitando(valor)
    setE((a) => ({ ...a, cep }))
    setAviso(null)
    if (cep.replace(/\D/g, '').length === 8) {
      setBusca('buscando')
      const r = await consultarCep(cep)
      if (r.ok) {
        setE((a) => ({ ...a, rua: r.dados.rua || a.rua, bairro: r.dados.bairro || a.bairro, cidade: r.dados.cidade, uf: r.dados.uf }))
        setBusca('achou')
      } else {
        setAviso(mensagemDaConsulta(r.motivo))
        setBusca('falhou')
      }
    }
  }

  async function continuar() {
    setSalvando(true)
    setErro(await onSalvar({ ...e, cep: e.cep.replace(/\D/g, ''), uf: e.uf.toUpperCase() }))
    setSalvando(false)
  }

  const pode = e.rua.trim() !== '' && e.numero.trim() !== '' && e.cidade.trim() !== '' && /^[A-Za-z]{2}$/.test(e.uf.trim())

  return (
    <>
      <p className="text-sm text-mesa-text-secondary">Digite o CEP e a gente preenche o resto. Aparece no seu cardápio.</p>
      <div className="mt-4 flex flex-col gap-3">
        <Input label="CEP" inputMode="numeric" value={e.cep} onChange={(ev) => void aoDigitarCep(ev.target.value)} helpText={busca === 'buscando' ? 'Buscando...' : undefined} />
        {aviso && <p className="text-sm text-mesa-text-secondary">{aviso}</p>}
        <Input label="Rua" value={e.rua} maxLength={120} onChange={campo('rua')} />
        <div className="grid grid-cols-2 gap-3">
          <Input label="Número" value={e.numero} maxLength={20} onChange={campo('numero')} />
          <Input label="Complemento" value={e.complemento} maxLength={80} onChange={campo('complemento')} />
        </div>
        <Input label="Bairro" value={e.bairro} maxLength={80} onChange={campo('bairro')} />
        <div className="grid grid-cols-[1fr_88px] gap-3">
          <Input label="Cidade" value={e.cidade} maxLength={80} onChange={campo('cidade')} />
          <Input label="UF" value={e.uf} maxLength={2} onChange={campo('uf')} />
        </div>
      </div>
      <div className="flex-1" />
      <Rodape desabilitado={!pode} carregando={salvando} erro={erro} onContinuar={continuar} onPular={onPular} />
    </>
  )
}

function PassoTaxa({ onSalvar, onPular }: { onSalvar: (habilitada: boolean, centavos: number) => Promise<string | null>; onPular: () => void }) {
  const [modo, setModo] = useState<'unica' | 'bairro'>('unica')
  const [valor, setValor] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const centavos = valor ? reaisParaCentavos(valor) : 0

  async function continuar() {
    setSalvando(true)
    setErro(await onSalvar(modo === 'unica' && centavos > 0, modo === 'unica' ? centavos : 0))
    setSalvando(false)
  }

  return (
    <>
      <p className="text-sm text-mesa-text-secondary">Quanto você cobra pela entrega?</p>
      <div className="mt-4 flex flex-wrap gap-2" role="radiogroup" aria-label="Como cobrar a entrega">
        <Chip checked={modo === 'unica'} onClick={() => setModo('unica')}>Taxa única</Chip>
        <Chip checked={modo === 'bairro'} onClick={() => setModo('bairro')}>Por bairro</Chip>
      </div>
      {modo === 'unica' ? (
        <Input className="mt-4" label="Valor da taxa (R$)" inputMode="decimal" value={valor} onChange={(e) => setValor(filtrarEntradaPreco(e.target.value))} />
      ) : (
        <p className="mt-4 text-sm text-mesa-text-secondary">
          Você cadastra os bairros e o valor de cada um depois, em Ajustes › Cardápio e operação › Bairros de entrega.
        </p>
      )}
      <div className="flex-1" />
      <Rodape desabilitado={modo === 'unica' && centavos <= 0} carregando={salvando} erro={erro} onContinuar={continuar} onPular={onPular} />
    </>
  )
}

function TelaFinal({ barraca, onIrParaHub, onCadastrarItens, onAtivarPix }: { barraca: Barraca; onIrParaHub: () => void; onCadastrarItens: () => void; onAtivarPix: () => void }) {
  const comKit = Boolean(barraca.kit_aplicado)
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
      <Button variant="outline" size="md" className="w-full" onClick={onCadastrarItens}>{comKit ? 'Completar os preços do cardápio' : 'Cadastrar meus itens'}</Button>
      {!barraca.pagamento_online_habilitado && (
        <Button variant="ghost" size="md" className="w-full" onClick={onAtivarPix}>Ativar o Pix online (o dinheiro cai na sua conta)</Button>
      )}
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
  // Kits iniciais (atrás de VITE_ONBOARDING_KITS): o que o dono escolheu no passo 2 e o aviso do resultado.
  const kitsLigado = onboardingKitsHabilitado(import.meta.env.VITE_ONBOARDING_KITS)
  const [kitEscolhido, setKitEscolhido] = useState<string | null>(null)
  const [avisoKit, setAvisoKit] = useState<string | null>(null)
  // O passo 9 (taxa) só existe com Entrega ligada.
  const entregaAtiva = barraca ? modosAtivos(barraca).includes('entrega') : false
  const ordem = useMemo(() => ordemDoAssistente(entregaAtiva), [entregaAtiva])

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
      let atual = completa
      if (kitsLigado) {
        // Fechou o app entre o passo 3 e a montagem do kit? Aplica agora (a RPC é idempotente).
        const kit = await carregarKitEscolhido()
        if (cancelado) return
        setKitEscolhido(kit)
        if (kit && kit !== KIT_NENHUM && kitDoId(kit) && completa.kit_elegivel !== false && !completa.kit_aplicado_em) {
          const k = await aplicarKit(completa.id, kit as KitId)
          setAvisoKit(mensagemDoEstadoDoKit(k.ok ? k.dados.estado : 'dados_invalidos'))
          atual = (await carregarBarracaCompleta(completa.id)) ?? completa
        }
      }
      setBarraca(atual)
      setSemanaInicial(semanaDoBanco(await carregarSemana(completa.id)))
      if ((completa.onboarding_etapa ?? 0) < 3) await concluirMarca(completa.id)
      setPasso(proximoPassoEm(ordemDoAssistente(modosAtivos(completa).includes('entrega')), Math.max(completa.onboarding_etapa ?? 0, 3)))
      setPronto(true)
    })()
    return () => {
      cancelado = true
    }
  }, [carregandoAuth, carregandoBarracas, usuario, barracas, pronto, navigate, kitsLigado])

  useEffect(() => {
    if (!pronto) return
    registrarEvento(barraca?.id ?? null, passo, 'visto')
  }, [pronto, passo, barraca?.id])

  const irPara = useCallback((n: number) => setPasso(n), [])
  const seguinte = useCallback((feito: number) => setPasso(proximoPassoEm(ordem, feito)), [ordem])
  const anterior = useCallback(() => {
    const i = ordem.indexOf(passo)
    if (i > 0) setPasso(ordem[i - 1])
  }, [passo, ordem])

  // Voltar só até o 1º passo, e nunca para trás do passo 3 depois que a barraca existe (nome e link não mudam aqui).
  const podeVoltar = ordem.indexOf(passo) > 0 && !(barraca && ordem[ordem.indexOf(passo) - 1] < 3)

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

  // Sugestões do kit para os passos 6 e 8: só enquanto o dono ainda não confirmou o passo (o banco manda depois).
  const sugestoes = sugestoesDoKit({
    kitId: kitsLigado ? kitEscolhido : null,
    etapaFeita: barraca?.onboarding_etapa ?? 0,
    temDiaAberto: semanaInicial.some((h) => h.aberto),
  })
  const sugestaoHorario = sugestoes.horario ? { horario: sugestoes.horario, rotulo: sugestoes.rotulo ?? '' } : null
  const sugestaoModos = sugestoes.modos ? { modos: sugestoes.modos, rotulo: sugestoes.rotulo ?? '' } : null

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
        onAtivarPix={async () => {
          await recarregar()
          navigate(`/${barraca.slug}/ajustes`, { replace: true })
        }}
      />
    )
  }

  return (
    <MolduraPasso numero={passo} ordem={ordem} podeVoltar={podeVoltar} onVoltar={anterior}>
      {avisoKit && passo > 3 && (
        <p role="status" className="mb-4 rounded-mesa-lg bg-mesa-surface p-3 text-sm text-mesa-text-secondary">
          {avisoKit}
        </p>
      )}
      {passo === 1 && (
        <PassoOrigem
          onPular={() => pular(1)}
          onSalvar={async (origem, detalhe) => aposSalvar(await salvarOrigem(origem, detalhe, null), 1)}
        />
      )}
      {passo === 2 && (
        <PassoCategoria
          kitsLigado={kitsLigado}
          kitInicial={kitEscolhido}
          onPular={() => pular(2)}
          onSalvar={async (categoria, kit) => {
            const r = await salvarOrigem(null, null, categoria, kit)
            if (r.ok) setKitEscolhido(kit)
            return aposSalvar(r, 2)
          }}
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
              // A barraca já existe; a retomada completa o passo 3 (e o kit) na próxima abertura.
              irPara(6)
              return null
            }
            if (kitsLigado && kitEscolhido && kitEscolhido !== KIT_NENHUM && kitDoId(kitEscolhido)) {
              // Falha do kit nunca trava o assistente: avisa e segue (o Hub oferece de novo).
              const k = await aplicarKit(criada.dados.id, kitEscolhido as KitId)
              setAvisoKit(mensagemDoEstadoDoKit(k.ok ? k.dados.estado : 'dados_invalidos'))
              const atualizada = await carregarBarracaCompleta(criada.dados.id)
              if (atualizada) setBarraca(atualizada)
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
      {passo === 4 && barraca && (
        <PassoCnpj
          inicial={barraca.cnpj ?? ''}
          onPular={() => pular(4)}
          onSalvar={async (d) => aposSalvar(await salvarCnpj(barraca.id, d), 4)}
        />
      )}
      {passo === 5 && barraca && (
        <PassoEndereco
          inicial={{
            cep: barraca.endereco_cep ?? '',
            rua: barraca.endereco_rua ?? '',
            numero: barraca.endereco_numero ?? '',
            complemento: barraca.endereco_complemento ?? '',
            bairro: barraca.endereco_bairro ?? '',
            cidade: barraca.endereco_cidade ?? '',
            uf: barraca.endereco_uf ?? '',
          }}
          onPular={() => pular(5)}
          onSalvar={async (e) => aposSalvar(await salvarEndereco(barraca.id, e), 5)}
        />
      )}
      {passo === 6 && barraca && (
        <PassoHorario
          inicial={sugestaoHorario ? aplicarModelo(sugestaoHorario.horario) : semanaInicial}
          sugestaoDe={sugestaoHorario ? sugestaoHorario.rotulo : null}
          onSalvar={async (semana) => aposSalvar(await salvarHorarios(barraca.id, semana), 6)}
        />
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
          inicial={sugestaoModos ? sugestaoModos.modos : modosAtivos(barraca)}
          sugestaoDe={sugestaoModos ? sugestaoModos.rotulo : null}
          onSalvar={async (modos) => {
            const r = await salvarModos(barraca.id, modos)
            if (r.ok) setBarraca({ ...barraca, modos_atendimento: modos })
            return aposSalvar(r, 8)
          }}
        />
      )}
      {passo === 9 && barraca && (
        <PassoTaxa
          onPular={() => pular(9)}
          onSalvar={async (habilitada, centavos) => aposSalvar(await salvarTaxa(barraca.id, habilitada, centavos), 9)}
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

