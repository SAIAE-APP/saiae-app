import { useState, type ReactNode } from 'react'
import { supabase } from '../lib/supabase'
import { useToast } from './ui/useToast'
import { Button } from './ui/Button'
import { Card } from './ui/Card'
import { Icone } from './ui/Icone'
import { Textarea } from './ui/Textarea'
import { BottomSheet } from './ui/BottomSheet'

function RotuloSecao({ icone, children }: { icone?: string; children: ReactNode }) {
  return (
    <h2 className="mb-3 flex items-center gap-1.5 font-mesa-sans text-xs font-semibold uppercase tracking-wider text-mesa-text-secondary">
      {icone && <Icone nome={icone} size={14} />}
      {children}
    </h2>
  )
}

/** "Reportar bug" (pedido de produto 2026-09-27): manda um e-mail pro time
 * via a edge function `reportar-bug` (Resend API) — contexto (usuário,
 * barraca, user agent) vai junto pra ajudar a debugar. Precisa de
 * RESEND_API_KEY/BUG_REPORT_EMAIL_DESTINO configurados como secret da
 * function; sem isso, ela responde com erro e o toast mostra a mensagem. */
export function SecaoAjudaSuporte({
  barracaNome,
  barracaSlug,
}: {
  barracaNome: string
  barracaSlug: string
}) {
  const { mostrarToast } = useToast()
  const [aberto, setAberto] = useState(false)
  const [descricao, setDescricao] = useState('')
  const [esperado, setEsperado] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  function fechar() {
    setAberto(false)
    setDescricao('')
    setEsperado('')
    setErro(null)
  }

  async function enviar() {
    if (!descricao.trim()) return
    setEnviando(true)
    setErro(null)

    const { data, error } = await supabase.functions.invoke('reportar-bug', {
      body: {
        descricao: descricao.trim(),
        esperado: esperado.trim() || null,
        barraca_nome: barracaNome,
        barraca_slug: barracaSlug,
        user_agent: navigator.userAgent,
      },
    })

    setEnviando(false)

    if (error || !data || data.erro) {
      setErro(data?.erro ?? 'Não foi possível enviar. Tente novamente.')
      return
    }

    fechar()
    mostrarToast('Bug reportado, obrigado!', { variante: 'sucesso' })
  }

  return (
    <section>
      <RotuloSecao icone="help">Ajuda e suporte</RotuloSecao>
      <Card>
        <Button
          variant="ghost"
          size="md"
          icon={<Icone nome="bug_report" size={16} />}
          onClick={() => setAberto(true)}
          className="w-full"
        >
          Reportar bug
        </Button>
      </Card>

      <BottomSheet open={aberto} onClose={fechar} aria-label="Reportar bug">
        <h2 className="text-lg font-semibold text-mesa-text-primary">Reportar bug</h2>
        <p className="mt-1 text-sm text-mesa-text-secondary">
          Conta pra gente o que deu errado — a gente lê e responde no seu e-mail.
        </p>

        <div className="mt-4 flex flex-col gap-3">
          <Textarea
            label="O que aconteceu?"
            value={descricao}
            onChange={(e) => setDescricao(e.target.value)}
            placeholder="Descreva o problema"
            rows={4}
          />
          <Textarea
            label="O que você esperava que acontecesse? (opcional)"
            value={esperado}
            onChange={(e) => setEsperado(e.target.value)}
            rows={2}
          />

          {erro && <p className="text-sm font-medium text-mesa-error-500">{erro}</p>}

          <Button
            size="xl"
            loading={enviando}
            disabled={!descricao.trim()}
            onClick={enviar}
            className="w-full"
          >
            Enviar
          </Button>
        </div>
      </BottomSheet>
    </section>
  )
}
