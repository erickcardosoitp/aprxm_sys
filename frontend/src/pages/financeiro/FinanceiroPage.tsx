import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import {
  TrendingUp, TrendingDown, DollarSign, BarChart2, Upload,
  CheckCircle, AlertCircle, Clock, Plus, Search, X, RotateCcw,
  CreditCard, Users, ArrowLeftRight, Pencil, Trash2, MapPin, FileBarChart, RefreshCw,
  FileSpreadsheet, Image, Filter, Printer, GitBranch,
} from 'lucide-react'
import toast from 'react-hot-toast'
import * as XLSX from 'xlsx'
import html2canvas from 'html2canvas'
import api from '../../services/api'
import { printCarne as printCarneUtil } from '../../utils/printCarne'
import { CaixaConferenciaModal } from '../../components/finance/CaixaConferenciaModal'
import { useAuthStore } from '../../store/authStore'
import { financeService } from '../../services/finance'
import type { Resident } from '../../types'

type Tab = 'dashboard' | 'movimentacoes' | 'cobrancas' | 'relatorios' | 'conciliacao' | 'transferencias' | 'porta_a_porta' | 'dre' | 'esteira'

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
  payment_method_name?: string | null
  created_by_name?: string | null
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
  malote_sent_at?: string | null
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
  id: string; type: string; income_subtype?: string | null; amount: string
  description: string; transaction_at: string; is_sangria: boolean
  created_by_name?: string; conferido: boolean; observacao?: string | null
  payment_method_name?: string | null; reversed_at?: string | null
}

interface CashBox {
  id: string; name: string; description?: string; balance: string; is_active: boolean; is_malote?: boolean
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
  id: string; transaction_id?: string; bank: string; date: string; amount: number
  name: string; resident?: string; cpf?: string
  status: 'automatico' | 'sugestao' | 'pendente' | 'identificado'; score: number
  sale_description?: string; bank_statement_id?: string
}

