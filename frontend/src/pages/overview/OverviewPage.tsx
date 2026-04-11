import { useEffect, useState } from 'react'
import { Users, Package, Wrench, Wallet, BarChart2, RefreshCw } from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from 'recharts'
import api from '../../services/api'
import { useAuthStore } from '../../store/authStore'
import type { Resident, Package as Pkg, ServiceOrder, CashSession } from '../../types'

// ── Types ─────────────────────────────────────────────────────────────────────

interface KpiData {
  activeMembers: number
  pendingPackages: number
  openOrders: number
  sessionOpen: boolean | null
}

interface SensoData {
  total: number
  age_distribution: { label: string; count: number }[]
  infrastructure: { internet_pct: number; sewage_pct: number; transport_pct: number; pests_pct: number }
  avg_household: number
  education: { level: string; count: number }[]
  race: { race: string; count: number }[]
  neighborhood_problems: { problem: string; count: number }[]
  internet_types: { type: string; count: number }[]
  cep_distribution: { cep: string; count: number }[]
}

interface SensoFilters {
  cep_prefix: string
  age_min: string
  age_max: string
  has_internet: string
  has_sewage: string
  has_pests: string
  uses_transport: string
}

const EMPTY_FILTERS: SensoFilters = {
  cep_prefix: '', age_min: '', age_max: '',
  has_internet: '', has_sewage: '', has_pests: '', uses_transport: '',
}

const PIE_COLORS = ['#26619c', '#3b82f6', '#60a5fa', '#93c5fd', '#bfdbfe', '#dbeafe']
const BAR_COLOR = '#26619c'

// ── Infra badge ───────────────────────────────────────────────────────────────

function InfraBar({ label, pct, color }: { label: string; pct: number; color: string }) {
  return (
    <div>
      <div className="flex justify-between text-xs mb-1">
        <span className="text-gray-600">{label}</span>
        <span className="font-semibold" style={{ color }}>{pct}%</span>
      </div>
      <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
        <div className="h-2 rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
    </div>
  )
}

// ── Senso tab ─────────────────────────────────────────────────────────────────

