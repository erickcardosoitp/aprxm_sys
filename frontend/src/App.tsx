import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { lazy, Suspense, Component } from 'react'
import type { ReactNode } from 'react'
import { Toaster } from 'react-hot-toast'
import { AppShell } from './components/layout/AppShell'
import { useAuthStore } from './store/authStore'

// Retry lazy imports once — reloads if chunk hash changed after deploy
function lazyWithReload(factory: () => Promise<{ default: React.ComponentType<any> }>) {
  return lazy(() =>
    factory().catch((e: Error) => {
      const isChunkError =
        e.name === 'ChunkLoadError' ||
        e.message?.includes('Failed to fetch dynamically imported module') ||
        e.message?.includes('Importing a module script failed')
      if (isChunkError) {
        window.location.reload()
        return new Promise<never>(() => {})
      }
      throw e
    })
  )
}

class ChunkErrorBoundary extends Component<{ children: ReactNode }, { crashed: boolean }> {
  state = { crashed: false }
  componentDidCatch(e: Error) {
    if (
      e.message?.includes('Failed to fetch dynamically imported module') ||
      e.message?.includes('Importing a module script failed')
    ) {
      window.location.reload()
    }
    this.setState({ crashed: true })
  }
  render() {
    if (this.state.crashed) return null
    return this.props.children
  }
}

const SimplificaLayout     = lazyWithReload(() => import('./pages/simplifica/SimplificaLayout'))
const SimplificaHome       = lazyWithReload(() => import('./pages/simplifica/SimplificaHome'))
const SimplificaCaixa      = lazyWithReload(() => import('./pages/simplifica/SimplificaCaixa'))
const SimplificaEncomendas = lazyWithReload(() => import('./pages/simplifica/SimplificaEncomendas'))
const SimplificaMoradores  = lazyWithReload(() => import('./pages/simplifica/SimplificaMoradores'))
const SimplificaOrdens     = lazyWithReload(() => import('./pages/simplifica/SimplificaOrdens'))
const SimplificaChat       = lazyWithReload(() => import('./pages/simplifica/SimplificaChat'))
const SimplificaConfig     = lazyWithReload(() => import('./pages/simplifica/SimplificaConfig'))

// Carregamento imediato — rotas críticas de primeiro acesso
import LoginPage from './pages/LoginPage'
import OverviewPage from './pages/overview/OverviewPage'
import PublicRegisterPage from './pages/public/PublicRegisterPage'
import PublicUpdatePage from './pages/public/PublicUpdatePage'
import CadastroPortaAPorta from './pages/public/CadastroPortaAPorta'

// Lazy — carregados sob demanda, auto-reload se chunk mudar após deploy
const FinancePage       = lazyWithReload(() => import('./pages/finance/FinancePage'))
const PackagesPage      = lazyWithReload(() => import('./pages/packages/PackagesPage'))
const ResidentsPage     = lazyWithReload(() => import('./pages/residents/ResidentsPage'))
const ServiceOrdersPage = lazyWithReload(() => import('./pages/service_orders/ServiceOrdersPage'))
const AdminPage         = lazyWithReload(() => import('./pages/admin/AdminPage'))
const SettingsPage      = lazyWithReload(() => import('./pages/settings/SettingsPage'))
const FinanceiroPage    = lazyWithReload(() => import('./pages/financeiro/FinanceiroPage'))
const GeralPage         = lazyWithReload(() => import('./pages/geral/GeralPage'))
const ReportsPage       = lazyWithReload(() => import('./pages/reports/ReportsPage'))
const LogsPage          = lazyWithReload(() => import('./pages/logs/LogsPage'))
const TIPage            = lazyWithReload(() => import('./pages/ti/TIPage'))
const ChatPage          = lazyWithReload(() => import('./pages/chat/ChatPage'))
const HelpPage          = lazyWithReload(() => import('./pages/help/HelpPage'))
const CRMPage           = lazyWithReload(() => import('./pages/crm/CRMPage'))

function PageLoader() {
  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="w-6 h-6 border-2 border-[#26619c] border-t-transparent rounded-full animate-spin" />
    </div>
  )
}

function RequireAuth({ children }: { children: React.ReactNode }) {
  const isAuth = useAuthStore((s) => s.isAuthenticated())
  return isAuth ? <>{children}</> : <Navigate to="/login" replace />
}

function RequireAdmin({ children }: { children: React.ReactNode }) {
  const role = useAuthStore((s) => s.role)
  if (role !== 'admin' && role !== 'superadmin' && role !== 'diretoria') return <Navigate to="/overview" replace />
  return <>{children}</>
}

function RequireSuperAdmin({ children }: { children: React.ReactNode }) {
  const role = useAuthStore((s) => s.role)
  if (role !== 'superadmin' && role !== 'admin_master') return <Navigate to="/overview" replace />
  return <>{children}</>
}

function RedirectByRole() {
  const role             = useAuthStore((s) => s.role)
  const isOffice         = useAuthStore((s) => s.isOffice)
  const simplificaMode   = useAuthStore((s) => s.simplificaMode)
  const simplificaEnabled = useAuthStore((s) => s.simplificaEnabled)
  if (simplificaMode && simplificaEnabled) return <Navigate to="/simplifica" replace />
  if (isOffice) return <Navigate to="/geral" replace />
  if (role === 'agente') return <Navigate to="/crm" replace />
  if (role === 'operator' || role === 'viewer') return <Navigate to="/finance" replace />
  return <Navigate to="/overview" replace />
}

