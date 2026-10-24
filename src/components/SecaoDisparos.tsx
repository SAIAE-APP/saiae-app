import { useEffect, useRef, useState } from 'react'
import { atualizarBarracaCache } from '../hooks/useBarraca'
import { mensagemErroSalvar, useRascunho } from '../hooks/useSalvarBarraca'
import { ErroDisparo, type Previa, useWhatsappDisparos } from '../hooks/useWhatsappDisparos'
import { useWhatsappConexao } from '../hooks/useWhatsappConexao'
import { useModulosDaLoja } from '../layouts/contextoBarraca'
import { temModulo } from '../lib/modulos'
import {
  DIAS_REATIVACAO,
  MAX_TEXTO_AVALIACAO,
  MAX_TEXTO_DISPARO,
  RODAPE_SAIR,
  ROTULO_TIPO,
  TEXTOS_SUGERIDOS,
  TEXTO_AVALIACAO_PADRAO,
  TIPOS_DISPARO,
  estrelas,
  fraseDaPrevia,
  fraseErroDisparo,
  fraseVariaveis,
  variaveisInvalidas,
  VARIAVEIS_AVALIACAO,
  VARIAVEIS_CAMPANHA,
  type CampanhaResumo,
  fraseMotivo,
  fraseMotivoSalvar,
  previaDoTexto,
  resumoCampanha,
  rotuloEstadoCampanha,
  textoDisparoValido,
  type EstadoCampanha,
  type TipoDisparo,
} from '../lib/disparos'
import { supabase } from '../lib/supabase'
import { montarMensagemPronto } from '../lib/avisoPronto'
import { BotaoSalvarCampo, ErroSalvar } from './BotaoSalvarCampo'
import { Badge, type BadgeVariant } from './ui/Badge'
import { BottomSheet } from './ui/BottomSheet'
import { Button } from './ui/Button'
import { Card } from './ui/Card'
import { Chip } from './ui/Chip'
import { Icone } from './ui/Icone'
import { Textarea } from './ui/Textarea'
import { Toggle } from './ui/Toggle'
import type { Barraca } from '../types/database'

const BADGE_ESTADO: Record<EstadoCampanha, BadgeVariant> = {
  em_andamento: 'info',
  concluida: 'success',
  cancelada: 'neutral',
  expirada: 'warning',
}

type Disparos = ReturnType<typeof useWhatsappDisparos>
type AvaliacaoRascunho = { ativa: boolean; texto: string }
const iguais = (a: AvaliacaoRascunho, b: AvaliacaoRascunho) => a.ativa === b.ativa && a.texto === b.texto

