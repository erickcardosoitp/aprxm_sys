import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronUp, Search } from 'lucide-react'
import type { AxiosResponse } from 'axios'

const BORDER = '#e2e8f0'
const TEXT_MUTED = '#64748b'

const UNIDADE_PALETTE = [
  { bg: '#dbeafe', text: '#1d4ed8' },
  { bg: '#dcfce7', text: '#15803d' },
  { bg: '#fef3c7', text: '#b45309' },
  { bg: '#fce7f3', text: '#be185d' },
  { bg: '#ede9fe', text: '#6d28d9' },
  { bg: '#ffedd5', text: '#c2410c' },
  { bg: '#cffafe', text: '#0e7490' },
  { bg: '#e0e7ff', text: '#4338ca' },
]

export function unidadeColor(nome: string) {
  let hash = 0
  for (let i = 0; i < nome.length; i++) hash = (hash * 31 + nome.charCodeAt(i)) >>> 0
  return UNIDADE_PALETTE[hash % UNIDADE_PALETTE.length]
}

function UnidadeBadge({ nome }: { nome: string }) {
  const c = unidadeColor(nome)
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium whitespace-nowrap"
      style={{ backgroundColor: c.bg, color: c.text }}
    >
      {nome}
    </span>
  )
}

const UNIDADE_KEYS = new Set(['unidade', 'associacao', 'association_name', 'assoc', 'assoc_name'])

export function useSort<T extends Record<string, any>>(rows: T[]) {
  const [sortKey, setSortKey] = useState<keyof T | null>(null)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')

  const toggleSort = (key: keyof T) => {
    if (sortKey !== key) { setSortKey(key); setSortDir('asc'); return }
    if (sortDir === 'asc') { setSortDir('desc'); return }
    setSortKey(null)
  }

  const sorted = useMemo(() => {
    if (!sortKey) return rows
    const dir = sortDir === 'asc' ? 1 : -1
    return [...rows].sort((a, b) => {
      const av = a[sortKey], bv = b[sortKey]
      if (av == null && bv == null) return 0
      if (av == null) return 1
      if (bv == null) return -1
      const an = Number(av), bn = Number(bv)
      if (av !== '' && bv !== '' && !Number.isNaN(an) && !Number.isNaN(bn)) return (an - bn) * dir
      return String(av).localeCompare(String(bv), 'pt-BR') * dir
    })
  }, [rows, sortKey, sortDir])

  return { sorted, sortKey, sortDir, toggleSort }
}

export function SortTh({ label, sortKey, activeKey, dir, onClick, align = 'left' }:
  { label: string; sortKey: string | number | symbol; activeKey: string | number | symbol | null; dir: 'asc' | 'desc'; onClick: () => void; align?: 'left' | 'right' }) {
  return (
    <th onClick={onClick}
        className={`py-2 ${align === 'right' ? 'text-right px-4' : 'text-left pr-4'} font-medium whitespace-nowrap cursor-pointer select-none hover:text-slate-700`}
        style={{ color: TEXT_MUTED }}>
      <span className={`inline-flex items-center gap-1 ${align === 'right' ? 'justify-end w-full' : ''}`}>
        {label}
        {activeKey === sortKey && (dir === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}
      </span>
    </th>
  )
}

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

  const filteredUnsorted = useMemo(() => {
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

  const { sorted: filtered, sortKey, sortDir, toggleSort } = useSort(filteredUnsorted)

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
                <SortTh key={col.key} label={col.label} sortKey={col.key} activeKey={sortKey} dir={sortDir}
                  onClick={() => toggleSort(col.key)} />
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
                    {col.render
                      ? col.render(row)
                      : UNIDADE_KEYS.has(col.key) && row[col.key]
                        ? <UnidadeBadge nome={String(row[col.key])} />
                        : String(row[col.key] ?? '—')}
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