function RequireSimplificaEnabled({ children }: { children: React.ReactNode }) {
  const simplificaEnabled = useAuthStore((s) => s.simplificaEnabled)
  if (simplificaEnabled === false) return <Navigate to="/" replace />
  return <>{children}</>
}

function RequireAggregator({ children }: { children: React.ReactNode }) {
  const isAggregator = useAuthStore((s) => s.isAggregator())
  if (!isAggregator) return <Navigate to="/overview" replace />
  return <>{children}</>
}

function RequireNotOffice({ children }: { children: React.ReactNode }) {
  const isOffice = useAuthStore((s) => s.isOffice)
  if (isOffice) return <Navigate to="/geral" replace />
  return <>{children}</>
}

function RequireModule({ module, children }: { module: string; children: React.ReactNode }) {
  const role = useAuthStore((s) => s.role)
  const permissions = useAuthStore((s) => s.permissions)
  if (role === 'superadmin' || role === 'admin_master') return <>{children}</>
  if (!permissions) return <>{children}</>
  if (!permissions[module]?.can_view) return <Navigate to="/overview" replace />
  return <>{children}</>
}

export default function App() {
  return (
    <ChunkErrorBoundary>
    <BrowserRouter>
      <Toaster position="top-center" toastOptions={{ duration: 3500 }} />
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/cadastro/:slug" element={<PublicRegisterPage />} />
        <Route path="/atualizar/:slug" element={<PublicUpdatePage />} />
        <Route path="/associar" element={<CadastroPortaAPorta />} />
        <Route
          path="/"
          element={
            <RequireAuth>
              <AppShell />
            </RequireAuth>
          }
        >
          <Route index element={<RedirectByRole />} />
          <Route path="overview"       element={<RequireNotOffice><OverviewPage /></RequireNotOffice>} />
          <Route path="finance"        element={<RequireNotOffice><RequireModule module="finance"><Suspense fallback={<PageLoader />}><FinancePage /></Suspense></RequireModule></RequireNotOffice>} />
          <Route path="packages"       element={<RequireNotOffice><RequireModule module="packages"><Suspense fallback={<PageLoader />}><PackagesPage /></Suspense></RequireModule></RequireNotOffice>} />
          <Route path="service-orders" element={<RequireNotOffice><Suspense fallback={<PageLoader />}><ServiceOrdersPage /></Suspense></RequireNotOffice>} />
          <Route path="residents"      element={<RequireNotOffice><RequireModule module="residents"><Suspense fallback={<PageLoader />}><ResidentsPage /></Suspense></RequireModule></RequireNotOffice>} />
          <Route path="admin"          element={<RequireNotOffice><RequireAdmin><Suspense fallback={<PageLoader />}><AdminPage /></Suspense></RequireAdmin></RequireNotOffice>} />
          <Route path="settings"       element={<RequireNotOffice><RequireModule module="settings"><Suspense fallback={<PageLoader />}><SettingsPage /></Suspense></RequireModule></RequireNotOffice>} />
          <Route path="financeiro"     element={<RequireNotOffice><RequireModule module="settings"><Suspense fallback={<PageLoader />}><FinanceiroPage /></Suspense></RequireModule></RequireNotOffice>} />
          <Route path="reports"        element={<RequireNotOffice><Suspense fallback={<PageLoader />}><ReportsPage /></Suspense></RequireNotOffice>} />
          <Route path="geral"          element={<RequireAggregator><Suspense fallback={<PageLoader />}><GeralPage /></Suspense></RequireAggregator>} />
          <Route path="logs"           element={<RequireNotOffice><RequireAdmin><Suspense fallback={<PageLoader />}><LogsPage /></Suspense></RequireAdmin></RequireNotOffice>} />
          <Route path="ti"             element={<RequireSuperAdmin><Suspense fallback={<PageLoader />}><TIPage /></Suspense></RequireSuperAdmin>} />
          <Route path="chat"           element={<Suspense fallback={<PageLoader />}><ChatPage /></Suspense>} />
          <Route path="crm"            element={<Suspense fallback={<PageLoader />}><CRMPage /></Suspense>} />
          <Route path="agentes"        element={<Navigate to="/crm" replace />} />
          <Route path="help"           element={<Navigate to="/help/abrir-caixa" replace />} />
          <Route path="help/:slug"     element={<Suspense fallback={<PageLoader />}><HelpPage /></Suspense>} />
        </Route>
        {/* Simplifica — layout próprio */}
        <Route
          path="/simplifica"
          element={
            <RequireAuth>
              <RequireSimplificaEnabled>
                <Suspense fallback={<PageLoader />}>
                  <SimplificaLayout />
                </Suspense>
              </RequireSimplificaEnabled>
            </RequireAuth>
          }
        >
          <Route index element={<Suspense fallback={<PageLoader />}><SimplificaHome /></Suspense>} />
          <Route path="caixa"         element={<Suspense fallback={<PageLoader />}><SimplificaCaixa /></Suspense>} />
          <Route path="encomendas"    element={<Suspense fallback={<PageLoader />}><SimplificaEncomendas /></Suspense>} />
          <Route path="moradores"     element={<Suspense fallback={<PageLoader />}><SimplificaMoradores /></Suspense>} />
          <Route path="ordens"        element={<Suspense fallback={<PageLoader />}><SimplificaOrdens /></Suspense>} />
          <Route path="chat"          element={<Suspense fallback={<PageLoader />}><SimplificaChat /></Suspense>} />
          <Route path="configuracoes" element={<Suspense fallback={<PageLoader />}><SimplificaConfig /></Suspense>} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
    </ChunkErrorBoundary>
  )
}
