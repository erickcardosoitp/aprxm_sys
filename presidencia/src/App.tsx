import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { RequireAuth } from './components/RequireAuth'
import { Layout } from './components/Layout'
import { LoginPage } from './pages/LoginPage'
import { BootPage } from './pages/BootPage'
import { InicioPage } from './pages/InicioPage'
import { PlaceholderPage } from './pages/PlaceholderPage'
import { UnidadeProvider } from './lib/UnidadeContext'

function App() {
  return (
    <UnidadeProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route element={<RequireAuth />}>
            <Route path="/carregando" element={<BootPage />} />
            <Route element={<Layout />}>
              <Route path="/inicio" element={<InicioPage />} />
              <Route path="/resumo" element={<PlaceholderPage title="Resumo" />} />
              <Route path="/financeiro" element={<PlaceholderPage title="Financeiro" />} />
              <Route path="/moradores" element={<PlaceholderPage title="Moradores" />} />
              <Route path="/mensalidades" element={<PlaceholderPage title="Mensalidades" />} />
              <Route path="/pacotes" element={<PlaceholderPage title="Pacotes" />} />
              <Route path="/os" element={<PlaceholderPage title="OS" />} />
              <Route path="/senso" element={<PlaceholderPage title="Senso" />} />
              <Route path="/operadores" element={<PlaceholderPage title="Operadores" />} />
            </Route>
          </Route>
          <Route path="*" element={<Navigate to="/inicio" replace />} />
        </Routes>
      </BrowserRouter>
    </UnidadeProvider>
  )
}

export default App
