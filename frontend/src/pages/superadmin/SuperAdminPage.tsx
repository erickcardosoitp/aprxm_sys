import { useEffect, useState } from 'react'
import { Activity, Building2, ChevronDown, ChevronRight, Monitor, Package, RefreshCw, Users } from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../../services/api'

interface OrgSummary {
  id: string
  name: string
  slug: string
  plan_name: string
  is_active: boolean
  plan_expires_at: string | null
  created_at: string
  user_count: number
  resident_count: number
  open_packages: number
  last_login_at: string | null
}

interface OrgUser {
  id: string
  full_name: string
  email: string
  role: string
  is_active: boolean
  last_login_at: string | null
}

interface ActiveSession {
  id: string
  opened_at: string
  opening_balance: number
  opened_by_name: string
  opened_by_email: string
  association_name: string
  slug: string
}

interface HealthSummary {
  active_orgs: number
  active_users: number
  total_residents: number
  pending_packages: number
  tx_last_24h: number
  open_sessions: number
  pending_mensalidades: number
}

const ROLE_LABELS: Record<string, string> = {
  superadmin: 'SuperAdmin', admin: 'Admin', conferente: 'Conferente',
  diretoria_adjunta: 'Diretoria', operator: 'Operador', viewer: 'Visualizador',
}

export default function SuperAdminPage() {
  const [orgs, setOrgs] = useState<OrgSummary[]>([])
  const [health, setHealth] = useState<HealthSummary | null>(null)
  const [activeSessions, setActiveSessions] = useState<ActiveSession[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [orgUsers, setOrgUsers] = useState<Record<string, OrgUser[]>>({})
  const [loadingUsers, setLoadingUsers] = useState<string | null>(null)

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
    } catch {
      toast.error('Erro ao carregar painel de TI.')
    } finally {
      setLoading(false)
    }
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
    <div className="flex flex-col gap-5 p-4 max-w-3xl mx-auto">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
          <Activity className="w-5 h-5 text-[#26619c]" />
          Painel TI — SuperAdmin
        </h1>
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
              color === 'blue' ? 'bg-blue-50 border-blue-100' :
              color === 'green' ? 'bg-green-50 border-green-100' :
              color === 'amber' ? 'bg-amber-50 border-amber-100' :
              color === 'red' ? 'bg-red-50 border-red-100' :
              color === 'purple' ? 'bg-purple-50 border-purple-100' :
              'bg-gray-50 border-gray-100'
            }`}>
              <p className="text-xs text-gray-500">{label}</p>
              <p className={`text-2xl font-bold mt-0.5 ${
                color === 'blue' ? 'text-blue-700' :
                color === 'green' ? 'text-green-700' :
                color === 'amber' ? 'text-amber-700' :
                color === 'red' ? 'text-red-700' :
                color === 'purple' ? 'text-purple-700' :
                'text-gray-700'
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
            Caixas abertos
            {activeSessions.length > 0 && (
              <span className="ml-1 bg-amber-100 text-amber-700 text-xs px-2 py-0.5 rounded-full font-medium">
                {activeSessions.length}
              </span>
            )}
          </h2>
        </div>
        {loading ? (
          <div className="p-6 text-center text-gray-400 text-sm">Carregando…</div>
        ) : activeSessions.length === 0 ? (
          <div className="p-6 text-center text-gray-400 text-sm">Nenhum caixa aberto.</div>
        ) : (
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
                  <td className="px-4 py-2.5 text-gray-600">
                    <div>{s.opened_by_name}</div>
                    <div className="text-gray-400">{s.opened_by_email}</div>
                  </td>
                  <td className="px-4 py-2.5 text-gray-500">{fmtDate(s.opened_at)}</td>
                  <td className="px-4 py-2.5 text-right text-gray-700 font-medium">
                    R$ {s.opening_balance.toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Organizations list */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100">
          <h2 className="font-semibold text-gray-800 text-sm flex items-center gap-2">
            <Building2 className="w-4 h-4 text-gray-400" />
            Organizações
          </h2>
        </div>
        {loading ? (
          <div className="p-8 text-center text-gray-400 text-sm">Carregando…</div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {orgs.map(org => (
              <li key={org.id}>
                <button
                  onClick={() => toggleOrg(org.slug)}
                  className="w-full flex items-center justify-between px-4 py-3.5 hover:bg-gray-50 transition text-left"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className={`w-2 h-2 rounded-full shrink-0 ${org.is_active ? 'bg-green-500' : 'bg-gray-300'}`} />
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-gray-800 truncate">{org.name}</p>
                      <div className="flex items-center gap-3 mt-0.5 text-xs text-gray-400">
                        <span className="flex items-center gap-1"><Users className="w-3 h-3" />{org.user_count}</span>
                        <span className="flex items-center gap-1"><Building2 className="w-3 h-3" />{org.resident_count} mor.</span>
                        <span className="flex items-center gap-1"><Package className="w-3 h-3" />{org.open_packages} enc.</span>
                        <span>Login: {fmtDate(org.last_login_at)}</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                      org.plan_name === 'aggregator' ? 'bg-purple-100 text-purple-700' :
                      org.plan_name === 'pro' ? 'bg-blue-100 text-blue-700' :
                      'bg-gray-100 text-gray-600'
                    }`}>{org.plan_name}</span>
                    {expanded === org.slug ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
                  </div>
                </button>

                {expanded === org.slug && (
                  <div className="border-t border-gray-100 bg-gray-50 px-4 py-3">
                    <p className="text-xs font-medium text-gray-600 mb-2">Usuários da organização</p>
                    {loadingUsers === org.slug ? (
                      <p className="text-xs text-gray-400">Carregando…</p>
                    ) : (
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-gray-400">
                            <th className="text-left py-1 font-medium">Nome</th>
                            <th className="text-left py-1 font-medium">E-mail</th>
                            <th className="text-left py-1 font-medium">Papel</th>
                            <th className="text-left py-1 font-medium">Último login</th>
                            <th className="text-center py-1 font-medium">Ativo</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200">
                          {(orgUsers[org.slug] ?? []).map(u => (
                            <tr key={u.id}>
                              <td className="py-1.5 pr-3 text-gray-800 font-medium">{u.full_name}</td>
                              <td className="py-1.5 pr-3 text-gray-500">{u.email}</td>
                              <td className="py-1.5 pr-3">
                                <span className="px-1.5 py-0.5 bg-blue-50 text-blue-700 rounded text-[10px] font-medium">
                                  {ROLE_LABELS[u.role] ?? u.role}
                                </span>
                              </td>
                              <td className="py-1.5 pr-3 text-gray-400">{fmtDate(u.last_login_at)}</td>
                              <td className="py-1.5 text-center">
                                <span className={`inline-block w-2 h-2 rounded-full ${u.is_active ? 'bg-green-500' : 'bg-red-400'}`} />
                              </td>
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

      <p className="text-xs text-gray-400 text-center">
        Painel de TI — dados em tempo real · APRXM v1.0
      </p>
    </div>
  )
}
