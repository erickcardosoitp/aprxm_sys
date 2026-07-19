import type { ComponentType, CSSProperties } from 'react'
import { Search } from 'lucide-react'

interface EscPlaceholderProps {
  title: string
  description: string
  icon: ComponentType<{ className?: string; style?: CSSProperties }>
  columns: string[]
}

const BORDER = '#e2e8f0'
const TEXT_MUTED = '#64748b'

export default function EscPlaceholder({ title, description, icon: Icon, columns }: EscPlaceholderProps) {
  return (
    <div className="flex flex-col h-full" style={{ fontFamily: "'IBM Plex Sans', sans-serif" }}>
      <div className="px-6 pt-6 pb-4 border-b" style={{ borderColor: BORDER }}>
        <div className="flex items-center gap-2.5 mb-1">
          <Icon className="w-5 h-5" style={{ color: TEXT_MUTED }} />
          <h1 className="text-lg font-semibold text-slate-900">{title}</h1>
        </div>
        <p className="text-sm" style={{ color: TEXT_MUTED }}>{description}</p>
      </div>

      <div className="px-6 py-3 border-b flex items-center gap-3" style={{ borderColor: BORDER }}>
        <div className="relative flex-1 max-w-xs">
          <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: TEXT_MUTED }} />
          <input
            type="text"
            placeholder="Buscar..."
            disabled
            className="w-full pl-8 pr-3 py-1.5 text-sm border rounded-none focus:outline-none disabled:bg-slate-50"
            style={{ borderColor: BORDER }}
          />
        </div>
        <select disabled className="text-sm border px-2.5 py-1.5 disabled:bg-slate-50" style={{ borderColor: BORDER, color: TEXT_MUTED }}>
          <option>Todos os status</option>
        </select>
      </div>

      <div className="flex-1 overflow-auto px-6 py-2">
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
                nenhum registro — módulo ainda não implementado
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}
