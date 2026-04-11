import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { jwtDecode } from 'jwt-decode'
import { Building2, ChevronRight, Clock, Loader2, Lock, Mail, X } from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../services/api'
import { useAuthStore } from '../store/authStore'
import type { UserRole } from '../types'

interface OrgOption {
  id: string
  name: string
  slug: string
  role: UserRole
}

interface RecentLogin {
  email: string
  associationId: string
  associationName: string
  role: UserRole
}

type Step = 'email' | 'org' | 'password'

const RECENT_KEY = 'aprxm-recent-logins'

function loadRecent(): RecentLogin[] {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') } catch { return [] }
}

function saveRecent(entry: RecentLogin) {
  const list = loadRecent().filter(r => !(r.email === entry.email && r.associationId === entry.associationId))
  localStorage.setItem(RECENT_KEY, JSON.stringify([entry, ...list].slice(0, 5)))
}

function removeRecent(email: string, associationId: string) {
  const list = loadRecent().filter(r => !(r.email === email && r.associationId === associationId))
  localStorage.setItem(RECENT_KEY, JSON.stringify(list))
}

export default function LoginPage() {
  const navigate = useNavigate()
  const setAuth = useAuthStore((s) => s.setAuth)

  const [step, setStep] = useState<Step>('email')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [orgs, setOrgs] = useState<OrgOption[]>([])
  const [selectedOrg, setSelectedOrg] = useState<OrgOption | null>(null)
  const [loading, setLoading] = useState(false)
  const [rememberAccess, setRememberAccess] = useState(true)
  const [recentLogins, setRecentLogins] = useState<RecentLogin[]>([])

  useEffect(() => { setRecentLogins(loadRecent()) }, [])

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email) return
    setLoading(true)
    try {
      const res = await api.get<OrgOption[]>('/auth/associations', { params: { email } })
      if (res.data.length === 0) {
        toast.error('Nenhuma organização encontrada para este e-mail.')
        return
      }
      setOrgs(res.data)
      if (res.data.length === 1) {
        setSelectedOrg(res.data[0])
        setStep('password')
      } else {
        setStep('org')
      }
    } catch {
      toast.error('Erro ao buscar organizações.')
    } finally {
      setLoading(false)
    }
  }

  const handleOrgSelect = (org: OrgOption) => {
    setSelectedOrg(org)
    setStep('password')
  }

  const handleQuickLogin = (recent: RecentLogin) => {
    setEmail(recent.email)
    setSelectedOrg({ id: recent.associationId, name: recent.associationName, role: recent.role, slug: '' })
    setOrgs([])
    setStep('password')
  }

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedOrg || !password) return
    setLoading(true)
    try {
      const res = await api.post<{ access_token: string }>('/auth/login', {
        email,
        password,
        association_id: selectedOrg.id,
        remember_me: rememberAccess,
      })
      const token = res.data.access_token
      const payload = jwtDecode<{ sub: string; association_id: string; role: UserRole; full_name: string; linked_association_ids?: string[]; association_name?: string }>(token)
      setAuth(token, payload.sub, payload.association_id, payload.role, payload.full_name ?? '', payload.linked_association_ids ?? [], payload.association_name ?? '', rememberAccess)
      if (rememberAccess) {
        saveRecent({
          email,
          associationId: payload.association_id,
          associationName: payload.association_name || selectedOrg.name || '',
          role: payload.role,
        })
        setRecentLogins(loadRecent())
      }
      navigate('/')
    } catch (e: any) {
      toast.error(e.response?.data?.detail ?? 'Credenciais inválidas.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0f2a4a] p-4">
      <div className="absolute inset-0 opacity-5"
        style={{ backgroundImage: 'radial-gradient(circle at 25% 25%, #4a90d9 0%, transparent 50%), radial-gradient(circle at 75% 75%, #26619c 0%, transparent 50%)' }} />

      <div className="relative w-full max-w-sm">
        <div className="bg-white rounded-2xl shadow-2xl overflow-hidden">
          {/* Header */}
          <div className="bg-[#1a3f6f] px-8 py-7 text-center">
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-white/10 mb-3">
              <Building2 className="w-7 h-7 text-white" />
            </div>
            <h1 className="text-2xl font-extrabold text-white tracking-tight">APROXIMA</h1>
            <p className="text-blue-200 text-xs mt-1">Associação de Moradores</p>
          </div>

          {/* Steps indicator */}
          <div className="flex border-b border-gray-100">
            {(['email', 'org', 'password'] as Step[]).map((s, i) => (
              <div key={s} className={`flex-1 py-2 text-center text-xs font-medium transition-colors ${
                step === s ? 'text-[#26619c] border-b-2 border-[#26619c]' :
                i < ['email','org','password'].indexOf(step) ? 'text-green-500' : 'text-gray-300'
              }`}>
                {i + 1}
              </div>
            ))}
          </div>

          <div key={step} className="px-8 py-7">

            {/* Step 1: Email */}
            {step === 'email' && (
              <div className="flex flex-col gap-4">
                <form onSubmit={handleEmailSubmit} className="flex flex-col gap-4">
                  <div>
                    <p className="text-sm font-semibold text-gray-700 mb-4">Informe seu e-mail</p>
                    <div className="relative">
                      <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                      <input
                        type="email"
                        required
                        autoFocus
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="w-full pl-10 pr-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#26619c]/40 focus:border-[#26619c]"
                        placeholder="seu@email.com"
                      />
                    </div>
                  </div>
                  <button
                    type="submit"
                    disabled={loading || !email}
                    className="w-full flex items-center justify-center gap-2 bg-[#26619c] hover:bg-[#1a4f87] text-white py-3 rounded-xl font-semibold transition disabled:opacity-50"
                  >
                    {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <>Continuar <ChevronRight className="w-4 h-4" /></>}
                  </button>
                </form>

                {/* Recent logins */}
                {recentLogins.length > 0 && (
                  <div className="border-t border-gray-100 pt-4">
                    <p className="text-xs text-gray-400 flex items-center gap-1 mb-2">
                      <Clock className="w-3 h-3" /> Acessos recentes
                    </p>
                    <div className="flex flex-col gap-2">
                      {recentLogins.map((r) => (
                        <div key={`${r.email}-${r.associationId}`} className="flex items-center gap-2 group">
                          <button
                            type="button"
                            onClick={() => handleQuickLogin(r)}
                            className="flex-1 flex items-center gap-3 p-3 border border-gray-200 rounded-xl hover:border-[#26619c] hover:bg-blue-50 transition text-left"
                          >
                            <div className="w-8 h-8 rounded-lg bg-[#1a3f6f] flex items-center justify-center shrink-0">
                              <Building2 className="w-3.5 h-3.5 text-white" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="text-xs font-semibold text-gray-800 truncate">{r.associationName}</p>
                              <p className="text-xs text-gray-400 truncate">{r.email}</p>
                            </div>
                            <ChevronRight className="w-3.5 h-3.5 text-gray-300 group-hover:text-[#26619c] shrink-0" />
                          </button>
                          <button
                            type="button"
                            onClick={() => { removeRecent(r.email, r.associationId); setRecentLogins(loadRecent()) }}
                            className="p-1.5 text-gray-300 hover:text-red-400 transition"
                            title="Remover"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Step 2: Select org */}
            {step === 'org' && (
              <div className="flex flex-col gap-3">
                <div className="flex items-center gap-2 mb-1">
                  <button onClick={() => setStep('email')} className="text-xs text-gray-400 hover:text-gray-600">← voltar</button>
                  <p className="text-sm font-semibold text-gray-700">Selecione a organização</p>
                </div>
                <p className="text-xs text-gray-400 -mt-2">{email}</p>
                {orgs.map((org) => (
                  <button
                    key={org.id}
                    onClick={() => handleOrgSelect(org)}
                    className="flex items-center gap-3 p-4 border border-gray-200 rounded-xl hover:border-[#26619c] hover:bg-blue-50 transition text-left group"
                  >
                    <div className="w-9 h-9 rounded-lg bg-[#1a3f6f] flex items-center justify-center shrink-0">
                      <Building2 className="w-4 h-4 text-white" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-800 leading-tight">{org.name}</p>
                      <p className="text-xs text-gray-400 capitalize mt-0.5">{org.role}</p>
                    </div>
                    <ChevronRight className="w-4 h-4 text-gray-300 group-hover:text-[#26619c] shrink-0" />
                  </button>
                ))}
              </div>
            )}

            {/* Step 3: Password */}
            {step === 'password' && selectedOrg && (
              <form onSubmit={handleLogin} className="flex flex-col gap-4">
                <button
                  type="button"
                  onClick={() => setStep(orgs.length > 1 ? 'org' : 'email')}
                  className="text-xs text-gray-400 hover:text-gray-600 text-left"
                >
                  ← voltar
                </button>

                <div className="flex items-center gap-3 bg-blue-50 rounded-xl px-4 py-3 border border-blue-100">
                  <Building2 className="w-4 h-4 text-[#26619c] shrink-0" />
                  <div className="min-w-0">
                    <p className="text-xs text-gray-500">{email}</p>
                    <p className="text-sm font-semibold text-[#1a3f6f] leading-tight">{selectedOrg.name}</p>
                  </div>
                </div>

                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input
                    type="password"
                    required
                    autoFocus
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full pl-10 pr-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#26619c]/40 focus:border-[#26619c]"
                    placeholder="Senha"
                  />
                </div>

                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={rememberAccess}
                    onChange={(e) => setRememberAccess(e.target.checked)}
                    className="w-4 h-4 rounded accent-[#26619c]"
                  />
                  <span className="text-xs text-gray-500">Manter conectado neste dispositivo</span>
                </label>

                <button
                  type="submit"
                  disabled={loading || !password}
                  className="w-full flex items-center justify-center gap-2 bg-[#26619c] hover:bg-[#1a4f87] text-white py-3 rounded-xl font-semibold transition disabled:opacity-50"
                >
                  {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Entrar'}
                </button>
              </form>
            )}
          </div>
        </div>

        <p className="text-center text-blue-200/40 text-xs mt-5">
          APRXM v1.0 · Associação de Moradores
        </p>
      </div>
    </div>
  )
}
