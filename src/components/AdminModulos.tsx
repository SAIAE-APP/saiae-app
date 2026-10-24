import { useCallback, useEffect, useState } from 'react'
import { Badge } from './ui/Badge'
import { Button } from './ui/Button'
import { Card } from './ui/Card'
import { Input } from './ui/Input'
import { formatarPrecoBR } from '../lib/preco'
import { salvarCredencial } from '../lib/salvarCredencial'
import type { Modulo } from '../lib/modulos'
import {
  PRECO_MODULO_CENTAVOS,
  PRECO_PACOTE_WHATSAPP_CENTAVOS,
  ROTULO_MODULO,
  TAXA_ATIVACAO_FISCAL_CENTAVOS,
  mensagemDoEstado,
  termoParaEnviar,
  teste30Dias,
} from '../lib/adminModulos'
import {
  ativarPacoteWhatsapp,
  definirModulo,
  listarModulos,
  registrarTaxaAtivacao,
  type EstadoModulo,
  type LinhaModulo,
  type Origem,
} from '../lib/adminModulosRpc'

const data = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('pt-BR') : '—')
// Fim do dia local da data escolhida; vazio = null.
const fimDoDia = (d: string) => (d ? new Date(`${d}T23:59:59`).toISOString() : null)
const PRECISA_TERMO: Modulo[] = ['fiscal', 'whatsapp_disparos']
const CAMPO_DATA = 'min-h-11 rounded-lg border border-mesa-border bg-mesa-bg-base px-3 text-mesa-text-primary'

