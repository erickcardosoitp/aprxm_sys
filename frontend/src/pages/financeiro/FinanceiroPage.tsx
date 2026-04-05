import { useEffect, useState } from 'react'
import {
  TrendingUp, TrendingDown, DollarSign, BarChart2, Upload,
  CheckCircle, AlertCircle, Clock, Plus, Search, X, RotateCcw,
  CreditCard, Users,
} from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../../services/api'
import type { Resident } from '../../types'

type Tab = 'dashboard' | 'receitas' | 'despesas' | 'cobrancas' | 'relatorios' | 'conciliacao'

interface FinanceSummary {
  total_income: number
  total_expense: number
  total_balance: number
  transactions_count: number
  income_by_type?: Record<string, number>
  contas_a_receber?: number
  contas_a_receber_count?: number
  period_label: string
}

interface Tx {
  id: string
  type: string
  income_subtype?: string
  amount: string
  description: string
  transaction_at: string
  is_sangria: boolean
  is_reversal?: boolean
  reversal_of_id?: string
  reversed_at?: string
}

interface Session {
  id: string; status: string; opening_balance: string
  closing_balance: string | null; expected_balance: string | null
  difference: string | null; opened_at: string; closed_at: string | null
}

interface Mensalidade {
  id: string; resident_id: string; reference_month: string
  due_date: string; amount: string; status: string
  paid_at: string | null; transaction_id: string | null; notes: string | null
}

interface DelinquentItem {
  id: string; resident_id: string; reference_month: string
  due_date: string; amount: string; months_overdue: number
}

interface ReconciliationItem {
  id: string; bank: string; date: string; amount: number; name: string
  cpf?: string; status: 'automatico' | 'sugestao' | 'pendente'; score: number
  sale_description?: string
}

