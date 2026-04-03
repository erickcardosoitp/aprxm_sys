import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import { AppShell } from './components/layout/AppShell'
import LoginPage from './pages/LoginPage'
import FinancePage from './pages/finance/FinancePage'
import PackagesPage from './pages/packages/PackagesPage'
import ResidentsPage from './pages/residents/ResidentsPage'
import ServiceOrdersPage from './pages/service_orders/ServiceOrdersPage'
import AdminPage from './pages/admin/AdminPage'
import SettingsPage from './pages/settings/SettingsPage'
import { useAuthStore } from './store/authStore'

function RequireAuth({ children }: { children: React.ReactNode }) {
  const isAuth = useAuthStore((s) => s.isAuthenticated())
  return isAuth ? <>{children}</> : <Navigate to="/login" replace />
}

function RequireAdmin({ children }: { children: React.ReactNode }) {
  const role = useAuthStore((s) => s.role)
  if (role !== 'admin' && role !== 'superadmin') return <Navigate to="/finance" replace />
  return <>{children}</>
}

function RequireConferente({ children }: { children: React.ReactNode }) {
  const role = useAuthStore((s) => s.role)
  if (role !== 'admin' && role !== 'superadmin' && role !== 'conferente') return <Navigate to="/finance" replace />
  return <>{children}</>
}

export default function App() {
  return (
    <BrowserRouter>
      <Toaster position="top-center" toastOptions={{ duration: 3500 }} />
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/"
          element={
            <RequireAuth>
              <AppShell />
            </RequireAuth>
          }
        >
          <Route index element={<Navigate to="/finance" replace />} />
          <Route path="finance" element={<FinancePage />} />
          <Route path="packages" element={<PackagesPage />} />
          <Route path="service-orders" element={<ServiceOrdersPage />} />
          <Route path="residents" element={<ResidentsPage />} />
          <Route path="admin" element={<RequireAdmin><AdminPage /></RequireAdmin>} />
          <Route path="settings" element={<RequireConferente><SettingsPage /></RequireConferente>} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
