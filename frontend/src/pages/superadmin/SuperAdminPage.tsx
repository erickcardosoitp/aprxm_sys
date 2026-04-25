import { useEffect, useRef, useState } from 'react'
import {
  Activity, AlertTriangle, BarChart2, ChevronDown, Clock,
  Database, Package, RefreshCw, Server, ShieldCheck, TrendingUp, Zap,
} from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../../services/api'

// ─── Types ─────────────────────────────────────────────────────────────────────
interface ITMetrics {
  database: { total_mb: number; tables: { name: string; mb: number; rows: number }[] }
  package_sla: {
    total_delivered: number
    avg_hours_to_deliver: number | null
    avg_delivery_s: number | null
    delivered_within_48h: number
    pct_within_48h: number
    overdue_packages: number
    pending_packages: number
    overdue_notified: number
  }
  activity: {
    transactions_7d: { day: string; count: number }[]
    logins_7d: { day: string; count: number }[]
    sessions_7d: { day: string; count: number }[]
    packages_7d: { day: string; count: number }[]
  }
  audit: { total_actions: number; reversals: number; period_days: number }
  top_orgs_30d: { name: string; tx_count: number; active_days: number }[]
  critical_ops: {
    cash_open: number; cash_close: number; cash_conference: number
    resident_register: number; pkg_received: number; pkg_delivered: number
    os_open: number; sangria: number; pix_conference: number
  }
  operational_timing: {
    bulk_receive_avg_scan_s: number | null
    bulk_receive_avg_items: number | null
    bulk_receive_total_batches: number
    cash_session_avg_h: number | null
    cash_session_max_h: number | null
    cash_session_total_closed: number
  }
  db_health: {
    cache_hit_rate_pct: number | null
    connections_active: number
    connections_idle: number
    connections_total: number
  }
  apdexx: number
  apdexx_components?: { sla: number; session_hygiene: number; error_score: number; overdue_score: number }
  trends: {
    revenue: { day: string; value: number }[]
    delivery_seconds: { day: string; value: number }[]
  }
  slow_queries: { query: string; calls: number; avg_ms: number }[]
}

interface OrgOption { id: string; name: string }

interface PerfSnapshot {
  apiLatencyMs: number | null
  navLoadMs: number | null
  apiBreakdown: { endpoint: string; ms: number }[]
}

interface ApdexData {
  score: number
  satisfied: number
  tolerating: number
  frustrated: number
  total: number
  threshold_ms: number
}

// ─── Utils ──────────────────────────────────────────────────────────────────────
function fmtSeconds(s: number): string {
  if (s >= 3600) return `${(s / 3600).toFixed(1)}h`
  if (s >= 60) return `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`
  if (s >= 1) return `${s.toFixed(1)}s`
  return `${Math.round(s * 1000)}ms`
}