const fmt = (v: string | number) =>
  `R$ ${parseFloat(String(v)).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const fmtDate = (s: string) =>
  new Date(s).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' })

const SUBTYPE_LABELS: Record<string, string> = {
  mensalidade: 'Mensalidade',
  delivery_fee: 'Taxa de Entrega',
  proof_of_residence: 'Comprovante Residência',
  other: 'Outros',
}

export default function FinanceiroPage() {
  const [tab, setTab] = useState<Tab>('dashboard')
  const [period, setPeriod] = useState('month')

  // Dashboard
  const [summary, setSummary] = useState<FinanceSummary | null>(null)
  const [loadingSummary, setLoadingSummary] = useState(false)

  // Transactions
  const [transactions, setTransactions] = useState<Tx[]>([])
  const [loadingTx, setLoadingTx] = useState(false)
  const [reversing, setReversing] = useState<string | null>(null)
  const [reversalReason, setReversalReason] = useState('')
  const [reversalTarget, setReversalTarget] = useState<Tx | null>(null)

  // Sessions
  const [sessions, setSessions] = useState<Session[]>([])
  const [loadingSessions, setLoadingSessions] = useState(false)

  // Open cash session
  const [openSession, setOpenSession] = useState<{ id: string } | null | undefined>(undefined)

  // Cobranças
  const [pendingMensalidades, setPendingMensalidades] = useState<Mensalidade[]>([])
  const [pendingNames, setPendingNames] = useState<Record<string, string>>({})
  const [delinquent, setDelinquent] = useState<DelinquentItem[]>([])
  const [delinquentNames, setDelinquentNames] = useState<Record<string, string>>({})
  const [loadingCobrancas, setLoadingCobrancas] = useState(false)
  const [payingId, setPayingId] = useState<string | null>(null)
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [createForm, setCreateForm] = useState({
    resident_id: '', reference_month: '', due_date: '', amount: '', notes: '',
  })
  const [residentSearch, setResidentSearch] = useState('')
  const [residentResults, setResidentResults] = useState<Resident[]>([])
  const [selectedResident, setSelectedResident] = useState<Resident | null>(null)
  const [historyResidentId, setHistoryResidentId] = useState<string | null>(null)
  const [history, setHistory] = useState<Mensalidade[]>([])
  const [cobrancasView, setCobrancasView] = useState<'pendentes' | 'inadimplentes' | 'historico'>('pendentes')

  // Conciliation
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
    if (tab === 'cobrancas') { loadOpenSession(); loadCobrancas() }
  }, [tab, period])

  const loadOpenSession = async () => {
    try {
      const res = await api.get<{ id: string }>('/finance/sessions/current')
      setOpenSession(res.data)
    } catch {
      setOpenSession(null)
    }
  }

  const periodStart = () => {
    const now = new Date()
    if (period === 'week') return new Date(now.getTime() - 7 * 24 * 3600 * 1000)
    if (period === 'year') return new Date(now.getFullYear(), 0, 1)
    return new Date(now.getFullYear(), now.getMonth(), 1)
  }
  const filterByPeriod = (txs: Tx[]) => txs.filter(t => new Date(t.transaction_at) >= periodStart())
  const PERIOD_LABEL: Record<string, string> = { week: 'Últimos 7 dias', month: 'Este mês', year: 'Este ano' }

  const loadSummary = async () => {
    setLoadingSummary(true)
    try {
      const res = await api.get<FinanceSummary>('/financeiro/summary', { params: { period } })
      setSummary(res.data)
    } catch (e: any) {
      toast.error(e.response?.data?.detail ?? 'Erro ao carregar resumo.')
    } finally { setLoadingSummary(false) }
  }

  const loadTransactions = async () => {
    setLoadingTx(true)
    try {
      const res = await api.get<Tx[]>('/finance/transactions')
      setTransactions(res.data)
    } catch { setTransactions([]) } finally { setLoadingTx(false) }
  }

  const loadSessions = async () => {
    setLoadingSessions(true)
    try {
      const res = await api.get<Session[]>('/finance/sessions')
      setSessions(res.data)
    } catch { setSessions([]) } finally { setLoadingSessions(false) }
  }

  const loadResidentNames = async (ids: string[]): Promise<Record<string, string>> => {
    const names: Record<string, string> = {}
    await Promise.all(ids.map(async (id) => {
      try {
        const r = await api.get<Resident>(`/residents/${id}`)
        names[id] = r.data.full_name
      } catch { names[id] = id.slice(0, 8) }
    }))
    return names
  }

  const loadCobrancas = async () => {
    setLoadingCobrancas(true)
    try {
      const [pendingRes, delinqRes] = await Promise.all([
        api.get<Mensalidade[]>('/mensalidades/pending'),
        api.get<DelinquentItem[]>('/mensalidades/delinquent'),
      ])
      setPendingMensalidades(pendingRes.data)
      setDelinquent(delinqRes.data)

      const allIds = [...new Set([
        ...pendingRes.data.map(m => m.resident_id),
        ...delinqRes.data.map(d => d.resident_id),
      ])]
      const names = await loadResidentNames(allIds)
      setPendingNames(names)
      setDelinquentNames(names)
    } catch { } finally { setLoadingCobrancas(false) }
  }

  const loadResidentHistory = async (residentId: string) => {
    try {
      const res = await api.get<Mensalidade[]>(`/mensalidades/residents/${residentId}`)
      setHistory(res.data)
      setHistoryResidentId(residentId)
      setCobrancasView('historico')
    } catch { toast.error('Erro ao carregar histórico.') }
  }

  const searchResidents = async (q: string) => {
    if (q.length < 2) { setResidentResults([]); return }
    try {
      const res = await api.get<Resident[]>('/residents', { params: { q } })
      setResidentResults(res.data.slice(0, 5))
    } catch { }
  }

  const handleCreateMensalidade = async () => {
    if (!selectedResident || !createForm.reference_month || !createForm.due_date || !createForm.amount) {
      toast.error('Preencha todos os campos obrigatórios.')
      return
    }
    try {
      await api.post('/mensalidades', {
        resident_id: selectedResident.id,
        reference_month: createForm.reference_month,
        due_date: createForm.due_date,
        amount: parseFloat(createForm.amount),
        notes: createForm.notes || undefined,
      })
      toast.success('Mensalidade criada!')
      setShowCreateForm(false)
      setCreateForm({ resident_id: '', reference_month: '', due_date: '', amount: '', notes: '' })
      setSelectedResident(null)
      setResidentSearch('')
      loadCobrancas()
    } catch (e: any) {
      toast.error(e.response?.data?.detail ?? 'Erro ao criar mensalidade.')
    }
  }

  const handlePayMensalidade = async (id: string) => {
    if (!openSession) {
      toast.error('Abra o caixa antes de registrar pagamentos.')
      return
    }
    setPayingId(id)
    try {
      const res = await api.post<{ mensalidade: Mensalidade; transaction: any; next_month: Mensalidade | null }>(
        `/mensalidades/${id}/pay`, {}
      )
      const next = res.data.next_month
      toast.success(
        next
          ? `Pago! Próxima mensalidade criada: ${next.reference_month}`
          : 'Mensalidade paga!'
      )
      loadCobrancas()
      if (historyResidentId) loadResidentHistory(historyResidentId)
    } catch (e: any) {
      toast.error(e.response?.data?.detail ?? 'Erro ao pagar mensalidade.')
    } finally { setPayingId(null) }
  }

  const handleReversal = async () => {
    if (!reversalTarget || !reversalReason.trim()) return
    setReversing(reversalTarget.id)
    try {
      await api.post(`/finance/transactions/${reversalTarget.id}/reverse`, { reason: reversalReason.trim() })
      toast.success('Estorno realizado!')
      setReversalTarget(null)
      setReversalReason('')
      loadTransactions()
    } catch (e: any) {
      toast.error(e.response?.data?.detail ?? 'Erro ao estornar.')
    } finally { setReversing(null) }
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
      toast.success('Extrato importado!')
      setBankFile(null)
      handleReconcile()
    } catch (e: any) {
      toast.error(e.response?.data?.detail ?? 'Erro ao importar.')
    } finally { setImporting(false) }
  }

  const handleReconcile = async () => {
    setReconciling(true)
    try {
      const res = await api.post<typeof reconciliationResults>('/financeiro/reconcile')
      setReconciliationResults(res.data)
    } catch (e: any) {
      toast.error(e.response?.data?.detail ?? 'Erro na conciliação.')
    } finally { setReconciling(false) }
  }

  const TABS: { key: Tab; label: string; icon: any }[] = [
    { key: 'dashboard',    label: 'Resumo',    icon: BarChart2 },
    { key: 'receitas',     label: 'Receitas',  icon: TrendingUp },
    { key: 'despesas',     label: 'Despesas',  icon: TrendingDown },
    { key: 'cobrancas',    label: 'Cobranças', icon: CreditCard },
    { key: 'relatorios',   label: 'Sessões',   icon: DollarSign },
    { key: 'conciliacao',  label: 'PIX',       icon: CheckCircle },
  ]

  const inputCls = 'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#26619c]/40 focus:border-[#26619c]'

  return (
    <div className="flex flex-col gap-4 p-4 max-w-3xl mx-auto">
      <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
        <TrendingUp className="w-5 h-5 text-[#26619c]" />
        Financeiro
      </h1>

      <div className="flex gap-1 bg-gray-100 rounded-xl p-1 overflow-x-auto scrollbar-none">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button key={key} onClick={() => setTab(key)}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition whitespace-nowrap ${
              tab === key ? 'bg-white text-[#26619c] shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}>
            <Icon className="w-3.5 h-3.5" />
            {label}
          </button>
        ))}
      </div>

      {/* ── DASHBOARD ── */}
      {tab === 'dashboard' && (
        <div className="flex flex-col gap-4">
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
            <div className="flex flex-col gap-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
                  <p className="text-xs text-gray-500 mb-1">Receitas</p>
                  <p className="text-xl font-bold text-green-600">{fmt(summary.total_income)}</p>
                </div>
                <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
                  <p className="text-xs text-gray-500 mb-1">Despesas</p>
                  <p className="text-xl font-bold text-red-600">{fmt(summary.total_expense)}</p>
                </div>
                <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 col-span-2">
                  <p className="text-xs text-gray-500 mb-1">Saldo do período</p>
                  <p className={`text-2xl font-bold ${summary.total_balance >= 0 ? 'text-[#26619c]' : 'text-red-600'}`}>
                    {fmt(summary.total_balance)}
                  </p>
                  <p className="text-xs text-gray-400 mt-1">{summary.transactions_count} transações · {summary.period_label}</p>
                </div>
              </div>

              {/* Income by type */}
              {summary.income_by_type && Object.keys(summary.income_by_type).length > 0 && (
                <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
                  <p className="text-xs font-semibold text-gray-600 mb-3">Receitas por tipo</p>
                  <div className="flex flex-col gap-2">
                    {Object.entries(summary.income_by_type).map(([type, total]) => (
                      <div key={type} className="flex items-center justify-between">
                        <span className="text-xs text-gray-600">{SUBTYPE_LABELS[type] ?? type}</span>
                        <span className="text-xs font-semibold text-green-700">{fmt(total)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Contas a receber + inadimplência */}
              <div className="grid grid-cols-2 gap-3">
                {(summary.contas_a_receber ?? 0) > 0 && (
                  <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
                    <p className="text-xs text-blue-600 mb-1">Contas a Receber</p>
                    <p className="text-lg font-bold text-blue-800">{fmt(summary.contas_a_receber ?? 0)}</p>
                    <p className="text-xs text-blue-500">{summary.contas_a_receber_count} mensalidade(s)</p>
                  </div>
                )}
                {(summary.contas_a_receber_count ?? 0) > 0 && (
                  <button onClick={() => setTab('cobrancas')}
                    className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-left hover:bg-amber-100 transition">
                    <p className="text-xs text-amber-600 mb-1">Ver Cobranças</p>
                    <p className="text-lg font-bold text-amber-800">→</p>
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-400 text-sm">
              Nenhum dado disponível.
            </div>
          )}
        </div>
      )}

      {/* ── RECEITAS ── */}
      {tab === 'receitas' && (() => {
        const rows = filterByPeriod(transactions.filter(t => t.type === 'income' && !t.is_reversal))
        const total = rows.reduce((s, t) => s + parseFloat(t.amount), 0)
        return (
          <div className="flex flex-col gap-3">
            <div className="flex gap-2">
              {(['week', 'month', 'year'] as const).map(p => (
                <button key={p} onClick={() => setPeriod(p)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${period === p ? 'bg-[#26619c] text-white' : 'bg-gray-100 text-gray-600'}`}>
                  {p === 'week' ? 'Semana' : p === 'month' ? 'Mês' : 'Ano'}
                </button>
              ))}
            </div>
            <div className="bg-green-50 border border-green-200 rounded-xl p-4 flex justify-between items-center">
              <div>
                <p className="text-xs text-gray-500">{PERIOD_LABEL[period]}</p>
                <p className="text-sm font-medium text-green-700">Total entradas</p>
              </div>
              <p className="text-xl font-bold text-green-700">{fmt(total)}</p>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
              {loadingTx ? (
                <div className="p-6 text-center text-gray-400 text-sm">Carregando…</div>
              ) : rows.length === 0 ? (
                <div className="p-6 text-center text-gray-400 text-sm">Nenhuma receita no período.</div>
              ) : (
                <ul className="divide-y divide-gray-100">
                  {rows.map(t => (
                    <li key={t.id} className="px-4 py-3 flex items-center justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-gray-800 truncate">{t.description}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <p className="text-xs text-gray-400">{fmtDate(t.transaction_at)}</p>
                          {t.income_subtype && (
                            <span className="text-xs px-1.5 py-0.5 bg-blue-50 text-blue-600 rounded">
                              {SUBTYPE_LABELS[t.income_subtype] ?? t.income_subtype}
                            </span>
                          )}
                          {t.reversed_at && (
                            <span className="text-xs px-1.5 py-0.5 bg-red-50 text-red-500 rounded">estornado</span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-sm font-bold text-green-600">{fmt(t.amount)}</span>
                        {!t.reversed_at && !t.is_reversal && (
                          <button
                            onClick={() => { setReversalTarget(t); setReversalReason('') }}
                            title="Estornar"
                            className="p-1.5 text-gray-400 hover:text-red-500 rounded-lg hover:bg-red-50 transition"
                          >
                            <RotateCcw className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )
      })()}

      {/* ── DESPESAS ── */}
      {tab === 'despesas' && (() => {
        const rows = filterByPeriod(transactions.filter(t => t.type !== 'income'))
        const total = rows.reduce((s, t) => s + parseFloat(t.amount), 0)
        return (
          <div className="flex flex-col gap-3">
            <div className="flex gap-2">
              {(['week', 'month', 'year'] as const).map(p => (
                <button key={p} onClick={() => setPeriod(p)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${period === p ? 'bg-[#26619c] text-white' : 'bg-gray-100 text-gray-600'}`}>
                  {p === 'week' ? 'Semana' : p === 'month' ? 'Mês' : 'Ano'}
                </button>
              ))}
            </div>
            <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex justify-between items-center">
              <div>
                <p className="text-xs text-gray-500">{PERIOD_LABEL[period]}</p>
                <p className="text-sm font-medium text-red-700">Total saídas</p>
              </div>
              <p className="text-xl font-bold text-red-700">{fmt(total)}</p>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
              {loadingTx ? (
                <div className="p-6 text-center text-gray-400 text-sm">Carregando…</div>
              ) : rows.length === 0 ? (
                <div className="p-6 text-center text-gray-400 text-sm">Nenhuma despesa no período.</div>
              ) : (
                <ul className="divide-y divide-gray-100">
                  {rows.map(t => (
                    <li key={t.id} className="px-4 py-3 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-gray-800 truncate">
                          {t.is_sangria ? '🔒 ' : ''}{t.description}
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

      {/* ── COBRANÇAS ── */}
      {tab === 'cobrancas' && (
        <div className="flex flex-col gap-4">
          {/* Open session warning */}
          {openSession === null && (
            <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
              <AlertCircle className="w-4 h-4 text-amber-500 shrink-0" />
              <p className="text-xs text-amber-700">Nenhum caixa aberto. Abra o caixa para registrar pagamentos.</p>
            </div>
          )}

          {/* Sub-tabs */}
          <div className="flex gap-1 bg-gray-100 rounded-xl p-1">
            {([
              { key: 'pendentes', label: 'A Receber' },
              { key: 'inadimplentes', label: 'Inadimplentes' },
              { key: 'historico', label: 'Histórico' },
            ] as const).map(({ key, label }) => (
              <button key={key} onClick={() => setCobrancasView(key)}
                className={`flex-1 py-2 rounded-lg text-xs font-medium transition ${
                  cobrancasView === key ? 'bg-white text-[#26619c] shadow-sm' : 'text-gray-500'
                }`}>
                {label}
              </button>
            ))}
          </div>

          {/* Create button */}
          <button onClick={() => setShowCreateForm(!showCreateForm)}
            className="flex items-center justify-center gap-2 border-2 border-dashed border-[#26619c]/40 rounded-xl py-2.5 text-sm text-[#26619c] hover:bg-blue-50 transition">
            <Plus className="w-4 h-4" />
            Nova Mensalidade
          </button>

          {/* Create form */}
          {showCreateForm && (
            <div className="bg-white border border-gray-200 rounded-xl p-4 flex flex-col gap-3 shadow-sm">
              <p className="text-sm font-semibold text-gray-800">Nova Mensalidade</p>

              {/* Resident search */}
              <div>
                <label className="block text-xs text-gray-600 mb-1">Morador *</label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input
                    value={residentSearch}
                    onChange={e => { setResidentSearch(e.target.value); searchResidents(e.target.value) }}
                    className={`${inputCls} pl-9`}
                    placeholder="Buscar por nome ou CPF…"
                  />
                </div>
                {residentResults.length > 0 && !selectedResident && (
                  <ul className="border border-gray-200 rounded-lg mt-1 divide-y divide-gray-100 max-h-36 overflow-y-auto">
                    {residentResults.map(r => (
                      <li key={r.id}>
                        <button className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50 flex flex-col"
                          onClick={() => { setSelectedResident(r); setResidentSearch(r.full_name); setResidentResults([]) }}>
                          <span className="font-medium text-gray-800">{r.full_name}</span>
                          <span className="text-xs text-gray-400">{r.cpf ? `CPF: ${r.cpf}` : ''}{r.unit ? ` · Unid. ${r.unit}` : ''}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {selectedResident && (
                  <div className="flex items-center gap-2 mt-1 bg-blue-50 rounded-lg px-3 py-1.5">
                    <span className="text-xs font-medium text-blue-800 flex-1">{selectedResident.full_name}</span>
                    <button onClick={() => { setSelectedResident(null); setResidentSearch('') }}>
                      <X className="w-3.5 h-3.5 text-gray-400 hover:text-red-500" />
                    </button>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-600 mb-1">Mês de referência *</label>
                  <input type="month" value={createForm.reference_month}
                    onChange={e => setCreateForm(f => ({ ...f, reference_month: e.target.value }))}
                    className={inputCls} />
                </div>
                <div>
                  <label className="block text-xs text-gray-600 mb-1">Vencimento *</label>
                  <input type="date" value={createForm.due_date}
                    onChange={e => setCreateForm(f => ({ ...f, due_date: e.target.value }))}
                    className={inputCls} />
                </div>
              </div>
              <div>
                <label className="block text-xs text-gray-600 mb-1">Valor (R$) *</label>
                <input type="number" step="0.01" min="0.01" value={createForm.amount}
                  onChange={e => setCreateForm(f => ({ ...f, amount: e.target.value }))}
                  className={inputCls} placeholder="0,00" />
              </div>
              <div>
                <label className="block text-xs text-gray-600 mb-1">Observações</label>
                <input value={createForm.notes}
                  onChange={e => setCreateForm(f => ({ ...f, notes: e.target.value }))}
                  className={inputCls} placeholder="Opcional…" />
              </div>
              <div className="flex gap-2">
                <button onClick={() => setShowCreateForm(false)}
                  className="flex-1 border border-gray-300 text-gray-600 py-2 rounded-xl text-sm hover:bg-gray-50 transition">
                  Cancelar
                </button>
                <button onClick={handleCreateMensalidade}
                  className="flex-1 bg-[#26619c] hover:bg-[#1a4f87] text-white py-2 rounded-xl text-sm font-medium transition">
                  Criar
                </button>
              </div>
            </div>
          )}

          {/* Pendentes / A Receber */}
          {cobrancasView === 'pendentes' && (
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
                <p className="text-sm font-semibold text-gray-800">A Receber ({pendingMensalidades.length})</p>
                {loadingCobrancas && <span className="text-xs text-gray-400">Carregando…</span>}
              </div>
              {!loadingCobrancas && pendingMensalidades.length === 0 ? (
                <div className="p-6 text-center text-gray-400 text-sm">Nenhuma mensalidade pendente.</div>
              ) : (
                <ul className="divide-y divide-gray-100">
                  {pendingMensalidades.map(m => (
                    <li key={m.id} className="px-4 py-3 flex items-center justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-gray-800 truncate">
                          {pendingNames[m.resident_id] ?? '…'}
                        </p>
                        <p className="text-xs text-gray-500">
                          Ref: {m.reference_month} · Venc: {fmtDate(m.due_date)}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-sm font-bold text-blue-700">{fmt(m.amount)}</span>
                        <button
                          disabled={!openSession || payingId === m.id}
                          onClick={() => handlePayMensalidade(m.id)}
                          className="text-xs bg-green-600 hover:bg-green-700 disabled:opacity-40 text-white px-3 py-1.5 rounded-lg transition">
                          {payingId === m.id ? '…' : 'Pagar'}
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* Inadimplentes */}
          {cobrancasView === 'inadimplentes' && (
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100 bg-red-50">
                <p className="text-sm font-semibold text-red-700 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4" />
                  Inadimplentes ({delinquent.length})
                </p>
                {delinquent.length > 0 && (
                  <p className="text-xs text-red-500 mt-0.5">
                    Total em atraso: {fmt(delinquent.reduce((s, d) => s + parseFloat(d.amount), 0))}
                  </p>
                )}
              </div>
              {delinquent.length === 0 ? (
                <div className="p-6 text-center text-gray-400 text-sm">Nenhum inadimplente. 🎉</div>
              ) : (
                <ul className="divide-y divide-gray-100">
                  {delinquent.map(d => (
                    <li key={d.id} className="px-4 py-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-gray-800 truncate">
                            {delinquentNames[d.resident_id] ?? '…'}
                          </p>
                          <p className="text-xs text-gray-500">
                            Ref: {d.reference_month} · Venc: {fmtDate(d.due_date)}
                          </p>
                          <span className="text-xs text-red-600 font-medium">
                            {d.months_overdue} {d.months_overdue === 1 ? 'mês' : 'meses'} em atraso
                          </span>
                        </div>
                        <div className="flex flex-col items-end gap-1.5 shrink-0">
                          <span className="text-sm font-bold text-gray-800">{fmt(d.amount)}</span>
                          <div className="flex gap-1">
                            <button
                              onClick={() => loadResidentHistory(d.resident_id)}
                              className="text-xs text-[#26619c] hover:underline flex items-center gap-1">
                              <Users className="w-3 h-3" /> Histórico
                            </button>
                            <button
                              onClick={() => handlePayMensalidade(d.id)}
                              disabled={!openSession || payingId === d.id}
                              className="text-xs bg-green-500 hover:bg-green-600 disabled:opacity-40 text-white px-2 py-1 rounded-lg transition">
                              {payingId === d.id ? '…' : 'Pagar'}
                            </button>
                          </div>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* Histórico por morador */}
          {cobrancasView === 'historico' && (
            <div className="flex flex-col gap-3">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  placeholder="Buscar morador para ver histórico…"
                  className={`${inputCls} pl-9`}
                  onChange={e => searchResidents(e.target.value)}
                />
              </div>
              {residentResults.length > 0 && (
                <ul className="border border-gray-200 rounded-lg divide-y divide-gray-100 max-h-40 overflow-y-auto bg-white">
                  {residentResults.map(r => (
                    <li key={r.id}>
                      <button className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50"
                        onClick={() => { setResidentResults([]); loadResidentHistory(r.id) }}>
                        <span className="font-medium text-gray-800">{r.full_name}</span>
                        {r.unit && <span className="text-xs text-gray-400 ml-2">Unid. {r.unit}</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {history.length > 0 && (
                <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                  <div className="px-4 py-3 border-b border-gray-100">
                    <p className="text-sm font-semibold text-gray-800">Histórico de Mensalidades</p>
                  </div>
                  <ul className="divide-y divide-gray-100">
                    {history.map(m => (
                      <li key={m.id} className="px-4 py-3 flex items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-medium text-gray-800">{m.reference_month}</p>
                          <p className="text-xs text-gray-400">Venc: {fmtDate(m.due_date)}</p>
                          {m.paid_at && <p className="text-xs text-green-600">Pago em: {fmtDate(m.paid_at)}</p>}
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-sm font-bold text-gray-800">{fmt(m.amount)}</span>
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                            m.status === 'paid' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'
                          }`}>
                            {m.status === 'paid' ? 'Pago' : 'Pendente'}
                          </span>
                          {m.status !== 'paid' && (
                            <button
                              onClick={() => handlePayMensalidade(m.id)}
                              disabled={!openSession || payingId === m.id}
                              className="text-xs bg-green-500 hover:bg-green-600 disabled:opacity-40 text-white px-2 py-1 rounded-lg transition">
                              {payingId === m.id ? '…' : 'Pagar'}
                            </button>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── RELATÓRIOS (Sessões) ── */}
      {tab === 'relatorios' && (() => {
        const closed = sessions.filter(s => s.status === 'closed')
        const totalDiff = closed.reduce((sum, s) => sum + parseFloat(s.difference ?? '0'), 0)
        return (
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
                <p className="text-xs text-gray-500 mb-1">Sessões</p>
                <p className="text-2xl font-bold text-gray-800">{sessions.length}</p>
                <p className="text-xs text-gray-400">{closed.length} fechadas</p>
              </div>
              <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 col-span-2">
                <p className="text-xs text-gray-500 mb-1">Diferença acumulada</p>
                <p className={`text-xl font-bold ${totalDiff >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                  {totalDiff >= 0 ? '+' : ''}{fmt(totalDiff)}
                </p>
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
                        <div className="flex flex-wrap gap-3 text-xs text-gray-500">
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

      {/* ── CONCILIAÇÃO PIX ── */}
      {tab === 'conciliacao' && (
        <div className="flex flex-col gap-4">
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
            <h2 className="font-semibold text-gray-800 mb-1">Importar Extrato Bancário</h2>
            <p className="text-xs text-gray-400 mb-4">Importe o extrato CSV para conciliar pagamentos PIX.</p>
            <div className="flex flex-col gap-3">
              <div>
                <label className="block text-xs text-gray-600 mb-1">Banco</label>
                <select value={bankType} onChange={e => setBankType(e.target.value as any)}
                  className={inputCls}>
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
              <button onClick={handleReconcile} disabled={reconciling}
                className="flex items-center justify-center gap-2 border border-[#26619c] text-[#26619c] py-2 rounded-xl text-sm font-medium transition hover:bg-blue-50 disabled:opacity-50">
                {reconciling ? 'Conciliando…' : 'Re-executar Conciliação'}
              </button>
            </div>
          </div>

          {reconciliationResults && (
            <div className="flex flex-col gap-3">
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
                          <p className="text-xs text-gray-400">{item.date} · {item.bank}</p>
                        </div>
                        <span className="font-bold text-green-700">R$ {item.amount.toFixed(2)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="bg-white rounded-xl border border-yellow-200 shadow-sm p-4">
                <h3 className="font-semibold text-yellow-700 mb-3 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4" />
                  Sugestões ({reconciliationResults.sugestao.length})
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

      {/* ── MODAL ESTORNO ── */}
      {reversalTarget && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-4">
          <div className="w-full max-w-sm bg-white rounded-2xl shadow-2xl p-5 flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-gray-900">Estornar Transação</h3>
              <button onClick={() => setReversalTarget(null)}><X className="w-5 h-5 text-gray-400" /></button>
            </div>
            <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2.5">
              <p className="text-sm font-medium text-gray-800">{reversalTarget.description}</p>
              <p className="text-lg font-bold text-red-600">- {fmt(reversalTarget.amount)}</p>
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">Motivo do estorno *</label>
              <input
                value={reversalReason}
                onChange={e => setReversalReason(e.target.value)}
                className={inputCls}
                placeholder="Descreva o motivo…"
                autoFocus
              />
            </div>
            <div className="flex gap-2">
              <button onClick={() => setReversalTarget(null)}
                className="flex-1 border border-gray-300 text-gray-600 py-2.5 rounded-xl text-sm hover:bg-gray-50 transition">
                Cancelar
              </button>
              <button
                onClick={handleReversal}
                disabled={!reversalReason.trim() || reversing === reversalTarget.id}
                className="flex-1 bg-red-500 hover:bg-red-600 text-white py-2.5 rounded-xl text-sm font-semibold transition disabled:opacity-50">
                {reversing === reversalTarget.id ? 'Estornando…' : 'Confirmar Estorno'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
