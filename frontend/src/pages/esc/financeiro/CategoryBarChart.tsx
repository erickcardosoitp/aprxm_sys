import { Bar, BarChart, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

const BORDER = '#e2e8f0'
const TEXT_MUTED = '#64748b'

const fmt = (v: number) => `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`

interface Props {
  title: string
  data: Record<string, number>
  hue: number
  labelMap?: Record<string, string>
  emptyLabel?: string
}

export default function CategoryBarChart({ title, data, hue, labelMap, emptyLabel }: Props) {
  let entries = Object.entries(data).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1])

  if (entries.length > 6) {
    const tailSum = entries.slice(5).reduce((s, [, v]) => s + v, 0)
    entries = [...entries.slice(0, 5), ['Outros', tailSum] as [string, number]]
  }

  const chartData = entries.map(([key, value]) => ({ name: labelMap?.[key] ?? key, value }))
  const steps = chartData.length
  const lightness = (i: number) => (steps <= 1 ? 45 : 76 - (i * (76 - 40)) / (steps - 1))

  return (
    <div className="border p-4" style={{ borderColor: BORDER }}>
      <p className="text-xs font-semibold text-slate-700 mb-2">{title}</p>
      {chartData.length === 0 ? (
        <p className="text-xs text-center py-8" style={{ color: TEXT_MUTED }}>{emptyLabel ?? 'Sem dados no período.'}</p>
      ) : (
        <ResponsiveContainer width="100%" height={Math.max(chartData.length * 32 + 16, 80)}>
          <BarChart data={chartData} layout="vertical" margin={{ top: 4, right: 56, left: 0, bottom: 4 }}>
            <XAxis type="number" hide />
            <YAxis type="category" dataKey="name" width={112} tick={{ fontSize: 11, fill: TEXT_MUTED }} axisLine={false} tickLine={false} />
            <Tooltip formatter={(v) => fmt(Number(v ?? 0))} contentStyle={{ fontSize: 12, borderColor: BORDER }} />
            <Bar dataKey="value" radius={[0, 4, 4, 0]} maxBarSize={20} isAnimationActive={false}>
              {chartData.map((_, i) => <Cell key={i} fill={`hsl(${hue}, 62%, ${lightness(i)}%)`} />)}
              <LabelList dataKey="value" position="right" formatter={(v: any) => fmt(Number(v ?? 0))} style={{ fontSize: 11, fill: '#0f172a' }} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}
