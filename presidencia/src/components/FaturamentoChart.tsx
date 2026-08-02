import { useMemo, useState } from 'react'
import {
  ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, ReferenceDot, LabelList,
} from 'recharts'
import { TrendUp, TrendDown } from '@phosphor-icons/react'

export interface SerieDiariaPonto {
  data: string
  receita_total: number
}

interface FaturamentoChartProps {
  serie: SerieDiariaPonto[]
  totalPeriodo: number
  totalAnterior: number
  formatter?: (v: number) => string
}

function formatBRLDefault(v: number): string {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function formatCompacto(v: number): string {
  const abs = Math.abs(v)
  if (abs >= 1000) return `${(v / 1000).toFixed(1).replace(/\.0$/, '')}k`
  return String(Math.round(v))
}

function mm7(serie: number[]): (number | null)[] {
  return serie.map((_, i) => {
    if (i < 6) return null
    const janela = serie.slice(i - 6, i + 1)
    return janela.reduce((a, b) => a + b, 0) / 7
  })
}

export function FaturamentoChart({ serie, totalPeriodo, totalAnterior, formatter = formatBRLDefault }: FaturamentoChartProps) {
  const [mostrarMedia, setMostrarMedia] = useState(false)

  const dados = useMemo(() => {
    const valores = serie.map((p) => p.receita_total)
    const media7 = mm7(valores)
    return serie.map((p, i) => ({
      label: new Date(p.data + 'T00:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }),
      valor: p.receita_total,
      mm7: media7[i],
    }))
  }, [serie])

  const mediaGeral = useMemo(() => {
    if (!dados.length) return 0
    return dados.reduce((a, d) => a + d.valor, 0) / dados.length
  }, [dados])

  // Rotulo seletivo (mesma regra do MiniTrendChart): so' marca o maior valor
  // e o ultimo ponto -- rotular todo dia numa serie diaria vira ilegivel.
  const maxPoint = dados.length ? dados.reduce((a, b) => (b.valor > a.valor ? b : a), dados[0]) : null
  const lastPoint = dados.length ? dados[dados.length - 1] : null

  const cruzamentos = useMemo(() => {
    if (!mostrarMedia) return []
    const pontos: { label: string; valor: number }[] = []
    for (let i = 1; i < dados.length; i++) {
      const prevAcima = dados[i - 1].valor >= mediaGeral
      const curAcima = dados[i].valor >= mediaGeral
      if (prevAcima !== curAcima) pontos.push({ label: dados[i].label, valor: dados[i].valor })
    }
    return pontos
  }, [dados, mediaGeral, mostrarMedia])

  const delta = totalAnterior ? ((totalPeriodo - totalAnterior) / totalAnterior) * 100 : null
  const totalHoje = serie.length ? serie[serie.length - 1].receita_total : 0
  const mediaDia = dados.length ? totalPeriodo / dados.length : 0

  const banda = mediaGeral === 0 ? null
    : totalHoje >= mediaGeral * 1.2 ? { label: 'Excelente', cls: 'bg-emerald-100 text-emerald-700' }
    : totalHoje >= mediaGeral * 0.9 ? { label: 'OK', cls: 'bg-marque-50 text-marque-700' }
    : totalHoje >= mediaGeral * 0.6 ? { label: 'Regular', cls: 'bg-amber-100 text-amber-700' }
    : { label: 'Abaixo', cls: 'bg-red-100 text-red-700' }

  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-xs text-ink-muted">Gráfico de Faturamento</div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-2xl font-semibold text-ink">{formatter(totalPeriodo)}</span>
            {delta !== null && (
              <span className={`flex items-center gap-0.5 text-xs font-medium ${delta >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                {delta >= 0 ? <TrendUp size={12} weight="bold" /> : <TrendDown size={12} weight="bold" />}
                {Math.abs(delta).toFixed(1)}% vs período anterior
              </span>
            )}
          </div>
          <div className="mt-1 flex flex-wrap gap-3 text-[11px] text-ink-muted">
            <span>hoje: {formatter(totalHoje)}</span>
            <span>média/dia: {formatter(mediaDia)}</span>
            {banda && <span className={`rounded-full px-1.5 py-0.5 font-medium ${banda.cls}`}>{banda.label}</span>}
          </div>
        </div>
        <label className="flex items-center gap-1.5 text-xs text-ink-muted">
          <input type="checkbox" checked={mostrarMedia} onChange={(e) => setMostrarMedia(e.target.checked)} />
          Cruzamento com a média
        </label>
      </div>

      <div className="mt-3">
        <ResponsiveContainer width="100%" height={220}>
          <ComposedChart data={dados} margin={{ top: 20, right: 16, left: 0, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--color-border)" strokeDasharray="3 3" />
            <XAxis dataKey="label" tick={{ fontSize: 10, fill: 'var(--color-ink-muted)' }} axisLine={false} tickLine={false} />
            <YAxis hide />
            <Tooltip formatter={(v: unknown) => (v === null || v === undefined ? '—' : formatter(Number(v)))} contentStyle={{ fontSize: 12 }} />
            {mostrarMedia && <ReferenceLine y={mediaGeral} stroke="var(--color-marque-300)" strokeDasharray="4 4" label={{ value: 'média', fontSize: 10, fill: 'var(--color-ink-muted)' }} />}
            <Line type="monotone" dataKey="valor" stroke="var(--color-marque-500)" strokeWidth={2} dot={false} connectNulls>
              <LabelList
                dataKey="valor"
                content={(props) => {
                  const { x, y, value, index } = props as { x?: number; y?: number; value?: number; index?: number }
                  if (index === undefined || value === undefined || x === undefined || y === undefined) return null
                  const isMax = maxPoint && dados[index]?.label === maxPoint.label && dados[index]?.valor === maxPoint.valor
                  const isLast = lastPoint && index === dados.length - 1
                  if (!isMax && !isLast) return null
                  return (
                    <text x={x} y={y - 10} textAnchor="middle" fontSize={10} fill="var(--color-ink-muted)">
                      {formatCompacto(value)}
                    </text>
                  )
                }}
              />
            </Line>
            <Line type="monotone" dataKey="mm7" stroke="var(--color-marque-700)" strokeWidth={1.5} dot={false} connectNulls />
            {maxPoint && <ReferenceDot x={maxPoint.label} y={maxPoint.valor} r={4} fill="var(--color-marque-500)" stroke="none" />}
            {lastPoint && lastPoint.label !== maxPoint?.label && <ReferenceDot x={lastPoint.label} y={lastPoint.valor} r={4} fill="var(--color-marque-700)" stroke="none" />}
            {mostrarMedia && cruzamentos.map((c) => (
              <ReferenceDot key={c.label} x={c.label} y={c.valor} r={3} fill="var(--color-marque-700)" stroke="none" />
            ))}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-1 flex gap-3 text-[10px] text-ink-muted">
        <span>— linha bruta</span>
        <span>— MM7 (média móvel 7 dias)</span>
      </div>
    </div>
  )
}
