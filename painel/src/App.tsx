import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { RequireAuth } from './components/RequireAuth'
import { Layout } from './components/Layout'
import { LoginPage } from './pages/LoginPage'
import { EmpresasPage } from './pages/EmpresasPage'
import { CriarEmpresaPage } from './pages/CriarEmpresaPage'
import { EmpresaDetailPage } from './pages/EmpresaDetailPage'
import { CriarAssociacaoPage } from './pages/CriarAssociacaoPage'
import { ProvisioningRunsPage } from './pages/ProvisioningRunsPage'

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<RequireAuth />}>
          <Route element={<Layout />}>
            <Route path="/empresas" element={<EmpresasPage />} />
            <Route path="/empresas/nova" element={<CriarEmpresaPage />} />
            <Route path="/empresas/:empresaId" element={<EmpresaDetailPage />} />
            <Route path="/empresas/:empresaId/associacoes/nova" element={<CriarAssociacaoPage />} />
            <Route path="/provisioning-runs" element={<ProvisioningRunsPage />} />
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/empresas" replace />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
