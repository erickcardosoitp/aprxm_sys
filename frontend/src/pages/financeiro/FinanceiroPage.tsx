import { useEffect, useState } from 'react'
import {
  TrendingUp, TrendingDown, DollarSign, BarChart2, Upload,
  CheckCircle, AlertCircle, Clock, Plus, Search, X, RotateCcw,
  CreditCard, Users, ArrowLeftRight, Pencil, Trash2,
} from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../../services/api'
import type { Resident } from '../../types'

type Tab = 'dashboard' | 'receitas' | 'despesas' | 'cobrancas' | 'relatorios' | 'conciliacao' | 'transferencias'

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
  origin?: string; association_name?: string
  operador_name?: string; conferido_por?: string
  total_pix?: string; total_dinheiro?: string
  total_bruto?: string; total_baixas?: string
  quebra_caixa?: string | null
}

interface ManualSessionForm {
  opening_balance: string; closing_balance: string
  opened_at: string; closed_at: string; notes: string
  manual_pix: string; manual_dinheiro: string
  manual_total_baixas: string
}

interface Mensalidade {
  id: string | null; resident_id: string; reference_month: string
  due_date: string | null; amount: string; status: string
  paid_at: string | null; transaction_id: string | null; notes: string | null
  origem?: 'sistema' | 'migracao'; tipo?: string
}

interface TxReview {
  id: string; type: string; income_subtype?: string; amount: string
  description: string; transaction_at: string; is_sangria: boolean
  created_by_name?: string; conferido: boolean; observacao?: string
}

interface CashBox {
  id: string; name: string; description?: string; balance: string; is_active: boolean
}

interface BoxMovement {
  id: string; amount: string; movement_type: string; description: string
  created_at: string; created_by_name?: string
}

