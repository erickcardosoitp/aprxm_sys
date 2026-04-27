import { useEffect, useRef, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { Activity, BarChart2, Building2, Check, ChevronDown, DollarSign, FileText, LogOut, Package, RotateCcw, Settings, ShieldCheck, TrendingUp, Users } from 'lucide-react'
import toast from 'react-hot-toast'
import { jwtDecode } from 'jwt-decode'
import api from '../../services/api'
import { useAuthStore } from '../../store/authStore'
import type { UserRole } from '../../types'

const FULL_NAV = [
  { to: '/overview',       label: 'Visão',       icon: BarChart2 },
  { to: '/finance',        label: 'Caixa',       icon: DollarSign },
  { to: '/financeiro',     label: 'Financeiro',  icon: TrendingUp },
  { to: '/packages',       label: 'Encomendas',  icon: Package },
  { to: '/service-orders', label: 'Ordens',      icon: FileText },
  { to: '/residents',      label: 'Moradores',   icon: Users },
]

const OPERATOR_NAV = [
  { to: '/finance',        label: 'Caixa',      icon: DollarSign },
  { to: '/packages',       label: 'Encomendas', icon: Package },
  { to: '/service-orders', label: 'Ordens',     icon: FileText },
  { to: '/residents',      label: 'Moradores',  icon: Users },
]

const VIEWER_NAV = [
  { to: '/packages',       label: 'Encomendas', icon: Package },
  { to: '/service-orders', label: 'Ordens',     icon: FileText },
  { to: '/residents',      label: 'Moradores',  icon: Users },
]

const ADMIN_NAV      = { to: '/admin',      label: 'Admin',  icon: ShieldCheck }
const LOGS_NAV       = { to: '/logs',       label: 'Logs',   icon: RotateCcw }
const SETTINGS_NAV   = { to: '/settings',   label: 'Config', icon: Settings }
const SUPERADMIN_NAV = { to: '/superadmin', label: 'TI',     icon: Activity }

interface AssocOption {
  id: string
  name: string
  slug: string
  role: UserRole
  current: boolean
}

export function AppShell() {
  const clearAuth         = useAuthStore((s) => s.clearAuth)
  const setAuth           = useAuthStore((s) => s.setAuth)
  const role              = useAuthStore((s) => s.role)
  const fullName          = useAuthStore((s) => s.fullName)
  const associationName   = useAuthStore((s) => s.associationName)
  const navigate          = useNavigate()
  const location          = useLocation()
  const isMonitoring      = location.pathname === '/superadmin'

  const [menuOpen, setMenuOpen] = useState(false)
  const [assocs, setAssocs] = useState<AssocOption[]>([])
  const [switching, setSwitching] = useState<string | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const isAdmin      = role === 'admin' || role === 'superadmin' || role === 'diretoria'
  const isSuperAdmin = role === 'superadmin'
  const isConferente = role === 'conferente'
  const isDiretoria  = role === 'diretoria_adjunta' || role === 'diretoria'
  const isOperator   = role === 'operator'
  const isViewer     = role === 'viewer'

  let navItems = [...FULL_NAV]
  if (isSuperAdmin) navItems = [...FULL_NAV, ADMIN_NAV, LOGS_NAV, SETTINGS_NAV, SUPERADMIN_NAV]
  else if (isAdmin) navItems = [...FULL_NAV, ADMIN_NAV, LOGS_NAV, SETTINGS_NAV]
  else if (isConferente) navItems = [...FULL_NAV, SETTINGS_NAV]
  else if (isDiretoria) navItems = [...FULL_NAV, SETTINGS_NAV]
  else if (isOperator) navItems = [...OPERATOR_NAV]
  else if (isViewer) navItems = [...VIEWER_NAV]

  const handleLogout = () => { clearAuth(); navigate('/login') }

  const initials = fullName
    ? fullName.split(' ').slice(0, 2).map((n) => n[0]).join('').toUpperCase()
    : '?'

  const openMenu = async () => {
    setMenuOpen(true)
    try {
      const res = await api.get<AssocOption[]>('/auth/my-associations')
      setAssocs(res.data)
    } catch { /* silent */ }
  }

  const handleSwitch = async (assocId: string) => {
    if (switching) return
    setSwitching(assocId)
    try {
      const res = await api.post<{ access_token: string }>('/auth/switch-association', { association_id: assocId })
      const token = res.data.access_token
      const payload = jwtDecode<{ sub: string; association_id: string; role: UserRole; full_name: string; linked_association_ids?: string[]; association_name?: string }>(token)
      setAuth(token, payload.sub, payload.association_id, payload.role, payload.full_name ?? '', payload.linked_association_ids ?? [], payload.association_name ?? '')
      setMenuOpen(false)
      navigate('/')
      toast.success(`Ambiente: ${payload.association_name}`)
    } catch {
      toast.error('Erro ao trocar de ambiente.')
    } finally {
      setSwitching(null)
    }
  }

  // Close on outside click
  useEffect(() => {
    if (!menuOpen) return
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [menuOpen])

  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      <header className="bg-[#1a3f6f] text-white flex items-center justify-between px-4 py-3 shadow"
        style={{ paddingTop: 'max(12px, env(safe-area-inset-top))' }}>
        <div className="flex flex-col leading-tight min-w-0 max-w-[55vw]">
          <span className="font-extrabold text-base tracking-tight">APRXM</span>
          {associationName && (
            <span className="text-[10px] opacity-70 leading-none whitespace-nowrap overflow-hidden text-ellipsis">{associationName}</span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* User menu */}
          <div className="relative" ref={menuRef}>
            <button
              onClick={menuOpen ? () => setMenuOpen(false) : openMenu}
              className="flex items-center gap-2 rounded-xl px-2 py-1.5 hover:bg-white/10 transition"
            >
              <div className="w-7 h-7 rounded-full bg-white/20 flex items-center justify-center text-xs font-bold shrink-0">
                {initials}
              </div>
              {fullName && (
                <span className="text-sm opacity-90 hidden sm:block truncate max-w-[120px]">{fullName.split(' ')[0]}</span>
              )}
              <ChevronDown className={`w-3.5 h-3.5 opacity-60 transition-transform ${menuOpen ? 'rotate-180' : ''}`} />
            </button>

            {menuOpen && (
              <div className="absolute right-0 top-full mt-1.5 w-64 bg-white rounded-2xl shadow-2xl border border-gray-100 z-50 overflow-hidden">
                {/* User info */}
                <div className="px-4 py-3 border-b border-gray-100">
                  <p className="text-sm font-semibold text-gray-800 truncate">{fullName}</p>
                  <p className="text-xs text-gray-400 truncate">{associationName}</p>
                </div>

                {/* Environment switcher */}
                {assocs.length > 1 && (
                  <div className="px-4 pt-3 pb-2">
                    <p className="text-xs font-medium text-gray-400 mb-2">Trocar ambiente</p>
                    <div className="flex flex-col gap-1">
                      {assocs.map((a) => (
                        <button
                          key={a.id}
                          onClick={() => !a.current && handleSwitch(a.id)}
                          disabled={a.current || switching === a.id}
                          className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition w-full text-sm ${
                            a.current
                              ? 'bg-blue-50 text-[#26619c] cursor-default'
                              : 'hover:bg-gray-50 text-gray-700 cursor-pointer disabled:opacity-50'
                          }`}
                        >
                          <Building2 className="w-4 h-4 shrink-0 opacity-60" />
                          <span className="flex-1 truncate font-medium">{a.name}</span>
                          {a.current && <Check className="w-3.5 h-3.5 shrink-0" />}
                          {switching === a.id && <span className="text-xs opacity-60">…</span>}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Logout */}
                <div className="px-4 py-3 border-t border-gray-100">
                  <button
                    onClick={handleLogout}
                    className="flex items-center gap-2 text-sm text-red-500 hover:text-red-600 transition w-full"
                  >
                    <LogOut className="w-4 h-4" />
                    Sair
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto" style={{ paddingBottom: isMonitoring ? '0' : 'calc(72px + env(safe-area-inset-bottom))' }}>
        <Outlet />
      </main>


      {!isMonitoring && <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 z-40"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)', paddingLeft: 'env(safe-area-inset-left)', paddingRight: 'env(safe-area-inset-right)' }}>
        <div className="flex justify-center overflow-x-auto scrollbar-none px-2 gap-3 sm:gap-1" style={{ paddingBottom: 'max(4px, env(safe-area-inset-bottom))' }}>
          {navItems.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `flex flex-col items-center justify-center gap-1 px-3 py-1.5 sm:px-3 sm:py-2 rounded-xl text-xs font-medium transition shrink-0 min-w-[64px] min-h-[56px] sm:min-w-0 sm:min-h-0 ${
                  isActive
                    ? 'bg-[#26619c]/10 text-[#26619c]'
                    : 'text-gray-400 hover:text-gray-600'
                }`
              }
            >
              <Icon className="w-5 h-5" />
              {label}
            </NavLink>
          ))}
        </div>
      </nav>}
    </div>
  )
}
