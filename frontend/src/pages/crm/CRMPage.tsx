import { useEffect, useState } from 'react'
import {
  Search, X, Users, MessageCircle, MapPin,
  Pencil, CalendarPlus, UserCheck, Upload,
  ChevronLeft, ChevronRight, Plus, AlertCircle,
  CreditCard, TrendingDown, CheckCircle, DollarSign,
  Trophy, TrendingUp, XCircle
} from 'lucide-react'
import api from '../../services/api'
import { uploadService } from '../../services/upload'
import toast from 'react-hot-toast'
import { useAuthStore } from '../../store/authStore'

// ── Agentes types ─────────────────────────────────────────────────────────────
interface AgentRank {
  agent_id: string; agent_name: string
  cobrancas: number; novos: number; position: number; prize: number
}
interface BonusInfo {
  liberado: boolean; novos_ok: boolean
  adimplencia_pct: number; adimplencia_ok: boolean
  agentes_com_5_novos: number; total_agentes: number
}
const MEDAL = ['1', '2', '3']
const fmtCurrency = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
function monthLabel(y: number, m: number) {
  return new Date(y, m - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface CRMMember {
  id: string
  full_name: string
  address: string
  created_at: string | null
  phone_primary: string | null
  valor_atrasado: number
  qtd_pendentes: number
  ultima_entrega: string | null
  enc_mes: number
  situacao: 'adimplente' | 'inadimplente'
}

interface Mensalidade {
  id?: string
  resident_id: string
  reference_month: string
  due_date?: string
  paid_at?: string
  amount: string
  status: string
  origem?: string
  resident_name?: string
  address_street?: string
  address_number?: string
  phone_primary?: string
  months_overdue?: number
}

interface PaidItem {
  id: string
  resident_id: string
  resident_name: string
  reference_month: string
  amount: string
  paid_at?: string
}

interface PaymentMethod { id: string; name: string }
interface Resident { id: string; full_name: string; cpf?: string }

// ── Helpers ───────────────────────────────────────────────────────────────────

const inputCls = 'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#26619c]/40 focus:border-[#26619c]'

const fmt = (v: string | number) =>
  `R$ ${parseFloat(String(v)).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const fmtDate = (iso: string) => {
  const d = new Date(iso)
  return isNaN(d.getTime()) ? iso : d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
}

const fmtDateOnly = (iso: string) => {
  const d = new Date(iso + 'T12:00:00')
  return isNaN(d.getTime()) ? iso : d.toLocaleDateString('pt-BR')
}

function tenureLabel(created_at: string | null): string {
  if (!created_at) return '—'
  const diff = Date.now() - new Date(created_at).getTime()
  const days = Math.floor(diff / 86400000)
  const months = Math.floor(days / 30)
  const years = Math.floor(months / 12)
  if (years > 0) return `${years}a ${months % 12}m`
  if (months > 0) return `${months}m`
  return `${days}d`
}

function daysAgo(iso: string | null): string {
  if (!iso) return '—'
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)
  if (days === 0) return 'hoje'
  if (days === 1) return '1 dia'
  return `${days} dias`
}

// ── Component ─────────────────────────────────────────────────────────────────

type Tab = 'associados' | 'pendentes' | 'inadimplentes' | 'pagos' | 'agentes'

export default function CRMPage() {
  const role = useAuthStore(s => s.role)
  const isAgente = role === 'agente'
  const isAdmin = ['admin', 'admin_master', 'superadmin', 'diretoria'].includes(role ?? '')

  const [tab, setTab] = useState<Tab>('associados')
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([])

  useEffect(() => {
    api.get<PaymentMethod[]>('/finance/payment-methods').then(r => setPaymentMethods(r.data)).catch(() => {})
  }, [])

  // ── Associados ────────────────────────────────────────────────────────────
  const [members, setMembers] = useState<CRMMember[]>([])
  const [totalMembers, setTotalMembers] = useState(0)
  const [membersPage, setMembersPage] = useState(1)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'todos' | 'adimplente' | 'inadimplente'>('todos')
  const [loadingMembers, setLoadingMembers] = useState(false)

  const loadMembers = async (p = membersPage, q = search, sf = statusFilter) => {
    setLoadingMembers(true)
    try {
      const res = await api.get<{ items: CRMMember[]; total: number }>('/crm/residents', {
        params: { page: p, search: q || undefined, status: sf === 'todos' ? undefined : sf },
      })
      setMembers(res.data.items)
      setTotalMembers(res.data.total)
    } catch { toast.error('Erro ao carregar associados.') }
    finally { setLoadingMembers(false) }
  }

  useEffect(() => { loadMembers() }, [])
  useEffect(() => {
    const t = setTimeout(() => { setMembersPage(1); loadMembers(1, search, statusFilter) }, 400)
    return () => clearTimeout(t)
  }, [search, statusFilter])

  // ── KPI calculations ──────────────────────────────────────────────────────
  const kpiAdimplentes = members.filter(m => m.situacao === 'adimplente').length
  const kpiInadimplentes = members.filter(m => m.situacao === 'inadimplente').length
  const kpiValorAberto = members.reduce((s, m) => s + (m.valor_atrasado || 0), 0)

  // ── Cobranças state ───────────────────────────────────────────────────────
  const [pendingList, setPendingList] = useState<Mensalidade[]>([])
  const [delinquent, setDelinquent] = useState<Mensalidade[]>([])
  const [cobrancasSearch, setCobrancasSearch] = useState('')
  const [loadingCobrancas, setLoadingCobrancas] = useState(false)

  const [paidItems, setPaidItems] = useState<PaidItem[]>([])
  const [paidMonth, setPaidMonth] = useState(() => new Date().toISOString().slice(0, 7))
  const [loadingPaid, setLoadingPaid] = useState(false)

  // create / generate forms
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [showGenMonth, setShowGenMonth] = useState(false)
  const [showDeleteMonth, setShowDeleteMonth] = useState(false)
  const [genMonthForm, setGenMonthForm] = useState({ reference_month: new Date().toISOString().slice(0, 7), due_day: '10', amount: '' })
  const [generatingMonth, setGeneratingMonth] = useState(false)
  const [createForm, setCreateForm] = useState({ reference_month: '', due_date: '', amount: '', notes: '' })
  const [selectedResident, setSelectedResident] = useState<Resident | null>(null)
  const [residentSearch, setResidentSearch] = useState('')
  const [residentResults, setResidentResults] = useState<Resident[]>([])
  const [deleteMonthVal, setDeleteMonthVal] = useState(() => new Date().toISOString().slice(0, 7))
  const [deletingMonth, setDeletingMonth] = useState(false)

  // due date editing
  const [editDueDateId, setEditDueDateId] = useState<string | null>(null)
  const [editDueDateVal, setEditDueDateVal] = useState('')
  const [savingDueDate, setSavingDueDate] = useState(false)
  const [showChangeDueDay, setShowChangeDueDay] = useState(false)
  const [newDueDay, setNewDueDay] = useState('')
  const [savingDueDay, setSavingDueDay] = useState(false)
  const [advanceLoading, setAdvanceLoading] = useState(false)

  // member pending list (multi-mensalidade)
  const [memberPendingList, setMemberPendingList] = useState<{ member: CRMMember; items: Mensalidade[] } | null>(null)

  // profile modal
  const [profileModal, setProfileModal] = useState<CRMMember | null>(null)
  const [profileHistory, setProfileHistory] = useState<Mensalidade[]>([])
  const [profileVisits, setProfileVisits] = useState<any[]>([])
  const [profileLoading, setProfileLoading] = useState(false)

  const loadCobrancas = async () => {
    setLoadingCobrancas(true)
    try {
      const [p, d] = await Promise.all([
        api.get<Mensalidade[]>('/mensalidades/pending'),
        api.get<Mensalidade[]>('/mensalidades/delinquent'),
      ])
      setPendingList(p.data)
      setDelinquent(d.data)
    } catch { } finally { setLoadingCobrancas(false) }
  }

  const loadPaid = async (month: string) => {
    setLoadingPaid(true)
    try {
      const res = await api.get<PaidItem[]>('/mensalidades/paid', { params: { month } })
      setPaidItems(res.data)
    } catch { setPaidItems([]) } finally { setLoadingPaid(false) }
  }

  useEffect(() => {
    if (tab === 'pendentes' || tab === 'inadimplentes') loadCobrancas()
    if (tab === 'pagos') loadPaid(paidMonth)
  }, [tab])

  const searchForCreate = async (q: string) => {
    if (q.length < 2) { setResidentResults([]); return }
    try {
      const res = await api.get<Resident[]>('/residents/search', { params: { q } })
      setResidentResults(res.data.slice(0, 6))
    } catch { }
  }

  // ── Payment modal (remote) ─────────────────────────────────────────────────
  const [payTarget, setPayTarget] = useState<{ id: string; name: string; amount: number } | null>(null)
  const [payPmId, setPayPmId] = useState('')
  const [proofUrl, setProofUrl] = useState('')
  const [uploadingProof, setUploadingProof] = useState(false)
  const [paying, setPaying] = useState(false)
  const [payingId, setPayingId] = useState<string | null>(null)

  const openPay = (id: string, name: string, amount: number) => {
    setPayTarget({ id, name, amount })
    setPayPmId(paymentMethods[0]?.id ?? '')
    setProofUrl('')
  }

  const selectedPmName = paymentMethods.find(p => p.id === payPmId)?.name ?? ''
  const isPix = selectedPmName.toLowerCase().includes('pix')

  const handleUploadProof = async (file: File) => {
    setUploadingProof(true)
    try {
      const url = await uploadService.uploadFile(file, 'crm-proof')
      setProofUrl(url)
      toast.success('Comprovante enviado.')
    } catch { toast.error('Erro no upload.') }
    finally { setUploadingProof(false) }
  }

  const confirmPay = async () => {
    if (!payTarget) return
    if (isPix && !proofUrl) { toast.error('Comprovante PIX obrigatório.'); return }
    setPaying(true)
    setPayingId(payTarget.id)
    try {
      await api.post(`/crm/mensalidades/${payTarget.id}/pay`, {
        mensalidade_id: payTarget.id,
        payment_method_id: payPmId || undefined,
        payment_proof_url: proofUrl || undefined,
      })
      toast.success('Mensalidade paga!')
      setPayTarget(null)
      if (profileModal) {
        openProfile(profileModal)
      } else {
        loadCobrancas()
        loadMembers()
      }
    } catch (e: any) {
      toast.error(e.response?.data?.detail ?? 'Erro ao pagar.')
    } finally { setPaying(false); setPayingId(null) }
  }

  // ── Open pay for member (multiple pending) ─────────────────────────────────
  const openPayForMember = async (m: CRMMember) => {
    try {
      const res = await api.get<Mensalidade[]>(`/mensalidades/residents/${m.id}`)
      const pending = res.data.filter(x => x.status !== 'paid' && x.id)
      if (pending.length === 0) { toast.error('Nenhuma mensalidade pendente.'); return }
      if (pending.length === 1) {
        openPay(pending[0].id!, m.full_name, parseFloat(pending[0].amount))
      } else {
        setMemberPendingList({ member: m, items: pending })
      }
    } catch { toast.error('Erro ao carregar mensalidades.') }
  }

  // ── Profile modal ──────────────────────────────────────────────────────────
  const openProfile = async (member: CRMMember) => {
    setProfileModal(member)
    setProfileHistory([])
    setProfileVisits([])
    setProfileLoading(true)
    try {
      const [hist, visits] = await Promise.all([
        api.get<Mensalidade[]>(`/mensalidades/residents/${member.id}`),
        api.get('/crm/visitas', { params: { resident_id: member.id } }),
      ])
      setProfileHistory(hist.data)
      setProfileVisits(visits.data.visits ?? [])
    } catch { toast.error('Erro ao carregar dados.') }
    finally { setProfileLoading(false) }
  }

  const handleAdvancePaymentProfile = async () => {
    if (!profileModal) return
    setAdvanceLoading(true)
    try {
      const res = await api.post('/mensalidades/advance', { resident_id: profileModal.id })
      toast.success(`Mensalidade ${res.data.reference_month} criada.`)
      await openProfile(profileModal)
      openPay(res.data.id, profileModal.full_name, parseFloat(res.data.amount))
    } catch (e: any) { toast.error(e.response?.data?.detail ?? 'Erro.') }
    finally { setAdvanceLoading(false) }
  }

  const handleChangeDueDayProfile = async () => {
    const day = parseInt(newDueDay)
    if (!profileModal || !day || day < 1 || day > 31) return
    setSavingDueDay(true)
    try {
      await api.put(`/residents/${profileModal.id}`, { monthly_payment_day: day })
      const pending = profileHistory.filter(m => m.status !== 'paid' && m.id && m.due_date)
      await Promise.all(pending.map(m => {
        const [yr, mo] = m.due_date!.split('-').map(Number)
        const lastDay = new Date(yr, mo, 0).getDate()
        const d = String(Math.min(day, lastDay)).padStart(2, '0')
        return api.patch(`/mensalidades/${m.id}/due-date`, { due_date: `${yr}-${String(mo).padStart(2,'0')}-${d}`, update_resident_day: false }).catch(() => null)
      }))
      toast.success(`Dia de vencimento alterado para dia ${day}.`)
      setShowChangeDueDay(false)
      setNewDueDay('')
      openProfile(profileModal)
    } catch (e: any) { toast.error(e.response?.data?.detail ?? 'Erro.') }
    finally { setSavingDueDay(false) }
  }

  // ── Visit modal ────────────────────────────────────────────────────────────
  const [visitModal, setVisitModal] = useState<{ memberId: string; memberName: string } | null>(null)
  const [visitResult, setVisitResult] = useState<'paid' | 'will_pay' | 'absent' | 'refused'>('absent')
  const [visitNotes, setVisitNotes] = useState('')
  const [savingVisit, setSavingVisit] = useState(false)

  const confirmVisit = async () => {
    if (!visitModal) return
    setSavingVisit(true)
    try {
      await api.post('/crm/visitas', { resident_id: visitModal.memberId, result: visitResult, notes: visitNotes || undefined })
      toast.success('Visita registrada!')
      setVisitModal(null)
      setVisitNotes('')
      setVisitResult('absent')
    } catch (e: any) {
      toast.error(e.response?.data?.detail ?? 'Erro ao registrar visita.')
    } finally { setSavingVisit(false) }
  }

  // ── Cobranças actions ──────────────────────────────────────────────────────
  const handleCreateMensalidade = async () => {
    if (!selectedResident || !createForm.reference_month || !createForm.due_date || !createForm.amount) {
      toast.error('Preencha todos os campos.')
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
      setCreateForm({ reference_month: '', due_date: '', amount: '', notes: '' })
      setSelectedResident(null)
      setResidentSearch('')
      loadCobrancas()
    } catch (e: any) { toast.error(e.response?.data?.detail ?? 'Erro.') }
  }

  const handleGenerateMonth = async () => {
    if (!genMonthForm.reference_month || !genMonthForm.amount) { toast.error('Preencha mês e valor.'); return }
    setGeneratingMonth(true)
    try {
      const res = await api.post('/mensalidades/generate-month', {
        reference_month: genMonthForm.reference_month,
        due_day: parseInt(genMonthForm.due_day) || 10,
        amount: parseFloat(genMonthForm.amount),
      })
      toast.success(`${res.data.created} mensalidade(s) gerada(s).`)
      setShowGenMonth(false)
      loadCobrancas()
    } catch (e: any) { toast.error(e.response?.data?.detail ?? 'Erro.') }
    finally { setGeneratingMonth(false) }
  }

  const handleDeleteMonth = async () => {
    if (!deleteMonthVal) return
    if (!window.confirm(`Excluir cobranças PENDENTES de ${deleteMonthVal}?`)) return
    setDeletingMonth(true)
    try {
      const res = await api.delete(`/mensalidades/by-month/${deleteMonthVal}`)
      toast.success(`${res.data.deleted} cobrança(s) excluída(s).`)
      setShowDeleteMonth(false)
      loadCobrancas()
    } catch (e: any) { toast.error(e.response?.data?.detail ?? 'Erro.') }
    finally { setDeletingMonth(false) }
  }

  const handleSaveDueDate = async (mensalidadeId: string, updateResident: boolean) => {
    if (!editDueDateVal) return
    setSavingDueDate(true)
    try {
      await api.patch(`/mensalidades/${mensalidadeId}/due-date`, { due_date: editDueDateVal, update_resident_day: updateResident })
      toast.success(updateResident ? 'Vencimento e dia padrão atualizados.' : 'Vencimento atualizado.')
      setEditDueDateId(null)
      if (profileModal) openProfile(profileModal)
      loadCobrancas()
    } catch (e: any) { toast.error(e.response?.data?.detail ?? 'Erro.') }
    finally { setSavingDueDate(false) }
  }

  // ── Agentes state ─────────────────────────────────────────────────────────
  const now = new Date()
  const [agYear, setAgYear] = useState(now.getFullYear())
  const [agMonth, setAgMonth] = useState(now.getMonth() + 1)
  const [agRanking, setAgRanking] = useState<AgentRank[]>([])
  const [agBonus, setAgBonus] = useState<BonusInfo | null>(null)
  const [agLoading, setAgLoading] = useState(false)

  const fetchRanking = async (y = agYear, m = agMonth) => {
    setAgLoading(true)
    try {
      const res = await api.get('/crm/agentes/ranking', { params: { year: y, month: m } })
      setAgRanking(isAgente
        ? res.data.ranking.filter((a: AgentRank) => a.agent_id === useAuthStore.getState().userId)
        : res.data.ranking
      )
      setAgBonus(res.data.bonus)
    } catch { toast.error('Erro ao carregar ranking.') }
    finally { setAgLoading(false) }
  }

  useEffect(() => { if (tab === 'agentes') fetchRanking(agYear, agMonth) }, [tab, agYear, agMonth])

  const agPrevMonth = () => {
    if (agMonth === 1) { setAgYear(y => y - 1); setAgMonth(12) }
    else setAgMonth(m => m - 1)
  }
  const agNextMonth = () => {
    const cur = new Date()
    if (agYear === cur.getFullYear() && agMonth === cur.getMonth() + 1) return
    if (agMonth === 12) { setAgYear(y => y + 1); setAgMonth(1) }
    else setAgMonth(m => m + 1)
  }

  // ── Helpers ───────────────────────────────────────────────────────────────
  const filterCobrancas = <T extends Mensalidade>(list: T[]) => {
    if (!cobrancasSearch) return list
    const q = cobrancasSearch.toLowerCase()
    return list.filter(m =>
      (m.resident_name ?? '').toLowerCase().includes(q) ||
      (m.address_street ?? '').toLowerCase().includes(q)
    )
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  const TABS = [
    { key: 'associados' as Tab, label: 'Associados' },
    { key: 'pendentes' as Tab, label: 'A Receber' },
    { key: 'inadimplentes' as Tab, label: 'Inadimplentes' },
    { key: 'pagos' as Tab, label: 'Pagos' },
    { key: 'agentes' as Tab, label: 'Agentes' },
  ]

  return (
    <div className="flex flex-col gap-4 pb-10">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <UserCheck className="w-5 h-5 text-[#26619c]" />
          <h1 className="text-lg font-bold text-gray-800">CRM — Associados</h1>
        </div>
        {isAdmin && (
          <div className="flex gap-2 flex-wrap">
            <button onClick={() => { setTab('pendentes'); setTimeout(() => { setShowGenMonth(v => !v); setShowCreateForm(false); setShowDeleteMonth(false) }, 0) }}
              className="flex items-center gap-1 border border-green-300 text-green-700 bg-green-50 hover:bg-green-100 px-3 py-1.5 rounded-lg text-xs font-medium">
              <Plus className="w-3.5 h-3.5" /> Gerar Mês
            </button>
            <button onClick={() => { setTab('pendentes'); setTimeout(() => { setShowCreateForm(v => !v); setShowGenMonth(false); setShowDeleteMonth(false) }, 0) }}
              className="flex items-center gap-1 border border-[#26619c]/30 text-[#26619c] bg-blue-50 hover:bg-blue-100 px-3 py-1.5 rounded-lg text-xs font-medium">
              <Plus className="w-3.5 h-3.5" /> Nova
            </button>
            <button onClick={() => { setTab('pendentes'); setTimeout(() => { setShowDeleteMonth(v => !v); setShowCreateForm(false); setShowGenMonth(false) }, 0) }}
              className="flex items-center gap-1 border border-red-200 text-red-600 bg-red-50 hover:bg-red-100 px-3 py-1.5 rounded-lg text-xs font-medium">
              <X className="w-3.5 h-3.5" /> Excluir Mês
            </button>
          </div>
        )}
      </div>

      {/* Tab navigation */}
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1 flex-wrap">
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`flex-1 py-2 rounded-lg text-xs font-medium transition min-w-[60px] ${
              tab === t.key ? 'bg-white text-[#26619c] shadow-sm' : 'text-gray-500'
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* === ABA ASSOCIADOS === */}
      {tab === 'associados' && (
        <>
          {/* KPI Cards */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="bg-white border border-gray-200 rounded-xl p-4 flex flex-col gap-1 shadow-sm">
              <div className="flex items-center gap-2 text-gray-400">
                <Users className="w-4 h-4" />
                <span className="text-xs">Total</span>
              </div>
              <p className="text-2xl font-bold text-gray-800">{totalMembers}</p>
              <p className="text-xs text-gray-400">associados ativos</p>
            </div>
            <div className="bg-white border border-gray-200 rounded-xl p-4 flex flex-col gap-1 shadow-sm">
              <div className="flex items-center gap-2 text-green-500">
                <CheckCircle className="w-4 h-4" />
                <span className="text-xs">Adimplentes</span>
              </div>
              <p className="text-2xl font-bold text-green-600">{kpiAdimplentes}</p>
              <p className="text-xs text-gray-400">nesta página</p>
            </div>
            <div className="bg-white border border-gray-200 rounded-xl p-4 flex flex-col gap-1 shadow-sm">
              <div className="flex items-center gap-2 text-red-500">
                <TrendingDown className="w-4 h-4" />
                <span className="text-xs">Inadimplentes</span>
              </div>
              <p className="text-2xl font-bold text-red-600">{kpiInadimplentes}</p>
              <p className="text-xs text-gray-400">nesta página</p>
            </div>
            <div className="bg-white border border-gray-200 rounded-xl p-4 flex flex-col gap-1 shadow-sm">
              <div className="flex items-center gap-2 text-amber-500">
                <DollarSign className="w-4 h-4" />
                <span className="text-xs">Valor em Aberto</span>
              </div>
              <p className="text-lg font-bold text-amber-600">{fmt(kpiValorAberto)}</p>
              <p className="text-xs text-gray-400">nesta página</p>
            </div>
          </div>

          {/* Filtros */}
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
              <input type="text" placeholder="Nome ou rua…" value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-full pl-8 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#26619c]/30" />
            </div>
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as any)}
              className="border border-gray-200 rounded-lg px-2 py-2 text-sm text-gray-700 focus:outline-none">
              <option value="todos">Todos</option>
              <option value="adimplente">Adimplentes</option>
              <option value="inadimplente">Inadimplentes</option>
            </select>
          </div>

          {/* Tabela */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-x-auto">
            {!loadingMembers && members.length === 0 ? (
              <div className="p-6 text-center text-gray-400 text-sm">Nenhum associado encontrado.</div>
            ) : (
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="bg-gray-50 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    <th className="px-4 py-3 whitespace-nowrap">Nome</th>
                    <th className="px-4 py-3 whitespace-nowrap">Endereço</th>
                    <th className="px-4 py-3 whitespace-nowrap">Assoc.</th>
                    <th className="px-4 py-3 whitespace-nowrap">Status</th>
                    <th className="px-4 py-3 whitespace-nowrap text-right">Atrasado</th>
                    <th className="px-4 py-3 whitespace-nowrap text-center">Meses</th>
                    <th className="px-4 py-3 whitespace-nowrap text-center">Última Enc.</th>
                    <th className="px-4 py-3 whitespace-nowrap text-center">Enc/Mês</th>
                    <th className="px-4 py-3 whitespace-nowrap text-center">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {members.map(m => (
                    <tr key={m.id} className="hover:bg-gray-50 transition-colors cursor-pointer" onClick={() => openProfile(m)}>
                      <td className="px-4 py-2.5 font-medium text-[#26619c] whitespace-nowrap hover:underline">{m.full_name}</td>
                      <td className="px-4 py-2.5 text-gray-500 whitespace-nowrap max-w-[180px] truncate">{m.address || '—'}</td>
                      <td className="px-4 py-2.5 text-gray-500 whitespace-nowrap">{tenureLabel(m.created_at)}</td>
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        <span className={`inline-block text-xs px-2 py-0.5 rounded-full font-medium ${
                          m.situacao === 'adimplente' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'
                        }`}>
                          {m.situacao === 'adimplente' ? 'Adimplente' : 'Inadimplente'}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right whitespace-nowrap">
                        {m.valor_atrasado > 0
                          ? <span className="text-red-600 font-medium">{fmt(m.valor_atrasado)}</span>
                          : <span className="text-gray-300">—</span>}
                      </td>
                      <td className="px-4 py-2.5 text-center whitespace-nowrap">
                        {m.qtd_pendentes > 0
                          ? <span className="text-red-500 font-medium">{m.qtd_pendentes}</span>
                          : <span className="text-gray-300">—</span>}
                      </td>
                      <td className="px-4 py-2.5 text-center text-gray-500 whitespace-nowrap">{daysAgo(m.ultima_entrega)}</td>
                      <td className="px-4 py-2.5 text-center text-gray-500 whitespace-nowrap">
                        {m.enc_mes > 0 ? m.enc_mes.toFixed(1) : '—'}
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center gap-2 justify-center">
                          {m.phone_primary && (
                            <a
                              href={`https://wa.me/55${m.phone_primary.replace(/\D/g, '')}`}
                              target="_blank"
                              rel="noreferrer"
                              className="p-1 text-green-500 hover:text-green-700 rounded"
                              title="WhatsApp">
                              <MessageCircle className="w-4 h-4" />
                            </a>
                          )}
                          {!isAgente && m.qtd_pendentes > 0 && (
                            <button
                              onClick={() => openPayForMember(m)}
                              className="text-xs bg-green-600 hover:bg-green-700 text-white px-2 py-1 rounded-lg">
                              Pagar
                            </button>
                          )}
                          <button
                            onClick={() => { setVisitModal({ memberId: m.id, memberName: m.full_name }); setVisitResult('absent'); setVisitNotes('') }}
                            className="p-1 text-gray-400 hover:text-gray-600 rounded"
                            title="Registrar visita">
                            <MapPin className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {/* Paginação */}
            {totalMembers > 100 && (
              <div className="px-4 py-2 border-t border-gray-100 flex items-center justify-between">
                <button disabled={membersPage === 1}
                  onClick={() => { const p = membersPage - 1; setMembersPage(p); loadMembers(p) }}
                  className="flex items-center gap-1 text-xs text-gray-500 disabled:opacity-40">
                  <ChevronLeft className="w-3.5 h-3.5" /> Anterior
                </button>
                <span className="text-xs text-gray-400">Pág. {membersPage} · {totalMembers} associados</span>
                <button disabled={membersPage * 100 >= totalMembers}
                  onClick={() => { const p = membersPage + 1; setMembersPage(p); loadMembers(p) }}
                  className="flex items-center gap-1 text-xs text-gray-500 disabled:opacity-40">
                  Próxima <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </div>
        </>
      )}

      {/* === ADMIN ACTIONS (gerar mês etc) — só nas tabs de cobrança === */}
      {isAdmin && (tab === 'pendentes' || tab === 'inadimplentes') && (
        <>
          <div className="flex gap-2 flex-wrap">
            <button onClick={() => { setShowCreateForm(!showCreateForm); setShowGenMonth(false); setShowDeleteMonth(false) }}
              className="flex-1 flex items-center justify-center gap-1 border-2 border-dashed border-[#26619c]/40 rounded-xl py-2 text-sm text-[#26619c] hover:bg-blue-50 transition min-w-[90px]">
              <Plus className="w-4 h-4" /> Nova
            </button>
            <button onClick={() => { setShowGenMonth(!showGenMonth); setShowCreateForm(false); setShowDeleteMonth(false) }}
              className="flex-1 flex items-center justify-center gap-1 border-2 border-dashed border-green-400/60 rounded-xl py-2 text-sm text-green-700 hover:bg-green-50 transition min-w-[90px]">
              <Plus className="w-4 h-4" /> Gerar Mês
            </button>
            <button onClick={() => { setShowDeleteMonth(!showDeleteMonth); setShowCreateForm(false); setShowGenMonth(false) }}
              className="flex-1 flex items-center justify-center gap-1 border-2 border-dashed border-red-300/60 rounded-xl py-2 text-sm text-red-600 hover:bg-red-50 transition min-w-[90px]">
              <X className="w-4 h-4" /> Excluir Mês
            </button>
          </div>

          {showDeleteMonth && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex flex-col gap-3">
              <p className="text-sm font-semibold text-red-700">Excluir cobranças pendentes do mês</p>
              <p className="text-xs text-red-600">Apenas cobranças <strong>pendentes</strong> serão excluídas.</p>
              <div className="flex gap-2">
                <input type="month" value={deleteMonthVal} onChange={e => setDeleteMonthVal(e.target.value)} className={`${inputCls} flex-1`} />
                <button onClick={handleDeleteMonth} disabled={deletingMonth}
                  className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-xl text-sm font-semibold disabled:opacity-50">
                  {deletingMonth ? '…' : 'Excluir'}
                </button>
              </div>
            </div>
          )}

          {showGenMonth && (
            <div className="bg-white border border-gray-200 rounded-xl p-4 flex flex-col gap-3 shadow-sm">
              <p className="text-sm font-semibold text-gray-800">Gerar Mensalidades do Mês</p>
              <p className="text-xs text-gray-500">Cria mensalidades para todos os associados ativos sem registro no mês.</p>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block text-xs text-gray-600 mb-1">Mês *</label>
                  <input type="month" value={genMonthForm.reference_month}
                    onChange={e => setGenMonthForm(f => ({ ...f, reference_month: e.target.value }))} className={inputCls} />
                </div>
                <div>
                  <label className="block text-xs text-gray-600 mb-1">Dia padrão</label>
                  <input type="number" min="1" max="31" value={genMonthForm.due_day}
                    onChange={e => setGenMonthForm(f => ({ ...f, due_day: e.target.value }))} className={inputCls} placeholder="10" />
                </div>
                <div>
                  <label className="block text-xs text-gray-600 mb-1">Valor R$ *</label>
                  <input type="number" min="0" step="0.01" value={genMonthForm.amount}
                    onChange={e => setGenMonthForm(f => ({ ...f, amount: e.target.value }))} className={inputCls} placeholder="0.00" />
                </div>
              </div>
              <button onClick={handleGenerateMonth} disabled={generatingMonth}
                className="bg-green-600 hover:bg-green-700 text-white py-2 rounded-xl text-sm font-semibold disabled:opacity-50">
                {generatingMonth ? 'Gerando…' : 'Gerar Mensalidades'}
              </button>
            </div>
          )}

          {showCreateForm && (
            <div className="bg-white border border-gray-200 rounded-xl p-4 flex flex-col gap-3 shadow-sm">
              <p className="text-sm font-semibold text-gray-800">Nova Mensalidade</p>
              <div>
                <label className="block text-xs text-gray-600 mb-1">Morador *</label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input value={residentSearch}
                    onChange={e => { setResidentSearch(e.target.value); searchForCreate(e.target.value) }}
                    className={`${inputCls} pl-9`} placeholder="Buscar…" />
                </div>
                {residentResults.length > 0 && !selectedResident && (
                  <ul className="border border-gray-200 rounded-lg mt-1 divide-y divide-gray-100 max-h-36 overflow-y-auto">
                    {residentResults.map(r => (
                      <li key={r.id}>
                        <button className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50"
                          onClick={() => { setSelectedResident(r); setResidentSearch(r.full_name); setResidentResults([]) }}>
                          {r.full_name}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {selectedResident && (
                  <div className="flex items-center gap-2 mt-1 bg-blue-50 rounded-lg px-3 py-1.5">
                    <span className="text-xs font-medium text-blue-800 flex-1">{selectedResident.full_name}</span>
                    <button onClick={() => { setSelectedResident(null); setResidentSearch('') }}>
                      <X className="w-3.5 h-3.5 text-gray-400" />
                    </button>
                  </div>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-600 mb-1">Mês *</label>
                  <input type="month" value={createForm.reference_month}
                    onChange={e => setCreateForm(f => ({ ...f, reference_month: e.target.value }))} className={inputCls} />
                </div>
                <div>
                  <label className="block text-xs text-gray-600 mb-1">Vencimento *</label>
                  <input type="date" value={createForm.due_date}
                    onChange={e => setCreateForm(f => ({ ...f, due_date: e.target.value }))} className={inputCls} />
                </div>
              </div>
              <div>
                <label className="block text-xs text-gray-600 mb-1">Valor (R$) *</label>
                <input type="number" step="0.01" min="0.01" value={createForm.amount}
                  onChange={e => setCreateForm(f => ({ ...f, amount: e.target.value }))} className={inputCls} placeholder="0,00" />
              </div>
              <div className="flex gap-2">
                <button onClick={() => setShowCreateForm(false)}
                  className="flex-1 border border-gray-300 text-gray-600 py-2 rounded-xl text-sm hover:bg-gray-50">Cancelar</button>
                <button onClick={handleCreateMensalidade}
                  className="flex-1 bg-[#26619c] hover:bg-[#1a4f87] text-white py-2 rounded-xl text-sm font-medium">Criar</button>
              </div>
            </div>
          )}
        </>
      )}

      {/* === ABAS SECUNDÁRIAS === */}

      {/* PENDENTES */}
      {tab === 'pendentes' && (
        <>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
            <input type="text" placeholder="Filtrar por nome ou rua…" value={cobrancasSearch}
              onChange={e => setCobrancasSearch(e.target.value)}
              className="w-full pl-8 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#26619c]/30" />
          </div>
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
              <p className="text-sm font-semibold text-gray-800">
                A Receber ({new Set(filterCobrancas(pendingList).map(m => m.resident_id)).size} assoc.)
              </p>
              {loadingCobrancas && <span className="text-xs text-gray-400">Carregando…</span>}
            </div>
            {!loadingCobrancas && pendingList.length === 0 ? (
              <div className="p-6 text-center text-gray-400 text-sm">Nenhuma mensalidade pendente.</div>
            ) : (
              <ul className="divide-y divide-gray-100">
                {filterCobrancas(pendingList).map(m => {
                  const phone = m.phone_primary?.replace(/\D/g, '')
                  const waLink = phone ? `https://wa.me/55${phone}` : null
                  const address = [m.address_street, m.address_number].filter(Boolean).join(', ')
                  return (
                    <li key={m.id} className="px-4 py-3 flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-gray-800 truncate">{m.resident_name ?? '…'}</p>
                        {address && <p className="text-xs text-gray-400 flex items-center gap-1 mt-0.5"><MapPin className="w-3 h-3 shrink-0" />{address}</p>}
                        <p className="text-xs text-gray-500 mt-0.5">Ref: {m.reference_month} · Venc: {m.due_date ? fmtDateOnly(m.due_date) : '—'}</p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {waLink && <a href={waLink} target="_blank" rel="noreferrer" className="p-1.5 text-green-500 hover:text-green-700 rounded-lg"><MessageCircle className="w-4 h-4" /></a>}
                        <span className="text-sm font-bold text-blue-700">{fmt(m.amount)}</span>
                        {!isAgente && m.id && (
                          <button disabled={payingId === m.id}
                            onClick={() => openPay(m.id!, m.resident_name ?? '', parseFloat(m.amount))}
                            className="text-xs bg-green-600 hover:bg-green-700 disabled:opacity-40 text-white px-3 py-1.5 rounded-lg">
                            {payingId === m.id ? '…' : 'Pagar'}
                          </button>
                        )}
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </>
      )}

      {/* INADIMPLENTES */}
      {tab === 'inadimplentes' && (
        <>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
            <input type="text" placeholder="Filtrar por nome ou rua…" value={cobrancasSearch}
              onChange={e => setCobrancasSearch(e.target.value)}
              className="w-full pl-8 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#26619c]/30" />
          </div>
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 bg-red-50">
              <p className="text-sm font-semibold text-red-700 flex items-center gap-2">
                <AlertCircle className="w-4 h-4" />
                Inadimplentes ({new Set(filterCobrancas(delinquent).map(d => d.resident_id)).size} moradores)
              </p>
              {delinquent.length > 0 && (
                <p className="text-xs text-red-500 mt-0.5">Total em atraso: {fmt(filterCobrancas(delinquent).reduce((s, d) => s + parseFloat(d.amount), 0))}</p>
              )}
            </div>
            {delinquent.length === 0 ? (
              <div className="p-6 text-center text-gray-400 text-sm">Nenhum inadimplente.</div>
            ) : (
              <ul className="divide-y divide-gray-100">
                {filterCobrancas(delinquent).map(d => {
                  const phone = d.phone_primary?.replace(/\D/g, '')
                  const waLink = phone ? `https://wa.me/55${phone}` : null
                  const address = [d.address_street, d.address_number].filter(Boolean).join(', ')
                  return (
                    <li key={d.id} className="px-4 py-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-gray-800 truncate">{d.resident_name ?? '…'}</p>
                          {address && <p className="text-xs text-gray-400 flex items-center gap-1 mt-0.5"><MapPin className="w-3 h-3 shrink-0" />{address}</p>}
                          <p className="text-xs text-gray-500 mt-0.5">Ref: {d.reference_month} · Venc: {d.due_date ? fmtDateOnly(d.due_date) : '—'}</p>
                          {d.months_overdue != null && (
                            <span className="text-xs text-red-600 font-medium">{d.months_overdue} {d.months_overdue === 1 ? 'mês' : 'meses'} em atraso</span>
                          )}
                        </div>
                        <div className="flex flex-col items-end gap-1.5 shrink-0">
                          <span className="text-sm font-bold text-gray-800">{fmt(d.amount)}</span>
                          <div className="flex gap-1 items-center">
                            {waLink && <a href={waLink} target="_blank" rel="noreferrer" className="p-1.5 text-green-500 hover:text-green-700 rounded-lg"><MessageCircle className="w-4 h-4" /></a>}
                            <button onClick={() => {
                              const found = members.find(m => m.id === d.resident_id)
                              if (found) { openProfile(found) } else {
                                openProfile({ id: d.resident_id, full_name: d.resident_name ?? '', situacao: 'inadimplente', qtd_pendentes: d.months_overdue ?? 1, valor_atrasado: parseFloat(d.amount), address: '', phone_primary: null, created_at: '', ultima_entrega: null, enc_mes: 0 } as CRMMember)
                              }
                            }} className="text-xs text-[#26619c] hover:underline flex items-center gap-1">
                              <Users className="w-3 h-3" /> Perfil
                            </button>
                            {!isAgente && d.id && (
                              <button onClick={() => openPay(d.id!, d.resident_name ?? '', parseFloat(d.amount))}
                                disabled={payingId === d.id}
                                className="text-xs bg-green-500 hover:bg-green-600 disabled:opacity-40 text-white px-2 py-1 rounded-lg">
                                {payingId === d.id ? '…' : 'Pagar'}
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </>
      )}

      {/* PAGOS */}
      {tab === 'pagos' && (
        <div className="flex flex-col gap-3">
          <input type="month" value={paidMonth}
            onChange={e => { setPaidMonth(e.target.value); loadPaid(e.target.value) }} className={inputCls} />
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
              <p className="text-sm font-semibold text-gray-800">Pagamentos — {paidMonth}</p>
              <span className="text-xs text-gray-400">{loadingPaid ? 'Carregando…' : `${paidItems.length} registro(s)`}</span>
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
                      {p.paid_at && <p className="text-xs text-green-600">Pago em: {fmtDate(p.paid_at)}</p>}
                    </div>
                    <span className="text-sm font-bold text-green-700">{fmt(p.amount)}</span>
                  </li>
                ))}
              </ul>
            )}
            {paidItems.length > 0 && (
              <div className="px-4 py-2 bg-gray-50 border-t border-gray-100 flex justify-between items-center">
                <span className="text-xs text-gray-500">Total</span>
                <span className="text-sm font-bold text-green-700">{fmt(paidItems.reduce((s, p) => s + parseFloat(p.amount), 0))}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* === ABA AGENTES === */}
      {tab === 'agentes' && (() => {
        const META_NOVOS = 5
        const META_COB = 10
        const FIXED_AGENTS = ['Danielly', 'Carla', 'Vinicius', 'Monique', 'Hosana', 'Paulo Victor']

        const merged = FIXED_AGENTS.map(name => {
          const found = agRanking.find(r =>
            r.agent_name.toLowerCase().includes(name.toLowerCase()) ||
            name.toLowerCase().includes(r.agent_name.split(' ')[0].toLowerCase())
          )
          return {
            display_name: name,
            agent_id: found?.agent_id ?? name,
            cobrancas: found?.cobrancas ?? 0,
            novos: found?.novos ?? 0,
            position: found?.position ?? 99,
            prize: found?.prize ?? 0,
          }
        }).sort((a, b) => {
          const scoreA = a.cobrancas * 0.6 + a.novos * 0.4
          const scoreB = b.cobrancas * 0.6 + b.novos * 0.4
          return scoreB - scoreA
        }).map((a, i) => ({ ...a, rank: i + 1 }))

        const MEDAL_COLOR = ['text-amber-500', 'text-gray-400', 'text-orange-400']
        const CARD_STYLE = [
          'border-amber-300 bg-amber-50',
          'border-gray-300 bg-gray-50',
          'border-orange-200 bg-orange-50',
        ]

        return (
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-center gap-3">
              <button onClick={agPrevMonth}
                className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm hover:bg-gray-50">‹</button>
              <span className="font-semibold text-gray-700 capitalize">{monthLabel(agYear, agMonth)}</span>
              <button onClick={agNextMonth}
                className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm hover:bg-gray-50">›</button>
            </div>

            {agLoading ? (
              <div className="text-center py-12 text-gray-400 text-sm">Carregando...</div>
            ) : (
              <>
                <div className="flex flex-col gap-3">
                  {merged.map(agent => {
                    const pctNovos = Math.min(100, (agent.novos / META_NOVOS) * 100)
                    const pctCob   = Math.min(100, (agent.cobrancas / META_COB) * 100)
                    const novosOk  = agent.novos >= META_NOVOS
                    const cobOk    = agent.cobrancas >= META_COB
                    const faltaNovos = Math.max(0, META_NOVOS - agent.novos)
                    const faltaCob   = Math.max(0, META_COB - agent.cobrancas)
                    return (
                      <div key={agent.display_name}
                        className={`rounded-xl border p-4 ${agent.rank <= 3 ? CARD_STYLE[agent.rank - 1] : 'border-gray-100 bg-white'}`}>
                        <div className="flex items-center gap-3 mb-3">
                          <div className="w-8 h-8 flex items-center justify-center rounded-full bg-white border border-gray-200 shrink-0">
                            {agent.rank <= 3
                              ? <Trophy className={`w-4 h-4 ${MEDAL_COLOR[agent.rank - 1]}`} />
                              : <span className="text-xs font-bold text-gray-500">{agent.rank}º</span>}
                          </div>
                          <div className="flex-1">
                            <p className="font-semibold text-gray-800 text-sm">{agent.display_name}</p>
                          </div>
                          {agent.prize > 0 && (
                            <div className="text-right">
                              <p className="font-bold text-gray-800 text-sm">{fmtCurrency(agent.prize)}</p>
                              <p className="text-xs text-gray-400">prêmio</p>
                            </div>
                          )}
                        </div>

                        <div className="flex flex-col gap-2">
                          {/* Novos associados */}
                          <div>
                            <div className="flex justify-between text-xs mb-1">
                              <span className="flex items-center gap-1 text-gray-600">
                                <Users className="w-3 h-3 text-emerald-600" />
                                Novos associados
                              </span>
                              <span className={`font-semibold ${novosOk ? 'text-emerald-600' : 'text-gray-700'}`}>
                                {agent.novos}/{META_NOVOS}
                                {!novosOk && <span className="font-normal text-gray-400 ml-1">· faltam {faltaNovos}</span>}
                                {novosOk && <span className="ml-1">✓</span>}
                              </span>
                            </div>
                            <div className="h-2 rounded-full bg-gray-200 overflow-hidden">
                              <div
                                className={`h-full rounded-full transition-all ${novosOk ? 'bg-emerald-500' : 'bg-emerald-400'}`}
                                style={{ width: `${pctNovos}%` }}
                              />
                            </div>
                          </div>

                          {/* Cobranças */}
                          <div>
                            <div className="flex justify-between text-xs mb-1">
                              <span className="flex items-center gap-1 text-gray-600">
                                <TrendingUp className="w-3 h-3 text-[#26619c]" />
                                Cobranças
                              </span>
                              <span className={`font-semibold ${cobOk ? 'text-[#26619c]' : 'text-gray-700'}`}>
                                {agent.cobrancas}/{META_COB}
                                {!cobOk && <span className="font-normal text-gray-400 ml-1">· faltam {faltaCob}</span>}
                                {cobOk && <span className="ml-1">✓</span>}
                              </span>
                            </div>
                            <div className="h-2 rounded-full bg-gray-200 overflow-hidden">
                              <div
                                className={`h-full rounded-full transition-all ${cobOk ? 'bg-[#26619c]' : 'bg-blue-400'}`}
                                style={{ width: `${pctCob}%` }}
                              />
                            </div>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>

                {agBonus && !isAgente && (
                  <div className={`rounded-xl border p-4 ${agBonus.liberado ? 'border-green-300 bg-green-50' : 'border-gray-200 bg-gray-50'}`}>
                    <h3 className="font-semibold text-gray-700 mb-3 flex items-center gap-2 text-sm">
                      {agBonus.liberado
                        ? <CheckCircle className="w-4 h-4 text-green-600" />
                        : <XCircle className="w-4 h-4 text-gray-400" />}
                      Bônus de Equipe (+R$ 30 por agente)
                    </h3>
                    <div className="space-y-2 text-sm">
                      <div className="flex items-center justify-between">
                        <span className="text-gray-600">Agentes com ≥5 novos: {agBonus.agentes_com_5_novos}/6</span>
                        {agBonus.novos_ok
                          ? <CheckCircle className="w-3.5 h-3.5 text-green-500" />
                          : <XCircle className="w-3.5 h-3.5 text-red-400" />}
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-gray-600">Adimplência: {agBonus.adimplencia_pct}%</span>
                        {agBonus.adimplencia_ok
                          ? <CheckCircle className="w-3.5 h-3.5 text-green-500" />
                          : <XCircle className="w-3.5 h-3.5 text-red-400" />}
                      </div>
                      <p className={`text-sm font-semibold mt-1 ${agBonus.liberado ? 'text-green-700' : 'text-gray-400'}`}>
                        {agBonus.liberado ? 'Bônus liberado!' : 'Bônus não liberado este mês'}
                      </p>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )
      })()}

      {/* === PAYMENT MODAL === */}
      {payTarget && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-5 flex flex-col gap-3">
            <h2 className="text-base font-semibold text-gray-800">Registrar Pagamento</h2>
            <p className="text-xs text-gray-500">{payTarget.name} · {fmt(payTarget.amount)}</p>

            <div>
              <label className="text-xs text-gray-500 mb-1 block">Forma de pagamento</label>
              <select value={payPmId} onChange={e => { setPayPmId(e.target.value); setProofUrl('') }}
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm">
                <option value="">Não informar</option>
                {paymentMethods.map(pm => <option key={pm.id} value={pm.id}>{pm.name}</option>)}
              </select>
            </div>

            {isPix && (
              <div className="flex flex-col gap-2 border border-blue-100 rounded-xl p-3 bg-blue-50">
                <label className="text-xs font-medium text-blue-700">
                  Comprovante PIX <span className="text-red-500">*</span>
                </label>
                {proofUrl ? (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-green-600 font-medium">Enviado</span>
                    <button onClick={() => setProofUrl('')} className="text-xs text-red-500 hover:underline">Remover</button>
                  </div>
                ) : (
                  <label className="flex items-center gap-2 cursor-pointer bg-white border border-blue-200 rounded-lg px-3 py-2 hover:bg-blue-50">
                    <Upload className="w-4 h-4 text-blue-500" />
                    <span className="text-xs text-blue-700">{uploadingProof ? 'Enviando…' : 'Selecionar arquivo'}</span>
                    <input type="file" accept="image/*,application/pdf" className="hidden" disabled={uploadingProof}
                      onChange={e => { const f = e.target.files?.[0]; if (f) handleUploadProof(f) }} />
                  </label>
                )}
                {!proofUrl && <p className="text-xs text-red-500">Obrigatório para PIX</p>}
              </div>
            )}

            <div className="flex gap-2">
              <button onClick={() => setPayTarget(null)}
                className="flex-1 py-2 rounded-xl border border-gray-200 text-sm text-gray-600">Cancelar</button>
              <button onClick={confirmPay} disabled={paying || (isPix && !proofUrl)}
                className="flex-1 py-2 rounded-xl bg-green-600 text-white text-sm font-medium disabled:opacity-50">
                {paying ? 'Pagando…' : 'Confirmar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* === VISIT MODAL === */}
      {visitModal && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-5 flex flex-col gap-3">
            <h2 className="text-base font-semibold text-gray-800">Registrar Visita</h2>
            <p className="text-xs text-gray-500">{visitModal.memberName}</p>
            <div>
              <label className="text-xs text-gray-500 mb-2 block">Resultado</label>
              <div className="grid grid-cols-2 gap-2">
                {([
                  { value: 'paid', label: 'Pagou' },
                  { value: 'will_pay', label: 'Vai pagar' },
                  { value: 'absent', label: 'Ausente' },
                  { value: 'refused', label: 'Recusou' },
                ] as const).map(opt => (
                  <button key={opt.value} onClick={() => setVisitResult(opt.value)}
                    className={`py-2 rounded-xl text-sm font-medium border transition ${
                      visitResult === opt.value
                        ? 'bg-[#26619c] text-white border-[#26619c]'
                        : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                    }`}>
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Observação (opcional)</label>
              <textarea value={visitNotes} onChange={e => setVisitNotes(e.target.value)}
                rows={2} placeholder="Detalhes da visita…"
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-[#26619c]/30" />
            </div>
            <div className="flex gap-2">
              <button onClick={() => setVisitModal(null)}
                className="flex-1 py-2 rounded-xl border border-gray-200 text-sm text-gray-600">Cancelar</button>
              <button onClick={confirmVisit} disabled={savingVisit}
                className="flex-1 py-2 rounded-xl bg-[#26619c] text-white text-sm font-medium disabled:opacity-50">
                {savingVisit ? 'Salvando…' : 'Registrar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* === MEMBER PENDING LIST MODAL === */}
      {memberPendingList && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-5 flex flex-col gap-3 max-h-[80vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-gray-800">Selecionar mensalidade</h2>
              <button onClick={() => setMemberPendingList(null)}><X className="w-4 h-4 text-gray-400" /></button>
            </div>
            <p className="text-xs text-gray-500">{memberPendingList.member.full_name}</p>
            <ul className="divide-y divide-gray-100">
              {memberPendingList.items.map(item => (
                <li key={item.id} className="py-3 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-gray-800">{item.reference_month}</p>
                    {item.due_date && <p className="text-xs text-gray-400">Venc. {fmtDateOnly(item.due_date)}</p>}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-gray-700">{fmt(item.amount)}</span>
                    <button
                      onClick={() => { openPay(item.id!, memberPendingList.member.full_name, parseFloat(item.amount)); setMemberPendingList(null) }}
                      className="text-xs bg-green-600 hover:bg-green-700 text-white px-3 py-1.5 rounded-lg">
                      Pagar
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* === PROFILE DRAWER === */}
      {profileModal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg flex flex-col max-h-[90vh]">
            {/* Header */}
            <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-gray-100 shrink-0">
              <div>
                <h2 className="text-base font-semibold text-gray-800">{profileModal.full_name}</h2>
                <p className="text-xs text-gray-400">
                  {profileModal.situacao === 'adimplente'
                    ? <span className="text-green-600">Adimplente</span>
                    : <span className="text-red-500">Inadimplente · {profileModal.qtd_pendentes} {profileModal.qtd_pendentes === 1 ? 'mês' : 'meses'} em atraso</span>}
                </p>
              </div>
              <button onClick={() => { setProfileModal(null); setProfileHistory([]); setProfileVisits([]); setShowChangeDueDay(false); setNewDueDay('') }}>
                <X className="w-5 h-5 text-gray-400 hover:text-gray-600" />
              </button>
            </div>

            <div className="overflow-y-auto flex-1 px-5 py-4 flex flex-col gap-5">
              {profileLoading ? (
                <p className="text-sm text-center text-gray-400 py-6">Carregando…</p>
              ) : (
                <>
                  {/* Dados básicos */}
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    {profileModal.address && (
                      <div className="col-span-2">
                        <p className="text-xs text-gray-400 mb-0.5">Endereço</p>
                        <p className="text-gray-800">{profileModal.address}</p>
                      </div>
                    )}
                    {profileModal.phone_primary && (
                      <div>
                        <p className="text-xs text-gray-400 mb-0.5">Telefone</p>
                        <a href={`https://wa.me/55${profileModal.phone_primary.replace(/\D/g,'')}`}
                          target="_blank" rel="noreferrer"
                          className="text-green-600 font-medium hover:underline flex items-center gap-1">
                          <MessageCircle className="w-3.5 h-3.5" />{profileModal.phone_primary}
                        </a>
                      </div>
                    )}
                    <div>
                      <p className="text-xs text-gray-400 mb-0.5">Associado desde</p>
                      <p className="text-gray-800">{tenureLabel(profileModal.created_at)}</p>
                    </div>
                    {profileModal.valor_atrasado > 0 && (
                      <div>
                        <p className="text-xs text-gray-400 mb-0.5">Em atraso</p>
                        <p className="text-red-600 font-semibold">{fmt(profileModal.valor_atrasado)}</p>
                      </div>
                    )}
                  </div>

                  {/* Admin actions */}
                  {isAdmin && (
                    <div className="flex gap-2">
                      <button onClick={handleAdvancePaymentProfile} disabled={advanceLoading}
                        className="flex-1 flex items-center justify-center gap-1 border border-dashed border-blue-300 rounded-xl py-2 text-sm text-blue-700 hover:bg-blue-50 disabled:opacity-40">
                        <CalendarPlus className="w-3.5 h-3.5" />{advanceLoading ? 'Criando…' : 'Pagar Adiantado'}
                      </button>
                      <button onClick={() => { setShowChangeDueDay(v => !v); setNewDueDay('') }}
                        className="flex-1 flex items-center justify-center gap-1 border border-dashed border-amber-300 rounded-xl py-2 text-sm text-amber-700 hover:bg-amber-50">
                        <Pencil className="w-3.5 h-3.5" /> Alterar Vencimento
                      </button>
                    </div>
                  )}

                  {showChangeDueDay && (
                    <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 flex flex-col gap-3">
                      <p className="text-sm font-semibold text-amber-800">Alterar dia de vencimento permanente</p>
                      <div className="flex gap-2">
                        <input type="number" min="1" max="31" value={newDueDay}
                          onChange={e => setNewDueDay(e.target.value)} placeholder="Dia (1–31)" className={`${inputCls} flex-1`} autoFocus />
                        <button onClick={handleChangeDueDayProfile} disabled={savingDueDay || !newDueDay}
                          className="bg-amber-600 hover:bg-amber-700 text-white px-4 py-2 rounded-xl text-sm font-semibold disabled:opacity-50">
                          {savingDueDay ? '…' : 'Salvar'}
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Visitas */}
                  <div>
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Visitas registradas</p>
                    {profileVisits.length === 0 ? (
                      <p className="text-sm text-gray-400">Nenhuma visita registrada.</p>
                    ) : (
                      <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200 overflow-hidden">
                        {profileVisits.map((v: any) => {
                          const RESULT_LABEL: Record<string, string> = {
                            paid: 'Pagou', will_pay: 'Vai pagar', absent: 'Ausente', refused: 'Recusou'
                          }
                          const RESULT_COLOR: Record<string, string> = {
                            paid: 'text-green-600', will_pay: 'text-blue-600', absent: 'text-gray-400', refused: 'text-red-500'
                          }
                          return (
                            <li key={v.id} className="px-4 py-2.5 flex items-start justify-between gap-3">
                              <div className="min-w-0 flex-1">
                                <p className={`text-sm font-medium ${RESULT_COLOR[v.result] ?? 'text-gray-600'}`}>
                                  {RESULT_LABEL[v.result] ?? v.result}
                                </p>
                                <p className="text-xs text-gray-400">{v.agent_name} · {fmtDate(v.visited_at)}</p>
                                {v.notes && <p className="text-xs text-gray-500 mt-0.5 italic">{v.notes}</p>}
                              </div>
                            </li>
                          )
                        })}
                      </ul>
                    )}
                  </div>

                  {/* Mensalidades pendentes */}
                  {profileHistory.filter(m => m.status !== 'paid').length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Mensalidades em aberto</p>
                      <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200 overflow-hidden">
                        {profileHistory.filter(m => m.status !== 'paid' && m.id).map(m => {
                          const graceCutoff = new Date(); graceCutoff.setDate(graceCutoff.getDate() - 2)
                          const isOverdue = m.due_date && new Date(m.due_date) < graceCutoff
                          return (
                            <li key={m.id} className="px-4 py-2.5 flex items-center justify-between gap-3">
                              <div>
                                <p className="text-sm font-semibold text-gray-800">{m.reference_month}</p>
                                {m.due_date && (
                                  editDueDateId === m.id ? (
                                    <div className="flex items-center gap-1 mt-1">
                                      <input type="date" value={editDueDateVal} onChange={e => setEditDueDateVal(e.target.value)}
                                        className="text-xs border border-gray-300 rounded px-1.5 py-0.5" autoFocus />
                                      <button onClick={() => handleSaveDueDate(m.id!, false)} disabled={savingDueDate}
                                        className="text-[10px] bg-[#26619c] text-white px-1.5 py-0.5 rounded">
                                        {savingDueDate ? '…' : 'Salvar'}
                                      </button>
                                      <button onClick={() => handleSaveDueDate(m.id!, true)} disabled={savingDueDate}
                                        className="text-[10px] bg-green-600 text-white px-1.5 py-0.5 rounded">+ Padrão</button>
                                      <button onClick={() => setEditDueDateId(null)}><X className="w-3.5 h-3.5 text-gray-400" /></button>
                                    </div>
                                  ) : (
                                    <div className="flex items-center gap-1">
                                      <p className={`text-xs ${isOverdue ? 'text-red-500' : 'text-gray-400'}`}>Venc. {fmtDate(m.due_date)}</p>
                                      {isAdmin && (
                                        <button onClick={() => { setEditDueDateId(m.id!); setEditDueDateVal(m.due_date!) }}
                                          className="text-gray-300 hover:text-[#26619c]"><Pencil className="w-3 h-3" /></button>
                                      )}
                                    </div>
                                  )
                                )}
                              </div>
                              <div className="flex items-center gap-2 shrink-0">
                                <span className="text-sm font-bold text-gray-800">{fmt(m.amount)}</span>
                                {!isAgente && (
                                  <button onClick={() => openPay(m.id!, profileModal.full_name, parseFloat(m.amount))}
                                    disabled={payingId === m.id}
                                    className="text-xs bg-green-500 hover:bg-green-600 disabled:opacity-40 text-white px-3 py-1 rounded-lg">
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
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
