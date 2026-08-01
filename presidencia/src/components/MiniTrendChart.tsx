import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceDot,
} from 'recharts'

export interface TrendPoint {
  label: string
  value: number
}

interface MiniTrendChartProps {
  data: TrendPoint[]
  height?: number
  valueFormatter?: (v: number) => string
}

export function MiniTrendChart({ data, height = 100, valueFormatter = (v) => String(v) }: MiniTrendChartProps) {
  if (data.length === 0) {
    return <div className="flex items-center justify-center text-xs text-ink-muted" style={{ height }}>Sem dado</div>
  }

  const maxPoint = data.reduce((a, b) => (b.value > a.value ? b : a), data[0])
  const lastPoint = data[data.length - 1]

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="marqueFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-marque-500)" stopOpacity={0.3} />
            <stop offset="100%" stopColor="var(--color-marque-500)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke="var(--color-border)" strokeDasharray="3 3" />
        <XAxis dataKey="label" tick={{ fontSize: 10, fill: 'var(--color-ink-muted)' }} axisLine={false} tickLine={false} />
        <YAxis hide domain={['dataMin', 'dataMax']} />
        <Tooltip formatter={(v) => valueFormatter(Number(v))} contentStyle={{ fontSize: 12 }} />
        <Area
          type="monotone"
          dataKey="value"
          stroke="var(--color-marque-500)"
          strokeWidth={2}
          fill="url(#marqueFill)"
        />
        <ReferenceDot x={maxPoint.label} y={maxPoint.value} r={4} fill="var(--color-marque-500)" stroke="none" />
        {lastPoint.label !== maxPoint.label && (
          <ReferenceDot x={lastPoint.label} y={lastPoint.value} r={4} fill="var(--color-marque-700)" stroke="none" />
        )}
      </AreaChart>
    </ResponsiveContainer>
  )
}
