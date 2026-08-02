import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { RequireAuth } from './components/RequireAuth'
import { Layout } from './components/Layout'
import { LoginPage } from './pages/LoginPage'
import { BootPage } from './pages/BootPage'
import { InicioPage } from './pages/InicioPage'
import { ResumoPage } from './pages/ResumoPage'
import { FinanceiroPage } from './pages/FinanceiroPage'
import { MoradoresPage } from './pages/MoradoresPage'
import { MensalidadesPage } from './pages/MensalidadesPage'
import { PacotesPage } from './pages/PacotesPage'
import { OsPage } from './pages/OsPage'
import { SensoPage } from './pages/SensoPage'
import { OperadoresPage } from './pages/OperadoresPage'
import { UnidadeProvider } from './lib/UnidadeContext'
import { PeriodoProvider } from './lib/PeriodoContext'

function App() {
  return (
    <UnidadeProvider>
      <PeriodoProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route element={<RequireAuth />}>
              <Route path="/carregando" element={<BootPage />} />
              <Route element={<Layout />}>
                <Route path="/inicio" element={<InicioPage />} />
                <Route path="/resumo" element={<ResumoPage />} />
                <Route path="/financeiro" element={<FinanceiroPage />} />
                <Route path="/moradores" element={<MoradoresPage />} />
                <Route path="/mensalidades" element={<MensalidadesPage />} />
                <Route path="/pacotes" element={<PacotesPage />} />
                <Route path="/os" element={<OsPage />} />
                <Route path="/senso" element={<SensoPage />} />
                <Route path="/operadores" element={<OperadoresPage />} />
              </Route>
            </Route>
            <Route path="*" element={<Navigate to="/inicio" replace />} />
          </Routes>
        </BrowserRouter>
      </PeriodoProvider>
    </UnidadeProvider>
  )
}

export default App
