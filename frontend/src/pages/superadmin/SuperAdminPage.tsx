import { useEffect, useRef, useState } from 'react'
import {
  Activity, AlertTriangle, BarChart2, Building2, CheckCircle2, ChevronDown,
  Clock, Database, Package, RefreshCw, Search, Server, ShieldCheck,
  TrendingUp, Users, Zap,
} from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../../services/api'

// ── Types ──────────────────────────────────────────────────────────────────────
interface OrgSummary {
  id: string; name: string; slug: string; plan_name: string
  is_active: boolean; plan_expires_at: string | null
  created_at: string; user_count: number; resident_count: number
  open_packages: number; last_login_at: string | null
}
interface OrgUser { id: string; full_name: string; email: string; role: string; is_active: boolean; last_login_at: string | null }
interface ActiveSession { id: string; opened_at: string; opening_balance: number; opened_by_name: string; opened_by_email: string; association_name: string; slug: string }
interface HealthSummary { active_orgs: number; active_users: number; total_residents: number; pending_packages: number; tx_last_24h: number; open_sessions: number; pending_mensalidades: number }
interface ResidentCount { association_name: string; association_id: string; total: number; members: number; guests: number; active: number }
interface Resident { id: string; full_name: string; type: string; unit: string | null; block: string | null; cpf: string | null; status: string; phone_primary: string | null; created_at: string; association_name: string }

const ROLE_LABELS: Record<string, string> = {
  superadmin: 'SuperAdmin', admin_master: 'Admin Master', admin: 'Admin', conferente: 'Conferente',
  diretoria: 'Diretoria', diretoria_adjunta: 'Dir. Adjunta', operator: 'Operador', viewer: 'Visualizador',
}

const fmtDate = (s: string | null, time = false) => {
  if (!s) return '—'
  const opts: Intl.DateTimeFormatOptions = { day: '2-digit', month: '2-digit', year: '2-digit' }
  if (time) { opts.hour = '2-digit'; opts.minute = '2-digit' }
  return new Date(s).toLocaleString('pt-BR', opts)
}

// ── Helpers ────────────────────────────────────────────────────────────────────
function KpiCard({ label, value, sub, color = 'gray', icon: Icon }: {
  label: string; value: string | number; sub?: string
  color?: 'blue' | 'green' | 'amber' | 'red' | 'purple' | 'gray' | 'teal'
  icon?: React.ElementType
}) {
  const palette: Record<string, string> = {
    blue: 'bg-blue-50 border-blue-100 text-blue-700',
    green: 'bg-green-50 border-green-100 text-green-700',
    amber: 'bg-amber-50 border-amber-100 text-amber-700',
    red: 'bg-red-50 border-red-100 text-red-700',
    purple: 'bg-purple-50 border-purple-100 text-purple-700',
    teal: 'bg-teal-50 border-teal-100 text-teal-700',
    gray: 'bg-gray-50 border-gray-100 text-gray-700',
  }
  return (
    <div className={`rounded-xl p-3.5 border ${palette[color]}`}>
      <div className="flex items-center gap-1.5 mb-1">
        {Icon && <Icon className="w-3.5 h-3.5 opacity-70" />}
        <p className="text-xs font-medium opacity-70">{label}</p>
      </div>
      <p className="text-2xl font-black">{value}</p>
      {sub && <p className="text-[10px] opacity-60 mt-0.5">{sub}</p>}
    </div>
  )
}

// ── APDEXX Rating ─────────────────────────────────────────────────────────────
function ApdexxGauge({ value }: { value: number }) {
  const pct = Math.round(value * 100)
  const color = pct >= 85 ? '#22c55e' : pct >= 65 ? '#f59e0b' : '#ef4444'
  const label = pct >= 85 ? 'Excelente' : pct >= 65 ? 'Regular' : 'Crítico'
  return (
    <div className="flex flex-col items-center gap-1 p-4">
      <div className="relative w-24 h-24 flex items-center justify-center">
        <svg className="absolute inset-0" viewBox="0 0 100 100">
          <circle cx="50" cy="50" r="42" fill="none" stroke="#e5e7eb" strokeWidth="10" />
          <circle cx="50" cy="50" r="42" fill="none" stroke={color} strokeWidth="10"
            strokeDasharray={`${2 * Math.PI * 42}`}
            strokeDashoffset={`${2 * Math.PI * 42 * (1 - value)}`}
            strokeLinecap="round"
            transform="rotate(-90 50 50)" />
        </svg>
        <div className="text-center">
          <p className="text-xl font-black" style={{ color }}>{value.toFixed(2)}</p>
          <p className="text-[9px] text-gray-400 font-medium">/ 1.00</p>
        </div>
      </div>
      <p className="text-xs font-semibold" style={{ color }}>{label}</p>
      <p className="text-[10px] text-gray-400">APDEXX Score</p>
    </div>
  )
}

