import { useEffect, useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import type { AxiosResponse } from 'axios'

const BORDER = '#e2e8f0'
const TEXT_MUTED = '#64748b'

interface Column {
  key: string
  label: string
  render?: (row: any) => React.ReactNode
}

interface EscDataTableProps {
  columns: Column[]
  fetchFn: () => Promise<AxiosResponse<any[]>>
  searchKeys?: string[]
  toolbarAction?: React.ReactNode
  rowActions?: (row: any) => React.ReactNode
  reloadKey?: number
  statusFilter?: boolean  // filtro Ativos/Inativos/Todos (usa row.is_active), padrão Ativos
  filterKeys?: { key: string; label: string }[]  // filtros por coluna (opções auto-derivadas dos dados)
}

export default function EscDataTable({ columns, fetchFn, searchKeys, toolbarAction, rowActions, reloadKey, statusFilter, filterKeys }: EscDataTableProps) {
  const [rows, setRows] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<'ativos' | 'inativos' | 'todos'>('ativos')
  const [colFilters, setColFilters] = useState<Record<string, string>>({})

  useEffect(() => {
    let alive = true
    setLoading(true)
    setError(false)
    fetchFn()
      .then((res) => { if (alive) setRows(res.data ?? []) })
      .catch(() => { if (alive) setError(true) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [fetchFn, reloadKey])

  // opções distintas por filtro, derivadas dos dados carregados
  const filterOptions = useMemo(() => {
    const m: Record<string, string[]> = {}
    for (const f of filterKeys ?? []) {
      m[f.key] = [...new Set(rows.map((r) => r[f.key]).filter((v) => v != null && v !== ''))].map(String).sort()
    }
    return m
  }, [rows, filterKeys])

  const filtered = useMemo(() => {
    let out = rows
    if (statusFilter && status !== 'todos') {
      const want = status === 'ativos'
      out = out.filter((r) => !!r.is_active === want)
    }
    for (const [k, v] of Object.entries(colFilters)) {
      if (v) out = out.filter((r) => String(r[k] ?? '') === v)
    }
    if (query.trim() && searchKeys?.length) {
      const q = query.toLowerCase()
      out = out.filter((r) => searchKeys.some((k) => String(r[k] ?? '').toLowerCase().includes(q)))
    }
    return out
  }, [rows, query, searchKeys, statusFilter, status, colFilters])

  return (
    <div className="flex flex-col h-full">
      <div className="px-6 py-3 border-b flex items-center gap-3" style={{ borderColor: BORDER }}>
        <div className="relative flex-1 max-w-xs">
          <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: TEXT_MUTED }} />
          <input
            type="text"
            placeholder="Buscar..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            disabled={!searchKeys?.length}
            className="w-full pl-8 pr-3 py-1.5 text-sm border focus:outline-none disabled:bg-slate-50"
            style={{ borderColor: BORDER }}
          />
        </div>
        {statusFilter && (
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as 'ativos' | 'inativos' | 'todos')}
            className="text-sm border px-2 py-1.5"
            style={{ borderColor: BORDER, color: TEXT_MUTED }}
          >
            <option value="ativos">Ativos</option>
            <option value="inativos">Inativos</option>
            <option value="todos">Todos</option>
          </select>
        )}
        {(filterKeys ?? []).map((f) => (
          <select
            key={f.key}
            value={colFilters[f.key] ?? ''}
            onChange={(e) => setColFilters((c) => ({ ...c, [f.key]: e.target.value }))}
            className="text-sm border px-2 py-1.5"
            style={{ borderColor: BORDER, color: TEXT_MUTED }}
          >
            <option value="">{f.label}: todos</option>
            {(filterOptions[f.key] ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        ))}
        <span className="text-xs" style={{ color: TEXT_MUTED }}>
          {loading ? 'carregando…' : `${filtered.length} registro(s)`}
        </span>
        {toolbarAction && <div className="ml-auto">{toolbarAction}</div>}
      </div>

      <div className="flex-1 overflow-auto px-6 py-2">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b" style={{ borderColor: BORDER }}>
              {columns.map((col) => (
                <th key={col.key} className="text-left py-2 pr-4 font-medium whitespace-nowrap" style={{ color: TEXT_MUTED }}>
                  {col.label}
                </th>
              ))}
              {rowActions && <th className="py-2 pr-4"></th>}
            </tr>
          </thead>
          <tbody>
            {error && (
              <tr>
                <td colSpan={columns.length} className="py-10 text-center text-sm text-red-500">
                  Erro ao carregar dados.
                </td>
              </tr>
            )}
            {!error && !loading && filtered.length === 0 && (
              <tr>
                <td colSpan={columns.length} className="py-10 text-center text-sm" style={{ color: TEXT_MUTED, fontFamily: "'IBM Plex Mono', monospace" }}>
                  nenhum registro
                </td>
              </tr>
            )}
            {filtered.map((row, i) => (
              <tr key={row.id ?? i} className="border-b hover:bg-slate-50" style={{ borderColor: BORDER }}>
                {columns.map((col) => (
                  <td key={col.key} className="py-2 pr-4 whitespace-nowrap">
                    {col.render ? col.render(row) : String(row[col.key] ?? '—')}
                  </td>
                ))}
                {rowActions && <td className="py-2 pr-4 whitespace-nowrap text-right">{rowActions(row)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
