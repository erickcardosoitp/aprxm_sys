interface SegmentedProgressBarProps {
  label: string
  pct: number | null
  legenda?: string
  hint?: string
}

export function SegmentedProgressBar({ label, pct, legenda, hint }: SegmentedProgressBarProps) {
  const clamped = pct === null ? 0 : Math.max(0, Math.min(100, pct))
  const segments = 20
  const filled = pct === null ? 0 : Math.round((clamped / 100) * segments)

  return (
    <div className="rounded-lg border border-border bg-surface p-3">
      <div className="flex items-center justify-between">
        <span title={legenda} className="text-xs text-ink-muted">{label}</span>
        <span className="text-lg font-semibold text-ink">{pct !== null ? `${pct}%` : '—'}</span>
      </div>
      <div className="mt-2 flex gap-0.5">
        {Array.from({ length: segments }, (_, i) => (
          <div
            key={i}
            className={`h-2 flex-1 rounded-sm ${i < filled ? 'bg-marque-500' : 'bg-surface-muted'}`}
          />
        ))}
      </div>
      {hint && <div className="mt-1 text-[11px] text-ink-muted">{hint}</div>}
    </div>
  )
}