function CardAvaliacao({ barraca }: { barraca: Barraca }) {
  const servidor: AvaliacaoRascunho = { ativa: barraca.avaliacao_ativa === true, texto: barraca.avaliacao_texto ?? '' }
  const rascunho = useRascunho<AvaliacaoRascunho>(servidor, iguais)
  const [salvando, setSalvando] = useState(false)
  const [salvo, setSalvo] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const texto = rascunho.valor.texto
  const invalidas = variaveisInvalidas(texto, VARIAVEIS_AVALIACAO)

  async function salvar() {
    setErro(null)
    if (invalidas.length > 0) {
      setErro(fraseVariaveis(invalidas))
      return
    }
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      setErro('Sem internet. Não foi salvo.')
      return
    }
    const limpo = texto.trim() || null // em branco = texto padrão
    setSalvando(true)
    try {
      const { data, error } = await supabase.rpc('whatsapp_avaliacao_salvar', {
        p_barraca_id: barraca.id,
        p_ativa: rascunho.valor.ativa,
        p_texto: limpo,
      })
      if (error) throw error
      const estado = (data as { estado?: string } | null)?.estado
      if (estado !== 'ok') {
        setErro(fraseMotivoSalvar(estado))
        return
      }
      atualizarBarracaCache(barraca.slug, { avaliacao_ativa: rascunho.valor.ativa, avaliacao_texto: limpo })
      rascunho.descartar()
      setSalvo(true)
    } catch (e) {
      setErro(mensagemErroSalvar(e as { message?: string }))
    } finally {
      setSalvando(false)
    }
  }

  const previa = montarMensagemPronto(texto.trim() || TEXTO_AVALIACAO_PADRAO, { nome: 'Maria', senha: 42, barraca: barraca.nome })
  return (
    <Card>
      <label htmlFor="avaliacao-ativa" className="flex min-h-11 cursor-pointer items-center justify-between gap-3">
        <span>
          <span className="block text-base font-medium text-mesa-text-primary">Avaliação após a entrega</span>
          <span className="block text-xs text-mesa-text-tertiary">
            30 minutos depois de entregar, o cliente recebe um pedido de nota de 1 a 5. Só pedidos com telefone.
          </span>
        </span>
        <Toggle
          id="avaliacao-ativa"
          checked={rascunho.valor.ativa}
          onChange={(v) => {
            setSalvo(false)
            rascunho.definir({ ...rascunho.valor, ativa: v })
          }}
          aria-label="Pedir avaliação após a entrega"
        />
      </label>
      <Textarea
        className="mt-3"
        label="Mensagem (em branco = mensagem padrão)"
        helpText="Variáveis: {nome} {senha} {barraca}"
        value={texto}
        onChange={(e) => {
          setSalvo(false)
          rascunho.definir({ ...rascunho.valor, texto: e.target.value })
        }}
        rows={3}
        maxLength={MAX_TEXTO_AVALIACAO}
        error={invalidas.length > 0 ? fraseVariaveis(invalidas) : undefined}
      />
      <p className="mt-1 rounded-mesa-md bg-mesa-neutral-100 p-3 text-sm text-mesa-text-secondary dark:bg-mesa-neutral-800">
        <span className="block text-xs font-semibold uppercase tracking-wider text-mesa-text-tertiary">Prévia</span>
        {previa}
      </p>
      <BotaoSalvarCampo
        alterado={rascunho.alterado}
        salvando={salvando}
        salvo={salvo}
        erro={erro}
        onSalvar={() => void salvar()}
        rotulo="Salvar avaliação"
        desabilitado={invalidas.length > 0}
        className="mt-3"
      />
    </Card>
  )
}

