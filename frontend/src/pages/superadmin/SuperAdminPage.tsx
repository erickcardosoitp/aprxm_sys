import { useEffect, useRef, useState } from 'react'
import { Activity, AlertTriangle, Building2, CheckCircle2, Clock, Database, Monitor, Package, RefreshCw, Server, TrendingUp, Users, Wifi, Zap } from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../../services/api'

interface OrgSummary {
  id: string; name: string; slug: string; plan_name: string
  is_active: boolean; plan_expires_at: string | null
  created_at: string; user_count: number; resident_count: number
  open_packages: number; last_login_at: string | null
}
interface OrgUser { id: string; full_name: string; email: string; role: string; is_active: boolean; last_login_at: string | null }
interface ActiveSession { id: string; opened_at: string; opening_balance: number; opened_by_name: string; opened_by_email: string; association_name: string; slug: string }
interface HealthSummary { active_orgs: number; active_users: number; total_residents: number; pending_packages: number; tx_last_24h: number; open_sessions: number; pending_mensalidades: number }

const ROLE_LABELS: Record<string, string> = {
  superadmin: 'SuperAdmin', admin_master: 'Admin Master', admin: 'Admin', conferente: 'Conferente',
  diretoria: 'Diretoria', diretoria_adjunta: 'Dir. Adjunta', operator: 'Operador', viewer: 'Visualizador',
}

// ── IT Metrics Tab ────────────────────────────────────────────────────────────
interface ITMetrics {
  database: { total_mb: number; tables: { name: string; mb: number; rows: number }[] }
  package_sla: { total_delivered: number; avg_hours_to_deliver: number | null; delivered_within_48h: number; pct_within_48h: number; overdue_packages: number; pending_packages: number; overdue_notified: number }
  activity: { transactions_7d: { day: string; count: number }[]; logins_7d: { day: string; count: number }[]; sessions_7d: { day: string; count: number }[] }
  audit: { total_actions_24h: number; reversals_24h: number }
  top_orgs_30d: { name: string; tx_count: number; active_days: number }[]
}

