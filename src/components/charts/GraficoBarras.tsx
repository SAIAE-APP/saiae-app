import { useState } from 'react'
import clsx from 'clsx'

export type PontoGrafico = { chave: string; rotulo: string; valor: number }

/** Gráfico de colunas de série única — barras neutras (tinta), a
 * selecionada/mais recente em mostarda (mesmo "um acento por card" do
 * resto do app, não é sinal operacional pra usar mesa-success). Rótulo
 * abaixo do gráfico troca ao tocar/passar o mouse numa barra, em vez de um
 * tooltip flutuante posicionado em cima do SVG (simples e robusto em
 * telas estreitas). */
export function GraficoBarras({
  pontos,
  formatarValor,
  rotuloAcessivel,
}: {
  pontos: PontoGrafico[]
  formatarValor: (valor: number) => string
  rotuloAcessivel: string
}) {
  const [ativo, setAtivo] = useState<number | null>(null)

  if (pontos.length === 0) return null

  const maximo = Math.max(1, ...pontos.map((p) => p.valor))
  const largura = Math.max(pontos.length * 10, 100)
  const altura = 48
  // Com poucos pontos (1-3), (largura/pontos.length)*0.6 dá uma barra
  // enorme (até 60% da largura do gráfico só pra 1 ponto) — depois do
  // preserveAspectRatio="none" esticar o SVG, uma barra tão larga com
  // cantos proporcionalmente arredondados vira uma cápsula/pílula em vez
  // de coluna. Teto de 16 evita isso sem afetar o caso de muitos pontos
  // (com 4+ pontos o valor natural já fica abaixo do teto).
  const larguraBarra = Math.min((largura / pontos.length) * 0.6, 16)
  const espacoBarra = largura / pontos.length

  const passoRotulo = Math.max(1, Math.ceil(pontos.length / 6))
  const indiceExibido = ativo ?? pontos.length - 1
  const pontoExibido = pontos[indiceExibido]

  return (
    <div className="mt-2">
      <svg
        viewBox={`0 0 ${largura} ${altura}`}
        preserveAspectRatio="none"
        className="h-28 w-full"
        role="img"
        aria-label={rotuloAcessivel}
      >
        <line
          x1={0}
          y1={altura - 0.5}
          x2={largura}
          y2={altura - 0.5}
          className="stroke-mesa-border-subtle"
          strokeWidth={0.5}
          vectorEffect="non-scaling-stroke"
        />
        {pontos.map((ponto, indice) => {
          const alturaBarra = ponto.valor > 0 ? Math.max((ponto.valor / maximo) * (altura - 4), 1.5) : 0
          const x = indice * espacoBarra + (espacoBarra - larguraBarra) / 2
          return (
            <rect
              key={ponto.chave}
              x={x}
              y={altura - alturaBarra}
              width={larguraBarra}
              height={alturaBarra}
              rx={larguraBarra / 4}
              className={clsx(
                'cursor-pointer transition-colors',
                indiceExibido === indice
                  ? 'fill-mesa-orange-500'
                  : 'fill-mesa-neutral-300 dark:fill-mesa-neutral-700',
              )}
              onMouseEnter={() => setAtivo(indice)}
              onMouseLeave={() => setAtivo(null)}
              onClick={() => setAtivo(indice)}
            />
          )
        })}
      </svg>

      <div className="mt-1 flex text-[10px] text-mesa-text-tertiary">
        {pontos.map((ponto, indice) =>
          indice % passoRotulo === 0 || indice === pontos.length - 1 ? (
            <span key={ponto.chave} style={{ width: `${100 / pontos.length}%` }} className="text-center">
              {ponto.rotulo}
            </span>
          ) : (
            <span key={ponto.chave} style={{ width: `${100 / pontos.length}%` }} aria-hidden />
          ),
        )}
      </div>

      {pontoExibido && (
        <p className="mt-2 text-sm font-medium text-mesa-text-primary">
          {pontoExibido.rotulo} — <span className="font-mesa-display font-semibold">{formatarValor(pontoExibido.valor)}</span>
        </p>
      )}
    </div>
  )
}
