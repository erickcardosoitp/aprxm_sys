interface Column<T> {
  header: string
  align?: 'left' | 'right'
  render: (row: T) => React.ReactNode
}

interface DataTableProps<T> {
  title: string
  columns: Column<T>[]
  rows: T[]
  emptyLabel?: string
  keyFn: (row: T, i: number) => string | number
}

export function DataTable<T>({ title, columns, rows, emptyLabel = 'Sem dados no período', keyFn }: DataTableProps<T>) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <h2 className="mb-3 text-sm font-semibold text-ink">{title}</h2>
      {rows.length === 0 ? (
        <p className="text-sm text-ink-muted">{emptyLabel}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-ink-muted">
                {columns.map((c) => (
                  <th key={c.header} className={`pb-2 pr-4 font-medium ${c.align === 'right' ? 'text-right' : 'text-left'}`}>
                    {c.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={keyFn(row, i)} className="border-b border-border/60 last:border-0">
                  {columns.map((c) => (
                    <td key={c.header} className={`py-1.5 pr-4 text-ink ${c.align === 'right' ? 'text-right' : 'text-left'}`}>
                      {c.render(row)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
