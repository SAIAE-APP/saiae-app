import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { atualizarBarracaCache } from '../hooks/useBarraca'
import { supabase } from '../lib/supabase'
import {
  AVISO_TROCA,
  erroDoCampoSlug,
  mensagemTrocarSlug,
  normalizarSlugDigitado,
  podeSalvarSlug,
  slugDoNome,
  slugParaSalvar,
} from '../lib/trocarSlug'
import { urlPublica } from '../lib/urlPublica'
import { Button } from './ui/Button'
import { Input } from './ui/Input'
import { BottomSheet } from './ui/BottomSheet'
import type { Barraca } from '../types/database'

/**
 * "Endereço do cardápio" (Ajustes › Cardápio & Operação): o dono troca o slug. O endereço antigo continua valendo
 * para sempre como apelido (QR e links impressos não quebram). Só o dono edita; os demais veem o link. Online-only.
 */
export function EnderecoCardapio({ barraca }: { barraca: Barraca }) {
  const navigate = useNavigate()
  const [ehDono, setEhDono] = useState<boolean | null>(null)
  const [digitado, setDigitado] = useState(barraca.slug)
  const [confirmando, setConfirmando] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const barracaId = barraca.id

  useEffect(() => {
    let cancelado = false
    void supabase.auth.getSession().then(async ({ data }) => {
      const uid = data.session?.user.id
      if (!uid) return !cancelado && setEhDono(false)
      const { data: v } = await supabase.from('usuarios_barracas').select('papel').eq('barraca_id', barracaId).eq('usuario_id', uid).maybeSingle()
      if (!cancelado) setEhDono((v as { papel?: string } | null)?.papel === 'dono')
    })
    return () => {
      cancelado = true
    }
  }, [barracaId])

  const slugFinal = slugParaSalvar(digitado)
  const linkNovo = urlPublica(`/${slugFinal || barraca.slug}/cardapio`)
  const erroCampo = slugFinal === barraca.slug ? null : erroDoCampoSlug(slugFinal)

  async function trocar() {
    if (salvando) return
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      setErro('Sem internet. O endereço não foi trocado.')
      return
    }
    setSalvando(true)
    setErro(null)
    let estado: string | undefined
    let novo: string | undefined
    try {
      const { data, error } = await supabase.rpc('barraca_trocar_slug', { p_barraca_id: barracaId, p_novo: slugFinal })
      if (!error) {
        const r = data as { estado?: string; slug?: string } | null
        estado = r?.estado
        novo = r?.slug
      }
    } catch {
      estado = undefined
    }
    setSalvando(false)
    if (estado !== 'ok' || !novo) {
      setErro(mensagemTrocarSlug(estado))
      setConfirmando(false)
      return
    }
    // Endereço atual da tela mudou: atualiza o cache e abre a mesma tela no endereço novo.
    atualizarBarracaCache(barraca.slug, { slug: novo })
    setConfirmando(false)
    navigate(`/${novo}/ajustes/cardapio`, { replace: true })
  }

  if (ehDono === null) return null

  return (
    <div className="mt-4 border-t border-mesa-border-subtle pt-3">
      <p className="text-sm font-semibold text-mesa-text-primary">Endereço do cardápio</p>
      {ehDono ? (
        <>
          <Input
            label="Endereço"
            autoComplete="off"
            value={digitado}
            onChange={(e) => {
              setDigitado(normalizarSlugDigitado(e.target.value))
              setErro(null)
            }}
            error={erroCampo ?? undefined}
            helpText={linkNovo}
          />
          <div className="mt-2 flex flex-wrap gap-2">
            <Button variant="outline" size="md" onClick={() => setDigitado(slugDoNome(barraca.nome))} disabled={!slugDoNome(barraca.nome)}>
              Usar o nome da barraca
            </Button>
            <Button size="md" disabled={!podeSalvarSlug(barraca.slug, digitado)} onClick={() => setConfirmando(true)}>
              Trocar endereço
            </Button>
          </div>
          {erro && (
            <p role="alert" className="mt-2 text-sm font-medium text-mesa-error-700">
              {erro}
            </p>
          )}
          <BottomSheet open={confirmando} onClose={() => !salvando && setConfirmando(false)} aria-label="Trocar o endereço do cardápio">
            <h2 className="text-lg font-semibold text-mesa-text-primary">Trocar o endereço do cardápio?</h2>
            <p className="mt-1 break-all text-sm text-mesa-text-secondary">
              {urlPublica(`/${barraca.slug}/cardapio`)} → {linkNovo}
            </p>
            <p className="mt-2 text-sm text-mesa-text-secondary">{AVISO_TROCA}</p>
            <Button size="xl" className="mt-4 w-full" loading={salvando} onClick={() => void trocar()}>
              Trocar endereço
            </Button>
            <Button variant="ghost" size="md" className="mt-2 w-full" disabled={salvando} onClick={() => setConfirmando(false)}>
              Cancelar
            </Button>
          </BottomSheet>
        </>
      ) : (
        <p className="mt-1 break-all text-xs text-mesa-text-tertiary">
          {urlPublica(`/${barraca.slug}/cardapio`)} (só o dono da barraca troca o endereço)
        </p>
      )}
    </div>
  )
}
