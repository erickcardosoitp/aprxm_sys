import { useEffect, useRef, useState } from 'react'
import {
  Activity, AlertTriangle, BarChart2, ChevronDown, Clock,
  Database, Package, RefreshCw, Server, ShieldCheck, TrendingUp,
  Users, Wifi, Zap,
} from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../../services/api'

// ─── Types ─────────────────────────────────────────────────────────────────────
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
  apdexx_components?: { sla: number; session_hygiene: number; error_score: number; overdue_score: number }
}

interface PerfSnapshot {
  apiLatencyMs: number | null
  navLoadMs: number | null
  apiBreakdown: { endpoint: string; ms: number }[]
}

// ─── Utils ──────────────────────────────────────────────────────────────────────
const ms2s = (ms: number) => ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${ms}ms`

function statusColor(ok: boolean, warn?: boolean) {
  if (ok) return 'bg-green-500'
  if (warn) return 'bg-amber-500'
  return 'bg-red-500'
}

function threshold<T extends string>(v: number, levels: [number, T, T, T]): T {
  const [cut, good, mid, bad] = levels
  if (v >= cut) return good
  if (v >= cut * 0.7) return mid
  return bad
}

// ─── Mini sparkline ─────────────────────────────────────────────────────────────
function Sparkline({ data, days, color = '#26619c' }: { data: { day: string; count: number }[]; days: number; color?: string }) {
  const map: Record<string, number> = {}
  data.forEach(d => { map[d.day] = d.count })
  const values: number[] = []
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i)
    values.push(map[d.toISOString().split('T')[0]] ?? 0)
  }
  const max = Math.max(...values, 1)
  const w = 100; const h = 32; const pts = values.length
  const points = values.map((v, i) => `${(i / (pts - 1)) * w},${h - (v / max) * h}`).join(' ')
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full" preserveAspectRatio="none" style={{ height: 32 }}>
      <polyline fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" points={points} />
    </svg>
  )
}

// ─── Bar chart ──────────────────────────────────────────────────────────────────
function BarChart({ data, days, color = '#26619c', label }: { data: { day: string; count: number }[]; days: number; color?: string; label: string }) {
  const map: Record<string, number> = {}
  data.forEach(d => { map[d.day] = d.count })
  const slots: { d: string; label: string; v: number }[] = []
  for (let i = days - 1; i >= 0; i--) {
    const dt = new Date(); dt.setDate(dt.getDate() - i)
    const key = dt.toISOString().split('T')[0]
    slots.push({ d: key, label: dt.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }), v: map[key] ?? 0 })
  }
  const max = Math.max(...slots.map(s => s.v), 1)
  const total = slots.reduce((s, x) => s + x.v, 0)
  return (
    <div>
      <div className="flex items-baseline justify-between mb-1">
        <span className="text-xs font-medium text-gray-500">{label}</span>
        <span className="text-sm font-bold text-gray-700">{total.toLocaleString('pt-BR')}</span>
      </div>
      <div className="flex items-end gap-px h-12">
        {slots.map((s, i) => (
          <div key={i} title={`${s.label}: ${s.v}`}
            className="flex-1 rounded-t-[1px] transition-all hover:opacity-80 cursor-default"
            style={{ height: `${Math.max(2, (s.v / max) * 48)}px`, backgroundColor: s.v > 0 ? color : '#e5e7eb' }} />
        ))}
      </div>
      {days <= 14 && (
        <div className="flex items-center mt-0.5">
          {slots.filter((_, i) => i % 2 === 0).map((s, i) => (
            <span key={i} className="flex-1 text-center text-[8px] text-gray-300">{s.label.split('/')[0]}</span>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── APDEXX gauge ───────────────────────────────────────────────────────────────
function ApdexxGauge({ value, components }: { value: number; components?: ITMetrics['apdexx_components'] }) {
  const pct = Math.round(value * 100)
  const color = pct >= 85 ? '#16a34a' : pct >= 65 ? '#d97706' : '#dc2626'
  const label = pct >= 85 ? 'SAUDÁVEL' : pct >= 65 ? 'ATENÇÃO' : 'CRÍTICO'
  const circumference = 2 * Math.PI * 38
  const offset = circumference * (1 - value)

  const compItems = components ? [
    { label: 'SLA Encomendas', v: components.sla, weight: 30 },
    { label: 'Higiene de caixa', v: components.session_hygiene, weight: 20 },
    { label: 'Taxa de erro', v: components.error_score, weight: 20 },
    { label: 'Pontualidade', v: components.overdue_score, weight: 30 },
  ] : []

  return (
    <div className="flex flex-col sm:flex-row items-center gap-5">
      <div className="relative flex-shrink-0">
        <svg width="100" height="100" viewBox="0 0 100 100">
          <circle cx="50" cy="50" r="38" fill="none" stroke="#f3f4f6" strokeWidth="10" />
          <circle cx="50" cy="50" r="38" fill="none" stroke={color} strokeWidth="10"
            strokeDasharray={circumference} strokeDashoffset={offset}
            strokeLinecap="round" transform="rotate(-90 50 50)"
            style={{ transition: 'stroke-dashoffset 0.8s ease' }} />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-xl font-black" style={{ color }}>{value.toFixed(2)}</span>
          <span className="text-[9px] font-bold tracking-widest" style={{ color }}>{label}</span>
        </div>
      </div>
      {compItems.length > 0 && (
        <div className="flex-1 w-full flex flex-col gap-1.5">
          {compItems.map(c => {
            const pct2 = Math.round(c.v * 100)
            const bg = pct2 >= 85 ? 'bg-green-500' : pct2 >= 60 ? 'bg-amber-500' : 'bg-red-500'
            return (
              <div key={c.label}>
                <div className="flex items-center justify-between mb-0.5">
                  <span className="text-[11px] text-gray-500">{c.label}</span>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] font-semibold text-gray-700">{pct2}%</span>
                    <span className="text-[9px] text-gray-400">×{c.weight}%</span>
                  </div>
                </div>
                <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                  <div className={`h-full rounded-full transition-all ${bg}`} style={{ width: `${pct2}%` }} />
                </div>
              </div>
            )
          })}
          <p className="text-[9px] text-gray-400 mt-1">
            APDEXX = SLA×30 + Higiene×20 + Erro×20 + Pontualidade×30
          </p>
        </div>
      )}
    </div>
  )
}

// ─── Metric cell ────────────────────────────────────────────────────────────────
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
      <span className={`font-black leading-tight ${large ? 'text-3xl' : 'text-xl'} ${val}`}>{value}</span>
      {sub && <span className="text-[10px] text-gray-400 leading-tight">{sub}</span>}
    </div>
  )
}

// ─── Panel ──────────────────────────────────────────────────────────────────────
function Panel({ title, icon: Icon, children, accent }: {
  title: string; icon: React.ElementType; children: React.ReactNode; accent?: string
}) {
  return (
    <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm">
      <div className={`flex items-center gap-2 px-4 py-2.5 border-b border-gray-100 ${accent ?? 'bg-gray-50/60'}`}>
        <Icon className="w-3.5 h-3.5 text-[#26619c]" />
        <h3 className="text-xs font-semibold text-gray-700 uppercase tracking-wide">{title}</h3>
      </div>
      <div className="p-4">{children}</div>
    </div>
  )
}

// ─── Status pill ────────────────────────────────────────────────────────────────
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

// ─── Main dashboard ─────────────────────────────────────────────────────────────
const CRITICAL_OPS = [
  { key: 'cash_open' as const, label: 'Ab. Caixa', icon: '🔓' },
  { key: 'cash_close' as const, label: 'Fech. Caixa', icon: '🔒' },
  { key: 'cash_conference' as const, label: 'Conf. Caixa', icon: '✅' },
  { key: 'resident_register' as const, label: 'Cadastro Assoc.', icon: '👤' },
  { key: 'pkg_received' as const, label: 'Rec. Encomenda', icon: '📦' },
  { key: 'pkg_delivered' as const, label: 'Entrega Enc.', icon: '🚪' },
  { key: 'os_open' as const, label: 'Abertura OS', icon: '🔧' },
  { key: 'sangria' as const, label: 'Sangria', icon: '💸' },
  { key: 'pix_conference' as const, label: 'Conf. PIX', icon: '🏦' },
]

export default function SuperAdminPage() {
  const [data, setData] = useState<ITMetrics | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [orgs, setOrgs] = useState<{ id: string; name: string }[]>([])
  const [filterOrg, setFilterOrg] = useState('')
  const [period, setPeriod] = useState<7 | 30 | 90>(7)
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null)
  const [perf, setPerf] = useState<PerfSnapshot>({ apiLatencyMs: null, navLoadMs: null, apiBreakdown: [] })
  const [showApdexxBreakdown, setShowApdexxBreakdown] = useState(false)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const load = async () => {
    setError(false)
    const t0 = performance.now()
    try {
      const params: Record<string, any> = { days: period }
      if (filterOrg) params.association_id = filterOrg

      const [metricsRes, orgsRes] = await Promise.all([
        api.get<ITMetrics>('/superadmin/it-metrics', { params }),
        orgs.length === 0 ? api.get<{ id: string; name: string }[]>('/superadmin/organizations') : Promise.resolve(null),
      ])
      const apiMs = Math.round(performance.now() - t0)

      // collect browser perf
      const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined
      const navMs = nav ? Math.round(nav.loadEventEnd - nav.startTime) : null
      const resources = performance.getEntriesByType('resource') as PerformanceResourceTiming[]
      const apiBreakdown = resources
        .filter(r => r.name.includes('/api/') || r.name.includes('/superadmin/'))
        .slice(-8)
        .map(r => ({
          endpoint: r.name.split('/v1/')[1]?.split('?')[0] ?? r.name.split('/').pop() ?? r.name,
          ms: Math.round(r.duration),
        }))
        .reverse()

      setData(metricsRes.data)
      if (orgsRes) setOrgs(orgsRes.data)
      setLastUpdate(new Date())
      setPerf({ apiLatencyMs: apiMs, navLoadMs: navMs, apiBreakdown })
    } catch {
      setError(true)
      toast.error('Erro ao carregar métricas')
    } finally { setLoading(false) }
  }

  useEffect(() => {
    load()
    intervalRef.current = setInterval(load, 60_000)
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [period, filterOrg])

  // ── Derived status ────────────────────────────────────────────────────────────
  const slaOk = (data?.package_sla.pct_within_48h ?? 0) >= 85
  const slaWarn = (data?.package_sla.pct_within_48h ?? 0) >= 65
  const overdueOk = (data?.package_sla.overdue_packages ?? 1) === 0
  const overdueWarn = (data?.package_sla.overdue_packages ?? 0) <= 5
  const apdexxOk = (data?.apdexx ?? 0) >= 0.85
  const apdexxWarn = (data?.apdexx ?? 0) >= 0.65
  const dbCacheOk = (data?.db_health.cache_hit_rate_pct ?? 0) >= 95
  const dbCacheWarn = (data?.db_health.cache_hit_rate_pct ?? 0) >= 85
  const reversalRate = data ? (data.audit.total_actions_24h > 0 ? data.audit.reversals_24h / data.audit.total_actions_24h : 0) : 0
  const auditOk = reversalRate <= 0.02
  const auditWarn = reversalRate <= 0.05
  const apiOk = (perf.apiLatencyMs ?? 0) < 800
  const apiWarn = (perf.apiLatencyMs ?? 0) < 2000

  return (
    <div className="flex flex-col gap-4 p-4 sm:p-6 max-w-screen-xl mx-auto w-full">

      {/* ── Top bar ──────────────────────────────────────────────────────────── */}
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
          {/* Org filter */}
          <select value={filterOrg} onChange={e => setFilterOrg(e.target.value)}
            className="border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-[#26619c]/30">
            <option value="">Geral — todas as orgs</option>
            {orgs.filter(o => !o.name.toLowerCase().includes('geral')).map(o => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </select>

          {/* Period */}
          <div className="flex border border-gray-200 rounded-lg overflow-hidden">
            {([7, 30, 90] as const).map(d => (
              <button key={d} onClick={() => setPeriod(d)}
                className={`px-2.5 py-1.5 text-xs font-medium transition ${period === d ? 'bg-[#26619c] text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>
                {d}d
              </button>
            ))}
          </div>

          {/* Refresh + last update */}
          <button onClick={load} disabled={loading}
            className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-[#26619c] border border-gray-200 px-2.5 py-1.5 rounded-lg transition disabled:opacity-40">
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            {lastUpdate ? lastUpdate.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—'}
          </button>
        </div>
      </div>

      {/* ── Status strip ─────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-2">
        <StatusPill label="APDEXX" ok={apdexxOk} warn={apdexxWarn} />
        <StatusPill label={`SLA Enc. ${data?.package_sla.pct_within_48h ?? 0}%`} ok={slaOk} warn={slaWarn} />
        <StatusPill label={`Atraso: ${data?.package_sla.overdue_packages ?? 0}`} ok={overdueOk} warn={overdueWarn} />
        <StatusPill label={`Cache DB: ${data?.db_health.cache_hit_rate_pct ?? '—'}%`} ok={dbCacheOk} warn={dbCacheWarn} />
        <StatusPill label={`Estorno: ${(reversalRate * 100).toFixed(1)}%`} ok={auditOk} warn={auditWarn} />
        <StatusPill label={perf.apiLatencyMs != null ? `API: ${ms2s(perf.apiLatencyMs)}` : 'API: —'} ok={apiOk} warn={apiWarn} />
        {loading && <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-blue-200 bg-blue-50 text-blue-600 text-[11px] font-semibold"><span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />Atualizando…</span>}
      </div>

      {error && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
          <AlertTriangle className="w-4 h-4 text-red-500 shrink-0" />
          <span className="text-sm text-red-700">Erro ao carregar métricas.</span>
          <button onClick={load} className="ml-auto text-xs text-red-600 underline">Tentar novamente</button>
        </div>
      )}

      {data && (
        <div className="flex flex-col gap-4">

          {/* ── Row 1: APDEXX + SLA + Audit ──────────────────────────────────── */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">

            {/* APDEXX */}
            <Panel title="APDEXX Score" icon={Zap}>
              <ApdexxGauge value={data.apdexx} components={data.apdexx_components} />
              <button onClick={() => setShowApdexxBreakdown(v => !v)}
                className="mt-3 flex items-center gap-1 text-[11px] text-[#26619c] hover:underline">
                <ChevronDown className={`w-3 h-3 transition-transform ${showApdexxBreakdown ? 'rotate-180' : ''}`} />
                {showApdexxBreakdown ? 'Ocultar fórmula' : 'Ver composição'}
              </button>
              {showApdexxBreakdown && (
                <div className="mt-2 text-[10px] text-gray-500 bg-gray-50 rounded-lg p-2 font-mono leading-relaxed">
                  APDEXX = SLA({(data.apdexx_components?.sla ?? 0).toFixed(2)}×0.30)<br />
                  + Caixa({(data.apdexx_components?.session_hygiene ?? 0).toFixed(2)}×0.20)<br />
                  + Erro({(data.apdexx_components?.error_score ?? 0).toFixed(2)}×0.20)<br />
                  + Pontualidade({(data.apdexx_components?.overdue_score ?? 0).toFixed(2)}×0.30)<br />
                  = {data.apdexx.toFixed(3)}
                </div>
              )}
            </Panel>

            {/* Package SLA */}
            <Panel title={`SLA Encomendas — ${period}d`} icon={Package}>
              <div className="grid grid-cols-2 gap-2">
                <MetricCell label="Taxa 48h" value={`${data.package_sla.pct_within_48h}%`}
                  status={slaOk ? 'ok' : slaWarn ? 'warn' : 'crit'} large />
                <MetricCell label="Em atraso" value={data.package_sla.overdue_packages}
                  status={overdueOk ? 'ok' : overdueWarn ? 'warn' : 'crit'} large />
                <MetricCell label="Pendentes" value={data.package_sla.pending_packages} status="neutral" />
                <MetricCell label="Entregues" value={data.package_sla.total_delivered} status="neutral" />
                {data.package_sla.avg_hours_to_deliver && (
                  <MetricCell label="Tempo médio" value={`${data.package_sla.avg_hours_to_deliver}h`} status="neutral" />
                )}
                <MetricCell label="Notif. s/retirada" value={data.package_sla.overdue_notified}
                  status={data.package_sla.overdue_notified === 0 ? 'ok' : 'warn'} />
              </div>
            </Panel>

            {/* Audit */}
            <Panel title={`Auditoria — ${period}d`} icon={ShieldCheck}>
              <div className="grid grid-cols-2 gap-2">
                <MetricCell label="Ações auditadas" value={data.audit.total_actions_24h} status="neutral" large />
                <MetricCell label="Estornos/Reversões" value={data.audit.reversals_24h}
                  status={auditOk ? 'ok' : auditWarn ? 'warn' : 'crit'} large />
                <MetricCell label="Taxa de estorno"
                  value={data.audit.total_actions_24h > 0 ? `${(reversalRate * 100).toFixed(2)}%` : '—'}
                  sub="alerta > 5%"
                  status={auditOk ? 'ok' : auditWarn ? 'warn' : 'crit'} />
                <MetricCell label="Orgs top 30d" value={data.top_orgs_30d.length} status="neutral" />
              </div>
              {data.top_orgs_30d.length > 0 && (
                <div className="mt-3 flex flex-col gap-1">
                  {data.top_orgs_30d.map(o => {
                    const maxTx = Math.max(...data.top_orgs_30d.map(x => x.tx_count), 1)
                    return (
                      <div key={o.name} className="flex items-center gap-2">
                        <span className="text-[11px] text-gray-500 truncate w-28 shrink-0">{o.name.split(' de ')[1] ?? o.name}</span>
                        <div className="flex-1 bg-gray-100 rounded-full h-1.5">
                          <div className="h-1.5 rounded-full bg-[#26619c]" style={{ width: `${(o.tx_count / maxTx) * 100}%` }} />
                        </div>
                        <span className="text-[11px] font-semibold text-gray-600 w-6 text-right">{o.tx_count}</span>
                      </div>
                    )
                  })}
                </div>
              )}
            </Panel>
          </div>

          {/* ── Row 2: Activity charts ────────────────────────────────────────── */}
          <Panel title={`Atividade — ${period} dias`} icon={BarChart2}>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
              <BarChart days={Math.min(period, 30)} data={data.activity.transactions_7d} color="#26619c" label="Transações financeiras" />
              <BarChart days={Math.min(period, 30)} data={data.activity.logins_7d} color="#7c3aed" label="Logins de usuário" />
              <BarChart days={Math.min(period, 30)} data={data.activity.sessions_7d} color="#0891b2" label="Aberturas de caixa" />
            </div>
          </Panel>

          {/* ── Row 3: Critical Ops + Timing ─────────────────────────────────── */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">

            {/* Critical ops */}
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

            {/* Operational timing */}
            <Panel title="Tempos Operacionais" icon={Clock}>
              <div className="grid grid-cols-2 gap-2">
                <MetricCell label="Duração média de caixa"
                  value={data.operational_timing.cash_session_avg_h != null ? `${data.operational_timing.cash_session_avg_h.toFixed(1)}h` : '—'}
                  sub={`máx: ${data.operational_timing.cash_session_max_h?.toFixed(1) ?? '—'}h · ${data.operational_timing.cash_session_total_closed} fechados`}
                  status={data.operational_timing.cash_session_avg_h != null ? (data.operational_timing.cash_session_avg_h <= 12 ? 'ok' : 'warn') : 'neutral'} large />
                <MetricCell label="Tempo médio lote (scan)"
                  value={data.operational_timing.bulk_receive_avg_scan_s != null
                    ? ms2s(data.operational_timing.bulk_receive_avg_scan_s * 1000)
                    : '—'}
                  sub={`~${data.operational_timing.bulk_receive_avg_items?.toFixed(1) ?? '—'} itens/lote · ${data.operational_timing.bulk_receive_total_batches} lotes`}
                  status={data.operational_timing.bulk_receive_total_batches > 0 ? 'ok' : 'neutral'} large />
                <MetricCell label="Tempo médio de entrega"
                  value={data.package_sla.avg_hours_to_deliver != null ? `${data.package_sla.avg_hours_to_deliver}h` : '—'}
                  status={data.package_sla.avg_hours_to_deliver != null ? (data.package_sla.avg_hours_to_deliver <= 24 ? 'ok' : data.package_sla.avg_hours_to_deliver <= 48 ? 'warn' : 'crit') : 'neutral'} />
                <MetricCell label="Lotes múltiplos"
                  value={data.operational_timing.bulk_receive_total_batches}
                  sub="recebimentos em lote" status="neutral" />
              </div>
            </Panel>
          </div>

          {/* ── Row 4: Performance + DB ───────────────────────────────────────── */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">

            {/* Frontend performance */}
            <Panel title="Performance Frontend / API" icon={Wifi}>
              <div className="grid grid-cols-2 gap-2 mb-3">
                <MetricCell
                  label="Carregamento da página"
                  value={perf.navLoadMs != null ? `${perf.navLoadMs}ms` : '—'}
                  sub={perf.navLoadMs != null ? ms2s(perf.navLoadMs) : undefined}
                  status={perf.navLoadMs != null ? (perf.navLoadMs < 1500 ? 'ok' : perf.navLoadMs < 3000 ? 'warn' : 'crit') : 'neutral'}
                  large />
                <MetricCell
                  label="Latência it-metrics"
                  value={perf.apiLatencyMs != null ? `${perf.apiLatencyMs}ms` : '—'}
                  sub={perf.apiLatencyMs != null ? ms2s(perf.apiLatencyMs) : undefined}
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
                      <span className={`text-[11px] font-bold ${r.ms < 800 ? 'text-green-700' : r.ms < 2000 ? 'text-amber-700' : 'text-red-700'}`}>
                        {ms2s(r.ms)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              <p className="text-[9px] text-gray-400 mt-2">TX = Transmit — dados enviados servidor→cliente. Limiares: &lt;800ms ✓ · 800-2000ms ⚠ · &gt;2000ms ✗</p>
            </Panel>

            {/* DB health */}
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
              <div className="flex flex-col gap-1.5">
                {data.database.tables.slice(0, 6).map(t => {
                  const pct = data.database.total_mb > 0 ? Math.min(100, (t.mb / data.database.total_mb) * 100) : 0
                  return (
                    <div key={t.name} className="flex items-center gap-2">
                      <span className="text-[11px] font-mono text-gray-500 w-28 truncate shrink-0">{t.name}</span>
                      <div className="flex-1 bg-gray-100 rounded-full h-1.5">
                        <div className="h-1.5 rounded-full bg-[#26619c]/60" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="text-[11px] text-gray-500 w-12 text-right shrink-0">{t.mb}MB</span>
                      <span className="text-[10px] text-gray-400 w-16 text-right shrink-0">{t.rows.toLocaleString('pt-BR')}r</span>
                    </div>
                  )
                })}
              </div>
            </Panel>
          </div>

          {/* ── Sparklines mini footer ────────────────────────────────────────── */}
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: 'Transações', data: data.activity.transactions_7d, color: '#26619c' },
              { label: 'Logins', data: data.activity.logins_7d, color: '#7c3aed' },
              { label: 'Caixas', data: data.activity.sessions_7d, color: '#0891b2' },
            ].map(s => (
              <div key={s.label} className="bg-white border border-gray-100 rounded-xl px-3 pt-2 pb-1">
                <p className="text-[10px] font-medium text-gray-500 mb-1">{s.label} — tendência {period}d</p>
                <Sparkline data={s.data} days={Math.min(period, 30)} color={s.color} />
              </div>
            ))}
          </div>

        </div>
      )}

      {/* ── Footer ───────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between text-[10px] text-gray-300 px-1 mt-1">
        <span className="flex items-center gap-1.5">
          <Server className="w-3 h-3" />
          Vercel Serverless · Neon PostgreSQL · auto-refresh 60s
        </span>
        <span className="flex items-center gap-1.5">
          <TrendingUp className="w-3 h-3" />
          {lastUpdate ? `Última atualização: ${lastUpdate.toLocaleTimeString('pt-BR')}` : '—'}
        </span>
      </div>
    </div>
  )
}