const fmt = (v: string | number) =>
  `R$ ${parseFloat(String(v)).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const fmtDate = (s: string) =>
  new Date(s).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' })

const SUBTYPE_LABELS: Record<string, string> = {
  delivery_fee: 'Taxa de Entrega',
  mensalidade: 'Mensalidade',
  proof_of_residence: 'Comprovante',
  other: 'Outros',
}
const SUBTYPE_COLORS: Record<string, string> = {
  delivery_fee: 'bg-amber-100 text-amber-700',
  mensalidade: 'bg-blue-100 text-blue-700',
  proof_of_residence: 'bg-purple-100 text-purple-700',
  other: 'bg-gray-100 text-gray-600',
}
const parseTxName = (desc: string, subtype: string | null | undefined): string => {
  if (subtype && desc.includes(' — ')) return desc.split(' — ').slice(1).join(' — ')
  if (desc.startsWith('Estorno: ') && desc.includes(' — ')) {
    const rest = desc.replace('Estorno: ', '')
    if (rest.includes(' — ')) return 'Estorno: ' + rest.split(' — ').slice(1).join(' — ')
  }
  return desc
}

// ── Saldo Consolidado component ───────────────────────────────────────────────
function SaldoConsolidado() {
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      const params: Record<string, string> = {}
      if (from) params.from_date = from
      if (to) params.to_date = to
      const res = await api.get('/cash-boxes/saldo-consolidado', { params })
      setData(res.data)
    } catch { toast.error('Erro ao carregar saldo consolidado') }
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  const fmt2 = (v: string | number) => `R$ ${parseFloat(String(v)).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 flex flex-wrap items-center gap-2 justify-between">
        <p className="text-sm font-semibold text-gray-800">Saldo Líquido Consolidado</p>
        <div className="flex items-center gap-2 flex-wrap">
          <input type="date" value={from} onChange={e => setFrom(e.target.value)}
            className="border border-gray-200 rounded-lg px-2 py-1 text-xs focus:outline-none" />
          <input type="date" value={to} onChange={e => setTo(e.target.value)}
            className="border border-gray-200 rounded-lg px-2 py-1 text-xs focus:outline-none" />
          <button onClick={load} disabled={loading}
            className="text-xs bg-[#26619c] text-white px-3 py-1.5 rounded-lg disabled:opacity-50">
            {loading ? '…' : 'Filtrar'}
          </button>
        </div>
      </div>
      {data && (
        <div className="p-4 flex flex-col gap-3">
          <div className="bg-green-50 rounded-xl p-4 text-center border border-green-200">
            <p className="text-xs text-green-600 font-medium mb-1">TOTAL CONSOLIDADO</p>
            <p className="text-3xl font-bold text-green-700">{fmt2(data.total_consolidado)}</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-white rounded-xl border border-gray-200 p-3">
              <p className="text-xs font-semibold text-gray-500 mb-2">Sessões de Caixa ({data.caixas.sessoes})</p>
              <div className="flex flex-col gap-1 text-xs">
                <div className="flex justify-between"><span className="text-gray-500">Bruto lançado</span><span className="font-medium">{fmt2(data.caixas.bruto)}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Baixas</span><span className="text-red-600 font-medium">−{fmt2(data.caixas.baixas)}</span></div>
                <div className="flex justify-between border-t border-gray-100 pt-1 mt-1"><span className="font-semibold text-gray-700">Líquido</span><span className="font-bold text-green-700">{fmt2(data.caixas.liquido)}</span></div>
                <div className="flex justify-between text-gray-400 mt-1"><span>PIX</span><span>{fmt2(data.caixas.pix)}</span></div>
                <div className="flex justify-between text-gray-400"><span>Dinheiro</span><span>{fmt2(data.caixas.dinheiro)}</span></div>
              </div>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 p-3">
              <p className="text-xs font-semibold text-gray-500 mb-2">Porta a Porta ({data.porta_a_porta.total_pagos} pagos)</p>
              <div className="flex flex-col gap-1 text-xs">
                <div className="flex justify-between border-t border-gray-100 pt-1"><span className="font-semibold text-gray-700">Recebido</span><span className="font-bold text-green-700">{fmt2(data.porta_a_porta.recebido)}</span></div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default function FinanceiroPage() {
  const location = useLocation()
  const role = useAuthStore(s => s.role)
  const isAdmin = ['admin', 'admin_master', 'superadmin'].includes(role ?? '')
  const [adminCloseTarget, setAdminCloseTarget] = useState<{ id: string; operador: string } | null>(null)
  const [adminCloseBalance, setAdminCloseBalance] = useState('')
  const [adminClosing, setAdminClosing] = useState(false)

  const handleAdminClose = async () => {
    if (!adminCloseTarget) return
    const bal = parseFloat(adminCloseBalance)
    if (isNaN(bal) || bal < 0) { toast.error('Informe o valor contado.'); return }
    setAdminClosing(true)
    try {
      await financeService.closeSession(bal, undefined, adminCloseTarget.id)
      toast.success('Caixa fechado.')
      setAdminCloseTarget(null)
      setAdminCloseBalance('')
      loadBoxSummary()
    } catch (e: any) {
      toast.error(e.response?.data?.detail ?? 'Erro ao fechar caixa.')
    } finally { setAdminClosing(false) }
  }

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
  const [reversalPassword, setReversalPassword] = useState('')
  const [reversalTarget, setReversalTarget] = useState<Tx | null>(null)
  // Edit transaction
  const [editTarget, setEditTarget] = useState<Tx | null>(null)
  const [editAmount, setEditAmount] = useState('')
  const [editPmId, setEditPmId] = useState('')
  const [editDesc, setEditDesc] = useState('')
  const [editCashSessionId, setEditCashSessionId] = useState('')
  const [editPassword, setEditPassword] = useState('')
  const [editing, setEditing] = useState(false)
  const [editPayMethods, setEditPayMethods] = useState<{ id: string; name: string }[]>([])
  const [editSessions, setEditSessions] = useState<{ id: string; opened_by_name: string; opened_at: string }[]>([])

  const openEditModal = (t: Tx) => {
    setEditTarget(t); setEditAmount(t.amount); setEditDesc(t.description)
    setEditPmId(''); setEditPassword(''); setEditCashSessionId('')
    api.get<{ id: string; opened_by_name: string; opened_at: string }[]>('/finance/sessions/open-picker')
      .then(r => setEditSessions(r.data)).catch(() => setEditSessions([]))
  }

  const handleEditTx = async () => {
    if (!editTarget || !editPassword.trim()) { toast.error('Senha obrigatória.'); return }
    setEditing(true)
    try {
      const body: Record<string, any> = { admin_password: editPassword }
      if (editAmount) body.amount = editAmount
      if (editPmId) body.payment_method_id = editPmId
      if (editDesc) body.description = editDesc
      if (editCashSessionId) body.cash_session_id = editCashSessionId
      await api.patch(`/finance/transactions/${editTarget.id}/correct`, body)
      toast.success('Lançamento corrigido.')
      setEditTarget(null); setEditAmount(''); setEditPmId(''); setEditDesc(''); setEditPassword(''); setEditCashSessionId('')
      loadTransactions()
      if (reviewSession) {
        const r = await api.get<TxReview[]>(`/finance/sessions/${reviewSession.id}/transactions`)
        setReviewTxs(r.data)
      }
    } catch (e: any) {
      const d = e.response?.data?.detail
      toast.error(typeof d === 'string' ? d : 'Erro ao corrigir.')
    } finally { setEditing(false) }
  }

  // Sessions
  const [sessions, setSessions] = useState<Session[]>([])
  const [loadingSessions, setLoadingSessions] = useState(false)
  const [showManualSession, setShowManualSession] = useState(false)
  const [manualForm, setManualForm] = useState<ManualSessionForm>({ opening_balance: '', closing_balance: '', opened_at: '', closed_at: '', notes: '', manual_pix: '', manual_dinheiro: '', manual_total_baixas: '' })
  const [savingManual, setSavingManual] = useState(false)
  const [conferentes, setConferentes] = useState<Conferente[]>([])
  const [operadores, setOperadores] = useState<Conferente[]>([])
  const [manualOperatedBy, setManualOperatedBy] = useState('')
  const [manualReviewedBy, setManualReviewedBy] = useState('')

  // Session history filters
  const [sessaoFilterFrom, setSessaoFilterFrom] = useState('')
  const [sessaoFilterTo, setSessaoFilterTo] = useState('')
  const [sessaoFilterOp, setSessaoFilterOp] = useState('')

  // Session reviews
  const [reviewSession, setReviewSession] = useState<Session | null>(null)
  const [reviewTxs, setReviewTxs] = useState<TxReview[]>([])

  // Transferências / Cash Boxes
  const [cashBoxes, setCashBoxes] = useState<CashBox[]>([])
  const [boxSummary, setBoxSummary] = useState<{ open_session_balance: string | null; total_in_boxes: string; sangria_by_destination: { destination: string; total: string }[] } | null>(null)
  const [loadingBoxes, setLoadingBoxes] = useState(false)
  const [conferidoSessions, setConferidoSessions] = useState<{ id: string; opened_at: string; operador_name?: string; closing_balance?: string }[]>([])
  const [transferTarget, setTransferTarget] = useState<{ id: string; opened_at: string; operador_name?: string; closing_balance?: string } | null>(null)
  const [transferBoxId, setTransferBoxId] = useState('')
  const [transferAmt, setTransferAmt] = useState('')
  const [transferring, setTransferring] = useState(false)
  const [selectedBox, setSelectedBox] = useState<CashBox | null>(null)
  const [boxMovements, setBoxMovements] = useState<BoxMovement[]>([])
  const [showBoxForm, setShowBoxForm] = useState(false)
  const [boxForm, setBoxForm] = useState({ name: '', description: '', is_malote: false })
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
  const [bankType, setBankType] = useState<'itau' | 'cora' | 'infinitypay'>('infinitypay')
  const [importing, setImporting] = useState(false)
  const [reconRunning, setReconRunning] = useState(false)
  const [reconProgress, setReconProgress] = useState(0)
  const [reconLogs, setReconLogs] = useState<{ type: string; desc: string; amount: number; date: string; payer?: string; score?: number }[]>([])
  const [reconSummary, setReconSummary] = useState<{ matched: number; unmatched: number; total: number } | null>(null)

  // Porta a Porta
  const [papLeads, setPapLeads] = useState<any[]>([])
  const [papSummary, setPapSummary] = useState<any>(null)
  const [papLoading, setPapLoading] = useState(false)
  const [papToken, setPapToken] = useState('')
  const [papLinkCommissionedTo, setPapLinkCommissionedTo] = useState('')
  const [showPapForm, setShowPapForm] = useState(false)
  const [papForm, setPapForm] = useState({ full_name: '', phone: '', cpf: '', address_street: '', address_number: '', address_complement: '', payment_type: 'avista', total_installments: 1, monthly_fee: '20.00', notes: '', commissioned_to: '', lancado_por: '' })
  const [showAcordoModal, setShowAcordoModal] = useState<any>(null)
  const [acordoForm, setAcordoForm] = useState({ sinal: '', parcelas: '2', payment_method: '' })
  const [savingAcordo, setSavingAcordo] = useState(false)
  const [papDeps, setPapDeps] = useState<{ name: string; phone: string; cpf: string }[]>([])
  const [savingPap, setSavingPap] = useState(false)
  const [showCommPay, setShowCommPay] = useState(false)
  const [commPayTarget, setCommPayTarget] = useState<any>(null)
  const [commPayForm, setCommPayForm] = useState({ amount: '', payment_method: '', paid_at: '', notes: '' })
  const [savingCommPay, setSavingCommPay] = useState(false)

  // Comprovante
  const [assocName, setAssocName] = useState('')
  const [carneOperator, setCarneOperator] = useState('')

  // DRE
  const [dreYear, setDreYear] = useState(new Date().getFullYear())
  const [dreMonth, setDreMonth] = useState<number | ''>(new Date().getMonth() + 1)
  const [dre, setDre] = useState<any>(null)
  const [loadingDre, setLoadingDre] = useState(false)
  const [dreFilter, setDreFilter] = useState<'all' | 'receitas' | 'despesas'>('all')
  const [dreCatFilter, setDreCatFilter] = useState<string>('')
  const dreRef = useRef<HTMLDivElement>(null)

  const [esteiraData, setEsteiraData] = useState<any>(null)
  const [esteiraLoading, setEsteiraLoading] = useState(false)

  const [movSubTab, setMovSubTab] = useState<'entradas' | 'despesas' | 'estornos' | 'transferencias'>('entradas')
  const [movSubtypeFilter, setMovSubtypeFilter] = useState<string | null>(null)
  const [txFilterOp, setTxFilterOp] = useState<string | null>(null)

  useEffect(() => {
    api.get<{ association_name?: string }>('/settings/association').then(r => {
      setAssocName(r.data.association_name ?? '')
    }).catch(() => {})
    api.get<{ id: string; name: string }[]>('/finance/payment-methods').then(r => setEditPayMethods(r.data)).catch(() => {})
  }, [])

  const loadEsteira = async () => {
    setEsteiraLoading(true)
    try {
      const res = await api.get('/finance/esteira')
      setEsteiraData(res.data)
    } catch { toast.error('Erro ao carregar esteira.') }
    finally { setEsteiraLoading(false) }
  }

  useEffect(() => {
    if (tab === 'dashboard') loadSummary()
    if (tab === 'movimentacoes') loadTransactions()
    if (tab === 'relatorios') { loadSessions(); loadConferentes() }
    if (tab === 'cobrancas') { loadOpenSession(); loadCobrancas() }
    if (tab === 'transferencias') loadBoxSummary()
    if (tab === 'conciliacao') { loadPixPending(); if (cashBoxes.length === 0) loadBoxSummary() }
    if (tab === 'porta_a_porta') { loadPap(); loadPapToken(); loadConferentes() }
    if (tab === 'esteira') loadEsteira()
  }, [tab, period])

  // Navigate from PackagesPage after guest upgrade
  useEffect(() => {
    const s = location.state as any
    if (s?.tab === 'cobrancas' && s?.residentId) {
      setTab('cobrancas')
      setCobrancasView('historico')
      loadOpenSession()
      loadCobrancas()
      // loadResidentHistory is defined later, use setTimeout to ensure state is ready
      setTimeout(() => loadResidentHistory(s.residentId, s.residentName ?? ''), 100)
      // Clear state so back-navigation doesn't re-trigger
      window.history.replaceState({}, '')
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const loadOpenSession = async () => {
    try {
      const res = await api.get<{ id: string; is_mine?: boolean; opened_by: string; opened_by_name?: string }>('/finance/sessions/current')
      setOpenSession(res.data.is_mine ? res.data : null)
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
    try {
      const [rc, ro] = await Promise.all([
        api.get<Conferente[]>('/finance/conferentes'),
        api.get<Conferente[]>('/finance/operadores'),
      ])
      setConferentes(rc.data)
      setOperadores(ro.data)
    } catch { /* ignore */ }
  }

  const openReview = async (s: Session) => {
    try {
      const r = await api.get<TxReview[]>(`/finance/sessions/${s.id}/transactions`)
      setReviewTxs(r.data)
    } catch { setReviewTxs([]) }
    setReviewSession(s)
  }

  const handleRevertConferencia = async (sessionId: string) => {
    try {
      await api.post(`/finance/sessions/${sessionId}/revert-conferencia`)
      toast.success('Conferência revertida — sessão voltou para Fechada.')
      loadSessions()
    } catch (e: any) {
      toast.error(e.response?.data?.detail ?? 'Erro ao reverter.')
    }
  }

  const [reopeningSession, setReopeningSession] = useState<string | null>(null)
  const handleReopenSession = async (sessionId: string) => {
    if (!confirm('Reabrir este caixa? Os lançamentos poderão ser corrigidos e o caixa deverá ser fechado novamente.')) return
    setReopeningSession(sessionId)
    try {
      await api.post(`/finance/sessions/${sessionId}/reopen`)
      toast.success('Caixa reaberto. Corrija os lançamentos e feche novamente.')
      loadSessions()
    } catch (e: any) {
      toast.error(e.response?.data?.detail ?? 'Erro ao reabrir caixa.')
    } finally { setReopeningSession(null) }
  }

  const printSessionReport = (s: Session) => {
    const bruto = parseFloat(s.total_bruto ?? '0')
    const baixas = parseFloat(s.total_baixas ?? '0')
    const liquido = bruto - baixas
    const diff = s.difference != null ? parseFloat(s.difference) : null
    const fmtR = (v: number) => `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    const fmtDT = (d: string) => new Date(d).toLocaleString('pt-BR')
    const w = window.open('', '_blank')!
    w.document.write(`<html><head><title>Fechamento de Caixa</title><style>
      body{font-family:sans-serif;font-size:13px;padding:20px;max-width:420px;margin:auto}
      h2{text-align:center;font-size:16px;margin-bottom:4px}
      .sub{text-align:center;color:#555;font-size:11px;margin-bottom:16px}
      table{width:100%;border-collapse:collapse}
      tr td{padding:5px 0;border-bottom:1px solid #eee}
      tr td:last-child{text-align:right;font-weight:bold}
      .total{font-size:15px;font-weight:bold}
      .diff{color:${diff === null ? '#666' : diff >= 0 ? '#16a34a' : '#dc2626'}}
      @media print{button{display:none}}
    </style></head><body>
      <h2>2ª Via — Fechamento de Caixa</h2>
      <div class="sub">Gerado em ${new Date().toLocaleString('pt-BR')}</div>
      <table>
        <tr><td>Operador</td><td>${s.operador_name ?? '—'}</td></tr>
        <tr><td>Abertura</td><td>${fmtDT(s.opened_at)}</td></tr>
        <tr><td>Fechamento</td><td>${s.closed_at ? fmtDT(s.closed_at) : '—'}</td></tr>
        <tr><td>Saldo inicial</td><td>${fmtR(parseFloat(s.opening_balance))}</td></tr>
        <tr><td>Total PIX</td><td>${fmtR(parseFloat(s.total_pix ?? '0'))}</td></tr>
        <tr><td>Total Dinheiro</td><td>${fmtR(parseFloat(s.total_dinheiro ?? '0'))}</td></tr>
        <tr><td>Bruto lançado</td><td>${fmtR(bruto)}</td></tr>
        <tr><td>Sangrias / Repasses</td><td>- ${fmtR(baixas)}</td></tr>
        <tr><td class="total">Líquido esperado</td><td class="total">${fmtR(liquido)}</td></tr>
        <tr><td>Conf. cega (contado)</td><td>${s.closing_balance ? fmtR(parseFloat(s.closing_balance)) : '—'}</td></tr>
        <tr><td class="diff">Sobra / Falta</td><td class="diff">${diff !== null ? (diff >= 0 ? '+' : '') + fmtR(diff) : '—'}</td></tr>
        ${s.conferido_por ? `<tr><td>Conferido por</td><td>${s.conferido_por}</td></tr>` : ''}
      </table>
      <br/><button onclick="window.print()">Imprimir</button>
    </body></html>`)
    w.document.close()
    setTimeout(() => w.print(), 600)
  }

  const [tesouraria, setTesouraria] = useState<{
    open_sessions: { id: string; opened_at: string; opening_balance: string; operador: string; expected_balance: string }[]
    conferido_sessions: { id: string; opened_at: string; closing_balance: string | null; expected_balance: string | null; difference: string | null; operador: string; already_transferred: string; remaining: string }[]
    pap_today: { total: string; count: number }
    caixinhas: { id: string; name: string; balance: string; breakdown: { pm: string; total: string }[] }[]
    total_limbo: string
    faturamento_hoje: string
  } | null>(null)
  const [transferTroco, setTransferTroco] = useState('0')
  const [transferClose, setTransferClose] = useState(true)

  // Malote
  const [sendingMalote, setSendingMalote] = useState<string | null>(null)

  // PIX batch
  const [pixPending, setPixPending] = useState<{
    id: string; amount: string; description: string | null; date: string
    status: string; recon_score: number | null
    resident_name: string | null; bank_statement_id: string | null
    bank: string | null; payer_name: string | null
    session_opened_at: string | null; session_id: string | null
    operador_name: string | null; conferente_name: string | null
  }[]>([])
  const [pixSelected, setPixSelected] = useState<Set<string>>(new Set())
  const [pixBatchBox, setPixBatchBox] = useState('')
  const [loadingPixPending, setLoadingPixPending] = useState(false)
  const [batchingPix, setBatchingPix] = useState(false)

  // Comprovante reprint
  const [reprinting, setReprinting] = useState<string | null>(null)

  const handleSendToMalote = async (sessionId: string) => {
    if (!confirm('Confirmar envio do valor de fechamento para o Malote?')) return
    setSendingMalote(sessionId)
    try {
      await api.post(`/finance/sessions/${sessionId}/send-to-malote`)
      toast.success('Dinheiro enviado para o Malote.')
      loadSessions()
    } catch (e: any) {
      toast.error(e.response?.data?.detail ?? 'Erro ao enviar para malote.')
    } finally { setSendingMalote(null) }
  }

  const loadPixPending = async () => {
    setLoadingPixPending(true)
    try {
      const res = await api.get('/finance/pix/pending')
      setPixPending(res.data)
    } catch { toast.error('Erro ao carregar PIX pendentes.') } finally { setLoadingPixPending(false) }
  }

  const handlePixBatch = async () => {
    if (!pixBatchBox || pixSelected.size === 0) return
    setBatchingPix(true)
    try {
      const res = await api.post('/financeiro/bank-statements/batch-to-cashbox', {
        cash_box_id: pixBatchBox,
        statement_ids: Array.from(pixSelected),
      })
      toast.success(`${res.data.count} PIX (R$ ${parseFloat(res.data.total).toFixed(2)}) enviados para a caixinha.`)
      setPixSelected(new Set())
      setPixBatchBox('')
      loadPixPending()
    } catch (e: any) {
      toast.error(e.response?.data?.detail ?? 'Erro ao enviar para caixinha.')
    } finally { setBatchingPix(false) }
  }

  const handleReprint = async (txId: string) => {
    setReprinting(txId)
    try {
      const res = await api.get(`/finance/proof-of-residence/${txId}/reprint`, { responseType: 'blob' })
      const url = URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }))
      window.open(url, '_blank')
    } catch (e: any) {
      toast.error('Erro ao gerar 2ª via.')
    } finally { setReprinting(null) }
  }

  const loadBoxSummary = async () => {
    setLoadingBoxes(true)
    try {
      const [sumR, boxR, tesR] = await Promise.all([
        api.get('/cash-boxes/summary'),
        api.get<CashBox[]>('/cash-boxes'),
        api.get('/finance/tesouraria'),
      ])
      setBoxSummary(sumR.data)
      setCashBoxes(boxR.data)
      setTesouraria(tesR.data)
      setConferidoSessions(tesR.data.conferido_sessions.filter((s: any) => s.closing_balance))
    } catch { /* ignore */ } finally { setLoadingBoxes(false) }
  }

  const handleTransferConferido = async () => {
    if (!transferTarget || !transferBoxId || !transferAmt) return
    setTransferring(true)
    try {
      await api.post(`/finance/sessions/${transferTarget.id}/transfer-to-cashbox`, {
        cash_box_id: transferBoxId,
        amount: parseFloat(transferAmt),
        troco: parseFloat(transferTroco) || 0,
        close_session: transferClose,
      })
      toast.success('Repasse realizado!' + (transferClose ? ' Caixa fechado.' : ''))
      setTransferTarget(null)
      setTransferBoxId('')
      setTransferAmt('')
      setTransferTroco('0')
      loadBoxSummary()
    } catch (e: any) {
      toast.error(e.response?.data?.detail ?? 'Erro ao transferir.')
    } finally { setTransferring(false) }
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
      setShowBoxForm(false); setEditBox(null); setBoxForm({ name: '', description: '', is_malote: false })
      loadBoxSummary()
    } catch { /* ignore */ } finally { setSavingBox(false) }
  }

  const handleDeactivateBox = async (id: string) => {
    if (!window.confirm('Desativar esta caixinha?')) return
    try {
      await api.delete(`/cash-boxes/${id}`)
      loadBoxSummary()
      if (selectedBox?.id === id) setSelectedBox(null)
    } catch (e: any) {
      toast.error(e.response?.data?.detail ?? 'Erro ao desativar caixinha.')
    }
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
        operated_by_id: manualOperatedBy || null,
        reviewed_by_id: manualReviewedBy || null,
      })
      setShowManualSession(false)
      setManualForm({ opening_balance: '', closing_balance: '', opened_at: '', closed_at: '', notes: '', manual_pix: '', manual_dinheiro: '', manual_total_baixas: '' })
      setManualOperatedBy('')
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
      const res = await api.get<Resident[]>('/residents/search', { params: { q } })
      setResidentResults(res.data.slice(0, 6))
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

  const printCarneFinanceiro = async (residentId: string, residentName: string, residentCpf?: string, residentUnit?: string) => {
    try {
      const res = await api.get<any[]>(`/mensalidades/residents/${residentId}`)
      printCarneUtil({ full_name: residentName, cpf: residentCpf, unit: residentUnit }, res.data, assocName, { operatorName: carneOperator || undefined })
    } catch { toast.error('Erro ao gerar carnê.') }
  }

  const printRecibo = (
    residentName: string,
    residentCpf: string | undefined,
    residentUnit: string | undefined,
    allMensalidades: Mensalidade[],
    paidNow: Mensalidade,
    paymentMethodLabel: string,
    operator: string,
  ) => {
    const sd = (s: string | null | undefined) => {
      if (!s) return '—'
      const d = new Date(s); return isNaN(d.getTime()) ? s : d.toLocaleDateString('pt-BR')
    }
    const fmtR = (v: string | number) =>
      `R$ ${parseFloat(String(v)).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    const MONTHS = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez']
    const fmtRef = (ref: string) => {
      const [y, m] = ref.split('-'); return `${MONTHS[parseInt(m) - 1]}/${y}`
    }

    const paid = allMensalidades
      .filter(m => m.status === 'paid')
      .sort((a, b) => a.reference_month.localeCompare(b.reference_month))

    const defaultAmount = allMensalidades.length
      ? parseFloat(allMensalidades[allMensalidades.length - 1].amount)
      : parseFloat(paidNow.amount)

    const now = new Date()
    const emitido = now.toLocaleString('pt-BR')

    const stub = (via: 'interno' | 'morador') => `
<div style="width:76mm;font-family:'Courier New',monospace;font-size:7.5pt;page-break-inside:avoid;margin-bottom:4mm">
  <!-- header -->
  <div style="text-align:center;padding:2.5mm 2mm 2mm;border-bottom:2px solid #111">
    <div style="font-size:9.5pt;font-weight:bold;letter-spacing:.5px;text-transform:uppercase">${assocName || 'Associação'}</div>
    <div style="font-size:6pt;margin-top:.5mm;letter-spacing:.3px">COMPROVANTE DE MENSALIDADE</div>
    <div style="display:inline-block;margin-top:1mm;font-size:5.5pt;font-weight:bold;border:1px solid #111;padding:0.5mm 2mm">
      ${via === 'interno' ? '1ª VIA — CONTROLE INTERNO' : '2ª VIA — MORADOR'}
    </div>
  </div>

  <!-- morador -->
  <div style="padding:2mm 2mm 1.5mm;border-bottom:1px dashed #999">
    <div style="display:flex;justify-content:space-between"><span style="color:#555">Associado</span><span style="font-weight:bold;text-align:right;max-width:46mm;overflow:hidden;white-space:nowrap;text-overflow:ellipsis">${residentName}</span></div>
    ${residentCpf ? `<div style="display:flex;justify-content:space-between"><span style="color:#555">CPF</span><span style="font-weight:bold">${residentCpf}</span></div>` : ''}
    ${residentUnit ? `<div style="display:flex;justify-content:space-between"><span style="color:#555">Unidade</span><span style="font-weight:bold">${residentUnit}</span></div>` : ''}
  </div>

  <!-- pagamento atual -->
  <div style="padding:2mm;border-bottom:1px dashed #999">
    <div style="font-size:6pt;font-weight:bold;letter-spacing:.3px;color:#555;margin-bottom:1mm">PAGAMENTO EFETUADO</div>
    <div style="display:flex;justify-content:space-between"><span style="color:#555">Competência</span><span style="font-weight:bold">${fmtRef(paidNow.reference_month)}</span></div>
    <div style="display:flex;justify-content:space-between"><span style="color:#555">Data</span><span style="font-weight:bold">${sd(paidNow.paid_at)}</span></div>
    <div style="display:flex;justify-content:space-between;margin-top:1mm"><span style="color:#555">Valor pago</span><span style="font-size:10pt;font-weight:bold">${fmtR(paidNow.amount)}</span></div>
    ${via === 'interno' ? `<div style="display:flex;justify-content:space-between"><span style="color:#555">Forma pagto</span><span style="font-weight:bold">${paymentMethodLabel}</span></div>` : ''}
  </div>

  <!-- valor mensal padrão -->
  <div style="padding:2mm;border-bottom:1px dashed #999;background:#f9f9f9">
    <div style="display:flex;justify-content:space-between">
      <span style="color:#555">Mensalidade padrão</span>
      <span style="font-weight:bold">${fmtR(defaultAmount)}</span>
    </div>
    <div style="display:flex;justify-content:space-between">
      <span style="color:#555">Vencimento padrão</span>
      <span style="font-weight:bold">Todo dia ${paidNow.due_date ? new Date(paidNow.due_date).getDate() : '—'}</span>
    </div>
  </div>

  <!-- meses pagos -->
  <div style="padding:2mm;border-bottom:1px dashed #999">
    <div style="font-size:6pt;font-weight:bold;letter-spacing:.3px;color:#555;margin-bottom:1.5mm">MESES PAGOS (${paid.length})</div>
    ${paid.length === 0
      ? '<div style="color:#999;font-size:6.5pt">Nenhum pagamento registrado.</div>'
      : `<div style="display:flex;flex-wrap:wrap;gap:1mm">${paid.map(m =>
          `<span style="font-size:6pt;padding:0.5mm 1.5mm;border:1px solid #26619c;border-radius:2px;color:#26619c;font-weight:bold">${fmtRef(m.reference_month)}</span>`
        ).join('')}</div>`
    }
  </div>

  <!-- rodapé -->
  <div style="padding:2mm;font-size:6pt">
    <div style="display:flex;justify-content:space-between">
      <span style="color:#555">Operador</span>
      <span style="font-weight:bold">${operator || '______________________'}</span>
    </div>
    <div style="margin-top:2.5mm;color:#555">Assinatura / Carimbo:</div>
    <div style="border-bottom:1px solid #999;height:7mm;margin-top:1mm"></div>
    <div style="margin-top:1.5mm;color:#aaa;font-size:5pt">Emitido em ${emitido}</div>
  </div>
</div>`

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Comprovante</title>
<style>
  @page{size:80mm auto;margin:2mm}
  *{box-sizing:border-box;margin:0;padding:0}
  body{width:80mm;background:#fff}
</style>
</head><body>
  ${stub('interno')}
  <div style="border-top:1px dotted #ccc;margin:1mm 0 3mm"></div>
  ${stub('morador')}
</body></html>`

    const w = window.open('', '_blank', 'width=400,height=800')
    if (!w) return
    w.document.write(html)
    w.document.close()
    w.focus()
    setTimeout(() => { w.print() }, 400)
  }

  const handlePayMensalidade = async (
    id: string,
    residentMeta?: { name: string; cpf?: string; unit?: string; resident_id?: string },
  ) => {
    if (!openSession) {
      toast.error('Abra o caixa antes de registrar pagamentos.')
      return
    }
    setPayingId(id)
    try {
      const res = await api.post<{ mensalidade: Mensalidade; transaction: any; next_month: Mensalidade | null }>(
        `/mensalidades/${id}/pay`, {}
      )
      const paidNow = res.data.mensalidade
      const next = res.data.next_month
      toast.success(
        next
          ? `Pago! Próxima mensalidade criada: ${next.reference_month}`
          : 'Mensalidade paga!'
      )
      loadCobrancas()
      if (historyResidentId) loadResidentHistory(historyResidentId)

      // Print receipt + carnê
      if (residentMeta) {
        try {
          const allRes = await api.get<Mensalidade[]>(`/mensalidades/residents/${paidNow.resident_id}`)
          printRecibo(
            residentMeta.name,
            residentMeta.cpf,
            residentMeta.unit,
            allRes.data,
            paidNow,
            'Dinheiro/PIX',
            carneOperator,
          )
          setTimeout(() => printCarneFinanceiro(paidNow.resident_id, residentMeta.name, residentMeta.cpf, residentMeta.unit), 1200)
        } catch { /* silently skip print */ }
      }
    } catch (e: any) {
      toast.error(e.response?.data?.detail ?? 'Erro ao pagar mensalidade.')
    } finally { setPayingId(null) }
  }

  const handleReversal = async () => {
    if (!reversalTarget || !reversalReason.trim()) return
    if (!reversalPassword.trim()) { toast.error('Senha de administrador obrigatória.'); return }
    setReversing(reversalTarget.id)
    try {
      await api.post(`/finance/transactions/${reversalTarget.id}/reverse`, {
        reason: reversalReason.trim(),
        admin_password: reversalPassword.trim(),
      })
      toast.success('Estorno realizado!')
      setReversalTarget(null)
      setReversalReason('')
      setReversalPassword('')
      loadTransactions()
    } catch (e: any) {
      const d = e.response?.data?.detail
      toast.error(typeof d === 'string' ? d : 'Erro ao estornar.')
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
    setReconRunning(true)
    setReconProgress(0)
    setReconLogs([])
    setReconSummary(null)
    const raw = localStorage.getItem('aprxm-auth') ?? sessionStorage.getItem('aprxm-auth')
    const token = raw ? JSON.parse(raw)?.state?.token : null
    const base = import.meta.env.VITE_API_URL ?? '/api/v1'
    try {
      const resp = await fetch(`${base}/financeiro/reconcile/stream`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!resp.ok || !resp.body) { toast.error('Erro ao iniciar conciliação.'); setReconRunning(false); return }
      const reader = resp.body.getReader()
      const dec = new TextDecoder()
      let buf = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += dec.decode(value, { stream: true })
        const lines = buf.split('\n')
        buf = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const ev = JSON.parse(line.slice(6))
            if (ev.type === 'start') {
              setReconProgress(0)
            } else if (ev.type === 'processing') {
              setReconProgress(ev.pct)
            } else if (ev.type === 'matched') {
              setReconProgress(ev.pct)
              setReconLogs(p => [...p, ev])
            } else if (ev.type === 'unmatched') {
              setReconProgress(ev.pct)
              setReconLogs(p => [...p, ev])
            } else if (ev.type === 'done') {
              setReconProgress(100)
              setReconSummary({ matched: ev.matched, unmatched: ev.unmatched, total: ev.total })
              setReconRunning(false)
              loadPixPending()
            } else if (ev.type === 'error') {
              toast.error(ev.message)
              setReconRunning(false)
            }
          } catch { /* ignore parse errors */ }
        }
      }
    } catch (e: any) {
      toast.error('Erro na conciliação.')
      setReconRunning(false)
    }
  }

  const TABS: { key: Tab; label: string; icon: any }[] = [
    { key: 'dashboard',      label: 'Resumo',        icon: BarChart2 },
    { key: 'esteira',        label: 'Esteira',       icon: GitBranch },
    { key: 'movimentacoes',  label: 'Movimentações', icon: ArrowLeftRight },
    { key: 'cobrancas',      label: 'Cobranças',     icon: CreditCard },
    { key: 'relatorios',     label: 'Sessões',       icon: DollarSign },
    { key: 'dre',            label: 'Relatórios',    icon: FileBarChart },
    { key: 'transferencias', label: 'Caixinhas',     icon: Users },
    { key: 'conciliacao',    label: 'PIX',           icon: CheckCircle },
    { key: 'porta_a_porta',  label: 'Porta a Porta', icon: MapPin },
  ]

  // ── Porta a Porta handlers ──
  const loadPap = async () => {
    setPapLoading(true)
    try {
      const [leads, summary] = await Promise.all([api.get('/porta-a-porta/leads'), api.get('/porta-a-porta/summary')])
      setPapLeads(leads.data); setPapSummary(summary.data)
    } catch { toast.error('Erro ao carregar Porta a Porta.') } finally { setPapLoading(false) }
  }

  const loadPapToken = async (commissionedTo?: string) => {
    try {
      const res = await api.get<{ token: string }>('/porta-a-porta/public-token', { params: commissionedTo ? { commissioned_to: commissionedTo } : {} })
      setPapToken(res.data.token)
    } catch { }
  }

  const handlePapSubmit = async () => {
    if (!papForm.full_name.trim() || !papForm.address_street.trim() || !papForm.address_number.trim()) { toast.error('Preencha os campos obrigatórios.'); return }
    if (!papForm.lancado_por) { toast.error('Selecione quem está lançando o cadastro.'); return }
    setSavingPap(true)
    try {
      const users = [...conferentes, ...operadores].filter((u, i, arr) => arr.findIndex(x => x.id === u.id) === i)
      const lancadoPorUser = users.find(u => u.id === papForm.lancado_por)
      await api.post('/porta-a-porta/leads', {
        ...papForm,
        total_installments: Number(papForm.total_installments),
        monthly_fee: parseFloat(papForm.monthly_fee),
        dependents: papDeps,
        commissioned_to: papForm.commissioned_to || null,
        lancado_por: lancadoPorUser?.full_name ?? null,
      })
      toast.success('Lead registrado.')
      setShowPapForm(false)
      setPapForm({ full_name: '', phone: '', cpf: '', address_street: '', address_number: '', address_complement: '', payment_type: 'avista', total_installments: 1, monthly_fee: '20.00', notes: '', commissioned_to: '', lancado_por: '' })
      setPapDeps([]); loadPap()
    } catch (e: any) { toast.error(e.response?.data?.detail ?? 'Erro ao salvar.') } finally { setSavingPap(false) }
  }

  const handleAcordo = async () => {
    if (!showAcordoModal || !acordoForm.sinal) { toast.error('Informe o valor do sinal.'); return }
    setSavingAcordo(true)
    try {
      await api.post(`/porta-a-porta/leads/${showAcordoModal.id}/acordo`, {
        sinal: parseFloat(acordoForm.sinal),
        parcelas: parseInt(acordoForm.parcelas),
        payment_method: acordoForm.payment_method || null,
      })
      toast.success('Acordo registrado.')
      setShowAcordoModal(null)
      setAcordoForm({ sinal: '', parcelas: '2', payment_method: '' })
      loadPap()
    } catch (e: any) { toast.error(e.response?.data?.detail ?? 'Erro ao registrar acordo.') }
    finally { setSavingAcordo(false) }
  }

  const handlePapPay = async (leadId: string) => {
    try { await api.post(`/porta-a-porta/leads/${leadId}/pay`, {}); toast.success('Pagamento registrado.'); loadPap() }
    catch (e: any) { toast.error(e.response?.data?.detail ?? 'Erro.') }
  }

  const handlePapCancel = async (leadId: string) => {
    try { await api.delete(`/porta-a-porta/leads/${leadId}`); toast.success('Lead cancelado.'); loadPap() }
    catch { toast.error('Erro ao cancelar.') }
  }

  const handleCommPay = async () => {
    if (!commPayTarget) return
    setSavingCommPay(true)
    try {
      await api.post('/porta-a-porta/commission-payments', { operator_id: commPayTarget.operator_id, amount: parseFloat(commPayForm.amount), payment_method: commPayForm.payment_method || null, paid_at: commPayForm.paid_at ? new Date(commPayForm.paid_at).toISOString() : undefined, notes: commPayForm.notes || null })
      toast.success('Pagamento de comissão registrado.')
      setShowCommPay(false); setCommPayTarget(null)
      setCommPayForm({ amount: '', payment_method: '', paid_at: '', notes: '' }); loadPap()
    } catch { toast.error('Erro ao registrar pagamento.') } finally { setSavingCommPay(false) }
  }

  // ── DRE handlers ──
  const loadDre = async () => {
    setLoadingDre(true)
    try {
      const params: any = { year: dreYear }
      if (dreMonth) params.month = dreMonth
      const res = await api.get('/financeiro/dre', { params })
      setDre(res.data)
    } catch { toast.error('Erro ao gerar DRE.') } finally { setLoadingDre(false) }
  }

  const exportDreXLSX = () => {
    if (!dre) return
    const wb = XLSX.utils.book_new()
    const rows: any[][] = [
      [`DRE — ${dre.period_label}`], [],
      ['RECEITAS', ''],
      ...dre.receitas.map((r: any) => [r.descricao, r.valor]),
      ['Total Receitas', dre.total_receitas], [],
      ['DESPESAS', ''],
      ...dre.despesas.map((d: any) => [d.descricao, d.valor]),
      ['Total Despesas', dre.total_despesas], [],
      [dre.resultado >= 0 ? 'SUPERÁVIT' : 'DÉFICIT', Math.abs(dre.resultado)],
    ]
    const ws = XLSX.utils.aoa_to_sheet(rows)
    ws['!cols'] = [{ wch: 35 }, { wch: 18 }]
    XLSX.utils.book_append_sheet(wb, ws, 'DRE')
    XLSX.writeFile(wb, `dre_${dre.period_label}.xlsx`)
  }

  const exportDrePNG = async () => {
    if (!dreRef.current) return
    try {
      const canvas = await html2canvas(dreRef.current, { scale: 2, backgroundColor: '#ffffff' })
      const url = canvas.toDataURL('image/png')
      const a = document.createElement('a'); a.href = url; a.download = `dre_${dre.period_label}.png`; a.click()
    } catch { toast.error('Erro ao exportar imagem.') }
  }

  const exportExtratoCSV = (extrato: any[]) => {
    const header = 'Tipo,Subtipo,Valor,Descrição,Data,Operador,Categoria,Forma de Pagamento'
    const rows = extrato.map((e: any) => `${e.tipo},${e.subtipo ?? ''},${e.valor},"${e.descricao}",${e.data},${e.operador ?? ''},${e.categoria ?? ''},${e.metodo ?? ''}`)
    const blob = new Blob([[header, ...rows].join('\n')], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'extrato.csv'; a.click(); URL.revokeObjectURL(url)
  }

  const inputCls = 'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#26619c]/40 focus:border-[#26619c]'

  return (
    <div className="flex flex-col gap-4 p-4 sm:p-6 max-w-screen-xl mx-auto w-full">
      <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
        <TrendingUp className="w-5 h-5 text-[#26619c]" />
        Financeiro
      </h1>

      <div className="grid grid-cols-4 gap-1.5">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button key={key} onClick={() => setTab(key)}
            className={`flex flex-col items-center gap-1 px-2 py-3 rounded-xl text-[11px] font-semibold transition border ${
              tab === key
                ? 'bg-[#26619c] text-white border-[#26619c] shadow-md'
                : 'bg-white text-gray-500 border-gray-200 hover:border-[#26619c]/40 hover:text-[#26619c]'
            }`}>
            <Icon className={`w-5 h-5 ${tab === key ? 'text-white' : 'text-gray-400'}`} />
            <span className="text-center leading-tight">{label}</span>
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

      {/* ── MOVIMENTAÇÕES ── */}
      {tab === 'movimentacoes' && (() => {
        // Receitas: entradas reais (sem estornos, sem itens estornados)
        const entradas = filterByPeriod(transactions.filter(t => t.type === 'income' && !t.is_reversal && !t.reversed_at))
        // Despesas: saídas reais (sem estornos, sem sangrias)
        const despesas = filterByPeriod(transactions.filter(t => t.type === 'expense' && !t.is_reversal))
        // Estornos: cancelamentos de receita (dedução de receita, não despesa)
        const estornos = filterByPeriod(transactions.filter(t => t.is_reversal))
        // Transferências internas: sangrias (caixa → malote → cofre)
        const transferencias = filterByPeriod(transactions.filter(t => t.type === 'sangria'))

        const baseRows =
          movSubTab === 'entradas' ? entradas :
          movSubTab === 'despesas' ? despesas :
          movSubTab === 'estornos' ? estornos :
          transferencias
        const opRows = txFilterOp ? baseRows.filter(t => t.created_by_name === txFilterOp) : baseRows
        const rows = movSubTab === 'entradas' && movSubtypeFilter ? opRows.filter(t => t.income_subtype === movSubtypeFilter) : opRows
        const opNames = [...new Set(baseRows.map(t => t.created_by_name).filter(Boolean))] as string[]

        const totalEntradas = entradas.reduce((s, t) => s + parseFloat(t.amount), 0)
        const totalDespesas = despesas.reduce((s, t) => s + parseFloat(t.amount), 0)
        const totalEstornos = estornos.reduce((s, t) => s + parseFloat(t.amount), 0)
        const totalTransferencias = transferencias.reduce((s, t) => s + parseFloat(t.amount), 0)
        const resultado = totalEntradas - totalDespesas - totalEstornos

        const tabCfg: { key: typeof movSubTab; label: string; total: number; count: number; active: string; inactive: string; textActive: string; textInactive: string }[] = [
          { key: 'entradas', label: 'Receitas', total: totalEntradas, count: entradas.length, active: 'bg-green-50 border-green-400', inactive: 'bg-white border-gray-200', textActive: 'text-green-700', textInactive: 'text-green-600' },
          { key: 'despesas', label: 'Despesas', total: totalDespesas, count: despesas.length, active: 'bg-red-50 border-red-400', inactive: 'bg-white border-gray-200', textActive: 'text-red-700', textInactive: 'text-red-500' },
          { key: 'estornos', label: 'Estornos', total: totalEstornos, count: estornos.length, active: 'bg-orange-50 border-orange-400', inactive: 'bg-white border-gray-200', textActive: 'text-orange-700', textInactive: 'text-orange-500' },
          { key: 'transferencias', label: 'Sangrias/Repasses', total: totalTransferencias, count: transferencias.length, active: 'bg-indigo-50 border-indigo-400', inactive: 'bg-white border-gray-200', textActive: 'text-indigo-700', textInactive: 'text-indigo-500' },
        ]

        const amountColor =
          movSubTab === 'entradas' ? 'text-green-600' :
          movSubTab === 'despesas' ? 'text-red-600' :
          movSubTab === 'estornos' ? 'text-orange-600' :
          'text-blue-600'

        return (
          <div className="flex flex-col gap-3">
            {/* Period filter */}
            <div className="flex gap-2">
              {(['week', 'month', 'year'] as const).map(p => (
                <button key={p} onClick={() => setPeriod(p)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${period === p ? 'bg-[#26619c] text-white' : 'bg-gray-100 text-gray-600'}`}>
                  {p === 'week' ? 'Semana' : p === 'month' ? 'Mês' : 'Ano'}
                </button>
              ))}
            </div>

            {/* Resultado líquido */}
            <div className="bg-white rounded-xl border border-gray-200 px-4 py-3 flex items-center justify-between">
              <span className="text-xs text-gray-500 font-medium">Resultado líquido — {PERIOD_LABEL[period]}</span>
              <span className={`text-base font-black ${resultado >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                {resultado >= 0 ? '+' : ''}{fmt(resultado)}
              </span>
            </div>

            {/* Cards por categoria */}
            <div className="grid grid-cols-2 gap-2">
              {tabCfg.map(c => (
                <button key={c.key} onClick={() => { setMovSubTab(c.key); setMovSubtypeFilter(null) }}
                  className={`rounded-xl p-3 text-left border-2 transition ${movSubTab === c.key ? c.active : c.inactive}`}>
                  <p className="text-[11px] text-gray-500 mb-0.5">{c.label}</p>
                  <p className={`text-base font-bold leading-tight ${movSubTab === c.key ? c.textActive : c.textInactive}`}>{fmt(c.total)}</p>
                  <p className="text-[10px] text-gray-400 mt-0.5">{c.count} lançamento{c.count !== 1 ? 's' : ''}</p>
                </button>
              ))}
            </div>

            {/* Filtros */}
            <div className="flex flex-col gap-2">
              {movSubTab === 'entradas' && (
                <div className="flex gap-1.5 flex-wrap">
                  <button onClick={() => setMovSubtypeFilter(null)}
                    className={`text-xs px-2.5 py-1 rounded-full font-medium transition ${movSubtypeFilter === null ? 'bg-[#26619c] text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                    Todos
                  </button>
                  {Object.entries(SUBTYPE_LABELS).map(([key, label]) =>
                    entradas.some(t => t.income_subtype === key) && (
                      <button key={key} onClick={() => setMovSubtypeFilter(f => f === key ? null : key)}
                        className={`text-xs px-2.5 py-1 rounded-full font-medium transition ${movSubtypeFilter === key ? SUBTYPE_COLORS[key] + ' ring-2 ring-offset-1' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                        {label}
                      </button>
                    )
                  )}
                </div>
              )}
              {opNames.length > 0 && (
                <select value={txFilterOp ?? ''} onChange={e => setTxFilterOp(e.target.value || null)}
                  className="text-xs border border-gray-200 rounded-lg px-2 py-1 text-gray-600 bg-white">
                  <option value="">Todos os operadores</option>
                  {opNames.map(n => <option key={n} value={n}>{n}</option>)}
                </select>
              )}
            </div>

            {/* Lista */}
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
              {loadingTx ? (
                <div className="p-6 text-center text-gray-400 text-sm">Carregando…</div>
              ) : rows.length === 0 ? (
                <div className="p-6 text-center text-gray-400 text-sm">Nenhum lançamento no período.</div>
              ) : (
                <ul className="divide-y divide-gray-100">
                  {rows.map(t => (
                    <li key={t.id} className="px-4 py-3 flex items-center justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 flex-wrap mb-0.5">
                          {t.income_subtype && (
                            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${SUBTYPE_COLORS[t.income_subtype] ?? 'bg-gray-100 text-gray-600'}`}>
                              {SUBTYPE_LABELS[t.income_subtype] ?? t.income_subtype}
                            </span>
                          )}
                          {t.payment_method_name && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500 font-medium">
                              {t.payment_method_name}
                            </span>
                          )}
                          {movSubTab === 'transferencias' && (
                            t.description?.startsWith('Repasse para caixinha') ? (
                              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-indigo-50 text-indigo-600 font-medium">Repasse</span>
                            ) : (
                              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-600 font-medium">Sangria</span>
                            )
                          )}
                          {movSubTab === 'estornos' && (
                            <span className="text-[10px] px-1.5 py-0.5 bg-orange-50 text-orange-600 rounded-full font-medium">dedução de receita</span>
                          )}
                        </div>
                        <p className="text-sm font-medium truncate text-gray-800">
                          {parseTxName(t.description, t.income_subtype)}
                        </p>
                        <p className="text-xs text-gray-400 mt-0.5">
                          {fmtDate(t.transaction_at)}
                          {t.created_by_name && <span className="ml-1.5 text-[10px] text-gray-400">· {t.created_by_name}</span>}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className={`text-sm font-bold ${amountColor}`}>{fmt(t.amount)}</span>
                        {movSubTab === 'entradas' && !t.reversed_at && !t.is_reversal && (
                          <>
                            <button onClick={() => { openEditModal(t) }} title="Corrigir"
                              className="p-1.5 text-gray-400 hover:text-blue-500 rounded-lg hover:bg-blue-50 transition">
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            <button onClick={() => { setReversalTarget(t); setReversalReason('') }} title="Estornar"
                              className="p-1.5 text-gray-400 hover:text-red-500 rounded-lg hover:bg-red-50 transition">
                              <RotateCcw className="w-3.5 h-3.5" />
                            </button>
                          </>
                        )}
                        {movSubTab === 'despesas' && !t.is_reversal && (
                          <button onClick={() => { openEditModal(t) }} title="Corrigir"
                            className="p-1.5 text-gray-400 hover:text-blue-500 rounded-lg hover:bg-blue-50 transition">
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {t.income_subtype === 'proof_of_residence' && (
                          <button onClick={() => handleReprint(t.id)} disabled={reprinting === t.id} title="2ª via"
                            className="p-1.5 text-purple-400 hover:text-purple-600 rounded-lg hover:bg-purple-50 transition">
                            <Printer className="w-3.5 h-3.5" />
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

      {/* ── COBRANÇAS ── */}
      {tab === 'cobrancas' && (
        <div className="flex flex-col gap-4">
          {/* Operator name for receipt */}
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={carneOperator}
              onChange={e => setCarneOperator(e.target.value)}
              placeholder="Nome do operador (comprovante)"
              className="flex-1 text-xs border border-gray-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-1 focus:ring-blue-300"
            />
          </div>

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
                          onClick={() => m.id && handlePayMensalidade(m.id, { name: pendingNames[m.resident_id] ?? '' })}
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
                              onClick={() => handlePayMensalidade(d.id, { name: delinquentNames[d.resident_id] ?? '' })}
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
                          <button
                            onClick={() => printCarneFinanceiro(p.resident_id, p.resident_name)}
                            className="text-xs border border-blue-200 text-blue-600 px-2 py-0.5 rounded-lg hover:bg-blue-50 transition"
                            title="Imprimir Carnê">
                            Carnê
                          </button>
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
                                onClick={() => handlePayMensalidade(m.id!, { name: historyResidentName ?? '' })}
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
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
              {/* Header */}
              <div className="px-4 py-3 border-b border-gray-100 flex flex-wrap items-center gap-2 justify-between">
                <h3 className="text-sm font-semibold text-gray-800">Histórico de Sessões</h3>
                <div className="flex items-center gap-2 flex-wrap">
                  {/* Filters */}
                  <input type="date" placeholder="De"
                    className="border border-gray-200 rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-[#26619c]/30"
                    onChange={e => setSessaoFilterFrom(e.target.value)} />
                  <input type="date" placeholder="Até"
                    className="border border-gray-200 rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-[#26619c]/30"
                    onChange={e => setSessaoFilterTo(e.target.value)} />
                  <input type="text" placeholder="Funcionário…"
                    className="border border-gray-200 rounded-lg px-2 py-1 text-xs w-28 focus:outline-none focus:ring-1 focus:ring-[#26619c]/30"
                    onChange={e => setSessaoFilterOp(e.target.value)} />
                  {/* Export */}
                  <button onClick={() => {
                    const rows = sessions
                      .filter(s => {
                        const d = s.opened_at.substring(0, 10)
                        if (sessaoFilterFrom && d < sessaoFilterFrom) return false
                        if (sessaoFilterTo && d > sessaoFilterTo) return false
                        if (sessaoFilterOp && !(s.operador_name ?? '').toLowerCase().includes(sessaoFilterOp.toLowerCase())) return false
                        return true
                      })
                    const headers = ['Data','Funcionário','R$ PIX','R$ Dinheiro','R$ Bruto','R$ Baixas','R$ Líquido','Conf. Cega','Sobra/Falta','Conferido por','Quebra Caixa','Origem']
                    const data = rows.map(s => {
                      const bruto = parseFloat(s.total_bruto ?? '0')
                      const baixas = parseFloat(s.total_baixas ?? '0')
                      const diff = s.difference != null ? parseFloat(s.difference) : null
                      return [
                        new Date(s.opened_at).toLocaleString('pt-BR'),
                        s.operador_name ?? '',
                        parseFloat(s.total_pix ?? '0').toFixed(2),
                        parseFloat(s.total_dinheiro ?? '0').toFixed(2),
                        bruto.toFixed(2),
                        baixas.toFixed(2),
                        (bruto - baixas).toFixed(2),
                        s.closing_balance ? parseFloat(s.closing_balance).toFixed(2) : '',
                        diff !== null ? diff.toFixed(2) : '',
                        s.conferido_por ?? '',
                        s.quebra_caixa ? parseFloat(s.quebra_caixa).toFixed(2) : '',
                        s.origin ?? 'Sessão de Caixa',
                      ]
                    })
                    const ws = XLSX.utils.aoa_to_sheet([headers, ...data])
                    const wb = XLSX.utils.book_new()
                    XLSX.utils.book_append_sheet(wb, ws, 'Sessões')
                    XLSX.writeFile(wb, `sessoes_${new Date().toISOString().substring(0,10)}.xlsx`)
                  }} className="flex items-center gap-1 text-xs bg-green-600 text-white px-2.5 py-1.5 rounded-lg font-medium hover:bg-green-700">
                    <FileSpreadsheet className="w-3.5 h-3.5" /> Excel
                  </button>
                  <button onClick={() => {
                    const w = window.open('', '_blank')!
                    const rows = sessions.filter(s => {
                      const d = s.opened_at.substring(0, 10)
                      if (sessaoFilterFrom && d < sessaoFilterFrom) return false
                      if (sessaoFilterTo && d > sessaoFilterTo) return false
                      if (sessaoFilterOp && !(s.operador_name ?? '').toLowerCase().includes(sessaoFilterOp.toLowerCase())) return false
                      return true
                    })
                    w.document.write(`<html><head><title>Sessões</title><style>body{font-family:sans-serif;font-size:11px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #ccc;padding:4px 6px;text-align:left}th{background:#f0f0f0}</style></head><body>`)
                    w.document.write(`<h2>Histórico de Sessões — ${new Date().toLocaleDateString('pt-BR')}</h2><table><tr>${['Data','Funcionário','PIX','Dinheiro','Bruto','Baixas','Líquido','Conf.Cega','Sobra/Falta','Conferido por','Quebra','Origem'].map(h => `<th>${h}</th>`).join('')}</tr>`)
                    rows.forEach(s => {
                      const bruto = parseFloat(s.total_bruto ?? '0')
                      const baixas = parseFloat(s.total_baixas ?? '0')
                      const diff = s.difference != null ? parseFloat(s.difference) : null
                      w.document.write(`<tr><td>${new Date(s.opened_at).toLocaleString('pt-BR')}</td><td>${s.operador_name ?? ''}</td><td>R$${parseFloat(s.total_pix ?? '0').toFixed(2)}</td><td>R$${parseFloat(s.total_dinheiro ?? '0').toFixed(2)}</td><td>R$${bruto.toFixed(2)}</td><td>R$${baixas.toFixed(2)}</td><td>R$${(bruto - baixas).toFixed(2)}</td><td>${s.closing_balance ? 'R$' + parseFloat(s.closing_balance).toFixed(2) : '—'}</td><td>${diff !== null ? (diff >= 0 ? '+' : '') + 'R$' + Math.abs(diff).toFixed(2) : '—'}</td><td>${s.conferido_por ?? ''}</td><td>${s.quebra_caixa ? 'R$' + parseFloat(s.quebra_caixa).toFixed(2) : '—'}</td><td>${s.origin ?? 'Sessão'}</td></tr>`)
                    })
                    w.document.write('</table></body></html>')
                    w.document.close()
                    w.print()
                  }} className="flex items-center gap-1 text-xs bg-red-600 text-white px-2.5 py-1.5 rounded-lg font-medium hover:bg-red-700">
                    PDF
                  </button>
                  <button onClick={() => setShowManualSession(true)} className="text-xs bg-indigo-600 text-white px-3 py-1.5 rounded-lg font-medium">+ Manual</button>
                </div>
              </div>
              {loadingSessions ? (
                <div className="p-6 text-center text-gray-400 text-sm">Carregando…</div>
              ) : sessions.length === 0 ? (
                <div className="p-6 text-center text-gray-400 text-sm">Nenhuma sessão encontrada.</div>
              ) : (() => {
                const filtered = sessions.filter(s => {
                  const d = s.opened_at.substring(0, 10)
                  if (sessaoFilterFrom && d < sessaoFilterFrom) return false
                  if (sessaoFilterTo && d > sessaoFilterTo) return false
                  if (sessaoFilterOp && !(s.operador_name ?? '').toLowerCase().includes(sessaoFilterOp.toLowerCase())) return false
                  return true
                })
                return (
                <div className="overflow-x-auto overflow-y-auto max-h-[520px]">
                  <table className="w-full text-sm min-w-[1200px]">
                    <thead className="bg-gray-50 border-b border-gray-200 sticky top-0 z-10">
                      <tr>
                        {['Status','Abertura','Fechamento','Funcionário','R$ PIX','R$ Dinheiro','R$ Bruto Lançado','R$ Baixas','R$ Líquido','Conf. Cega','Sobra/Falta','Conferido por','Quebra de Caixa','Malote','Origem',''].map(h => (
                          <th key={h} className="px-4 py-3 text-left font-semibold text-gray-600 whitespace-nowrap text-xs bg-gray-50">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {filtered.map(s => {
                        const bruto = parseFloat(s.total_bruto ?? '0')
                        const baixas = parseFloat(s.total_baixas ?? '0')
                        const liquido = bruto - baixas
                        const diff = s.difference != null ? parseFloat(s.difference) : null
                        const isManual = s.origin === 'Manual'
                        return (
                          <tr key={s.id} className="hover:bg-blue-50/40 cursor-pointer transition" onClick={() => openReview(s)}>
                            <td className="px-4 py-3 whitespace-nowrap">
                              {(() => {
                                const statusMap: Record<string, { label: string; cls: string }> = {
                                  open: { label: 'Aberto', cls: 'bg-green-100 text-green-700' },
                                  closed: { label: 'Fechado', cls: 'bg-gray-100 text-gray-600' },
                                  conferido: { label: 'Conferido', cls: 'bg-blue-100 text-blue-700' },
                                  cancelled: { label: 'Cancelado', cls: 'bg-red-100 text-red-700' },
                                }
                                const st = statusMap[s.status] ?? { label: s.status, cls: 'bg-gray-100 text-gray-500' }
                                return <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${st.cls}`}>{st.label}</span>
                              })()}
                            </td>
                            <td className="px-4 py-3 whitespace-nowrap text-gray-800 text-xs">
                              <div className="font-semibold">{new Date(s.opened_at).toLocaleDateString('pt-BR')}</div>
                              <div className="text-gray-400">{new Date(s.opened_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</div>
                            </td>
                            <td className="px-4 py-3 whitespace-nowrap text-gray-700 text-xs">
                              {s.closed_at ? (
                                <>
                                  <div className="font-medium">{new Date(s.closed_at).toLocaleDateString('pt-BR')}</div>
                                  <div className="text-gray-400">{new Date(s.closed_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</div>
                                </>
                              ) : <span className="text-gray-300">—</span>}
                            </td>
                            <td className="px-4 py-3 whitespace-nowrap text-gray-700">{s.operador_name ?? '—'}</td>
                            <td className="px-4 py-3 whitespace-nowrap text-blue-700 font-medium">{fmt(s.total_pix ?? '0')}</td>
                            <td className="px-4 py-3 whitespace-nowrap text-gray-700">{fmt(s.total_dinheiro ?? '0')}</td>
                            <td className="px-4 py-3 whitespace-nowrap text-gray-800 font-semibold">{fmt(bruto)}</td>
                            <td className="px-4 py-3 whitespace-nowrap text-red-600">{fmt(baixas)}</td>
                            <td className="px-4 py-3 whitespace-nowrap text-green-700 font-bold text-sm">{fmt(liquido)}</td>
                            <td className="px-4 py-3 whitespace-nowrap text-gray-600">{s.closing_balance ? fmt(s.closing_balance) : '—'}</td>
                            <td className={`px-4 py-3 whitespace-nowrap font-bold text-sm ${diff === null ? 'text-gray-400' : diff === 0 ? 'text-green-600' : diff > 0 ? 'text-blue-600' : 'text-red-600'}`}>
                              {diff !== null ? `${diff >= 0 ? '+' : ''}${fmt(diff)}` : '—'}
                            </td>
                            <td className="px-4 py-3 whitespace-nowrap text-gray-600 text-xs">{s.conferido_por ?? '—'}</td>
                            <td className={`px-4 py-3 whitespace-nowrap font-medium ${s.quebra_caixa && parseFloat(s.quebra_caixa) !== 0 ? 'text-amber-600' : 'text-gray-400'}`}>
                              {s.quebra_caixa ? fmt(s.quebra_caixa) : '—'}
                            </td>
                            <td className="px-4 py-3 whitespace-nowrap" onClick={e => e.stopPropagation()}>
                              {s.status === 'closed' && s.closing_balance && parseFloat(s.closing_balance) > 0 ? (
                                s.malote_sent_at ? (
                                  <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">✓ Enviado</span>
                                ) : (
                                  <button
                                    onClick={() => handleSendToMalote(s.id)}
                                    disabled={sendingMalote === s.id}
                                    className="px-2 py-1 rounded-lg text-xs font-semibold bg-amber-500 hover:bg-amber-600 text-white disabled:opacity-50 whitespace-nowrap">
                                    {sendingMalote === s.id ? '…' : 'Enviar'}
                                  </button>
                                )
                              ) : <span className="text-gray-300 text-xs">—</span>}
                            </td>
                            <td className="px-4 py-3 whitespace-nowrap">
                              <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${isManual ? 'bg-amber-100 text-amber-700' : 'bg-indigo-50 text-indigo-600'}`}>
                                {s.origin ?? 'Sessão de Caixa'}
                              </span>
                            </td>
                            <td className="px-4 py-3 whitespace-nowrap" onClick={e => e.stopPropagation()}>
                              <div className="flex items-center gap-1">
                                {s.status === 'conferido' && (
                                  <button
                                    onClick={() => handleRevertConferencia(s.id)}
                                    title="Desfazer conferência"
                                    className="flex items-center gap-1 text-xs text-amber-600 hover:text-amber-800 hover:bg-amber-50 px-2 py-1 rounded-lg transition">
                                    <RotateCcw className="w-3 h-3" /> Reverter
                                  </button>
                                )}
                                {(s.status === 'closed' || s.status === 'conferido') && isAdmin && (
                                  <button
                                    onClick={() => handleReopenSession(s.id)}
                                    disabled={reopeningSession === s.id}
                                    title="Reabrir caixa para correção"
                                    className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 hover:bg-blue-50 px-2 py-1 rounded-lg transition disabled:opacity-50">
                                    <RefreshCw className="w-3 h-3" /> Reabrir
                                  </button>
                                )}
                                {(s.status === 'closed' || s.status === 'conferido') && (
                                  <button
                                    onClick={() => printSessionReport(s)}
                                    title="Imprimir 2ª via do fechamento"
                                    className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 hover:bg-gray-100 px-2 py-1 rounded-lg transition">
                                    <Printer className="w-3 h-3" /> 2ª via
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        )
                      })}
                      {filtered.length === 0 && (
                        <tr><td colSpan={15} className="px-4 py-6 text-center text-gray-400 text-sm">Nenhuma sessão no filtro selecionado.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
                )
              })()}
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
              {/* 1 — Repasses pendentes (ação mais importante) */}
              {tesouraria && tesouraria.conferido_sessions.length > 0 && (
                <div className="bg-amber-50 rounded-xl border border-amber-300">
                  <div className="px-4 py-3 border-b border-amber-200 flex items-center justify-between">
                    <div>
                      <h3 className="text-sm font-semibold text-amber-900">⚡ Repasse Pendente</h3>
                      <p className="text-xs text-amber-700 mt-0.5">{tesouraria.conferido_sessions.length} sessão(ões) conferida(s) aguardando repasse para caixinha</p>
                    </div>
                    <span className="text-sm font-bold text-amber-800">
                      {fmt(tesouraria.conferido_sessions.reduce((s, c) => s + parseFloat(c.remaining ?? '0'), 0))}
                    </span>
                  </div>
                  <ul className="divide-y divide-amber-100">
                    {tesouraria.conferido_sessions.map(s => (
                      <li key={s.id} className="px-4 py-3 flex items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-medium text-gray-800">{new Date(s.opened_at).toLocaleDateString('pt-BR')} · {s.operador}</p>
                          <p className="text-xs font-semibold text-amber-700 mt-0.5">
                            Contado: {fmt(s.closing_balance ?? '0')}
                            {parseFloat(s.already_transferred) > 0 && (
                              <span className="ml-2 text-gray-500">· já repassado: {fmt(s.already_transferred)}</span>
                            )}
                            {s.difference && parseFloat(s.difference) !== 0 && (
                              <span className={`ml-2 ${parseFloat(s.difference) < 0 ? 'text-red-600' : 'text-green-600'}`}>
                                ({parseFloat(s.difference) > 0 ? '+' : ''}{fmt(s.difference)})
                              </span>
                            )}
                          </p>
                          <p className="text-xs font-bold text-amber-900 mt-0.5">A repassar: {fmt(s.remaining)}</p>
                        </div>
                        <button
                          onClick={() => {
                            setTransferTarget({ id: s.id, opened_at: s.opened_at, operador_name: s.operador, closing_balance: s.closing_balance ?? undefined })
                            setTransferAmt(s.remaining)
                            setTransferTroco('0')
                            setTransferClose(true)
                            setTransferBoxId('')
                          }}
                          className="text-xs bg-amber-500 hover:bg-amber-600 text-white font-semibold px-3 py-1.5 rounded-lg transition whitespace-nowrap"
                        >
                          Repassar
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* 2 — Caixas abertos (info) */}
              {tesouraria && tesouraria.open_sessions.length > 0 && (
                <div className="bg-white rounded-xl border border-blue-200 shadow-sm overflow-hidden">
                  <div className="px-4 py-3 border-b border-blue-100 bg-blue-50 flex items-center justify-between">
                    <div>
                      <h3 className="text-sm font-semibold text-blue-800">Caixas Abertos</h3>
                      <p className="text-xs text-blue-600 mt-0.5">{tesouraria.open_sessions.length} caixa(s) com operador agora</p>
                    </div>
                    <span className="text-sm font-bold text-blue-800">
                      {fmt(tesouraria.open_sessions.reduce((s, c) => s + parseFloat(c.expected_balance ?? '0'), 0))}
                    </span>
                  </div>
                  <ul className="divide-y divide-gray-100">
                    {tesouraria.open_sessions.map(s => (
                      <li key={s.id} className="px-4 py-3 flex items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-medium text-gray-800">{s.operador}</p>
                          <p className="text-xs text-gray-500">Aberto em {new Date(s.opened_at).toLocaleString('pt-BR')}</p>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-sm font-bold text-blue-700">{fmt(s.expected_balance)}</span>
                          {isAdmin && (
                            <button
                              onClick={() => { setAdminCloseTarget({ id: s.id, operador: s.operador }); setAdminCloseBalance('') }}
                              className="text-xs bg-red-50 text-red-600 border border-red-200 rounded-lg px-2 py-1 hover:bg-red-100 whitespace-nowrap"
                            >
                              Fechar
                            </button>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* 3 — Caixinhas (saldo + gestão) */}
              <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-semibold text-gray-800">Caixinhas</h3>
                    {boxSummary && <p className="text-xs text-gray-500 mt-0.5">Total: <b className="text-indigo-700">{fmt(boxSummary.total_in_boxes)}</b></p>}
                  </div>
                  <button onClick={() => { setEditBox(null); setBoxForm({ name: '', description: '', is_malote: false }); setShowBoxForm(true) }}
                    className="text-xs bg-indigo-600 text-white px-3 py-1.5 rounded-lg font-medium">+ Nova</button>
                </div>
                {cashBoxes.length === 0 ? (
                  <p className="p-4 text-sm text-gray-400">Nenhuma caixinha cadastrada.</p>
                ) : (
                  <ul className="divide-y divide-gray-100">
                    {cashBoxes.map(box => (
                      <li key={box.id} className="px-4 py-3">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <div className="w-2 h-2 rounded-full bg-indigo-400 shrink-0" />
                            <div>
                              <div className="flex items-center gap-1.5">
                                <p className="text-sm font-semibold text-gray-800">{box.name}</p>
                                {box.is_malote && <span className="px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-amber-100 text-amber-700">Malote</span>}
                              </div>
                              {box.description && <p className="text-xs text-gray-400">{box.description}</p>}
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-base font-bold text-indigo-700">{fmt(box.balance)}</span>
                            <button onClick={() => { setEditBox(box); setBoxForm({ name: box.name, description: box.description ?? '', is_malote: box.is_malote ?? false }); setShowBoxForm(true) }}
                              className="text-gray-300 hover:text-gray-500 p-1"><Pencil className="w-3.5 h-3.5" /></button>
                            <button onClick={() => handleDeactivateBox(box.id)} className="text-red-300 hover:text-red-500 p-1">
                              <Trash2 className="w-3.5 h-3.5" /></button>
                          </div>
                        </div>
                        <div className="flex gap-2 mt-2.5">
                          <button onClick={() => { setSelectedBox(box); setMoveForm({ amount: '', movement_type: 'credit', description: '' }); setShowMoveForm(true); loadBoxMovements(box.id) }}
                            className="flex-1 text-xs bg-green-50 text-green-700 border border-green-200 py-1.5 rounded-lg font-medium text-center">+ Entrada</button>
                          <button onClick={() => { setSelectedBox(box); setMoveForm({ amount: '', movement_type: 'debit', description: '' }); setShowMoveForm(true); loadBoxMovements(box.id) }}
                            className="flex-1 text-xs bg-red-50 text-red-700 border border-red-200 py-1.5 rounded-lg font-medium text-center">− Saída</button>
                          <button onClick={() => { setSelectedBox(box); setShowMoveForm(false); loadBoxMovements(box.id) }}
                            className="flex-1 text-xs bg-gray-100 text-gray-600 py-1.5 rounded-lg font-medium text-center">Histórico</button>
                        </div>
                        {selectedBox?.id === box.id && !showMoveForm && boxMovements.length > 0 && (
                          <div className="mt-2 border-t border-gray-100 pt-2">
                            <ul className="flex flex-col gap-1 max-h-40 overflow-y-auto">
                              {boxMovements.slice(0, 10).map(m => (
                                <li key={m.id} className="flex justify-between text-xs text-gray-500">
                                  <span className="truncate max-w-[60%]">{m.description}</span>
                                  <span className={m.movement_type === 'credit' ? 'text-green-600 font-medium' : 'text-red-600 font-medium'}>
                                    {m.movement_type === 'credit' ? '+' : '−'}{fmt(m.amount)}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* 4 — KPIs + Sangrias (analytics, secondary) */}
              <div className="grid grid-cols-3 gap-2">
                <div className="bg-white rounded-xl border border-gray-200 p-3 text-center">
                  <p className="text-[10px] text-gray-500 mb-1">Hoje</p>
                  <p className="text-sm font-bold text-green-700">{tesouraria ? fmt(tesouraria.faturamento_hoje) : '—'}</p>
                </div>
                <div className="bg-white rounded-xl border border-amber-100 p-3 text-center">
                  <p className="text-[10px] text-gray-500 mb-1">A Repassar</p>
                  <p className="text-sm font-bold text-amber-700">{tesouraria ? fmt(tesouraria.total_limbo) : '—'}</p>
                </div>
                <div className="bg-white rounded-xl border border-gray-200 p-3 text-center">
                  <p className="text-[10px] text-gray-500 mb-1">PAP Hoje</p>
                  <p className="text-sm font-bold text-green-700">{tesouraria ? fmt(tesouraria.pap_today.total) : '—'}</p>
                  <p className="text-[10px] text-gray-400">{tesouraria?.pap_today.count ?? 0} pgtos</p>
                </div>
              </div>

              {/* 5 — Saldo consolidado (relatório) */}
              <SaldoConsolidado />

              {/* 6 — Sangrias 30d */}
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
            </>
          )}

          {/* Transfer conferido → caixinha modal */}
          {transferTarget && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
              <div className="bg-white rounded-2xl w-full max-w-sm p-5 flex flex-col gap-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-base font-semibold text-gray-800">Transferir para caixinha</h2>
                  <button onClick={() => setTransferTarget(null)} className="text-gray-400 text-xl">×</button>
                </div>
                <div>
                  <p className="text-xs text-gray-500">Sessão de {new Date(transferTarget.opened_at).toLocaleDateString('pt-BR')} — {transferTarget.operador_name ?? ''}</p>
                  <p className="text-xs text-blue-700 font-medium mt-0.5">Contado: R$ {parseFloat(transferTarget.closing_balance!).toFixed(2)}</p>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Valor a repassar (R$)</label>
                    <input type="number" min="0.01" step="0.01" value={transferAmt} onChange={e => setTransferAmt(e.target.value)}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Troco que fica (R$)</label>
                    <input type="number" min="0" step="0.01" value={transferTroco} onChange={e => setTransferTroco(e.target.value)}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
                  </div>
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Caixinha destino</label>
                  <select value={transferBoxId} onChange={e => setTransferBoxId(e.target.value)}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">
                    <option value="">Selecione…</option>
                    {cashBoxes.map(b => (
                      <option key={b.id} value={b.id}>{b.name} — R$ {parseFloat(b.balance).toFixed(2)}</option>
                    ))}
                  </select>
                </div>
                <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                  <input type="checkbox" checked={transferClose} onChange={e => setTransferClose(e.target.checked)}
                    className="w-4 h-4 rounded" />
                  Fechar sessão após transferência
                </label>
                <div className="flex gap-2">
                  <button onClick={() => setTransferTarget(null)} className="flex-1 border border-gray-200 text-gray-600 py-2 rounded-xl text-sm">Cancelar</button>
                  <button onClick={handleTransferConferido} disabled={!transferBoxId || !transferAmt || transferring}
                    className="flex-1 bg-amber-500 hover:bg-amber-600 text-white py-2 rounded-xl text-sm font-semibold disabled:opacity-50">
                    {transferring ? 'Transferindo…' : 'Confirmar repasse'}
                  </button>
                </div>
              </div>
            </div>
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
                <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                  <input type="checkbox" checked={boxForm.is_malote} onChange={e => setBoxForm(f => ({ ...f, is_malote: e.target.checked }))} className="w-4 h-4 rounded" />
                  É um Malote (recebe dinheiro físico do fechamento)
                </label>
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

          {/* Pipeline Financeiro */}
          <div className="bg-white rounded-xl border border-blue-100 shadow-sm p-4">
            <h3 className="text-sm font-bold text-gray-800 mb-3">Esteira Financeira — Fluxo do Caixa ao Faturamento</h3>
            <div className="flex flex-col gap-1.5 text-xs text-gray-600">
              {[
                { num: 1, label: 'Operador fecha caixa (conf. cega) e coloca o dinheiro no malote físico', status: 'op' },
                { num: 2, label: 'Conferente recolhe o dinheiro e verifica se o valor físico bate com o fechamento', status: 'conf' },
                { num: 3, label: 'Dinheiro (espécie) → lançado no faturamento. PIX → enviado para esteira de conciliação abaixo', status: 'split' },
                { num: 4, label: 'Conciliação PIX: cada venda PIX deve ser confirmada com o extrato bancário', status: 'pix' },
                { num: 5, label: 'PIX conciliados → contabilizados no faturamento (caixinha cofre)', status: 'pix' },
                { num: 6, label: 'Responsável transfere espécie do malote para o cofre no sistema (Caixinhas)', status: 'cofre' },
              ].map(s => (
                <div key={s.num} className="flex items-start gap-2 py-1.5 border-b border-gray-50 last:border-0">
                  <span className={`shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold text-white ${
                    s.status === 'op' ? 'bg-amber-400' : s.status === 'conf' ? 'bg-blue-500' : s.status === 'split' ? 'bg-purple-500' : s.status === 'pix' ? 'bg-green-500' : 'bg-gray-400'
                  }`}>{s.num}</span>
                  <span>{s.label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Conciliação PIX */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold text-gray-800">Conciliação PIX</h2>
              <button onClick={loadPixPending} disabled={loadingPixPending} className="text-xs text-[#26619c] hover:underline">
                {loadingPixPending ? 'Carregando…' : 'Atualizar'}
              </button>
            </div>
            {pixPending.length === 0 ? (
              <p className="text-xs text-gray-400">Nenhuma venda registrada.</p>
            ) : (
              <>
                <div className="overflow-x-auto max-h-[480px] overflow-y-auto mb-3">
                  <table className="w-full text-xs border-collapse">
                    <thead className="sticky top-0 bg-gray-50 z-10">
                      <tr className="text-gray-500 text-left">
                        <th className="px-2 py-2 w-6">
                          <input type="checkbox"
                            checked={pixPending.filter(p => !!p.bank_statement_id).length > 0 && pixPending.filter(p => !!p.bank_statement_id).every(p => pixSelected.has(p.bank_statement_id!))}
                            onChange={e => {
                              const batchable = pixPending.filter(p => !!p.bank_statement_id).map(p => p.bank_statement_id!)
                              setPixSelected(e.target.checked ? new Set(batchable) : new Set())
                            }} />
                        </th>
                        <th className="px-2 py-2 font-medium">Status</th>
                        <th className="px-2 py-2 font-medium">Data</th>
                        <th className="px-2 py-2 font-medium">Valor</th>
                        <th className="px-2 py-2 font-medium">Descrição</th>
                        <th className="px-2 py-2 font-medium">Morador</th>
                        <th className="px-2 py-2 font-medium">Pagador PIX</th>
                        <th className="px-2 py-2 font-medium">Operador</th>
                        <th className="px-2 py-2 font-medium">Sessão</th>
                        <th className="px-2 py-2 font-medium"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {pixPending.map(p => {
                        const statusMap: Record<string, { label: string; cls: string }> = {
                          nao_conciliado: { label: 'Não-Conciliado', cls: 'bg-gray-100 text-gray-500' },
                          pendente: { label: 'Pendente', cls: 'bg-amber-100 text-amber-700' },
                          conciliado: { label: 'Conciliado', cls: 'bg-green-100 text-green-700' },
                          cancelado: { label: 'Cancelado', cls: 'bg-red-100 text-red-600' },
                        }
                        const st = statusMap[p.status] ?? statusMap.nao_conciliado
                        const canBatch = !!p.bank_statement_id
                        return (
                          <tr key={p.id} className={`border-b border-gray-100 hover:bg-gray-50 ${canBatch && pixSelected.has(p.bank_statement_id!) ? 'bg-blue-50' : ''}`}>
                            <td className="px-2 py-2">
                              <input type="checkbox" disabled={!canBatch}
                                checked={canBatch && pixSelected.has(p.bank_statement_id!)}
                                onChange={e => {
                                  if (!p.bank_statement_id) return
                                  setPixSelected(prev => {
                                    const n = new Set(prev)
                                    e.target.checked ? n.add(p.bank_statement_id!) : n.delete(p.bank_statement_id!)
                                    return n
                                  })
                                }} />
                            </td>
                            <td className="px-2 py-2 whitespace-nowrap">
                              <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${st.cls}`}>{st.label}</span>
                            </td>
                            <td className="px-2 py-2 whitespace-nowrap text-gray-600">
                              {new Date(p.date + 'T00:00:00').toLocaleDateString('pt-BR')}
                            </td>
                            <td className="px-2 py-2 whitespace-nowrap font-semibold text-green-700">{fmt(p.amount)}</td>
                            <td className="px-2 py-2 text-gray-800 max-w-[180px] truncate">{p.description || '—'}</td>
                            <td className="px-2 py-2 text-gray-600 max-w-[140px] truncate">{p.resident_name || '—'}</td>
                            <td className="px-2 py-2 text-gray-600 max-w-[140px] truncate">{p.payer_name || '—'}</td>
                            <td className="px-2 py-2 text-gray-400 whitespace-nowrap">{p.operador_name || '—'}</td>
                            <td className="px-2 py-2 text-gray-400 whitespace-nowrap">
                              {p.session_opened_at ? new Date(p.session_opened_at).toLocaleDateString('pt-BR') : '—'}
                            </td>
                            <td className="px-2 py-2 whitespace-nowrap">
                              {p.status === 'nao_conciliado' && (
                                <button
                                  onClick={async () => {
                                    try {
                                      await api.post('/financeiro/bank-statements/manual-reconcile', {
                                        transaction_id: p.id,
                                        amount: parseFloat(p.amount),
                                        date: p.date,
                                        payer_name: p.payer_name || p.description || 'Manual',
                                        description: p.description || 'Conciliação manual',
                                      })
                                      toast.success('PIX marcado como conciliado.')
                                      loadPixPending()
                                    } catch (e: any) {
                                      toast.error(e.response?.data?.detail ?? 'Erro ao conciliar.')
                                    }
                                  }}
                                  className="text-[10px] bg-green-600 text-white px-2 py-1 rounded-lg font-semibold hover:bg-green-700 whitespace-nowrap">
                                  Conciliar
                                </button>
                              )}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="flex gap-2 items-center flex-wrap">
                  <select value={pixBatchBox} onChange={e => setPixBatchBox(e.target.value)}
                    className="flex-1 border border-gray-200 rounded-lg px-2 py-1.5 text-xs min-w-[140px]">
                    <option value="">Caixinha destino (conciliados)…</option>
                    {cashBoxes.map(b => (
                      <option key={b.id} value={b.id}>{b.name}</option>
                    ))}
                  </select>
                  <button onClick={handlePixBatch} disabled={batchingPix || pixSelected.size === 0 || !pixBatchBox}
                    className="bg-[#26619c] text-white px-3 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-50 whitespace-nowrap">
                    {batchingPix ? '…' : `Enviar ${pixSelected.size} conciliados`}
                  </button>
                </div>
              </>
            )}
          </div>

          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
            <h2 className="font-semibold text-gray-800 mb-1">Importar Extrato Bancário</h2>
            <p className="text-xs text-gray-400 mb-4">Importe o extrato CSV para conciliar pagamentos PIX.</p>
            <div className="flex flex-col gap-3">
              <div>
                <label className="block text-xs text-gray-600 mb-1">Banco</label>
                <select value={bankType} onChange={e => setBankType(e.target.value as any)}
                  className={inputCls}>
                  <option value="infinitypay">InfinityPay</option>
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
              <button onClick={handleReconcile} disabled={reconRunning}
                className="flex items-center justify-center gap-2 border border-[#26619c] text-[#26619c] py-2 rounded-xl text-sm font-medium transition hover:bg-blue-50 disabled:opacity-50">
                {reconRunning ? 'Conciliando…' : 'Re-executar Conciliação'}
              </button>
            </div>
          </div>

          {/* Progress + log */}
          {(reconRunning || reconSummary || reconLogs.length > 0) && (
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-gray-700">
                  {reconRunning ? `Conciliando… ${reconProgress}%` : reconSummary ? `Concluído — ${reconSummary.matched} conciliados / ${reconSummary.unmatched} sem match` : ''}
                </span>
                {!reconRunning && reconLogs.length > 0 && (
                  <button onClick={() => { setReconLogs([]); setReconSummary(null); setReconProgress(0) }}
                    className="text-xs text-gray-400 hover:text-gray-600">Limpar</button>
                )}
              </div>
              <div className="w-full bg-gray-100 rounded-full h-2">
                <div className="h-2 rounded-full transition-all duration-300"
                  style={{ width: `${reconProgress}%`, background: reconRunning ? '#26619c' : reconSummary ? '#16a34a' : '#26619c' }} />
              </div>
              {reconLogs.length > 0 && (
                <div className="max-h-64 overflow-y-auto flex flex-col gap-1 text-xs font-mono">
                  {reconLogs.map((log, i) => (
                    <div key={i} className={`flex items-start gap-2 px-2 py-1 rounded ${log.type === 'matched' ? 'bg-green-50 text-green-800' : 'bg-gray-50 text-gray-500'}`}>
                      <span className="shrink-0">{log.type === 'matched' ? '✓' : '—'}</span>
                      <span className="flex-1 truncate">{log.desc}</span>
                      <span className="shrink-0">R$ {log.amount?.toFixed(2)}</span>
                      <span className="shrink-0 text-gray-400">{log.date}</span>
                      {log.type === 'matched' && log.payer && (
                        <span className="shrink-0 text-green-600 truncate max-w-[120px]">← {log.payer}</span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

        </div>
      )}

      {/* ── MODAL FECHAR CAIXA (ADMIN) ── */}
      {adminCloseTarget && (
        <div className="fixed inset-0 z-[70] bg-black/40 flex items-center justify-center p-4">
          <div className="w-full max-w-sm bg-white rounded-2xl shadow-2xl p-5 flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-gray-900">Fechar caixa de {adminCloseTarget.operador}</h3>
              <button onClick={() => setAdminCloseTarget(null)}><X className="w-5 h-5 text-gray-400" /></button>
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Valor contado (R$)</label>
              <input
                type="number" min="0" step="0.01"
                value={adminCloseBalance}
                onChange={e => setAdminCloseBalance(e.target.value)}
                placeholder="0,00"
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-300"
                autoFocus
              />
            </div>
            <button
              onClick={handleAdminClose}
              disabled={adminClosing || !adminCloseBalance}
              className="w-full bg-red-600 text-white rounded-xl py-2.5 text-sm font-semibold disabled:opacity-50"
            >
              {adminClosing ? 'Fechando…' : 'Confirmar fechamento'}
            </button>
          </div>
        </div>
      )}

      {/* ── MODAL EDIÇÃO DE LANÇAMENTO ── */}
      {editTarget && (
        <div className="fixed inset-0 z-[60] bg-black/40 flex items-end sm:items-center justify-center p-4">
          <div className="w-full max-w-sm bg-white rounded-2xl shadow-2xl p-5 flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-gray-900">Corrigir Lançamento</h3>
              <button onClick={() => setEditTarget(null)}><X className="w-5 h-5 text-gray-400" /></button>
            </div>
            <div className="bg-blue-50 border border-blue-200 rounded-lg px-3 py-2">
              <p className="text-xs text-gray-500 truncate">{editTarget.description}</p>
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">Descrição</label>
              <input value={editDesc} onChange={e => setEditDesc(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">Valor (R$)</label>
              <input type="number" step="0.01" value={editAmount} onChange={e => setEditAmount(e.target.value)} className={inputCls} />
            </div>
            {editPayMethods.length > 0 && (
              <div>
                <label className="block text-xs text-gray-600 mb-1">Forma de pagamento</label>
                <select value={editPmId} onChange={e => setEditPmId(e.target.value)} className={inputCls}>
                  <option value="">Manter atual</option>
                  {editPayMethods.map(pm => <option key={pm.id} value={pm.id}>{pm.name}</option>)}
                </select>
              </div>
            )}
            {editSessions.length > 0 && (
              <div>
                <label className="block text-xs text-gray-600 mb-1">Mover para caixa</label>
                <select value={editCashSessionId} onChange={e => setEditCashSessionId(e.target.value)} className={inputCls}>
                  <option value="">Manter caixa atual</option>
                  {editSessions.map(s => (
                    <option key={s.id} value={s.id}>
                      {s.opened_by_name} — {new Date(s.opened_at).toLocaleDateString('pt-BR')}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div>
              <label className="block text-xs text-gray-600 mb-1">Senha de administrador *</label>
              <input type="password" value={editPassword} onChange={e => setEditPassword(e.target.value)} className={inputCls} placeholder="Senha de admin" />
            </div>
            <div className="flex gap-2">
              <button onClick={() => setEditTarget(null)} className="flex-1 border border-gray-300 text-gray-600 py-2.5 rounded-xl text-sm hover:bg-gray-50 transition">Cancelar</button>
              <button onClick={handleEditTx} disabled={!editPassword.trim() || editing}
                className="flex-1 bg-[#26619c] hover:bg-[#1a4f87] text-white py-2.5 rounded-xl text-sm font-semibold transition disabled:opacity-50">
                {editing ? 'Salvando…' : 'Salvar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL ESTORNO ── */}
      {reversalTarget && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-4">
          <div className="w-full max-w-sm bg-white rounded-2xl shadow-2xl p-5 flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-gray-900">Estornar Transação</h3>
              <button onClick={() => { setReversalTarget(null); setReversalReason(''); setReversalPassword('') }}><X className="w-5 h-5 text-gray-400" /></button>
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
            <div>
              <label className="block text-xs text-gray-600 mb-1">Senha de administrador *</label>
              <input
                type="password"
                value={reversalPassword}
                onChange={e => setReversalPassword(e.target.value)}
                className={inputCls}
                placeholder="Senha de admin"
              />
            </div>
            <div className="flex gap-2">
              <button onClick={() => { setReversalTarget(null); setReversalReason(''); setReversalPassword('') }}
                className="flex-1 border border-gray-300 text-gray-600 py-2.5 rounded-xl text-sm hover:bg-gray-50 transition">
                Cancelar
              </button>
              <button
                onClick={handleReversal}
                disabled={!reversalReason.trim() || !reversalPassword.trim() || reversing === reversalTarget.id}
                className="flex-1 bg-red-500 hover:bg-red-600 text-white py-2.5 rounded-xl text-sm font-semibold transition disabled:opacity-50">
                {reversing === reversalTarget.id ? 'Estornando…' : 'Confirmar Estorno'}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* ── ACORDO MODAL ── */}
      {showAcordoModal && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm p-5 flex flex-col gap-4 mb-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-gray-800">Registrar Acordo</h2>
              <button onClick={() => setShowAcordoModal(null)} className="text-gray-400 text-xl">×</button>
            </div>
            <div className="bg-gray-50 rounded-lg p-3 text-sm">
              <p className="font-medium text-gray-800">{showAcordoModal.full_name}</p>
              <p className="text-xs text-gray-500 mt-0.5">Total a pagar: <span className="font-semibold text-gray-700">{fmt(showAcordoModal.monthly_fee)}</span></p>
            </div>
            <div className="flex flex-col gap-3">
              <div>
                <label className="text-xs text-gray-500 mb-0.5 block">Sinal (entrada agora) *</label>
                <input type="number" step="0.01" min="0.01" value={acordoForm.sinal}
                  onChange={e => setAcordoForm(f => ({ ...f, sinal: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-300"
                  placeholder="Ex: 240.00" />
                {acordoForm.sinal && parseFloat(acordoForm.sinal) > 0 && (
                  <p className="text-xs text-purple-600 mt-1">
                    Restante: {fmt(Math.max(0, parseFloat(showAcordoModal.monthly_fee) - parseFloat(acordoForm.sinal)))} ÷ {acordoForm.parcelas} = {fmt(Math.max(0, parseFloat(showAcordoModal.monthly_fee) - parseFloat(acordoForm.sinal)) / parseInt(acordoForm.parcelas || '1'))} /parcela
                  </p>
                )}
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-0.5 block">Parcelas para o restante</label>
                <input type="number" min="1" max="24" value={acordoForm.parcelas}
                  onChange={e => setAcordoForm(f => ({ ...f, parcelas: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-300" />
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-0.5 block">Forma de pagamento do sinal</label>
                <input placeholder="PIX, Dinheiro…" value={acordoForm.payment_method}
                  onChange={e => setAcordoForm(f => ({ ...f, payment_method: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-300" />
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={() => setShowAcordoModal(null)} className="flex-1 border border-gray-300 text-gray-600 py-2.5 rounded-xl text-sm">Cancelar</button>
              <button onClick={handleAcordo} disabled={savingAcordo || !acordoForm.sinal}
                className="flex-1 bg-purple-600 text-white py-2.5 rounded-xl text-sm font-semibold disabled:opacity-50 hover:bg-purple-700">
                {savingAcordo ? 'Registrando…' : 'Confirmar Acordo'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── SESSION REVIEW MODAL ── */}
      {reviewSession && (
        <CaixaConferenciaModal
          session={reviewSession}
          txs={reviewTxs}
          conferentes={conferentes}
          onClose={() => setReviewSession(null)}
          onSaved={loadSessions}
          onEditTx={tx => {
            setEditTarget(tx as unknown as Tx)
            setEditAmount(tx.amount)
            setEditDesc(tx.description)
            setEditPmId('')
            setEditPassword('')
          }}
        />
      )}

      {/* ── DRE ── */}
      {tab === 'dre' && (
        <div className="flex flex-col gap-4">
          {/* Controls */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 flex flex-col gap-3">
            <p className="text-sm font-semibold text-gray-800 flex items-center gap-2">
              <FileBarChart className="w-4 h-4 text-[#26619c]" />
              Demonstrativo de Resultado
            </p>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Ano</label>
                <input type="number" min="2020" max="2099" value={dreYear}
                  onChange={e => setDreYear(parseInt(e.target.value) || new Date().getFullYear())}
                  className={inputCls} />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Mês</label>
                <select value={dreMonth} onChange={e => setDreMonth(e.target.value ? parseInt(e.target.value) : '')} className={inputCls}>
                  <option value="">Ano completo</option>
                  {['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'].map((m, i) => (
                    <option key={i+1} value={i+1}>{m}</option>
                  ))}
                </select>
              </div>
            </div>
            {/* Filters */}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Visualizar</label>
                <select value={dreFilter} onChange={e => { setDreFilter(e.target.value as any); setDreCatFilter('') }} className={inputCls}>
                  <option value="all">Receitas e Despesas</option>
                  <option value="receitas">Somente Receitas</option>
                  <option value="despesas">Somente Despesas</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Categoria</label>
                <select value={dreCatFilter} onChange={e => setDreCatFilter(e.target.value)} className={inputCls}>
                  <option value="">Todas</option>
                  {dre && [
                    ...(dreFilter !== 'despesas' ? dre.receitas.map((r: any) => r.descricao) : []),
                    ...(dreFilter !== 'receitas' ? dre.despesas.map((d: any) => d.descricao) : []),
                  ].map((cat: string) => <option key={cat} value={cat}>{cat}</option>)}
                </select>
              </div>
            </div>
            <button onClick={loadDre} disabled={loadingDre}
              className="bg-[#26619c] hover:bg-[#1a4f87] text-white py-2.5 rounded-xl text-sm font-semibold transition disabled:opacity-50">
              {loadingDre ? 'Gerando…' : 'Gerar DRE'}
            </button>
          </div>

          {dre && (() => {
            const receitasFilt = dreCatFilter ? dre.receitas.filter((r: any) => r.descricao === dreCatFilter) : dre.receitas
            const despesasFilt = dreCatFilter ? dre.despesas.filter((d: any) => d.descricao === dreCatFilter) : dre.despesas
            const totalRec = receitasFilt.reduce((s: number, r: any) => s + r.valor, 0)
            const totalDesp = despesasFilt.reduce((s: number, d: any) => s + d.valor, 0)
            const resultado = totalRec - totalDesp
            return (
              <div ref={dreRef} className="flex flex-col gap-3 bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                {/* Header */}
                <div className="px-4 pt-4 pb-3 border-b border-gray-100">
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <h3 className="text-base font-bold text-gray-900">DRE</h3>
                      <p className="text-xs text-gray-400">{dre.period_label}{dreCatFilter ? ` · ${dreCatFilter}` : ''}</p>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={exportDreXLSX}
                        className="flex items-center gap-1.5 text-xs bg-green-600 text-white px-3 py-2 rounded-lg hover:bg-green-700 transition font-medium">
                        <FileSpreadsheet className="w-3.5 h-3.5" /> Excel
                      </button>
                      <button onClick={exportDrePNG}
                        className="flex items-center gap-1.5 text-xs bg-indigo-600 text-white px-3 py-2 rounded-lg hover:bg-indigo-700 transition font-medium">
                        <Image className="w-3.5 h-3.5" /> PNG
                      </button>
                    </div>
                  </div>
                  {/* Summary row */}
                  <div className="grid grid-cols-3 gap-2">
                    {dreFilter !== 'despesas' && (
                      <div className="bg-green-50 rounded-lg p-3 text-center">
                        <p className="text-[10px] text-green-600 font-medium mb-1">RECEITAS</p>
                        <p className="text-sm font-bold text-green-700">{fmt(totalRec)}</p>
                      </div>
                    )}
                    {dreFilter !== 'receitas' && (
                      <div className="bg-red-50 rounded-lg p-3 text-center">
                        <p className="text-[10px] text-red-600 font-medium mb-1">DESPESAS</p>
                        <p className="text-sm font-bold text-red-700">{fmt(totalDesp)}</p>
                      </div>
                    )}
                    {dreFilter === 'all' && (
                      <div className={`rounded-lg p-3 text-center ${resultado >= 0 ? 'bg-blue-50' : 'bg-orange-50'}`}>
                        <p className={`text-[10px] font-medium mb-1 ${resultado >= 0 ? 'text-blue-600' : 'text-orange-600'}`}>
                          {resultado >= 0 ? 'SUPERÁVIT' : 'DÉFICIT'}
                        </p>
                        <p className={`text-sm font-bold ${resultado >= 0 ? 'text-blue-700' : 'text-orange-700'}`}>{fmt(Math.abs(resultado))}</p>
                      </div>
                    )}
                  </div>
                </div>

                <div className="px-4 pb-4 flex flex-col gap-4">
                  {/* Receitas section */}
                  {dreFilter !== 'despesas' && receitasFilt.length > 0 && (
                    <div>
                      <p className="text-xs font-bold text-green-700 mb-2 uppercase tracking-wider flex items-center gap-1.5">
                        <TrendingUp className="w-3.5 h-3.5" /> Receitas
                      </p>
                      <div className="flex flex-col gap-0.5">
                        {receitasFilt.map((r: any) => {
                          const pct = totalRec > 0 ? (r.valor / totalRec) * 100 : 0
                          return (
                            <div key={r.descricao} className="flex flex-col gap-0.5 py-2 border-b border-gray-50 last:border-0">
                              <div className="flex items-center justify-between">
                                <p className="text-sm text-gray-700">{r.descricao}</p>
                                <p className="text-sm font-semibold text-green-700">{fmt(r.valor)}</p>
                              </div>
                              <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden">
                                <div className="h-full bg-green-400 rounded-full" style={{ width: `${pct}%` }} />
                              </div>
                            </div>
                          )
                        })}
                        <div className="flex items-center justify-between py-2 mt-1">
                          <p className="text-sm font-bold text-gray-900">Total Receitas</p>
                          <p className="text-sm font-bold text-green-700">{fmt(totalRec)}</p>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Despesas section */}
                  {dreFilter !== 'receitas' && despesasFilt.length > 0 && (
                    <div>
                      <p className="text-xs font-bold text-red-600 mb-2 uppercase tracking-wider flex items-center gap-1.5">
                        <TrendingDown className="w-3.5 h-3.5" /> Despesas
                      </p>
                      <div className="flex flex-col gap-0.5">
                        {despesasFilt.map((d: any) => {
                          const pct = totalDesp > 0 ? (d.valor / totalDesp) * 100 : 0
                          return (
                            <div key={d.descricao} className="flex flex-col gap-0.5 py-2 border-b border-gray-50 last:border-0">
                              <div className="flex items-center justify-between">
                                <p className="text-sm text-gray-700">{d.descricao}</p>
                                <p className="text-sm font-semibold text-red-600">{fmt(d.valor)}</p>
                              </div>
                              <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden">
                                <div className="h-full bg-red-400 rounded-full" style={{ width: `${pct}%` }} />
                              </div>
                            </div>
                          )
                        })}
                        <div className="flex items-center justify-between py-2 mt-1">
                          <p className="text-sm font-bold text-gray-900">Total Despesas</p>
                          <p className="text-sm font-bold text-red-600">{fmt(totalDesp)}</p>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Resultado */}
                  {dreFilter === 'all' && (
                    <div className={`rounded-xl p-4 text-center border-2 ${resultado >= 0 ? 'bg-green-50 border-green-300' : 'bg-red-50 border-red-300'}`}>
                      <p className="text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wide">Resultado do Período</p>
                      <p className={`text-3xl font-bold ${resultado >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                        {resultado >= 0 ? '+' : ''}{fmt(resultado)}
                      </p>
                      <p className={`text-sm font-medium mt-1 ${resultado >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {resultado >= 0 ? '✓ Superávit' : '✗ Déficit'}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            )
          })()}
        </div>
      )}

      {/* ── PORTA A PORTA ── */}
      {tab === 'porta_a_porta' && (
        <div className="flex flex-col gap-4">
          {papLoading ? (
            <div className="p-8 text-center text-gray-400 text-sm">Carregando…</div>
          ) : (
            <>
              {papSummary && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-green-50 rounded-xl p-4 border border-green-100 flex flex-col gap-1 col-span-2">
                    <p className="text-xs text-green-600 font-medium">Bruto gerado</p>
                    <p className="text-xl font-bold text-green-700">{fmt(papSummary.gross_revenue)}</p>
                    <p className="text-xs text-green-500">Recebido: {fmt(papSummary.total_received)}</p>
                  </div>
                  <div className="bg-blue-50 rounded-xl p-4 border border-blue-100 flex flex-col gap-1">
                    <p className="text-xs text-blue-600 font-medium">Associados</p>
                    <p className="text-2xl font-bold text-blue-700">{papSummary.paid_leads}</p>
                  </div>
                  <div className="bg-amber-50 rounded-xl p-4 border border-amber-100 flex flex-col gap-1">
                    <p className="text-xs text-amber-700 font-medium">Comissões geradas</p>
                    <p className="text-xl font-bold text-amber-700">{fmt(papSummary.total_commission)}</p>
                  </div>
                  <div className="bg-gray-50 rounded-xl p-3 border border-gray-200 flex flex-col gap-1">
                    <p className="text-xs text-gray-500">Pendentes</p>
                    <p className="text-lg font-bold text-gray-700">{papSummary.pending_leads}</p>
                  </div>
                  <div className="bg-purple-50 rounded-xl p-3 border border-purple-100 flex flex-col gap-1">
                    <p className="text-xs text-purple-600">Em acordo</p>
                    <p className="text-lg font-bold text-purple-700">{papSummary.agreement_leads}</p>
                  </div>
                </div>
              )}

              {papSummary?.commissions?.length > 0 && (
                <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                  <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
                    <div>
                      <p className="text-sm font-semibold text-gray-800">Metas por Operador</p>
                      <p className="text-xs text-gray-400 mt-0.5">A cada 5 associados → 2 mensalidades de comissão</p>
                    </div>
                    <button onClick={() => setShowCommPay(v => !v)}
                      className="text-xs bg-amber-600 hover:bg-amber-700 text-white px-3 py-1.5 rounded-lg transition shrink-0">
                      Conferir Metas
                    </button>
                  </div>
                  <ul className="divide-y divide-gray-100">
                    {papSummary.commissions.map((c: any) => {
                      const pct = Math.min(100, ((c.paid_count % 5) / 5) * 100)
                      const pending = parseFloat(c.commission_pending ?? '0')
                      return (
                        <li key={c.operator_id} className="px-4 py-3">
                          <div className="flex items-center justify-between mb-1.5">
                            <p className="text-sm font-medium text-gray-800">{c.operator_name ?? 'Operador'}</p>
                            <div className="text-right">
                              <span className="text-sm font-semibold text-amber-700">{fmt(c.commission_earned)}</span>
                              {pending > 0 && <p className="text-[10px] text-red-500">A pagar: {fmt(pending)}</p>}
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <div className="flex-1 bg-gray-100 rounded-full h-1.5">
                              <div className="bg-amber-400 h-1.5 rounded-full transition-all" style={{ width: `${pct}%` }} />
                            </div>
                            <p className="text-xs text-gray-400 shrink-0">{c.paid_count} assoc. · faltam {c.next_commission_in}</p>
                          </div>
                          {pending > 0 && (
                            <button onClick={() => { setCommPayTarget(c); setCommPayForm({ amount: pending.toFixed(2), payment_method: '', paid_at: '', notes: '' }); setShowCommPay(true) }}
                              className="mt-1.5 text-[10px] border border-amber-300 text-amber-700 px-2 py-0.5 rounded-lg hover:bg-amber-50">
                              Registrar pagamento
                            </button>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                  {showCommPay && (
                    <div className="px-4 py-4 bg-amber-50 border-t border-amber-100">
                      <p className="text-xs font-semibold text-amber-800 mb-3">Conferir Pagamento de Metas{commPayTarget ? ` — ${commPayTarget.operator_name}` : ''}</p>
                      {!commPayTarget && (
                        <select onChange={e => { const op = papSummary.commissions.find((c: any) => c.operator_id === e.target.value); setCommPayTarget(op ?? null); if (op) setCommPayForm(f => ({ ...f, amount: parseFloat(op.commission_pending ?? '0').toFixed(2) })) }}
                          className="w-full border border-amber-200 rounded-lg px-2 py-1.5 text-sm mb-2">
                          <option value="">— Selecionar operador —</option>
                          {papSummary.commissions.filter((c: any) => parseFloat(c.commission_pending ?? '0') > 0).map((c: any) => <option key={c.operator_id} value={c.operator_id}>{c.operator_name}</option>)}
                        </select>
                      )}
                      <div className="grid grid-cols-2 gap-2">
                        {[['Valor (R$)', 'amount', 'number'], ['Forma de pagamento', 'payment_method', 'text'], ['Data', 'paid_at', 'date'], ['Observação', 'notes', 'text']].map(([label, key, type]) => (
                          <div key={key}>
                            <label className="text-xs text-gray-500 mb-0.5 block">{label}</label>
                            <input type={type} value={(commPayForm as any)[key]} onChange={e => setCommPayForm(f => ({ ...f, [key]: e.target.value }))}
                              className="w-full border border-amber-200 rounded-lg px-2 py-1.5 text-sm" />
                          </div>
                        ))}
                      </div>
                      <div className="flex gap-2 mt-3">
                        <button onClick={() => { setShowCommPay(false); setCommPayTarget(null) }} className="flex-1 border border-gray-300 text-gray-600 py-2 rounded-xl text-sm">Cancelar</button>
                        <button onClick={handleCommPay} disabled={savingCommPay || !commPayTarget || !commPayForm.amount}
                          className="flex-1 bg-amber-600 hover:bg-amber-700 text-white py-2 rounded-xl text-sm font-semibold disabled:opacity-50">
                          {savingCommPay ? 'Registrando…' : 'Confirmar'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Link único da associação */}
              {papToken && (
                <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-blue-700 mb-0.5">Link de cadastro público (único)</p>
                    <p className="text-xs text-blue-500 break-all truncate">{window.location.origin}/associar?token={papToken}</p>
                  </div>
                  <button onClick={() => { navigator.clipboard.writeText(`${window.location.origin}/associar?token=${papToken}`); toast.success('Link copiado!') }}
                    className="shrink-0 text-xs bg-blue-600 text-white px-3 py-1.5 rounded-lg hover:bg-blue-700 transition">
                    Copiar
                  </button>
                </div>
              )}

              <div className="flex gap-2">
                <button onClick={() => setShowPapForm(v => !v)}
                  className="flex items-center gap-2 bg-[#26619c] hover:bg-[#1a4f87] text-white py-2.5 px-4 rounded-xl text-sm font-semibold transition">
                  <Plus className="w-4 h-4" /> Registrar Lead
                </button>
                <button onClick={loadPap} className="flex items-center gap-2 border border-gray-300 text-gray-600 py-2.5 px-3 rounded-xl text-sm hover:bg-gray-50 transition">
                  <RefreshCw className="w-4 h-4" />
                </button>
              </div>

              {showPapForm && (
                <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 flex flex-col gap-3">
                  <p className="text-sm font-semibold text-gray-800">Novo Lead</p>
                  <input placeholder="Nome completo *" value={papForm.full_name} onChange={e => setPapForm(f => ({ ...f, full_name: e.target.value }))} className={inputCls} />
                  <div className="grid grid-cols-2 gap-2">
                    <input placeholder="Telefone" value={papForm.phone} onChange={e => setPapForm(f => ({ ...f, phone: e.target.value }))} className={inputCls} />
                    <input placeholder="CPF (opcional)" value={papForm.cpf} onChange={e => setPapForm(f => ({ ...f, cpf: e.target.value }))} className={inputCls} />
                  </div>
                  <input placeholder="Rua *" value={papForm.address_street} onChange={e => setPapForm(f => ({ ...f, address_street: e.target.value }))} className={inputCls} />
                  <div className="grid grid-cols-2 gap-2">
                    <input placeholder="Número *" value={papForm.address_number} onChange={e => setPapForm(f => ({ ...f, address_number: e.target.value }))} className={inputCls} />
                    <input placeholder="Complemento" value={papForm.address_complement} onChange={e => setPapForm(f => ({ ...f, address_complement: e.target.value }))} className={inputCls} />
                  </div>
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-medium text-gray-500">Dependentes (máx. 3)</p>
                      {papDeps.length < 3 && <button onClick={() => setPapDeps(d => [...d, { name: '', phone: '', cpf: '' }])} className="text-xs text-[#26619c] font-medium hover:underline flex items-center gap-1"><Plus className="w-3 h-3" /> Add</button>}
                    </div>
                    {papDeps.map((d, i) => (
                      <div key={i} className="bg-gray-50 rounded-lg p-2 flex flex-col gap-1.5 border border-gray-200">
                        <div className="flex items-center justify-between">
                          <p className="text-xs text-gray-500">Dep. {i + 1}</p>
                          <button onClick={() => setPapDeps(d => d.filter((_, idx) => idx !== i))} className="text-gray-400 hover:text-red-500"><X className="w-3.5 h-3.5" /></button>
                        </div>
                        <input placeholder="Nome *" value={d.name} onChange={e => setPapDeps(deps => deps.map((x, idx) => idx === i ? { ...x, name: e.target.value } : x))} className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-xs" />
                        <div className="grid grid-cols-2 gap-1">
                          <input placeholder="Telefone" value={d.phone} onChange={e => setPapDeps(deps => deps.map((x, idx) => idx === i ? { ...x, phone: e.target.value } : x))} className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-xs" />
                          <input placeholder="CPF" value={d.cpf} onChange={e => setPapDeps(deps => deps.map((x, idx) => idx === i ? { ...x, cpf: e.target.value } : x))} className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-xs" />
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-xs text-gray-500 mb-0.5 block">Pagamento</label>
                      <select value={papForm.payment_type} onChange={e => setPapForm(f => ({ ...f, payment_type: e.target.value }))} className={inputCls}>
                        <option value="avista">À vista</option>
                        <option value="parcelado">Parcelado</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-xs text-gray-500 mb-0.5 block">Mensalidade (R$)</label>
                      <input type="number" step="0.01" value={papForm.monthly_fee} onChange={e => setPapForm(f => ({ ...f, monthly_fee: e.target.value }))} className={inputCls} />
                    </div>
                  </div>
                  <input placeholder="Observações" value={papForm.notes} onChange={e => setPapForm(f => ({ ...f, notes: e.target.value }))} className={inputCls} />
                  <div>
                    <label className="text-xs text-gray-500 mb-0.5 block">Lançado por *</label>
                    <select value={papForm.lancado_por} onChange={e => setPapForm(f => ({ ...f, lancado_por: e.target.value, commissioned_to: e.target.value }))} className={inputCls}>
                      <option value="">— Selecionar responsável —</option>
                      {[...conferentes, ...operadores].filter((u, i, arr) => arr.findIndex(x => x.id === u.id) === i).map(u => (
                        <option key={u.id} value={u.id}>{u.full_name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => setShowPapForm(false)} className="flex-1 border border-gray-300 text-gray-600 py-2 rounded-xl text-sm">Cancelar</button>
                    <button onClick={handlePapSubmit} disabled={savingPap} className="flex-1 bg-[#26619c] text-white py-2 rounded-xl text-sm font-semibold disabled:opacity-50">{savingPap ? 'Salvando…' : 'Salvar'}</button>
                  </div>
                </div>
              )}

              <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-100">
                  <p className="text-sm font-semibold text-gray-800">Leads ({papLeads.filter((l: any) => l.status !== 'cancelled').length})</p>
                </div>
                {papLeads.length === 0 ? (
                  <p className="p-6 text-center text-xs text-gray-400">Nenhum lead registrado.</p>
                ) : (
                  <ul className="divide-y divide-gray-100">
                    {papLeads.filter((l: any) => l.status !== 'cancelled').map((lead: any) => (
                      <li key={lead.id} className="px-4 py-3 flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="text-sm font-medium text-gray-800">{lead.full_name}</p>
                            <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${lead.status === 'paid' ? 'bg-green-100 text-green-700' : lead.status === 'agreement' ? 'bg-purple-100 text-purple-700' : 'bg-amber-100 text-amber-700'}`}>
                              {lead.status === 'paid' ? 'Pago' : lead.status === 'agreement' ? 'Acordo' : 'Pendente'}
                            </span>
                          </div>
                          <p className="text-xs text-gray-400 mt-0.5">{lead.address_street}, {lead.address_number}{lead.address_complement ? ` – ${lead.address_complement}` : ''}</p>
                          {lead.phone && <p className="text-xs text-gray-400">{lead.phone}</p>}
                          {lead.dependents?.length > 0 && <p className="text-xs text-gray-400">{lead.dependents.length} dependente(s)</p>}
                          <p className="text-xs text-gray-400 mt-0.5">
                            Resp: <span className="font-medium text-gray-600">{lead.commissioned_to_name ?? lead.operator_name}</span> · {fmt(lead.monthly_fee)}
                          </p>
                        </div>
                        <div className="flex flex-col gap-1 shrink-0">
                          {lead.status === 'pending' && <>
                            <button onClick={() => handlePapPay(lead.id)} className="text-xs bg-green-600 text-white px-2.5 py-1 rounded-lg hover:bg-green-700">Confirmar</button>
                            <button onClick={() => { setShowAcordoModal(lead); setAcordoForm({ sinal: '', parcelas: '2', payment_method: '' }) }} className="text-xs bg-purple-600 text-white px-2.5 py-1 rounded-lg hover:bg-purple-700">Acordo</button>
                          </>}
                          {lead.status === 'agreement' && <button onClick={() => handlePapPay(lead.id)} className="text-xs bg-purple-600 text-white px-2.5 py-1 rounded-lg hover:bg-purple-700">Pagar parcela</button>}
                          <button onClick={() => handlePapCancel(lead.id)} className="text-xs border border-red-200 text-red-500 px-2.5 py-1 rounded-lg hover:bg-red-50">Cancelar</button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {tab === 'esteira' && (
        <div className="flex flex-col gap-4 pb-8">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-800">Esteira Financeira</h2>
            <button onClick={loadEsteira} disabled={esteiraLoading}
              className="flex items-center gap-1.5 text-xs text-[#26619c] border border-[#26619c]/30 px-3 py-1.5 rounded-lg hover:bg-[#26619c]/5 disabled:opacity-40">
              <RefreshCw size={12} className={esteiraLoading ? 'animate-spin' : ''} />
              Atualizar
            </button>
          </div>

          {esteiraLoading && <div className="text-center text-sm text-gray-400 py-10">Carregando…</div>}

          {!esteiraLoading && esteiraData && (() => {
            const loc = esteiraData.localizacao
            const fat = esteiraData.faturamento
            const pix = esteiraData.pix
            const bruto     = parseFloat(fat.bruto)
            const baixas    = parseFloat(fat.baixas)
            const liquido   = parseFloat(fat.liquido)
            const localizado = parseFloat(loc.total_localizado)
            const diferenca  = parseFloat(loc.diferenca)

            const locationRows = [
              { label: 'Em caixas abertos', sub: `${loc.em_abertos.sessoes} sessão(ões) com operador`, val: parseFloat(loc.em_abertos.total), color: 'text-blue-700', dot: 'bg-blue-400' },
              { label: 'No malote (aguardando conferência)', sub: `${loc.no_malote.sessoes} sessão(ões) fechada(s)`, val: parseFloat(loc.no_malote.total), color: 'text-amber-700', dot: 'bg-amber-400' },
              { label: 'Conferido, a repassar', sub: `${loc.a_repassar.sessoes} sessão(ões) — já descontado o repassado`, val: parseFloat(loc.a_repassar.total), color: 'text-orange-700', dot: 'bg-orange-400' },
              { label: 'Nas caixinhas', sub: loc.nas_caixinhas.boxes.map((b: any) => `${b.name}: ${fmt(parseFloat(b.saldo))}`).join(' · ') || '—', val: parseFloat(loc.nas_caixinhas.total), color: 'text-green-700', dot: 'bg-green-500' },
            ]

            return (
              <>
                {/* Bloco 1: Faturamento */}
                <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                  <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
                    <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Faturamento (base: transações registradas)</p>
                  </div>
                  <div className="p-4 flex flex-col gap-2">
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-gray-600">Total bruto faturado</span>
                      <span className="text-sm font-bold text-gray-900">{fmt(bruto)}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-gray-600">(−) Baixas e saídas</span>
                      <span className="text-sm font-semibold text-red-600">−{fmt(baixas)}</span>
                    </div>
                    <div className="flex justify-between items-center border-t border-gray-200 pt-2 mt-1">
                      <span className="text-sm font-bold text-gray-800">= Líquido total</span>
                      <span className="text-base font-black text-[#26619c]">{fmt(liquido)}</span>
                    </div>
                    <p className="text-[10px] text-gray-400 mt-1">Esse valor deve estar distribuído nos locais abaixo ± quebras de caixa.</p>
                  </div>
                </div>

                {/* Bloco 2: Onde está o dinheiro agora */}
                <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                  <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
                    <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Localização atual do dinheiro (base: contagem física)</p>
                  </div>
                  <div className="divide-y divide-gray-100">
                    {locationRows.map(r => (
                      <div key={r.label} className="px-4 py-3 flex items-center justify-between gap-3">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className={`w-2 h-2 rounded-full shrink-0 ${r.dot}`} />
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-gray-800">{r.label}</p>
                            <p className="text-xs text-gray-400 truncate">{r.sub}</p>
                          </div>
                        </div>
                        <span className={`text-sm font-bold shrink-0 ${r.val > 0 ? r.color : 'text-gray-300'}`}>{fmt(r.val)}</span>
                      </div>
                    ))}
                  </div>
                  <div className="px-4 py-3 bg-gray-50 border-t border-gray-200 flex items-center justify-between">
                    <span className="text-sm font-semibold text-gray-700">Total localizado</span>
                    <span className="text-base font-black text-gray-900">{fmt(localizado)}</span>
                  </div>
                </div>

                {/* Bloco 3: Reconciliação */}
                <div className={`rounded-xl border px-4 py-3 ${Math.abs(diferenca) < 0.01 ? 'bg-green-50 border-green-300' : diferenca > 0 ? 'bg-red-50 border-red-300' : 'bg-amber-50 border-amber-300'}`}>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-semibold text-gray-800">
                        {Math.abs(diferenca) < 0.01 ? '✅ Caixa equilibrado' : diferenca > 0 ? '⚠️ Quebra de caixa (faltou dinheiro)' : '⚠️ Sobra física (mais físico que lançado)'}
                      </p>
                      <p className="text-xs text-gray-600 mt-0.5">
                        Líquido registrado ({fmt(liquido)}) − Localizado fisicamente ({fmt(localizado)}) = {fmt(diferenca)}
                      </p>
                      <p className="text-[10px] text-gray-400 mt-1">
                        {diferenca > 0.01
                          ? 'O sistema registrou mais do que foi contado fisicamente. Verifique quebras de caixa nas sessões.'
                          : diferenca < -0.01
                            ? 'Há mais dinheiro físico do que o registrado. Pode ser troco do fundo de caixa ou lançamentos pendentes.'
                            : 'Os valores coincidem.'}
                      </p>
                    </div>
                    <span className={`text-lg font-black shrink-0 ${diferenca > 0.01 ? 'text-red-600' : diferenca < -0.01 ? 'text-amber-600' : 'text-green-600'}`}>
                      {diferenca > 0 ? '+' : ''}{fmt(diferenca)}
                    </span>
                  </div>
                </div>

                {/* Bloco 4: PIX bancário (informação separada) */}
                <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                  <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
                    <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">PIX — Confirmação bancária</p>
                    <p className="text-[10px] text-gray-400 mt-0.5">O PIX já está contabilizado na localização acima. Isso é apenas o status de confirmação no banco.</p>
                  </div>
                  <div className="grid grid-cols-2 divide-x divide-gray-100">
                    <div className="p-4 text-center">
                      <p className="text-xs text-gray-500 mb-1">Pendente no banco</p>
                      <p className="text-base font-bold text-orange-600">{fmt(parseFloat(pix.pendente.total))}</p>
                      <p className="text-[10px] text-gray-400">{pix.pendente.count} lançamento(s)</p>
                    </div>
                    <div className="p-4 text-center">
                      <p className="text-xs text-gray-500 mb-1">Confirmado no banco</p>
                      <p className="text-base font-bold text-green-600">{fmt(parseFloat(pix.conciliado.total))}</p>
                      <p className="text-[10px] text-gray-400">{pix.conciliado.count} lançamento(s)</p>
                    </div>
                  </div>
                </div>
              </>
            )
          })()}
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
                <label className="block text-xs text-gray-500 mb-1">Operado por</label>
                <select value={manualOperatedBy} onChange={e => setManualOperatedBy(e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white">
                  <option value="">Selecionar operador…</option>
                  {operadores.map(c => <option key={c.id} value={c.id}>{c.full_name}</option>)}
                </select>
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