function fmtMs(ms: number): string {
  if (ms >= 60000) return `${(ms / 60000).toFixed(1)}min`
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)}s`
  return `${Math.round(ms)}ms`
}

function computeBrowserApdex(T: number): ApdexData {
  const resources = performance.getEntriesByType('resource') as PerformanceResourceTiming[]
  const apiCalls = resources.filter(r => r.name.includes('/api/') || r.name.includes('/superadmin/'))
  const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined
  const samples: number[] = apiCalls.map(r => r.duration)
  if (nav && nav.loadEventEnd > 0) samples.push(nav.loadEventEnd - nav.startTime)
  const satisfied = samples.filter(d => d < T).length
  const tolerating = samples.filter(d => d >= T && d < 4 * T).length
  const frustrated = samples.filter(d => d >= 4 * T).length
  const total = samples.length
  const score = total > 0 ? (satisfied + tolerating / 2) / total : 1
  return { score, satisfied, tolerating, frustrated, total, threshold_ms: T }
}

// ─── Sparkline ──────────────────────────────────────────────────────────────────
function Sparkline({ data, days, color = '#26619c' }: {
  data: { day: string; count?: number; value?: number }[]
  days: number; color?: string
}) {
  const map: Record<string, number> = {}
  data.forEach(d => { map[d.day] = d.count ?? d.value ?? 0 })
  const values: number[] = []
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i)
    values.push(map[d.toISOString().split('T')[0]] ?? 0)
  }
  const max = Math.max(...values, 1)
  const w = 100; const h = 32; const pts = values.length
  if (pts < 2) return <svg viewBox={`0 0 ${w} ${h}`} className="w-full" style={{ height: 32 }} />
  const points = values.map((v, i) => `${(i / (pts - 1)) * w},${h - (v / max) * h}`).join(' ')
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full" preserveAspectRatio="none" style={{ height: 32 }}>
      <polyline fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" points={points} />
    </svg>
  )
}

// ─── Bar chart ──────────────────────────────────────────────────────────────────
function BarChart({ data, days, color = '#26619c', label, valuePrefix = '' }: {
  data: { day: string; count?: number; value?: number }[]
  days: number; color?: string; label: string; valuePrefix?: string
}) {
  const map: Record<string, number> = {}
  data.forEach(d => { map[d.day] = d.count ?? d.value ?? 0 })
  const slots: { label: string; v: number }[] = []
  for (let i = days - 1; i >= 0; i--) {
    const dt = new Date(); dt.setDate(dt.getDate() - i)
    const key = dt.toISOString().split('T')[0]
    slots.push({ label: dt.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }), v: map[key] ?? 0 })
  }
  const max = Math.max(...slots.map(s => s.v), 1)
  const total = slots.reduce((s, x) => s + x.v, 0)
  return (
    <div>
      <div className="flex items-baseline justify-between mb-1">
        <span className="text-[11px] font-medium text-gray-500">{label}</span>
        <span className="text-sm font-bold text-gray-700">{valuePrefix}{total.toLocaleString('pt-BR')}</span>
      </div>
      <div className="flex items-end gap-px h-10">
        {slots.map((s, i) => (
          <div key={i} title={`${s.label}: ${valuePrefix}${s.v}`}
            className="flex-1 rounded-t-[1px] transition-all hover:opacity-80"
            style={{ height: `${Math.max(2, (s.v / max) * 40)}px`, backgroundColor: s.v > 0 ? color : '#e5e7eb' }} />
        ))}
      </div>
    </div>
  )
}

// ─── APDEX Gauge ─────────────────────────────────────────────────────────────────
function ApdexGauge({ data }: { data: ApdexData }) {
  const { score, satisfied, tolerating, frustrated, total, threshold_ms } = data
  const color = score >= 0.94 ? '#16a34a' : score >= 0.85 ? '#65a30d' : score >= 0.70 ? '#d97706' : '#dc2626'
  const label = score >= 0.94 ? 'EXCELENTE' : score >= 0.85 ? 'BOM' : score >= 0.70 ? 'REGULAR' : 'CRÍTICO'
  const circumference = 2 * Math.PI * 38
  const offset = circumference * (1 - score)
  const bars = [
    { label: 'Satisfeito', count: satisfied, color: '#16a34a', hint: `< ${threshold_ms}ms` },
    { label: 'Tolerando', count: tolerating, color: '#d97706', hint: `${threshold_ms}–${threshold_ms * 4}ms` },
    { label: 'Frustrado', count: frustrated, color: '#dc2626', hint: `≥ ${threshold_ms * 4}ms` },
  ]
  return (
    <div className="flex flex-col sm:flex-row items-center gap-4">
      <div className="relative flex-shrink-0">
        <svg width="96" height="96" viewBox="0 0 100 100">
          <circle cx="50" cy="50" r="38" fill="none" stroke="#f3f4f6" strokeWidth="10" />
          <circle cx="50" cy="50" r="38" fill="none" stroke={color} strokeWidth="10"
            strokeDasharray={circumference} strokeDashoffset={offset}
            strokeLinecap="round" transform="rotate(-90 50 50)"
            style={{ transition: 'stroke-dashoffset 0.8s ease' }} />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-xl font-black" style={{ color }}>{score.toFixed(2)}</span>
          <span className="text-[9px] font-bold tracking-widest" style={{ color }}>{label}</span>
        </div>
      </div>
      <div className="flex-1 w-full flex flex-col gap-2">
        {bars.map(b => (
          <div key={b.label} title={b.hint}>
            <div className="flex items-center justify-between mb-0.5">
              <span className="text-[11px] text-gray-500 cursor-help">{b.label}</span>
              <span className="text-[11px] font-semibold text-gray-700">
                {b.count}<span className="text-gray-400 font-normal">/{total}</span>
              </span>
            </div>
            <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
              <div className="h-full rounded-full transition-all" style={{ width: `${total > 0 ? (b.count / total) * 100 : 0}%`, backgroundColor: b.color }} />
            </div>
          </div>
        ))}
        <p className="text-[9px] text-gray-400 leading-tight mt-0.5">
          (Satisfeito + Tolerando/2) / {total} · T={threshold_ms}ms
        </p>
      </div>
    </div>
  )
}

// ─── MetricCell ──────────────────────────────────────────────────────────────────
function MetricCell({ label, value, sub, status, large }: {
  label: string; value: string | number; sub?: string
  status?: 'ok' | 'warn' | 'crit' | 'neutral'; large?: boolean
}) {
  const dot = status === 'ok' ? 'bg-green-500' : status === 'warn' ? 'bg-amber-500' : status === 'crit' ? 'bg-red-500' : 'bg-gray-300'
  const val = status === 'ok' ? 'text-green-700' : status === 'warn' ? 'text-amber-700' : status === 'crit' ? 'text-red-700' : 'text-gray-800'
  return (
    <div className="flex flex-col gap-0.5 p-3 bg-white border border-gray-100 rounded-xl">
      <div className="flex items-center gap-1.5">
        {status && <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dot}`} />}
        <span className="text-[11px] text-gray-500 leading-tight">{label}</span>
      </div>
      <span className={`font-black leading-tight ${large ? 'text-2xl' : 'text-lg'} ${val}`}>{value}</span>
      {sub && <span className="text-[10px] text-gray-400 leading-tight">{sub}</span>}
    </div>
  )
}

