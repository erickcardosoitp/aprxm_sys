import { useMemo, useState } from 'react'
import {
  ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, ReferenceDot,
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

function mm7(serie: number[]): (number | null)[] {
  return serie.map((_, i) => {
    if (i < 6) return null
    const janela = serie.slice(i - 6, i + 1)
    return janela.reduce((a, b) => a + b, 0) / 7
  })
}

function projecaoLinear(serie: { x: number; y: number }[], totalPontos: number): number[] {
  const n = serie.length
  if (n < 2) return []
  const sumX = serie.reduce((a, p) => a + p.x, 0)
  const sumY = serie.reduce((a, p) => a + p.y, 0)
  const sumXY = serie.reduce((a, p) => a + p.x * p.y, 0)
  const sumX2 = serie.reduce((a, p) => a + p.x * p.x, 0)
  const denom = n * sumX2 - sumX * sumX
  if (denom === 0) return []
  const slope = (n * sumXY - sumX * sumY) / denom
  const intercept = (sumY - slope * sumX) / n
  const out: number[] = []
  for (let x = n; x < totalPontos; x++) out.push(intercept + slope * x)
  return out
}

export function FaturamentoChart({ serie, totalPeriodo, totalAnterior, formatter = formatBRLDefault }: FaturamentoChartProps) {
  const [mostrarHoje, setMostrarHoje] = useState(false)
  const [mostrarMedia, setMostrarMedia] = useState(false)

  const dados = useMemo(() => {
    const valores = serie.map((p) => p.receita_total)
    const media7 = mm7(valores)
    const mediaGeral = valores.length ? valores.reduce((a, b) => a + b, 0) / valores.length : 0
    return serie.map((p, i) => ({
      label: new Date(p.data + 'T00:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }),
      valor: p.receita_total,
      mm7: media7[i],
      media: mediaGeral,
    }))
  }, [serie])

  const mediaGeral = dados.length ? dados[0].media : 0

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

  const projecao = useMemo(() => {
    if (!mostrarHoje || dados.length < 3) return []
    const pontosXY = dados.map((d, i) => ({ x: i, y: d.valor }))
    const proj = projecaoLinear(pontosXY, dados.length + Math.max(3, Math.round(dados.length * 0.15)))
    return proj.map((v, i) => ({ label: `+${i + 1}`, valor: null, projecao: Math.max(0, v) }))
  }, [dados, mostrarHoje])

  const dadosComProjecao = mostrarHoje ? [...dados, ...projecao] : dados

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
        <div className="flex flex-col gap-1 text-xs text-ink-muted">
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={mostrarHoje} onChange={(e) => setMostrarHoje(e.target.checked)} />
            Hoje + projeção
          </label>
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={mostrarMedia} onChange={(e) => setMostrarMedia(e.target.checked)} />
            Cruzamento com a média
          </label>
        </div>
      </div>

      <div className="mt-3">
        <ResponsiveContainer width="100%" height={220}>
          <ComposedChart data={dadosComProjecao} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--color-border)" strokeDasharray="3 3" />
            <XAxis dataKey="label" tick={{ fontSize: 10, fill: 'var(--color-ink-muted)' }} axisLine={false} tickLine={false} />
            <YAxis hide />
            <Tooltip formatter={(v: unknown) => (v === null || v === undefined ? '—' : formatter(Number(v)))} contentStyle={{ fontSize: 12 }} />
            {mostrarMedia && <ReferenceLine y={mediaGeral} stroke="var(--color-marque-300)" strokeDasharray="4 4" label={{ value: 'média', fontSize: 10, fill: 'var(--color-ink-muted)' }} />}
            {mostrarHoje && dados.length > 0 && (
              <ReferenceLine x={dados[dados.length - 1].label} stroke="var(--color-marque-700)" strokeDasharray="2 2" />
            )}
            <Line type="monotone" dataKey="valor" stroke="var(--color-marque-500)" strokeWidth={2} dot={false} connectNulls />
            <Line type="monotone" dataKey="mm7" stroke="var(--color-marque-700)" strokeWidth={1.5} dot={false} strokeDasharray="0" connectNulls />
            {mostrarHoje && (
              <Line type="monotone" dataKey="projecao" stroke="var(--color-ink-muted)" strokeWidth={1.5} strokeDasharray="4 3" dot={false} connectNulls />
            )}
            {mostrarMedia && cruzamentos.map((c) => (
              <ReferenceDot key={c.label} x={c.label} y={c.valor} r={3} fill="var(--color-marque-700)" stroke="none" />
            ))}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-1 flex gap-3 text-[10px] text-ink-muted">
        <span>— linha bruta</span>
        <span>— MM7</span>
        {mostrarHoje && <span>‐‐‐ projeção linear</span>}
      </div>
    </div>
  )
}
