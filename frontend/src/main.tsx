import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Analytics } from '@vercel/analytics/react'
import App from './App'
import { ErrorBoundary } from './ErrorBoundary'
import { useAuthStore } from './store/authStore'
import './index.css'

// Mock local do ESC (?mockesc=1&real=1): loga de verdade contra o backend
// local (token valido, dado real do banco de teste) e so forca
// associationId = empresaId no cliente pra satisfazer isEsc() — o token em
// si e legitimo, entao endpoints novos protegidos funcionam normalmente.
// TEMPORARIO: remover quando o spec ESC-associacao (login real) for implementado.
async function bootstrapEscRealMock() {
  const params = new URLSearchParams(window.location.search)
  if (!(import.meta.env.DEV && params.has('mockesc') && params.has('real'))) return
  try {
    const res = await fetch('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'erickcardoso@institutotiapretinha.org', password: 'local123' }),
    })
    if (!res.ok) return
    const data = await res.json()
    const token: string = data.access_token
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
    useAuthStore.getState().setAuth(
      token, payload.sub, payload.empresa_id, payload.role, payload.full_name ?? '',
      payload.linked_association_ids ?? [], 'Escritório', false, false, payload.empresa_id,
    )
  } catch { /* silencioso — cai no fluxo normal de login se falhar */ }
}
void bootstrapEscRealMock()

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <App />
        <Analytics />
      </QueryClientProvider>
    </ErrorBoundary>
  </React.StrictMode>,
)
