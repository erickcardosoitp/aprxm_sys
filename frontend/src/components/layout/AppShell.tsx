import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { BarChart2, DollarSign, FileText, LogOut, Package, Settings, ShieldCheck, TrendingUp, Users } from 'lucide-react'
import { useAuthStore } from '../../store/authStore'

const FULL_NAV = [
  { to: '/overview',       label: 'Visão',       icon: BarChart2 },
  { to: '/finance',        label: 'Caixa',       icon: DollarSign },
  { to: '/financeiro',     label: 'Financeiro',  icon: TrendingUp },
  { to: '/packages',       label: 'Encomendas',  icon: Package },
  { to: '/service-orders', label: 'Ordens',      icon: FileText },
  { to: '/residents',      label: 'Moradores',   icon: Users },
]

// Operators see Caixa, Encomendas, Ordens, Moradores — no Visão Geral
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

const ADMIN_NAV    = { to: '/admin',    label: 'Admin',  icon: ShieldCheck }
const SETTINGS_NAV = { to: '/settings', label: 'Config', icon: Settings }

export function AppShell() {
  const clearAuth = useAuthStore((s) => s.clearAuth)
  const role      = useAuthStore((s) => s.role)
  const fullName  = useAuthStore((s) => s.fullName)
  const navigate  = useNavigate()

  const isAdmin      = role === 'admin' || role === 'superadmin'
  const isConferente = role === 'conferente'
  const isDiretoria  = role === 'diretoria_adjunta'
  const isOperator   = role === 'operator'
  const isViewer     = role === 'viewer'

  let navItems = [...FULL_NAV]
  if (isAdmin) navItems = [...FULL_NAV, ADMIN_NAV, SETTINGS_NAV]
  else if (isConferente) navItems = [...FULL_NAV, SETTINGS_NAV]
  else if (isDiretoria) navItems = [...FULL_NAV, SETTINGS_NAV]
  else if (isOperator) navItems = [...OPERATOR_NAV]
  else if (isViewer) navItems = [...VIEWER_NAV]

  const handleLogout = () => { clearAuth(); navigate('/login') }

  const initials = fullName
    ? fullName.split(' ').slice(0, 2).map((n) => n[0]).join('').toUpperCase()
    : '?'

  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      {/* Top bar — extends into status bar area on iOS standalone */}
      <header className="bg-[#1a3f6f] text-white flex items-center justify-between px-4 py-3 shadow"
        style={{ paddingTop: 'max(12px, env(safe-area-inset-top))' }}>
        <span className="font-extrabold text-lg tracking-tight">APRXM</span>
        <div className="flex items-center gap-3">
          {fullName && (
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-full bg-white/20 flex items-center justify-center text-xs font-bold shrink-0">
                {initials}
              </div>
              <span className="text-sm opacity-90 hidden sm:block truncate max-w-[120px]">{fullName.split(' ')[0]}</span>
            </div>
          )}
          <button onClick={handleLogout} className="flex items-center gap-1 text-sm opacity-70 hover:opacity-100">
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Content — bottom padding accounts for nav + safe area */}
      <main className="flex-1 overflow-y-auto" style={{ paddingBottom: 'calc(72px + env(safe-area-inset-bottom))' }}>
        <Outlet />
      </main>

      {/* Bottom nav — respects iOS home indicator */}
      <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 z-40"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)', paddingLeft: 'env(safe-area-inset-left)', paddingRight: 'env(safe-area-inset-right)' }}>
        <div className="flex justify-center overflow-x-auto scrollbar-none px-2 gap-1" style={{ paddingBottom: 'max(4px, env(safe-area-inset-bottom))' }}>
          {navItems.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `flex flex-col items-center justify-center gap-1 px-2 py-1.5 sm:px-3 sm:py-2 rounded-xl text-xs font-medium transition shrink-0 min-w-[60px] min-h-[52px] sm:min-w-0 sm:min-h-0 ${
                  isActive ? 'text-[#26619c] bg-blue-50' : 'text-gray-500 active:bg-gray-100'
                }`
              }
            >
              <Icon className="w-6 h-6 sm:w-5 sm:h-5" />
              <span className="leading-none whitespace-nowrap text-[11px]">{label}</span>
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  )
}
