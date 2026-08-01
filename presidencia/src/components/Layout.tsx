import { useEffect, useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import {
  House, ChartLineUp, Wallet, Users, Receipt, Package,
  Wrench, MapTrifold, UsersThree, SignOut, CaretLeft, CaretRight,
} from '@phosphor-icons/react'
import { useAuthStore } from '../lib/authStore'
import { useUnidade } from '../lib/UnidadeContext'
import { UNIDADES } from '../lib/unidade'
import { usePeriodo } from '../lib/PeriodoContext'
import { PERIODOS, periodoLabel } from '../lib/periodo'
import { getStatus } from '../lib/api'

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

function FreshnessCorner() {
  const [generatedAt, setGeneratedAt] = useState<string | null>(null)

  useEffect(() => {
    getStatus().then((res) => setGeneratedAt(res.generated_at)).catch(() => {})
  }, [])

  return (
    <p className="text-[11px] text-ink-muted">
      Última atualização: {generatedAt ? new Date(generatedAt).toLocaleString('pt-BR') : '—'}
    </p>
  )
}

export function Layout() {
  const logout = useAuthStore((s) => s.logout)
  const fullName = useAuthStore((s) => s.fullName)
  const { unidade, setUnidade } = useUnidade()
  const { periodo, setPeriodo, ate, goPrev, goNext, isAtual, goToday } = usePeriodo()
  const firstName = fullName?.split(' ')[0]

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-border bg-surface px-6 py-2.5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="text-lg font-extrabold tracking-tight text-marque-700">APRXM</span>
            <span className="text-xs text-ink-muted">
              {firstName ? `Bem-vindo, ${firstName}` : 'Painel da Presidência'}
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            <button onClick={goPrev} className="rounded p-1 text-ink-muted hover:bg-surface-muted hover:text-ink">
              <CaretLeft size={14} />
            </button>
            <button
              onClick={goToday}
              disabled={isAtual}
              className="min-w-28 rounded px-2 py-0.5 text-center text-sm font-semibold text-marque-700 disabled:cursor-default"
              title={isAtual ? undefined : 'Voltar para o período atual'}
            >
              {periodoLabel(periodo, ate)}
            </button>
            <button onClick={goNext} className="rounded p-1 text-ink-muted hover:bg-surface-muted hover:text-ink">
              <CaretRight size={14} />
            </button>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex rounded-md border border-border p-0.5">
              {PERIODOS.map((p) => (
                <button
                  key={p.key}
                  onClick={() => setPeriodo(p.key)}
                  className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                    periodo === p.key ? 'bg-marque-500 text-white' : 'text-ink-muted hover:text-ink'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <div className="flex rounded-md border border-border p-0.5">
              {UNIDADES.map((u) => (
                <button
                  key={u.key}
                  onClick={() => setUnidade(u.key)}
                  className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                    unidade === u.key ? 'bg-marque-500 text-white' : 'text-ink-muted hover:text-ink'
                  }`}
                >
                  {u.label}
                </button>
              ))}
            </div>
            <button
              onClick={logout}
              className="flex items-center gap-1 text-xs text-ink-muted hover:text-ink"
            >
              <SignOut size={14} weight="regular" /> Sair
            </button>
          </div>
        </div>
        <div className="mt-1 flex justify-end">
          <FreshnessCorner />
        </div>
      </header>
      <nav className="flex gap-1 overflow-x-auto border-b border-border bg-surface px-4 py-2">
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
