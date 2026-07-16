import { NavLink, Outlet } from 'react-router-dom'
import { useAuthStore } from '../lib/authStore'

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `rounded-md px-3 py-1.5 text-sm ${isActive ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200'}`

export function Layout() {
  const logout = useAuthStore((s) => s.logout)

  return (
    <div className="min-h-screen">
      <header className="flex items-center justify-between border-b border-slate-800 px-6 py-3">
        <div className="flex items-center gap-4">
          <span className="font-semibold text-slate-100">Painel APRXM</span>
          <nav className="flex gap-1">
            <NavLink to="/empresas" className={linkClass}>Empresas</NavLink>
            <NavLink to="/provisioning-runs" className={linkClass}>Execuções</NavLink>
          </nav>
        </div>
        <button onClick={logout} className="text-sm text-slate-400 hover:text-slate-200">
          Sair
        </button>
      </header>
      <main className="mx-auto max-w-4xl px-6 py-8">
        <Outlet />
      </main>
    </div>
  )
}
