import { useState, type ReactNode } from 'react'
import { supabase } from '../lib/supabase'
import {
  dispositivosPareados,
  impressoraSuportada,
  imprimirTeste,
} from '../lib/impressoraTermica'
import { Button } from './ui/Button'
import { Card } from './ui/Card'
import { Chip } from './ui/Chip'
import { Icone } from './ui/Icone'
import { Radio } from './ui/Radio'
import { Toggle } from './ui/Toggle'
import { BottomSheet } from './ui/BottomSheet'
import type { Barraca, LarguraPapel } from '../types/database'
import type { PrinterDevice } from '@devlas/capacitor-thermal-printer'

const LARGURAS: { valor: LarguraPapel; rotulo: string }[] = [
  { valor: '58mm', rotulo: '58mm' },
  { valor: '80mm', rotulo: '80mm' },
]

function RotuloSecao({ icone, children }: { icone?: string; children: ReactNode }) {
  return (
    <h2 className="mb-3 flex items-center gap-1.5 font-mesa-sans text-xs font-semibold uppercase tracking-wider text-mesa-text-secondary">
      {icone && <Icone nome={icone} size={14} />}
      {children}
    </h2>
  )
}

function AvisoInline({ children, tom = 'aviso' }: { children: ReactNode; tom?: 'aviso' | 'erro' }) {
  const classes =
    tom === 'erro'
      ? 'border-mesa-error-500 bg-mesa-error-50 text-mesa-error-700 dark:bg-mesa-error-500/15'
      : 'border-mesa-warning-500 bg-mesa-warning-50 text-mesa-warning-700 dark:bg-mesa-warning-500/15'

  return (
    <p className={`mb-3 flex items-start gap-2 rounded-mesa-md border-l-[3px] p-3 text-sm font-medium ${classes}`}>
      <Icone nome={tom === 'erro' ? 'error' : 'warning'} size={16} className="mt-0.5" />
      {children}
    </p>
  )
}

/** Lista de impressoras Bluetooth já pareadas no Android — o plugin não
 * descobre dispositivo novo, o dono pareia antes pelo Bluetooth do sistema
 * (mesmo MVP descrito no plano: sem descoberta/pareamento dentro do app). */
function BottomSheetEscolherImpressora({
  open,
  onClose,
  enderecoAtual,
  onEscolher,
}: {
  open: boolean
  onClose: () => void
  enderecoAtual: string | null
  onEscolher: (dispositivo: PrinterDevice) => void
}) {
  const [dispositivos, setDispositivos] = useState<PrinterDevice[]>([])
  const [buscando, setBuscando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [buscou, setBuscou] = useState(false)

  async function buscar() {
    setBuscando(true)
    setErro(null)
    try {
      const lista = await dispositivosPareados()
      setDispositivos(lista)
      setBuscou(true)
    } catch {
      setErro('Não foi possível listar os dispositivos pareados. Confirme a permissão de Bluetooth do app.')
    }
    setBuscando(false)
  }

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      aria-label="Escolher impressora"
    >
      <h2 className="text-lg font-semibold text-mesa-text-primary">Escolher impressora</h2>
      <p className="mt-1 text-sm text-mesa-text-secondary">
        Pareie a impressora no Bluetooth do Android primeiro, depois toque em buscar.
      </p>

      {erro && (
        <div className="mt-3">
          <AvisoInline tom="erro">{erro}</AvisoInline>
        </div>
      )}

      <Button
        variant="outline"
        size="md"
        icon={<Icone nome="bluetooth_searching" size={16} />}
        loading={buscando}
        onClick={buscar}
        className="mt-4 w-full"
      >
        Buscar impressoras pareadas
      </Button>

      {buscou && dispositivos.length === 0 && !erro && (
        <p className="mt-4 text-sm text-mesa-text-secondary">
          Nenhum dispositivo pareado encontrado. Pareie a impressora no Bluetooth do Android e busque de novo.
        </p>
      )}

      {dispositivos.length > 0 && (
        <ul className="mt-4 flex flex-col gap-1 divide-y divide-mesa-border-subtle">
          {dispositivos.map((dispositivo) => (
            <li key={dispositivo.address} className="py-1">
              <Radio
                checked={dispositivo.address === enderecoAtual}
                onChange={() => onEscolher(dispositivo)}
                value={dispositivo.address ?? ''}
                label={dispositivo.name || dispositivo.address || 'Dispositivo sem nome'}
              />
            </li>
          ))}
        </ul>
      )}

      <Button variant="ghost" size="md" onClick={onClose} className="mt-6 w-full">
        Fechar
      </Button>
    </BottomSheet>
  )
}

