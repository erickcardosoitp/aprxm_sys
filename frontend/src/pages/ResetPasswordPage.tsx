import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Loader2, Lock } from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../services/api'

export default function ResetPasswordPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token') || ''
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (newPassword.length < 6) {
      toast.error('A senha deve ter pelo menos 6 caracteres.')
      return
    }
    if (newPassword !== confirmPassword) {
      toast.error('As senhas não coincidem.')
      return
    }
    setLoading(true)
    try {
      await api.post('/auth/reset-password', { token, new_password: newPassword })
      toast.success('Senha redefinida com sucesso. Faça login com a nova senha.')
      navigate('/login')
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || 'Não foi possível redefinir a senha.')
    } finally {
      setLoading(false)
    }
  }

  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <div className="w-full max-w-sm bg-white rounded-2xl shadow-sm border border-gray-100 p-8 text-center">
          <p className="text-sm text-gray-600">Link inválido — falta o token de redefinição.</p>
          <button
            type="button"
            onClick={() => navigate('/esqueci-senha')}
            className="mt-4 text-xs text-[#26619c] hover:underline"
          >
            Solicitar novo link
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-sm border border-gray-100 p-8">
        <img src="/logo.png" alt="" className="h-8 w-auto object-contain mb-6" />
        <h1 className="text-lg font-semibold text-[#1a3f6f] mb-1">Redefinir senha</h1>
        <p className="text-sm text-gray-500 mb-6">Escolha uma nova senha para sua conta.</p>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="password"
              required
              autoFocus
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="w-full pl-10 pr-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#26619c]/40 focus:border-[#26619c]"
              placeholder="Nova senha"
            />
          </div>
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="password"
              required
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="w-full pl-10 pr-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#26619c]/40 focus:border-[#26619c]"
              placeholder="Confirmar nova senha"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full flex items-center justify-center gap-2 bg-[#26619c] hover:bg-[#1a4f87] text-white py-3 rounded-xl font-semibold transition disabled:opacity-50"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Redefinir senha'}
          </button>
        </form>

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
