import { useState } from 'react'
import { DollarSign, Lock, Unlock, User } from 'lucide-react'
import toast from 'react-hot-toast'
import { financeService } from '../../services/finance'
import { useAuthStore } from '../../store/authStore'
import type { CashSession } from '../../types'

interface Props {
  session: CashSession | null
  onRefresh: () => void
}

export function CashSessionPanel({ session, onRefresh }: Props) {
  const fullName = useAuthStore((s) => s.fullName)
  const [openBalance, setOpenBalance] = useState('')
  const [closeBalance, setCloseBalance] = useState('')
  const [loading, setLoading] = useState(false)

  const handleOpen = async () => {
    setLoading(true)
    try {
      await financeService.openSession(parseFloat(openBalance) || 0)
      toast.success('Caixa aberto com sucesso!')
      onRefresh()
    } catch (e: any) {
      toast.error(e.response?.data?.detail ?? 'Erro ao abrir caixa.')
    } finally {
      setLoading(false)
    }
  }

  const handleClose = async () => {
    setLoading(true)
    try {
      const res = await financeService.closeSession(parseFloat(closeBalance))
      const diff = parseFloat(res.data.difference ?? '0')
      const msg =
        diff === 0
          ? 'Caixa fechado. Sem diferença.'
          : diff > 0
            ? `Caixa fechado. Sobra de R$ ${diff.toFixed(2)}`
            : `Caixa fechado. Falta de R$ ${Math.abs(diff).toFixed(2)}`
      toast.success(msg)
      onRefresh()
    } catch (e: any) {
      toast.error(e.response?.data?.detail ?? 'Erro ao fechar caixa.')
    } finally {
      setLoading(false)
    }
  }

  if (!session) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-gray-800 mb-4 flex items-center gap-2">
          <DollarSign className="w-5 h-5 text-[#26619c]" />
          Abrir Caixa
        </h2>
        {fullName && (
          <div className="flex items-center gap-2 mb-4 text-sm text-gray-600 bg-gray-50 rounded-lg px-3 py-2">
            <User className="w-4 h-4 text-gray-400" />
            <span>Operador: <strong>{fullName}</strong></span>
          </div>
        )}
        <label className="block text-sm text-gray-600 mb-1">Saldo inicial (R$)</label>
        <input
          type="number"
          min="0"
          step="0.01"
          value={openBalance}
          onChange={(e) => setOpenBalance(e.target.value)}
          placeholder="0,00"
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mb-4 focus:outline-none focus:ring-2 focus:ring-brand-500"
        />
        <button
          onClick={handleOpen}
          disabled={loading}
          className="w-full flex items-center justify-center gap-2 bg-brand-600 hover:bg-brand-700 text-white py-2.5 rounded-lg font-medium transition disabled:opacity-50"
        >
          <Unlock className="w-4 h-4" />
          {loading ? 'Abrindo…' : 'Abrir Caixa'}
        </button>
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-green-200 bg-green-50 p-6 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-green-800 flex items-center gap-2">
          <Unlock className="w-5 h-5" />
          Caixa Aberto
        </h2>
        <span className="text-xs text-green-600 bg-green-100 px-2 py-1 rounded-full">
          Desde {new Date(session.opened_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>

      <p className="text-sm text-gray-600 mb-4">
        Saldo inicial: <strong>R$ {parseFloat(session.opening_balance).toFixed(2)}</strong>
      </p>

      <div className="border-t border-green-200 pt-4">
        <p className="text-sm font-medium text-gray-700 mb-1">Fechamento Cego</p>
        <p className="text-xs text-gray-500 mb-3">Informe o valor contado sem ver o sistema.</p>
        <input
          type="number"
          min="0"
          step="0.01"
          value={closeBalance}
          onChange={(e) => setCloseBalance(e.target.value)}
          placeholder="Valor contado (R$)"
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-brand-500"
        />
        <button
          onClick={handleClose}
          disabled={loading || !closeBalance}
          className="w-full flex items-center justify-center gap-2 bg-red-600 hover:bg-red-700 text-white py-2.5 rounded-lg font-medium transition disabled:opacity-50"
        >
          <Lock className="w-4 h-4" />
          {loading ? 'Fechando…' : 'Fechar Caixa'}
        </button>
      </div>
    </div>
  )
}
