import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { DollarSign, Package, FileText, Users, LogOut, ShieldCheck, Settings } from 'lucide-react'
import { useAuthStore } from '../../store/authStore'

const BASE_NAV = [
  { to: '/finance',        label: 'Caixa',      icon: DollarSign },
  { to: '/packages',      label: 'Encomendas', icon: Package },
  { to: '/service-orders',label: 'Ordens',     icon: FileText },
  { to: '/residents',     label: 'Moradores',  icon: Users },
]

const ADMIN_NAV = { to: '/admin', label: 'Admin', icon: ShieldCheck }
const SETTINGS_NAV = { to: '/settings', label: 'Config', icon: Settings }

export function AppShell() {
  const clearAuth = useAuthStore((s) => s.clearAuth)
  const role = useAuthStore((s) => s.role)
  const fullName = useAuthStore((s) => s.fullName)
  const navigate = useNavigate()

  const isAdmin = role === 'admin' || role === 'superadmin'
  const isConferente = role === 'conferente'
  const navItems = isAdmin
    ? [...BASE_NAV, ADMIN_NAV, SETTINGS_NAV]
    : isConferente
    ? [...BASE_NAV, SETTINGS_NAV]
    : BASE_NAV

  const handleLogout = () => {
    clearAuth()
    navigate('/login')
  }

  const initials = fullName
    ? fullName.split(' ').slice(0, 2).map((n) => n[0]).join('').toUpperCase()
    : '?'

  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      {/* Top bar */}
      <header className="bg-[#1a3f6f] text-white flex items-center justify-between px-4 py-3 shadow">
        <span className="font-extrabold text-lg tracking-tight">APRXM</span>
        <div className="flex items-center gap-3">
          {fullName && (
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-full bg-white/20 flex items-center justify-center text-xs font-bold">
                {initials}
              </div>
              <span className="text-sm opacity-90 hidden sm:block">{fullName.split(' ')[0]}</span>
            </div>
          )}
          <button onClick={handleLogout} className="flex items-center gap-1 text-sm opacity-70 hover:opacity-100">
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 overflow-y-auto pb-20">
        <Outlet />
      </main>

      {/* Bottom nav (mobile-first) */}
      <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 flex justify-around py-2 z-40">
        {navItems.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `flex flex-col items-center gap-0.5 px-3 py-1 rounded-lg text-xs font-medium transition ${
                isActive ? 'text-[#26619c]' : 'text-gray-500 hover:text-gray-700'
              }`
            }
          >
            <Icon className="w-5 h-5" />
            {label}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
