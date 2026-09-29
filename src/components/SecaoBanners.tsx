import { useEffect, useRef, useState, type ChangeEvent, type ReactNode } from 'react'
import { supabase } from '../lib/supabase'
import { apagarImagemBanner, enviarImagemBanner } from '../lib/bannerCardapio'
import { Button } from './ui/Button'
import { Card } from './ui/Card'
import { Icone } from './ui/Icone'
import { Input } from './ui/Input'
import { Toggle } from './ui/Toggle'
import { useToast } from './ui/Toast'
import { MSG_SEM_INTERNET, mensagemErroSalvar } from '../hooks/useSalvarBarraca'
import type { BannerCardapio } from '../types/database'

type CampoTexto = 'titulo' | 'cta_texto'

function RotuloSecao({ icone, children }: { icone?: string; children: ReactNode }) {
  return (
    <h2 className="mb-3 flex items-center gap-1.5 font-mesa-sans text-xs font-semibold uppercase tracking-wider text-mesa-text-secondary">
      {icone && <Icone nome={icone} size={14} />}
      {children}
    </h2>
  )
}

/** Aproximação leve do carrossel real (CarrosselBanners em
 * CardapioPublico.tsx) só pra pré-visualização em Ajustes — não
 * compartilhada com aquele arquivo de propósito (evita mexer nele
 * enquanto outra sessão trabalha em cima, 2026-09-27). Se divergir
 * visualmente no futuro, alinhar os dois à mão. */
