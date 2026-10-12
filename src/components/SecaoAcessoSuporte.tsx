import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAcessosSuporteAtivos } from '../hooks/useAcessosSuporteAtivos'
import { formatarDataCurta } from '../lib/datas'
import { Badge } from './ui/Badge'
import { Button } from './ui/Button'
import { Card } from './ui/Card'
import { Icone } from './ui/Icone'
import type { Barraca } from '../types/database'

function RotuloSecao({ icone, children }: { icone?: string; children: React.ReactNode }) {
  return (
    <h2 className="mb-3 flex items-center gap-1.5 font-mesa-sans text-xs font-semibold uppercase tracking-wider text-mesa-text-secondary">
      {icone && <Icone nome={icone} size={14} />}
      {children}
    </h2>
  )
}

/** "Acesso do suporte" (Ajustes › Conta, só dono): gera um código pra alguém
 * da allowlist `usuarios_suporte` entrar na loja sem SQL manual e sem a
 * senha do cliente (ver `suporte_resgatar_codigo`/GateSenhaAdmin). A RPC já
 * recusa quem não é dono — o `ehDono` aqui é só pra não mostrar o botão à
 * toa (mesmo padrão de EnderecoCardapio.tsx). */
export function SecaoAcessoSuporte({ barraca }: { barraca: Barraca }) {
  const [ehDono, setEhDono] = useState<boolean | null>(null)
  const [gerando, setGerando] = useState(false)
  const [codigoGerado, setCodigoGerado] = useState<{ codigo: string; expira_em: string } | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const barracaId = barraca.id
  const { acessos, encerrar } = useAcessosSuporteAtivos(barracaId)

  useEffect(() => {
    let cancelado = false
    void supabase.auth.getSession().then(async ({ data }) => {
      const uid = data.session?.user.id
      if (!uid) return !cancelado && setEhDono(false)
      const { data: v } = await supabase
        .from('usuarios_barracas')
        .select('papel')
        .eq('barraca_id', barracaId)
        .eq('usuario_id', uid)
        .maybeSingle()
      if (!cancelado) setEhDono((v as { papel?: string } | null)?.papel === 'dono')
    })
    return () => {
      cancelado = true
    }
  }, [barracaId])

  if (!ehDono) return null

  async function gerarCodigo() {
    setGerando(true)
    setErro(null)
    const { data, error } = await supabase.rpc('suporte_gerar_codigo', { p_barraca_id: barracaId })
    setGerando(false)

    if (error) {
      setErro('Não foi possível gerar o código. Tente novamente.')
      return
    }
    const resposta = data as { estado: string; codigo?: string; expira_em?: string }
    if (resposta.estado !== 'ok' || !resposta.codigo || !resposta.expira_em) {
      setErro('Não foi possível gerar o código. Tente novamente.')
      return
    }
    setCodigoGerado({ codigo: resposta.codigo, expira_em: resposta.expira_em })
  }

  return (
    <section>
      <RotuloSecao icone="lock">Acesso do suporte</RotuloSecao>
      <Card className="flex flex-col gap-4">
        <p className="text-sm text-mesa-text-secondary">
          Quem tiver este código poderá ver e editar sua loja por 7 dias, para ajudar a montar o cardápio. Você
          pode encerrar o acesso quando quiser.
        </p>

        {codigoGerado ? (
          <div className="rounded-mesa-lg bg-mesa-neutral-100 p-4 text-center dark:bg-mesa-neutral-800">
            <p className="font-mesa-display text-3xl font-bold tracking-[0.2em] text-mesa-text-primary">
              {codigoGerado.codigo}
            </p>
            <p className="mt-1 text-xs text-mesa-text-secondary">
              Válido até {formatarDataCurta(new Date(codigoGerado.expira_em))}, uso único
            </p>
          </div>
        ) : (
          <Button variant="outline" size="md" loading={gerando} onClick={gerarCodigo} className="w-full">
            Gerar código de suporte
          </Button>
        )}

        {erro && <p className="text-sm font-medium text-mesa-error-500">{erro}</p>}

        {acessos.length > 0 && (
          <div className="flex flex-col gap-2 border-t border-mesa-border-default pt-4">
            {acessos.map((acesso) => (
              <div key={acesso.id} className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Badge variant="success" dot>
                    Suporte ativo
                  </Badge>
                  <span className="text-sm text-mesa-text-secondary">
                    até {formatarDataCurta(new Date(acesso.expira_em))}
                  </span>
                </div>
                <Button variant="ghost" size="sm" onClick={() => encerrar(acesso.id)}>
                  Encerrar acesso agora
                </Button>
              </div>
            ))}
          </div>
        )}
      </Card>
    </section>
  )
}
