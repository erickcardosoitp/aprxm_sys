import type { ReactNode } from 'react'
import { TrendUp, TrendDown } from '@phosphor-icons/react'

interface DeltaInfo {
  pct: number | null
  positiveIsGood?: boolean
}

interface StatTileProps {
  label: string
  value: string
  hint?: string
  icon?: ReactNode
  delta?: DeltaInfo
  badge?: string
  breakdown?: { label: string; value: string }[]
}

export function StatTile({ label, value, hint, icon, delta, badge, breakdown }: StatTileProps) {
  const hasDelta = delta && delta.pct !== null
  const isUp = hasDelta && (delta!.pct as number) >= 0
  const isGood = hasDelta && (delta!.positiveIsGood ?? true ? isUp : !isUp)

  return (
    <div className="group rounded-lg border border-border bg-surface p-3 transition-all duration-200 hover:-translate-y-0.5 hover:border-marque-300 hover:shadow-md">
      <div className="flex items-center justify-between">
        <span className="text-xs text-ink-muted">{label}</span>
        <span className="transition-transform duration-200 group-hover:scale-110">{icon}</span>
      </div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="text-xl font-semibold text-ink">{value}</span>
        {hasDelta && (
          <span
            className={`flex items-center gap-0.5 text-[11px] font-medium ${
              isGood ? 'text-emerald-600' : 'text-red-500'
            }`}
          >
            {isUp ? <TrendUp size={11} weight="bold" /> : <TrendDown size={11} weight="bold" />}
            {Math.abs(delta!.pct as number).toFixed(1)}%
          </span>
        )}
        {badge && (
          <span className="rounded-full bg-marque-50 px-1.5 py-0.5 text-[10px] font-medium text-marque-700">
            {badge}
          </span>
        )}
      </div>
      {hint && <div className="mt-0.5 text-[11px] text-ink-muted">{hint}</div>}
      {breakdown && breakdown.length > 0 && (
        <div className="mt-1.5 flex gap-3 border-t border-border pt-1.5">
          {breakdown.map((b) => (
            <span key={b.label} className="text-[11px] text-ink-muted">
              {b.label}: <span className="font-medium text-ink">{b.value}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
