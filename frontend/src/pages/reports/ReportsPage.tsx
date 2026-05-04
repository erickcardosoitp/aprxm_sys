import { useState, useEffect } from 'react'
import { Download, DollarSign, Users, Package, FileText, CreditCard, ClipboardList, Search, ChevronDown, ChevronRight } from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../../services/api'

type ModuleKey = 'finance' | 'residents' | 'packages' | 'service-orders' | 'mensalidades' | 'daily-records'

interface ModuleDef {
  key: ModuleKey
  label: string
  endpoint: string
  icon: React.ComponentType<{ className?: string }>
}

const MODULES: ModuleDef[] = [
  { key: 'finance',        label: 'Financeiro',       endpoint: 'finance',        icon: DollarSign },
  { key: 'residents',      label: 'Moradores',        endpoint: 'residents',      icon: Users },
  { key: 'packages',       label: 'Encomendas',       endpoint: 'packages',       icon: Package },
  { key: 'service-orders', label: 'Ordens de Serviço',endpoint: 'service-orders', icon: FileText },
  { key: 'mensalidades',   label: 'Mensalidades',     endpoint: 'mensalidades',   icon: CreditCard },
  { key: 'daily-records',  label: 'Registros Diários',endpoint: 'daily-records',  icon: ClipboardList },
]

function firstDayOfMonth() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}
function today() { return new Date().toISOString().split('T')[0] }

const inputCls = 'border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#26619c]/40 focus:border-[#26619c] bg-white w-full'
const selectCls = inputCls + ' appearance-none'

// ─── Filter panels per module ─────────────────────────────────────────────────

interface FiltersState {
  date_from: string
  date_to: string
  tx_type: string
  payment_method: string
  res_type: string
  res_status: string
  q: string
  pkg_status: string
  operator_ids: string[]
  street: string
  cep: string
  so_status: string
  so_priority: string
  category: string
  men_status: string
  ref_month: string
  task_status: string
  task_priority: string
}

const DEFAULT_FILTERS: FiltersState = {
  date_from: firstDayOfMonth(), date_to: today(),
  tx_type: '', payment_method: '',
  res_type: '', res_status: '', q: '',
  pkg_status: '',
  operator_ids: [],
  street: '',
  cep: '',
  so_status: '', so_priority: '', category: '',
  men_status: '', ref_month: '',
  task_status: '', task_priority: '',
}

function filtersToParams(mod: ModuleKey, f: FiltersState): Record<string, string | string[]> {
  const p: Record<string, string | string[]> = {}
  const d = (k: keyof FiltersState) => { if (f[k]) p[k] = f[k] as string }
  const date = () => { d('date_from'); d('date_to') }
  if (mod === 'finance')        { date(); d('tx_type'); d('payment_method') }
  if (mod === 'residents')      { d('res_type'); d('res_status'); d('q') }
  if (mod === 'packages') {
    date(); d('pkg_status'); d('street'); d('cep')
    if (f.operator_ids.length) p['operator_ids'] = f.operator_ids as any
  }
  if (mod === 'service-orders') { date(); d('so_status'); d('so_priority'); d('category') }
  if (mod === 'mensalidades')   { date(); d('men_status'); d('ref_month') }
  if (mod === 'daily-records')  { date(); d('task_status'); d('task_priority') }
  return p
}