// ── MiniBar chart ─────────────────────────────────────────────────────────────
function MiniBar({ days, data, color = '#26619c', label }: { days: number; data: { day: string; count: number }[]; color?: string; label: string }) {
  const map: Record<string, number> = {}
  data.forEach(d => { map[d.day] = d.count })
  const slots: { label: string; count: number }[] = []
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i)
    const key = d.toISOString().split('T')[0]
    slots.push({ label: d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }), count: map[key] ?? 0 })
  }
  const max = Math.max(...slots.map(s => s.count), 1)
  return (
    <div>
      <p className="text-xs font-semibold text-gray-500 mb-2">{label}</p>
      <div className="flex items-end gap-0.5 h-16">
        {slots.map((s, i) => (
          <div key={i} className="flex-1 flex flex-col items-center gap-0.5 group relative">
            <div className="w-full rounded-sm transition-all"
              style={{ height: `${Math.max(4, (s.count / max) * 52)}px`, backgroundColor: s.count > 0 ? color : '#e5e7eb' }} />
            {slots.length <= 14 && (
              <span className="text-[8px] text-gray-400 rotate-0 leading-none">{s.label.split('/')[0]}</span>
            )}
            <div className="absolute -top-6 left-1/2 -translate-x-1/2 bg-gray-800 text-white text-[9px] px-1.5 py-0.5 rounded opacity-0 group-hover:opacity-100 whitespace-nowrap z-10">
              {s.label}: {s.count}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Visão Geral Tab ───────────────────────────────────────────────────────────
function VisaoGeralTab() {
  const [orgs, setOrgs] = useState<OrgSummary[]>([])
  const [health, setHealth] = useState<HealthSummary | null>(null)
  const [sessions, setSessions] = useState<ActiveSession[]>([])
  const [counts, setCounts] = useState<ResidentCount[]>([])
  const [loading, setLoading] = useState(true)

  const load = async () => {
    setLoading(true)
    try {
      const [o, h, s, c] = await Promise.all([
        api.get<OrgSummary[]>('/superadmin/organizations'),
        api.get<HealthSummary>('/superadmin/health-summary'),
        api.get<ActiveSession[]>('/superadmin/active-sessions'),
        api.get<ResidentCount[]>('/superadmin/all-residents/count'),
      ])
      setOrgs(o.data); setHealth(h.data); setSessions(s.data); setCounts(c.data)
    } catch { toast.error('Erro ao carregar visão geral.') }
    finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])

  if (loading) return <div className="p-12 text-center text-gray-400 text-sm">Carregando…</div>

  return (
    <div className="flex flex-col gap-6">
      <div className="flex justify-end">
        <button onClick={load} className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-[#26619c] border border-gray-200 px-3 py-1.5 rounded-lg transition">
          <RefreshCw className="w-3.5 h-3.5" /> Atualizar
        </button>
      </div>

      {/* Global KPIs */}
      {health && (
        <div>
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Senso Global</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <KpiCard label="Orgs ativas" value={health.active_orgs} color="blue" icon={Building2} />
            <KpiCard label="Usuários ativos" value={health.active_users} color="green" icon={Users} />
            <KpiCard label="Total de moradores" value={health.total_residents} color="gray" icon={Users} />
            <KpiCard label="Enc. pendentes" value={health.pending_packages} color={health.pending_packages > 20 ? 'red' : 'amber'} icon={Package} />
            <KpiCard label="Caixas abertos" value={health.open_sessions} color={health.open_sessions > 0 ? 'amber' : 'gray'} icon={Activity} />
            <KpiCard label="TX últimas 24h" value={health.tx_last_24h} sub="transações financeiras" color="purple" icon={TrendingUp} />
            <KpiCard label="Mensalidades pend." value={health.pending_mensalidades} color={health.pending_mensalidades > 30 ? 'red' : 'amber'} icon={AlertTriangle} />
          </div>
        </div>
      )}

      {/* Per-org census */}
      <div>
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Moradores por Organização</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {counts.map(c => (
            <div key={c.association_id} className="bg-white border border-gray-200 rounded-xl p-4">
              <p className="text-sm font-bold text-gray-800 mb-3 truncate">{c.association_name}</p>
              <div className="grid grid-cols-2 gap-2">
                <div><p className="text-xs text-gray-400">Total</p><p className="text-xl font-black text-gray-800">{c.total}</p></div>
                <div><p className="text-xs text-gray-400">Ativos</p><p className="text-xl font-black text-green-700">{c.active}</p></div>
                <div><p className="text-xs text-gray-400">Associados</p><p className="text-lg font-bold text-blue-700">{c.members}</p></div>
                <div><p className="text-xs text-gray-400">Visitantes</p><p className="text-lg font-bold text-orange-600">{c.guests}</p></div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Active cash sessions */}
      {sessions.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Caixas Abertos Agora</p>
          <div className="bg-white border border-amber-200 rounded-xl overflow-hidden">
            <div className="divide-y divide-gray-100">
              {sessions.map(s => (
                <div key={s.id} className="flex items-center justify-between px-4 py-3 gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-gray-800">{s.association_name}</p>
                    <p className="text-xs text-gray-500">Por: {s.opened_by_name} · {fmtDate(s.opened_at, true)}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-xs text-gray-400">Saldo inicial</p>
                    <p className="text-sm font-bold text-gray-700">R$ {s.opening_balance.toFixed(2)}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Orgs list */}
      <div>
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Organizações</p>
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                <th className="text-left px-4 py-2 font-medium text-gray-500">Nome</th>
                <th className="text-center px-3 py-2 font-medium text-gray-500 hidden sm:table-cell">Usuários</th>
                <th className="text-center px-3 py-2 font-medium text-gray-500 hidden sm:table-cell">Moradores</th>
                <th className="text-center px-3 py-2 font-medium text-gray-500">Enc. pend.</th>
                <th className="text-right px-4 py-2 font-medium text-gray-500 hidden sm:table-cell">Último acesso</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {orgs.map(o => (
                <tr key={o.id} className="hover:bg-gray-50/50">
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-1.5">
                      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${o.is_active ? 'bg-green-500' : 'bg-gray-300'}`} />
                      <span className="font-medium text-gray-800">{o.name}</span>
                    </div>
                    <p className="text-gray-400 pl-3">{o.slug}</p>
                  </td>
                  <td className="px-3 py-2.5 text-center text-gray-600 hidden sm:table-cell">{o.user_count}</td>
                  <td className="px-3 py-2.5 text-center text-gray-600 hidden sm:table-cell">{o.resident_count}</td>
                  <td className="px-3 py-2.5 text-center">
                    <span className={`font-semibold ${o.open_packages > 10 ? 'text-amber-600' : 'text-gray-600'}`}>{o.open_packages}</span>
                  </td>
                  <td className="px-4 py-2.5 text-right text-gray-400 hidden sm:table-cell">{fmtDate(o.last_login_at, true)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

// ── Moradores Tab ─────────────────────────────────────────────────────────────
function MoradoresTab() {
  const [residents, setResidents] = useState<Resident[]>([])
  const [counts, setCounts] = useState<ResidentCount[]>([])
  const [loading, setLoading] = useState(false)
  const [q, setQ] = useState('')
  const [filterOrg, setFilterOrg] = useState('')
  const [offset, setOffset] = useState(0)
  const LIMIT = 80

  const load = async (reset = false) => {
    setLoading(true)
    const off = reset ? 0 : offset
    if (reset) setOffset(0)
    try {
      const params: Record<string, any> = { limit: LIMIT, offset: off }
      if (q.trim()) params.q = q.trim()
      if (filterOrg) params.association_id = filterOrg
      const res = await api.get<Resident[]>('/superadmin/all-residents', { params })
      setResidents(reset ? res.data : [...residents, ...res.data])
      if (!reset) setOffset(off + LIMIT)
    } catch { toast.error('Erro ao carregar moradores.') }
    finally { setLoading(false) }
  }

  useEffect(() => {
    api.get<ResidentCount[]>('/superadmin/all-residents/count').then(r => setCounts(r.data)).catch(() => {})
    load(true)
  }, [])
  useEffect(() => { load(true) }, [q, filterOrg])

  const total = counts.reduce((s, c) => s + c.total, 0)
  const orgsForFilter = counts.map(c => ({ id: c.association_id, name: c.association_name }))

  return (
    <div className="flex flex-col gap-4">
      {/* Census strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KpiCard label="Total moradores" value={total} color="blue" icon={Users} />
        {counts.map(c => (
          <KpiCard key={c.association_id} label={c.association_name.split(' de ')[1] ?? c.association_name}
            value={c.total} sub={`${c.members} assoc. · ${c.guests} visit.`} color="gray" />
        ))}
      </div>

      {/* Filters */}
      <div className="flex gap-2 items-center flex-wrap">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar nome, CPF, unidade…"
            className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#26619c]/30 focus:border-[#26619c]" />
        </div>
        <select value={filterOrg} onChange={e => setFilterOrg(e.target.value)}
          className="border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-600 bg-white focus:outline-none focus:ring-2 focus:ring-[#26619c]/30">
          <option value="">Todas as orgs</option>
          {orgsForFilter.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
      </div>

      {/* List */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-gray-50 border-b border-gray-100 sticky top-0">
            <tr>
              <th className="text-left px-4 py-2.5 font-medium text-gray-500">Nome</th>
              <th className="text-left px-3 py-2.5 font-medium text-gray-500 hidden sm:table-cell">Unidade</th>
              <th className="text-left px-3 py-2.5 font-medium text-gray-500 hidden md:table-cell">CPF</th>
              <th className="text-center px-3 py-2.5 font-medium text-gray-500">Tipo</th>
              <th className="text-center px-3 py-2.5 font-medium text-gray-500">Status</th>
              <th className="text-left px-4 py-2.5 font-medium text-gray-500 hidden lg:table-cell">Org</th>
              <th className="text-right px-4 py-2.5 font-medium text-gray-500 hidden sm:table-cell">Cadastro</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {residents.map(r => (
              <tr key={r.id} className="hover:bg-gray-50/50">
                <td className="px-4 py-2.5">
                  <p className="font-medium text-gray-800">{r.full_name}</p>
                  {r.phone_primary && <p className="text-gray-400">{r.phone_primary}</p>}
                </td>
                <td className="px-3 py-2.5 text-gray-600 hidden sm:table-cell">
                  {r.unit ? `Unid. ${r.unit}${r.block ? `/Bl.${r.block}` : ''}` : '—'}
                </td>
                <td className="px-3 py-2.5 text-gray-500 font-mono hidden md:table-cell">{r.cpf ?? '—'}</td>
                <td className="px-3 py-2.5 text-center">
                  <span className={`inline-block px-1.5 py-0.5 rounded-full font-semibold ${r.type === 'member' ? 'bg-blue-100 text-blue-700' : 'bg-orange-100 text-orange-700'}`}>
                    {r.type === 'member' ? 'Assoc.' : 'Visit.'}
                  </span>
                </td>
                <td className="px-3 py-2.5 text-center">
                  <span className={`inline-block w-2 h-2 rounded-full ${r.status === 'active' ? 'bg-green-500' : r.status === 'delinquent' ? 'bg-red-500' : 'bg-gray-300'}`} title={r.status} />
                </td>
                <td className="px-4 py-2.5 text-gray-500 hidden lg:table-cell truncate max-w-[160px]">{r.association_name}</td>
                <td className="px-4 py-2.5 text-right text-gray-400 hidden sm:table-cell">{fmtDate(r.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {residents.length === 0 && !loading && (
          <div className="p-8 text-center text-sm text-gray-400">Nenhum morador encontrado.</div>
        )}
        {loading && <div className="p-4 text-center text-xs text-gray-400">Carregando…</div>}
        {!loading && residents.length >= LIMIT && (
          <div className="p-3 text-center border-t border-gray-100">
            <button onClick={() => load(false)} className="text-xs text-[#26619c] hover:underline">Carregar mais</button>
          </div>
        )}
      </div>
    </div>
  )
}

// ── TI Metrics Tab ────────────────────────────────────────────────────────────
interface ITMetrics {
  database: { total_mb: number; tables: { name: string; mb: number; rows: number }[] }
  package_sla: { total_delivered: number; avg_hours_to_deliver: number | null; delivered_within_48h: number; pct_within_48h: number; overdue_packages: number; pending_packages: number; overdue_notified: number }
  activity: { transactions_7d: { day: string; count: number }[]; logins_7d: { day: string; count: number }[]; sessions_7d: { day: string; count: number }[] }
  audit: { total_actions_24h: number; reversals_24h: number }
  top_orgs_30d: { name: string; tx_count: number; active_days: number }[]
  critical_ops: { cash_open: number; cash_close: number; cash_conference: number; resident_register: number; pkg_received: number; pkg_delivered: number; os_open: number; sangria: number; pix_conference: number }
  operational_timing: { bulk_receive_avg_scan_s: number | null; bulk_receive_avg_items: number | null; bulk_receive_total_batches: number; cash_session_avg_h: number | null; cash_session_max_h: number | null; cash_session_total_closed: number }
  db_health: { cache_hit_rate_pct: number | null; connections_active: number; connections_idle: number; connections_total: number }
  apdexx: number
}

const CRITICAL_OPS = [
  { key: 'cash_open', label: 'Abertura de Caixa', icon: '🔓' },
  { key: 'cash_close', label: 'Fechamento de Caixa', icon: '🔒' },
  { key: 'cash_conference', label: 'Conferência de Caixa', icon: '✅' },
  { key: 'resident_register', label: 'Cadastro de Associado', icon: '👤' },
  { key: 'pkg_received', label: 'Recebimento de Encomenda', icon: '📦' },
  { key: 'pkg_delivered', label: 'Entrega de Encomenda', icon: '🚪' },
  { key: 'os_open', label: 'Abertura de OS', icon: '🔧' },
  { key: 'sangria', label: 'Transferência de Saldo (Sangria)', icon: '💸' },
  { key: 'pix_conference', label: 'Conferência PIX', icon: '🏦' },
] as const

function ITMetricsTab() {
  const [data, setData] = useState<ITMetrics | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null)
  const [period, setPeriod] = useState<7 | 30 | 90>(7)
  const [orgs, setOrgs] = useState<{ id: string; name: string }[]>([])
  const [filterOrg, setFilterOrg] = useState('')
  const [expandedSection, setExpandedSection] = useState<string | null>('critical')
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const load = async () => {
    setError(false)
    try {
      const params: Record<string, any> = { days: period }
      if (filterOrg) params.association_id = filterOrg
      const [metricsRes, orgsRes] = await Promise.all([
        api.get<ITMetrics>('/superadmin/it-metrics', { params }),
        orgs.length === 0 ? api.get<{ id: string; name: string }[]>('/superadmin/organizations') : Promise.resolve(null),
      ])
      setData(metricsRes.data)
      if (orgsRes) setOrgs(orgsRes.data)
      setLastUpdate(new Date())
    } catch {
      setError(true)
      toast.error('Erro ao carregar métricas TI')
    } finally { setLoading(false) }
  }

  useEffect(() => {
    load()
    intervalRef.current = setInterval(load, 60_000)
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [period, filterOrg])

  if (loading) return <div className="p-12 text-center text-gray-400 text-sm">Carregando métricas…</div>
  if (error || !data) return (
    <div className="p-12 text-center flex flex-col items-center gap-3">
      <AlertTriangle className="w-8 h-8 text-red-400" />
      <p className="text-sm text-gray-500">Erro ao carregar métricas.</p>
      <button onClick={load} className="text-sm border border-gray-200 px-4 py-2 rounded-lg hover:bg-gray-50">Tentar novamente</button>
    </div>
  )

  const { database, package_sla, activity, audit, top_orgs_30d, critical_ops, operational_timing, db_health, apdexx } = data
  const slaColor = package_sla.pct_within_48h >= 90 ? 'text-green-600' : package_sla.pct_within_48h >= 70 ? 'text-amber-600' : 'text-red-600'

  const Section = ({ id, title, icon: Icon, children }: { id: string; title: string; icon: React.ElementType; children: React.ReactNode }) => (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
      <button className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition"
        onClick={() => setExpandedSection(expandedSection === id ? null : id)}>
        <div className="flex items-center gap-2">
          <Icon className="w-4 h-4 text-[#26619c]" />
          <span className="text-sm font-semibold text-gray-800">{title}</span>
        </div>
        <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${expandedSection === id ? 'rotate-180' : ''}`} />
      </button>
      {expandedSection === id && <div className="border-t border-gray-100 p-4">{children}</div>}
    </div>
  )

  return (
    <div className="flex flex-col gap-4">
      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <select value={filterOrg} onChange={e => setFilterOrg(e.target.value)}
          className="border border-gray-200 rounded-xl px-3 py-1.5 text-sm text-gray-600 bg-white focus:outline-none focus:ring-2 focus:ring-[#26619c]/30">
          <option value="">Geral — todas as orgs</option>
          {orgs.filter(o => !o.name.toLowerCase().includes('geral')).map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
        <div className="flex border border-gray-200 rounded-xl overflow-hidden">
          {([7, 30, 90] as const).map(d => (
            <button key={d} onClick={() => setPeriod(d)}
              className={`px-3 py-1.5 text-xs font-medium transition ${period === d ? 'bg-[#26619c] text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>
              {d}d
            </button>
          ))}
        </div>
        <button onClick={load} className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-[#26619c] border border-gray-200 px-3 py-1.5 rounded-xl transition ml-auto">
          <RefreshCw className="w-3.5 h-3.5" />
          {lastUpdate ? `${lastUpdate.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}` : '—'}
        </button>
      </div>

      {/* APDEXX + SLA hero */}
      <div className="bg-white border border-gray-200 rounded-xl p-4">
        <div className="flex flex-col sm:flex-row items-center gap-4">
          <ApdexxGauge value={apdexx} />
          <div className="flex-1 grid grid-cols-2 sm:grid-cols-3 gap-3 w-full">
            <div className={`text-center p-3 rounded-xl bg-gray-50 border border-gray-100`}>
              <p className="text-xs text-gray-500">SLA Encomendas (48h)</p>
              <p className={`text-2xl font-black ${slaColor}`}>{package_sla.pct_within_48h}%</p>
              <p className="text-[10px] text-gray-400">{package_sla.delivered_within_48h}/{package_sla.total_delivered} entregues</p>
            </div>
            <div className="text-center p-3 rounded-xl bg-red-50 border border-red-100">
              <p className="text-xs text-red-500">Em atraso (+48h)</p>
              <p className="text-2xl font-black text-red-700">{package_sla.overdue_packages}</p>
              <p className="text-[10px] text-red-400">encomendas</p>
            </div>
            <div className="text-center p-3 rounded-xl bg-amber-50 border border-amber-100">
              <p className="text-xs text-amber-600">Notif. sem retirada</p>
              <p className="text-2xl font-black text-amber-700">{package_sla.overdue_notified}</p>
              <p className="text-[10px] text-amber-500">+72h sem retirada</p>
            </div>
            <div className="text-center p-3 rounded-xl bg-gray-50 border border-gray-100">
              <p className="text-xs text-gray-500">Estornos {period}d</p>
              <p className="text-2xl font-black text-gray-700">{audit.reversals_24h}</p>
            </div>
            <div className="text-center p-3 rounded-xl bg-blue-50 border border-blue-100">
              <p className="text-xs text-blue-500">Ações auditadas {period}d</p>
              <p className="text-2xl font-black text-blue-700">{audit.total_actions_24h}</p>
            </div>
            {package_sla.avg_hours_to_deliver && (
              <div className="text-center p-3 rounded-xl bg-green-50 border border-green-100">
                <p className="text-xs text-green-600">Tempo médio entrega</p>
                <p className="text-2xl font-black text-green-700">{package_sla.avg_hours_to_deliver}h</p>
              </div>
            )}
          </div>
        </div>
        <p className="text-[10px] text-gray-400 mt-3 text-center">
          APDEXX (Aproxima Performance & eXperience Index) — pesos: SLA 30% · Higiene de caixa 20% · Taxa de erro 20% · Índice de atraso 30%
        </p>
      </div>

      {/* Critical Operations */}
      <Section id="critical" title={`Operações Críticas — últimos ${period} dias`} icon={ShieldCheck}>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {CRITICAL_OPS.map(op => {
            const count = critical_ops[op.key]
            return (
              <div key={op.key} className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl border border-gray-100">
                <span className="text-xl">{op.icon}</span>
                <div className="min-w-0">
                  <p className="text-[11px] text-gray-500 leading-tight">{op.label}</p>
                  <p className={`text-lg font-black ${count > 0 ? 'text-gray-800' : 'text-gray-300'}`}>{count}</p>
                </div>
              </div>
            )
          })}
        </div>
      </Section>

      {/* Operational Timing */}
      <Section id="timing" title="Tempos Operacionais" icon={Clock}>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <div className="p-3 bg-blue-50 border border-blue-100 rounded-xl">
            <p className="text-xs text-blue-500 mb-1">Duração média de caixa</p>
            <p className="text-2xl font-black text-blue-700">{operational_timing.cash_session_avg_h?.toFixed(1) ?? '—'}h</p>
            <p className="text-[10px] text-blue-400">máx: {operational_timing.cash_session_max_h?.toFixed(1) ?? '—'}h · {operational_timing.cash_session_total_closed} fechados</p>
          </div>
          <div className="p-3 bg-purple-50 border border-purple-100 rounded-xl">
            <p className="text-xs text-purple-500 mb-1">Tempo médio lote (scan)</p>
            <p className="text-2xl font-black text-purple-700">
              {operational_timing.bulk_receive_avg_scan_s != null
                ? operational_timing.bulk_receive_avg_scan_s < 60
                  ? `${Math.round(operational_timing.bulk_receive_avg_scan_s)}s`
                  : `${(operational_timing.bulk_receive_avg_scan_s / 60).toFixed(1)}min`
                : '—'}
            </p>
            <p className="text-[10px] text-purple-400">média {operational_timing.bulk_receive_avg_items?.toFixed(1) ?? '—'} itens · {operational_timing.bulk_receive_total_batches} lotes</p>
          </div>
          <div className="p-3 bg-green-50 border border-green-100 rounded-xl">
            <p className="text-xs text-green-600 mb-1">Tempo médio até entrega</p>
            <p className="text-2xl font-black text-green-700">{package_sla.avg_hours_to_deliver?.toFixed(1) ?? '—'}h</p>
            <p className="text-[10px] text-green-400">{package_sla.total_delivered} entregues no período</p>
          </div>
        </div>
        <p className="text-[10px] text-gray-400 mt-3">
          TX = Transmit — volume de dados trafegados servidor → cliente. Tempo de lote = intervalo do primeiro ao último scan dentro de um recebimento múltiplo.
        </p>
      </Section>

      {/* Activity charts */}
      <Section id="activity" title={`Atividade — ${period} dias`} icon={BarChart2}>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
          <MiniBar days={period} data={activity.transactions_7d} color="#26619c" label={`Transações financeiras`} />
          <MiniBar days={period} data={activity.logins_7d} color="#7c3aed" label="Logins de usuário" />
          <MiniBar days={period} data={activity.sessions_7d} color="#0891b2" label="Abertura de caixas" />
        </div>
        {top_orgs_30d.length > 0 && (
          <div className="mt-4">
            <p className="text-xs font-semibold text-gray-500 mb-2">Top orgs por transações</p>
            <div className="flex flex-col gap-1.5">
              {top_orgs_30d.map(o => {
                const max = Math.max(...top_orgs_30d.map(x => x.tx_count), 1)
                return (
                  <div key={o.name} className="flex items-center gap-2">
                    <span className="text-xs text-gray-600 w-40 truncate shrink-0">{o.name}</span>
                    <div className="flex-1 bg-gray-100 rounded-full h-2">
                      <div className="h-2 rounded-full bg-[#26619c]" style={{ width: `${(o.tx_count / max) * 100}%` }} />
                    </div>
                    <span className="text-xs font-semibold text-gray-700 w-8 text-right">{o.tx_count}</span>
                    <span className="text-[10px] text-gray-400 w-12 text-right">{o.active_days}d ativos</span>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </Section>

      {/* DB Health */}
      <Section id="database" title="Banco de Dados" icon={Database}>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          <KpiCard label="Tamanho total" value={`${database.total_mb} MB`} color="blue" />
          <KpiCard label="Cache hit rate" value={db_health.cache_hit_rate_pct != null ? `${db_health.cache_hit_rate_pct}%` : '—'}
            color={db_health.cache_hit_rate_pct != null && db_health.cache_hit_rate_pct >= 95 ? 'green' : 'amber'} />
          <KpiCard label="Conexões ativas" value={db_health.connections_active}
            color={db_health.connections_active > 10 ? 'amber' : 'gray'} />
          <KpiCard label="Conexões idle" value={db_health.connections_idle} color="gray" />
        </div>
        <p className="text-xs font-semibold text-gray-500 mb-2">Tabelas por tamanho</p>
        <div className="flex flex-col gap-1.5">
          {database.tables.map(t => {
            const pct = database.total_mb > 0 ? Math.min(100, (t.mb / database.total_mb) * 100) : 0
            return (
              <div key={t.name} className="flex items-center gap-2">
                <span className="text-xs text-gray-600 font-mono w-36 truncate shrink-0">{t.name}</span>
                <div className="flex-1 bg-gray-100 rounded-full h-2">
                  <div className="h-2 rounded-full bg-[#26619c]/70" style={{ width: `${pct}%` }} />
                </div>
                <span className="text-xs text-gray-500 w-16 text-right shrink-0">{t.mb} MB</span>
                <span className="text-[10px] text-gray-400 w-16 text-right shrink-0">{t.rows.toLocaleString('pt-BR')} rows</span>
              </div>
            )
          })}
        </div>
      </Section>

      {/* Audit & Errors */}
      <Section id="audit" title="Auditoria e Erros" icon={ShieldCheck}>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <div className="p-3 bg-gray-50 border border-gray-100 rounded-xl">
            <p className="text-xs text-gray-500">Total ações auditadas</p>
            <p className="text-2xl font-black text-gray-800">{audit.total_actions_24h}</p>
            <p className="text-[10px] text-gray-400">nos últimos {period} dias</p>
          </div>
          <div className="p-3 bg-red-50 border border-red-100 rounded-xl">
            <p className="text-xs text-red-500">Estornos / cancelamentos</p>
            <p className="text-2xl font-black text-red-700">{audit.reversals_24h}</p>
            <p className="text-[10px] text-red-400">
              {audit.total_actions_24h > 0 ? `${((audit.reversals_24h / audit.total_actions_24h) * 100).toFixed(1)}% do total` : '—'}
            </p>
          </div>
          <div className="p-3 bg-amber-50 border border-amber-100 rounded-xl">
            <p className="text-xs text-amber-600">Taxa de estorno</p>
            <p className={`text-2xl font-black ${audit.total_actions_24h > 0 && audit.reversals_24h / audit.total_actions_24h > 0.05 ? 'text-red-700' : 'text-green-700'}`}>
              {audit.total_actions_24h > 0 ? `${((audit.reversals_24h / audit.total_actions_24h) * 100).toFixed(2)}%` : '—'}
            </p>
            <p className="text-[10px] text-amber-400">alerta acima de 5%</p>
          </div>
        </div>
        <div className="mt-3 p-3 bg-blue-50 border border-blue-100 rounded-xl text-xs text-blue-700">
          <p className="font-semibold mb-1">Ações rastreadas pelo sistema de auditoria:</p>
          <p className="text-blue-600">criar_usuario, editar_usuario — expandir conforme necessário adicionando `INSERT INTO audit_log` nas operações críticas.</p>
        </div>
      </Section>

      {/* System info */}
      <div className="flex items-center justify-between text-[10px] text-gray-400 px-1">
        <span className="flex items-center gap-1"><Server className="w-3 h-3" /> Vercel Serverless · Neon PostgreSQL · asyncpg</span>
        <span>Auto-refresh 60s · {lastUpdate ? fmtDate(lastUpdate.toISOString(), true) : '—'}</span>
      </div>
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function SuperAdminPage() {
  const [tab, setTab] = useState<'geral' | 'moradores' | 'ti'>('geral')

  const tabs = [
    { key: 'geral', label: 'Visão Geral', icon: Activity },
    { key: 'moradores', label: 'Moradores', icon: Users },
    { key: 'ti', label: 'TI', icon: Server },
  ] as const

  return (
    <div className="flex flex-col gap-5 p-4 sm:p-6 max-w-screen-xl mx-auto w-full">
      <div className="flex items-center gap-3">
        <Zap className="w-5 h-5 text-[#26619c]" />
        <h1 className="text-xl font-bold text-gray-900">Monitoramento</h1>
        <span className="text-xs bg-[#26619c]/10 text-[#26619c] px-2 py-0.5 rounded-full font-semibold">SuperAdmin</span>
      </div>

      <div className="flex gap-0 border-b border-gray-200 -mx-4 sm:mx-0 px-4 sm:px-0 overflow-x-auto">
        {tabs.map(({ key, label, icon: Icon }) => (
          <button key={key} onClick={() => setTab(key)}
            className={`flex items-center gap-1.5 whitespace-nowrap px-4 py-2.5 text-sm font-medium border-b-2 transition -mb-px ${tab === key ? 'border-[#26619c] text-[#26619c]' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
            <Icon className="w-4 h-4" />
            {label}
          </button>
        ))}
      </div>

      {tab === 'geral' && <VisaoGeralTab />}
      {tab === 'moradores' && <MoradoresTab />}
      {tab === 'ti' && <ITMetricsTab />}

      <p className="text-[10px] text-gray-300 text-center">APRXM Monitoring Platform · {new Date().getFullYear()}</p>
    </div>
  )
}
