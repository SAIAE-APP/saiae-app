import { rotuloAcao, type AdminAcaoLog } from '../../lib/adminBarracas'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'

function formatarDataHora(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
}

/** Lista das últimas ações do superadmin; erro mostra botão para tentar de novo. */
export function HistoricoAcoesAdmin({
  linhas,
  erro,
  aoTentarDeNovo,
}: {
  linhas: AdminAcaoLog[]
  erro: string | null
  aoTentarDeNovo: () => void
}) {
  return (
    <section aria-labelledby="historico-acoes" className="flex flex-col gap-3">
      <h2 id="historico-acoes" className="text-lg font-semibold text-mesa-text-primary">
        Histórico de ações
      </h2>
      {erro && (
        <div role="alert" className="flex flex-col items-start gap-2">
          <p className="text-mesa-text-secondary">{erro}</p>
          <Button variant="outline" className="min-h-11" onClick={aoTentarDeNovo}>
            Tentar de novo
          </Button>
        </div>
      )}
      {!erro && linhas.length === 0 && <p className="text-mesa-text-secondary">Nenhuma ação registrada ainda.</p>}
      {linhas.length > 0 && (
        <Card>
          <ul className="flex flex-col divide-y divide-mesa-border-default text-sm">
            {linhas.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2 first:pt-0 last:pb-0">
                <span className="font-medium text-mesa-text-primary">{rotuloAcao(l.acao)}</span>
                <span className="text-mesa-text-secondary">
                  {l.admin_email ?? 'admin removido'} · {formatarDataHora(l.criado_em)}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </section>
  )
}