/** Configuração da impressora térmica (CLAUDE.md, roadmap): impressão de
 * cupom fica fora de escopo standalone até existir essa aba — aqui só a
 * conexão/teste, nenhum botão de imprimir pedido/nota ainda (fase futura,
 * decisão de produto separada). Suporte é Android-only: o app não tem pasta
 * ios/, e impressão térmica Bluetooth exige plugin nativo (Web Bluetooth do
 * navegador só fala BLE, a maioria das térmicas baratas usa Bluetooth
 * clássico/SPP) — por isso a seção nem aparece fora do app instalado, mesmo
 * padrão de esconder por completo usado no Face ID de Ajustes.tsx. */
export function SecaoImpressora({ barraca }: { barraca: Barraca }) {
  const [habilitada, setHabilitada] = useState(barraca.impressora_habilitada)
  const [largura, setLargura] = useState(barraca.impressora_largura_papel)
  const [endereco, setEndereco] = useState(barraca.impressora_endereco)
  const [nomeDispositivo, setNomeDispositivo] = useState(barraca.impressora_nome)
  const [sheetAberto, setSheetAberto] = useState(false)
  const [testando, setTestando] = useState(false)
  const [erroTeste, setErroTeste] = useState<string | null>(null)
  const [sucessoTeste, setSucessoTeste] = useState(false)

  if (!impressoraSuportada()) return null

  async function alternarHabilitada(valor: boolean) {
    setHabilitada(valor)
    await supabase.from('barracas').update({ impressora_habilitada: valor }).eq('id', barraca.id)
  }

  async function escolherLargura(valor: LarguraPapel) {
    setLargura(valor)
    await supabase.from('barracas').update({ impressora_largura_papel: valor }).eq('id', barraca.id)
  }

  async function escolherDispositivo(dispositivo: PrinterDevice) {
    setSheetAberto(false)
    setSucessoTeste(false)
    setErroTeste(null)
    setEndereco(dispositivo.address ?? null)
    setNomeDispositivo(dispositivo.name ?? null)
    await supabase
      .from('barracas')
      .update({ impressora_endereco: dispositivo.address ?? null, impressora_nome: dispositivo.name ?? null })
      .eq('id', barraca.id)
  }

  async function testar() {
    if (!endereco) return
    setTestando(true)
    setErroTeste(null)
    setSucessoTeste(false)
    try {
      await imprimirTeste({ endereco, largura, nomeBarraca: barraca.nome })
      setSucessoTeste(true)
    } catch {
      setErroTeste('Não foi possível imprimir. Confirme que a impressora está ligada, pareada e com papel.')
    }
    setTestando(false)
  }

  return (
    <section>
      <RotuloSecao icone="print">Impressora térmica</RotuloSecao>
      <Card>
        <div className="flex items-center justify-between gap-3">
          <span className="text-base text-mesa-text-primary">Impressora habilitada</span>
          <Toggle checked={habilitada} onChange={alternarHabilitada} aria-label="Impressora habilitada" />
        </div>

        <div className="mt-4">
          <p className="mb-2 text-sm font-medium text-mesa-text-primary">Largura do papel</p>
          <div className="flex flex-wrap gap-1.5">
            {LARGURAS.map((l) => (
              <Chip key={l.valor} checked={largura === l.valor} onClick={() => escolherLargura(l.valor)}>
                {l.rotulo}
              </Chip>
            ))}
          </div>
        </div>

        <div className="mt-4 flex items-center justify-between gap-3 rounded-mesa-md border border-mesa-border-subtle p-3">
          <div className="min-w-0">
            <p className="text-sm text-mesa-text-primary">Dispositivo</p>
            <p className="truncate text-xs text-mesa-text-secondary">
              {nomeDispositivo || endereco || 'Nenhuma impressora selecionada'}
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => setSheetAberto(true)}>
            {endereco ? 'Trocar' : 'Escolher'}
          </Button>
        </div>

        {erroTeste && (
          <div className="mt-4">
            <AvisoInline tom="erro">{erroTeste}</AvisoInline>
          </div>
        )}

        <Button
          variant="outline"
          size="md"
          icon={<Icone nome="print" size={16} />}
          loading={testando}
          disabled={!endereco}
          onClick={testar}
          className="mt-4 w-full"
        >
          {sucessoTeste ? 'Teste enviado!' : 'Imprimir teste'}
        </Button>
      </Card>

      <BottomSheetEscolherImpressora
        open={sheetAberto}
        onClose={() => setSheetAberto(false)}
        enderecoAtual={endereco}
        onEscolher={escolherDispositivo}
      />
    </section>
  )
}