function ITMetricsTab() {
  const [data, setData] = useState<ITMetrics | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null)
  const [perfMetrics, setPerfMetrics] = useState<{ loadTime: number | null; apiTimes: { name: string; duration: number }[] }>({ loadTime: null, apiTimes: [] })
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const load = async () => {
    setError(false)
    try {
      const res = await api.get<ITMetrics>('/superadmin/it-metrics')
      setData(res.data)
      setLastUpdate(new Date())
    } catch {
      setError(true)
      toast.error('Erro ao carregar métricas TI')
    } finally { setLoading(false) }
  }

  useEffect(() => {
    load()
    intervalRef.current = setInterval(load, 60000)
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [])

  useEffect(() => {
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined
    const loadTime = nav ? Math.round(nav.loadEventEnd - nav.startTime) : null
    const resources = performance.getEntriesByType('resource') as PerformanceResourceTiming[]
    const apiTimes = resources
      .filter(r => r.name.includes('/api/'))
      .slice(-10)
      .map(r => ({ name: r.name.split('/api/v1/')[1]?.split('?')[0] ?? r.name, duration: Math.round(r.duration) }))
      .reverse()
    setPerfMetrics({ loadTime, apiTimes })
  }, [])

  if (loading) return <div className="p-12 text-center text-gray-400 text-sm">Carregando métricas…</div>
  if (error || !data) return (
    <div className="p-12 text-center flex flex-col items-center gap-3">
      <AlertTriangle className="w-8 h-8 text-red-400" />
      <p className="text-sm text-gray-500">Erro ao carregar métricas.</p>
      <button onClick={load} className="text-sm border border-gray-200 px-4 py-2 rounded-lg hover:bg-gray-50">Tentar novamente</button>
    </div>
  )

  const { database, package_sla, activity, audit, top_orgs_30d } = data
  const maxTx = Math.max(...activity.transactions_7d.map(d => d.count), 1)
  const slaColor = package_sla.pct_within_48h >= 90 ? 'text-green-600' : package_sla.pct_within_48h >= 70 ? 'text-amber-600' : 'text-red-600'
  const slaBar = package_sla.pct_within_48h >= 90 ? 'bg-green-500' : package_sla.pct_within_48h >= 70 ? 'bg-amber-500' : 'bg-red-500'

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
          <span className="text-xs text-gray-400">Auto-refresh a cada 60s</span>
        </div>
        <div className="flex items-center gap-2">
          {lastUpdate && <span className="text-xs text-gray-400">Atualizado: {lastUpdate.toLocaleTimeString('pt-BR')}</span>}
          <button onClick={load} className="text-xs border border-gray-200 text-gray-500 px-2.5 py-1 rounded-lg hover:bg-gray-50 flex items-center gap-1">
            <RefreshCw className="w-3 h-3" /> Atualizar
          </button>
        </div>
      </div>

      {/* SLA + DB */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
          <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3 flex items-center gap-2">
            <Package className="w-4 h-4 text-[#26619c]" /> SLA de Encomendas
          </p>
          <div className="grid grid-cols-2 gap-3 mb-4">
            <div>
              <p className="text-xs text-gray-400">% entregues em ≤48h</p>
              <p className={`text-3xl font-black ${slaColor}`}>{package_sla.pct_within_48h}%</p>
              <div className="w-full bg-gray-100 rounded-full h-2 mt-1">
                <div className={`${slaBar} h-2 rounded-full transition-all`} style={{ width: `${package_sla.pct_within_48h}%` }} />
              </div>
            </div>
            <div>
              <p className="text-xs text-gray-400">Tempo médio de entrega</p>
              <p className="text-2xl font-bold text-gray-800">
                {package_sla.avg_hours_to_deliver != null ? `${package_sla.avg_hours_to_deliver}h` : '—'}
              </p>
              <p className="text-xs text-gray-400">meta: ≤ 48h</p>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="bg-gray-50 rounded-lg p-2">
              <p className="text-[10px] text-gray-400">Total entregues</p>
              <p className="text-base font-bold text-gray-700">{package_sla.total_delivered}</p>
            </div>
            <div className={`rounded-lg p-2 ${package_sla.overdue_packages > 0 ? 'bg-red-50' : 'bg-gray-50'}`}>
              <p className="text-[10px] text-gray-400">Pendentes +48h</p>
              <p className={`text-base font-bold ${package_sla.overdue_packages > 0 ? 'text-red-600' : 'text-gray-700'}`}>{package_sla.overdue_packages}</p>
            </div>
            <div className={`rounded-lg p-2 ${package_sla.overdue_notified > 0 ? 'bg-amber-50' : 'bg-gray-50'}`}>
              <p className="text-[10px] text-gray-400">Avisados +72h</p>
              <p className={`text-base font-bold ${package_sla.overdue_notified > 0 ? 'text-amber-600' : 'text-gray-700'}`}>{package_sla.overdue_notified}</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
          <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3 flex items-center gap-2">
            <Database className="w-4 h-4 text-[#26619c]" /> Armazenamento — Banco de Dados
          </p>
          <div className="flex items-end gap-2 mb-3">
            <p className="text-3xl font-black text-gray-800">{database.total_mb}</p>
            <p className="text-gray-400 text-sm mb-1">MB usados</p>
          </div>
          <div className="flex flex-col gap-1.5 max-h-48 overflow-y-auto">
            {database.tables.map(t => {
              const pct = database.total_mb > 0 ? Math.min(100, (t.mb / database.total_mb) * 100) : 0
              return (
                <div key={t.name}>
                  <div className="flex items-center justify-between text-xs mb-0.5">
                    <span className="text-gray-600 font-mono truncate max-w-[140px]">{t.name}</span>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-gray-400">{t.rows.toLocaleString('pt-BR')} rows</span>
                      <span className="text-gray-700 font-medium w-14 text-right">{t.mb} MB</span>
                    </div>
                  </div>
                  <div className="w-full bg-gray-100 rounded-full h-1.5">
                    <div className="bg-[#26619c]/60 h-1.5 rounded-full" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* Activity chart */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
        <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-4 flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-[#26619c]" /> Transações — Últimos 7 dias
        </p>
        {activity.transactions_7d.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-4">Sem dados de atividade.</p>
        ) : (
          <div className="flex items-end gap-2 h-32">
            {(() => {
              const days: Record<string, number> = {}
              for (let i = 6; i >= 0; i--) {
                const d = new Date(); d.setDate(d.getDate() - i)
                days[d.toISOString().slice(0, 10)] = 0
              }
              activity.transactions_7d.forEach(d => { days[d.day] = d.count })
              return Object.entries(days).map(([day, count]) => {
                const pct = maxTx > 0 ? (count / maxTx) * 100 : 0
                const label = new Date(day + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit' })
                return (
                  <div key={day} className="flex-1 flex flex-col items-center gap-1 h-full justify-end">
                    <span className="text-[10px] text-gray-500 font-medium">{count || ''}</span>
                    <div className="w-full rounded-t-md bg-[#26619c]/20 relative" style={{ height: '80%' }}>
                      <div className="absolute bottom-0 left-0 right-0 rounded-t-md bg-[#26619c] transition-all" style={{ height: `${pct}%` }} />
                    </div>
                    <span className="text-[10px] text-gray-400 text-center leading-tight">{label}</span>
                  </div>
                )
              })
            })()}
          </div>
        )}
      </div>

      {/* Frontend perf + Audit + Top orgs */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
          <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3 flex items-center gap-2">
            <Zap className="w-4 h-4 text-amber-500" /> Performance Frontend
          </p>
          <div className="flex flex-col gap-2">
            <div className="flex justify-between items-center">
              <span className="text-xs text-gray-500">Tempo de carregamento</span>
              <span className={`text-sm font-bold ${perfMetrics.loadTime == null ? 'text-gray-400' : perfMetrics.loadTime < 2000 ? 'text-green-600' : perfMetrics.loadTime < 4000 ? 'text-amber-600' : 'text-red-600'}`}>
                {perfMetrics.loadTime != null ? `${perfMetrics.loadTime}ms (${(perfMetrics.loadTime / 1000).toFixed(2)}s)` : '—'}
              </span>
            </div>
            <div className="border-t border-gray-100 pt-2">
              <p className="text-[10px] text-gray-400 mb-1.5 uppercase font-medium">Últimas chamadas de API</p>
              {perfMetrics.apiTimes.length === 0 ? (
                <p className="text-xs text-gray-300">Sem dados disponíveis</p>
              ) : (
                <div className="flex flex-col gap-1">
                  {perfMetrics.apiTimes.slice(0, 6).map((a, i) => (
                    <div key={i} className="flex justify-between items-center">
                      <span className="text-[10px] text-gray-500 truncate max-w-[120px] font-mono">{a.name}</span>
                      <span className={`text-[10px] font-bold shrink-0 ml-1 ${a.duration < 300 ? 'text-green-600' : a.duration < 1000 ? 'text-amber-600' : 'text-red-600'}`}>
                        {a.duration}ms
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
          <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3 flex items-center gap-2">
            <Server className="w-4 h-4 text-purple-500" /> Auditoria — 24h
          </p>
          <div className="flex flex-col gap-3">
            <div className="flex justify-between items-center py-2 border-b border-gray-100">
              <span className="text-sm text-gray-600">Ações registradas</span>
              <span className="text-xl font-bold text-gray-800">{audit.total_actions_24h}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-600">Estornos / Cancelamentos</span>
              <span className={`text-xl font-bold ${audit.reversals_24h > 5 ? 'text-red-600' : 'text-gray-800'}`}>{audit.reversals_24h}</span>
            </div>
            <div className="mt-2 pt-2 border-t border-gray-100">
              <p className="text-xs font-bold text-gray-500 mb-2 uppercase">Alertas</p>
              {package_sla.overdue_packages === 0 && audit.reversals_24h <= 5 ? (
                <div className="flex items-center gap-1.5 text-green-600 text-xs">
                  <CheckCircle2 className="w-4 h-4" /> Sistema operando normalmente
                </div>
              ) : (
                <div className="flex flex-col gap-1.5">
                  {package_sla.overdue_packages > 0 && (
                    <div className="flex items-center gap-1.5 text-red-600 text-xs">
                      <AlertTriangle className="w-3.5 h-3.5" /> {package_sla.overdue_packages} enc. pendentes há +48h
                    </div>
                  )}
                  {audit.reversals_24h > 5 && (
                    <div className="flex items-center gap-1.5 text-amber-600 text-xs">
                      <AlertTriangle className="w-3.5 h-3.5" /> {audit.reversals_24h} estornos nas últimas 24h
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
          <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3 flex items-center gap-2">
            <Wifi className="w-4 h-4 text-green-500" /> Top Orgs — 30 dias
          </p>
          {top_orgs_30d.length === 0 ? (
            <p className="text-xs text-gray-400">Sem dados</p>
          ) : (
            <div className="flex flex-col gap-2">
              {top_orgs_30d.map((org, i) => {
                const maxCount = top_orgs_30d[0].tx_count
                const pct = maxCount > 0 ? (org.tx_count / maxCount) * 100 : 0
                return (
                  <div key={org.name}>
                    <div className="flex justify-between text-xs mb-0.5">
                      <span className="text-gray-700 font-medium truncate max-w-[120px]">
                        <span className="text-gray-400 mr-1">#{i + 1}</span>{org.name}
                      </span>
                      <span className="text-gray-500 shrink-0">{org.tx_count} TX · {org.active_days}d</span>
                    </div>
                    <div className="w-full bg-gray-100 rounded-full h-1.5">
                      <div className="bg-green-500 h-1.5 rounded-full" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* Sessions + Logins */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
        <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3 flex items-center gap-2">
          <Clock className="w-4 h-4 text-blue-500" /> Sessões de Caixa e Logins — 7 dias
        </p>
        <div className="grid grid-cols-2 gap-4">
          {[
            { label: 'Sessões de caixa abertas', data: activity.sessions_7d, color: 'bg-blue-500' },
            { label: 'Logins de usuários', data: activity.logins_7d, color: 'bg-purple-500' },
          ].map(({ label, data: chartData, color }) => {
            const max = Math.max(...chartData.map(d => d.count), 1)
            return (
              <div key={label}>
                <p className="text-xs text-gray-500 mb-2">{label}</p>
                <div className="flex items-end gap-1.5 h-16">
                  {(() => {
                    const days: Record<string, number> = {}
                    for (let i = 6; i >= 0; i--) {
                      const d = new Date(); d.setDate(d.getDate() - i)
                      days[d.toISOString().slice(0, 10)] = 0
                    }
                    chartData.forEach(d => { days[d.day] = (days[d.day] ?? 0) + d.count })
                    return Object.entries(days).map(([day, count]) => (
                      <div key={day} className="flex-1 flex flex-col items-center gap-0.5 h-full justify-end">
                        <div className="w-full rounded-t-sm bg-gray-100 relative" style={{ height: '100%' }}>
                          <div className={`absolute bottom-0 left-0 right-0 rounded-t-sm ${color} transition-all`} style={{ height: `${max > 0 ? (count / max) * 100 : 0}%` }} />
                        </div>
                        <span className="text-[9px] text-gray-300">{new Date(day + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit' })}</span>
                      </div>
                    ))
                  })()}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ── Orgs Tab ──────────────────────────────────────────────────────────────────
function OrgsTab() {
  const [orgs, setOrgs] = useState<OrgSummary[]>([])
  const [health, setHealth] = useState<HealthSummary | null>(null)
  const [activeSessions, setActiveSessions] = useState<ActiveSession[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [orgUsers, setOrgUsers] = useState<Record<string, OrgUser[]>>({})
  const [loadingUsers, setLoadingUsers] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [filterPlan, setFilterPlan] = useState('')
  const [filterStatus, setFilterStatus] = useState('')

  const load = async () => {
    setLoading(true)
    try {
      const [orgsRes, healthRes, sessionsRes] = await Promise.all([
        api.get<OrgSummary[]>('/superadmin/organizations'),
        api.get<HealthSummary>('/superadmin/health-summary'),
        api.get<ActiveSession[]>('/superadmin/active-sessions'),
      ])
      setOrgs(orgsRes.data)
      setHealth(healthRes.data)
      setActiveSessions(sessionsRes.data)
    } catch { toast.error('Erro ao carregar dados.') }
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  const toggleOrg = async (slug: string) => {
    if (expanded === slug) { setExpanded(null); return }
    setExpanded(slug)
    if (orgUsers[slug]) return
    setLoadingUsers(slug)
    try {
      const res = await api.get<OrgUser[]>(`/superadmin/organizations/${slug}/users`)
      setOrgUsers(prev => ({ ...prev, [slug]: res.data }))
    } catch { toast.error('Erro ao carregar usuários.') }
    finally { setLoadingUsers(null) }
  }

  const fmtDate = (s: string | null) => s
    ? new Date(s).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })
    : '—'

  return (
    <div className="flex flex-col gap-5">
      <div className="flex justify-end">
        <button onClick={load} className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 border border-gray-200 px-3 py-1.5 rounded-lg">
          <RefreshCw className="w-4 h-4" /> Atualizar
        </button>
      </div>

      {/* Health KPIs */}
      {health && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Orgs ativas', value: health.active_orgs, color: 'blue' },
            { label: 'Usuários ativos', value: health.active_users, color: 'green' },
            { label: 'Caixas abertos', value: health.open_sessions, color: health.open_sessions > 0 ? 'amber' : 'gray' },
            { label: 'TX 24h', value: health.tx_last_24h, color: 'purple' },
            { label: 'Moradores', value: health.total_residents, color: 'gray' },
            { label: 'Enc. pendentes', value: health.pending_packages, color: health.pending_packages > 10 ? 'red' : 'gray' },
            { label: 'Mensalidades pendentes', value: health.pending_mensalidades, color: health.pending_mensalidades > 20 ? 'red' : 'amber' },
          ].map(({ label, value, color }) => (
            <div key={label} className={`rounded-xl p-3 border ${
              color === 'blue' ? 'bg-blue-50 border-blue-100' : color === 'green' ? 'bg-green-50 border-green-100' :
              color === 'amber' ? 'bg-amber-50 border-amber-100' : color === 'red' ? 'bg-red-50 border-red-100' :
              color === 'purple' ? 'bg-purple-50 border-purple-100' : 'bg-gray-50 border-gray-100'
            }`}>
              <p className="text-xs text-gray-500">{label}</p>
              <p className={`text-2xl font-bold mt-0.5 ${
                color === 'blue' ? 'text-blue-700' : color === 'green' ? 'text-green-700' :
                color === 'amber' ? 'text-amber-700' : color === 'red' ? 'text-red-700' :
                color === 'purple' ? 'text-purple-700' : 'text-gray-700'
              }`}>{value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Active cash sessions */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
          <h2 className="font-semibold text-gray-800 text-sm flex items-center gap-2">
            <Monitor className="w-4 h-4 text-amber-500" />
            Caixas abertos agora
            {activeSessions.length > 0 && <span className="ml-1 bg-amber-100 text-amber-700 text-xs px-2 py-0.5 rounded-full font-medium">{activeSessions.length}</span>}
          </h2>
        </div>
        {loading ? <div className="p-6 text-center text-gray-400 text-sm">Carregando…</div>
          : activeSessions.length === 0 ? <div className="p-6 text-center text-gray-400 text-sm">Nenhum caixa aberto.</div>
          : (
            <table className="w-full text-xs">
              <thead className="bg-gray-50">
                <tr className="text-gray-400">
                  <th className="text-left px-4 py-2 font-medium">Organização</th>
                  <th className="text-left px-4 py-2 font-medium">Aberto por</th>
                  <th className="text-left px-4 py-2 font-medium">Abertura</th>
                  <th className="text-right px-4 py-2 font-medium">Saldo inicial</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {activeSessions.map(s => (
                  <tr key={s.id} className="hover:bg-gray-50">
                    <td className="px-4 py-2.5 font-medium text-gray-800">{s.association_name}</td>
                    <td className="px-4 py-2.5 text-gray-600"><div>{s.opened_by_name}</div><div className="text-gray-400">{s.opened_by_email}</div></td>
                    <td className="px-4 py-2.5 text-gray-500">{fmtDate(s.opened_at)}</td>
                    <td className="px-4 py-2.5 text-right text-gray-700 font-medium">R$ {s.opening_balance.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
      </div>

      {/* Organizations list */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 flex flex-wrap items-center gap-2">
          <h2 className="font-semibold text-gray-800 text-sm flex items-center gap-2 mr-2">
            <Building2 className="w-4 h-4 text-gray-400" /> Organizações
          </h2>
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Buscar por nome ou slug…"
            className="border border-gray-200 rounded-lg px-2.5 py-1 text-xs flex-1 min-w-[160px] focus:outline-none focus:ring-1 focus:ring-[#26619c]/30"
          />
          <select value={filterPlan} onChange={e => setFilterPlan(e.target.value)}
            className="border border-gray-200 rounded-lg px-2 py-1 text-xs focus:outline-none">
            <option value="">Todos os planos</option>
            <option value="basic">basic</option>
            <option value="pro">pro</option>
            <option value="aggregator">aggregator</option>
          </select>
          <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
            className="border border-gray-200 rounded-lg px-2 py-1 text-xs focus:outline-none">
            <option value="">Todas</option>
            <option value="active">Ativas</option>
            <option value="inactive">Inativas</option>
          </select>
        </div>
        {loading ? <div className="p-8 text-center text-gray-400 text-sm">Carregando…</div> : (
          <ul className="divide-y divide-gray-100">
            {orgs.filter(org => {
              const q = search.toLowerCase()
              if (q && !org.name.toLowerCase().includes(q) && !org.slug.toLowerCase().includes(q)) return false
              if (filterPlan && org.plan_name !== filterPlan) return false
              if (filterStatus === 'active' && !org.is_active) return false
              if (filterStatus === 'inactive' && org.is_active) return false
              return true
            }).map(org => (
              <li key={org.id}>
                <button onClick={() => toggleOrg(org.slug)} className="w-full flex items-center justify-between px-4 py-3.5 hover:bg-gray-50 text-left">
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <div className={`w-2 h-2 rounded-full shrink-0 ${org.is_active ? 'bg-green-500' : 'bg-gray-300'}`} />
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-gray-800 truncate">{org.name}</p>
                      <div className="flex items-center gap-3 mt-0.5 text-xs text-gray-400 flex-wrap">
                        <span className="font-mono text-gray-300">/{org.slug}</span>
                        <span className="flex items-center gap-1"><Users className="w-3 h-3" />{org.user_count} usuários</span>
                        <span className="flex items-center gap-1"><Building2 className="w-3 h-3" />{org.resident_count} mor.</span>
                        <span className="flex items-center gap-1"><Package className="w-3 h-3" />{org.open_packages} enc. abertas</span>
                        <span>Último login: {fmtDate(org.last_login_at)}</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0 ml-2">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                      org.plan_name === 'aggregator' ? 'bg-purple-100 text-purple-700' :
                      org.plan_name === 'pro' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'
                    }`}>{org.plan_name}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${org.is_active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>
                      {org.is_active ? 'Ativa' : 'Inativa'}
                    </span>
                  </div>
                </button>

                {expanded === org.slug && (
                  <div className="border-t border-gray-100 bg-gray-50 px-4 py-3">
                    <p className="text-xs font-medium text-gray-600 mb-2">Usuários</p>
                    {loadingUsers === org.slug ? <p className="text-xs text-gray-400">Carregando…</p> : (
                      <table className="w-full text-xs">
                        <thead><tr className="text-gray-400">
                          <th className="text-left py-1 font-medium">Nome</th>
                          <th className="text-left py-1 font-medium">E-mail</th>
                          <th className="text-left py-1 font-medium">Papel</th>
                          <th className="text-left py-1 font-medium">Último login</th>
                          <th className="text-center py-1 font-medium">Ativo</th>
                        </tr></thead>
                        <tbody className="divide-y divide-gray-200">
                          {(orgUsers[org.slug] ?? []).map(u => (
                            <tr key={u.id}>
                              <td className="py-1.5 pr-3 text-gray-800 font-medium">{u.full_name}</td>
                              <td className="py-1.5 pr-3 text-gray-500">{u.email}</td>
                              <td className="py-1.5 pr-3">
                                <span className="px-1.5 py-0.5 bg-blue-50 text-blue-700 rounded text-[10px] font-medium">{ROLE_LABELS[u.role] ?? u.role}</span>
                              </td>
                              <td className="py-1.5 pr-3 text-gray-400">{fmtDate(u.last_login_at)}</td>
                              <td className="py-1.5 text-center"><span className={`inline-block w-2 h-2 rounded-full ${u.is_active ? 'bg-green-500' : 'bg-red-400'}`} /></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function SuperAdminPage() {
  const [tab, setTab] = useState<'orgs' | 'ti'>('orgs')

  return (
    <div className="flex flex-col gap-5 p-4 sm:p-6 max-w-screen-xl mx-auto w-full">
      <div className="flex items-center gap-3">
        <Activity className="w-5 h-5 text-[#26619c]" />
        <h1 className="text-xl font-bold text-gray-900">Monitoramento — SuperAdmin</h1>
      </div>

      <div className="flex gap-2 bg-gray-100 rounded-xl p-1 self-start">
        {([['orgs', 'Organizações'], ['ti', 'Métricas TI']] as const).map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition ${tab === key ? 'bg-white text-[#26619c] shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'orgs' && <OrgsTab />}
      {tab === 'ti' && <ITMetricsTab />}

      <p className="text-xs text-gray-400 text-center">Painel de Monitoramento · APRXM</p>
    </div>
  )
}
