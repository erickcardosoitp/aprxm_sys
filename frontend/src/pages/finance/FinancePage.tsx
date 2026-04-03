import { useEffect, useState } from 'react'
import { ArrowDownLeft, ArrowUpRight, Plus, RefreshCw } from 'lucide-react'
import toast from 'react-hot-toast'
import { CashSessionPanel } from '../../components/finance/CashSessionPanel'
import { SangriaModal } from '../../components/finance/SangriaModal'
import { TransactionModal } from '../../components/finance/TransactionModal'
import { financeService } from '../../services/finance'
import type { CashSession, Transaction } from '../../types'

const TYPE_LABELS: Record<string, string> = {
  income: 'Entrada',
  expense: 'Saída',
  sangria: 'Sangria',
}

const TYPE_COLORS: Record<string, string> = {
  income: 'text-green-600',
  expense: 'text-red-600',
  sangria: 'text-amber-600',
}

export default function FinancePage() {
  const [session, setSession] = useState<CashSession | null>(null)
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [showSangria, setShowSangria] = useState(false)
  const [showTransaction, setShowTransaction] = useState(false)
  const [loadingTx, setLoadingTx] = useState(false)

  const loadSession = async () => {
    try {
      const res = await financeService.getCurrentSession()
      setSession(res.data)
    } catch {
      setSession(null)
    }
  }

  const loadTransactions = async () => {
    if (!session) return
    setLoadingTx(true)
    try {
      const res = await financeService.listTransactions()
      setTransactions(res.data)
    } catch {
      toast.error('Erro ao carregar transações.')
    } finally {
      setLoadingTx(false)
    }
  }

  useEffect(() => { loadSession() }, [])
  useEffect(() => { loadTransactions() }, [session?.id])

  const income = transactions
    .filter((t) => t.type === 'income')
    .reduce((s, t) => s + parseFloat(t.amount), 0)

  const expenses = transactions
    .filter((t) => t.type !== 'income')
    .reduce((s, t) => s + parseFloat(t.amount), 0)

  return (
    <div className="flex flex-col gap-6 p-4 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900">Frente de Caixa</h1>

      <CashSessionPanel session={session} onRefresh={loadSession} />

      {session && (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-green-50 rounded-xl p-4 border border-green-100">
              <p className="text-xs text-green-600 font-medium mb-1">Total Entradas</p>
              <p className="text-xl font-bold text-green-700">R$ {income.toFixed(2)}</p>
            </div>
            <div className="bg-red-50 rounded-xl p-4 border border-red-100">
              <p className="text-xs text-red-600 font-medium mb-1">Total Saídas</p>
              <p className="text-xl font-bold text-red-700">R$ {expenses.toFixed(2)}</p>
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-3">
            <button
              onClick={() => setShowTransaction(true)}
              className="flex-1 flex items-center justify-center gap-2 bg-[#26619c] hover:bg-[#1a4f87] text-white py-2.5 rounded-xl text-sm font-semibold transition"
            >
              <Plus className="w-4 h-4" />
              Nova Transação
            </button>
            <button
              onClick={() => setShowSangria(true)}
              className="flex items-center justify-center gap-2 border border-amber-400 text-amber-600 py-2.5 px-4 rounded-xl text-sm font-medium hover:bg-amber-50 transition"
            >
              <ArrowDownLeft className="w-4 h-4" />
              Sangria
            </button>
            <button
              onClick={loadTransactions}
              className="flex items-center justify-center gap-2 border border-gray-300 text-gray-600 py-2.5 px-3 rounded-xl text-sm hover:bg-gray-50 transition"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>

          {/* Transactions list */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100">
              <h3 className="font-semibold text-gray-800">Movimentações do Caixa</h3>
            </div>
            {loadingTx ? (
              <div className="p-6 text-center text-gray-400 text-sm">Carregando…</div>
            ) : transactions.length === 0 ? (
              <div className="p-6 text-center text-gray-400 text-sm">
                Nenhuma movimentação ainda.
              </div>
            ) : (
              <ul className="divide-y divide-gray-100">
                {transactions.map((tx) => (
                  <li key={tx.id} className="flex items-center justify-between px-4 py-3">
                    <div>
                      <p className="text-sm font-medium text-gray-800">{tx.description}</p>
                      <p className="text-xs text-gray-400">
                        {new Date(tx.transaction_at).toLocaleString('pt-BR')}
                        {' · '}
                        <span className={TYPE_COLORS[tx.type]}>{TYPE_LABELS[tx.type]}</span>
                      </p>
                    </div>
                    <span className={`text-sm font-semibold ${tx.type === 'income' ? 'text-green-600' : 'text-red-600'}`}>
                      {tx.type === 'income' ? '+' : '-'} R$ {parseFloat(tx.amount).toFixed(2)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}

      {showSangria && (
        <SangriaModal onClose={() => setShowSangria(false)} onSuccess={loadTransactions} />
      )}

      {showTransaction && session && (
        <TransactionModal
          onClose={() => setShowTransaction(false)}
          onSuccess={loadTransactions}
        />
      )}
    </div>
  )
}
