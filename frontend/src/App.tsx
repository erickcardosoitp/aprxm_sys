import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { lazy, Suspense } from 'react'
import { Toaster } from 'react-hot-toast'
import { AppShell } from './components/layout/AppShell'
import { useAuthStore } from './store/authStore'

// Carregamento imediato — rotas críticas de primeiro acesso
import LoginPage from './pages/LoginPage'
import OverviewPage from './pages/overview/OverviewPage'
import PublicRegisterPage from './pages/public/PublicRegisterPage'
import PublicUpdatePage from './pages/public/PublicUpdatePage'
import CadastroPortaAPorta from './pages/public/CadastroPortaAPorta'

// Lazy — carregados sob demanda, reduz bundle inicial de 2.6MB para ~400KB
const FinancePage       = lazy(() => import('./pages/finance/FinancePage'))
const PackagesPage      = lazy(() => import('./pages/packages/PackagesPage'))
const ResidentsPage     = lazy(() => import('./pages/residents/ResidentsPage'))
const ServiceOrdersPage = lazy(() => import('./pages/service_orders/ServiceOrdersPage'))
const AdminPage         = lazy(() => import('./pages/admin/AdminPage'))
const SettingsPage      = lazy(() => import('./pages/settings/SettingsPage'))
const FinanceiroPage    = lazy(() => import('./pages/financeiro/FinanceiroPage'))
const GeralPage         = lazy(() => import('./pages/geral/GeralPage'))
const ReportsPage       = lazy(() => import('./pages/reports/ReportsPage'))
const SuperAdminPage    = lazy(() => import('./pages/superadmin/SuperAdminPage'))
const LogsPage          = lazy(() => import('./pages/logs/LogsPage'))
const ChatPage          = lazy(() => import('./pages/chat/ChatPage'))
const HelpPage          = lazy(() => import('./pages/help/HelpPage'))

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
  if (role !== 'superadmin') return <Navigate to="/overview" replace />
  return <>{children}</>
}

function RedirectByRole() {
  const role = useAuthStore((s) => s.role)
  const isOffice = useAuthStore((s) => s.isOffice)
  if (isOffice) return <Navigate to="/geral" replace />
  if (role === 'operator' || role === 'viewer') return <Navigate to="/finance" replace />
  return <Navigate to="/overview" replace />
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
          <Route path="superadmin"     element={<RequireSuperAdmin><Suspense fallback={<PageLoader />}><SuperAdminPage /></Suspense></RequireSuperAdmin>} />
          <Route path="logs"           element={<RequireNotOffice><RequireAdmin><Suspense fallback={<PageLoader />}><LogsPage /></Suspense></RequireAdmin></RequireNotOffice>} />
          <Route path="chat"           element={<Suspense fallback={<PageLoader />}><ChatPage /></Suspense>} />
          <Route path="help"           element={<Navigate to="/help/abrir-caixa" replace />} />
          <Route path="help/:slug"     element={<Suspense fallback={<PageLoader />}><HelpPage /></Suspense>} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
