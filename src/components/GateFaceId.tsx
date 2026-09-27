import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router'
import { useAuth } from '../hooks/useAuth'
import { desbloquearComFaceId, emailFaceId, faceIdAtivado } from '../lib/faceId'
import { Button } from './ui/Button'
import { Icone } from './ui/Icone'

function chaveSessao(usuarioId: string): string {
  return `mesaagil:faceid_ok:${usuarioId}`
}

// Escopado por usuário (não só por aparelho): sem isso, a pessoa A
// desbloqueia com Face ID, sai, e a pessoa B loga na mesma aba/aparelho —
// como o flag era uma chave fixa, B herdava o desbloqueio de A e o gate
// nunca pedia biometria de novo pra ela. Cada login (mesmo no mesmo
// aparelho) agora exige seu próprio desbloqueio nessa aba.
function liberadoNaSessao(usuarioId: string): boolean {
  try {
    return window.sessionStorage.getItem(chaveSessao(usuarioId)) === '1'
  } catch {
    return false
  }
}

function marcarLiberado(usuarioId: string): void {
  try {
    window.sessionStorage.setItem(chaveSessao(usuarioId), '1')
  } catch {
    // sessionStorage indisponível — só pede de novo na próxima navegação
  }
}

/** Trava a UI até o Face ID/Touch ID/Windows Hello DESSE aparelho confirmar
 * o dono, quando ativado (ver src/lib/faceId.ts pro porquê disso não
 * envolver verificação de servidor). Não tem nada a ver com estar logado —
 * `sessao` do Supabase continua sendo a autenticação de verdade; isso é só
 * uma trava local por cima dela, tipo tela de bloqueio de celular. Fica
 * liberado pelo resto da sessão do navegador (sessionStorage), igual ao
 * GateSenhaAdmin de Ajustes. */
export function GateFaceId({ children }: { children: ReactNode }) {
  const { usuario, carregando, sair } = useAuth()
  const navigate = useNavigate()
  const [bloqueado, setBloqueado] = useState(false)
  const [verificando, setVerificando] = useState(false)
  const [jaTentouAuto, setJaTentouAuto] = useState(false)

  useEffect(() => {
    if (carregando) return
    setBloqueado(Boolean(usuario) && faceIdAtivado() && !liberadoNaSessao(usuario?.id ?? ''))
  }, [carregando, usuario])

  const tentarDesbloquear = useCallback(async () => {
    if (!usuario) return
    setVerificando(true)
    const ok = await desbloquearComFaceId()
    setVerificando(false)
    if (ok) {
      marcarLiberado(usuario.id)
      setBloqueado(false)
    }
  }, [usuario])

  // tenta uma vez sozinho ao travar (igual um app nativo perguntando Face ID
  // assim que abre) — se o navegador recusar sem gesto do usuário, o botão
  // abaixo cobre o caso
  useEffect(() => {
    if (!bloqueado || jaTentouAuto) return
    setJaTentouAuto(true)
    tentarDesbloquear()
  }, [bloqueado, jaTentouAuto, tentarDesbloquear])

  if (!bloqueado) return <>{children}</>

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-mesa-bg-base p-6 text-center">
      <div className="w-full max-w-[360px]">
        <div className="mx-auto flex size-16 items-center justify-center rounded-mesa-full bg-white shadow-mesa-1 dark:bg-mesa-neutral-800">
          <Icone nome="face" size={24} className="text-mesa-orange-500" />
        </div>
        <h1 className="mt-4 text-2xl font-bold leading-[32px] text-mesa-text-primary">
          Sai aê travado
        </h1>
        <p className="mt-1 text-sm text-mesa-text-secondary">
          {emailFaceId() ? `Desbloqueie como ${emailFaceId()}` : 'Use Face ID pra continuar'}
        </p>

        <Button size="xl" loading={verificando} onClick={tentarDesbloquear} className="mt-8 w-full">
          Desbloquear com Face ID
        </Button>

        <Button
          variant="ghost"
          size="md"
          className="mt-2 w-full"
          onClick={async () => {
            await sair()
            navigate('/login')
          }}
        >
          Sair e entrar com senha
        </Button>
      </div>
    </div>
  )
}
