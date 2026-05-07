import { useState, useEffect, useRef } from 'react'
import * as XLSX from 'xlsx'
import { Download, DollarSign, Users, Package, FileText, CreditCard, ClipboardList, Search, ChevronDown, ChevronRight, CheckSquare, Mail, BarChart2 } from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../../services/api'

type ModuleKey = 'finance' | 'residents' | 'packages' | 'service-orders' | 'mensalidades' | 'daily-records' | 'entregas'

interface ModuleDef {
  key: ModuleKey
  label: string
  endpoint: string
  icon: React.ComponentType<{ className?: string }>
}

const MODULES: ModuleDef[] = [
  { key: 'finance',        label: 'Financeiro',        endpoint: 'finance',        icon: DollarSign },
  { key: 'residents',      label: 'Moradores',         endpoint: 'residents',      icon: Users },
  { key: 'packages',       label: 'Encomendas',        endpoint: 'packages',       icon: Package },
  { key: 'service-orders', label: 'Ordens de Serviço', endpoint: 'service-orders', icon: FileText },
  { key: 'mensalidades',   label: 'Mensalidades',      endpoint: 'mensalidades',   icon: CreditCard },
  { key: 'daily-records',  label: 'Registros Diários', endpoint: 'daily-records',  icon: ClipboardList },
  { key: 'entregas',       label: 'Entregas',          endpoint: 'entregas',       icon: CheckSquare },
]

function firstDayOfMonth() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}
function today() { return new Date().toISOString().split('T')[0] }

const inputCls = 'border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#26619c]/40 focus:border-[#26619c] bg-white w-full'
const selectCls = inputCls + ' appearance-none'

// ─── Filter panels per module ─────────────────────────────────────────────────