function CardCampanhas({ barraca, d }: { barraca: Barraca; d: Disparos }) {
  const ehDono = d.ehDono === true
  const { tela } = useWhatsappConexao(barraca.id)
  const { historico, previa: buscarPrevia, enviar } = d
  const conectado = tela.tipo === 'conectado'
  const [tipo, setTipo] = useState<TipoDisparo>('reativacao')
  const [dias, setDias] = useState<number>(30)
  const [texto, setTexto] = useState('')
  const [previa, setPrevia] = useState<Previa | 'erro' | null>(null)
  const [erroPrevia, setErroPrevia] = useState<string | null>(null)
  const [confirmando, setConfirmando] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [enviado, setEnviado] = useState<'novo' | 'repetido' | null>(null)
  // Uma chave por intenção de envio (tipo, dias e texto): a retentativa reaproveita o request_id e o CRM não duplica.
  const intencao = useRef<{ chave: string; id: string } | null>(null)
  const trava = useRef(false)
  const emAndamento = historico?.campanhas.some((c) => c.estado === 'em_andamento') ?? false

  useEffect(() => {
    let vivo = true
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPrevia(null)
    buscarPrevia(tipo, tipo === 'reativacao' ? dias : null)
      .then((p) => vivo && setPrevia(p))
      .catch((e) => {
        if (!vivo) return
        setPrevia('erro')
        setErroPrevia(e instanceof ErroDisparo ? fraseErroDisparo(e.codigo) : null)
      })
    return () => {
      vivo = false
    }
  }, [buscarPrevia, tipo, dias])

  const total = previa && previa !== 'erro' ? previa.enviaveis : 0
  const invalidas = variaveisInvalidas(texto, VARIAVEIS_CAMPANHA)
  const podeEnviar = ehDono && conectado && textoDisparoValido(texto) && invalidas.length === 0 && total > 0 && !emAndamento

  function abrirConfirmacao() {
    const chave = JSON.stringify([tipo, tipo === 'reativacao' ? dias : null, texto.trim()])
    if (intencao.current?.chave !== chave) intencao.current = { chave, id: crypto.randomUUID() }
    setConfirmando(true)
  }

  async function confirmar() {
    if (trava.current || !intencao.current) return // duplo toque: uma chamada só
    trava.current = true
    setEnviando(true)
    setErro(null)
    try {
      const r = await enviar(tipo, tipo === 'reativacao' ? dias : null, texto.trim(), intencao.current.id)
      intencao.current = null
      if (r.ok) {
        setEnviado(r.repetido ? 'repetido' : 'novo')
        setTexto('')
      } else {
        setErro(fraseMotivo(r.motivo))
      }
    } catch (e) {
      // Falha de rede: mantém o request_id; tocar em Enviar de novo é a mesma intenção.
      setErro(e instanceof ErroDisparo ? fraseErroDisparo(e.codigo) : fraseMotivo(undefined))
    } finally {
      trava.current = false
      setEnviando(false)
      setConfirmando(false)
    }
  }

  if (d.ehDono !== null && !ehDono) {
    return (
      <Card>
        <p className="text-base font-medium text-mesa-text-primary">Campanhas</p>
        <p className="mt-1 text-sm text-mesa-text-secondary">Só o dono da loja cria e cancela campanhas. Você pode acompanhar o histórico abaixo.</p>
      </Card>
    )
  }

  return (
    <Card>
      <p className="text-base font-medium text-mesa-text-primary">Campanhas</p>
      <p className="text-xs text-mesa-text-tertiary">
        Só vão clientes que aceitaram receber ofertas. A mensagem sai aos poucos, entre 9h e 20h, e termina com o aviso para
        responder SAIR.
      </p>

      <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Tipo de campanha">
        {TIPOS_DISPARO.map((t) => (
          <Chip key={t} checked={tipo === t} onClick={() => { setTipo(t); setEnviado(null) }} className="min-h-11">
            {ROTULO_TIPO[t]}
          </Chip>
        ))}
      </div>
      {tipo === 'reativacao' && (
        <div className="mt-3">
          <p className="text-xs font-semibold text-mesa-neutral-700 dark:text-mesa-neutral-300">Sem pedir há mais de</p>
          <div className="mt-1.5 flex flex-wrap gap-2" role="group" aria-label="Dias sem pedir">
            {DIAS_REATIVACAO.map((d) => (
              <Chip key={d} checked={dias === d} onClick={() => { setDias(d); setEnviado(null) }} className="min-h-11">
                {d} dias
              </Chip>
            ))}
          </div>
        </div>
      )}

      <p className="mt-4 text-xs font-semibold text-mesa-neutral-700 dark:text-mesa-neutral-300">Sugestões de texto</p>
      <div className="mt-1.5 flex flex-col gap-2">
        {TEXTOS_SUGERIDOS[tipo].map((s) => (
          <Button key={s} variant="outline" size="md" className="h-auto min-h-11 w-full justify-start whitespace-normal! py-2 text-left [&>span]:min-w-0 [&>span]:justify-start" onClick={() => setTexto(s)}>
            {s}
          </Button>
        ))}
      </div>
      <Textarea
        className="mt-3"
        label="Mensagem"
        helpText="Variáveis: {nome} {barraca}"
        error={invalidas.length > 0 ? fraseVariaveis(invalidas) : undefined}
        value={texto}
        onChange={(e) => { setTexto(e.target.value); setEnviado(null) }}
        rows={4}
        maxLength={MAX_TEXTO_DISPARO}
      />
      {textoDisparoValido(texto) && (
        <p className="mt-1 rounded-mesa-md bg-mesa-neutral-100 p-3 text-sm text-mesa-text-secondary dark:bg-mesa-neutral-800">
          <span className="block text-xs font-semibold uppercase tracking-wider text-mesa-text-tertiary">Prévia</span>
          {previaDoTexto(texto.trim(), barraca.nome)}
          <span className="mt-2 block text-xs text-mesa-text-tertiary">{RODAPE_SAIR}</span>
        </p>
      )}

      <p className="mt-3 text-sm text-mesa-text-primary" aria-live="polite">
        {previa === null && 'Calculando…'}
        {previa === 'erro' && (erroPrevia ?? 'Não foi possível contar os clientes agora.')}
        {previa && previa !== 'erro' && fraseDaPrevia(previa)}
      </p>
      {(tela.tipo === 'sem_sessao' || tela.tipo === 'desconectado' || tela.tipo === 'qr') && (
        <p className="mt-1 text-sm text-mesa-text-secondary">Conecte o WhatsApp da loja (seção acima) para enviar.</p>
      )}
      {tela.tipo === 'erro' && <p className="mt-1 text-sm text-mesa-text-secondary">Não foi possível verificar o WhatsApp da loja agora.</p>}
      {emAndamento && <p className="mt-1 text-sm text-mesa-text-secondary">Já há uma campanha em andamento. Espere terminar para criar outra.</p>}
      {enviado && (
        <p role="status" className="mt-1 flex items-center gap-1.5 text-sm font-medium text-mesa-text-primary">
          <Icone nome="check" size={16} /> {enviado === 'repetido' ? 'Campanha já criada. Acompanhe abaixo.' : 'Campanha criada. Acompanhe abaixo.'}
        </p>
      )}
      <ErroSalvar erro={erro} className="mt-2" />
      <Button variant="primary" size="md" className="mt-3" icon={<Icone nome="send" size={16} />} disabled={!podeEnviar} onClick={abrirConfirmacao}>
        Enviar
      </Button>

      <BottomSheet open={confirmando} onClose={() => !enviando && setConfirmando(false)} aria-label="Confirmar envio da campanha">
        <div className="p-5">
          <p className="font-mesa-display text-lg font-semibold text-mesa-text-primary">Enviar para {total} {total === 1 ? 'cliente' : 'clientes'}?</p>
          <p className="mt-2 text-sm text-mesa-text-secondary">
            Cada cliente recebe no máximo uma mensagem de campanha por dia. O aviso "{RODAPE_SAIR}" é incluído no fim da
            mensagem e não pode ser removido.
          </p>
          <div className="mt-4 flex flex-col gap-2">
            <Button variant="primary" size="lg" loading={enviando} onClick={() => void confirmar()}>
              Enviar agora
            </Button>
            <Button variant="outline" size="lg" disabled={enviando} onClick={() => setConfirmando(false)}>
              Voltar
            </Button>
          </div>
        </div>
      </BottomSheet>
    </Card>
  )
}

