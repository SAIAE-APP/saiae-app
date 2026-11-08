import { Link } from 'react-router'
import { useSouSuperadmin } from '../hooks/useAdminBarracas'
import { Icone } from './ui/Icone'

/** Atalho para /admin, só para superadmin (o banco continua sendo a barreira; aqui é só não precisar digitar a URL). */
export function AtalhoPainelAdmin({ className }: { className?: string }) {
  const ehSuperadmin = useSouSuperadmin()
  if (ehSuperadmin !== true) return null

  return (
    <Link
      to="/admin"
      className={`inline-flex min-h-11 items-center gap-2 rounded-mesa-md bg-mesa-neutral-900 px-4 text-sm font-semibold text-white dark:bg-mesa-neutral-50 dark:text-mesa-neutral-900 ${className ?? ''}`}
    >
      <Icone nome="hub" size={18} />
      Painel Sai aê
    </Link>
  )
}