function SensoTab() {
  const [data, setData] = useState<SensoData | null>(null)
  const [loading, setLoading] = useState(false)
  const [filters, setFilters] = useState<SensoFilters>(EMPTY_FILTERS)

  const load = async () => {
    setLoading(true)
    try {
      const params: Record<string, string> = {}
      if (filters.cep_prefix) params.cep_prefix = filters.cep_prefix
      if (filters.age_min) params.age_min = filters.age_min
      if (filters.age_max) params.age_max = filters.age_max
      if (filters.has_internet !== '') params.has_internet = filters.has_internet
      if (filters.has_sewage !== '') params.has_sewage = filters.has_sewage
      if (filters.has_pests !== '') params.has_pests = filters.has_pests
      if (filters.uses_transport !== '') params.uses_transport = filters.uses_transport
      const res = await api.get<SensoData>('/senso/analytics', { params })
      setData(res.data)
    } catch {
      /* silent */
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const set = (k: keyof SensoFilters, v: string) => setFilters(f => ({ ...f, [k]: v }))
  const inputCls = 'border border-gray-300 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-[#26619c]/40'
  const selectCls = `${inputCls} bg-white`

  return (
    <div className="flex flex-col gap-5">
      {/* Filters */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Filtros</p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">CEP (prefixo)</label>
            <input value={filters.cep_prefix} onChange={e => set('cep_prefix', e.target.value)}
              className={inputCls + ' w-full'} placeholder="Ex: 22000" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Idade mín.</label>
            <input type="number" value={filters.age_min} onChange={e => set('age_min', e.target.value)}
              className={inputCls + ' w-full'} placeholder="0" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Idade máx.</label>
            <input type="number" value={filters.age_max} onChange={e => set('age_max', e.target.value)}
              className={inputCls + ' w-full'} placeholder="100" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Internet</label>
            <select value={filters.has_internet} onChange={e => set('has_internet', e.target.value)} className={selectCls + ' w-full'}>
              <option value="">Todos</option>
              <option value="true">Com internet</option>
              <option value="false">Sem internet</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Esgoto</label>
            <select value={filters.has_sewage} onChange={e => set('has_sewage', e.target.value)} className={selectCls + ' w-full'}>
              <option value="">Todos</option>
              <option value="true">Com esgoto</option>
              <option value="false">Sem esgoto</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Vetores</label>
            <select value={filters.has_pests} onChange={e => set('has_pests', e.target.value)} className={selectCls + ' w-full'}>
              <option value="">Todos</option>
              <option value="true">Com vetores</option>
              <option value="false">Sem vetores</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Transporte</label>
            <select value={filters.uses_transport} onChange={e => set('uses_transport', e.target.value)} className={selectCls + ' w-full'}>
              <option value="">Todos</option>
              <option value="true">Usa transporte</option>
              <option value="false">Não usa</option>
            </select>
          </div>
          <div className="flex items-end gap-2">
            <button onClick={load} disabled={loading}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-[#26619c] text-white rounded-lg text-xs font-medium hover:bg-[#1a4f87] transition disabled:opacity-50">
              <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
              Aplicar
            </button>
            <button onClick={() => { setFilters(EMPTY_FILTERS) }}
              className="px-3 py-1.5 border border-gray-300 text-gray-600 rounded-lg text-xs hover:bg-gray-50 transition">
              Limpar
            </button>
          </div>
        </div>
      </div>

      {loading && <div className="text-center py-10 text-gray-400 text-sm animate-pulse">Carregando dados…</div>}

      {data && !loading && (
        <>
          {/* KPI row */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 text-center">
              <p className="text-2xl font-bold text-[#26619c]">{data.total}</p>
              <p className="text-xs text-[#26619c] mt-1">Associados</p>
            </div>
            <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-4 text-center">
              <p className="text-2xl font-bold text-emerald-700">{data.avg_household}</p>
              <p className="text-xs text-emerald-700 mt-1">Média/residência</p>
            </div>
            <div className="bg-amber-50 border border-amber-100 rounded-xl p-4 text-center">
              <p className="text-2xl font-bold text-amber-700">{data.infrastructure.internet_pct}%</p>
              <p className="text-xs text-amber-700 mt-1">Com internet</p>
            </div>
            <div className="bg-red-50 border border-red-100 rounded-xl p-4 text-center">
              <p className="text-2xl font-bold text-red-700">{data.infrastructure.pests_pct}%</p>
              <p className="text-xs text-red-700 mt-1">Com vetores</p>
            </div>
          </div>

          {/* Age + Education charts */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
              <h3 className="text-sm font-semibold text-gray-800 mb-3">Distribuição por Faixa Etária</h3>
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={data.age_distribution} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                  <Tooltip />
                  <Bar dataKey="count" fill={BAR_COLOR} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
              <h3 className="text-sm font-semibold text-gray-800 mb-3">Escolaridade</h3>
              {data.education.length === 0 ? (
                <p className="text-xs text-gray-400 py-8 text-center">Sem dados</p>
              ) : (
                <ResponsiveContainer width="100%" height={180}>
                  <PieChart>
                    <Pie data={data.education} dataKey="count" nameKey="level" cx="50%" cy="50%"
                      outerRadius={65} label={(p) => `${(p as any).level?.split(' ')[0]} ${((p.percent ?? 0) * 100).toFixed(0)}%`}
                      labelLine={false}>
                      {data.education.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                    </Pie>
                    <Tooltip formatter={(v, n) => [v, n]} />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          {/* Race + Infrastructure */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
              <h3 className="text-sm font-semibold text-gray-800 mb-3">Cor/Raça</h3>
              {data.race.length === 0 ? (
                <p className="text-xs text-gray-400 py-8 text-center">Sem dados</p>
              ) : (
                <ResponsiveContainer width="100%" height={180}>
                  <PieChart>
                    <Pie data={data.race} dataKey="count" nameKey="race" cx="50%" cy="50%"
                      outerRadius={65} label={(p) => `${(p as any).race} ${((p.percent ?? 0) * 100).toFixed(0)}%`}
                      labelLine={false}>
                      {data.race.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>

            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
              <h3 className="text-sm font-semibold text-gray-800 mb-3">Infraestrutura</h3>
              <div className="flex flex-col gap-3 mt-2">
                <InfraBar label="Acesso à internet" pct={data.infrastructure.internet_pct} color="#3b82f6" />
                <InfraBar label="Rede de esgoto" pct={data.infrastructure.sewage_pct} color="#10b981" />
                <InfraBar label="Usa transporte público" pct={data.infrastructure.transport_pct} color="#f59e0b" />
                <InfraBar label="Incidência de vetores" pct={data.infrastructure.pests_pct} color="#ef4444" />
              </div>
            </div>
          </div>

          {/* Neighborhood problems */}
          {data.neighborhood_problems.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
              <h3 className="text-sm font-semibold text-gray-800 mb-3">Problemas da Comunidade (ranking)</h3>
              <ResponsiveContainer width="100%" height={Math.max(160, data.neighborhood_problems.length * 32)}>
                <BarChart data={data.neighborhood_problems} layout="vertical"
                  margin={{ top: 4, right: 16, left: 8, bottom: 0 }}>
                  <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
                  <YAxis type="category" dataKey="problem" width={160} tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="count" fill="#ef4444" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* CEP distribution */}
          {data.cep_distribution.length > 1 && (
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
              <h3 className="text-sm font-semibold text-gray-800 mb-3">Distribuição por CEP</h3>
              <ResponsiveContainer width="100%" height={160}>
                <BarChart data={data.cep_distribution} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                  <XAxis dataKey="cep" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                  <Tooltip />
                  <Bar dataKey="count" fill={BAR_COLOR} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ── Overview tab ──────────────────────────────────────────────────────────────

function OverviewTab() {
  const role = useAuthStore((s) => s.role)
  const isViewer = role === 'viewer'

  const [kpi, setKpi] = useState<KpiData | null>(null)
  const [activity, setActivity] = useState<{ packages: Pkg[]; orders: ServiceOrder[] }>({ packages: [], orders: [] })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchAll = async () => {
      setLoading(true)
      try {
        const [residentsRes, packagesRes, ordersRes, sessionRes] = await Promise.allSettled([
          api.get<Resident[]>('/residents'),
          api.get<Pkg[]>('/packages'),
          api.get<ServiceOrder[]>('/service-orders'),
          api.get<CashSession>('/finance/sessions/current'),
        ])
        const residents = residentsRes.status === 'fulfilled' ? residentsRes.value.data : []
        const packages = packagesRes.status === 'fulfilled' ? packagesRes.value.data : []
        const orders = ordersRes.status === 'fulfilled' ? ordersRes.value.data : []
        const sessionOpen =
          sessionRes.status === 'fulfilled'
            ? sessionRes.value.data?.status === 'open'
            : sessionRes.status === 'rejected' && (sessionRes.reason as any)?.response?.status === 404
            ? false : null
        setKpi({
          activeMembers: residents.filter((r) => r.status === 'active').length,
          pendingPackages: packages.filter((p) => p.status === 'received' || p.status === 'notified').length,
          openOrders: orders.filter((o) => o.status === 'open' || o.status === 'in_progress').length,
          sessionOpen,
        })
        setActivity({
          packages: packages.sort((a, b) => new Date(b.received_at).getTime() - new Date(a.received_at).getTime()).slice(0, 5),
          orders: orders.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()).slice(0, 3),
        })
      } finally { setLoading(false) }
    }
    fetchAll()
  }, [])

  const fmtDate = (s: string) => new Date(s).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' })

  const PKG_STATUS_LABEL: Record<string, string> = { received: 'Recebida', notified: 'Notificada', delivered: 'Entregue', returned: 'Devolvida' }
  const ORDER_STATUS_LABEL: Record<string, string> = { pending: 'Pendente', open: 'Aberta', in_progress: 'Em andamento', waiting_third_party: 'Ag. Terceiros', resolved: 'Resolvida', archived: 'Arquivada', cancelled: 'Cancelada' }
  const ORDER_STATUS_COLOR: Record<string, string> = { pending: 'bg-gray-100 text-gray-600', open: 'bg-red-100 text-red-700', in_progress: 'bg-amber-100 text-amber-700', waiting_third_party: 'bg-purple-100 text-purple-700', resolved: 'bg-green-100 text-green-700', archived: 'bg-gray-100 text-gray-400', cancelled: 'bg-gray-100 text-gray-500' }

  return (
    <div className="flex flex-col gap-6">
      {loading ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[...Array(4)].map((_, i) => <div key={i} className="bg-gray-100 rounded-xl p-4 h-24 animate-pulse" />)}
        </div>
      ) : kpi ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 flex flex-col gap-2">
            <div className="flex items-center gap-2"><Users className="w-4 h-4 text-[#26619c] shrink-0" /><p className="text-xs font-medium text-[#26619c] leading-tight">Associados ativos</p></div>
            {isViewer ? <p className="text-sm text-blue-300 font-medium">—</p> : <p className="text-2xl font-bold text-[#26619c]">{kpi.activeMembers}</p>}
          </div>
          <div className="bg-amber-50 border border-amber-100 rounded-xl p-4 flex flex-col gap-2">
            <div className="flex items-center gap-2"><Package className="w-4 h-4 text-amber-600 shrink-0" /><p className="text-xs font-medium text-amber-700 leading-tight">Encomendas pendentes</p></div>
            {isViewer ? <p className="text-sm text-amber-300 font-medium">—</p> : <p className="text-2xl font-bold text-amber-700">{kpi.pendingPackages}</p>}
          </div>
          <div className="bg-red-50 border border-red-100 rounded-xl p-4 flex flex-col gap-2">
            <div className="flex items-center gap-2"><Wrench className="w-4 h-4 text-red-600 shrink-0" /><p className="text-xs font-medium text-red-700 leading-tight">OS abertas</p></div>
            {isViewer ? <p className="text-sm text-red-300 font-medium">—</p> : <p className="text-2xl font-bold text-red-700">{kpi.openOrders}</p>}
          </div>
          <div className={`border rounded-xl p-4 flex flex-col gap-2 ${kpi.sessionOpen ? 'bg-green-50 border-green-100' : 'bg-gray-50 border-gray-200'}`}>
            <div className="flex items-center gap-2"><Wallet className={`w-4 h-4 shrink-0 ${kpi.sessionOpen ? 'text-green-600' : 'text-gray-400'}`} /><p className={`text-xs font-medium leading-tight ${kpi.sessionOpen ? 'text-green-700' : 'text-gray-500'}`}>Sessão de caixa</p></div>
            <p className={`text-sm font-bold ${kpi.sessionOpen ? 'text-green-700' : 'text-gray-500'}`}>{kpi.sessionOpen === null ? '—' : kpi.sessionOpen ? 'Aberta' : 'Fechada'}</p>
          </div>
        </div>
      ) : null}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2"><Package className="w-4 h-4 text-amber-500" /><h3 className="font-semibold text-gray-800 text-sm">Últimas Encomendas</h3></div>
          {loading ? <div className="p-6 text-center text-gray-400 text-sm">Carregando…</div> : activity.packages.length === 0 ? <div className="p-6 text-center text-gray-400 text-sm">Nenhuma encomenda.</div> : (
            <ul className="divide-y divide-gray-100">
              {activity.packages.map(pkg => (
                <li key={pkg.id} className="px-4 py-3 flex items-center justify-between gap-3">
                  <div className="min-w-0"><p className="text-sm font-medium text-gray-800 truncate">{pkg.resident_name ?? pkg.unit ?? 'Destinatário não informado'}</p><p className="text-xs text-gray-400">{fmtDate(pkg.received_at)}{pkg.carrier_name ? ` · ${pkg.carrier_name}` : ''}</p></div>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium shrink-0 ${pkg.status === 'received' || pkg.status === 'notified' ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-500'}`}>{PKG_STATUS_LABEL[pkg.status] ?? pkg.status}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2"><Wrench className="w-4 h-4 text-red-500" /><h3 className="font-semibold text-gray-800 text-sm">Últimas Ordens de Serviço</h3></div>
          {loading ? <div className="p-6 text-center text-gray-400 text-sm">Carregando…</div> : activity.orders.length === 0 ? <div className="p-6 text-center text-gray-400 text-sm">Nenhuma ordem.</div> : (
            <ul className="divide-y divide-gray-100">
              {activity.orders.map(order => (
                <li key={order.id} className="px-4 py-3 flex items-center justify-between gap-3">
                  <div className="min-w-0"><p className="text-sm font-medium text-gray-800 truncate">#{order.number} — {order.title}</p><p className="text-xs text-gray-400">{fmtDate(order.created_at)}</p></div>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium shrink-0 ${ORDER_STATUS_COLOR[order.status] ?? 'bg-gray-100 text-gray-500'}`}>{ORDER_STATUS_LABEL[order.status] ?? order.status}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

type Tab = 'overview' | 'senso'

export default function OverviewPage() {
  const [tab, setTab] = useState<Tab>('overview')

  return (
    <div className="flex flex-col gap-4 p-4 max-w-3xl mx-auto">
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-bold text-gray-900 flex-1">Visão</h1>
        <div className="flex bg-gray-100 rounded-xl p-1 gap-1">
          <button onClick={() => setTab('overview')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition ${tab === 'overview' ? 'bg-white text-[#26619c] shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
            <Wallet className="w-3.5 h-3.5" /> Geral
          </button>
          <button onClick={() => setTab('senso')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition ${tab === 'senso' ? 'bg-white text-[#26619c] shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
            <BarChart2 className="w-3.5 h-3.5" /> Senso
          </button>
        </div>
      </div>
      {tab === 'overview' ? <OverviewTab /> : <SensoTab />}
    </div>
  )
}
