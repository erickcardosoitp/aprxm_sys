import { useEffect, useState } from 'react'
import { TrendingUp, TrendingDown, DollarSign, BarChart2, Upload, CheckCircle, AlertCircle, Clock } from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../../services/api'

type Tab = 'dashboard' | 'receitas' | 'despesas' | 'relatorios' | 'conciliacao'

interface FinanceSummary {
  total_income: number
  total_expense: number
  total_balance: number
  transactions_count: number
  period_label: string
}

interface Tx {
  id: string
  type: string
  amount: string
  description: string
  transaction_at: string
  is_sangria: boolean
}

interface Session {
  id: string
  status: string
  opening_balance: string
  closing_balance: string | null
  expected_balance: string | null
  difference: string | null
  opened_at: string
  closed_at: string | null
}

interface ReconciliationItem {
  id: string
  bank: string
  date: string
  amount: number
  name: string
  cpf?: string
  status: 'automatico' | 'sugestao' | 'pendente'
  score: number
  sale_description?: string
}

const fmt = (v: string | number) =>
  `R$ ${parseFloat(String(v)).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const fmtDate = (s: string) =>
  new Date(s).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' })

export default function FinanceiroPage() {
  const [tab, setTab] = useState<Tab>('dashboard')
  const [summary, setSummary] = useState<FinanceSummary | null>(null)
  const [loadingSummary, setLoadingSummary] = useState(false)
  const [period, setPeriod] = useState('month')

  const [transactions, setTransactions] = useState<Tx[]>([])
  const [loadingTx, setLoadingTx] = useState(false)

  const [sessions, setSessions] = useState<Session[]>([])
  const [loadingSessions, setLoadingSessions] = useState(false)

  // Conciliation state
  const [bankFile, setBankFile] = useState<File | null>(null)
  const [bankType, setBankType] = useState<'itau' | 'cora'>('cora')
  const [importing, setImporting] = useState(false)
  const [reconciling, setReconciling] = useState(false)
  const [reconciliationResults, setReconciliationResults] = useState<{
    automatico: ReconciliationItem[]
    sugestao: ReconciliationItem[]
    pendente: ReconciliationItem[]
  } | null>(null)

  useEffect(() => {
    if (tab === 'dashboard') loadSummary()
    if (tab === 'receitas' || tab === 'despesas') loadTransactions()
    if (tab === 'relatorios') loadSessions()
  }, [tab, period])

  const loadSummary = async () => {
    setLoadingSummary(true)
    try {
      const res = await api.get<FinanceSummary>('/financeiro/summary', { params: { period } })
      setSummary(res.data)
    } catch {
      // Silently fail if endpoint not ready
    } finally {
      setLoadingSummary(false)
    }
  }

  const loadTransactions = async () => {
    setLoadingTx(true)
    try {
      const res = await api.get<Tx[]>('/finance/transactions')
      setTransactions(res.data)
    } catch {
      setTransactions([])
    } finally {
      setLoadingTx(false)
    }
  }

  const loadSessions = async () => {
    setLoadingSessions(true)
    try {
      const res = await api.get<Session[]>('/finance/sessions')
      setSessions(res.data)
    } catch {
      setSessions([])
    } finally {
      setLoadingSessions(false)
    }
  }

  const handleImportCSV = async () => {
    if (!bankFile) { toast.error('Selecione um arquivo CSV'); return }
    setImporting(true)
    try {
      const formData = new FormData()
      formData.append('file', bankFile)
      formData.append('bank', bankType)
      await api.post('/financeiro/bank-statements/import', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      })
      toast.success('Extrato importado com sucesso!')
      setBankFile(null)
      handleReconcile()
    } catch (e: any) {
      toast.error(e.response?.data?.detail ?? 'Erro ao importar extrato.')
    } finally {
      setImporting(false)
    }
  }

  const handleReconcile = async () => {
    setReconciling(true)
    try {
      const res = await api.post<typeof reconciliationResults>('/financeiro/reconcile')
      setReconciliationResults(res.data)
    } catch (e: any) {
      toast.error(e.response?.data?.detail ?? 'Erro na conciliação.')
    } finally {
      setReconciling(false)
    }
  }

  const TABS: { key: Tab; label: string; icon: any }[] = [
    { key: 'dashboard', label: 'Resumo', icon: BarChart2 },
    { key: 'receitas', label: 'Receitas', icon: TrendingUp },
    { key: 'despesas', label: 'Despesas', icon: TrendingDown },
    { key: 'relatorios', label: 'Relatórios', icon: DollarSign },
    { key: 'conciliacao', label: 'PIX', icon: CheckCircle },
  ]

  return (
    <div className="flex flex-col gap-4 p-4 max-w-3xl mx-auto">
      <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
        <TrendingUp className="w-5 h-5 text-[#26619c]" />
        Financeiro
      </h1>

      {/* Tabs — scrollable on mobile */}
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1 overflow-x-auto scrollbar-none">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition whitespace-nowrap ${
              tab === key ? 'bg-white text-[#26619c] shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <Icon className="w-3.5 h-3.5" />
            {label}
          </button>
        ))}
      </div>

      {/* Dashboard Tab */}
      {tab === 'dashboard' && (
        <div className="flex flex-col gap-4">
          {/* Period selector */}
          <div className="flex gap-2">
            {(['week', 'month', 'year'] as const).map(p => (
              <button key={p} onClick={() => setPeriod(p)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${period === p ? 'bg-[#26619c] text-white' : 'bg-gray-100 text-gray-600'}`}>
                {p === 'week' ? 'Semana' : p === 'month' ? 'Mês' : 'Ano'}
              </button>
            ))}
          </div>

          {loadingSummary ? (
            <div className="text-center py-8 text-gray-400 text-sm">Carregando…</div>
          ) : summary ? (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
                  <p className="text-xs text-gray-500 mb-1">Receitas</p>
                  <p className="text-xl font-bold text-green-600">R$ {summary.total_income.toFixed(2)}</p>
                </div>
                <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
                  <p className="text-xs text-gray-500 mb-1">Despesas</p>
                  <p className="text-xl font-bold text-red-600">R$ {summary.total_expense.toFixed(2)}</p>
                </div>
                <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 col-span-2">
                  <p className="text-xs text-gray-500 mb-1">Saldo do período</p>
                  <p className={`text-2xl font-bold ${summary.total_balance >= 0 ? 'text-[#26619c]' : 'text-red-600'}`}>
                    R$ {summary.total_balance.toFixed(2)}
                  </p>
                  <p className="text-xs text-gray-400 mt-1">{summary.transactions_count} transações · {summary.period_label}</p>
                </div>
              </div>
            </>
          ) : (
            <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-400 text-sm">
              Nenhum dado disponível para o período selecionado.
            </div>
          )}
        </div>
      )}

      {/* Receitas tab */}
      {tab === 'receitas' && (() => {
        const rows = transactions.filter(t => t.type === 'income')
        const total = rows.reduce((s, t) => s + parseFloat(t.amount), 0)
        return (
          <div className="flex flex-col gap-3">
            <div className="bg-green-50 border border-green-200 rounded-xl p-4 flex items-center justify-between">
              <p className="text-sm font-medium text-green-700">Total de entradas</p>
              <p className="text-xl font-bold text-green-700">{fmt(total)}</p>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
              {loadingTx ? (
                <div className="p-6 text-center text-gray-400 text-sm">Carregando…</div>
              ) : rows.length === 0 ? (
                <div className="p-6 text-center text-gray-400 text-sm">Nenhuma receita encontrada.</div>
              ) : (
                <ul className="divide-y divide-gray-100">
                  {rows.map(t => (
                    <li key={t.id} className="px-4 py-3 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-gray-800 truncate">{t.description}</p>
                        <p className="text-xs text-gray-400">{fmtDate(t.transaction_at)}</p>
                      </div>
                      <span className="text-sm font-bold text-green-600 shrink-0">{fmt(t.amount)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )
      })()}

      {/* Despesas tab */}
      {tab === 'despesas' && (() => {
        const rows = transactions.filter(t => t.type !== 'income')
        const total = rows.reduce((s, t) => s + parseFloat(t.amount), 0)
        return (
          <div className="flex flex-col gap-3">
            <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-center justify-between">
              <p className="text-sm font-medium text-red-700">Total de saídas</p>
              <p className="text-xl font-bold text-red-700">{fmt(total)}</p>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
              {loadingTx ? (
                <div className="p-6 text-center text-gray-400 text-sm">Carregando…</div>
              ) : rows.length === 0 ? (
                <div className="p-6 text-center text-gray-400 text-sm">Nenhuma despesa encontrada.</div>
              ) : (
                <ul className="divide-y divide-gray-100">
                  {rows.map(t => (
                    <li key={t.id} className="px-4 py-3 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-gray-800 truncate">
                          {t.is_sangria ? '🔒 Sangria — ' : ''}{t.description}
                        </p>
                        <p className="text-xs text-gray-400">{fmtDate(t.transaction_at)}</p>
                      </div>
                      <span className="text-sm font-bold text-red-600 shrink-0">{fmt(t.amount)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )
      })()}

      {/* Relatórios tab */}
      {tab === 'relatorios' && (() => {
        const closed = sessions.filter(s => s.status === 'closed')
        const totalIncome = closed.reduce((sum, s) => {
          const open = parseFloat(s.opening_balance)
          const close = parseFloat(s.closing_balance ?? '0')
          return sum + Math.max(0, close - open)
        }, 0)
        const totalDiff = closed.reduce((sum, s) => sum + parseFloat(s.difference ?? '0'), 0)
        return (
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
                <p className="text-xs text-gray-500 mb-1">Sessões fechadas</p>
                <p className="text-2xl font-bold text-gray-800">{closed.length}</p>
              </div>
              <div className={`rounded-xl border shadow-sm p-4 ${totalDiff >= 0 ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
                <p className="text-xs text-gray-500 mb-1">Diferença acumulada</p>
                <p className={`text-2xl font-bold ${totalDiff >= 0 ? 'text-green-700' : 'text-red-700'}`}>{fmt(totalDiff)}</p>
              </div>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100">
                <h3 className="text-sm font-semibold text-gray-800">Histórico de Sessões</h3>
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
                      <li key={s.id} className="px-4 py-3">
                        <div className="flex items-center justify-between gap-3 mb-1">
                          <p className="text-sm font-medium text-gray-800">{fmtDate(s.opened_at)}</p>
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${s.status === 'open' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                            {s.status === 'open' ? 'Aberta' : 'Fechada'}
                          </span>
                        </div>
                        <div className="flex gap-4 text-xs text-gray-500">
                          <span>Abertura: <strong>{fmt(s.opening_balance)}</strong></span>
                          {s.closing_balance && <span>Fechamento: <strong>{fmt(s.closing_balance)}</strong></span>}
                          {diff !== null && (
                            <span className={diff === 0 ? 'text-green-600' : diff > 0 ? 'text-blue-600' : 'text-red-600'}>
                              Dif: <strong>{diff >= 0 ? '+' : ''}{fmt(diff)}</strong>
                            </span>
                          )}
                        </div>
                        {s.closed_at && <p className="text-xs text-gray-400 mt-0.5">Fechado: {fmtDate(s.closed_at)}</p>}
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          </div>
        )
      })()}

      {/* Conciliação PIX tab */}
      {tab === 'conciliacao' && (
        <div className="flex flex-col gap-4">
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
            <h2 className="font-semibold text-gray-800 mb-1">Importar Extrato Bancário</h2>
            <p className="text-xs text-gray-400 mb-4">Importe o extrato CSV do banco para conciliar pagamentos PIX.</p>

            <div className="flex flex-col gap-3">
              <div>
                <label className="block text-xs text-gray-600 mb-1">Banco</label>
                <select value={bankType} onChange={e => setBankType(e.target.value as any)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#26619c]/40">
                  <option value="cora">Cora</option>
                  <option value="itau">Itaú</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-600 mb-1">Arquivo CSV</label>
                <input type="file" accept=".csv" onChange={e => setBankFile(e.target.files?.[0] ?? null)}
                  className="w-full text-sm text-gray-600 file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-medium file:bg-[#26619c] file:text-white hover:file:bg-[#1a4f87]" />
              </div>
              <button onClick={handleImportCSV} disabled={importing || !bankFile}
                className="flex items-center justify-center gap-2 bg-[#26619c] hover:bg-[#1a4f87] text-white py-2.5 rounded-xl font-semibold transition disabled:opacity-50">
                <Upload className="w-4 h-4" />
                {importing ? 'Importando…' : 'Importar e Conciliar'}
              </button>
            </div>
          </div>

          {reconciliationResults && (
            <div className="flex flex-col gap-3">
              {/* Auto */}
              <div className="bg-white rounded-xl border border-green-200 shadow-sm p-4">
                <h3 className="font-semibold text-green-700 mb-3 flex items-center gap-2">
                  <CheckCircle className="w-4 h-4" />
                  Conciliados automaticamente ({reconciliationResults.automatico.length})
                </h3>
                {reconciliationResults.automatico.length === 0 ? (
                  <p className="text-xs text-gray-400">Nenhum.</p>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {reconciliationResults.automatico.map(item => (
                      <li key={item.id} className="flex items-center justify-between text-sm bg-green-50 rounded-lg px-3 py-2">
                        <div>
                          <p className="font-medium text-gray-800">{item.name}</p>
                          <p className="text-xs text-gray-400">{item.date} · {item.bank} · Score: {item.score}</p>
                        </div>
                        <span className="font-bold text-green-700">R$ {item.amount.toFixed(2)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* Sugestão */}
              <div className="bg-white rounded-xl border border-yellow-200 shadow-sm p-4">
                <h3 className="font-semibold text-yellow-700 mb-3 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4" />
                  Sugestões de conciliação ({reconciliationResults.sugestao.length})
                </h3>
                {reconciliationResults.sugestao.length === 0 ? (
                  <p className="text-xs text-gray-400">Nenhuma sugestão.</p>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {reconciliationResults.sugestao.map(item => (
                      <li key={item.id} className="flex items-center justify-between text-sm bg-yellow-50 rounded-lg px-3 py-2">
                        <div>
                          <p className="font-medium text-gray-800">{item.name}</p>
                          <p className="text-xs text-gray-400">{item.date} · Score: {item.score}</p>
                          {item.sale_description && <p className="text-xs text-gray-600">→ {item.sale_description}</p>}
                        </div>
                        <span className="font-bold text-yellow-700">R$ {item.amount.toFixed(2)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* Pendente */}
              <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
                <h3 className="font-semibold text-gray-600 mb-3 flex items-center gap-2">
                  <Clock className="w-4 h-4" />
                  Não identificados ({reconciliationResults.pendente.length})
                </h3>
                {reconciliationResults.pendente.length === 0 ? (
                  <p className="text-xs text-gray-400">Nenhum pendente.</p>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {reconciliationResults.pendente.map(item => (
                      <li key={item.id} className="flex items-center justify-between text-sm bg-gray-50 rounded-lg px-3 py-2">
                        <div>
                          <p className="font-medium text-gray-800">{item.name}</p>
                          <p className="text-xs text-gray-400">{item.date} · {item.bank}</p>
                        </div>
                        <span className="font-bold text-gray-600">R$ {item.amount.toFixed(2)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