const ENT_TYPES = ['tarefas', 'checklist', 'comentarios', 'os', 'demandas'] as const
const ENT_TYPE_LABELS: Record<string, string> = {
  tarefas: 'Tarefas concluídas', checklist: 'Checklist', comentarios: 'Comentários',
  os: 'OS concluídas', demandas: 'Demandas concluídas',
}

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
  men_include_delinquent: boolean
  task_status: string
  task_priority: string
  ent_user_id: string
  ent_types: string[]
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
  men_status: '', ref_month: '', men_include_delinquent: false,
  task_status: '', task_priority: '',
  ent_user_id: '',
  ent_types: [...ENT_TYPES],
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
  if (mod === 'mensalidades')   { date(); d('men_status'); d('ref_month'); if (f.men_include_delinquent) p['include_delinquent'] = 'true' }
  if (mod === 'daily-records')  { date(); d('task_status'); d('task_priority') }
  if (mod === 'entregas') {
    date()
    if (f.ent_user_id) p['user_id'] = f.ent_user_id
    if (f.ent_types.length && f.ent_types.length < ENT_TYPES.length) p['types'] = f.ent_types.join(',')
  }
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
    <div className="flex flex-col gap-3">
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
          <label className="block text-xs text-gray-500 mb-1">Mês ref.</label>
          <input type="month" value={filters.ref_month} onChange={set('ref_month')} className={inputCls} />
        </div>
      </div>
      <label className="flex items-center gap-2 cursor-pointer w-fit">
        <input
          type="checkbox"
          checked={filters.men_include_delinquent}
          onChange={e => setFilters(f => ({ ...f, men_include_delinquent: e.target.checked }))}
          className="w-4 h-4 rounded border-gray-300 text-[#26619c] accent-[#26619c]"
        />
        <span className="text-xs text-gray-700 font-medium">Incluir Inadimplentes</span>
        <span className="text-[10px] text-gray-400">(exibe total a quitar por morador)</span>
      </label>
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

  if (mod === 'entregas') return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {dateRangeFields}
        <div>
          <label className="block text-xs text-gray-500 mb-1">Colaborador</label>
          <div className="relative">
            <select
              value={filters.ent_user_id}
              onChange={e => setFilters(f => ({ ...f, ent_user_id: e.target.value }))}
              className={selectCls}
            >
              <option value="">Todos</option>
              {operators.map(o => <option key={o.id} value={o.id}>{o.full_name}</option>)}
            </select>
            <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
          </div>
        </div>
      </div>
      <div>
        <label className="block text-xs text-gray-500 mb-1">Tipos de entrega</label>
        <div className="flex flex-wrap gap-2">
          {ENT_TYPES.map(t => {
            const active = filters.ent_types.includes(t)
            return (
              <button
                key={t}
                type="button"
                onClick={() => setFilters(f => ({
                  ...f,
                  ent_types: active
                    ? f.ent_types.filter(x => x !== t)
                    : [...f.ent_types, t],
                }))}
                className={`text-xs px-3 py-1.5 rounded-full border font-medium transition ${
                  active ? 'bg-[#26619c] border-[#26619c] text-white' : 'bg-white border-gray-300 text-gray-500'
                }`}
              >
                {ENT_TYPE_LABELS[t]}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )

  return null
}

// ─── Entregas View ────────────────────────────────────────────────────────────

interface EntregaItem {
  type: string
  title: string
  date: string | null
  ref: string | null
}
interface EntregaUser {
  user_id: string
  user_name: string
  total: number
  by_type: Record<string, number>
  items: EntregaItem[]
}

const ENT_ICONS: Record<string, string> = {
  tarefas: '●', checklist: '☑', comentarios: '💬', os: '🔧', demandas: '📋',
}
const ENT_COLORS: Record<string, string> = {
  tarefas: 'bg-blue-100 text-blue-700',
  checklist: 'bg-emerald-100 text-emerald-700',
  comentarios: 'bg-purple-100 text-purple-700',
  os: 'bg-orange-100 text-orange-700',
  demandas: 'bg-pink-100 text-pink-700',
}

function EntregasSummary({ data }: { data: EntregaUser[] }) {
  const totals = { total: 0, tarefas: 0, checklist: 0, comentarios: 0, os: 0, demandas: 0 }
  for (const u of data) {
    totals.total += u.total
    for (const [k, v] of Object.entries(u.by_type)) {
      totals[k as keyof typeof totals] = (totals[k as keyof typeof totals] || 0) + v
    }
  }
  const cards = [
    { label: 'Total', value: totals.total, bg: 'bg-gray-50', text: 'text-gray-800' },
    { label: 'Tarefas', value: totals.tarefas, bg: 'bg-blue-50', text: 'text-blue-700' },
    { label: 'Checklist', value: totals.checklist, bg: 'bg-emerald-50', text: 'text-emerald-700' },
    { label: 'Comentários', value: totals.comentarios, bg: 'bg-purple-50', text: 'text-purple-700' },
    { label: 'OS', value: totals.os, bg: 'bg-orange-50', text: 'text-orange-700' },
    { label: 'Demandas', value: totals.demandas, bg: 'bg-pink-50', text: 'text-pink-700' },
  ]
  return (
    <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 mb-4">
      {cards.map(c => (
        <div key={c.label} className={`${c.bg} rounded-xl p-3 text-center`}>
          <p className={`text-[10px] uppercase tracking-wide font-semibold ${c.text} opacity-70`}>{c.label}</p>
          <p className={`text-2xl font-bold ${c.text}`}>{c.value}</p>
        </div>
      ))}
    </div>
  )
}

function EntregasUserCard({ user }: { user: EntregaUser }) {
  const [expanded, setExpanded] = useState(false)
  const [showAll, setShowAll] = useState(false)
  const items = showAll ? user.items : user.items.slice(0, 5)
  const initials = user.user_name.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase()

  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden">
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100 transition text-left"
      >
        <div className="flex items-center gap-3 min-w-0">
          <ChevronRight className={`w-4 h-4 text-gray-400 shrink-0 transition-transform ${expanded ? 'rotate-90' : ''}`} />
          <div className="w-8 h-8 rounded-full bg-[#26619c] text-white flex items-center justify-center text-xs font-bold shrink-0">
            {initials}
          </div>
          <span className="font-semibold text-gray-800 text-sm truncate">{user.user_name}</span>
          <div className="hidden sm:flex items-center gap-1.5 shrink-0">
            {ENT_TYPES.map(t => user.by_type[t] > 0 && (
              <span key={t} className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${ENT_COLORS[t]}`}>
                {ENT_ICONS[t]} {user.by_type[t]}
              </span>
            ))}
          </div>
        </div>
        <span className="ml-3 shrink-0 text-sm font-bold text-[#26619c] bg-blue-50 px-2.5 py-0.5 rounded-full">
          {user.total}
        </span>
      </button>
      {expanded && (
        <div className="divide-y divide-gray-100">
          {items.map((item, i) => (
            <div key={i} className="flex items-start gap-3 px-4 py-2.5 hover:bg-gray-50/50">
              <span className={`mt-0.5 text-[10px] px-1.5 py-0.5 rounded-full font-semibold shrink-0 ${ENT_COLORS[item.type]}`}>
                {ENT_ICONS[item.type]} {ENT_TYPE_LABELS[item.type]}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm text-gray-800 truncate">{item.title}</p>
                {item.ref && <p className="text-[11px] text-gray-400 truncate">{item.ref}</p>}
              </div>
              {item.date && (
                <span className="text-[11px] text-gray-400 shrink-0 tabular-nums">
                  {new Date(item.date + 'T00:00:00').toLocaleDateString('pt-BR')}
                </span>
              )}
            </div>
          ))}
          {!showAll && user.items.length > 5 && (
            <button
              onClick={e => { e.stopPropagation(); setShowAll(true) }}
              className="w-full py-2 text-xs text-[#26619c] hover:bg-blue-50 transition font-medium"
            >
              ver mais {user.items.length - 5} itens...
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function EntregasView({ data }: { data: EntregaUser[] }) {
  if (!data.length) return <div className="text-center py-16 text-gray-400 text-sm">Nenhuma entrega encontrada no período.</div>
  return (
    <div className="flex flex-col gap-2">
      <EntregasSummary data={data} />
      {data.map(u => <EntregasUserCard key={u.user_id} user={u} />)}
    </div>
  )
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

// ─── Mensalidades KPIs ────────────────────────────────────────────────────────

function MensalidadesKpis({ rows }: { rows: Record<string, unknown>[] }) {
  let paid = 0, pending = 0, overdue = 0, totalPaid = 0, delinquent = 0, totalDelinquent = 0
  for (const r of rows) {
    const st = String(r['Status'] ?? '')
    const ep = String(r['Estado Pagamento'] ?? '')
    if (ep === 'Inadimplência') { delinquent++; totalDelinquent += parseFloat(String(r['Valor (R$)'] ?? '0')); continue }
    if (st === 'Pago') { paid++; totalPaid += parseFloat(String(r['Valor (R$)'] ?? '0')) }
    else if (st === 'Pendente') pending++
    else if (st === 'Em atraso') overdue++
  }
  const fmtR = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
  const kpis = [
    { label: 'Pagos', value: paid, sub: fmtR(totalPaid), bg: 'bg-green-50', text: 'text-green-700', sub2: 'text-green-600' },
    { label: 'Pendentes', value: pending, sub: null, bg: 'bg-yellow-50', text: 'text-yellow-700', sub2: '' },
    { label: 'Em atraso', value: overdue, sub: null, bg: 'bg-red-50', text: 'text-red-700', sub2: '' },
    ...(delinquent > 0 ? [{ label: 'Inadimplentes', value: delinquent, sub: fmtR(totalDelinquent), bg: 'bg-rose-50', text: 'text-rose-700', sub2: 'text-rose-600' }] : []),
    { label: 'Total', value: rows.length, sub: null, bg: 'bg-blue-50', text: 'text-blue-700', sub2: '' },
  ]
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
      {kpis.map(k => (
        <div key={k.label} className={`${k.bg} rounded-lg p-3`}>
          <p className={`text-[10px] uppercase tracking-wide font-semibold ${k.text} opacity-70`}>{k.label}</p>
          <p className={`text-2xl font-bold ${k.text}`}>{k.value}</p>
          {k.sub && <p className={`text-xs font-medium ${k.sub2}`}>{k.sub}</p>}
        </div>
      ))}
    </div>
  )
}

// ─── Preview table ─────────────────────────────────────────────────────────────

function PreviewTable({ rows, hidden, onToggle }: {
  rows: Record<string, unknown>[]
  hidden: Set<string>
  onToggle: (c: string) => void
}) {
  const [showToggler, setShowToggler] = useState(false)

  if (!rows.length) return (
    <div className="text-center py-16 text-gray-400 text-sm">Nenhum registro encontrado.</div>
  )
  const allCols = Object.keys(rows[0])
  const cols = allCols.filter(c => !hidden.has(c))

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-end">
        <button
          onClick={() => setShowToggler(v => !v)}
          className="text-xs text-gray-500 hover:text-gray-700 flex items-center gap-1 px-2 py-1 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 transition"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h7" /></svg>
          Colunas {hidden.size > 0 && <span className="ml-1 bg-[#26619c] text-white rounded-full px-1.5 py-0.5 text-[10px]">{hidden.size}</span>}
        </button>
      </div>
      {showToggler && (
        <div className="flex flex-wrap gap-1.5 p-3 bg-gray-50 rounded-xl border border-gray-200">
          {allCols.map(c => (
            <button
              key={c}
              onClick={() => onToggle(c)}
              className={`text-xs px-2.5 py-1 rounded-full border transition ${hidden.has(c) ? 'bg-white border-gray-300 text-gray-400 line-through' : 'bg-[#26619c] border-[#26619c] text-white'}`}
            >
              {c}
            </button>
          ))}
        </div>
      )}
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
            {rows.map((row, i) => {
              const isDelinquent = String(row['Estado Pagamento'] ?? '') === 'Inadimplência'
              return (
                <tr key={i} className={isDelinquent ? 'bg-red-50' : i % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}>
                  {cols.map(c => (
                    <td key={c} className={`px-3 py-2 whitespace-nowrap max-w-[300px] truncate ${isDelinquent ? 'text-red-700 font-medium' : 'text-gray-700'}`}>
                      {String(row[c] ?? '—')}
                    </td>
                  ))}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── Main ──────────────────────────────────────────────────────────────────────

export default function ReportsPage() {
  const [selected, setSelected] = useState<ModuleKey>('finance')
  const [filters, setFilters] = useState<FiltersState>(DEFAULT_FILTERS)
  const [rows, setRows] = useState<Record<string, unknown>[] | null>(null)
  const [entregasData, setEntregasData] = useState<EntregaUser[] | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [operators, setOperators] = useState<{ id: string; full_name: string }[]>([])
  const [pkgStatusFilter, setPkgStatusFilter] = useState('')
  const [hiddenCols, setHiddenCols] = useState<Set<string>>(new Set())
  const [exportOpen, setExportOpen] = useState(false)
  const [emailInput, setEmailInput] = useState('')
  const [showEmailInput, setShowEmailInput] = useState(false)
  const [sendingEmail, setSendingEmail] = useState(false)
  const exportRef = useRef<HTMLDivElement>(null)
  const toggleCol = (c: string) => setHiddenCols(prev => { const n = new Set(prev); n.has(c) ? n.delete(c) : n.add(c); return n })

  useEffect(() => {
    api.get('/admin/users', { params: { active_only: true } })
      .then(r => setOperators(r.data))
      .catch(() => {})
  }, [])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (exportRef.current && !exportRef.current.contains(e.target as Node)) {
        setExportOpen(false)
        setShowEmailInput(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const mod = MODULES.find(m => m.key === selected)!
  const isEntregas = selected === 'entregas'

  const handleModuleChange = (key: ModuleKey) => {
    setSelected(key)
    setRows(null)
    setEntregasData(null)
    setPkgStatusFilter('')
    setHiddenCols(new Set())
    setExportOpen(false)
    setShowEmailInput(false)
  }

  const handlePreview = async () => {
    setPreviewing(true)
    setRows(null)
    setEntregasData(null)
    setHiddenCols(new Set())
    try {
      const params = filtersToParams(selected, filters)
      if (isEntregas) {
        const res = await api.get('/reports/entregas', { params })
        setEntregasData(res.data)
      } else {
        const res = await api.get(`/reports/${mod.endpoint}/preview`, { params })
        setRows(res.data)
      }
    } catch (e: any) {
      toast.error(e.response?.data?.detail ?? 'Erro ao buscar dados.')
    } finally {
      setPreviewing(false)
    }
  }

  const handleExport = () => {
    if (!rows?.length) return
    setExporting(true)
    try {
      const visibleCols = Object.keys(rows[0]).filter(c => !hiddenCols.has(c))
      const data = rows.map(r => Object.fromEntries(visibleCols.map(c => [c, r[c] ?? ''])))
      const ws = XLSX.utils.json_to_sheet(data, { header: visibleCols })
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, mod.label.slice(0, 31))
      XLSX.writeFile(wb, `${mod.endpoint}.xlsx`)
      toast.success(`${mod.label} exportado!`)
    } catch {
      toast.error('Erro ao exportar.')
    } finally {
      setExporting(false)
    }
  }

  const handleEntregasExport = async (fmt: 'excel' | 'pdf') => {
    setExporting(true)
    setExportOpen(false)
    try {
      const params = { ...filtersToParams(selected, filters), fmt }
      const res = await api.get('/reports/entregas/export', { params, responseType: 'blob' })
      const url = URL.createObjectURL(res.data)
      const a = document.createElement('a')
      a.href = url
      a.download = `entregas.${fmt === 'pdf' ? 'pdf' : 'xlsx'}`
      a.click()
      URL.revokeObjectURL(url)
      toast.success('Download iniciado.')
    } catch {
      toast.error('Erro ao exportar.')
    } finally {
      setExporting(false)
    }
  }

  const handleEntregasEmail = async () => {
    if (!emailInput.trim()) return
    setSendingEmail(true)
    try {
      const params = filtersToParams(selected, filters)
      await api.post('/reports/entregas/email', {
        email: emailInput.trim(),
        date_from: params.date_from || null,
        date_to: params.date_to || null,
        user_id: params.user_id || null,
        types: params.types || null,
      })
      toast.success(`Relatório enviado para ${emailInput}`)
      setShowEmailInput(false)
      setEmailInput('')
      setExportOpen(false)
    } catch {
      toast.error('Erro ao enviar e-mail.')
    } finally {
      setSendingEmail(false)
    }
  }

  return (
    <div className="flex flex-col gap-5 p-4 sm:p-6 max-w-screen-xl mx-auto w-full">
      <div className="flex items-center gap-3">
        <Download className="w-6 h-6 text-[#26619c]" />
        <h1 className="text-2xl font-bold text-gray-900">Relatórios</h1>
      </div>

      {/* Module selector */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="flex overflow-x-auto scrollbar-none">
          {MODULES.map(m => {
            const Icon = m.icon
            const active = m.key === selected
            return (
              <button
                key={m.key}
                onClick={() => handleModuleChange(m.key)}
                className={`flex items-center gap-2 px-4 py-3 text-sm font-medium whitespace-nowrap transition border-b-2 shrink-0 ${
                  active
                    ? 'border-[#26619c] text-[#26619c] bg-blue-50/60'
                    : 'border-transparent text-gray-500 hover:text-gray-800 hover:bg-gray-50'
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

        <div className="flex flex-wrap gap-2 mt-4">
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

          {!isEntregas && (
            <button
              onClick={handleExport}
              disabled={exporting || !rows?.length}
              className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-sm font-semibold transition disabled:opacity-50"
            >
              {exporting
                ? <span className="inline-block w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                : <Download className="w-4 h-4" />
              }
              Exportar Excel
            </button>
          )}

          {isEntregas && (
            <div className="relative" ref={exportRef}>
              <button
                onClick={() => { setExportOpen(v => !v); setShowEmailInput(false) }}
                disabled={exporting}
                className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-sm font-semibold transition disabled:opacity-50"
              >
                {exporting
                  ? <span className="inline-block w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  : <Download className="w-4 h-4" />
                }
                Exportar
                <ChevronDown className="w-3.5 h-3.5" />
              </button>
              {exportOpen && (
                <div className="absolute left-0 top-full mt-1 w-52 bg-white border border-gray-200 rounded-xl shadow-lg z-20 overflow-hidden">
                  <button
                    onClick={() => handleEntregasExport('excel')}
                    className="w-full flex items-center gap-2 px-4 py-2.5 text-sm hover:bg-gray-50 transition"
                  >
                    <BarChart2 className="w-4 h-4 text-emerald-600" />
                    Baixar Excel
                  </button>
                  <button
                    onClick={() => handleEntregasExport('pdf')}
                    className="w-full flex items-center gap-2 px-4 py-2.5 text-sm hover:bg-gray-50 transition border-t border-gray-100"
                  >
                    <FileText className="w-4 h-4 text-red-500" />
                    Baixar PDF
                  </button>
                  <button
                    onClick={() => setShowEmailInput(v => !v)}
                    className="w-full flex items-center gap-2 px-4 py-2.5 text-sm hover:bg-gray-50 transition border-t border-gray-100"
                  >
                    <Mail className="w-4 h-4 text-[#26619c]" />
                    Enviar por e-mail
                  </button>
                  {showEmailInput && (
                    <div className="px-3 pb-3 pt-1 border-t border-gray-100 flex flex-col gap-2">
                      <input
                        type="email"
                        placeholder="email@exemplo.com"
                        value={emailInput}
                        onChange={e => setEmailInput(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && handleEntregasEmail()}
                        className={inputCls}
                        autoFocus
                      />
                      <button
                        onClick={handleEntregasEmail}
                        disabled={sendingEmail || !emailInput.trim()}
                        className="w-full py-1.5 bg-[#26619c] text-white text-xs font-semibold rounded-lg disabled:opacity-50 transition hover:bg-[#1a4f87]"
                      >
                        {sendingEmail ? 'Enviando...' : 'Enviar'}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Entregas Preview */}
      {isEntregas && entregasData !== null && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Relatório de Entregas</p>
            <span className="text-xs text-gray-400 bg-gray-100 rounded-full px-3 py-1">
              {entregasData.length} colaborador{entregasData.length !== 1 ? 'es' : ''}
            </span>
          </div>
          <EntregasView data={entregasData} />
        </div>
      )}

      {/* Preview */}
      {!isEntregas && rows !== null && (() => {
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
            {selected === 'mensalidades' && rows.length > 0 && (
              <MensalidadesKpis rows={rows} />
            )}
            {selected === 'packages'
              ? <PackagesGroupedTable rows={visibleRows} />
              : <PreviewTable rows={visibleRows} hidden={hiddenCols} onToggle={toggleCol} />
            }
          </div>
        )
      })()}
    </div>
  )
}
