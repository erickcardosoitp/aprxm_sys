import { useEffect, useState } from 'react'
import {
  AlertCircle, Plus, Search, X, Users, MessageCircle, MapPin,
  Pencil, CalendarPlus, UserCheck, Upload, ChevronLeft, ChevronRight
} from 'lucide-react'
import api from '../../services/api'
import { uploadService } from '../../services/upload'
import toast from 'react-hot-toast'
import { useAuthStore } from '../../store/authStore'

// ── Types ─────────────────────────────────────────────────────────────────────

interface CRMMember {
  id: string
  full_name: string
  address: string
  created_at: string | null
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

type Tab = 'associados' | 'pendentes' | 'inadimplentes' | 'pagos' | 'historico'

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

  // ── Cobranças state ───────────────────────────────────────────────────────
  const [pendingList, setPendingList] = useState<Mensalidade[]>([])
  const [delinquent, setDelinquent] = useState<Mensalidade[]>([])
  const [cobrancasSearch, setCobrancasSearch] = useState('')
  const [loadingCobrancas, setLoadingCobrancas] = useState(false)

  const [paidItems, setPaidItems] = useState<PaidItem[]>([])
  const [paidMonth, setPaidMonth] = useState(() => new Date().toISOString().slice(0, 7))
  const [loadingPaid, setLoadingPaid] = useState(false)

  const [historyResidentId, setHistoryResidentId] = useState<string | null>(null)
  const [historyResidentName, setHistoryResidentName] = useState<string | null>(null)
  const [historySearch, setHistorySearch] = useState('')
  const [history, setHistory] = useState<Mensalidade[]>([])
  const [historySearchResults, setHistorySearchResults] = useState<Resident[]>([])

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

  const loadHistory = async (residentId: string, residentName?: string) => {
    try {
      const res = await api.get<Mensalidade[]>(`/mensalidades/residents/${residentId}`)
      setHistory(res.data)
      setHistoryResidentId(residentId)
      if (residentName) setHistoryResidentName(residentName)
      setTab('historico')
    } catch { toast.error('Erro ao carregar histórico.') }
  }

  useEffect(() => {
    if (tab === 'pendentes' || tab === 'inadimplentes') loadCobrancas()
    if (tab === 'pagos') loadPaid(paidMonth)
  }, [tab])