function CardHistorico({ d }: { d: Disparos }) {
  const { historico, erro, recarregar, cancelar } = d
  const [alvo, setAlvo] = useState<CampanhaResumo | null>(null)
  const [cancelando, setCancelando] = useState<string | null>(null)
  const [falha, setFalha] = useState<{ id: string; frase: string } | null>(null)
  const trava = useRef(false)

  async function confirmarCancelamento() {
    if (!alvo || trava.current) return // duplo toque: uma chamada só
    trava.current = true
    const id = alvo.id
    setCancelando(id)
    setFalha(null)
    setAlvo(null)
    const r = await cancelar(id)
    if (!r.ok) setFalha({ id, frase: r.codigo ? fraseErroDisparo(r.codigo) : 'Não foi possível cancelar agora. Tente de novo.' })
    trava.current = false
    setCancelando(null)
  }

  if (erro && !historico) {
    return (
      <Card>
        <ErroSalvar erro="Não foi possível carregar as campanhas agora." />
        <Button variant="outline" size="md" className="mt-3" onClick={recarregar}>
          Tentar de novo
        </Button>
      </Card>
    )
  }
  if (!historico) {
    return (
      <Card>
        <p className="text-sm text-mesa-text-secondary">Carregando…</p>
      </Card>
    )
  }
  const { campanhas, avaliacoes } = historico
  return (
    <Card>
      <p className="text-base font-medium text-mesa-text-primary">Últimas campanhas</p>
      {campanhas.length === 0 ? (
        <p className="mt-1 text-sm text-mesa-text-secondary">Nenhuma campanha enviada ainda.</p>
      ) : (
        <ul className="mt-2 divide-y divide-mesa-border-subtle">
          {campanhas.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
              <span className="min-w-0">
                <span className="block text-sm text-mesa-text-primary">
                  {ROTULO_TIPO[c.tipo]} · {new Date(c.criada_em).toLocaleDateString('pt-BR')}
                </span>
                <span className="block text-xs text-mesa-text-secondary">{resumoCampanha(c)}</span>
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <Badge variant={BADGE_ESTADO[c.estado]}>{rotuloEstadoCampanha(c.estado)}</Badge>
                {c.estado === 'em_andamento' && d.ehDono === true && (
                  <Button
                    variant="textDanger"
                    size="md"
                    loading={cancelando === c.id}
                    disabled={cancelando !== null}
                    aria-label={`Cancelar campanha ${ROTULO_TIPO[c.tipo]} de ${new Date(c.criada_em).toLocaleDateString('pt-BR')}`}
                    onClick={() => setAlvo(c)}
                  >
                    {cancelando === c.id ? 'Cancelando…' : 'Cancelar'}
                  </Button>
                )}
              </span>
              {falha?.id === c.id && <ErroSalvar erro={falha.frase} className="basis-full" />}
            </li>
          ))}
        </ul>
      )}
      <BottomSheet open={alvo !== null} onClose={() => setAlvo(null)} aria-label="Confirmar cancelamento da campanha">
        <div className="p-5">
          <p className="font-mesa-display text-lg font-semibold text-mesa-text-primary">Cancelar esta campanha?</p>
          <p className="mt-2 text-sm text-mesa-text-secondary">As mensagens que ainda não saíram não serão enviadas. As que já saíram não podem ser desfeitas.</p>
          <div className="mt-4 flex flex-col gap-2">
            <Button variant="destructive" size="lg" onClick={() => void confirmarCancelamento()}>
              Cancelar campanha
            </Button>
            <Button variant="outline" size="lg" onClick={() => setAlvo(null)}>
              Voltar
            </Button>
          </div>
        </div>
      </BottomSheet>

      <div className="mt-4 border-t border-mesa-border-subtle pt-4">
        <p className="text-base font-medium text-mesa-text-primary">Avaliações</p>
        {avaliacoes.total === 0 ? (
          <p className="mt-1 text-sm text-mesa-text-secondary">Nenhuma avaliação recebida ainda.</p>
        ) : (
          <>
            <p className="mt-1 font-mesa-display text-2xl font-semibold text-mesa-text-primary">
              {avaliacoes.media === null ? '-' : avaliacoes.media.toLocaleString('pt-BR', { minimumFractionDigits: 1 })}
              <span className="ml-2 text-sm font-normal text-mesa-text-secondary">
                {avaliacoes.total} {avaliacoes.total === 1 ? 'avaliação' : 'avaliações'}
              </span>
            </p>
            <ul className="mt-2 space-y-2">
              {avaliacoes.itens.map((i) => (
                <li key={`${i.pedido_id}-${i.em}`} className="text-sm">
                  <span className="text-mesa-text-primary" aria-label={`Nota ${i.nota} de 5`}>
                    {estrelas(i.nota)}
                  </span>
                  <span className="ml-2 text-xs text-mesa-text-tertiary">{new Date(i.em).toLocaleDateString('pt-BR')}</span>
                  {i.comentario && <p className="text-mesa-text-secondary">{i.comentario}</p>}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </Card>
  )
}

/** Campanhas de WhatsApp e avaliação pós-entrega. Avaliação aparece com o módulo whatsapp_avisos, campanhas com whatsapp_disparos. */
export function SecaoDisparos({ barraca }: { barraca: Barraca }) {
  const d = useWhatsappDisparos(barraca.id)
  const modulos = useModulosDaLoja()
  const comAvisos = temModulo(modulos, 'whatsapp_avisos')
  const comDisparos = temModulo(modulos, 'whatsapp_disparos')
  return (
    <section>
      <h2 className="mb-3 flex items-center gap-1.5 font-mesa-sans text-xs font-semibold uppercase tracking-wider text-mesa-text-secondary">
        <Icone nome="campaign" size={14} />
        Campanhas e avaliação
      </h2>
      <div className="flex flex-col gap-3">
        {comAvisos && d.ehDono === true && <CardAvaliacao barraca={barraca} />}
        {comDisparos && <CardCampanhas barraca={barraca} d={d} />}
        <CardHistorico d={d} />
      </div>
    </section>
  )
}
