import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { EnvelopeSimple, LockSimple, CircleNotch } from '@phosphor-icons/react'
import { listAssociationsForEmail, login, type OrgOption } from '../lib/api'
import { useAuthStore } from '../lib/authStore'

export function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(true)
  const [orgs, setOrgs] = useState<OrgOption[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const setToken = useAuthStore((s) => s.setToken)
  const navigate = useNavigate()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const found = await listAssociationsForEmail(email)
      if (found.length === 0) {
        setError('Nenhuma organização encontrada para este e-mail.')
        return
      }
      if (found.length > 1) {
        setOrgs(found)
        return
      }
      const token = await login(email, password, found[0].id)
      setToken(token, remember)
      navigate('/inicio')
    } catch {
      setError('Credenciais inválidas ou sem acesso ao painel da presidência.')
    } finally {
      setLoading(false)
    }
  }

  async function handleOrgSelect(org: OrgOption) {
    setError(null)
    setLoading(true)
    try {
      const token = await login(email, password, org.id)
      setToken(token, remember)
      navigate('/inicio')
    } catch {
      setError('Credenciais inválidas ou sem acesso ao painel da presidência.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-[#0f0a1e] p-4">
      <div
        className="absolute inset-0 opacity-10"
        style={{
          backgroundImage:
            'radial-gradient(circle at 25% 25%, #7c6dec 0%, transparent 50%), radial-gradient(circle at 75% 75%, #4f3fe0 0%, transparent 50%)',
        }}
      />

      <div className="relative w-full max-w-sm">
        <div className="overflow-hidden rounded-2xl bg-white shadow-2xl">
          <div className="bg-[#1a1030] px-8 py-7 text-center">
            <img src="/logo.png" alt="APRXM" className="mx-auto mb-2 h-10 w-auto object-contain" />
            <p className="text-xs text-marque-300/70">Painel da Presidência</p>
          </div>

          <div className="px-8 py-7">
            {error && (
              <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{error}</p>
            )}

            {orgs ? (
              <div className="flex flex-col gap-3">
                <div className="mb-1 flex items-center gap-2">
                  <button onClick={() => setOrgs(null)} className="text-xs text-gray-400 hover:text-gray-600">← voltar</button>
                  <p className="text-sm font-semibold text-gray-700">Selecione a organização</p>
                </div>
                {orgs.map((org) => (
                  <button
                    key={org.id}
                    onClick={() => handleOrgSelect(org)}
                    disabled={loading}
                    className="group flex items-center gap-3 rounded-xl border border-gray-200 p-4 text-left transition hover:border-[#4f3fe0] hover:bg-marque-50 disabled:opacity-50"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold leading-tight text-gray-800">{org.name}</p>
                      <p className="mt-0.5 text-xs capitalize text-gray-400">{org.role}</p>
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="flex flex-col gap-4">
                <div>
                  <p className="mb-1 text-xs text-gray-500">E-mail</p>
                  <div className="relative">
                    <EnvelopeSimple className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                    <input
                      type="email"
                      required
                      autoFocus
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="seu@email.com"
                      className="w-full rounded-xl border border-gray-200 py-3 pl-10 pr-4 text-sm focus:border-[#4f3fe0] focus:outline-none focus:ring-2 focus:ring-[#4f3fe0]/30"
                    />
                  </div>
                </div>

                <div>
                  <p className="mb-1 text-xs text-gray-500">Senha</p>
                  <div className="relative">
                    <LockSimple className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                    <input
                      type="password"
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Senha"
                      className="w-full rounded-xl border border-gray-200 py-3 pl-10 pr-4 text-sm focus:border-[#4f3fe0] focus:outline-none focus:ring-2 focus:ring-[#4f3fe0]/30"
                    />
                  </div>
                </div>

                <label className="flex cursor-pointer select-none items-center gap-2">
                  <input
                    type="checkbox"
                    checked={remember}
                    onChange={(e) => setRemember(e.target.checked)}
                    className="h-4 w-4 rounded accent-[#4f3fe0]"
                  />
                  <span className="text-xs text-gray-500">Lembrar de mim neste dispositivo</span>
                </label>

                <button
                  type="submit"
                  disabled={loading || !email || !password}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#4f3fe0] py-3 font-semibold text-white transition hover:bg-[#3d2fb8] disabled:opacity-50"
                >
                  {loading ? <CircleNotch className="h-4 w-4 animate-spin" /> : 'Entrar'}
                </button>
              </form>
            )}
          </div>
        </div>

        <p className="mt-5 text-center text-xs text-marque-300/40">
          Painel da Presidência · Instituto Tia Pretinha
        </p>
      </div>
    </div>
  )
}