function FilterPanel({ mod, filters, setFilters, operators }: {
  mod: ModuleKey
  filters: FiltersState
  setFilters: React.Dispatch<React.SetStateAction<FiltersState>>
  operators: { id: string; full_name: string }[]
}) {
  const set = (k: keyof FiltersState) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setFilters(f => ({ ...f, [k]: e.target.value }))

  const dateRangeFields = (
    <>
      <div>
        <label className="block text-xs text-gray-500 mb-1">De</label>
        <input type="date" value={filters.date_from} onChange={set('date_from')} className={inputCls} />
      </div>
      <div>
        <label className="block text-xs text-gray-500 mb-1">Até</label>
        <input type="date" value={filters.date_to} onChange={set('date_to')} className={inputCls} />
      </div>
    </>
  )

  if (mod === 'finance') return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {dateRangeFields}
      <div>
        <label className="block text-xs text-gray-500 mb-1">Tipo</label>
        <div className="relative">
          <select value={filters.tx_type} onChange={set('tx_type')} className={selectCls}>
            <option value="">Todos</option>
            <option value="income">Entradas</option>
            <option value="expense">Saídas</option>
          </select>
          <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
        </div>
      </div>
      <div>
        <label className="block text-xs text-gray-500 mb-1">Forma de pagamento</label>
        <input type="text" placeholder="PIX, Dinheiro…" value={filters.payment_method} onChange={set('payment_method')} className={inputCls} />
      </div>
    </div>
  )

  if (mod === 'residents') return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      <div>
        <label className="block text-xs text-gray-500 mb-1">Tipo</label>
        <div className="relative">
          <select value={filters.res_type} onChange={set('res_type')} className={selectCls}>
            <option value="">Todos</option>
            <option value="member">Membro</option>
            <option value="guest">Visitante</option>
          </select>
          <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
        </div>
      </div>
      <div>
        <label className="block text-xs text-gray-500 mb-1">Status</label>
        <div className="relative">
          <select value={filters.res_status} onChange={set('res_status')} className={selectCls}>
            <option value="">Todos</option>
            <option value="active">Ativo</option>
            <option value="inactive">Inativo</option>
            <option value="pending">Pendente</option>
          </select>
          <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
        </div>
      </div>
      <div>
        <label className="block text-xs text-gray-500 mb-1">Nome / CPF</label>
        <input type="text" placeholder="Buscar…" value={filters.q} onChange={set('q')} className={inputCls} />
      </div>
    </div>
  )

  if (mod === 'packages') return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {dateRangeFields}
        <div>
          <label className="block text-xs text-gray-500 mb-1">Status</label>
          <div className="relative">
            <select value={filters.pkg_status} onChange={set('pkg_status')} className={selectCls}>
              <option value="">Todos</option>
              <option value="awaiting">Aguardando retirada (todos)</option>
              <option value="received">Na portaria (não notificado)</option>
              <option value="notified">Notificado (aguardando retirada)</option>
              <option value="delivered">Entregue</option>
              <option value="returned">Devolvido</option>
            </select>
            <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
          </div>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Rua</label>
          <input type="text" placeholder="Ex.: Vaz Lobo" value={filters.street} onChange={set('street')} className={inputCls} />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">CEP</label>
          <input type="text" placeholder="00000-000" value={filters.cep}
            onChange={e => {
              const v = e.target.value.replace(/\D/g, '').slice(0, 8)
              setFilters(f => ({ ...f, cep: v.length > 5 ? `${v.slice(0,5)}-${v.slice(5)}` : v }))
            }}
            className={inputCls} maxLength={9} />
        </div>
      </div>
      {operators.length > 0 && (
        <div>
          <label className="block text-xs text-gray-500 mb-2">Operadores</label>
          <div className="flex flex-wrap gap-2">
            {operators.map(o => {
              const checked = filters.operator_ids.includes(o.id)
              return (
                <label key={o.id} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-sm cursor-pointer transition select-none ${
                  checked ? 'bg-[#26619c] text-white border-[#26619c]' : 'bg-white text-gray-600 border-gray-200 hover:border-[#26619c]/40'
                }`}>
                  <input
                    type="checkbox"
                    className="sr-only"
                    checked={checked}
                    onChange={() => setFilters(f => ({
                      ...f,
                      operator_ids: checked
                        ? f.operator_ids.filter(id => id !== o.id)
                        : [...f.operator_ids, o.id],
                    }))}
                  />
                  {o.full_name}
                </label>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )

  if (mod === 'service-orders') return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {dateRangeFields}
      <div>
        <label className="block text-xs text-gray-500 mb-1">Status</label>
        <div className="relative">
          <select value={filters.so_status} onChange={set('so_status')} className={selectCls}>
            <option value="">Todos</option>
            <option value="open">Aberta</option>
            <option value="in_progress">Em andamento</option>
            <option value="resolved">Resolvida</option>
            <option value="cancelled">Cancelada</option>
          </select>
          <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
        </div>
      </div>
      <div>
        <label className="block text-xs text-gray-500 mb-1">Prioridade</label>
        <div className="relative">
          <select value={filters.so_priority} onChange={set('so_priority')} className={selectCls}>
            <option value="">Todas</option>
            <option value="low">Baixa</option>
            <option value="medium">Média</option>
            <option value="high">Alta</option>
            <option value="critical">Crítica</option>
          </select>
          <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
        </div>
      </div>
      <div className="sm:col-span-4">
        <label className="block text-xs text-gray-500 mb-1">Categoria</label>
        <input type="text" placeholder="Elétrica, Hidráulica…" value={filters.category} onChange={set('category')} className={inputCls} />
      </div>
    </div>
  )

  if (mod === 'mensalidades') return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {dateRangeFields}
      <div>
        <label className="block text-xs text-gray-500 mb-1">Status</label>
        <div className="relative">
          <select value={filters.men_status} onChange={set('men_status')} className={selectCls}>
            <option value="">Todos</option>
            <option value="pending">Pendente</option>
            <option value="paid">Pago</option>
            <option value="overdue">Em atraso</option>
            <option value="waived">Isento</option>
          </select>
          <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
        </div>
      </div>
      <div>
        <label className="block text-xs text-gray-500 mb-1">Mês ref. (YYYY-MM)</label>
        <input type="text" placeholder="2025-01" value={filters.ref_month} onChange={set('ref_month')} className={inputCls} />
      </div>
    </div>
  )

  if (mod === 'daily-records') return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {dateRangeFields}
      <div>
        <label className="block text-xs text-gray-500 mb-1">Status</label>
        <div className="relative">
          <select value={filters.task_status} onChange={set('task_status')} className={selectCls}>
            <option value="">Todos</option>
            <option value="open">Aberto</option>
            <option value="pending">Pendente</option>
            <option value="waiting_third">Ag. Terceiros</option>
            <option value="done">Concluído</option>
          </select>
          <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
        </div>
      </div>
      <div>
        <label className="block text-xs text-gray-500 mb-1">Prioridade</label>
        <div className="relative">
          <select value={filters.task_priority} onChange={set('task_priority')} className={selectCls}>
            <option value="">Todas</option>
            <option value="low">Baixa</option>
            <option value="medium">Média</option>
            <option value="high">Alta</option>
          </select>
          <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
        </div>
      </div>
    </div>
  )

  return null
}

// ─── Packages KPIs + Grouped Table ────────────────────────────────────────────

const STATUS_LABELS: Record<string, string> = {
  received: 'Na portaria', notified: 'Notificado', delivered: 'Entregue',
  returned: 'Devolvido', reversed: 'Estornado',
}
const STATUS_VALUES: Record<string, string[]> = {
  awaiting: ['received', 'notified'],
  received: ['received'], notified: ['notified'],
  delivered: ['delivered'], returned: ['returned'],
}

function PackagesKpis({ rows, activeFilter, onFilter }: {
  rows: Record<string, unknown>[]
  activeFilter: string
  onFilter: (f: string) => void
}) {
  const byStatus: Record<string, number> = {}
  const byOperator: Record<string, number> = {}
  const byStreet: Record<string, number> = {}
  for (const r of rows) {
    const st = String(r['Status'] ?? '')
    byStatus[st] = (byStatus[st] ?? 0) + 1
    const op = String(r['Recebido por'] ?? '—')
    byOperator[op] = (byOperator[op] ?? 0) + 1
    const street = String(r['Rua'] ?? '—')
    byStreet[street] = (byStreet[street] ?? 0) + 1
  }
  const topStreets = Object.entries(byStreet).sort((a, b) => b[1] - a[1]).slice(0, 5)
  const topOps = Object.entries(byOperator).sort((a, b) => b[1] - a[1]).slice(0, 5)
  const awaiting = (byStatus['received'] ?? 0) + (byStatus['notified'] ?? 0)
  const total = rows.length

  const kpis = [
    { key: 'awaiting', label: 'Aguardando', value: awaiting, bg: 'bg-blue-50', text: 'text-blue-700', ring: 'ring-blue-400' },
    { key: 'delivered', label: 'Entregues', value: byStatus['delivered'] ?? 0, bg: 'bg-emerald-50', text: 'text-emerald-700', ring: 'ring-emerald-400' },
    { key: 'returned', label: 'Devolvidos', value: byStatus['returned'] ?? 0, bg: 'bg-orange-50', text: 'text-orange-700', ring: 'ring-orange-400' },
    { key: '', label: 'Total', value: total, bg: 'bg-purple-50', text: 'text-purple-700', ring: 'ring-purple-400' },
  ]

  return (
    <div className="mb-4 flex flex-col gap-3">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {kpis.map(k => (
          <button key={k.key} onClick={() => onFilter(activeFilter === k.key ? '' : k.key)}
            className={`${k.bg} rounded-lg p-3 text-left transition ring-2 ${activeFilter === k.key ? k.ring : 'ring-transparent'} hover:ring-2 hover:${k.ring}`}>
            <p className={`text-[10px] uppercase tracking-wide font-semibold ${k.text}`}>{k.label}</p>
            <p className={`text-2xl font-bold ${k.text}`}>{k.value}</p>
          </button>
        ))}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="border border-gray-100 rounded-lg p-3">
          <p className="text-[10px] uppercase tracking-wide text-gray-500 font-semibold mb-2">Por status</p>
          <ul className="flex flex-col gap-1">
            {Object.entries(byStatus).map(([s, c]) => (
              <li key={s} className="flex justify-between text-xs">
                <span className="text-gray-700">{STATUS_LABELS[s] ?? s}</span>
                <span className="font-bold text-gray-900">{c}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="border border-gray-100 rounded-lg p-3">
          <p className="text-[10px] uppercase tracking-wide text-gray-500 font-semibold mb-2">Top operadores</p>
          <ul className="flex flex-col gap-1">
            {topOps.map(([n, c]) => (
              <li key={n} className="flex justify-between text-xs">
                <span className="text-gray-700 truncate pr-2">{n}</span>
                <span className="font-bold text-gray-900">{c}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="border border-gray-100 rounded-lg p-3">
          <p className="text-[10px] uppercase tracking-wide text-gray-500 font-semibold mb-2">Top ruas</p>
          <ul className="flex flex-col gap-1">
            {topStreets.map(([s, c]) => (
              <li key={s} className="flex justify-between text-xs">
                <span className="text-gray-700 truncate pr-2">{s}</span>
                <span className="font-bold text-gray-900">{c}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}

function PackagesGroupedTable({ rows }: { rows: Record<string, unknown>[] }) {
  const [open, setOpen] = useState<Record<string, boolean>>({})
  if (!rows.length) return <div className="text-center py-16 text-gray-400 text-sm">Nenhum registro encontrado.</div>

  const cols = Object.keys(rows[0]).filter(c => c !== 'Rua' && c !== 'CEP')
  const groups: Record<string, { cep: string; rows: Record<string, unknown>[] }> = {}
  for (const r of rows) {
    const street = String(r['Rua'] ?? '(sem rua)')
    if (!groups[street]) groups[street] = { cep: String(r['CEP'] ?? ''), rows: [] }
    groups[street].rows.push(r)
  }
  const sorted = Object.entries(groups).sort((a, b) => b[1].rows.length - a[1].rows.length)

  return (
    <div className="flex flex-col gap-1">
      {sorted.map(([street, g]) => {
        const isOpen = !!open[street]
        return (
          <div key={street} className="border border-gray-200 rounded-xl overflow-hidden">
            <button onClick={() => setOpen(s => ({ ...s, [street]: !s[street] }))}
              className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100 transition text-left">
              <div className="flex items-center gap-2 min-w-0">
                <ChevronRight className={`w-4 h-4 text-gray-400 shrink-0 transition-transform ${isOpen ? 'rotate-90' : ''}`} />
                <span className="font-medium text-gray-800 text-sm truncate">{street}</span>
                {g.cep && g.cep !== '—' && <span className="text-xs text-gray-400 shrink-0">{g.cep}</span>}
              </div>
              <span className="ml-3 shrink-0 text-sm font-bold text-[#26619c] bg-blue-50 px-2 py-0.5 rounded-full">{g.rows.length}</span>
            </button>
            {isOpen && (
              <div className="overflow-x-auto">
                <table className="min-w-full text-xs">
                  <thead>
                    <tr className="bg-[#1a3f6f] text-white">
                      {cols.map(c => <th key={c} className="px-3 py-2 text-left font-semibold whitespace-nowrap">{c}</th>)}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {g.rows.map((row, i) => (
                      <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}>
                        {cols.map(c => (
                          <td key={c} className="px-3 py-2 text-gray-700 whitespace-nowrap max-w-[180px] truncate">
                            {String(row[c] ?? '—')}
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
      })}
    </div>
  )
}

// ─── Preview table ─────────────────────────────────────────────────────────────

function PreviewTable({ rows }: { rows: Record<string, unknown>[] }) {
  if (!rows.length) return (
    <div className="text-center py-16 text-gray-400 text-sm">Nenhum registro encontrado.</div>
  )
  const cols = Object.keys(rows[0])
  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200">
      <table className="min-w-full text-xs">
        <thead>
          <tr className="bg-[#1a3f6f] text-white">
            {cols.map(c => (
              <th key={c} className="px-3 py-2.5 text-left font-semibold whitespace-nowrap">{c}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rows.map((row, i) => (
            <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}>
              {cols.map(c => (
                <td key={c} className="px-3 py-2 text-gray-700 whitespace-nowrap max-w-[200px] truncate">
                  {String(row[c] ?? '—')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ─── Main ──────────────────────────────────────────────────────────────────────

export default function ReportsPage() {
  const [selected, setSelected] = useState<ModuleKey>('finance')
  const [filters, setFilters] = useState<FiltersState>(DEFAULT_FILTERS)
  const [rows, setRows] = useState<Record<string, unknown>[] | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [operators, setOperators] = useState<{ id: string; full_name: string }[]>([])
  const [pkgStatusFilter, setPkgStatusFilter] = useState('')

  useEffect(() => {
    api.get('/admin/users', { params: { active_only: true } })
      .then(r => setOperators(r.data))
      .catch(() => {})
  }, [])

  const mod = MODULES.find(m => m.key === selected)!

  const handleModuleChange = (key: ModuleKey) => {
    setSelected(key)
    setRows(null)
    setPkgStatusFilter('')
  }

  const handlePreview = async () => {
    setPreviewing(true)
    setRows(null)
    try {
      const params = filtersToParams(selected, filters)
      const res = await api.get(`/reports/${mod.endpoint}/preview`, { params })
      setRows(res.data)
    } catch (e: any) {
      toast.error(e.response?.data?.detail ?? 'Erro ao buscar dados.')
    } finally {
      setPreviewing(false)
    }
  }

  const handleExport = async () => {
    setExporting(true)
    try {
      const params = filtersToParams(selected, filters)
      const res = await api.get(`/reports/${mod.endpoint}`, { params, responseType: 'blob' })
      const url = URL.createObjectURL(new Blob([res.data], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      }))
      const a = document.createElement('a')
      a.href = url
      a.download = `${mod.endpoint}.xlsx`
      a.click()
      URL.revokeObjectURL(url)
      toast.success(`${mod.label} exportado!`)
    } catch (e: any) {
      let msg = 'Erro ao exportar.'
      if (e.response?.data instanceof Blob) {
        try { const t = await e.response.data.text(); msg = JSON.parse(t)?.detail ?? msg } catch { /* noop */ }
      } else {
        msg = e.response?.data?.detail ?? msg
      }
      toast.error(msg)
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="flex flex-col gap-5 p-4 sm:p-6 max-w-screen-xl mx-auto w-full">
      <div className="flex items-center gap-3">
        <Download className="w-6 h-6 text-[#26619c]" />
        <h1 className="text-2xl font-bold text-gray-900">Relatórios</h1>
      </div>

      {/* Module selector */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Tipo de relatório</p>
        <div className="flex flex-wrap gap-2">
          {MODULES.map(m => {
            const Icon = m.icon
            const active = m.key === selected
            return (
              <button
                key={m.key}
                onClick={() => handleModuleChange(m.key)}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition border ${
                  active
                    ? 'bg-[#26619c] text-white border-[#26619c]'
                    : 'bg-white text-gray-600 border-gray-200 hover:border-[#26619c]/40 hover:text-[#26619c]'
                }`}
              >
                <Icon className="w-4 h-4" />
                {m.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Filtros</p>
        <FilterPanel mod={selected} filters={filters} setFilters={setFilters} operators={operators} />

        <div className="flex gap-2 mt-4">
          <button
            onClick={handlePreview}
            disabled={previewing}
            className="flex items-center gap-2 px-4 py-2 bg-[#26619c] hover:bg-[#1a4f87] text-white rounded-xl text-sm font-semibold transition disabled:opacity-50"
          >
            {previewing
              ? <span className="inline-block w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              : <Search className="w-4 h-4" />
            }
            Visualizar
          </button>
          <button
            onClick={handleExport}
            disabled={exporting}
            className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-sm font-semibold transition disabled:opacity-50"
          >
            {exporting
              ? <span className="inline-block w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              : <Download className="w-4 h-4" />
            }
            Exportar Excel
          </button>
        </div>
      </div>

      {/* Preview */}
      {rows !== null && (() => {
        const visibleRows = selected === 'packages' && pkgStatusFilter
          ? rows.filter(r => {
              const statuses = STATUS_VALUES[pkgStatusFilter] ?? [pkgStatusFilter]
              return statuses.includes(String(r['Status'] ?? ''))
            })
          : rows
        return (
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                Prévia — {mod.label}
              </p>
              <span className="text-xs text-gray-400 bg-gray-100 rounded-full px-3 py-1">
                {visibleRows.length}{pkgStatusFilter ? ` de ${rows.length}` : ''} {rows.length === 1 ? 'registro' : 'registros'}
              </span>
            </div>
            {selected === 'packages' && rows.length > 0 && (
              <PackagesKpis rows={rows} activeFilter={pkgStatusFilter} onFilter={setPkgStatusFilter} />
            )}
            {selected === 'packages'
              ? <PackagesGroupedTable rows={visibleRows} />
              : <PreviewTable rows={visibleRows} />
            }
          </div>
        )
      })()}
    </div>
  )
}
