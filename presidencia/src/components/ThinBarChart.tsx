import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LabelList } from 'recharts'

export interface ThinBarPoint {
  label: string
  value: number
}

interface ThinBarChartProps {
  title: string
  data: ThinBarPoint[]
  legenda?: string
  height?: number
}

export function ThinBarChart({ title, data, legenda, height = 140 }: ThinBarChartProps) {
  const maxValue = Math.max(0, ...data.map((d) => d.value))

  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <h2 className="text-sm font-semibold text-ink">{title}</h2>
      {legenda && <p className="mt-0.5 text-[11px] text-ink-muted">{legenda}</p>}
      {data.length === 0 ? (
        <p className="mt-2 text-sm text-ink-muted">Sem dados no período</p>
      ) : (
        <div className="mt-2 overflow-x-auto">
          <div style={{ minWidth: Math.max(320, data.length * 14) }}>
            <ResponsiveContainer width="100%" height={height}>
              <BarChart data={data} margin={{ top: 16, right: 8, left: 0, bottom: 0 }} barCategoryGap={2}>
                <CartesianGrid vertical={false} stroke="var(--color-border)" strokeDasharray="3 3" />
                <XAxis dataKey="label" tick={{ fontSize: 9, fill: 'var(--color-ink-muted)' }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                <YAxis hide />
                <Tooltip contentStyle={{ fontSize: 12 }} />
                <Bar dataKey="value" name="novos" fill="var(--color-marque-500)" radius={[2, 2, 0, 0]}>
                  {/* Rotulo seletivo: so' o pico -- barras finas nao comportam rotulo em todas */}
                  <LabelList
                    dataKey="value"
                    content={(props) => {
                      const { x, y, width, value } = props as { x?: number; y?: number; width?: number; value?: number }
                      if (value === undefined || value !== maxValue || value === 0 || x === undefined || y === undefined) return null
                      return (
                        <text x={(x ?? 0) + (width ?? 0) / 2} y={(y ?? 0) - 5} textAnchor="middle" fontSize={10} fill="var(--color-ink-muted)">
                          {value}
                        </text>
                      )
                    }}
                  />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  )
}
