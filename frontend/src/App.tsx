import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import { AppShell } from './components/layout/AppShell'
import LoginPage from './pages/LoginPage'
import OverviewPage from './pages/overview/OverviewPage'
import FinancePage from './pages/finance/FinancePage'
import PackagesPage from './pages/packages/PackagesPage'
import ResidentsPage from './pages/residents/ResidentsPage'
import ServiceOrdersPage from './pages/service_orders/ServiceOrdersPage'
import AdminPage from './pages/admin/AdminPage'
import SettingsPage from './pages/settings/SettingsPage'
import FinanceiroPage from './pages/financeiro/FinanceiroPage'
import GeralPage from './pages/geral/GeralPage'
import SuperAdminPage from './pages/superadmin/SuperAdminPage'
import LogsPage from './pages/logs/LogsPage'
import { useAuthStore } from './store/authStore'
import PublicRegisterPage from './pages/public/PublicRegisterPage'
import PublicUpdatePage from './pages/public/PublicUpdatePage'
import CadastroPortaAPorta from './pages/public/CadastroPortaAPorta'

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
  const isAggregator = useAuthStore((s) => s.isAggregator())
  if (isAggregator) return <Navigate to="/geral" replace />
  if (role === 'operator' || role === 'viewer') return <Navigate to="/finance" replace />
  return <Navigate to="/overview" replace />
}

function RequireAggregator({ children }: { children: React.ReactNode }) {
  const isAggregator = useAuthStore((s) => s.isAggregator())
  if (!isAggregator) return <Navigate to="/overview" replace />
  return <>{children}</>
}

function RequireModule({ module, children }: { module: string; children: React.ReactNode }) {
  const role = useAuthStore((s) => s.role)
  const permissions = useAuthStore((s) => s.permissions)
  if (role === 'superadmin' || role === 'admin_master') return <>{children}</>
  if (!permissions) return <>{children}</>  // loading
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
          <Route path="overview"       element={<OverviewPage />} />
          <Route path="finance"        element={<RequireModule module="finance"><FinancePage /></RequireModule>} />
          <Route path="packages"       element={<RequireModule module="packages"><PackagesPage /></RequireModule>} />
          <Route path="service-orders" element={<RequireModule module="service_orders"><ServiceOrdersPage /></RequireModule>} />
          <Route path="residents"      element={<RequireModule module="residents"><ResidentsPage /></RequireModule>} />
          <Route path="admin"          element={<RequireAdmin><AdminPage /></RequireAdmin>} />
          <Route path="settings"       element={<RequireModule module="settings"><SettingsPage /></RequireModule>} />
          <Route path="financeiro"     element={<RequireModule module="settings"><FinanceiroPage /></RequireModule>} />
          <Route path="geral"          element={<RequireAggregator><GeralPage /></RequireAggregator>} />
          <Route path="superadmin"     element={<RequireSuperAdmin><SuperAdminPage /></RequireSuperAdmin>} />
          <Route path="logs"           element={<RequireAdmin><LogsPage /></RequireAdmin>} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
