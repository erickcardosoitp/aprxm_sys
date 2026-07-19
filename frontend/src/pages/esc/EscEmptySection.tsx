const BORDER = '#e2e8f0'
const TEXT_MUTED = '#64748b'

export default function EscEmptySection({ columns }: { columns: string[] }) {
  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-auto px-6 py-4">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b" style={{ borderColor: BORDER }}>
              {columns.map((col) => (
                <th key={col} className="text-left py-2 pr-4 font-medium" style={{ color: TEXT_MUTED }}>
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td colSpan={columns.length} className="py-10 text-center text-sm" style={{ color: TEXT_MUTED, fontFamily: "'IBM Plex Mono', monospace" }}>
                módulo ainda não implementado
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}
