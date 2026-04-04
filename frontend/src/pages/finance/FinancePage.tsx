import { useEffect, useState } from 'react'
import { AlertTriangle, ArrowDownLeft, ClipboardCheck, DollarSign, List, Plus, RefreshCw, Scale, TrendingDown, TrendingUp, X } from 'lucide-react'
import toast from 'react-hot-toast'
import { CashSessionPanel } from '../../components/finance/CashSessionPanel'
import { SangriaModal } from '../../components/finance/SangriaModal'
import { TransactionModal } from '../../components/finance/TransactionModal'
import { financeService } from '../../services/finance'
import { settingsService } from '../../services/settings'
import { useAuthStore } from '../../store/authStore'
import type { AssociationSettings, CashSession, CashSessionSummary, Transaction } from '../../types'

const TYPE_LABELS: Record<string, string> = { income: 'Entrada', expense: 'Saída', sangria: 'Sangria' }
const TYPE_COLORS: Record<string, string> = { income: 'text-green-600', expense: 'text-red-600', sangria: 'text-amber-600' }

type Tab = 'caixa' | 'sessoes'

// ── Session detail modal ──────────────────────────────────────────────────────

function SessionDetailModal({
  session,
  onClose,
}: {
  session: CashSessionSummary
  onClose: () => void
}) {
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [loading, setLoading] = useState(false)
  const [conferencing, setConferencing] = useState(false)

  const fmtBRL = (v: string | undefined) => (v != null ? `R$ ${parseFloat(v).toFixed(2)}` : '—')
  const fmtDate = (s: string) =>
    new Date(s).toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })

  useEffect(() => {
    const loadTx = async () => {
      setLoading(true)
      try {
        const res = await financeService.listTransactions(session.id)
        setTransactions(res.data)
      } catch {
        setTransactions([])
      } finally {
        setLoading(false)
      }
    }
    loadTx()
  }, [session.id])

  const handleConferencia = () => {
    setConferencing(true)
    setTimeout(() => {
      toast.success('Conferência registrada')
      setConferencing(false)
    }, 600)
  }

  const diff = session.difference ? parseFloat(session.difference) : null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg bg-white rounded-2xl shadow-2xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 shrink-0">
          <h2 className="font-bold text-gray-900">Detalhe da Sessão</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Summary */}
        <div className="px-6 py-4 bg-gray-50 border-b border-gray-100 shrink-0">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <p className="text-xs text-gray-400">Abertura</p>
              <p className="font-medium text-gray-800">{fmtDate(session.opened_at)}</p>
            </div>
            {session.closed_at && (
              <div>
                <p className="text-xs text-gray-400">Fechamento</p>
                <p className="font-medium text-gray-800">{fmtDate(session.closed_at)}</p>
              </div>
            )}
            <div>
              <p className="text-xs text-gray-400">Saldo de abertura</p>
              <p className="font-semibold text-gray-800">{fmtBRL(session.opening_balance)}</p>
            </div>
            {session.closing_balance && (
              <div>
                <p className="text-xs text-gray-400">Saldo de fechamento</p>
                <p className="font-semibold text-gray-800">{fmtBRL(session.closing_balance)}</p>
              </div>
            )}
            {session.expected_balance && (
              <div>
                <p className="text-xs text-gray-400">Saldo esperado</p>
                <p className="font-semibold text-gray-800">{fmtBRL(session.expected_balance)}</p>
              </div>
            )}
            {diff !== null && (
              <div>
                <p className="text-xs text-gray-400">Diferença</p>
                <p className={`font-semibold ${diff >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {diff >= 0 ? '+' : ''}R$ {Math.abs(diff).toFixed(2)}
                </p>
              </div>
            )}
          </div>
          <div className="mt-2">
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
              session.status === 'open' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'
            }`}>
              {session.status === 'open' ? 'Aberta' : 'Fechada'}
            </span>
          </div>
        </div>

        {/* Transactions */}
        <div className="flex-1 overflow-y-auto">
          <div className="px-6 py-3 border-b border-gray-100">
            <h3 className="font-semibold text-gray-800 text-sm">Movimentações</h3>
          </div>
          {loading ? (
            <div className="p-6 text-center text-gray-400 text-sm">Carregando…</div>
          ) : transactions.length === 0 ? (
            <div className="p-6 text-center text-gray-400 text-sm">Nenhuma movimentação registrada.</div>
          ) : (
            <ul className="divide-y divide-gray-100">
              {transactions.map((tx) => (
                <li key={tx.id} className="flex items-center justify-between px-6 py-3">
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

        {/* Footer */}
        <div className="flex gap-3 px-6 py-4 border-t border-gray-100 shrink-0">
          <button
            onClick={onClose}
            className="flex-1 border border-gray-300 text-gray-600 py-2.5 rounded-xl text-sm hover:bg-gray-50 transition"
          >
            Fechar
          </button>
          <button
            onClick={handleConferencia}
            disabled={conferencing}
            className="flex-1 flex items-center justify-center gap-2 bg-[#26619c] hover:bg-[#1a4f87] text-white py-2.5 rounded-xl text-sm font-semibold transition disabled:opacity-50"
          >
            <ClipboardCheck className="w-4 h-4" />
            {conferencing ? 'Registrando…' : 'Conferência de Caixa'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function FinancePage() {
  const role = useAuthStore((s) => s.role)
  const canSeeTotals = role !== 'operator' && role !== 'viewer'
  const isConferenteOrAbove = role === 'conferente' || role === 'admin' || role === 'superadmin'

  const [tab, setTab] = useState<Tab>('caixa')
  const [session, setSession] = useState<CashSession | null>(null)
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [showSangria, setShowSangria] = useState(false)
  const [showTransaction, setShowTransaction] = useState(false)
  const [loadingTx, setLoadingTx] = useState(false)
  const [sessions, setSessions] = useState<CashSessionSummary[]>([])
  const [loadingSessions, setLoadingSessions] = useState(false)
  const [settings, setSettings] = useState<AssociationSettings | null>(null)
  const [selectedSession, setSelectedSession] = useState<CashSessionSummary | null>(null)

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
  useEffect(() => {
    if (canSeeTotals) settingsService.get().then(r => setSettings(r.data)).catch(() => {})
  }, [canSeeTotals])

  const income = transactions.filter(t => t.type === 'income').reduce((s, t) => s + parseFloat(t.amount), 0)
  const expenses = transactions.filter(t => t.type !== 'income').reduce((s, t) => s + parseFloat(t.amount), 0)
  const currentBalance = session ? parseFloat(session.opening_balance) + income - expenses : 0
  const maxCash = settings ? parseFloat(settings.max_cash_before_sangria) : null
  const sangriaAlert = canSeeTotals && maxCash !== null && currentBalance > maxCash

  const fmtBRL = (v: string | undefined) => v != null ? `R$ ${parseFloat(v).toFixed(2)}` : '—'
  const fmtDate = (s: string) => new Date(s).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })

  return (
    <div className="flex flex-col gap-6 p-4 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900">Financeiro</h1>

      {/* Tabs — operators only see Frente de Caixa */}
      {isConferenteOrAbove && (
        <div className="flex border-b border-gray-200">
          {([['caixa', 'Frente de Caixa'], ['sessoes', 'Sessões']] as [Tab, string][]).map(([t, label]) => (
            <button key={t} onClick={() => setTab(t)}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition -mb-px ${tab === t ? 'border-[#26619c] text-[#26619c]' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
              {t === 'sessoes' && <List className="w-4 h-4" />}
              {label}
            </button>
          ))}
        </div>
      )}

      {/* ── TAB: CAIXA ── */}
      {tab === 'caixa' && (
        <>
          <CashSessionPanel session={session} onRefresh={loadSession} canConferencia={isConferenteOrAbove} />

          {session && (
            <>
              {sangriaAlert && (
                <div className="flex items-start gap-3 bg-amber-50 border border-amber-300 rounded-xl px-4 py-3">
                  <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-semibold text-amber-800">Sangria necessária</p>
                    <p className="text-xs text-amber-700">
                      Saldo atual <strong>R$ {currentBalance.toFixed(2)}</strong> excede o limite de <strong>R$ {maxCash!.toFixed(2)}</strong>. Realize uma sangria.
                    </p>
                  </div>
                </div>
              )}

              {/* KPIs for conferente+ users */}
              {isConferenteOrAbove && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-blue-50 rounded-xl p-4 border border-blue-100 flex flex-col gap-1">
                    <div className="flex items-center gap-1.5">
                      <DollarSign className="w-3.5 h-3.5 text-blue-500" />
                      <p className="text-xs text-blue-600 font-medium">Saldo Atual</p>
                    </div>
                    <p className="text-xl font-bold text-blue-700">R$ {currentBalance.toFixed(2)}</p>
                  </div>
                  <div className="bg-green-50 rounded-xl p-4 border border-green-100 flex flex-col gap-1">
                    <div className="flex items-center gap-1.5">
                      <TrendingUp className="w-3.5 h-3.5 text-green-500" />
                      <p className="text-xs text-green-600 font-medium">Entradas do Dia</p>
                    </div>
                    <p className="text-xl font-bold text-green-700">R$ {income.toFixed(2)}</p>
                  </div>
                  <div className="bg-red-50 rounded-xl p-4 border border-red-100 flex flex-col gap-1">
                    <div className="flex items-center gap-1.5">
                      <TrendingDown className="w-3.5 h-3.5 text-red-500" />
                      <p className="text-xs text-red-600 font-medium">Saídas do Dia</p>
                    </div>
                    <p className="text-xl font-bold text-red-700">R$ {expenses.toFixed(2)}</p>
                  </div>
                  <div className="bg-gray-50 rounded-xl p-4 border border-gray-200 flex flex-col gap-1">
                    <div className="flex items-center gap-1.5">
                      <Scale className="w-3.5 h-3.5 text-gray-500" />
                      <p className="text-xs text-gray-500 font-medium">Saldo Esperado</p>
                    </div>
                    <p className="text-xl font-bold text-gray-700">
                      {session.expected_balance
                        ? `R$ ${parseFloat(session.expected_balance).toFixed(2)}`
                        : `R$ ${currentBalance.toFixed(2)}`}
                    </p>
                  </div>
                </div>
              )}

              {/* Legacy 2-column totals for non-conferente canSeeTotals users (e.g. diretoria_adjunta) */}
              {canSeeTotals && !isConferenteOrAbove && (
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
              )}

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
                        {canSeeTotals && (
                          <span className={`text-sm font-semibold ${tx.type === 'income' ? 'text-green-600' : 'text-red-600'}`}>
                            {tx.type === 'income' ? '+' : '-'} R$ {parseFloat(tx.amount).toFixed(2)}
                          </span>
                        )}
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
                  <li
                    key={s.id}
                    className="px-4 py-4 cursor-pointer hover:bg-gray-50 transition"
                    onClick={() => setSelectedSession(s)}
                  >
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
      {selectedSession && (
        <SessionDetailModal
          session={selectedSession}
          onClose={() => setSelectedSession(null)}
        />
      )}
    </div>
  )
}
