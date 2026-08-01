import type { ReactNode } from 'react'

interface StatTileProps {
  label: string
  value: string
  hint?: string
  icon?: ReactNode
}

export function StatTile({ label, value, hint, icon }: StatTileProps) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="flex items-center justify-between">
        <span className="text-sm text-ink-muted">{label}</span>
        {icon}
      </div>
      <div className="mt-2 text-2xl font-semibold text-ink">{value}</div>
      {hint && <div className="mt-1 text-xs text-ink-muted">{hint}</div>}
    </div>
  )
}
