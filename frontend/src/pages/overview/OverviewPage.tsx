import React, { useEffect, useRef, useState } from 'react'
import 'leaflet/dist/leaflet.css'
import { Users, Package, Wrench, Wallet, BarChart2, RefreshCw, Home, Wifi, Droplets, Bus, Bug, GraduationCap, UserCircle2, MapPin, CheckCircle2, TrendingUp, TrendingDown, DollarSign, AlertCircle } from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, LabelList,
} from 'recharts'
import api from '../../services/api'
import { useAuthStore } from '../../store/authStore'
import type { Resident, Package as Pkg, ServiceOrder, CashSession } from '../../types'

// ── Types ─────────────────────────────────────────────────────────────────────

interface KpiData {
  activeAssociados: number
  dependentes: number
  visitantes: number
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
  street_distribution: { street: string; count: number }[]
  completion_distribution: { critical: number; improving: number; regular: number; excellent: number }
}

interface SensoFilters {
  cep_prefix: string
  age_min: string
  age_max: string
  has_internet: string
  has_sewage: string
  has_pests: string
  uses_transport: string
  completion_pct_min: string
  hide_blank: boolean
}

const EMPTY_FILTERS: SensoFilters = {
  cep_prefix: '', age_min: '', age_max: '',
  has_internet: '', has_sewage: '', has_pests: '', uses_transport: '',
  completion_pct_min: '', hide_blank: false,
}

const PIE_COLORS = ['#3b82f6', '#8b5cf6', '#06b6d4', '#10b981', '#f59e0b', '#ef4444']

// ── Helpers ───────────────────────────────────────────────────────────────────

function InfraRow({ icon, label, pct, color, bg }: { icon: React.ReactNode; label: string; pct: number; color: string; bg: string }) {
  return (
    <div className={`flex items-center gap-3 rounded-xl px-3 py-2.5 ${bg}`}>
      <div className="shrink-0">{icon}</div>
      <div className="flex-1 min-w-0">
        <div className="flex justify-between items-center mb-1">
          <span className="text-xs font-medium text-gray-700">{label}</span>
          <span className="text-xs font-bold" style={{ color }}>{pct}%</span>
        </div>
        <div className="h-1.5 bg-white/60 rounded-full overflow-hidden">
          <div className="h-1.5 rounded-full transition-all duration-500" style={{ width: `${pct}%`, backgroundColor: color }} />
        </div>
      </div>
    </div>
  )
}