export function AdminModulos({ barracaId }: { barracaId: string }) {
  const [linhas, setLinhas] = useState<LinhaModulo[] | null>(null)
  const [erro, setErro] = useState(false)
  const [pendente, setPendente] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [pagoAte, setPagoAte] = useState<Record<string, string>>({})
  const [termo, setTermo] = useState<Record<string, string>>({})
  const [tokens, setTokens] = useState({ homologacao: '', producao: '' })

  const recarregar = useCallback(async () => {
    const r = await listarModulos(barracaId)
    setErro(r === null)
    if (r) setLinhas(r)
  }, [barracaId])
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void recarregar()
  }, [recarregar])

  async function executar(acao: () => Promise<string>) {
    if (pendente) return
    setPendente(true)
    setMsg(null)
    try {
      const estado = await acao()
      setMsg(mensagemDoEstado(estado))
      await recarregar()
    } finally {
      setPendente(false)
    }
  }

  const definir = (
    l: LinhaModulo,
    estado: Exclude<EstadoModulo, 'inativo'>,
    origem: Origem,
    extra: { testeAte?: string; pagoAte?: string | null } = {},
  ) =>
    executar(() =>
      definirModulo({ barracaId, modulo: l.modulo, estado, origem, testeAte: extra.testeAte, pagoAte: extra.pagoAte, termoVersao: termoParaEnviar(estado, termo[l.modulo]) }),
    )

  async function salvarToken(ambiente: 'homologacao' | 'producao') {
    const valor = tokens[ambiente].trim()
    if (!valor || pendente) return
    setPendente(true)
    setMsg(null)
    try {
      const e = await salvarCredencial({ tipo: 'fiscal', barracaId, ambiente, valor })
      if (!e) setTokens((t) => ({ ...t, [ambiente]: '' }))
      setMsg(e ?? 'Token salvo.')
    } finally {
      setPendente(false)
    }
  }

  const btn = 'min-h-11'
  const fiscal = linhas?.find((l) => l.modulo === 'fiscal')

  return (
    <section className="flex flex-col gap-3" aria-label="Módulos pagos">
      <h2 className="text-base font-semibold text-mesa-text-primary">Módulos pagos</h2>
      {erro && <p role="alert" className="text-mesa-text-secondary">Não foi possível carregar os módulos.</p>}
      {!linhas && !erro && <p className="text-mesa-text-secondary">Carregando...</p>}
      {msg && <p role="status" className="rounded-lg bg-mesa-bg-surface p-3 text-sm text-mesa-text-primary">{msg}</p>}

      {linhas?.map((l) => {
        const pago = fimDoDia(pagoAte[l.modulo] ?? '')
        return (
          <Card key={l.modulo} className="flex flex-col gap-2 text-sm">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold text-mesa-text-primary">
                {ROTULO_MODULO[l.modulo]} · {formatarPrecoBR(PRECO_MODULO_CENTAVOS[l.modulo])}/mês
              </span>
              <Badge variant={l.vigente ? 'success' : 'neutral'}>{l.estado}{l.vigente ? ' · vigente' : ''}</Badge>
            </div>
            <p className="text-mesa-text-secondary">
              Origem {l.origem ?? '—'} · teste até {data(l.teste_ate)} · pago até {data(l.pago_ate)} · termo {l.termo_versao ?? 'não aceito'}
            </p>
            {PRECISA_TERMO.includes(l.modulo) && (
              <Input
                label="Versão do termo aceito"
                helpText={l.termo_versao ? 'Já aceito; só preencha para registrar nova versão.' : 'Obrigatório para ligar.'}
                value={termo[l.modulo] ?? ''}
                onChange={(e) => setTermo({ ...termo, [l.modulo]: e.target.value })}
              />
            )}
            <label className="flex flex-col gap-1 text-mesa-text-secondary">
              Pago até
              <input
                type="date"
                className={CAMPO_DATA}
                value={pagoAte[l.modulo] ?? ''}
                onChange={(e) => setPagoAte({ ...pagoAte, [l.modulo]: e.target.value })}
              />
            </label>
            <div className="flex flex-wrap gap-2">
              <Button className={btn} size="sm" disabled={pendente} onClick={() => definir(l, 'ativo', 'cortesia')}>Ativar cortesia</Button>
              <Button className={btn} size="sm" disabled={pendente || !pago} onClick={() => definir(l, 'ativo', 'pago', { pagoAte: pago })}>
                {l.estado === 'ativo' && l.origem === 'pago' ? 'Registrar pagamento' : 'Ativar pago'}
              </Button>
              <Button className={btn} size="sm" variant="outline" disabled={pendente} onClick={() => definir(l, 'teste', 'cortesia', { testeAte: teste30Dias(new Date()) })}>
                Teste de 30 dias
              </Button>
              <Button className={btn} size="sm" variant="outline" disabled={pendente || l.estado === 'inativo'} onClick={() => definir(l, 'suspenso', l.origem ?? 'cortesia', { pagoAte: l.pago_ate })}>Suspender</Button>
              <Button className={btn} size="sm" variant="destructive" disabled={pendente || l.estado === 'inativo'} onClick={() => definir(l, 'cancelado', l.origem ?? 'cortesia', { pagoAte: l.pago_ate })}>Cancelar</Button>
            </div>
          </Card>
        )
      })}

      <Card className="flex flex-col gap-2 text-sm">
        <span className="font-semibold text-mesa-text-primary">
          Pacote WhatsApp · {formatarPrecoBR(PRECO_PACOTE_WHATSAPP_CENTAVOS)}/mês
        </span>
        <p className="text-mesa-text-secondary">Liga avisos, disparos e bot juntos. Usa a versão do termo de disparos.</p>
        <label className="flex flex-col gap-1 text-mesa-text-secondary">
          Pago até (pacote)
          <input
            type="date"
            className={CAMPO_DATA}
            value={pagoAte.pacote ?? ''}
            onChange={(e) => setPagoAte({ ...pagoAte, pacote: e.target.value })}
          />
        </label>
        <div className="flex flex-wrap gap-2">
          <Button
            className={btn} size="sm" disabled={pendente || !pagoAte.pacote}
            onClick={() => executar(() => ativarPacoteWhatsapp({ barracaId, origem: 'pago', pagoAte: fimDoDia(pagoAte.pacote ?? ''), termoVersao: termo.whatsapp_disparos }))}
          >
            Ativar pacote WhatsApp ({formatarPrecoBR(PRECO_PACOTE_WHATSAPP_CENTAVOS)})
          </Button>
          <Button
            className={btn} size="sm" variant="outline" disabled={pendente}
            onClick={() => executar(() => ativarPacoteWhatsapp({ barracaId, origem: 'cortesia', testeAte: teste30Dias(new Date()), termoVersao: termo.whatsapp_disparos }))}
          >
            Pacote em teste de 30 dias
          </Button>
        </div>
      </Card>

      <Card className="flex flex-col gap-2 text-sm">
        <span className="font-semibold text-mesa-text-primary">Nota fiscal: conta mestre</span>
        <p className="text-mesa-text-secondary">
          Taxa de ativação {formatarPrecoBR(TAXA_ATIVACAO_FISCAL_CENTAVOS)}: cobrada em {data(fiscal?.ativacao_cobrada_em ?? null)}.
        </p>
        <Button className={btn} size="sm" variant="outline" disabled={pendente} onClick={() => executar(() => registrarTaxaAtivacao(barracaId))}>
          Registrar taxa de {formatarPrecoBR(TAXA_ATIVACAO_FISCAL_CENTAVOS)}
        </Button>
        {(['homologacao', 'producao'] as const).map((amb) => (
          <div key={amb} className="flex flex-col gap-2">
            <Input
              type="password"
              autoComplete="off"
              label={`Token Focus (${amb === 'homologacao' ? 'homologação' : 'produção'})`}
              value={tokens[amb]}
              onChange={(e) => setTokens({ ...tokens, [amb]: e.target.value })}
            />
            <Button className={btn} size="sm" variant="outline" disabled={pendente || !tokens[amb].trim()} onClick={() => salvarToken(amb)}>
              Salvar token de {amb === 'homologacao' ? 'homologação' : 'produção'}
            </Button>
          </div>
        ))}
      </Card>
    </section>
  )
}