function PreviaCarrossel({ banners }: { banners: BannerCardapio[] }) {
  const ativos = banners.filter((b) => b.ativo)
  if (ativos.length === 0) return null

  return (
    <div className="mb-5">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-mesa-text-secondary">
        Pré-visualização do carrossel
      </p>
      <div className="flex gap-3 overflow-x-auto rounded-mesa-xl bg-mesa-neutral-100 p-3 dark:bg-mesa-neutral-800">
        {ativos.map((banner) => (
          <div
            key={banner.id}
            className="relative aspect-[16/7] w-72 shrink-0 overflow-hidden rounded-mesa-lg bg-mesa-neutral-200 shadow-mesa-1 dark:bg-mesa-neutral-700"
          >
            <img src={banner.imagem_url} alt="" className="size-full object-cover" />
            {(banner.titulo || banner.cta_texto) && (
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-mesa-neutral-900/85 to-transparent p-3 pt-6">
                {banner.titulo && <p className="text-sm font-bold text-white">{banner.titulo}</p>}
                {banner.cta_texto && <p className="text-[11px] text-white/85">{banner.cta_texto}</p>}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

/** Carrossel de banners do topo do Cardápio Digital público — conteúdo
 * configurável pelo dono da barraca, não fixo do app (pedido de produto
 * 2026-09-27). Lista empilhada com setas ▲▼ no mobile; grade com
 * drag-and-drop, edição inline de título/CTA e pré-visualização ao vivo
 * no desktop (pedido de produto 2026-09-27: telas largas ganham mais
 * função de edição, mesmo espírito do resto do app que é mobile-first). */
export function SecaoBanners({ barracaId }: { barracaId: string }) {
  const { mostrarToast } = useToast()
  const [banners, setBanners] = useState<BannerCardapio[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)

  const [novoTitulo, setNovoTitulo] = useState('')
  const [novoCta, setNovoCta] = useState('')
  const [enviandoNovo, setEnviandoNovo] = useState(false)
  const [erroNovo, setErroNovo] = useState<string | null>(null)
  const inputArquivoRef = useRef<HTMLInputElement>(null)

  const arrastandoIdRef = useRef<string | null>(null)
  const valorAoFocarRef = useRef<string>('')

  useEffect(() => {
    let cancelado = false

    supabase
      .from('banners_cardapio')
      .select('*')
      .eq('barraca_id', barracaId)
      .order('ordem')
      .then(({ data, error }) => {
        if (cancelado) return
        if (error) setErro(error.message)
        else setBanners((data ?? []) as BannerCardapio[])
        setCarregando(false)
      })

    return () => {
      cancelado = true
    }
  }, [barracaId])

  async function persistirOrdem(lista: BannerCardapio[]) {
    await Promise.all(
      lista.map((banner, indice) =>
        supabase.from('banners_cardapio').update({ ordem: indice + 1 }).eq('id', banner.id),
      ),
    )
  }

  function moverBanner(id: string, direcao: -1 | 1) {
    const indice = banners.findIndex((b) => b.id === id)
    const novoIndice = indice + direcao
    if (indice === -1 || novoIndice < 0 || novoIndice >= banners.length) return

    const copia = [...banners]
    const [banner] = copia.splice(indice, 1)
    copia.splice(novoIndice, 0, banner)

    const comOrdem = copia.map((b, i) => ({ ...b, ordem: i + 1 }))
    setBanners(comOrdem)
    persistirOrdem(comOrdem)
  }

  // Drag-and-drop (desktop): mesmo padrão de aoSoltar em SecaoCardapio.
  // Fica só na grade md: — no mobile as setas ▲▼ continuam sendo o único
  // jeito de reordenar (arrastar com o dedo é pouco confiável sem lib
  // dedicada, e as setas já resolvem bem em lista curta).
  function aoSoltarBanner(idAlvo: string) {
    const idOrigem = arrastandoIdRef.current
    arrastandoIdRef.current = null
    if (!idOrigem || idOrigem === idAlvo) return

    const indiceOrigem = banners.findIndex((b) => b.id === idOrigem)
    const indiceAlvo = banners.findIndex((b) => b.id === idAlvo)
    if (indiceOrigem === -1 || indiceAlvo === -1) return

    const copia = [...banners]
    const [movido] = copia.splice(indiceOrigem, 1)
    copia.splice(indiceAlvo, 0, movido)

    const comOrdem = copia.map((b, i) => ({ ...b, ordem: i + 1 }))
    setBanners(comOrdem)
    persistirOrdem(comOrdem)
  }

  async function alternarAtivo(banner: BannerCardapio) {
    const novoAtivo = !banner.ativo
    setBanners((atual) => atual.map((b) => (b.id === banner.id ? { ...b, ativo: novoAtivo } : b)))
    const { error } = await supabase
      .from('banners_cardapio')
      .update({ ativo: novoAtivo })
      .eq('id', banner.id)

    if (error) {
      setBanners((atual) => atual.map((b) => (b.id === banner.id ? { ...b, ativo: banner.ativo } : b)))
    }
  }

  async function apagarBanner(banner: BannerCardapio) {
    setBanners((atual) => atual.filter((b) => b.id !== banner.id))
    const { error } = await supabase.from('banners_cardapio').delete().eq('id', banner.id)
    if (!error) apagarImagemBanner(banner.imagem_url)
  }

  // Edição inline de título/CTA (só na grade desktop) — sem reabrir
  // formulário: digita direto no card, salva ao sair do campo. Guarda o
  // valor de antes de focar pra poder desfazer se o salvamento falhar.
  function focarCampo(banner: BannerCardapio, campo: CampoTexto) {
    valorAoFocarRef.current = banner[campo] ?? ''
  }

  function atualizarCampoLocal(id: string, campo: CampoTexto, valor: string) {
    setBanners((atual) => atual.map((b) => (b.id === id ? { ...b, [campo]: valor } : b)))
  }

  async function persistirCampo(id: string, campo: CampoTexto) {
    const banner = banners.find((b) => b.id === id)
    if (!banner) return

    const normalizado = (banner[campo] ?? '').trim() || null
    const valorAntes = valorAoFocarRef.current.trim() || null
    if (normalizado === valorAntes) return

    setBanners((atual) => atual.map((b) => (b.id === id ? { ...b, [campo]: normalizado } : b)))
    const { error } = await supabase.from('banners_cardapio').update({ [campo]: normalizado }).eq('id', id)

    if (error) {
      const mensagem = mensagemErroSalvar(error)
      mostrarToast(mensagem, { variante: mensagem === MSG_SEM_INTERNET ? 'aviso' : 'erro' })
      setBanners((atual) =>
        atual.map((b) => (b.id === id ? { ...b, [campo]: valorAoFocarRef.current || null } : b)),
      )
    }
  }

  async function adicionarBanner(e: ChangeEvent<HTMLInputElement>) {
    const arquivo = e.target.files?.[0]
    e.target.value = ''
    if (!arquivo) return

    setEnviandoNovo(true)
    setErroNovo(null)

    try {
      const imagemUrl = await enviarImagemBanner(barracaId, arquivo)
      const proximaOrdem = banners.length > 0 ? Math.max(...banners.map((b) => b.ordem)) + 1 : 1

      const { data, error } = await supabase
        .from('banners_cardapio')
        .insert({
          barraca_id: barracaId,
          imagem_url: imagemUrl,
          titulo: novoTitulo.trim() || null,
          cta_texto: novoCta.trim() || null,
          ordem: proximaOrdem,
          ativo: true,
        })
        .select()
        .single()

      if (error || !data) throw error ?? new Error('Falha ao salvar banner')

      setBanners((atual) => [...atual, data as BannerCardapio])
      setNovoTitulo('')
      setNovoCta('')
    } catch {
      setErroNovo('Não foi possível adicionar o banner. Tente novamente.')
    }

    setEnviandoNovo(false)
  }

  return (
    <section>
      <RotuloSecao icone="view_carousel">Banners do cardápio digital</RotuloSecao>
      <Card>
        <p className="mb-1 text-sm text-mesa-text-secondary">
          Aparecem em carrossel no topo do cardápio público do cliente. Foto obrigatória; título e
          texto de destaque são opcionais.
        </p>
        <p className="mb-3 text-xs text-mesa-text-tertiary">
          Tamanho ideal: 1200×525px (proporção 16:7) — fotos fora dessa proporção são cortadas
          pra preencher o espaço.
        </p>

        {carregando && <p className="text-sm text-mesa-text-secondary">Carregando...</p>}
        {!carregando && erro && (
          <p className="text-sm text-mesa-error-500">Não foi possível carregar os banners.</p>
        )}

        {!carregando && !erro && (
          <>
            {banners.length === 0 && (
              <p className="text-sm text-mesa-text-secondary">Nenhum banner cadastrado.</p>
            )}

            {/* Mobile: lista empilhada com setas ▲▼ (igual antes). */}
            <ul className="flex flex-col gap-3 divide-y divide-mesa-border-subtle md:hidden">
              {banners.map((banner, indice) => (
                <li key={banner.id} className={`flex gap-3 pt-3 first:pt-0 ${banner.ativo ? '' : 'opacity-50'}`}>
                  <span className="flex h-14 w-24 shrink-0 items-center justify-center overflow-hidden rounded-mesa-md bg-mesa-neutral-100 dark:bg-mesa-neutral-700">
                    <img src={banner.imagem_url} alt="" className="size-full object-cover" />
                  </span>

                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-mesa-text-primary">
                      {banner.titulo || 'Sem título'}
                    </p>
                    {banner.cta_texto && (
                      <p className="truncate text-xs text-mesa-text-secondary">{banner.cta_texto}</p>
                    )}

                    <div className="mt-1.5 flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => moverBanner(banner.id, -1)}
                        disabled={indice === 0}
                        aria-label="Mover banner para cima"
                        className="flex h-[22px] w-6 items-center justify-center text-sm text-mesa-text-tertiary disabled:opacity-30"
                      >
                        ▲
                      </button>
                      <button
                        type="button"
                        onClick={() => moverBanner(banner.id, 1)}
                        disabled={indice === banners.length - 1}
                        aria-label="Mover banner para baixo"
                        className="flex h-[22px] w-6 items-center justify-center text-sm text-mesa-text-tertiary disabled:opacity-30"
                      >
                        ▼
                      </button>
                      <span className="ml-1 text-xs text-mesa-text-secondary">
                        {banner.ativo ? 'Ativo' : 'Inativo'}
                      </span>
                      <Toggle
                        checked={banner.ativo}
                        onChange={() => alternarAtivo(banner)}
                        aria-label={`Banner ${indice + 1} ativo`}
                      />
                      <button
                        type="button"
                        onClick={() => apagarBanner(banner)}
                        aria-label="Apagar banner"
                        className="ml-auto flex size-11 items-center justify-center rounded-mesa-md text-mesa-error-500"
                      >
                        <Icone nome="delete" size={18} />
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>

            {/* Desktop: pré-visualização ao vivo + grade com drag-and-drop
                e edição inline de título/CTA (pedido de produto 2026-09-27). */}
            <div className="hidden md:block">
              <PreviaCarrossel banners={banners} />

              <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
                {banners.map((banner) => (
                  <div
                    key={banner.id}
                    draggable
                    onDragStart={() => {
                      arrastandoIdRef.current = banner.id
                    }}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => aoSoltarBanner(banner.id)}
                    className={`flex cursor-grab flex-col overflow-hidden rounded-mesa-xl border border-mesa-border-subtle bg-mesa-surface ${banner.ativo ? '' : 'opacity-50'}`}
                  >
                    <span className="relative aspect-[16/7] w-full shrink-0 bg-mesa-neutral-100 dark:bg-mesa-neutral-700">
                      <img src={banner.imagem_url} alt="" className="size-full object-cover" />
                      <span className="absolute right-2 top-2 flex size-7 items-center justify-center rounded-mesa-full bg-mesa-neutral-900/60 text-white">
                        <Icone nome="drag_indicator" size={16} />
                      </span>
                    </span>

                    <div className="flex flex-1 flex-col gap-2 p-3">
                      <Input
                        size="sm"
                        value={banner.titulo ?? ''}
                        onFocus={() => focarCampo(banner, 'titulo')}
                        onChange={(e) => atualizarCampoLocal(banner.id, 'titulo', e.target.value)}
                        onBlur={() => persistirCampo(banner.id, 'titulo')}
                        placeholder="Título (opcional)"
                        aria-label={`Título do banner ${banner.id}`}
                      />
                      <Input
                        size="sm"
                        value={banner.cta_texto ?? ''}
                        onFocus={() => focarCampo(banner, 'cta_texto')}
                        onChange={(e) => atualizarCampoLocal(banner.id, 'cta_texto', e.target.value)}
                        onBlur={() => persistirCampo(banner.id, 'cta_texto')}
                        placeholder="Texto de destaque (opcional)"
                        aria-label={`Texto de destaque do banner ${banner.id}`}
                      />

                      <div className="mt-auto flex items-center justify-between gap-2 pt-1">
                        <span className="flex items-center gap-1.5 text-xs text-mesa-text-secondary">
                          {banner.ativo ? 'Ativo' : 'Inativo'}
                          <Toggle
                            checked={banner.ativo}
                            onChange={() => alternarAtivo(banner)}
                            aria-label={`Banner ${banner.titulo ?? banner.id} ativo`}
                          />
                        </span>
                        <button
                          type="button"
                          onClick={() => apagarBanner(banner)}
                          aria-label="Apagar banner"
                          className="flex size-8 items-center justify-center rounded-mesa-md text-mesa-error-500"
                        >
                          <Icone nome="delete" size={18} />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-4 flex flex-col gap-2 border-t border-mesa-border-subtle pt-4 md:max-w-sm">
              <Input
                size="sm"
                value={novoTitulo}
                onChange={(e) => setNovoTitulo(e.target.value)}
                placeholder="Título (opcional)"
                aria-label="Título do novo banner"
              />
              <Input
                size="sm"
                value={novoCta}
                onChange={(e) => setNovoCta(e.target.value)}
                placeholder="Texto de destaque (opcional)"
                aria-label="Texto de destaque do novo banner"
              />
              {erroNovo && <p className="text-sm font-medium text-mesa-error-500">{erroNovo}</p>}
              <Button
                variant="outline"
                size="md"
                icon={<Icone nome="add_photo_alternate" size={16} />}
                loading={enviandoNovo}
                onClick={() => inputArquivoRef.current?.click()}
              >
                Adicionar banner
              </Button>
              <input
                ref={inputArquivoRef}
                type="file"
                accept="image/*"
                onChange={adicionarBanner}
                className="hidden"
              />
            </div>
          </>
        )}
      </Card>
    </section>
  )
}
