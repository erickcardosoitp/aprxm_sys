import { useMemo, useState } from 'react'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, LabelList,
} from 'recharts'

// Mesma paleta categórica de 8 cores já validada em unidadeColor() (EscDataTable.tsx,
// frontend principal) -- cor fixa por entidade, nunca recalculada ao (des)marcar série.
const CATEGORIA_CORES: Record<string, string> = {
  mensalidade: '#1d4ed8',
  taxa_entrega: '#15803d',
  comprovante_residencia: '#b45309',
  outras_receitas: '#6d28d9',
}

const CATEGORIA_LABEL: Record<string, string> = {
  mensalidade: 'Mensalidade',
  taxa_entrega: 'Taxa de entrega',
  comprovante_residencia: 'Comprovante de residência',
  outras_receitas: 'Outras',
}

export interface SerieDiariaProduto {
  data: string
  mensalidade: number
  taxa_entrega: number
  comprovante_residencia: number
  outras_receitas: number
}

interface MultiSeriesAreaProps {
  serie: SerieDiariaProduto[]
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

const CATEGORIAS = ['mensalidade', 'taxa_entrega', 'comprovante_residencia'] as const

export function MultiSeriesArea({ serie, formatter = formatBRLDefault }: MultiSeriesAreaProps) {
  const [ativas, setAtivas] = useState<Set<string>>(new Set(CATEGORIAS))

  const dados = useMemo(() => serie.map((p) => ({
    label: new Date(p.data + 'T00:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }),
    mensalidade: p.mensalidade,
    taxa_entrega: p.taxa_entrega,
    comprovante_residencia: p.comprovante_residencia,
  })), [serie])

  function toggle(cat: string) {
    setAtivas((prev) => {
      const next = new Set(prev)
      if (next.has(cat)) next.delete(cat)
      else next.add(cat)
      return next
    })
  }

  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-ink">Faturamento por produto</h2>
        <div className="flex gap-3 text-xs">
          {CATEGORIAS.map((cat) => (
            <label key={cat} className="flex items-center gap-1 text-ink-muted">
              <input type="checkbox" checked={ativas.has(cat)} onChange={() => toggle(cat)} />
              <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: CATEGORIA_CORES[cat] }} />
              {CATEGORIA_LABEL[cat]}
            </label>
          ))}
        </div>
      </div>
      <ResponsiveContainer width="100%" height={200}>
        <AreaChart data={dados} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
          <defs>
            {CATEGORIAS.map((cat) => (
              <linearGradient key={cat} id={`grad-${cat}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={CATEGORIA_CORES[cat]} stopOpacity={0.35} />
                <stop offset="100%" stopColor={CATEGORIA_CORES[cat]} stopOpacity={0} />
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid vertical={false} stroke="var(--color-border)" strokeDasharray="3 3" />
          <XAxis dataKey="label" tick={{ fontSize: 10, fill: 'var(--color-ink-muted)' }} axisLine={false} tickLine={false} />
          <YAxis hide />
          <Tooltip formatter={(v: unknown) => formatter(Number(v))} contentStyle={{ fontSize: 12 }} />
          <Legend wrapperStyle={{ display: 'none' }} />
          {CATEGORIAS.filter((c) => ativas.has(c)).map((cat) => (
            <Area
              key={cat}
              type="monotone"
              dataKey={cat}
              name={CATEGORIA_LABEL[cat]}
              stroke={CATEGORIA_CORES[cat]}
              fill={`url(#grad-${cat})`}
              strokeWidth={2}
            >
              {/* Rotulo seletivo: so' o ultimo ponto de cada serie (valor atual) --
                  com 3 series sobrepostas, marcar mais que isso vira ilegivel. */}
              <LabelList
                dataKey={cat}
                content={(props) => {
                  const { x, y, value, index } = props as { x?: number; y?: number; value?: number; index?: number }
                  if (index === undefined || index !== dados.length - 1 || value === undefined || x === undefined || y === undefined) return null
                  return (
                    <text x={x} y={y - 6} textAnchor="end" fontSize={9} fill={CATEGORIA_CORES[cat]} fontWeight={600}>
                      {formatCompacto(value)}
                    </text>
                  )
                }}
              />
            </Area>
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