interface Conferente { id: string; full_name: string; role: string }

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
  const [showManualSession, setShowManualSession] = useState(false)
  const [manualForm, setManualForm] = useState<ManualSessionForm>({ opening_balance: '', closing_balance: '', opened_at: '', closed_at: '', notes: '', manual_pix: '', manual_dinheiro: '', manual_total_baixas: '' })
  const [savingManual, setSavingManual] = useState(false)
  const [conferentes, setConferentes] = useState<Conferente[]>([])
  const [manualReviewedBy, setManualReviewedBy] = useState('')

  // Session reviews
  const [reviewSession, setReviewSession] = useState<Session | null>(null)
  const [reviewTxs, setReviewTxs] = useState<TxReview[]>([])
  const [reviewConferidoPor, setReviewConferidoPor] = useState('')
  const [savingReviews, setSavingReviews] = useState(false)

  // Transferências / Cash Boxes
  const [cashBoxes, setCashBoxes] = useState<CashBox[]>([])
  const [boxSummary, setBoxSummary] = useState<{ open_session_balance: string | null; total_in_boxes: string; sangria_by_destination: { destination: string; total: string }[] } | null>(null)
  const [loadingBoxes, setLoadingBoxes] = useState(false)
  const [selectedBox, setSelectedBox] = useState<CashBox | null>(null)
  const [boxMovements, setBoxMovements] = useState<BoxMovement[]>([])
  const [showBoxForm, setShowBoxForm] = useState(false)
  const [boxForm, setBoxForm] = useState({ name: '', description: '' })
  const [editBox, setEditBox] = useState<CashBox | null>(null)
  const [showMoveForm, setShowMoveForm] = useState(false)
  const [moveForm, setMoveForm] = useState({ amount: '', movement_type: 'credit', description: '' })
  const [savingBox, setSavingBox] = useState(false)

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
  const [showGenMonth, setShowGenMonth] = useState(false)
  const [genMonthForm, setGenMonthForm] = useState({ reference_month: new Date().toISOString().slice(0, 7), due_day: '10', amount: '' })
  const [generatingMonth, setGeneratingMonth] = useState(false)
  const [createForm, setCreateForm] = useState({
    resident_id: '', reference_month: '', due_date: '', amount: '', notes: '',
  })
  const [residentSearch, setResidentSearch] = useState('')
  const [residentResults, setResidentResults] = useState<Resident[]>([])
  const [selectedResident, setSelectedResident] = useState<Resident | null>(null)
  const [historyResidentId, setHistoryResidentId] = useState<string | null>(null)
  const [historyResidentName, setHistoryResidentName] = useState<string | null>(null)
  const [historySearch, setHistorySearch] = useState('')
  const [history, setHistory] = useState<Mensalidade[]>([])
  const [cobrancasView, setCobrancasView] = useState<'pendentes' | 'inadimplentes' | 'pagos' | 'historico'>('pendentes')

  // Pagos
  interface PaidItem { id: string; resident_id: string; resident_name: string; reference_month: string; due_date: string; amount: string; paid_at: string | null; transaction_id: string | null }
  const [paidItems, setPaidItems] = useState<PaidItem[]>([])
  const [paidMonth, setPaidMonth] = useState(() => new Date().toISOString().slice(0, 7))
  const [loadingPaid, setLoadingPaid] = useState(false)

  // Relatório de mensalidades
  const [reportFromMonth, setReportFromMonth] = useState(() => {
    const now = new Date(); return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  })
  const [reportToMonth, setReportToMonth] = useState(() => {
    const now = new Date(); return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  })
  const [report, setReport] = useState<{ from_month: string; to_month: string; total: number; paid_count: number; pending_count: number; total_paid: string; total_pending: string; items: any[] } | null>(null)
  const [loadingReport, setLoadingReport] = useState(false)

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
    if (tab === 'relatorios') { loadSessions(); loadConferentes() }
    if (tab === 'cobrancas') { loadOpenSession(); loadCobrancas() }
    if (tab === 'transferencias') loadBoxSummary()
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

  const loadConferentes = async () => {
    try { const r = await api.get<Conferente[]>('/finance/conferentes'); setConferentes(r.data) } catch { /* ignore */ }
  }

  const openReview = async (s: Session) => {
    setReviewSession(s)
    setReviewConferidoPor('')
    try {
      const r = await api.get<TxReview[]>(`/finance/sessions/${s.id}/transactions`)
      setReviewTxs(r.data)
    } catch { setReviewTxs([]) }
  }

  const handleSaveReviews = async () => {
    if (!reviewSession) return
    setSavingReviews(true)
    try {
      await api.put(`/finance/sessions/${reviewSession.id}/reviews`, {
        reviews: reviewTxs.map(t => ({ transaction_id: t.id, conferido: t.conferido, observacao: t.observacao || null })),
        reviewed_by_id: reviewConferidoPor || null,
      })
      setReviewSession(null)
      loadSessions()
    } catch { /* ignore */ } finally { setSavingReviews(false) }
  }

  const loadBoxSummary = async () => {
    setLoadingBoxes(true)
    try {
      const [sumR, boxR] = await Promise.all([
        api.get('/cash-boxes/summary'),
        api.get<CashBox[]>('/cash-boxes'),
      ])
      setBoxSummary(sumR.data)
      setCashBoxes(boxR.data)
    } catch { /* ignore */ } finally { setLoadingBoxes(false) }
  }

  const loadBoxMovements = async (boxId: string) => {
    try { const r = await api.get<BoxMovement[]>(`/cash-boxes/${boxId}/movements`); setBoxMovements(r.data) } catch { setBoxMovements([]) }
  }

  const handleSaveBox = async () => {
    if (!boxForm.name.trim()) return
    setSavingBox(true)
    try {
      if (editBox) {
        await api.put(`/cash-boxes/${editBox.id}`, boxForm)
      } else {
        await api.post('/cash-boxes', boxForm)
      }
      setShowBoxForm(false); setEditBox(null); setBoxForm({ name: '', description: '' })
      loadBoxSummary()
    } catch { /* ignore */ } finally { setSavingBox(false) }
  }

  const handleDeactivateBox = async (id: string) => {
    if (!window.confirm('Desativar esta caixinha?')) return
    await api.delete(`/cash-boxes/${id}`)
    loadBoxSummary()
    if (selectedBox?.id === id) setSelectedBox(null)
  }

  const handleAddMovement = async () => {
    if (!selectedBox || !moveForm.amount || !moveForm.description) return
    setSavingBox(true)
    try {
      await api.post(`/cash-boxes/${selectedBox.id}/movements`, {
        amount: parseFloat(moveForm.amount),
        movement_type: moveForm.movement_type,
        description: moveForm.description,
      })
      setShowMoveForm(false); setMoveForm({ amount: '', movement_type: 'credit', description: '' })
      loadBoxSummary()
      loadBoxMovements(selectedBox.id)
    } catch { /* ignore */ } finally { setSavingBox(false) }
  }

  const handleCreateManualSession = async () => {
    if (!manualForm.opening_balance || !manualForm.closing_balance || !manualForm.opened_at || !manualForm.closed_at) return
    setSavingManual(true)
    try {
      await api.post('/finance/sessions/manual', {
        opening_balance: parseFloat(manualForm.opening_balance) || 0,
        closing_balance: parseFloat(manualForm.closing_balance) || 0,
        opened_at: new Date(manualForm.opened_at).toISOString(),
        closed_at: new Date(manualForm.closed_at).toISOString(),
        notes: manualForm.notes || null,
        manual_pix: manualForm.manual_pix ? parseFloat(manualForm.manual_pix) : null,
        manual_dinheiro: manualForm.manual_dinheiro ? parseFloat(manualForm.manual_dinheiro) : null,
        manual_total_baixas: manualForm.manual_total_baixas ? parseFloat(manualForm.manual_total_baixas) : null,
        reviewed_by_id: manualReviewedBy || null,
      })
      setShowManualSession(false)
      setManualForm({ opening_balance: '', closing_balance: '', opened_at: '', closed_at: '', notes: '', manual_pix: '', manual_dinheiro: '', manual_total_baixas: '' })
      setManualReviewedBy('')
      loadSessions()
    } catch { /* ignore */ } finally { setSavingManual(false) }
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

  const loadPaidMensalidades = async (month: string) => {
    setLoadingPaid(true)
    try {
      const res = await api.get<any[]>('/mensalidades/paid', { params: { month } })
      setPaidItems(res.data)
    } catch { setPaidItems([]) } finally { setLoadingPaid(false) }
  }

  const loadReport = async () => {
    setLoadingReport(true)
    try {
      const res = await api.get('/mensalidades/report', { params: { from_month: reportFromMonth, to_month: reportToMonth } })
      setReport(res.data)
    } catch (e: any) {
      toast.error(e.response?.data?.detail ?? 'Erro ao gerar relatório.')
    } finally { setLoadingReport(false) }
  }

  const exportReportCSV = () => {
    if (!report) return
    const header = 'Morador,Mês Ref,Vencimento,Valor,Status,Pago em'
    const rows = report.items.map(i =>
      `"${i.resident_name}",${i.reference_month},${i.due_date},${i.amount},${i.status === 'paid' ? 'Pago' : 'Pendente'},${i.paid_at ?? ''}`
    )
    const csv = [header, ...rows].join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `mensalidades_${report.from_month}_${report.to_month}.csv`
    a.click(); URL.revokeObjectURL(url)
  }

  const loadResidentHistory = async (residentId: string, residentName?: string) => {
    try {
      const res = await api.get<Mensalidade[]>(`/mensalidades/residents/${residentId}`)
      setHistory(res.data)
      setHistoryResidentId(residentId)
      if (residentName) setHistoryResidentName(residentName)
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

  const handleGenerateMonth = async () => {
    if (!genMonthForm.reference_month || !genMonthForm.amount) {
      toast.error('Preencha mês e valor.')
      return
    }
    setGeneratingMonth(true)
    try {
      const res = await api.post('/mensalidades/generate-month', {
        reference_month: genMonthForm.reference_month,
        due_day: parseInt(genMonthForm.due_day) || 10,
        amount: parseFloat(genMonthForm.amount),
      })
      toast.success(`${res.data.created} mensalidade(s) gerada(s) para ${genMonthForm.reference_month}.`)
      setShowGenMonth(false)
      loadCobrancas()
    } catch (e: any) {
      toast.error(e.response?.data?.detail ?? 'Erro ao gerar mensalidades.')
    } finally {
      setGeneratingMonth(false)
    }
  }

  const [deleteMonthVal, setDeleteMonthVal] = useState(() => new Date().toISOString().slice(0, 7))
  const [deletingMonth, setDeletingMonth] = useState(false)
  const [showDeleteMonth, setShowDeleteMonth] = useState(false)

  const handleDeleteMonth = async () => {
    if (!deleteMonthVal) return
    if (!window.confirm(`Excluir todas as cobranças PENDENTES de ${deleteMonthVal}? Esta ação não pode ser desfeita.`)) return
    setDeletingMonth(true)
    try {
      const res = await api.delete(`/mensalidades/by-month/${deleteMonthVal}`)
      toast.success(`${res.data.deleted} cobrança(s) excluída(s) de ${deleteMonthVal}.`)
      setShowDeleteMonth(false)
      loadCobrancas()
    } catch (e: any) {
      toast.error(e.response?.data?.detail ?? 'Erro ao excluir cobranças.')
    } finally { setDeletingMonth(false) }
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
    { key: 'relatorios',     label: 'Sessões',        icon: DollarSign },
    { key: 'transferencias', label: 'Transferências', icon: ArrowLeftRight },
    { key: 'conciliacao',    label: 'PIX',            icon: CheckCircle },
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
          <div className="flex gap-1 bg-gray-100 rounded-xl p-1 flex-wrap">
            {([
              { key: 'pendentes', label: 'A Receber' },
              { key: 'inadimplentes', label: 'Inadimplentes' },
              { key: 'pagos', label: 'Pagos' },
              { key: 'historico', label: 'Por Morador' },
            ] as const).map(({ key, label }) => (
              <button key={key}
                onClick={() => {
                  setCobrancasView(key)
                  if (key === 'pagos') loadPaidMensalidades(paidMonth)
                }}
                className={`flex-1 py-2 rounded-lg text-xs font-medium transition min-w-[70px] ${
                  cobrancasView === key ? 'bg-white text-[#26619c] shadow-sm' : 'text-gray-500'
                }`}>
                {label}
              </button>
            ))}
          </div>

          {/* Create button */}
          <div className="flex gap-2 flex-wrap">
            <button onClick={() => { setShowCreateForm(!showCreateForm); setShowGenMonth(false); setShowDeleteMonth(false) }}
              className="flex-1 flex items-center justify-center gap-2 border-2 border-dashed border-[#26619c]/40 rounded-xl py-2.5 text-sm text-[#26619c] hover:bg-blue-50 transition min-w-[120px]">
              <Plus className="w-4 h-4" />
              Nova
            </button>
            <button onClick={() => { setShowGenMonth(!showGenMonth); setShowCreateForm(false); setShowDeleteMonth(false) }}
              className="flex-1 flex items-center justify-center gap-2 border-2 border-dashed border-green-400/60 rounded-xl py-2.5 text-sm text-green-700 hover:bg-green-50 transition min-w-[120px]">
              <Plus className="w-4 h-4" />
              Gerar Mês
            </button>
            <button onClick={() => { setShowDeleteMonth(!showDeleteMonth); setShowCreateForm(false); setShowGenMonth(false) }}
              className="flex-1 flex items-center justify-center gap-2 border-2 border-dashed border-red-300/60 rounded-xl py-2.5 text-sm text-red-600 hover:bg-red-50 transition min-w-[120px]">
              <X className="w-4 h-4" />
              Excluir Mês
            </button>
          </div>
          {showDeleteMonth && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex flex-col gap-3">
              <p className="text-sm font-semibold text-red-700">Excluir cobranças pendentes do mês</p>
              <p className="text-xs text-red-600">Apenas cobranças com status <strong>pendente</strong> serão excluídas. Pagas não são afetadas.</p>
              <div className="flex gap-2">
                <input type="month" value={deleteMonthVal}
                  onChange={e => setDeleteMonthVal(e.target.value)}
                  className={`${inputCls} flex-1`} />
                <button onClick={handleDeleteMonth} disabled={deletingMonth}
                  className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-xl text-sm font-semibold transition disabled:opacity-50">
                  {deletingMonth ? '…' : 'Excluir'}
                </button>
              </div>
            </div>
          )}

          {/* Generate month form */}
          {showGenMonth && (
            <div className="bg-white border border-gray-200 rounded-xl p-4 flex flex-col gap-3 shadow-sm">
              <p className="text-sm font-semibold text-gray-800">Gerar Mensalidades do Mês</p>
              <p className="text-xs text-gray-500">Cria mensalidades pendentes para todos os associados ativos sem registro no mês.</p>
              <div className="grid grid-cols-3 gap-2">
                <div className="col-span-1">
                  <label className="block text-xs text-gray-600 mb-1">Mês *</label>
                  <input type="month" value={genMonthForm.reference_month}
                    onChange={e => setGenMonthForm(f => ({ ...f, reference_month: e.target.value }))}
                    className={inputCls} />
                </div>
                <div className="col-span-1">
                  <label className="block text-xs text-gray-600 mb-1">Dia venc.</label>
                  <input type="number" min="1" max="31" value={genMonthForm.due_day}
                    onChange={e => setGenMonthForm(f => ({ ...f, due_day: e.target.value }))}
                    className={inputCls} placeholder="10" />
                </div>
                <div className="col-span-1">
                  <label className="block text-xs text-gray-600 mb-1">Valor R$ *</label>
                  <input type="number" min="0" step="0.01" value={genMonthForm.amount}
                    onChange={e => setGenMonthForm(f => ({ ...f, amount: e.target.value }))}
                    className={inputCls} placeholder="0.00" />
                </div>
              </div>
              <button onClick={handleGenerateMonth} disabled={generatingMonth}
                className="bg-green-600 hover:bg-green-700 text-white py-2 rounded-xl text-sm font-semibold transition disabled:opacity-50">
                {generatingMonth ? 'Gerando…' : 'Gerar Mensalidades'}
              </button>
            </div>
          )}

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
                          Ref: {m.reference_month} · Venc: {m.due_date ? fmtDate(m.due_date) : '—'}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-sm font-bold text-blue-700">{fmt(m.amount)}</span>
                        <button
                          disabled={!openSession || payingId === m.id}
                          onClick={() => m.id && handlePayMensalidade(m.id)}
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

          {/* Pagos */}
          {cobrancasView === 'pagos' && (
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <input type="month" value={paidMonth}
                  onChange={e => { setPaidMonth(e.target.value); loadPaidMensalidades(e.target.value) }}
                  className={inputCls} />
              </div>
              <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
                  <p className="text-sm font-semibold text-gray-800">
                    Pagamentos Recebidos — {paidMonth}
                  </p>
                  <span className="text-xs text-gray-400">
                    {loadingPaid ? 'Carregando…' : `${paidItems.length} registro(s)`}
                  </span>
                </div>
                {!loadingPaid && paidItems.length === 0 ? (
                  <div className="p-6 text-center text-gray-400 text-sm">Nenhum pagamento neste mês.</div>
                ) : (
                  <ul className="divide-y divide-gray-100">
                    {paidItems.map(p => (
                      <li key={p.id} className="px-4 py-3 flex items-center justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-gray-800 truncate">{p.resident_name}</p>
                          <p className="text-xs text-gray-500">Ref: {p.reference_month}</p>
                          {p.paid_at && (
                            <p className="text-xs text-green-600">
                              Pago em: {fmtDate(p.paid_at)}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-sm font-bold text-green-700">{fmt(p.amount)}</span>
                          <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">Pago</span>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
                {paidItems.length > 0 && (
                  <div className="px-4 py-2 bg-gray-50 border-t border-gray-100 flex justify-between items-center">
                    <span className="text-xs text-gray-500">Total arrecadado</span>
                    <span className="text-sm font-bold text-green-700">
                      {fmt(paidItems.reduce((s, p) => s + parseFloat(p.amount), 0))}
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Histórico por morador */}
          {cobrancasView === 'historico' && (
            <div className="flex flex-col gap-3">
              {/* Search box */}
              {!historyResidentId ? (
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input
                    value={historySearch}
                    placeholder="Buscar morador por nome…"
                    className={`${inputCls} pl-9`}
                    onChange={e => { setHistorySearch(e.target.value); searchResidents(e.target.value) }}
                  />
                  {residentResults.length > 0 && (
                    <ul className="absolute z-10 top-full left-0 right-0 mt-1 border border-gray-200 rounded-xl divide-y divide-gray-100 bg-white shadow-lg max-h-52 overflow-y-auto">
                      {residentResults.map(r => (
                        <li key={r.id}>
                          <button className="w-full text-left px-4 py-3 text-sm hover:bg-blue-50 transition"
                            onClick={() => {
                              setResidentResults([])
                              setHistorySearch('')
                              loadResidentHistory(r.id, r.full_name)
                            }}>
                            <span className="font-medium text-gray-800">{r.full_name}</span>
                            <span className="text-xs text-gray-400 ml-2">{r.unit ? `Unid. ${r.unit}` : ''}{r.cpf ? ` · ${r.cpf}` : ''}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ) : (
                <div className="flex items-center justify-between bg-blue-50 border border-blue-100 rounded-xl px-4 py-3">
                  <div>
                    <p className="text-xs text-gray-500">Histórico de</p>
                    <p className="text-sm font-semibold text-[#1a3f6f]">{historyResidentName}</p>
                  </div>
                  <button onClick={() => { setHistoryResidentId(null); setHistoryResidentName(null); setHistory([]) }}
                    className="text-xs text-gray-400 hover:text-red-500 flex items-center gap-1 transition">
                    <X className="w-3.5 h-3.5" /> Trocar
                  </button>
                </div>
              )}

              {/* Stats */}
              {history.length > 0 && (() => {
                const paid = history.filter(m => m.status === 'paid').length
                const pending = history.filter(m => m.status !== 'paid').length
                const total = history.reduce((s, m) => s + parseFloat(m.amount), 0)
                const paidTotal = history.filter(m => m.status === 'paid').reduce((s, m) => s + parseFloat(m.amount), 0)
                return (
                  <div className="grid grid-cols-3 gap-2">
                    <div className="bg-white rounded-xl border border-gray-200 p-3 text-center">
                      <p className="text-lg font-bold text-green-600">{paid}</p>
                      <p className="text-xs text-gray-400">Pagas</p>
                    </div>
                    <div className="bg-white rounded-xl border border-gray-200 p-3 text-center">
                      <p className="text-lg font-bold text-red-500">{pending}</p>
                      <p className="text-xs text-gray-400">Pendentes</p>
                    </div>
                    <div className="bg-white rounded-xl border border-gray-200 p-3 text-center">
                      <p className="text-sm font-bold text-gray-700">{fmt(paidTotal)}</p>
                      <p className="text-xs text-gray-400">de {fmt(total)}</p>
                    </div>
                  </div>
                )
              })()}

              {history.length > 0 && (
                <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                  <ul className="divide-y divide-gray-100">
                    {history.map((m, idx) => {
                      const isPaid = m.status === 'paid'
                      const isMig = m.origem === 'migracao'
                      const isOverdue = !isPaid && m.due_date && new Date(m.due_date) < new Date()
                      return (
                        <li key={m.id ?? `mig-${idx}`} className="px-4 py-3 flex items-center justify-between gap-3">
                          <div className="flex items-center gap-3">
                            <div className={`w-2 h-2 rounded-full shrink-0 ${isPaid ? 'bg-green-400' : isOverdue ? 'bg-red-400' : 'bg-amber-400'}`} />
                            <div>
                              <div className="flex items-center gap-2">
                                <p className="text-sm font-semibold text-gray-800">{m.reference_month}</p>
                                {isMig && <span className="text-xs bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded-full">Migração</span>}
                              </div>
                              {isPaid && m.paid_at
                                ? <p className="text-xs text-green-600">Pago em {fmtDate(m.paid_at)}</p>
                                : m.due_date
                                  ? <p className={`text-xs ${isOverdue ? 'text-red-500' : 'text-gray-400'}`}>Venc. {fmtDate(m.due_date)}</p>
                                  : <p className="text-xs text-gray-400">Histórico anterior</p>
                              }
                            </div>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <span className="text-sm font-bold text-gray-800">{fmt(m.amount)}</span>
                            {!isPaid && !isMig && (
                              <button
                                onClick={() => handlePayMensalidade(m.id!)}
                                disabled={!openSession || payingId === m.id}
                                className="text-xs bg-green-500 hover:bg-green-600 disabled:opacity-40 text-white px-3 py-1 rounded-lg transition">
                                {payingId === m.id ? '…' : 'Pagar'}
                              </button>
                            )}
                          </div>
                        </li>
                      )
                    })}
                  </ul>
                </div>
              )}

              {historyResidentId && history.length === 0 && (
                <p className="text-sm text-center text-gray-400 py-6">Nenhuma cobrança encontrada.</p>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── RELATÓRIOS ── */}
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
              <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-gray-800">Histórico de Sessões</h3>
                <button onClick={() => setShowManualSession(true)} className="text-xs bg-indigo-600 text-white px-3 py-1.5 rounded-lg font-medium">+ Manual</button>
              </div>
              {loadingSessions ? (
                <div className="p-6 text-center text-gray-400 text-sm">Carregando…</div>
              ) : sessions.length === 0 ? (
                <div className="p-6 text-center text-gray-400 text-sm">Nenhuma sessão encontrada.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs min-w-[1100px]">
                    <thead className="bg-gray-50 border-b border-gray-100">
                      <tr>
                        {['Data','Associação','Funcionário','R$ PIX','R$ Dinheiro','R$ Bruto Lançado','R$ Baixas','R$ Líquido','Conf. Cega','Sobra/Falta','Conferido por','Quebra de Caixa','Origem'].map(h => (
                          <th key={h} className="px-3 py-2 text-left font-semibold text-gray-600 whitespace-nowrap">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {sessions.map(s => {
                        const bruto = parseFloat(s.total_bruto ?? '0')
                        const baixas = parseFloat(s.total_baixas ?? '0')
                        const liquido = bruto - baixas
                        const diff = s.difference != null ? parseFloat(s.difference) : null
                        const isManual = s.origin === 'Manual'
                        return (
                          <tr key={s.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => openReview(s)}>
                            <td className="px-3 py-2 whitespace-nowrap text-gray-800 font-medium">{fmtDate(s.opened_at)}</td>
                            <td className="px-3 py-2 whitespace-nowrap text-gray-600">{s.association_name ?? '—'}</td>
                            <td className="px-3 py-2 whitespace-nowrap text-gray-600">{s.operador_name ?? '—'}</td>
                            <td className="px-3 py-2 whitespace-nowrap text-gray-700">{fmt(s.total_pix ?? '0')}</td>
                            <td className="px-3 py-2 whitespace-nowrap text-gray-700">{fmt(s.total_dinheiro ?? '0')}</td>
                            <td className="px-3 py-2 whitespace-nowrap text-gray-700">{fmt(bruto)}</td>
                            <td className="px-3 py-2 whitespace-nowrap text-gray-700">{fmt(baixas)}</td>
                            <td className="px-3 py-2 whitespace-nowrap font-semibold text-gray-800">{fmt(liquido)}</td>
                            <td className="px-3 py-2 whitespace-nowrap text-gray-700">{s.closing_balance ? fmt(s.closing_balance) : '—'}</td>
                            <td className={`px-3 py-2 whitespace-nowrap font-semibold ${diff === null ? 'text-gray-400' : diff === 0 ? 'text-green-600' : diff > 0 ? 'text-blue-600' : 'text-red-600'}`}>
                              {diff !== null ? `${diff >= 0 ? '+' : ''}${fmt(diff)}` : '—'}
                            </td>
                            <td className="px-3 py-2 whitespace-nowrap text-gray-600">{s.conferido_por ?? '—'}</td>
                            <td className="px-3 py-2 whitespace-nowrap text-gray-700">{s.quebra_caixa ? fmt(s.quebra_caixa) : '—'}</td>
                            <td className="px-3 py-2 whitespace-nowrap">
                              <span className={`px-2 py-0.5 rounded-full font-medium ${isManual ? 'bg-amber-100 text-amber-700' : 'bg-indigo-50 text-indigo-600'}`}>
                                {s.origin ?? 'Sessão de Caixa'}
                              </span>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Relatório de Mensalidades */}
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-gray-800">Relatório de Mensalidades</h3>
              </div>
              <div className="p-4 flex flex-col gap-3">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">De</label>
                    <input type="month" value={reportFromMonth}
                      onChange={e => setReportFromMonth(e.target.value)}
                      className={inputCls} />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Até</label>
                    <input type="month" value={reportToMonth}
                      onChange={e => setReportToMonth(e.target.value)}
                      className={inputCls} />
                  </div>
                </div>
                <button onClick={loadReport} disabled={loadingReport}
                  className="bg-[#26619c] hover:bg-[#1a4f87] disabled:opacity-50 text-white py-2 rounded-xl text-sm font-medium transition">
                  {loadingReport ? 'Gerando…' : 'Gerar Relatório'}
                </button>
                {report && (
                  <div className="flex flex-col gap-2">
                    <div className="grid grid-cols-3 gap-2">
                      <div className="bg-green-50 rounded-lg p-3 text-center">
                        <p className="text-xs text-green-600">Pagos</p>
                        <p className="text-lg font-bold text-green-700">{report.paid_count}</p>
                        <p className="text-xs text-green-600">{fmt(report.total_paid)}</p>
                      </div>
                      <div className="bg-red-50 rounded-lg p-3 text-center">
                        <p className="text-xs text-red-500">Pendentes</p>
                        <p className="text-lg font-bold text-red-600">{report.pending_count}</p>
                        <p className="text-xs text-red-500">{fmt(report.total_pending)}</p>
                      </div>
                      <div className="bg-blue-50 rounded-lg p-3 text-center">
                        <p className="text-xs text-blue-500">Total</p>
                        <p className="text-lg font-bold text-blue-700">{report.total}</p>
                        <p className="text-xs text-blue-500">registros</p>
                      </div>
                    </div>
                    <button onClick={exportReportCSV}
                      className="flex items-center justify-center gap-2 border border-[#26619c] text-[#26619c] py-2 rounded-xl text-sm font-medium hover:bg-blue-50 transition">
                      <Upload className="w-4 h-4" />
                      Exportar CSV
                    </button>
                    <div className="max-h-64 overflow-y-auto rounded-lg border border-gray-200">
                      <table className="w-full text-xs">
                        <thead className="bg-gray-50 sticky top-0">
                          <tr>
                            <th className="text-left px-3 py-2 text-gray-500 font-medium">Morador</th>
                            <th className="text-left px-3 py-2 text-gray-500 font-medium">Mês</th>
                            <th className="text-right px-3 py-2 text-gray-500 font-medium">Valor</th>
                            <th className="text-center px-3 py-2 text-gray-500 font-medium">Status</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {report.items.map(i => (
                            <tr key={i.id}>
                              <td className="px-3 py-2 text-gray-700 truncate max-w-[120px]">{i.resident_name}</td>
                              <td className="px-3 py-2 text-gray-500">{i.reference_month}</td>
                              <td className="px-3 py-2 text-right font-medium text-gray-800">{fmt(i.amount)}</td>
                              <td className="px-3 py-2 text-center">
                                <span className={`px-1.5 py-0.5 rounded-full font-medium text-xs ${
                                  i.status === 'paid' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'
                                }`}>
                                  {i.status === 'paid' ? 'Pago' : 'Pendente'}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )
      })()}

      {/* ── TRANSFERÊNCIAS / CAIXINHAS ── */}
      {tab === 'transferencias' && (
        <div className="flex flex-col gap-4">
          {loadingBoxes ? (
            <div className="text-center text-gray-400 text-sm py-8">Carregando…</div>
          ) : (
            <>
              {/* Summary cards */}
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
                  <p className="text-xs text-gray-500 mb-1">Caixa Aberto</p>
                  <p className="text-xl font-bold text-gray-800">{boxSummary?.open_session_balance ? fmt(boxSummary.open_session_balance) : '—'}</p>
                </div>
                <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
                  <p className="text-xs text-gray-500 mb-1">Total em Caixinhas</p>
                  <p className="text-xl font-bold text-indigo-700">{boxSummary ? fmt(boxSummary.total_in_boxes) : '—'}</p>
                </div>
              </div>

              {/* Sangrias por destino */}
              {boxSummary && boxSummary.sangria_by_destination.length > 0 && (
                <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
                  <p className="text-sm font-semibold text-gray-800 mb-3">Sangrias — últimos 30 dias</p>
                  <ul className="flex flex-col gap-1">
                    {boxSummary.sangria_by_destination.map((s, i) => (
                      <li key={i} className="flex justify-between text-sm">
                        <span className="text-gray-600">{s.destination}</span>
                        <span className="font-semibold text-amber-700">{fmt(s.total)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Caixinhas list */}
              <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-gray-800">Caixinhas</h3>
                  <button onClick={() => { setEditBox(null); setBoxForm({ name: '', description: '' }); setShowBoxForm(true) }}
                    className="text-xs bg-indigo-600 text-white px-3 py-1.5 rounded-lg font-medium">+ Nova</button>
                </div>
                {cashBoxes.length === 0 ? (
                  <p className="p-4 text-sm text-gray-400">Nenhuma caixinha cadastrada.</p>
                ) : (
                  <ul className="divide-y divide-gray-100">
                    {cashBoxes.map(box => (
                      <li key={box.id} className="px-4 py-3">
                        <div className="flex items-center justify-between mb-1">
                          <div>
                            <p className="text-sm font-medium text-gray-800">{box.name}</p>
                            {box.description && <p className="text-xs text-gray-400">{box.description}</p>}
                          </div>
                          <div className="flex items-center gap-3">
                            <span className="text-base font-bold text-indigo-700">{fmt(box.balance)}</span>
                            <button onClick={() => { setEditBox(box); setBoxForm({ name: box.name, description: box.description ?? '' }); setShowBoxForm(true) }}
                              className="text-gray-400 hover:text-gray-600"><Pencil className="w-3.5 h-3.5" /></button>
                            <button onClick={() => handleDeactivateBox(box.id)} className="text-red-400 hover:text-red-600">
                              <Trash2 className="w-3.5 h-3.5" /></button>
                          </div>
                        </div>
                        <div className="flex gap-2 mt-2">
                          <button onClick={() => { setSelectedBox(box); setMoveForm({ amount: '', movement_type: 'credit', description: '' }); setShowMoveForm(true); loadBoxMovements(box.id) }}
                            className="text-xs bg-green-50 text-green-700 border border-green-200 px-2 py-1 rounded font-medium">+ Entrada</button>
                          <button onClick={() => { setSelectedBox(box); setMoveForm({ amount: '', movement_type: 'debit', description: '' }); setShowMoveForm(true); loadBoxMovements(box.id) }}
                            className="text-xs bg-red-50 text-red-700 border border-red-200 px-2 py-1 rounded font-medium">− Saída</button>
                          <button onClick={() => { setSelectedBox(box); setShowMoveForm(false); loadBoxMovements(box.id) }}
                            className="text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded font-medium">Histórico</button>
                        </div>
                        {selectedBox?.id === box.id && !showMoveForm && boxMovements.length > 0 && (
                          <ul className="mt-2 flex flex-col gap-1 border-t border-gray-100 pt-2">
                            {boxMovements.slice(0, 10).map(m => (
                              <li key={m.id} className="flex justify-between text-xs text-gray-500">
                                <span>{m.description}</span>
                                <span className={m.movement_type === 'credit' ? 'text-green-600 font-medium' : 'text-red-600 font-medium'}>
                                  {m.movement_type === 'credit' ? '+' : '−'}{fmt(m.amount)}
                                </span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}

          {/* Box form modal */}
          {showBoxForm && (
            <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4">
              <div className="bg-white rounded-2xl w-full max-w-md p-5 flex flex-col gap-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-base font-semibold text-gray-800">{editBox ? 'Editar Caixinha' : 'Nova Caixinha'}</h2>
                  <button onClick={() => setShowBoxForm(false)} className="text-gray-400 text-xl">×</button>
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Nome *</label>
                  <input value={boxForm.name} onChange={e => setBoxForm(f => ({ ...f, name: e.target.value }))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" placeholder="Ex: Cofre, Banco X…" />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Descrição</label>
                  <input value={boxForm.description} onChange={e => setBoxForm(f => ({ ...f, description: e.target.value }))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" placeholder="Opcional" />
                </div>
                <button onClick={handleSaveBox} disabled={savingBox}
                  className="w-full bg-indigo-600 text-white py-2.5 rounded-xl text-sm font-semibold disabled:opacity-50">
                  {savingBox ? 'Salvando…' : 'Salvar'}
                </button>
              </div>
            </div>
          )}

          {/* Movement modal */}
          {showMoveForm && selectedBox && (
            <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4">
              <div className="bg-white rounded-2xl w-full max-w-md p-5 flex flex-col gap-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-base font-semibold text-gray-800">
                    {moveForm.movement_type === 'credit' ? 'Entrada' : 'Saída'} — {selectedBox.name}
                  </h2>
                  <button onClick={() => setShowMoveForm(false)} className="text-gray-400 text-xl">×</button>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Tipo</label>
                    <select value={moveForm.movement_type} onChange={e => setMoveForm(f => ({ ...f, movement_type: e.target.value }))}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white">
                      <option value="credit">Entrada (+)</option>
                      <option value="debit">Saída (−)</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Valor (R$)</label>
                    <input type="number" min="0.01" step="0.01" value={moveForm.amount}
                      onChange={e => setMoveForm(f => ({ ...f, amount: e.target.value }))}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
                  </div>
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Descrição *</label>
                  <input value={moveForm.description} onChange={e => setMoveForm(f => ({ ...f, description: e.target.value }))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" placeholder="Ex: Depósito do caixa do dia" />
                </div>
                <button onClick={handleAddMovement} disabled={savingBox}
                  className="w-full bg-indigo-600 text-white py-2.5 rounded-xl text-sm font-semibold disabled:opacity-50">
                  {savingBox ? 'Salvando…' : 'Confirmar'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

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
      {/* ── SESSION REVIEW MODAL ── */}
      {reviewSession && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl w-full max-w-2xl p-5 flex flex-col gap-4 my-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-gray-800">Conferência — {fmtDate(reviewSession.opened_at)}</h2>
              <button onClick={() => setReviewSession(null)} className="text-gray-400 text-xl">×</button>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Conferido por</label>
              <select value={reviewConferidoPor} onChange={e => setReviewConferidoPor(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white">
                <option value="">Selecionar conferente…</option>
                {conferentes.map(c => <option key={c.id} value={c.id}>{c.full_name}</option>)}
              </select>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs min-w-[500px]">
                <thead className="bg-gray-50 border-b border-gray-100">
                  <tr>
                    <th className="px-2 py-2 text-left text-gray-600">Data</th>
                    <th className="px-2 py-2 text-left text-gray-600">Tipo</th>
                    <th className="px-2 py-2 text-left text-gray-600">Descrição</th>
                    <th className="px-2 py-2 text-right text-gray-600">Valor</th>
                    <th className="px-2 py-2 text-center text-gray-600">Conferido</th>
                    <th className="px-2 py-2 text-left text-gray-600">Observação</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {reviewTxs.map((tx, i) => (
                    <tr key={tx.id} className={tx.conferido ? '' : 'bg-red-50'}>
                      <td className="px-2 py-1.5 whitespace-nowrap text-gray-500">{fmtDate(tx.transaction_at)}</td>
                      <td className="px-2 py-1.5 whitespace-nowrap">
                        <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${tx.type === 'income' ? 'bg-green-100 text-green-700' : tx.type === 'sangria' ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-600'}`}>
                          {tx.type === 'income' ? 'Receita' : tx.type === 'sangria' ? 'Sangria' : 'Despesa'}
                        </span>
                      </td>
                      <td className="px-2 py-1.5 text-gray-700 max-w-[160px] truncate">{tx.description}</td>
                      <td className="px-2 py-1.5 text-right font-medium text-gray-800">{fmt(tx.amount)}</td>
                      <td className="px-2 py-1.5 text-center">
                        <input type="checkbox" checked={tx.conferido}
                          onChange={e => setReviewTxs(prev => prev.map((t, j) => j === i ? { ...t, conferido: e.target.checked } : t))}
                          className="w-4 h-4 accent-indigo-600" />
                      </td>
                      <td className="px-2 py-1.5">
                        <input type="text" value={tx.observacao ?? ''} placeholder={tx.conferido ? '' : 'Observação…'}
                          onChange={e => setReviewTxs(prev => prev.map((t, j) => j === i ? { ...t, observacao: e.target.value } : t))}
                          className="w-full border border-gray-200 rounded px-2 py-1 text-xs" />
                      </td>
                    </tr>
                  ))}
                  {reviewTxs.length === 0 && (
                    <tr><td colSpan={6} className="px-2 py-4 text-center text-gray-400">Nenhuma transação nesta sessão.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            {reviewTxs.some(t => !t.conferido) && (
              <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-xs text-red-700">
                {reviewTxs.filter(t => !t.conferido).length} movimentação(ões) não conferida(s) — adicione uma observação explicando a irregularidade.
              </div>
            )}
            <button onClick={handleSaveReviews} disabled={savingReviews}
              className="w-full bg-indigo-600 text-white py-2.5 rounded-xl text-sm font-semibold disabled:opacity-50">
              {savingReviews ? 'Salvando…' : 'Salvar Conferência'}
            </button>
          </div>
        </div>
      )}

      {showManualSession && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl w-full max-w-lg p-5 flex flex-col gap-4 my-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-gray-800">Nova Sessão Manual</h2>
              <button onClick={() => setShowManualSession(false)} className="text-gray-400 text-xl leading-none">×</button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Data/hora abertura *</label>
                <input type="datetime-local" value={manualForm.opened_at}
                  onChange={e => setManualForm(f => ({ ...f, opened_at: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Data/hora fechamento *</label>
                <input type="datetime-local" value={manualForm.closed_at}
                  onChange={e => setManualForm(f => ({ ...f, closed_at: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Saldo inicial (R$) *</label>
                <input type="number" min="0" step="0.01" value={manualForm.opening_balance}
                  onChange={e => setManualForm(f => ({ ...f, opening_balance: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" placeholder="0,00" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Conf. Cega / Saldo final (R$) *</label>
                <input type="number" min="0" step="0.01" value={manualForm.closing_balance}
                  onChange={e => setManualForm(f => ({ ...f, closing_balance: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" placeholder="0,00" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">R$ PIX</label>
                <input type="number" min="0" step="0.01" value={manualForm.manual_pix}
                  onChange={e => setManualForm(f => ({ ...f, manual_pix: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" placeholder="0,00" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">R$ Dinheiro</label>
                <input type="number" min="0" step="0.01" value={manualForm.manual_dinheiro}
                  onChange={e => setManualForm(f => ({ ...f, manual_dinheiro: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" placeholder="0,00" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">R$ Total Bruto (PIX + Dinheiro)</label>
                <div className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-gray-50 text-gray-700 font-medium">
                  {fmt((parseFloat(manualForm.manual_pix)||0) + (parseFloat(manualForm.manual_dinheiro)||0))}
                </div>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">R$ Baixas</label>
                <input type="number" min="0" step="0.01" value={manualForm.manual_total_baixas}
                  onChange={e => setManualForm(f => ({ ...f, manual_total_baixas: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" placeholder="0,00" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Conferido por</label>
                <select value={manualReviewedBy} onChange={e => setManualReviewedBy(e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white">
                  <option value="">Selecionar…</option>
                  {conferentes.map(c => <option key={c.id} value={c.id}>{c.full_name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Observações</label>
                <input type="text" value={manualForm.notes}
                  onChange={e => setManualForm(f => ({ ...f, notes: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" placeholder="Opcional" />
              </div>
            </div>
            {(() => {
              const bruto = (parseFloat(manualForm.manual_pix)||0) + (parseFloat(manualForm.manual_dinheiro)||0)
              const baixas = parseFloat(manualForm.manual_total_baixas)||0
              const liquido = bruto - baixas
              const closing = parseFloat(manualForm.closing_balance)||0
              const qc = liquido - closing
              return (bruto > 0 || baixas > 0) ? (
                <div className="bg-gray-50 rounded-lg px-4 py-2 text-xs text-gray-600 flex flex-wrap gap-4">
                  <span>Bruto: <strong className="text-gray-800">{fmt(bruto)}</strong></span>
                  <span>Líquido: <strong className="text-gray-800">{fmt(liquido)}</strong></span>
                  {closing > 0 && <span>Quebra: <strong className={qc === 0 ? 'text-green-600' : qc > 0 ? 'text-blue-600' : 'text-red-600'}>{`${qc >= 0 ? '+' : ''}${fmt(qc)} (${qc > 0 ? 'sobra' : qc < 0 ? 'falta' : 'ok'})`}</strong></span>}
                </div>
              ) : null
            })()}
            <button onClick={handleCreateManualSession} disabled={savingManual}
              className="w-full bg-indigo-600 text-white py-2.5 rounded-xl text-sm font-semibold disabled:opacity-50">
              {savingManual ? 'Salvando…' : 'Criar Sessão Manual'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
