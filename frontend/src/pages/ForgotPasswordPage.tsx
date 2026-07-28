import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Loader2, Mail } from 'lucide-react'
import api from '../services/api'

export default function ForgotPasswordPage() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email) return
    setLoading(true)
    try {
      await api.post('/auth/forgot-password', { email })
      setSent(true)
    } catch {
      // resposta do backend ja e' generica — mesmo em erro de rede, nao revela nada extra
      setSent(true)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-sm border border-gray-100 p-8">
        <img src="/logo.png" alt="" className="h-8 w-auto object-contain mb-6" />
        <h1 className="text-lg font-semibold text-[#1a3f6f] mb-1">Esqueci minha senha</h1>

        {!sent ? (
          <>
            <p className="text-sm text-gray-500 mb-6">
              Informe seu e-mail cadastrado. Se existir uma conta, você receberá um link para
              redefinir sua senha.
            </p>
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="email"
                  required
                  autoFocus
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full pl-10 pr-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#26619c]/40 focus:border-[#26619c]"
                  placeholder="seu@email.com"
                />
              </div>
              <button
                type="submit"
                disabled={loading || !email}
                className="w-full flex items-center justify-center gap-2 bg-[#26619c] hover:bg-[#1a4f87] text-white py-3 rounded-xl font-semibold transition disabled:opacity-50"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Enviar link'}
              </button>
            </form>
          </>
        ) : (
          <p className="text-sm text-gray-600">
            Se este e-mail estiver cadastrado, você receberá um link para redefinir sua senha em
            instantes. Confira também a caixa de spam.
          </p>
        )}

        <button
          type="button"
          onClick={() => navigate('/login')}
          className="mt-6 text-xs text-gray-400 hover:text-[#26619c]"
        >
          ← voltar pro login
        </button>
      </div>
    </div>
  )
}
