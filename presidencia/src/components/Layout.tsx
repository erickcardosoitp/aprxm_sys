import { NavLink, Outlet } from 'react-router-dom'
import {
  House, ChartLineUp, Wallet, Users, Receipt, Package,
  Wrench, MapTrifold, UsersThree, SignOut,
} from '@phosphor-icons/react'
import { useAuthStore } from '../lib/authStore'
import { useUnidade } from '../lib/UnidadeContext'
import { UNIDADES } from '../lib/unidade'

const TABS = [
  { to: '/inicio', label: 'Início', Icon: House },
  { to: '/resumo', label: 'Resumo', Icon: ChartLineUp },
  { to: '/financeiro', label: 'Financeiro', Icon: Wallet },
  { to: '/moradores', label: 'Moradores', Icon: Users },
  { to: '/mensalidades', label: 'Mensalidades', Icon: Receipt },
  { to: '/pacotes', label: 'Pacotes', Icon: Package },
  { to: '/os', label: 'OS', Icon: Wrench },
  { to: '/senso', label: 'Senso', Icon: MapTrifold },
  { to: '/operadores', label: 'Operadores', Icon: UsersThree },
]

export function Layout() {
  const logout = useAuthStore((s) => s.logout)
  const { unidade, setUnidade } = useUnidade()

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center justify-between border-b border-border px-6 py-3">
        <span className="font-semibold text-marque-500">Painel da Presidência</span>
        <div className="flex items-center gap-4">
          <div className="flex rounded-md border border-border p-0.5">
            {UNIDADES.map((u) => (
              <button
                key={u.key}
                onClick={() => setUnidade(u.key)}
                className={`rounded px-3 py-1 text-xs font-medium transition-colors ${
                  unidade === u.key
                    ? 'bg-marque-500 text-white'
                    : 'text-ink-muted hover:text-ink'
                }`}
              >
                {u.label}
              </button>
            ))}
          </div>
          <button
            onClick={logout}
            className="flex items-center gap-1.5 text-sm text-ink-muted hover:text-ink"
          >
            <SignOut size={16} weight="regular" /> Sair
          </button>
        </div>
      </header>
      <nav className="flex gap-1 overflow-x-auto border-b border-border px-4 py-2">
        {TABS.map(({ to, label, Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors ${
                isActive
                  ? 'bg-marque-500 text-white'
                  : 'text-ink-muted hover:bg-surface-muted hover:text-ink'
              }`
            }
          >
            {({ isActive }) => (
              <>
                <Icon size={16} weight={isActive ? 'fill' : 'regular'} />
                {label}
              </>
            )}
          </NavLink>
        ))}
      </nav>
      <main className="min-h-0 flex-1 overflow-x-auto bg-surface-muted px-6 py-6">
        <Outlet />
      </main>
    </div>
  )
}
