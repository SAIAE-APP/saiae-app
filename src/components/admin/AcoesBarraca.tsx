import { useState } from 'react'
import { useAdminAcoes } from '../../hooks/useAdminAcoes'
import { nomeConfere, textoEfeitoAcao, type AdminBarraca } from '../../lib/adminBarracas'
import { Button } from '../ui/Button'
import { Chip } from '../ui/Chip'
import { Input } from '../ui/Input'
import { DialogoConfirmarAdmin } from './DialogoConfirmarAdmin'

type Dialogo = 'bloquear' | 'desbloquear' | 'plano' | 'estender' | 'arquivar' | 'restaurar'

/** Um diálogo por vez; montado só enquanto aberto, então `erro` do hook sempre começa limpo. */
function DialogoAcao({
  tipo,
  b,
  onFechar,
  onConcluido,
}: {
  tipo: Dialogo
  b: AdminBarraca
  onFechar: () => void
  onConcluido: () => void
}) {
  const acoes = useAdminAcoes()
  const [motivo, setMotivo] = useState('')
  const [plano, setPlano] = useState<'essencial' | 'pro'>(b.plano === 'pro' ? 'essencial' : 'pro')
  const [dias, setDias] = useState('30')
  const [nome, setNome] = useState('')
  const diasNum = Number(dias)
  const diasValidos = Number.isInteger(diasNum) && diasNum >= 1 && diasNum <= 365

  async function confirmar() {
    try {
      if (tipo === 'bloquear') await acoes.bloquear(b.usuario_id, motivo)
      else if (tipo === 'desbloquear') await acoes.desbloquear(b.usuario_id)
      else if (tipo === 'plano') await acoes.definirPlano(b.usuario_id, plano)
      else if (tipo === 'estender') await acoes.estender(b.usuario_id, diasNum)
      else if (tipo === 'arquivar') await acoes.arquivar(b.barraca_id, nome)
      else await acoes.restaurar(b.barraca_id)
    } catch {
      return // o erro já está em acoes.erro
    }
    onConcluido()
  }

  const base = { ocupado: acoes.ocupado, erro: acoes.erro, onConfirmar: confirmar, onFechar }

  switch (tipo) {
    case 'bloquear':
      return (
        <DialogoConfirmarAdmin
          {...base}
          titulo={`Bloquear ${b.nome}?`}
          efeito={textoEfeitoAcao('bloquear', b)}
          rotuloConfirmar="Bloquear conta"
          destrutivo
        >
          <Input label="Motivo (opcional)" value={motivo} maxLength={200} onChange={(e) => setMotivo(e.target.value)} />
        </DialogoConfirmarAdmin>
      )
    case 'desbloquear':
      return (
        <DialogoConfirmarAdmin
          {...base}
          titulo={`Desbloquear ${b.nome}?`}
          efeito="O dono e os funcionários voltam a ter o acesso que o plano e o vencimento permitem."
          rotuloConfirmar="Desbloquear"
        />
      )
    case 'plano':
      return (
        <DialogoConfirmarAdmin
          {...base}
          titulo={`Trocar o plano de ${b.nome}`}
          efeito={textoEfeitoAcao('plano', b)}
          rotuloConfirmar="Trocar plano"
          confirmarHabilitado={plano !== b.plano}
        >
          <div className="flex gap-2" role="group" aria-label="Novo plano">
            {(['essencial', 'pro'] as const).map((p) => (
              <Chip key={p} checked={plano === p} onClick={() => setPlano(p)} className="min-h-11">
                {p === 'pro' ? 'Pro' : 'Essencial'}
              </Chip>
            ))}
          </div>
        </DialogoConfirmarAdmin>
      )
    case 'estender':
      return (
        <DialogoConfirmarAdmin
          {...base}
          titulo={`Estender vencimento de ${b.nome}`}
          efeito={textoEfeitoAcao('estender', b)}
          rotuloConfirmar="Estender"
          confirmarHabilitado={diasValidos}
        >
          <Input
            label="Dias a somar (1 a 365)"
            type="number"
            inputMode="numeric"
            min={1}
            max={365}
            value={dias}
            onChange={(e) => setDias(e.target.value)}
            error={diasValidos ? undefined : 'Informe de 1 a 365 dias.'}
          />
        </DialogoConfirmarAdmin>
      )
    case 'arquivar':
      return (
        <DialogoConfirmarAdmin
          {...base}
          titulo={`Arquivar ${b.nome}?`}
          efeito={textoEfeitoAcao('arquivar', b)}
          rotuloConfirmar="Arquivar barraca"
          destrutivo
          confirmarHabilitado={nomeConfere(nome, b.nome)}
        >
          <Input
            label={`Digite o nome da barraca para confirmar: ${b.nome}`}
            value={nome}
            autoComplete="off"
            onChange={(e) => setNome(e.target.value)}
          />
        </DialogoConfirmarAdmin>
      )
    case 'restaurar':
      return (
        <DialogoConfirmarAdmin
          {...base}
          titulo={`Restaurar ${b.nome}?`}
          efeito="A barraca volta a aparecer no app e no cardápio público."
          rotuloConfirmar="Restaurar"
        />
      )
  }
}

/** Botões de ação do superadmin no card. `onConcluido` recarrega lista e contagens. */
export function AcoesBarraca({ barraca: b, onConcluido }: { barraca: AdminBarraca; onConcluido: () => void }) {
  const [aberto, setAberto] = useState<Dialogo | null>(null)
  const arquivada = b.arquivada_em !== null
  const podeEstender = b.estado !== 'vencida' && b.vencimento_em !== null

  const botao = (tipo: Dialogo, rotulo: string, variant: 'outline' | 'textDanger' = 'outline') => (
    <Button variant={variant} className="min-h-11" onClick={() => setAberto(tipo)}>
      {rotulo}
    </Button>
  )

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {arquivada ? (
          botao('restaurar', 'Restaurar')
        ) : (
          <>
            {b.bloqueada ? botao('desbloquear', 'Desbloquear') : botao('bloquear', 'Bloquear')}
            {botao('plano', 'Trocar plano')}
            {podeEstender && botao('estender', 'Estender')}
            {botao('arquivar', 'Arquivar', 'textDanger')}
          </>
        )}
      </div>
      {!arquivada && !podeEstender && (
        <p className="text-xs text-mesa-text-secondary">
          {b.estado === 'vencida'
            ? 'Conta vencida: estender não devolve o acesso. Reative a conta antes.'
            : 'Sem vencimento: não há o que estender.'}
        </p>
      )}
      {aberto && (
        <DialogoAcao
          tipo={aberto}
          b={b}
          onFechar={() => setAberto(null)}
          onConcluido={() => {
            setAberto(null)
            onConcluido()
          }}
        />
      )}
    </>
  )
}
