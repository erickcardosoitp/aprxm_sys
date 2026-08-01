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
}

export function StatTile({ label, value, hint, icon, delta, badge }: StatTileProps) {
  const hasDelta = delta && delta.pct !== null
  const isUp = hasDelta && (delta!.pct as number) >= 0
  const isGood = hasDelta && (delta!.positiveIsGood ?? true ? isUp : !isUp)

  return (
    <div className="group rounded-xl border border-border bg-surface p-4 transition-all duration-200 hover:-translate-y-0.5 hover:border-marque-300 hover:shadow-md">
      <div className="flex items-center justify-between">
        <span className="text-sm text-ink-muted">{label}</span>
        <span className="transition-transform duration-200 group-hover:scale-110">{icon}</span>
      </div>
      <div className="mt-2 flex items-baseline gap-2">
        <span className="text-2xl font-semibold text-ink">{value}</span>
        {hasDelta && (
          <span
            className={`flex items-center gap-0.5 text-xs font-medium ${
              isGood ? 'text-emerald-600' : 'text-red-500'
            }`}
          >
            {isUp ? <TrendUp size={12} weight="bold" /> : <TrendDown size={12} weight="bold" />}
            {Math.abs(delta!.pct as number).toFixed(1)}%
          </span>
        )}
      </div>
      {badge && (
        <span className="mt-1 inline-block rounded-full bg-marque-50 px-2 py-0.5 text-[10px] font-medium text-marque-700">
          {badge}
        </span>
      )}
      {hint && <div className="mt-1 text-xs text-ink-muted">{hint}</div>}
    </div>
  )
}