// ─── Panel ──────────────────────────────────────────────────────────────────────
function Panel({ title, icon: Icon, children }: {
  title: string; icon: React.ElementType; children: React.ReactNode
}) {
  return (
    <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-gray-100 bg-gray-50/60">
        <Icon className="w-3.5 h-3.5 text-[#26619c]" />
        <h3 className="text-xs font-semibold text-gray-700 uppercase tracking-wide">{title}</h3>
      </div>
      <div className="p-4">{children}</div>
    </div>
  )
}

// ─── StatusPill ──────────────────────────────────────────────────────────────────
function StatusPill({ label, ok, warn }: { label: string; ok: boolean; warn?: boolean }) {
  const cls = ok ? 'bg-green-100 text-green-700 border-green-200'
    : warn ? 'bg-amber-100 text-amber-700 border-amber-200'
    : 'bg-red-100 text-red-700 border-red-200'
  const dot = ok ? 'bg-green-500' : warn ? 'bg-amber-500' : 'bg-red-500'
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] font-semibold ${cls}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${dot} ${ok ? 'animate-pulse' : ''}`} />
      {label}
    </span>
  )
}

// ─── Critical Ops config ─────────────────────────────────────────────────────────
const CRITICAL_OPS = [
  { key: 'cash_open' as const, label: 'Ab. Caixa', icon: '🔓' },
  { key: 'cash_close' as const, label: 'Fech. Caixa', icon: '🔒' },
  { key: 'cash_conference' as const, label: 'Conf. Caixa', icon: '✅' },
  { key: 'resident_register' as const, label: 'Cadastro', icon: '👤' },
  { key: 'pkg_received' as const, label: 'Rec. Enc.', icon: '📦' },
  { key: 'pkg_delivered' as const, label: 'Entrega', icon: '🚪' },
  { key: 'os_open' as const, label: 'OS aberta', icon: '🔧' },
  { key: 'sangria' as const, label: 'Sangria', icon: '💸' },
  { key: 'pix_conference' as const, label: 'Conf. PIX', icon: '🏦' },
]

// ─── Main ────────────────────────────────────────────────────────────────────────
export default function SuperAdminPage() {
  const [data, setData] = useState<ITMetrics | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [orgs, setOrgs] = useState<OrgOption[]>([])
  const [selectedOrgs, setSelectedOrgs] = useState<Set<string>>(new Set())
  const [orgsLoaded, setOrgsLoaded] = useState(false)
  const [showOrgDropdown, setShowOrgDropdown] = useState(false)
  const [period, setPeriod] = useState<7 | 30 | 90>(7)
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null)
  const [perf, setPerf] = useState<PerfSnapshot>({ apiLatencyMs: null, navLoadMs: null, apiBreakdown: [] })
  const [apdex, setApdex] = useState<ApdexData | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const orgRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!showOrgDropdown) return
    const h = (e: MouseEvent) => { if (orgRef.current && !orgRef.current.contains(e.target as Node)) setShowOrgDropdown(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [showOrgDropdown])

  const isQA = (name: string) => /qa|teste|test/i.test(name)

  const fetchMetrics = async (orgList: OrgOption[], selected: Set<string>, days: number) => {
    const t0 = performance.now()
    const params: Record<string, string | number> = { days }
    const realOrgs = orgList.filter(o => !isQA(o.name))
    const allReal = realOrgs.every(o => selected.has(o.id))
    if (!allReal && selected.size > 0) {
      params.association_ids = Array.from(selected).join(',')
    }
    const [metricsRes] = await Promise.all([
      api.get<ITMetrics>('/superadmin/it-metrics', { params }),
    ])
    const apiMs = Math.round(performance.now() - t0)
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined
    const navMs = nav ? Math.round(nav.loadEventEnd - nav.startTime) : null
    const resources = performance.getEntriesByType('resource') as PerformanceResourceTiming[]
    const apiBreakdown = resources
      .filter(r => r.name.includes('/superadmin/') || r.name.includes('/api/'))
      .slice(-8)
      .map(r => ({
        endpoint: r.name.split('/v1/')[1]?.split('?')[0] ?? r.name.split('/').pop() ?? r.name,
        ms: Math.round(r.duration),
      }))
      .reverse()
    return { metrics: metricsRes.data, apiMs, navMs, apiBreakdown }
  }

  const load = async (orgList?: OrgOption[], selected?: Set<string>, days?: number) => {
    setError(false)
    const useOrgs = orgList ?? orgs
    const useSelected = selected ?? selectedOrgs
    const useDays = days ?? period
    try {
      if (useOrgs.length === 0) {
        const orgsRes = await api.get<OrgOption[]>('/superadmin/organizations')
        const newOrgs = orgsRes.data
        const realSelected = new Set(newOrgs.filter(o => !isQA(o.name)).map(o => o.id))
        setOrgs(newOrgs)
        setSelectedOrgs(realSelected)
        setOrgsLoaded(true)
        const { metrics, apiMs, navMs, apiBreakdown } = await fetchMetrics(newOrgs, realSelected, useDays)
        setData(metrics)
        setPerf({ apiLatencyMs: apiMs, navLoadMs: navMs, apiBreakdown })
        setApdex(computeBrowserApdex(800))
      } else {
        const { metrics, apiMs, navMs, apiBreakdown } = await fetchMetrics(useOrgs, useSelected, useDays)
        setData(metrics)
        setPerf({ apiLatencyMs: apiMs, navLoadMs: navMs, apiBreakdown })
        setApdex(computeBrowserApdex(800))
      }
      setLastUpdate(new Date())
    } catch {
      setError(true)
      toast.error('Erro ao carregar métricas')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    intervalRef.current = setInterval(() => load(), 60_000)
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [])

  useEffect(() => {
    if (!orgsLoaded) return
    load(orgs, selectedOrgs, period)
  }, [period, selectedOrgs])

  const toggleOrg = (id: string) => setSelectedOrgs(prev => {
    const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n
  })

  const realOrgs = orgs.filter(o => !isQA(o.name))
  const allRealSelected = realOrgs.length > 0 && realOrgs.every(o => selectedOrgs.has(o.id))
  const orgLabel = allRealSelected ? 'Geral Consolidado'
    : selectedOrgs.size === 1 ? (orgs.find(o => selectedOrgs.has(o.id))?.name.split(' ').slice(-1)[0] ?? '1 org')
    : selectedOrgs.size === 0 ? 'Nenhuma'
    : `${selectedOrgs.size} orgs`

  // Derived status
  const slaOk = (data?.package_sla.pct_within_48h ?? 0) >= 85
  const slaWarn = (data?.package_sla.pct_within_48h ?? 0) >= 65
  const overdueOk = (data?.package_sla.overdue_packages ?? 1) === 0
  const overdueWarn = (data?.package_sla.overdue_packages ?? 0) <= 5
  const apdexxOk = (apdex?.score ?? 0) >= 0.85
  const apdexxWarn = (apdex?.score ?? 0) >= 0.70
  const cacheVal = data?.db_health?.cache_hit_rate_pct ?? 0
  const dbCacheOk = cacheVal >= 95
  const dbCacheWarn = cacheVal >= 85
  const reversalPct = data && data.audit.total_actions > 0
    ? (data.audit.reversals / data.audit.total_actions) * 100 : 0
  const auditOk = reversalPct <= 2
  const auditWarn = reversalPct <= 5
  const apiOk = (perf.apiLatencyMs ?? 0) < 800
  const apiWarn = (perf.apiLatencyMs ?? 0) < 2000

  return (
    <div className="flex flex-col gap-4 p-4 sm:p-6 max-w-screen-xl mx-auto w-full pb-6">

      {/* Top bar */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 bg-[#26619c] rounded-lg flex items-center justify-center">
            <Activity className="w-4 h-4 text-white" />
          </div>
          <div>
            <h1 className="text-base font-bold text-gray-900 leading-tight">Monitoramento TI</h1>
            <p className="text-[10px] text-gray-400 leading-tight">APRXM · SuperAdmin</p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap sm:ml-auto">
          {/* Org multi-select */}
          <div className="relative" ref={orgRef}>
            <button onClick={() => setShowOrgDropdown(v => !v)}
              className="flex items-center gap-2 border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs text-gray-700 bg-white hover:bg-gray-50 transition min-w-[140px]">
              <span className="font-medium flex-1 text-left">{orgLabel}</span>
              <ChevronDown className={`w-3 h-3 text-gray-400 transition-transform ${showOrgDropdown ? 'rotate-180' : ''}`} />
            </button>
            {showOrgDropdown && (
              <div className="absolute left-0 top-full mt-1 w-56 bg-white border border-gray-200 rounded-xl shadow-lg z-50 p-2">
                {/* Geral Consolidado toggle */}
                <button onClick={() => {
                  const real = new Set(realOrgs.map(o => o.id))
                  setSelectedOrgs(allRealSelected ? new Set() : real)
                }} className="w-full text-left px-2 py-1.5 text-xs hover:bg-gray-50 rounded-lg flex items-center gap-2 mb-1">
                  <span className={`w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0 text-[8px] font-bold ${allRealSelected ? 'bg-[#26619c] border-[#26619c] text-white' : 'border-gray-300'}`}>
                    {allRealSelected && '✓'}
                  </span>
                  <span className="font-semibold text-gray-700">Geral Consolidado</span>
                </button>
                <div className="border-t border-gray-100 my-1" />
                {orgs.map(o => (
                  <button key={o.id} onClick={() => toggleOrg(o.id)}
                    className="w-full text-left px-2 py-1.5 text-xs hover:bg-gray-50 rounded-lg flex items-center gap-2">
                    <span className={`w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0 text-[8px] font-bold ${selectedOrgs.has(o.id) ? 'bg-[#26619c] border-[#26619c] text-white' : 'border-gray-300'}`}>
                      {selectedOrgs.has(o.id) && '✓'}
                    </span>
                    <span className={`truncate ${isQA(o.name) ? 'text-gray-400 italic' : 'text-gray-700'}`}>{o.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Period */}
          <div className="flex border border-gray-200 rounded-lg overflow-hidden">
            {([7, 30, 90] as const).map(d => (
              <button key={d} onClick={() => setPeriod(d)}
                className={`px-2.5 py-1.5 text-xs font-medium transition ${period === d ? 'bg-[#26619c] text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>
                {d}d
              </button>
            ))}
          </div>

          {/* Refresh */}
          <button onClick={() => load(orgs, selectedOrgs, period)} disabled={loading}
            className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-[#26619c] border border-gray-200 px-2.5 py-1.5 rounded-lg transition disabled:opacity-40">
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            {lastUpdate ? lastUpdate.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—'}
          </button>
        </div>
      </div>

      {/* Status strip */}
      <div className="flex flex-wrap gap-2">
        <StatusPill label={`APDEX ${apdex?.score.toFixed(2) ?? '—'}`} ok={apdexxOk} warn={apdexxWarn} />
        <StatusPill label={`SLA ${data?.package_sla.pct_within_48h ?? 0}%`} ok={slaOk} warn={slaWarn} />
        <StatusPill label={`Atraso: ${data?.package_sla.overdue_packages ?? 0} enc.`} ok={overdueOk} warn={overdueWarn} />
        <StatusPill label={`Cache DB: ${data?.db_health?.cache_hit_rate_pct ?? '—'}%`} ok={dbCacheOk} warn={dbCacheWarn} />
        <StatusPill label={`Estorno: ${reversalPct.toFixed(1)}%`} ok={auditOk} warn={auditWarn} />
        <StatusPill label={perf.apiLatencyMs != null ? `API: ${fmtMs(perf.apiLatencyMs)}` : 'API: —'} ok={apiOk} warn={apiWarn} />
        {loading && (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-blue-200 bg-blue-50 text-blue-600 text-[11px] font-semibold">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />Atualizando…
          </span>
        )}
      </div>

      {error && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
          <AlertTriangle className="w-4 h-4 text-red-500 shrink-0" />
          <span className="text-sm text-red-700">Erro ao carregar métricas.</span>
          <button onClick={() => load(orgs, selectedOrgs, period)} className="ml-auto text-xs text-red-600 underline">Tentar novamente</button>
        </div>
      )}

      {data && (
        <div className="flex flex-col gap-4">

          {/* Row 1: APDEXX + SLA + Auditoria */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">

            <Panel title="APDEX Score (Browser)" icon={Zap}>
              {apdex ? (
                <ApdexGauge data={apdex} />
              ) : (
                <p className="text-[11px] text-gray-400 italic">Calculando…</p>
              )}
            </Panel>

            <Panel title={`SLA Encomendas — ${period}d`} icon={Package}>
              <div className="grid grid-cols-2 gap-2">
                <MetricCell label="Taxa 48h" value={`${data.package_sla.pct_within_48h}%`}
                  status={slaOk ? 'ok' : slaWarn ? 'warn' : 'crit'} large />
                <MetricCell label="Em atraso" value={data.package_sla.overdue_packages}
                  status={overdueOk ? 'ok' : overdueWarn ? 'warn' : 'crit'} large />
                <MetricCell
                  label="Tempo médio de entrega"
                  value={data.package_sla.avg_delivery_s != null ? fmtSeconds(data.package_sla.avg_delivery_s) : '—'}
                  sub={data.package_sla.avg_delivery_s != null ? `${data.package_sla.avg_delivery_s.toFixed(0)}s` : undefined}
                  status={data.package_sla.avg_delivery_s != null
                    ? (data.package_sla.avg_delivery_s <= 172800 ? 'ok' : data.package_sla.avg_delivery_s <= 345600 ? 'warn' : 'crit')
                    : 'neutral'} />
                <MetricCell
                  label="Scan por lote (médio)"
                  value={data.operational_timing.bulk_receive_avg_scan_s != null
                    ? fmtSeconds(data.operational_timing.bulk_receive_avg_scan_s) : '—'}
                  sub={`${data.operational_timing.bulk_receive_total_batches} lotes`}
                  status={data.operational_timing.bulk_receive_total_batches > 0 ? 'ok' : 'neutral'} />
                <MetricCell label="Pendentes" value={data.package_sla.pending_packages} status="neutral" />
                <MetricCell label="Notif. sem retirada" value={data.package_sla.overdue_notified}
                  status={data.package_sla.overdue_notified === 0 ? 'ok' : 'warn'} />
              </div>
            </Panel>

            <Panel title={`Auditoria — ${period}d`} icon={ShieldCheck}>
              <div className="grid grid-cols-2 gap-2">
                <MetricCell label="Total de operações" value={data.audit.total_actions.toLocaleString('pt-BR')} status="neutral" large />
                <MetricCell label="Reversões / estornos" value={data.audit.reversals}
                  status={auditOk ? 'ok' : auditWarn ? 'warn' : 'crit'} large />
                <MetricCell label="Taxa de reversão" value={`${reversalPct.toFixed(2)}%`}
                  sub="alerta se > 5%"
                  status={auditOk ? 'ok' : auditWarn ? 'warn' : 'crit'} />
                <MetricCell label="Orgs monitoradas" value={data.top_orgs_30d.length} status="neutral" />
              </div>
              {data.top_orgs_30d.length > 0 && (
                <div className="mt-3 flex flex-col gap-1.5">
                  <p className="text-[10px] text-gray-400 font-semibold uppercase tracking-wide">Volume por org</p>
                  {data.top_orgs_30d.slice(0, 3).map(o => {
                    const maxTx = Math.max(...data.top_orgs_30d.map(x => x.tx_count), 1)
                    return (
                      <div key={o.name} className="flex items-center gap-2">
                        <span className="text-[11px] text-gray-500 truncate w-24 shrink-0">
                          {o.name.split(' ').slice(-1)[0]}
                        </span>
                        <div className="flex-1 bg-gray-100 rounded-full h-1.5">
                          <div className="h-1.5 rounded-full bg-[#26619c]" style={{ width: `${(o.tx_count / maxTx) * 100}%` }} />
                        </div>
                        <span className="text-[11px] font-semibold text-gray-600 w-8 text-right">{o.tx_count}</span>
                      </div>
                    )
                  })}
                </div>
              )}
            </Panel>
          </div>

          {/* Row 2: Atividade */}
          <Panel title={`Atividade — ${period} dias`} icon={BarChart2}>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-6">
              <BarChart days={Math.min(period, 30)} data={data.activity.transactions_7d} color="#26619c" label="Transações" />
              <BarChart days={Math.min(period, 30)} data={data.activity.packages_7d} color="#7c3aed" label="Encomendas recebidas" />
              <BarChart days={Math.min(period, 30)} data={data.activity.sessions_7d} color="#0891b2" label="Aberturas de caixa" />
              <BarChart days={Math.min(period, 30)} data={data.activity.logins_7d} color="#059669" label="Logins" />
            </div>
          </Panel>

          {/* Row 3: Ops Críticas + Tempos */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">

            <Panel title={`Operações Críticas — ${period}d`} icon={ShieldCheck}>
              <div className="grid grid-cols-3 gap-2">
                {CRITICAL_OPS.map(op => {
                  const count = data.critical_ops[op.key]
                  return (
                    <div key={op.key} className={`flex flex-col items-center gap-0.5 p-2.5 rounded-xl border ${count > 0 ? 'bg-blue-50 border-blue-100' : 'bg-gray-50 border-gray-100'}`}>
                      <span className="text-base">{op.icon}</span>
                      <span className={`text-lg font-black leading-none ${count > 0 ? 'text-blue-700' : 'text-gray-300'}`}>{count}</span>
                      <span className="text-[9px] text-gray-500 text-center leading-tight">{op.label}</span>
                    </div>
                  )
                })}
              </div>
            </Panel>

            <Panel title="Tempos Operacionais" icon={Clock}>
              <div className="grid grid-cols-2 gap-2">
                <MetricCell
                  label="Sessão de caixa (média)"
                  value={data.operational_timing.cash_session_avg_h != null
                    ? fmtSeconds(data.operational_timing.cash_session_avg_h * 3600) : '—'}
                  sub={[
                    data.operational_timing.cash_session_max_h != null
                      ? `máx ${fmtSeconds(data.operational_timing.cash_session_max_h * 3600)}` : null,
                    `${data.operational_timing.cash_session_total_closed} fechadas`,
                  ].filter(Boolean).join(' · ')}
                  status={data.operational_timing.cash_session_avg_h != null
                    ? (data.operational_timing.cash_session_avg_h <= 12 ? 'ok' : 'warn') : 'neutral'}
                  large />
                <MetricCell
                  label="Scan por lote (média)"
                  value={data.operational_timing.bulk_receive_avg_scan_s != null
                    ? fmtSeconds(data.operational_timing.bulk_receive_avg_scan_s) : '—'}
                  sub={`~${data.operational_timing.bulk_receive_avg_items?.toFixed(1) ?? '—'} itens/lote · ${data.operational_timing.bulk_receive_total_batches} lotes`}
                  status={data.operational_timing.bulk_receive_total_batches > 0 ? 'ok' : 'neutral'}
                  large />
                <MetricCell
                  label="Entrega de encomenda (média)"
                  value={data.package_sla.avg_delivery_s != null ? fmtSeconds(data.package_sla.avg_delivery_s) : '—'}
                  sub={data.package_sla.avg_delivery_s != null ? `${data.package_sla.avg_delivery_s.toFixed(0)}s brutos` : undefined}
                  status={data.package_sla.avg_delivery_s != null
                    ? (data.package_sla.avg_delivery_s <= 172800 ? 'ok' : 'warn') : 'neutral'} />
                <MetricCell label="Lotes de recebimento" value={data.operational_timing.bulk_receive_total_batches}
                  sub="recebimentos múltiplos no período" status="neutral" />
              </div>
            </Panel>
          </div>

          {/* Row 4: Performance + DB */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">

            <Panel title="Performance Frontend / API" icon={TrendingUp}>
              <div className="grid grid-cols-2 gap-2 mb-3">
                <MetricCell
                  label="Carregamento da página"
                  value={perf.navLoadMs != null ? fmtMs(perf.navLoadMs) : '—'}
                  sub={perf.navLoadMs != null ? `${perf.navLoadMs}ms brutos` : undefined}
                  status={perf.navLoadMs != null ? (perf.navLoadMs < 1500 ? 'ok' : perf.navLoadMs < 3000 ? 'warn' : 'crit') : 'neutral'}
                  large />
                <MetricCell
                  label="Latência it-metrics"
                  value={perf.apiLatencyMs != null ? fmtMs(perf.apiLatencyMs) : '—'}
                  sub={perf.apiLatencyMs != null ? `${perf.apiLatencyMs}ms brutos` : undefined}
                  status={perf.apiLatencyMs != null ? (perf.apiLatencyMs < 800 ? 'ok' : perf.apiLatencyMs < 2000 ? 'warn' : 'crit') : 'neutral'}
                  large />
              </div>
              {perf.apiBreakdown.length > 0 && (
                <div className="flex flex-col gap-1">
                  <p className="text-[11px] font-semibold text-gray-500 mb-1">Últimas chamadas API</p>
                  {perf.apiBreakdown.map((r, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${r.ms < 800 ? 'bg-green-500' : r.ms < 2000 ? 'bg-amber-500' : 'bg-red-500'}`} />
                      <span className="text-[11px] text-gray-500 flex-1 truncate font-mono">{r.endpoint}</span>
                      <span className={`text-[11px] font-bold shrink-0 ${r.ms < 800 ? 'text-green-700' : r.ms < 2000 ? 'text-amber-700' : 'text-red-700'}`}>
                        {fmtMs(r.ms)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              <p className="text-[9px] text-gray-400 mt-2">Limiares: &lt;800ms ✓ · 800–2000ms ⚠ · &gt;2000ms ✗</p>
            </Panel>

            <Panel title="Banco de Dados" icon={Database}>
              <div className="grid grid-cols-2 gap-2 mb-3">
                <MetricCell label="Cache hit rate"
                  value={data.db_health.cache_hit_rate_pct != null ? `${data.db_health.cache_hit_rate_pct}%` : '—'}
                  status={dbCacheOk ? 'ok' : dbCacheWarn ? 'warn' : 'crit'} large />
                <MetricCell label="Tamanho total" value={`${data.database.total_mb}MB`} status="neutral" large />
                <MetricCell label="Conexões ativas" value={data.db_health.connections_active}
                  status={data.db_health.connections_active < 10 ? 'ok' : 'warn'} />
                <MetricCell label="Conexões idle" value={data.db_health.connections_idle} status="neutral" />
              </div>
              <div className="flex flex-col gap-1 mb-3">
                {data.database.tables.slice(0, 5).map(t => {
                  const pct = data.database.total_mb > 0 ? Math.min(100, (t.mb / data.database.total_mb) * 100) : 0
                  return (
                    <div key={t.name} className="flex items-center gap-2">
                      <span className="text-[11px] font-mono text-gray-500 w-28 truncate shrink-0">{t.name}</span>
                      <div className="flex-1 bg-gray-100 rounded-full h-1.5">
                        <div className="h-1.5 rounded-full bg-[#26619c]/60" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="text-[10px] text-gray-400 w-16 text-right shrink-0">{t.rows.toLocaleString('pt-BR')}r</span>
                    </div>
                  )
                })}
              </div>
              {data.slow_queries.length > 0 ? (
                <>
                  <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Queries mais lentas</p>
                  <div className="flex flex-col gap-1">
                    {data.slow_queries.map((q, i) => (
                      <div key={i} className="flex items-start gap-2 bg-gray-50 rounded-lg px-2 py-1.5">
                        <span className={`text-[10px] font-bold shrink-0 mt-0.5 ${q.avg_ms > 200 ? 'text-red-600' : q.avg_ms > 50 ? 'text-amber-600' : 'text-green-600'}`}>
                          {fmtMs(q.avg_ms)}
                        </span>
                        <span className="text-[10px] font-mono text-gray-500 leading-tight truncate flex-1">{q.query}</span>
                        <span className="text-[9px] text-gray-400 shrink-0">{q.calls}×</span>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <p className="text-[10px] text-gray-400 italic">pg_stat_statements sem dados</p>
              )}
            </Panel>
          </div>

          {/* Row 5: Tendências */}
          <Panel title={`Tendências — ${period} dias`} icon={TrendingUp}>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-6">
              <div>
                <p className="text-[11px] font-medium text-gray-500 mb-2">Receita diária (R$)</p>
                <BarChart days={Math.min(period, 30)} data={data.trends.revenue} color="#059669" label="" valuePrefix="R$ " />
              </div>
              <div>
                <p className="text-[11px] font-medium text-gray-500 mb-2">Encomendas / dia</p>
                <Sparkline data={data.activity.packages_7d} days={Math.min(period, 30)} color="#7c3aed" />
                <p className="text-[10px] text-gray-400 mt-1">
                  {data.activity.packages_7d.reduce((s, d) => s + d.count, 0)} enc. no período
                </p>
              </div>
              <div>
                <p className="text-[11px] font-medium text-gray-500 mb-2">Tempo médio de entrega</p>
                {data.trends.delivery_seconds.length > 0 ? (
                  <>
                    <Sparkline data={data.trends.delivery_seconds} days={Math.min(period, 30)} color="#0891b2" />
                    <p className="text-[10px] text-gray-400 mt-1">
                      média {fmtSeconds(data.trends.delivery_seconds.reduce((s, d) => s + d.value, 0) / data.trends.delivery_seconds.length)}
                    </p>
                  </>
                ) : <p className="text-[10px] text-gray-400 italic mt-1">Sem entregas no período</p>}
              </div>
              <div>
                <p className="text-[11px] font-medium text-gray-500 mb-2">Transações / dia</p>
                <Sparkline data={data.activity.transactions_7d} days={Math.min(period, 30)} color="#26619c" />
                <p className="text-[10px] text-gray-400 mt-1">
                  {data.activity.transactions_7d.reduce((s, d) => s + d.count, 0)} no período
                </p>
              </div>
            </div>
          </Panel>

        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between text-[10px] text-gray-300 px-1 mt-1">
        <span className="flex items-center gap-1.5">
          <Server className="w-3 h-3" />
          Vercel Serverless · Neon PostgreSQL · auto-refresh 60s
        </span>
        <span>{lastUpdate ? `Atualizado: ${lastUpdate.toLocaleTimeString('pt-BR')}` : '—'}</span>
      </div>
    </div>
  )
}
