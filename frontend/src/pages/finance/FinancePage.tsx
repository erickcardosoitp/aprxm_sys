import { useEffect, useState } from 'react'
import { ArrowDownLeft, List, Plus, RefreshCw } from 'lucide-react'
import toast from 'react-hot-toast'
import { CashSessionPanel } from '../../components/finance/CashSessionPanel'
import { SangriaModal } from '../../components/finance/SangriaModal'
import { TransactionModal } from '../../components/finance/TransactionModal'
import { financeService } from '../../services/finance'
import type { CashSession, CashSessionSummary, Transaction } from '../../types'

const TYPE_LABELS: Record<string, string> = { income: 'Entrada', expense: 'Saída', sangria: 'Sangria' }
const TYPE_COLORS: Record<string, string> = { income: 'text-green-600', expense: 'text-red-600', sangria: 'text-amber-600' }

type Tab = 'caixa' | 'sessoes'

export default function FinancePage() {
  const [tab, setTab] = useState<Tab>('caixa')
  const [session, setSession] = useState<CashSession | null>(null)
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [showSangria, setShowSangria] = useState(false)
  const [showTransaction, setShowTransaction] = useState(false)
  const [loadingTx, setLoadingTx] = useState(false)
  const [sessions, setSessions] = useState<CashSessionSummary[]>([])
  const [loadingSessions, setLoadingSessions] = useState(false)

  const loadSession = async () => {
    try { const res = await financeService.getCurrentSession(); setSession(res.data) }
    catch { setSession(null) }
  }

  const loadTransactions = async () => {
    if (!session) return
    setLoadingTx(true)
    try { const res = await financeService.listTransactions(); setTransactions(res.data) }
    catch { toast.error('Erro ao carregar transações.') }
    finally { setLoadingTx(false) }
  }

  const loadSessions = async () => {
    setLoadingSessions(true)
    try { const res = await financeService.listSessions(); setSessions(res.data) }
    catch { toast.error('Erro ao carregar sessões.') }
    finally { setLoadingSessions(false) }
  }

  useEffect(() => { loadSession() }, [])
  useEffect(() => { loadTransactions() }, [session?.id])
  useEffect(() => { if (tab === 'sessoes') loadSessions() }, [tab])

  const income = transactions.filter(t => t.type === 'income').reduce((s, t) => s + parseFloat(t.amount), 0)
  const expenses = transactions.filter(t => t.type !== 'income').reduce((s, t) => s + parseFloat(t.amount), 0)

  const fmtBRL = (v: string | undefined) => v != null ? `R$ ${parseFloat(v).toFixed(2)}` : '—'
  const fmtDate = (s: string) => new Date(s).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })

  return (
    <div className="flex flex-col gap-6 p-4 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900">Financeiro</h1>

      {/* Tabs */}
      <div className="flex border-b border-gray-200">
        {([['caixa', 'Frente de Caixa'], ['sessoes', 'Sessões']] as [Tab, string][]).map(([t, label]) => (
          <button key={t} onClick={() => setTab(t)}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition -mb-px ${tab === t ? 'border-[#26619c] text-[#26619c]' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
            {t === 'sessoes' && <List className="w-4 h-4" />}
            {label}
          </button>
        ))}
      </div>

      {/* ── TAB: CAIXA ── */}
      {tab === 'caixa' && (
        <>
          <CashSessionPanel session={session} onRefresh={loadSession} />

          {session && (
            <>
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

              <div className="flex gap-3">
                <button onClick={() => setShowTransaction(true)}
                  className="flex-1 flex items-center justify-center gap-2 bg-[#26619c] hover:bg-[#1a4f87] text-white py-2.5 rounded-xl text-sm font-semibold transition">
                  <Plus className="w-4 h-4" /> Nova Transação
                </button>
                <button onClick={() => setShowSangria(true)}
                  className="flex items-center justify-center gap-2 border border-amber-400 text-amber-600 py-2.5 px-4 rounded-xl text-sm font-medium hover:bg-amber-50 transition">
                  <ArrowDownLeft className="w-4 h-4" /> Sangria
                </button>
                <button onClick={loadTransactions}
                  className="flex items-center justify-center gap-2 border border-gray-300 text-gray-600 py-2.5 px-3 rounded-xl text-sm hover:bg-gray-50 transition">
                  <RefreshCw className="w-4 h-4" />
                </button>
              </div>

              <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-100">
                  <h3 className="font-semibold text-gray-800">Movimentações</h3>
                </div>
                {loadingTx ? (
                  <div className="p-6 text-center text-gray-400 text-sm">Carregando…</div>
                ) : transactions.length === 0 ? (
                  <div className="p-6 text-center text-gray-400 text-sm">Nenhuma movimentação ainda.</div>
                ) : (
                  <ul className="divide-y divide-gray-100">
                    {transactions.map(tx => (
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
        </>
      )}

      {/* ── TAB: SESSÕES ── */}
      {tab === 'sessoes' && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
            <h3 className="font-semibold text-gray-800">Histórico de Sessões</h3>
            <button onClick={loadSessions} className="text-gray-400 hover:text-gray-600">
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
          {loadingSessions ? (
            <div className="p-6 text-center text-gray-400 text-sm">Carregando…</div>
          ) : sessions.length === 0 ? (
            <div className="p-6 text-center text-gray-400 text-sm">Nenhuma sessão encontrada.</div>
          ) : (
            <ul className="divide-y divide-gray-100">
              {sessions.map(s => {
                const diff = s.difference ? parseFloat(s.difference) : null
                return (
                  <li key={s.id} className="px-4 py-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-gray-800">{fmtDate(s.opened_at)}</p>
                        {s.closed_at && <p className="text-xs text-gray-400">Fechado: {fmtDate(s.closed_at)}</p>}
                        <div className="flex gap-3 mt-1.5 text-xs text-gray-600">
                          <span>Abertura: <strong>{fmtBRL(s.opening_balance)}</strong></span>
                          {s.closing_balance && <span>Fechamento: <strong>{fmtBRL(s.closing_balance)}</strong></span>}
                          {s.expected_balance && <span>Esperado: <strong>{fmtBRL(s.expected_balance)}</strong></span>}
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-1 shrink-0">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${s.status === 'open' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                          {s.status === 'open' ? 'Aberta' : 'Fechada'}
                        </span>
                        {diff != null && (
                          <span className={`text-xs font-semibold ${diff >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                            Diferença: {diff >= 0 ? '+' : ''}R$ {Math.abs(diff).toFixed(2)}
                          </span>
                        )}
                      </div>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}

      {showSangria && <SangriaModal onClose={() => setShowSangria(false)} onSuccess={loadTransactions} />}
      {showTransaction && session && <TransactionModal onClose={() => setShowTransaction(false)} onSuccess={loadTransactions} />}
    </div>
  )
}
