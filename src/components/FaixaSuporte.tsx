import { useAcessosSuporteAtivos } from '../hooks/useAcessosSuporteAtivos'
import { formatarDataCurta } from '../lib/datas'
import type { BarracaComPapel } from '../hooks/useBarracasDoUsuario'

const classesFaixa =
  'flex min-h-11 w-full items-center justify-center gap-2 bg-mesa-neutral-900 px-4 py-2 text-center text-sm font-medium text-white dark:bg-mesa-neutral-800'

/** Faixa fixa pro usuário de SUPORTE: "Você está como SUPORTE nesta loja
 * até DD/MM". Lê da lista já carregada por useBarracasDoUsuario (papel
 * sintético 'suporte') — não bate o banco de novo só pra isso. */
export function FaixaSuporteVisao({ barracaId, barracas }: { barracaId: string; barracas: BarracaComPapel[] }) {
  const entrada = barracas.find((b) => b.barraca_id === barracaId && b.papel === 'suporte')
  if (!entrada?.expiraEmSuporte) return null

  return (
    <div className={classesFaixa}>
      Você está como SUPORTE nesta loja até {formatarDataCurta(new Date(entrada.expiraEmSuporte))}
    </div>
  )
}

/** Faixa fixa pro DONO quando há suporte ativo na loja agora. Deliberadamente
 * neutra (tinta, não mostarda) — não é CTA de conversão, é um aviso de
 * segurança. "Encerrar" chama a mesma RPC da seção de Ajustes. */
export function FaixaSuporteDono({ barracaId }: { barracaId: string }) {
  const { acessos, encerrar } = useAcessosSuporteAtivos(barracaId)
  const atual = acessos[0]
  if (!atual) return null

  return (
    <div className={classesFaixa}>
      Suporte com acesso até {formatarDataCurta(new Date(atual.expira_em))}
      <button type="button" onClick={() => encerrar(atual.id)} className="underline underline-offset-2">
        Encerrar
      </button>
    </div>
  )
}