function SectionCard({ icon, title, accent, children }: { icon: React.ReactNode; title: string; accent: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      <div className={`flex items-center gap-2.5 px-4 py-3 border-b border-gray-100 ${accent}`}>
        {icon}
        <h3 className="text-sm font-semibold text-gray-800">{title}</h3>
      </div>
      <div className="p-4">{children}</div>
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
      if (filters.completion_pct_min !== '') params.completion_pct_min = filters.completion_pct_min
      if (filters.hide_blank) params.hide_blank = 'true'
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
  const inputCls = 'border border-gray-200 rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-[#26619c]/30 focus:border-[#26619c] bg-gray-50'
  const selectCls = `${inputCls}`

  const activeFilters = Object.values(filters).filter(Boolean).length

  return (
    <div className="flex flex-col gap-4">

      {/* ── Filter panel ── */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-gradient-to-r from-[#1a3f6f]/5 to-transparent">
          <div className="flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-[#26619c]" />
            <span className="text-sm font-semibold text-gray-800">Filtros</span>
            {activeFilters > 0 && (
              <span className="text-xs bg-[#26619c] text-white rounded-full px-1.5 py-0.5 font-bold">{activeFilters}</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setFilters(EMPTY_FILTERS)}
              className="text-xs text-gray-400 hover:text-gray-600 transition">Limpar</button>
            <button onClick={load} disabled={loading}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-[#26619c] text-white rounded-lg text-xs font-semibold hover:bg-[#1a4f87] transition disabled:opacity-50">
              <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
              Aplicar
            </button>
          </div>
        </div>
        <div className="p-4 grid grid-cols-2 md:grid-cols-4 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1.5">CEP</label>
            <input value={filters.cep_prefix} onChange={e => set('cep_prefix', e.target.value)}
              className={inputCls + ' w-full'} placeholder="Ex: 22000" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1.5">Idade mín.</label>
            <input type="number" value={filters.age_min} onChange={e => set('age_min', e.target.value)}
              className={inputCls + ' w-full'} placeholder="0" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1.5">Idade máx.</label>
            <input type="number" value={filters.age_max} onChange={e => set('age_max', e.target.value)}
              className={inputCls + ' w-full'} placeholder="100" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1.5">Internet</label>
            <select value={filters.has_internet} onChange={e => set('has_internet', e.target.value)} className={selectCls + ' w-full'}>
              <option value="">Todos</option>
              <option value="true">Com internet</option>
              <option value="false">Sem internet</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1.5">Esgoto</label>
            <select value={filters.has_sewage} onChange={e => set('has_sewage', e.target.value)} className={selectCls + ' w-full'}>
              <option value="">Todos</option>
              <option value="true">Com esgoto</option>
              <option value="false">Sem esgoto</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1.5">Vetores</label>
            <select value={filters.has_pests} onChange={e => set('has_pests', e.target.value)} className={selectCls + ' w-full'}>
              <option value="">Todos</option>
              <option value="true">Com vetores</option>
              <option value="false">Sem vetores</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1.5">Transporte</label>
            <select value={filters.uses_transport} onChange={e => set('uses_transport', e.target.value)} className={selectCls + ' w-full'}>
              <option value="">Todos</option>
              <option value="true">Usa transporte</option>
              <option value="false">Não usa</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1.5">Completude mín.</label>
            <select value={filters.completion_pct_min} onChange={e => set('completion_pct_min', e.target.value)} className={selectCls + ' w-full'}>
              <option value="">Todos</option>
              <option value="60">≥ 60% (Regular)</option>
              <option value="80">≥ 80% (Excelente)</option>
              <option value="21">≥ 21% (A melhorar+)</option>
            </select>
          </div>
          <div className="col-span-2 md:col-span-4 flex items-center gap-2 pt-1">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input type="checkbox" checked={filters.hide_blank}
                onChange={e => setFilters(f => ({ ...f, hide_blank: e.target.checked }))}
                className="w-4 h-4 accent-[#26619c]" />
              <span className="text-xs font-medium text-gray-600">Ocultar dados em branco (usar denominadores reais por campo)</span>
            </label>
          </div>
        </div>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-16 gap-3">
          <RefreshCw className="w-5 h-5 text-[#26619c] animate-spin" />
          <span className="text-sm text-gray-400">Carregando análise…</span>
        </div>
      )}

      {data && !loading && (
        <>
          {/* ── KPI row ── */}
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-2xl p-4 text-white bg-gradient-to-br from-[#1a3f6f] to-[#26619c] flex flex-col gap-1">
              <Users className="w-5 h-5 text-white/70" />
              <p className="text-3xl font-extrabold">{data.total}</p>
              <p className="text-xs text-white/80 font-medium">Associados no filtro</p>
            </div>
            <div className="rounded-2xl p-4 text-white bg-gradient-to-br from-emerald-500 to-emerald-600 flex flex-col gap-1">
              <Home className="w-5 h-5 text-white/70" />
              <p className="text-3xl font-extrabold">{data.avg_household}</p>
              <p className="text-xs text-white/80 font-medium">Pessoas/domicílio</p>
            </div>
            <div className="rounded-2xl p-4 text-white bg-gradient-to-br from-sky-400 to-sky-600 flex flex-col gap-1">
              <Wifi className="w-5 h-5 text-white/70" />
              <p className="text-3xl font-extrabold">{data.infrastructure.internet_pct}%</p>
              <p className="text-xs text-white/80 font-medium">Acesso à internet</p>
            </div>
            <div className="rounded-2xl p-4 text-white bg-gradient-to-br from-red-500 to-red-600 flex flex-col gap-1">
              <Bug className="w-5 h-5 text-white/70" />
              <p className="text-3xl font-extrabold">{data.infrastructure.pests_pct}%</p>
              <p className="text-xs text-white/80 font-medium">Incidência de vetores</p>
            </div>
          </div>

          {/* ── Completude de cadastro ── */}
          {(() => {
            const cd = data.completion_distribution
            const tot = Math.max(cd.critical + cd.improving + cd.regular + cd.excellent, 1)
            const tiers = [
              { key: 'excellent', label: 'Excelente', count: cd.excellent, color: '#10b981', bg: 'bg-emerald-500' },
              { key: 'regular', label: 'Regular', count: cd.regular, color: '#3b82f6', bg: 'bg-blue-500' },
              { key: 'improving', label: 'A melhorar', count: cd.improving, color: '#f59e0b', bg: 'bg-amber-500' },
              { key: 'critical', label: 'Crítico', count: cd.critical, color: '#ef4444', bg: 'bg-red-500' },
            ]
            return (
              <SectionCard
                icon={<CheckCircle2 className="w-4 h-4 text-emerald-600" />}
                title="Completude de Cadastro"
                accent="bg-emerald-50/50"
              >
                <div className="flex flex-col gap-3">
                  {/* Segmented bar */}
                  <div className="flex h-3 rounded-full overflow-hidden gap-0.5">
                    {tiers.map(t => (
                      <div key={t.key} className={`${t.bg} transition-all duration-500`}
                        style={{ width: `${(t.count / tot) * 100}%`, minWidth: t.count > 0 ? '4px' : '0' }}
                        title={`${t.label}: ${t.count}`} />
                    ))}
                  </div>
                  {/* Legend */}
                  <div className="grid grid-cols-2 gap-2">
                    {tiers.map(t => (
                      <div key={t.key} className="flex items-center gap-2 bg-gray-50 rounded-xl px-3 py-2">
                        <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: t.color }} />
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-gray-800">{t.count}</p>
                          <p className="text-xs text-gray-400 leading-tight">{t.label}</p>
                        </div>
                        <p className="ml-auto text-xs font-bold" style={{ color: t.color }}>
                          {tot > 0 ? Math.round((t.count / tot) * 100) : 0}%
                        </p>
                      </div>
                    ))}
                  </div>
                  <p className="text-xs text-gray-400 text-center">Crítico 0–20% · A melhorar 21–59% · Regular 60–79% · Excelente 80–100%</p>
                </div>
              </SectionCard>
            )
          })()}

          {/* ── Infraestrutura ── */}
          <SectionCard icon={<Home className="w-4 h-4 text-blue-600" />} title="Infraestrutura" accent="bg-blue-50/50">
            <div className="flex flex-col gap-2">
              <InfraRow icon={<Wifi className="w-3.5 h-3.5 text-sky-500" />} label="Internet" pct={data.infrastructure.internet_pct} color="#0ea5e9" bg="bg-sky-50" />
              <InfraRow icon={<Droplets className="w-3.5 h-3.5 text-emerald-500" />} label="Rede de esgoto" pct={data.infrastructure.sewage_pct} color="#10b981" bg="bg-emerald-50" />
              <InfraRow icon={<Bus className="w-3.5 h-3.5 text-amber-500" />} label="Transporte público" pct={data.infrastructure.transport_pct} color="#f59e0b" bg="bg-amber-50" />
              <InfraRow icon={<Bug className="w-3.5 h-3.5 text-red-500" />} label="Vetores" pct={data.infrastructure.pests_pct} color="#ef4444" bg="bg-red-50" />
            </div>
          </SectionCard>

          {/* ── Faixa etária + Escolaridade ── */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <SectionCard icon={<Users className="w-4 h-4 text-violet-600" />} title="Faixa Etária" accent="bg-violet-50/50">
              <ResponsiveContainer width="100%" height={170}>
                <BarChart data={data.age_distribution} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#6b7280' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: '#6b7280' }} axisLine={false} tickLine={false} allowDecimals={false} />
                  <Tooltip contentStyle={{ borderRadius: 12, border: 'none', boxShadow: '0 4px 16px rgba(0,0,0,0.1)', fontSize: 12 }} cursor={{ fill: '#f3f4f6' }} />
                  <Bar dataKey="count" radius={[6, 6, 0, 0]}>
                    {data.age_distribution.map((_, i) => (
                      <Cell key={i} fill={`hsl(${220 + i * 12}, 70%, ${55 + i * 4}%)`} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </SectionCard>

            <SectionCard icon={<GraduationCap className="w-4 h-4 text-indigo-600" />} title="Escolaridade" accent="bg-indigo-50/50">
              {data.education.length === 0 ? (
                <p className="text-xs text-gray-400 py-10 text-center">Sem dados</p>
              ) : (
                <ResponsiveContainer width="100%" height={170}>
                  <PieChart>
                    <Pie data={data.education} dataKey="count" nameKey="level" cx="50%" cy="50%"
                      outerRadius={70} innerRadius={28}
                      label={(p) => `${((p.percent ?? 0) * 100).toFixed(0)}%`}
                      labelLine={false}>
                      {data.education.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                    </Pie>
                    <Tooltip formatter={(v, n) => [v, n]} contentStyle={{ borderRadius: 12, border: 'none', boxShadow: '0 4px 16px rgba(0,0,0,0.1)', fontSize: 12 }} />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </SectionCard>
          </div>

          {/* ── Cor/Raça ── */}
          <SectionCard icon={<UserCircle2 className="w-4 h-4 text-rose-600" />} title="Cor / Raça" accent="bg-rose-50/50">
            {data.race.length === 0 ? (
              <p className="text-xs text-gray-400 py-8 text-center">Sem dados</p>
            ) : (
              <div className="flex flex-col gap-2">
                {data.race.map((item, i) => {
                  const pct = data.total > 0 ? Math.round(item.count / data.total * 100) : 0
                  return (
                    <div key={i} className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }} />
                      <span className="text-xs text-gray-600 flex-1 truncate">{item.race}</span>
                      <div className="flex items-center gap-2 w-32">
                        <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                          <div className="h-1.5 rounded-full" style={{ width: `${pct}%`, backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }} />
                        </div>
                        <span className="text-xs font-semibold text-gray-700 w-8 text-right">{pct}%</span>
                      </div>
                      <span className="text-xs text-gray-400 w-6 text-right">{item.count}</span>
                    </div>
                  )
                })}
              </div>
            )}
          </SectionCard>

          {/* ── Problemas da comunidade ── */}
          {data.neighborhood_problems.length > 0 && (
            <SectionCard icon={<MapPin className="w-4 h-4 text-orange-600" />} title="Problemas da Comunidade" accent="bg-orange-50/50">
              <ResponsiveContainer width="100%" height={Math.max(160, data.neighborhood_problems.length * 38)}>
                <BarChart data={data.neighborhood_problems} layout="vertical"
                  margin={{ top: 4, right: 48, left: 8, bottom: 0 }}>
                  <XAxis type="number" tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} allowDecimals={false} />
                  <YAxis type="category" dataKey="problem" width={155} tick={{ fontSize: 11, fill: '#4b5563' }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={{ borderRadius: 12, border: 'none', boxShadow: '0 4px 16px rgba(0,0,0,0.1)', fontSize: 12 }} cursor={{ fill: '#fff7ed' }} />
                  <Bar dataKey="count" radius={[0, 6, 6, 0]}>
                    {data.neighborhood_problems.map((_, i) => (
                      <Cell key={i} fill={`hsl(24, ${90 - i * 6}%, ${50 + i * 3}%)`} />
                    ))}
                    <LabelList dataKey="count" position="right" style={{ fontSize: 11, fontWeight: 700, fill: '#6b7280' }} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </SectionCard>
          )}

          {/* ── Logradouros ── */}
          {data.street_distribution.length > 0 && (
            <SectionCard icon={<MapPin className="w-4 h-4 text-teal-600" />} title="Associados por Logradouro" accent="bg-teal-50/50">
              <ResponsiveContainer width="100%" height={Math.max(160, data.street_distribution.length * 36)}>
                <BarChart data={data.street_distribution} layout="vertical"
                  margin={{ top: 4, right: 48, left: 8, bottom: 0 }}>
                  <XAxis type="number" tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} allowDecimals={false} />
                  <YAxis type="category" dataKey="street" width={180} tick={{ fontSize: 11, fill: '#4b5563' }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={{ borderRadius: 12, border: 'none', boxShadow: '0 4px 16px rgba(0,0,0,0.1)', fontSize: 12 }} cursor={{ fill: '#f0fdfa' }} />
                  <Bar dataKey="count" radius={[0, 6, 6, 0]} fill="#0d9488">
                    <LabelList dataKey="count" position="right" style={{ fontSize: 11, fontWeight: 700, fill: '#0d9488' }} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </SectionCard>
          )}
        </>
      )}
    </div>
  )
}

interface OrgOption { id: string; name: string; slug: string }
interface OrgKpi { associados: number; visitantes: number; enc_pendentes: number; os_abertas: number; mens_pendentes: number; mens_valor: number; receita_mes: number; despesa_mes: number; saldo_mes: number; caixa_aberto: boolean; name: string }

// ── Overview tab ──────────────────────────────────────────────────────────────

function OverviewTab() {
  const role = useAuthStore((s) => s.role)
  const isViewer = role === 'viewer'
  const isSuperAdmin = role === 'superadmin'

  const [kpi, setKpi] = useState<KpiData | null>(null)
  const [activity, setActivity] = useState<{ packages: Pkg[]; orders: ServiceOrder[] }>({ packages: [], orders: [] })
  const [loading, setLoading] = useState(true)
  const [papSummary, setPapSummary] = useState<any>(null)
  const [financeSummary, setFinanceSummary] = useState<any>(null)

  // Superadmin org selector
  const [orgs, setOrgs] = useState<OrgOption[]>([])
  const [selectedOrg, setSelectedOrg] = useState<string>('')
  const [orgKpi, setOrgKpi] = useState<OrgKpi | null>(null)
  const [loadingOrgKpi, setLoadingOrgKpi] = useState(false)

  useEffect(() => {
    if (isSuperAdmin) {
      api.get<OrgOption[]>('/superadmin/organizations').then(r => setOrgs(r.data)).catch(() => {})
    }
  }, [isSuperAdmin])

  useEffect(() => {
    if (!isSuperAdmin || !selectedOrg) { setOrgKpi(null); return }
    setLoadingOrgKpi(true)
    api.get<OrgKpi>(`/superadmin/organizations/${selectedOrg}/overview`)
      .then(r => setOrgKpi(r.data))
      .catch(() => setOrgKpi(null))
      .finally(() => setLoadingOrgKpi(false))
  }, [selectedOrg, isSuperAdmin])

  useEffect(() => {
    api.get('/porta-a-porta/summary').then(r => setPapSummary(r.data)).catch(() => {})
    api.get('/financeiro/summary').then(r => setFinanceSummary(r.data)).catch(() => {})
  }, [])

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
          activeAssociados: residents.filter((r) => r.type === 'member' && !r.responsible_id && r.status === 'active').length,
          dependentes: residents.filter((r) => r.type === 'member' && !!r.responsible_id && r.status === 'active').length,
          visitantes: residents.filter((r) => r.type === 'guest' && r.status === 'active').length,
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

  const fmt = (v: number) => `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

  return (
    <div className="flex flex-col gap-6">

      {/* Superadmin: org selector + org KPIs */}
      {isSuperAdmin && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-gray-500 shrink-0">Filtrar por organização:</label>
            <select value={selectedOrg} onChange={e => setSelectedOrg(e.target.value)}
              className="flex-1 max-w-xs border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#26619c]/30">
              <option value="">— Minha organização —</option>
              {orgs.map(o => <option key={o.slug} value={o.slug}>{o.name}</option>)}
            </select>
            {loadingOrgKpi && <span className="text-xs text-gray-400">Carregando…</span>}
          </div>
          {orgKpi && (
            <div className="bg-gradient-to-br from-[#26619c]/5 to-blue-50 border border-[#26619c]/20 rounded-xl p-4">
              <p className="text-xs font-bold text-[#26619c] uppercase tracking-wide mb-3">{orgKpi.name}</p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="bg-white rounded-xl p-3 border border-gray-100">
                  <p className="text-[10px] text-gray-400 flex items-center gap-1"><Users className="w-3 h-3" />Associados</p>
                  <p className="text-xl font-bold text-gray-800">{orgKpi.associados}</p>
                  {orgKpi.visitantes > 0 && <p className="text-[10px] text-gray-400">{orgKpi.visitantes} visitantes</p>}
                </div>
                <div className={`bg-white rounded-xl p-3 border ${orgKpi.enc_pendentes > 0 ? 'border-amber-200' : 'border-gray-100'}`}>
                  <p className="text-[10px] text-gray-400 flex items-center gap-1"><Package className="w-3 h-3" />Enc. pendentes</p>
                  <p className={`text-xl font-bold ${orgKpi.enc_pendentes > 0 ? 'text-amber-600' : 'text-gray-800'}`}>{orgKpi.enc_pendentes}</p>
                  <p className="text-[10px] text-gray-400">{orgKpi.os_abertas} OS abertas</p>
                </div>
                <div className={`bg-white rounded-xl p-3 border ${orgKpi.mens_pendentes > 0 ? 'border-red-200' : 'border-gray-100'}`}>
                  <p className="text-[10px] text-gray-400 flex items-center gap-1"><AlertCircle className="w-3 h-3" />Mensalidades pend.</p>
                  <p className={`text-xl font-bold ${orgKpi.mens_pendentes > 0 ? 'text-red-600' : 'text-gray-800'}`}>{orgKpi.mens_pendentes}</p>
                  <p className="text-[10px] text-gray-400">{fmt(orgKpi.mens_valor)}</p>
                </div>
                <div className={`bg-white rounded-xl p-3 border ${orgKpi.saldo_mes >= 0 ? 'border-green-200' : 'border-red-200'}`}>
                  <p className="text-[10px] text-gray-400">Saldo do mês</p>
                  <p className={`text-xl font-bold ${orgKpi.saldo_mes >= 0 ? 'text-green-700' : 'text-red-600'}`}>{fmt(orgKpi.saldo_mes)}</p>
                  <p className="text-[10px] text-gray-400">{fmt(orgKpi.receita_mes)} rec.</p>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[...Array(4)].map((_, i) => <div key={i} className="bg-gray-100 rounded-xl p-4 h-24 animate-pulse" />)}
        </div>
      ) : kpi ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 flex flex-col gap-2">
            <div className="flex items-center gap-2"><Users className="w-4 h-4 text-[#26619c] shrink-0" /><p className="text-xs font-medium text-[#26619c] leading-tight">Associados ativos</p></div>
            {isViewer ? <p className="text-sm text-blue-300 font-medium">—</p> : (
              <>
                <p className="text-2xl font-bold text-[#26619c]">{kpi.activeAssociados}</p>
                <p className="text-[11px] text-blue-400 leading-tight">
                  {kpi.dependentes > 0 && <span>{kpi.dependentes} dep.</span>}
                  {kpi.dependentes > 0 && kpi.visitantes > 0 && <span> · </span>}
                  {kpi.visitantes > 0 && <span>{kpi.visitantes} não-assoc.</span>}
                </p>
              </>
            )}
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

      {/* Financial KPIs */}
      {financeSummary && !isViewer && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="bg-green-50 border border-green-100 rounded-xl p-3 flex flex-col gap-1">
            <div className="flex items-center gap-1.5"><TrendingUp className="w-3.5 h-3.5 text-green-600" /><p className="text-xs font-medium text-green-700">Receita ({financeSummary.period_label})</p></div>
            <p className="text-xl font-bold text-green-700">{fmt(financeSummary.total_income)}</p>
          </div>
          <div className="bg-red-50 border border-red-100 rounded-xl p-3 flex flex-col gap-1">
            <div className="flex items-center gap-1.5"><TrendingDown className="w-3.5 h-3.5 text-red-500" /><p className="text-xs font-medium text-red-600">Despesa ({financeSummary.period_label})</p></div>
            <p className="text-xl font-bold text-red-600">{fmt(financeSummary.total_expense)}</p>
          </div>
          <div className={`border rounded-xl p-3 flex flex-col gap-1 ${financeSummary.total_balance >= 0 ? 'bg-blue-50 border-blue-100' : 'bg-red-50 border-red-100'}`}>
            <div className="flex items-center gap-1.5"><DollarSign className="w-3.5 h-3.5 text-[#26619c]" /><p className="text-xs font-medium text-[#26619c]">Saldo do mês</p></div>
            <p className={`text-xl font-bold ${financeSummary.total_balance >= 0 ? 'text-[#26619c]' : 'text-red-600'}`}>{fmt(financeSummary.total_balance)}</p>
          </div>
          <div className={`border rounded-xl p-3 flex flex-col gap-1 ${financeSummary.contas_a_receber > 0 ? 'bg-amber-50 border-amber-100' : 'bg-gray-50 border-gray-100'}`}>
            <div className="flex items-center gap-1.5"><AlertCircle className="w-3.5 h-3.5 text-amber-500" /><p className="text-xs font-medium text-amber-700">A receber</p></div>
            <p className={`text-xl font-bold ${financeSummary.contas_a_receber > 0 ? 'text-amber-700' : 'text-gray-600'}`}>{fmt(financeSummary.contas_a_receber)}</p>
            {financeSummary.contas_a_receber_count > 0 && <p className="text-[10px] text-gray-400">{financeSummary.contas_a_receber_count} mensalidades</p>}
          </div>
        </div>
      )}

      {/* Porta a Porta summary card */}
      {papSummary && (papSummary.total_leads > 0) && (
        <div className="bg-gradient-to-br from-[#26619c]/10 to-blue-50 border border-[#26619c]/20 rounded-xl p-4 flex flex-col gap-3">
          <p className="text-xs font-semibold text-[#26619c] uppercase tracking-wide">Porta a Porta</p>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <p className="text-2xl font-bold text-[#26619c]">{papSummary.paid_leads}</p>
              <p className="text-[11px] text-gray-500">Associados</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-green-700">R$ {parseFloat(papSummary.total_received).toFixed(0)}</p>
              <p className="text-[11px] text-gray-500">Recebido</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-amber-600">R$ {parseFloat(papSummary.total_commission).toFixed(0)}</p>
              <p className="text-[11px] text-gray-500">Comissões</p>
            </div>
          </div>
          {papSummary.pending_leads > 0 && (
            <p className="text-xs text-amber-600">{papSummary.pending_leads} pendente(s) aguardando confirmação</p>
          )}
        </div>
      )}

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

// ── Map Tab ───────────────────────────────────────────────────────────────────

interface StreetData { street: string; city: string; state: string; cep: string; members: number; guests: number }

const GEO_CACHE = 'aprxm_geo_v3:'

async function geocodeCep(cep: string, street: string): Promise<[number, number] | null> {
  const cleanCep = cep.replace(/\D/g, '')
  const key = GEO_CACHE + (cleanCep || street)
  const cached = localStorage.getItem(key)
  if (cached) return cached === 'null' ? null : JSON.parse(cached)

  // ViaCEP → pega logradouro e bairro para montar query melhor
  if (cleanCep.length === 8) {
    try {
      const r = await fetch(`https://viacep.com.br/ws/${cleanCep}/json/`)
      const d = await r.json()
      if (!d.erro && d.localidade) {
        const query = `${d.logradouro || street}, ${d.bairro || ''}, ${d.localidade}, ${d.uf}, Brasil`
        const geo = await fetch(
          `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1&countrycodes=br`,
          { headers: { 'User-Agent': 'APROXIMA/1.0 (institutotiapretinha.org)' } }
        )
        const gd = await geo.json()
        if (gd.length) {
          const coord: [number, number] = [parseFloat(gd[0].lat), parseFloat(gd[0].lon)]
          localStorage.setItem(key, JSON.stringify(coord))
          return coord
        }
      }
    } catch { /* fallthrough */ }
  }

  // Fallback: Nominatim direto com nome da rua
  try {
    const query = `${street}, Madureira, Rio de Janeiro, RJ, Brasil`
    const r = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1&countrycodes=br`,
      { headers: { 'User-Agent': 'APROXIMA/1.0 (institutotiapretinha.org)' } }
    )
    const d = await r.json()
    if (d.length) {
      const coord: [number, number] = [parseFloat(d[0].lat), parseFloat(d[0].lon)]
      localStorage.setItem(key, JSON.stringify(coord))
      return coord
    }
  } catch { /* ignore */ }

  localStorage.setItem(key, 'null')
  return null
}

type HeatView = 'associados' | 'nao_associados' | 'total'

function MapTab() {
  const mapRef      = useRef<HTMLDivElement>(null)
  const mapInst     = useRef<any>(null)
  const heatLayerM  = useRef<any>(null)
  const heatLayerG  = useRef<any>(null)
  const [streets, setStreets]   = useState<StreetData[]>([])
  const [loading, setLoading]   = useState(true)
  const [progress, setProgress] = useState(0)
  const [total, setTotal]       = useState(0)
  const [view, setView]         = useState<HeatView>('associados')

  const totalMembers = streets.reduce((a, s) => a + s.members, 0)
  const totalGuests  = streets.reduce((a, s) => a + s.guests, 0)

  // Carrega dados
  useEffect(() => {
    api.get('/residents/map-data')
      .then(r => setStreets(r.data))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  // Inicializa mapa
  useEffect(() => {
    if (!mapRef.current || mapInst.current) return
    import('leaflet').then(({ default: L }) => {
      const map = L.map(mapRef.current!, { zoomControl: true })
        .setView([-22.8756, -43.3278], 14)
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors', maxZoom: 19,
      }).addTo(map)
      mapInst.current = map
    })
    return () => { mapInst.current?.remove(); mapInst.current = null }
  }, [])

  // Geocoda ruas e monta camadas de calor
  useEffect(() => {
    if (!streets.length || !mapInst.current) return
    const aborted = { v: false }

    const run = async () => {
      const [L, heatModule] = await Promise.all([
        import('leaflet'),
        import('leaflet.heat'),
      ])
      void heatModule

      const pointsM: [number, number, number][] = []
      const pointsG: [number, number, number][] = []
      const maxM = Math.max(...streets.map(s => s.members), 1)
      const maxG = Math.max(...streets.map(s => s.guests), 1)

      setTotal(streets.length)

      for (let i = 0; i < streets.length; i++) {
        if (aborted.v) return
        const s = streets[i]
        const cacheKey = GEO_CACHE + (s.cep.replace(/\D/g, '') || s.street)
        const isCached = !!localStorage.getItem(cacheKey)
        if (!isCached && i > 0) await new Promise(r => setTimeout(r, 1200))
        if (aborted.v) return

        const coord = await geocodeCep(s.cep, s.street)
        if (!coord || aborted.v) { setProgress(i + 1); continue }

        const [lat, lng] = coord
        if (s.members > 0) pointsM.push([lat, lng, s.members / maxM])
        if (s.guests  > 0) pointsG.push([lat, lng, s.guests  / maxG])
        setProgress(i + 1)

        // Atualiza camadas progressivamente
        const map = mapInst.current
        if (!map) return

        if (heatLayerM.current) map.removeLayer(heatLayerM.current)
        if (heatLayerG.current) map.removeLayer(heatLayerG.current)

        heatLayerM.current = (L.default as any).heatLayer(pointsM, {
          radius: 30, blur: 25, maxZoom: 17,
          gradient: { 0.2: '#bfdbfe', 0.5: '#3b82f6', 0.8: '#1d4ed8', 1.0: '#1e3a8a' },
        })
        heatLayerG.current = (L.default as any).heatLayer(pointsG, {
          radius: 30, blur: 25, maxZoom: 17,
          gradient: { 0.2: '#fed7aa', 0.5: '#f97316', 0.8: '#ea580c', 1.0: '#9a3412' },
        })

        if (view === 'associados' || view === 'total') heatLayerM.current.addTo(map)
        if (view === 'nao_associados' || view === 'total') heatLayerG.current.addTo(map)
      }
    }

    run()
    return () => { aborted.v = true }
  }, [streets])

  // Troca camadas ao mudar visão
  useEffect(() => {
    const map = mapInst.current
    if (!map) return
    if (heatLayerM.current) {
      if (view === 'associados' || view === 'total') { if (!map.hasLayer(heatLayerM.current)) heatLayerM.current.addTo(map) }
      else map.removeLayer(heatLayerM.current)
    }
    if (heatLayerG.current) {
      if (view === 'nao_associados' || view === 'total') { if (!map.hasLayer(heatLayerG.current)) heatLayerG.current.addTo(map) }
      else map.removeLayer(heatLayerG.current)
    }
  }, [view])

  return (
    <div className="flex flex-col gap-4">
      {/* Totais */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-center">
          <div className="text-2xl font-bold text-blue-700">{totalMembers}</div>
          <div className="text-xs text-blue-600 mt-0.5">Associados</div>
        </div>
        <div className="bg-orange-50 border border-orange-200 rounded-xl p-3 text-center">
          <div className="text-2xl font-bold text-orange-600">{totalGuests}</div>
          <div className="text-xs text-orange-500 mt-0.5">Não associados</div>
        </div>
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 text-center">
          <div className="text-2xl font-bold text-gray-700">{totalMembers + totalGuests}</div>
          <div className="text-xs text-gray-500 mt-0.5">Total</div>
        </div>
      </div>

      {/* Controles */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex bg-gray-100 rounded-xl p-1 gap-1">
          {([['associados','🔵 Associados'],['nao_associados','🟠 Não assoc.'],['total','Todos']] as [HeatView,string][]).map(([v, label]) => (
            <button key={v} onClick={() => setView(v)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${view === v ? 'bg-white shadow-sm text-gray-800' : 'text-gray-500 hover:text-gray-700'}`}>
              {label}
            </button>
          ))}
        </div>
        {loading && <span className="text-xs text-gray-400">Carregando dados…</span>}
        {!loading && total > 0 && progress < total && (
          <span className="text-xs text-gray-400">Geocodificando {progress}/{total} ruas…</span>
        )}
        {!loading && total > 0 && progress === total && (
          <span className="text-xs text-green-600 font-medium">{total} ruas mapeadas</span>
        )}
      </div>

      {/* Mapa */}
      <div ref={mapRef} className="rounded-xl overflow-hidden border border-gray-200 shadow-sm"
        style={{ height: 480, background: '#e5e7eb' }} />

      {/* Legenda */}
      <div className="flex flex-wrap gap-4 text-xs text-gray-500 px-1">
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-8 h-3 rounded-sm" style={{ background: 'linear-gradient(to right,#bfdbfe,#1d4ed8)' }} />
          Associados (azul)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-8 h-3 rounded-sm" style={{ background: 'linear-gradient(to right,#fed7aa,#ea580c)' }} />
          Não associados (laranja)
        </span>
        <span className="text-gray-400">Intensidade = quantidade de moradores na rua</span>
      </div>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

type Tab = 'overview' | 'senso' | 'mapa'

export default function OverviewPage() {
  const [tab, setTab] = useState<Tab>('overview')

  return (
    <div className="flex flex-col gap-4 p-4 sm:p-6 max-w-screen-xl mx-auto w-full">
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
          <button onClick={() => setTab('mapa')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition ${tab === 'mapa' ? 'bg-white text-[#26619c] shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
            <MapPin className="w-3.5 h-3.5" /> Mapa
          </button>
        </div>
      </div>
      {tab === 'overview' ? <OverviewTab /> : tab === 'senso' ? <SensoTab /> : <MapTab />}
    </div>
  )
}
