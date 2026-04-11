import { useEffect, useState } from 'react'
import { Activity, Building2, ChevronDown, ChevronRight, Monitor, Package, RefreshCw, Users, Pencil, Trash2, Settings, X, Check } from 'lucide-react'
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
interface OrgSettings { default_cash_balance: number; max_cash_before_sangria: number; default_mensalidade_amount: number; delinquency_grace_days: number; permitir_transferencia: boolean }

const ROLE_LABELS: Record<string, string> = {
  superadmin: 'SuperAdmin', admin_master: 'Admin Master', admin: 'Admin', conferente: 'Conferente',
  diretoria: 'Diretoria', diretoria_adjunta: 'Dir. Adjunta', operator: 'Operador', viewer: 'Visualizador',
}
const PLANS = ['basic', 'pro', 'aggregator']
const inputCls = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#26619c]/30'

export default function SuperAdminPage() {
  const [orgs, setOrgs] = useState<OrgSummary[]>([])
  const [health, setHealth] = useState<HealthSummary | null>(null)
  const [activeSessions, setActiveSessions] = useState<ActiveSession[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [orgUsers, setOrgUsers] = useState<Record<string, OrgUser[]>>({})
  const [loadingUsers, setLoadingUsers] = useState<string | null>(null)

  // Edit org
  const [editOrg, setEditOrg] = useState<OrgSummary | null>(null)
  const [editForm, setEditForm] = useState({ name: '', slug: '', plan_name: '', is_active: true })
  const [savingEdit, setSavingEdit] = useState(false)

  // Settings per org
  const [settingsOrg, setSettingsOrg] = useState<OrgSummary | null>(null)
  const [orgSettings, setOrgSettings] = useState<OrgSettings | null>(null)
  const [settingsForm, setSettingsForm] = useState({ default_cash_balance: '', max_cash_before_sangria: '', default_mensalidade_amount: '', delinquency_grace_days: '', permitir_transferencia: false })
  const [savingSettings, setSavingSettings] = useState(false)

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
    } catch { toast.error('Erro ao carregar painel de TI.') }
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

  const openEdit = (org: OrgSummary) => {
    setEditOrg(org)
    setEditForm({ name: org.name, slug: org.slug, plan_name: org.plan_name, is_active: org.is_active })
  }

  const handleSaveEdit = async () => {
    if (!editOrg) return
    setSavingEdit(true)
    try {
      await api.put(`/superadmin/organizations/${editOrg.id}`, editForm)
      toast.success('Organização atualizada.')
      setEditOrg(null)
      load()
    } catch (e: any) { toast.error(e.response?.data?.detail ?? 'Erro ao salvar.') }
    finally { setSavingEdit(false) }
  }

  const handleDeactivate = async (org: OrgSummary) => {
    if (!window.confirm(`Desativar "${org.name}"? Usuários não conseguirão fazer login.`)) return
    try {
      await api.delete(`/superadmin/organizations/${org.id}`)
      toast.success(`"${org.name}" desativada.`)
      load()
    } catch (e: any) { toast.error(e.response?.data?.detail ?? 'Erro ao desativar.') }
  }

  const openSettings = async (org: OrgSummary) => {
    setSettingsOrg(org)
    setOrgSettings(null)
    try {
      const res = await api.get<OrgSettings>(`/superadmin/organizations/${org.id}/settings`)
      setOrgSettings(res.data)
      setSettingsForm({
        default_cash_balance: String(res.data.default_cash_balance),
        max_cash_before_sangria: String(res.data.max_cash_before_sangria),
        default_mensalidade_amount: String(res.data.default_mensalidade_amount),
        delinquency_grace_days: String(res.data.delinquency_grace_days),
        permitir_transferencia: res.data.permitir_transferencia,
      })
    } catch { toast.error('Erro ao carregar configurações.') }
  }

  const handleSaveSettings = async () => {
    if (!settingsOrg) return
    setSavingSettings(true)
    try {
      await api.put(`/superadmin/organizations/${settingsOrg.id}/settings`, {
        default_cash_balance: parseFloat(settingsForm.default_cash_balance) || 200,
        max_cash_before_sangria: parseFloat(settingsForm.max_cash_before_sangria) || 500,
        default_mensalidade_amount: parseFloat(settingsForm.default_mensalidade_amount) || 0,
        delinquency_grace_days: parseInt(settingsForm.delinquency_grace_days) || 2,
        permitir_transferencia: settingsForm.permitir_transferencia,
      })
      toast.success('Configurações salvas.')
      setSettingsOrg(null)
    } catch (e: any) { toast.error(e.response?.data?.detail ?? 'Erro ao salvar.') }
    finally { setSavingSettings(false) }
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
            Caixas abertos
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
        <div className="px-4 py-3 border-b border-gray-100">
          <h2 className="font-semibold text-gray-800 text-sm flex items-center gap-2"><Building2 className="w-4 h-4 text-gray-400" />Organizações</h2>
        </div>
        {loading ? <div className="p-8 text-center text-gray-400 text-sm">Carregando…</div> : (
          <ul className="divide-y divide-gray-100">
            {orgs.map(org => (
              <li key={org.id}>
                <div className="flex items-center justify-between px-4 py-3.5 hover:bg-gray-50">
                  <button onClick={() => toggleOrg(org.slug)} className="flex items-center gap-3 min-w-0 flex-1 text-left">
                    <div className={`w-2 h-2 rounded-full shrink-0 ${org.is_active ? 'bg-green-500' : 'bg-gray-300'}`} />
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-gray-800 truncate">{org.name}</p>
                      <div className="flex items-center gap-3 mt-0.5 text-xs text-gray-400 flex-wrap">
                        <span className="font-mono text-gray-300">/{org.slug}</span>
                        <span className="flex items-center gap-1"><Users className="w-3 h-3" />{org.user_count}</span>
                        <span className="flex items-center gap-1"><Building2 className="w-3 h-3" />{org.resident_count} mor.</span>
                        <span className="flex items-center gap-1"><Package className="w-3 h-3" />{org.open_packages} enc.</span>
                        <span>Login: {fmtDate(org.last_login_at)}</span>
                      </div>
                    </div>
                  </button>
                  <div className="flex items-center gap-1.5 shrink-0 ml-2">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                      org.plan_name === 'aggregator' ? 'bg-purple-100 text-purple-700' :
                      org.plan_name === 'pro' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'
                    }`}>{org.plan_name}</span>
                    <button onClick={() => openSettings(org)} title="Configurações" className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition">
                      <Settings className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => openEdit(org)} title="Editar" className="p-1.5 text-gray-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition">
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => handleDeactivate(org)} title="Desativar" className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => toggleOrg(org.slug)} className="p-1.5 text-gray-300">
                      {expanded === org.slug ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {expanded === org.slug && (
                  <div className="border-t border-gray-100 bg-gray-50 px-4 py-3">
                    <p className="text-xs font-medium text-gray-600 mb-2">Usuários da organização</p>
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

      <p className="text-xs text-gray-400 text-center">Painel de TI — dados em tempo real · APRXM v1.0</p>

      {/* Edit org modal */}
      {editOrg && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-gray-800">Editar — {editOrg.name}</h3>
              <button onClick={() => setEditOrg(null)}><X className="w-5 h-5 text-gray-400" /></button>
            </div>
            <div className="flex flex-col gap-3">
              <div><label className="block text-xs text-gray-600 mb-1">Nome</label>
                <input value={editForm.name} onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))} className={inputCls} /></div>
              <div><label className="block text-xs text-gray-600 mb-1">Slug</label>
                <input value={editForm.slug} onChange={e => setEditForm(f => ({ ...f, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-') }))} className={inputCls} /></div>
              <div><label className="block text-xs text-gray-600 mb-1">Plano</label>
                <select value={editForm.plan_name} onChange={e => setEditForm(f => ({ ...f, plan_name: e.target.value }))} className={inputCls}>
                  {PLANS.map(p => <option key={p} value={p}>{p}</option>)}
                </select></div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={editForm.is_active} onChange={e => setEditForm(f => ({ ...f, is_active: e.target.checked }))} className="w-4 h-4 accent-[#26619c]" />
                <span className="text-sm text-gray-700">Ativa</span>
              </label>
            </div>
            <div className="flex gap-2">
              <button onClick={() => setEditOrg(null)} className="flex-1 py-2 border border-gray-200 rounded-xl text-sm text-gray-600">Cancelar</button>
              <button onClick={handleSaveEdit} disabled={savingEdit} className="flex-1 py-2 bg-[#26619c] text-white rounded-xl text-sm font-semibold disabled:opacity-50">
                {savingEdit ? '…' : <span className="flex items-center justify-center gap-1"><Check className="w-4 h-4" />Salvar</span>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Settings modal */}
      {settingsOrg && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-gray-800">Config — {settingsOrg.name}</h3>
              <button onClick={() => setSettingsOrg(null)}><X className="w-5 h-5 text-gray-400" /></button>
            </div>
            {!orgSettings ? <p className="text-sm text-center text-gray-400 py-4">Carregando…</p> : (
              <div className="flex flex-col gap-3">
                {[
                  { key: 'default_cash_balance', label: 'Fundo de caixa (R$)' },
                  { key: 'max_cash_before_sangria', label: 'Limite sangria (R$)' },
                  { key: 'default_mensalidade_amount', label: 'Mensalidade padrão (R$)' },
                  { key: 'delinquency_grace_days', label: 'Carência inadimplência (dias)' },
                ].map(({ key, label }) => (
                  <div key={key}><label className="block text-xs text-gray-600 mb-1">{label}</label>
                    <input type="number" value={(settingsForm as any)[key]}
                      onChange={e => setSettingsForm(f => ({ ...f, [key]: e.target.value }))}
                      className={inputCls} /></div>
                ))}
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={settingsForm.permitir_transferencia}
                    onChange={e => setSettingsForm(f => ({ ...f, permitir_transferencia: e.target.checked }))} className="w-4 h-4 accent-[#26619c]" />
                  <span className="text-sm text-gray-700">Permitir transferências</span>
                </label>
              </div>
            )}
            <div className="flex gap-2">
              <button onClick={() => setSettingsOrg(null)} className="flex-1 py-2 border border-gray-200 rounded-xl text-sm text-gray-600">Cancelar</button>
              <button onClick={handleSaveSettings} disabled={savingSettings || !orgSettings} className="flex-1 py-2 bg-[#26619c] text-white rounded-xl text-sm font-semibold disabled:opacity-50">
                {savingSettings ? '…' : <span className="flex items-center justify-center gap-1"><Check className="w-4 h-4" />Salvar</span>}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