  const searchForHistory = async (q: string) => {
    if (q.length < 2) { setHistorySearchResults([]); return }
    try {
      const res = await api.get<Resident[]>('/residents/search', { params: { q } })
      setHistorySearchResults(res.data.slice(0, 6))
    } catch { }
  }

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
      if (tab === 'historico' && historyResidentId) loadHistory(historyResidentId, historyResidentName ?? undefined)
      else { loadCobrancas(); loadMembers() }
    } catch (e: any) {
      toast.error(e.response?.data?.detail ?? 'Erro ao pagar.')
    } finally { setPaying(false); setPayingId(null) }
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
      if (historyResidentId) loadHistory(historyResidentId, historyResidentName ?? undefined)
      loadCobrancas()
    } catch (e: any) { toast.error(e.response?.data?.detail ?? 'Erro.') }
    finally { setSavingDueDate(false) }
  }

  const handleChangeDueDay = async () => {
    const day = parseInt(newDueDay)
    if (!historyResidentId || !day || day < 1 || day > 31) return
    setSavingDueDay(true)
    try {
      await api.put(`/residents/${historyResidentId}`, { monthly_payment_day: day })
      const pending = history.filter(m => m.status !== 'paid' && m.id && m.due_date)
      await Promise.all(pending.map(m => {
        const [yr, mo] = m.due_date!.split('-').map(Number)
        const lastDay = new Date(yr, mo, 0).getDate()
        const d = String(Math.min(day, lastDay)).padStart(2, '0')
        return api.patch(`/mensalidades/${m.id}/due-date`, { due_date: `${yr}-${String(mo).padStart(2,'0')}-${d}`, update_resident_day: false }).catch(() => null)
      }))
      toast.success(`Dia de vencimento alterado para dia ${day}.`)
      setShowChangeDueDay(false)
      setNewDueDay('')
      loadHistory(historyResidentId, historyResidentName ?? undefined)
    } catch (e: any) { toast.error(e.response?.data?.detail ?? 'Erro.') }
    finally { setSavingDueDay(false) }
  }

  const handleAdvancePayment = async () => {
    if (!historyResidentId) return
    setAdvanceLoading(true)
    try {
      const res = await api.post('/mensalidades/advance', { resident_id: historyResidentId })
      toast.success(`Mensalidade ${res.data.reference_month} criada.`)
      await loadHistory(historyResidentId, historyResidentName ?? undefined)
      openPay(res.data.id, historyResidentName ?? '', parseFloat(res.data.amount))
    } catch (e: any) { toast.error(e.response?.data?.detail ?? 'Erro.') }
    finally { setAdvanceLoading(false) }
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
    { key: 'historico' as Tab, label: 'Por Morador' },
  ]

  return (
    <div className="flex flex-col gap-4 pb-10">
      <div className="flex items-center gap-3">
        <UserCheck className="w-5 h-5 text-[#26619c]" />
        <h1 className="text-lg font-bold text-gray-800">CRM — Cobranças</h1>
      </div>

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

      {/* ── ASSOCIADOS ─────────────────────────────────────────────────── */}
      {tab === 'associados' && (
        <div className="flex flex-col gap-3">
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

          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
              <p className="text-sm font-semibold text-gray-800">Associados ({totalMembers})</p>
              {loadingMembers && <span className="text-xs text-gray-400">Carregando…</span>}
            </div>
            {!loadingMembers && members.length === 0 ? (
              <div className="p-6 text-center text-gray-400 text-sm">Nenhum associado encontrado.</div>
            ) : (
              <ul className="divide-y divide-gray-100">
                {members.map(m => (
                  <li key={m.id} className="px-4 py-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-medium text-gray-800">{m.full_name}</p>
                          <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${
                            m.situacao === 'adimplente' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'
                          }`}>
                            {m.situacao === 'adimplente' ? 'Adimplente' : 'Inadimplente'}
                          </span>
                        </div>
                        {m.address && (
                          <p className="text-xs text-gray-400 flex items-center gap-1 mt-0.5">
                            <MapPin className="w-3 h-3 shrink-0" />{m.address}
                          </p>
                        )}
                        <div className="flex gap-3 mt-0.5 flex-wrap">
                          <span className="text-xs text-gray-400">Assoc. há {tenureLabel(m.created_at)}</span>
                          {m.qtd_pendentes > 0 && (
                            <span className="text-xs text-red-500 font-medium">
                              {fmt(m.valor_atrasado)} atrasado · {m.qtd_pendentes} {m.qtd_pendentes === 1 ? 'mês' : 'meses'}
                            </span>
                          )}
                          <span className="text-xs text-gray-400">Última enc.: {daysAgo(m.ultima_entrega)}</span>
                          {m.enc_mes > 0 && (
                            <span className="text-xs text-gray-400">{m.enc_mes.toFixed(1)} enc/mês</span>
                          )}
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-1 shrink-0">
                        <button onClick={() => loadHistory(m.id, m.full_name)}
                          className="text-xs text-[#26619c] hover:underline flex items-center gap-1">
                          <Users className="w-3 h-3" /> Ver Perfil
                        </button>
                        <button
                          onClick={() => { setVisitModal({ memberId: m.id, memberName: m.full_name }); setVisitResult('absent'); setVisitNotes('') }}
                          className="text-xs text-gray-500 hover:text-gray-700 flex items-center gap-1">
                          <MapPin className="w-3 h-3" /> Visita
                        </button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {totalMembers > 100 && (
              <div className="px-4 py-2 border-t border-gray-100 flex items-center justify-between">
                <button disabled={membersPage === 1}
                  onClick={() => { const p = membersPage - 1; setMembersPage(p); loadMembers(p) }}
                  className="flex items-center gap-1 text-xs text-gray-500 disabled:opacity-40">
                  <ChevronLeft className="w-3.5 h-3.5" /> Anterior
                </button>
                <span className="text-xs text-gray-400">Pág. {membersPage}</span>
                <button disabled={membersPage * 100 >= totalMembers}
                  onClick={() => { const p = membersPage + 1; setMembersPage(p); loadMembers(p) }}
                  className="flex items-center gap-1 text-xs text-gray-500 disabled:opacity-40">
                  Próxima <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── ADMIN ACTIONS ──────────────────────────────────────────────── */}
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

      {/* ── PENDENTES ──────────────────────────────────────────────────── */}
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

      {/* ── INADIMPLENTES ──────────────────────────────────────────────── */}
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
                            <button onClick={() => loadHistory(d.resident_id, d.resident_name)}
                              className="text-xs text-[#26619c] hover:underline flex items-center gap-1">
                              <Users className="w-3 h-3" /> Histórico
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

      {/* ── PAGOS ──────────────────────────────────────────────────────── */}
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

      {/* ── HISTORICO ──────────────────────────────────────────────────── */}
      {tab === 'historico' && (
        <div className="flex flex-col gap-3">
          {!historyResidentId ? (
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input value={historySearch} placeholder="Buscar morador…" className={`${inputCls} pl-9`}
                onChange={e => { setHistorySearch(e.target.value); searchForHistory(e.target.value) }} />
              {historySearchResults.length > 0 && (
                <ul className="absolute z-10 top-full left-0 right-0 mt-1 border border-gray-200 rounded-xl bg-white shadow-lg max-h-52 overflow-y-auto">
                  {historySearchResults.map(r => (
                    <li key={r.id}>
                      <button className="w-full text-left px-4 py-3 text-sm hover:bg-blue-50"
                        onClick={() => { setHistorySearchResults([]); setHistorySearch(''); loadHistory(r.id, r.full_name) }}>
                        <span className="font-medium text-gray-800">{r.full_name}</span>
                        {r.cpf && <span className="text-xs text-gray-400 ml-2">{r.cpf}</span>}
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
                className="text-xs text-gray-400 hover:text-red-500 flex items-center gap-1">
                <X className="w-3.5 h-3.5" /> Trocar
              </button>
            </div>
          )}

          {historyResidentId && isAdmin && (
            <div className="flex gap-2">
              <button onClick={handleAdvancePayment} disabled={advanceLoading}
                className="flex-1 flex items-center justify-center gap-1 border-2 border-dashed border-blue-400/50 rounded-xl py-2.5 text-sm text-blue-700 hover:bg-blue-50 disabled:opacity-40">
                <CalendarPlus className="w-4 h-4" />{advanceLoading ? 'Criando…' : 'Pagar Adiantado'}
              </button>
              <button onClick={() => { setShowChangeDueDay(v => !v); setNewDueDay('') }}
                className="flex-1 flex items-center justify-center gap-1 border-2 border-dashed border-amber-400/50 rounded-xl py-2.5 text-sm text-amber-700 hover:bg-amber-50">
                <Pencil className="w-4 h-4" /> Alterar Vencimento
              </button>
            </div>
          )}

          {showChangeDueDay && historyResidentId && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex flex-col gap-3">
              <p className="text-sm font-semibold text-amber-800">Alterar dia de vencimento permanente</p>
              <p className="text-xs text-amber-600">Atualiza o dia padrão e todas as cobranças pendentes.</p>
              <div className="flex gap-2">
                <input type="number" min="1" max="31" value={newDueDay}
                  onChange={e => setNewDueDay(e.target.value)} placeholder="Dia (1–31)" className={`${inputCls} flex-1`} autoFocus />
                <button onClick={handleChangeDueDay} disabled={savingDueDay || !newDueDay}
                  className="bg-amber-600 hover:bg-amber-700 text-white px-4 py-2 rounded-xl text-sm font-semibold disabled:opacity-50">
                  {savingDueDay ? '…' : 'Salvar'}
                </button>
              </div>
            </div>
          )}

          {history.length > 0 && (() => {
            const paid = history.filter(m => m.status === 'paid')
            const pending = history.filter(m => m.status !== 'paid')
            return (
              <div className="grid grid-cols-3 gap-2">
                <div className="bg-white rounded-xl border border-gray-200 p-3 text-center">
                  <p className="text-lg font-bold text-green-600">{paid.length}</p>
                  <p className="text-xs text-gray-400">Pagas</p>
                </div>
                <div className="bg-white rounded-xl border border-gray-200 p-3 text-center">
                  <p className="text-lg font-bold text-red-500">{pending.length}</p>
                  <p className="text-xs text-gray-400">Pendentes</p>
                </div>
                <div className="bg-white rounded-xl border border-gray-200 p-3 text-center">
                  <p className="text-sm font-bold text-gray-700">{fmt(paid.reduce((s, m) => s + parseFloat(m.amount), 0))}</p>
                  <p className="text-xs text-gray-400">de {fmt(history.reduce((s, m) => s + parseFloat(m.amount), 0))}</p>
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
                  const graceCutoff = new Date(); graceCutoff.setDate(graceCutoff.getDate() - 2)
                  const isOverdue = !isPaid && m.due_date && new Date(m.due_date) < graceCutoff
                  return (
                    <li key={m.id ?? `mig-${idx}`} className="px-4 py-3 flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <div className={`w-2 h-2 rounded-full shrink-0 ${isPaid ? 'bg-green-400' : isOverdue ? 'bg-red-400' : 'bg-amber-400'}`} />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-semibold text-gray-800">{m.reference_month}</p>
                            {isMig && <span className="text-xs bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded-full">Migração</span>}
                          </div>
                          {isPaid && m.paid_at ? (
                            <p className="text-xs text-green-600">Pago em {fmtDate(m.paid_at)}</p>
                          ) : m.due_date ? (
                            editDueDateId === m.id ? (
                              <div className="flex items-center gap-1 mt-1">
                                <input type="date" value={editDueDateVal}
                                  onChange={e => setEditDueDateVal(e.target.value)}
                                  className="text-xs border border-gray-300 rounded px-1.5 py-0.5" autoFocus />
                                <button onClick={() => handleSaveDueDate(m.id!, false)} disabled={savingDueDate}
                                  className="text-[10px] bg-[#26619c] text-white px-1.5 py-0.5 rounded disabled:opacity-50">
                                  {savingDueDate ? '…' : 'Salvar'}
                                </button>
                                <button onClick={() => handleSaveDueDate(m.id!, true)} disabled={savingDueDate}
                                  className="text-[10px] bg-green-600 text-white px-1.5 py-0.5 rounded disabled:opacity-50">
                                  + Padrão
                                </button>
                                <button onClick={() => setEditDueDateId(null)}><X className="w-3.5 h-3.5 text-gray-400" /></button>
                              </div>
                            ) : (
                              <div className="flex items-center gap-1">
                                <p className={`text-xs ${isOverdue ? 'text-red-500' : 'text-gray-400'}`}>Venc. {fmtDate(m.due_date)}</p>
                                {!isMig && isAdmin && (
                                  <button onClick={() => { setEditDueDateId(m.id!); setEditDueDateVal(m.due_date!) }}
                                    className="text-gray-300 hover:text-[#26619c]">
                                    <Pencil className="w-3 h-3" />
                                  </button>
                                )}
                              </div>
                            )
                          ) : (
                            <p className="text-xs text-gray-400">Histórico anterior</p>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-sm font-bold text-gray-800">{fmt(m.amount)}</span>
                        {!isPaid && !isMig && !isAgente && m.id && (
                          <button onClick={() => openPay(m.id!, historyResidentName ?? '', parseFloat(m.amount))}
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

          {historyResidentId && history.length === 0 && (
            <p className="text-sm text-center text-gray-400 py-6">Nenhuma cobrança encontrada.</p>
          )}
        </div>
      )}

      {/* ── PAYMENT MODAL ──────────────────────────────────────────────── */}
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
                    <span className="text-xs text-green-600 font-medium">✓ Enviado</span>
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

      {/* ── VISIT MODAL ────────────────────────────────────────────────── */}
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
    </div>
  )
}
