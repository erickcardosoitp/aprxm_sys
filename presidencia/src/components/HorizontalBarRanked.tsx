interface BarItem {
  label: string
  value: number
}

interface HorizontalBarRankedProps {
  title: string
  items: BarItem[]
  formatter?: (v: number) => string
}

export function HorizontalBarRanked({ title, items, formatter = String }: HorizontalBarRankedProps) {
  const max = Math.max(1, ...items.map((i) => i.value))

  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <h2 className="mb-3 text-sm font-semibold text-ink">{title}</h2>
      {items.length === 0 ? (
        <p className="text-sm text-ink-muted">Sem dados no período</p>
      ) : (
        <div className="space-y-2">
          {items.map((item) => (
            <div key={item.label}>
              <div className="mb-0.5 flex items-center justify-between text-xs">
                <span className="text-ink-muted">{item.label}</span>
                <span className="font-medium text-ink">{formatter(item.value)}</span>
              </div>
              <div className="h-2 rounded-full bg-surface-muted">
                <div
                  className="h-2 rounded-full bg-marque-500"
                  style={{ width: `${Math.max(2, (item.value / max) * 100)}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
