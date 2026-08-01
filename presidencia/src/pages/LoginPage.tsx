import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { listAssociationsForEmail, login, type OrgOption } from '../lib/api'
import { useAuthStore } from '../lib/authStore'

type Step = 'email' | 'org' | 'password'

export function LoginPage() {
  const [step, setStep] = useState<Step>('email')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [orgs, setOrgs] = useState<OrgOption[]>([])
  const [selectedOrg, setSelectedOrg] = useState<OrgOption | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const setToken = useAuthStore((s) => s.setToken)
  const navigate = useNavigate()

  async function handleEmailSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const found = await listAssociationsForEmail(email)
      if (found.length === 0) {
        setError('Nenhuma organização encontrada para este e-mail.')
        return
      }
      setOrgs(found)
      if (found.length === 1) {
        setSelectedOrg(found[0])
        setStep('password')
      } else {
        setStep('org')
      }
    } catch {
      setError('Erro ao buscar organizações.')
    } finally {
      setLoading(false)
    }
  }

  function handleOrgSelect(org: OrgOption) {
    setSelectedOrg(org)
    setStep('password')
  }

  async function handlePasswordSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedOrg) return
    setError(null)
    setLoading(true)
    try {
      const token = await login(email, password, selectedOrg.id)
      setToken(token)
      navigate('/inicio')
    } catch {
      setError('Credenciais inválidas ou sem acesso ao painel da presidência.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-muted">
      <div className="w-full max-w-sm space-y-4 rounded-xl border border-border bg-surface p-8">
        <div>
          <h1 className="text-xl font-semibold text-marque-500">Painel da Presidência</h1>
          <p className="text-sm text-ink-muted">Instituto Tia Pretinha</p>
        </div>
        {error && <p className="rounded bg-red-100 px-3 py-2 text-sm text-red-700">{error}</p>}

        {step === 'email' && (
          <form onSubmit={handleEmailSubmit} className="space-y-4">
            <div className="space-y-1">
              <label className="text-sm text-ink-muted">E-mail</label>
              <input
                type="email"
                required
                autoFocus
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-marque-500"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-md bg-marque-500 px-3 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
            >
              {loading ? 'Buscando...' : 'Continuar'}
            </button>
          </form>
        )}

        {step === 'org' && (
          <div className="space-y-2">
            <p className="text-sm text-ink-muted">Escolha a associação:</p>
            {orgs.map((org) => (
              <button
                key={org.id}
                onClick={() => handleOrgSelect(org)}
                className="w-full rounded-md border border-border px-3 py-2 text-left text-sm hover:border-marque-500"
              >
                {org.name}
              </button>
            ))}
          </div>
        )}

        {step === 'password' && (
          <form onSubmit={handlePasswordSubmit} className="space-y-4">
            <p className="text-sm text-ink-muted">{selectedOrg?.name}</p>
            <div className="space-y-1">
              <label className="text-sm text-ink-muted">Senha</label>
              <input
                type="password"
                required
                autoFocus
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-marque-500"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-md bg-marque-500 px-3 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
            >
              {loading ? 'Entrando...' : 'Entrar'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
