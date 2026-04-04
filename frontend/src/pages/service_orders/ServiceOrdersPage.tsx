import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AlertCircle, ChevronDown, FileText, MessageSquare, Pencil, Plus, Search, X,
  Clock, CheckCircle, XCircle, Archive, Loader2, User,
} from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../../services/api'
import { useAuthStore } from '../../store/authStore'

// ─── Extended types (superset of types/index.ts) ──────────────────────────────

type ServiceOrderStatus =
  | 'pending' | 'open' | 'in_progress' | 'waiting_third_party'
  | 'resolved' | 'archived' | 'cancelled'

type ServiceOrderPriority = 'low' | 'medium' | 'high' | 'critical'

interface ServiceOrder {
  id: string; number: number; title: string; description: string
  status: ServiceOrderStatus; priority: ServiceOrderPriority
  area?: string; unit?: string; block?: string
  service_impacted?: string; category_name?: string; org_responsible?: string
  requester_name?: string; requester_phone?: string; requester_email?: string
  reference_point?: string; address_cep?: string; assigned_to?: string
  requester_resident_id?: string; resolution_notes?: string; resolved_at?: string
  cancellation_reason?: string; request_date?: string
  created_at: string; updated_at?: string
}

interface SOComment {
  id: string; comment: string; attachment_urls: string[]
  created_at: string; author_name: string
}

interface ResidentResult {
  id: string; full_name: string; cpf?: string; phone_primary?: string; email?: string; address_cep?: string
}

// ─── Constants ────────────────────────────────────────────────────────────────

const STATUS_LABELS: Record<ServiceOrderStatus, string> = {
  pending: 'Pendente',
  open: 'Aberta',
  in_progress: 'Em Andamento',
  waiting_third_party: 'Ag. Terceiros',
  resolved: 'Concluída',
  archived: 'Arquivada',
  cancelled: 'Cancelada',
}

const STATUS_COLORS: Record<ServiceOrderStatus, string> = {
  pending: 'bg-gray-100 text-gray-600',
  open: 'bg-blue-100 text-blue-700',
  in_progress: 'bg-yellow-100 text-yellow-700',
  waiting_third_party: 'bg-purple-100 text-purple-700',
  resolved: 'bg-green-100 text-green-700',
  archived: 'bg-gray-100 text-gray-500',
  cancelled: 'bg-red-100 text-red-600',
}

const STATUS_ICONS: Record<ServiceOrderStatus, React.ReactNode> = {
  pending: <Clock className="w-3 h-3" />,
  open: <AlertCircle className="w-3 h-3" />,
  in_progress: <Loader2 className="w-3 h-3" />,
  waiting_third_party: <Clock className="w-3 h-3" />,
  resolved: <CheckCircle className="w-3 h-3" />,
  archived: <Archive className="w-3 h-3" />,
  cancelled: <XCircle className="w-3 h-3" />,
}

const PRIORITY_LABELS: Record<ServiceOrderPriority, string> = {
  low: 'Baixa', medium: 'Média', high: 'Alta', critical: 'Crítica/Urgente',
}

const PRIORITY_DOT: Record<ServiceOrderPriority, string> = {
  low: 'bg-gray-400', medium: 'bg-blue-500', high: 'bg-orange-500', critical: 'bg-red-600',
}

const PRIORITY_TEXT: Record<ServiceOrderPriority, string> = {
  low: 'text-gray-500', medium: 'text-blue-600', high: 'text-orange-500', critical: 'text-red-600',
}

const SERVICES_IMPACTED = [
  'Abastecimento de Água', 'Saneamento Básico', 'Fornecimento de Energia Elétrica',
  'Coleta de Lixo', 'Iluminação Pública', 'Pavimentação e Vias', 'Drenagem Pluvial',
  'Poda e Áreas Verdes', 'Segurança e Vigilância', 'Transporte Público',
  'Violência Doméstica', 'Furto e Roubo', 'Desaparecimento de Pessoas',
  'Vandalismo/Pichação/Dano ao Patrimônio', 'Importunação Sexual e/ou Assédio',
  'Maus-Tratos com Animais', 'Invasão a Domicílio ou Propriedade Privada',
  'Perturbação do Sossego', 'Crime Ambiental', 'Pessoas em Situação de Rua', 'Outras',
]

const CATEGORIES = [
  'Saneamento Básico', 'Infraestrutura', 'Políticas Públicas', 'Processo Civil',
  'Saúde', 'Gente (Assistência Social/Comunitária)', 'Animal', 'SISREG',
  'Esgoto', 'Desastre Natural', 'CRAS',
]

const ORG_BY_CATEGORY: Record<string, string[]> = {
  'Saneamento Básico': ['CEDAE', 'Prefeitura'],
  'Infraestrutura': ['Prefeitura', 'SEOP'],
  'Políticas Públicas': ['Câmara Municipal', 'Prefeitura'],
  'Processo Civil': ['Tribunal de Justiça', 'Defensoria Pública'],
  'Saúde': ['UBS', 'Hospital Municipal', 'Secretaria de Saúde'],
  'Gente (Assistência Social/Comunitária)': ['CRAS', 'CREAS', 'Secretaria de Assistência Social'],
  'Animal': ['CCZ', 'Prefeitura'],
  'SISREG': ['Secretaria de Saúde'],
  'Esgoto': ['CEDAE', 'Prefeitura'],
  'Desastre Natural': ['Defesa Civil'],
  'CRAS': ['CRAS'],
}

const ALL_STATUSES: ServiceOrderStatus[] = [
  'pending', 'open', 'in_progress', 'waiting_third_party', 'resolved', 'archived', 'cancelled',
]

const CAN_WRITE_ROLES = ['admin', 'conferente', 'diretoria_adjunta', 'superadmin']

// ─── Input helper ─────────────────────────────────────────────────────────────

const inputCls = 'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#26619c]/40 focus:border-[#26619c]'

// ─── New OS Modal ─────────────────────────────────────────────────────────────

interface NewOSModalProps {
  onClose: () => void
  onCreated: () => void
}

function NewOSModal({ onClose, onCreated }: NewOSModalProps) {
  // Section 1 — Morador
  const [residentQuery, setResidentQuery] = useState('')
  const [residentResults, setResidentResults] = useState<ResidentResult[]>([])
  const [selectedResident, setSelectedResident] = useState<ResidentResult | null>(null)
  const [requestDate, setRequestDate] = useState(new Date().toISOString().split('T')[0])
  const [requesterPhone, setRequesterPhone] = useState('')
  const [requesterEmail, setRequesterEmail] = useState('')

  // Section 2 — OS
  const [title, setTitle] = useState('')
  const [priority, setPriority] = useState<ServiceOrderPriority>('medium')
  const [status, setStatus] = useState<ServiceOrderStatus>('pending')
  const [serviceImpacted, setServiceImpacted] = useState('')
  const [category, setCategory] = useState('')
  const [orgResponsible, setOrgResponsible] = useState('')
  const [cep, setCep] = useState('')
  const [useMoradorCep, setUseMoradorCep] = useState(false)
  const [referencePoint, setReferencePoint] = useState('')
  const [description, setDescription] = useState('')

  const [saving, setSaving] = useState(false)
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const orgOptions = category ? (ORG_BY_CATEGORY[category] ?? []) : []

  const searchResidents = useCallback((q: string) => {
    if (searchTimer.current) clearTimeout(searchTimer.current)
    if (q.length < 2) { setResidentResults([]); return }
    searchTimer.current = setTimeout(async () => {
      try {
        const res = await api.get<ResidentResult[]>('/residents', { params: { q } })
        setResidentResults(res.data.slice(0, 6))
      } catch { /* silent */ }
    }, 300)
  }, [])

  const pickResident = (r: ResidentResult) => {
    setSelectedResident(r)
    setResidentQuery(r.full_name)
    setResidentResults([])
    setRequesterPhone(r.phone_primary ?? '')
    setRequesterEmail(r.email ?? '')
    if (useMoradorCep && r.address_cep) setCep(r.address_cep)
  }

  useEffect(() => {
    if (useMoradorCep && selectedResident?.address_cep) {
      setCep(selectedResident.address_cep)
    }
  }, [useMoradorCep, selectedResident])

  const handleSubmit = async () => {
    if (!title.trim()) { toast.error('Título é obrigatório.'); return }
    if (!description.trim()) { toast.error('Descrição é obrigatória.'); return }
    setSaving(true)
    try {
      await api.post('/service-orders', {
        title: title.trim(),
        description: description.trim(),
        priority, status,
        service_impacted: serviceImpacted || undefined,
        category_name: category || undefined,
        org_responsible: orgResponsible || undefined,
        address_cep: cep || undefined,
        reference_point: referencePoint || undefined,
        requester_resident_id: selectedResident?.id ?? undefined,
        requester_name: selectedResident?.full_name ?? undefined,
        requester_phone: requesterPhone || undefined,
        requester_email: requesterEmail || undefined,
        request_date: requestDate || undefined,
      })
      toast.success('Ordem de serviço criada!')
      onCreated()
      onClose()
    } catch (e: any) {
      toast.error(e.response?.data?.detail ?? 'Erro ao criar OS.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center overflow-y-auto py-6 px-4">
      <div className="w-full max-w-xl bg-white rounded-2xl shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="font-bold text-gray-900 text-lg">Nova Ordem de Serviço</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>

        <div className="px-6 py-5 flex flex-col gap-5">
          {/* SECTION 1 */}
          <div>
            <p className="text-xs font-semibold text-[#26619c] uppercase tracking-wide mb-3">Seção 1 — Solicitante</p>
            <div className="flex flex-col gap-3">
              {/* Resident search */}
              <div className="relative">
                <label className="block text-xs text-gray-600 mb-1">Buscar morador (nome ou CPF)</label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input
                    value={residentQuery}
                    onChange={e => { setResidentQuery(e.target.value); searchResidents(e.target.value) }}
                    className={`${inputCls} pl-9`}
                    placeholder="Digite nome ou CPF do morador…"
                  />
                </div>
                {residentResults.length > 0 && (
                  <ul className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg divide-y divide-gray-100 max-h-44 overflow-y-auto">
                    {residentResults.map(r => (
                      <li key={r.id}>
                        <button
                          type="button"
                          onMouseDown={() => pickResident(r)}
                          className="w-full text-left px-3 py-2.5 hover:bg-blue-50"
                        >
                          <p className="text-sm font-medium text-gray-800">{r.full_name}</p>
                          <p className="text-xs text-gray-400">{r.cpf ?? ''}{r.phone_primary ? ` · ${r.phone_primary}` : ''}</p>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {selectedResident && (
                <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
                  <User className="w-4 h-4 text-green-600 shrink-0" />
                  <span className="text-sm font-medium text-green-800">{selectedResident.full_name}</span>
                  <button className="ml-auto text-xs text-gray-400 hover:text-red-500"
                    onClick={() => { setSelectedResident(null); setResidentQuery(''); setRequesterPhone(''); setRequesterEmail('') }}>✕</button>
                </div>
              )}

              {!selectedResident && (
                <button
                  type="button"
                  onClick={() => toast('Use o módulo Moradores para cadastrar novos moradores.', { icon: 'ℹ️' })}
                  className="text-xs text-[#26619c] hover:underline text-left"
                >
                  + Cadastrar não-associado
                </button>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-600 mb-1">Data da solicitação</label>
                  <input type="date" value={requestDate} onChange={e => setRequestDate(e.target.value)} className={inputCls} />
                </div>
                <div>
                  <label className="block text-xs text-gray-600 mb-1">Telefone</label>
                  <input value={requesterPhone} onChange={e => setRequesterPhone(e.target.value)} className={inputCls} placeholder="(21) 99999-9999" />
                </div>
              </div>
              <div>
                <label className="block text-xs text-gray-600 mb-1">E-mail</label>
                <input type="email" value={requesterEmail} onChange={e => setRequesterEmail(e.target.value)} className={inputCls} placeholder="email@exemplo.com" />
              </div>
            </div>
          </div>

          {/* SECTION 2 */}
          <div>
            <p className="text-xs font-semibold text-[#26619c] uppercase tracking-wide mb-3">Seção 2 — Ordem de Serviço</p>
            <div className="flex flex-col gap-3">
              <div>
                <label className="block text-xs text-gray-600 mb-1">Título <span className="text-red-500">*</span></label>
                <input value={title} onChange={e => setTitle(e.target.value)} className={inputCls} placeholder="Resumo da solicitação" />
              </div>

              {/* Priority */}
              <div>
                <label className="block text-xs text-gray-600 mb-1.5">Prioridade</label>
                <div className="flex gap-2 flex-wrap">
                  {(['low', 'medium', 'high', 'critical'] as ServiceOrderPriority[]).map(p => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setPriority(p)}
                      className={`px-3 py-1.5 rounded-full text-xs font-medium border transition ${
                        priority === p ? 'bg-[#26619c] text-white border-[#26619c]' : 'border-gray-300 text-gray-600 hover:border-[#26619c]'
                      }`}
                    >
                      {PRIORITY_LABELS[p]}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs text-gray-600 mb-1">Status inicial</label>
                <select value={status} onChange={e => setStatus(e.target.value as ServiceOrderStatus)} className={inputCls}>
                  {ALL_STATUSES.map(s => (
                    <option key={s} value={s}>{STATUS_LABELS[s]}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs text-gray-600 mb-1">Serviço afetado</label>
                <select value={serviceImpacted} onChange={e => setServiceImpacted(e.target.value)} className={inputCls}>
                  <option value="">— selecione —</option>
                  {SERVICES_IMPACTED.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-600 mb-1">Categoria</label>
                  <select value={category} onChange={e => { setCategory(e.target.value); setOrgResponsible('') }} className={inputCls}>
                    <option value="">— selecione —</option>
                    {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-600 mb-1">Org. responsável</label>
                  <select value={orgResponsible} onChange={e => setOrgResponsible(e.target.value)} className={inputCls} disabled={!category}>
                    <option value="">— selecione —</option>
                    {orgOptions.map(o => <option key={o} value={o}>{o}</option>)}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs text-gray-600 mb-1">CEP do local</label>
                <div className="flex items-center gap-3">
                  <input
                    value={cep}
                    onChange={e => setCep(e.target.value)}
                    className={inputCls}
                    placeholder="00000-000"
                    disabled={useMoradorCep}
                  />
                  <label className="flex items-center gap-1.5 text-xs text-gray-600 whitespace-nowrap cursor-pointer">
                    <input
                      type="checkbox"
                      checked={useMoradorCep}
                      onChange={e => setUseMoradorCep(e.target.checked)}
                      className="w-3.5 h-3.5 accent-[#26619c]"
                    />
                    Usar CEP do morador
                  </label>
                </div>
              </div>

              <div>
                <label className="block text-xs text-gray-600 mb-1">Ponto de referência</label>
                <input value={referencePoint} onChange={e => setReferencePoint(e.target.value)} className={inputCls} placeholder="Ex: Em frente à escola" />
              </div>

              <div>
                <label className="block text-xs text-gray-600 mb-1">Descrição detalhada <span className="text-red-500">*</span></label>
                <textarea
                  rows={4}
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  className={`${inputCls} resize-none`}
                  placeholder="Descreva o problema em detalhes…"
                />
              </div>
            </div>
          </div>
        </div>

        <div className="flex gap-3 px-6 py-4 border-t border-gray-100">
          <button onClick={onClose} className="flex-1 border border-gray-300 text-gray-600 py-2.5 rounded-xl text-sm hover:bg-gray-50 transition">
            Cancelar
          </button>
          <button
            onClick={handleSubmit}
            disabled={saving}
            className="flex-1 bg-[#26619c] hover:bg-[#1a4f87] text-white py-2.5 rounded-xl text-sm font-medium transition disabled:opacity-50"
          >
            {saving ? 'Criando…' : 'Criar OS'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Status Update Mini-Modal ─────────────────────────────────────────────────

interface StatusUpdateModalProps {
  current: ServiceOrderStatus
  onConfirm: (status: ServiceOrderStatus, notes?: string, resolutionNotes?: string, cancellationReason?: string) => void
  onClose: () => void
}

function StatusUpdateModal({ current, onConfirm, onClose }: StatusUpdateModalProps) {
  const [newStatus, setNewStatus] = useState<ServiceOrderStatus>(current)
  const [notes, setNotes] = useState('')
  const [resolutionNotes, setResolutionNotes] = useState('')
  const [cancellationReason, setCancellationReason] = useState('')

  return (
    <div className="fixed inset-0 z-[60] bg-black/50 flex items-center justify-center p-4">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-2xl p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-gray-900">Atualizar Status</h3>
          <button onClick={onClose}><X className="w-5 h-5 text-gray-400" /></button>
        </div>
        <div className="flex flex-col gap-3">
          <div>
            <label className="block text-xs text-gray-600 mb-1">Novo status</label>
            <select value={newStatus} onChange={e => setNewStatus(e.target.value as ServiceOrderStatus)} className={inputCls}>
              {ALL_STATUSES.map(s => (
                <option key={s} value={s}>{STATUS_LABELS[s]}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-600 mb-1">Observações</label>
            <textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)} className={`${inputCls} resize-none`} placeholder="Observações sobre a mudança de status…" />
          </div>
          {newStatus === 'resolved' && (
            <div>
              <label className="block text-xs text-gray-600 mb-1">Notas de resolução</label>
              <textarea rows={2} value={resolutionNotes} onChange={e => setResolutionNotes(e.target.value)} className={`${inputCls} resize-none`} placeholder="Como foi resolvido?" />
            </div>
          )}
          {newStatus === 'cancelled' && (
            <div>
              <label className="block text-xs text-gray-600 mb-1">Motivo do cancelamento</label>
              <textarea rows={2} value={cancellationReason} onChange={e => setCancellationReason(e.target.value)} className={`${inputCls} resize-none`} placeholder="Por que está sendo cancelado?" />
            </div>
          )}
          <div className="flex gap-2 mt-1">
            <button onClick={onClose} className="flex-1 border border-gray-300 text-gray-600 py-2 rounded-xl text-sm hover:bg-gray-50">Cancelar</button>
            <button
              onClick={() => onConfirm(newStatus, notes || undefined, resolutionNotes || undefined, cancellationReason || undefined)}
              className="flex-1 bg-[#26619c] hover:bg-[#1a4f87] text-white py-2 rounded-xl text-sm font-medium"
            >
              Confirmar
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Detail Panel ─────────────────────────────────────────────────────────────

interface DetailPanelProps {
  so: ServiceOrder
  canWrite: boolean
  onClose: () => void
  onUpdated: () => void
}

function DetailPanel({ so, canWrite, onClose, onUpdated }: DetailPanelProps) {
  const [activeTab, setActiveTab] = useState<'details' | 'comments'>('details')
  const [comments, setComments] = useState<SOComment[]>([])
  const [commentText, setCommentText] = useState('')
  const [loadingComments, setLoadingComments] = useState(false)
  const [addingComment, setAddingComment] = useState(false)
  const [showStatusModal, setShowStatusModal] = useState(false)
  const [detail, setDetail] = useState<ServiceOrder>(so)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editForm, setEditForm] = useState({
    title: so.title,
    description: so.description,
    priority: so.priority as ServiceOrderPriority,
    service_impacted: so.service_impacted ?? '',
    category_name: so.category_name ?? '',
    org_responsible: so.org_responsible ?? '',
    address_cep: so.address_cep ?? '',
    reference_point: so.reference_point ?? '',
    requester_name: so.requester_name ?? '',
    requester_phone: so.requester_phone ?? '',
    requester_email: so.requester_email ?? '',
  })
  const [saving, setSaving] = useState(false)

  const handleSaveEdit = async () => {
    setSaving(true)
    try {
      await api.put(`/service-orders/${so.id}`, editForm)
      toast.success('OS atualizada.')
      setEditing(false)
      const res = await api.get<ServiceOrder>(`/service-orders/${so.id}`)
      setDetail(res.data)
      onUpdated()
    } catch (e: any) {
      toast.error(e.response?.data?.detail ?? 'Erro ao salvar.')
    } finally {
      setSaving(false)
    }
  }

  useEffect(() => {
    const fetchDetail = async () => {
      setLoadingDetail(true)
      try {
        const res = await api.get<ServiceOrder>(`/service-orders/${so.id}`)
        setDetail(res.data)
      } catch { /* use prop */ } finally { setLoadingDetail(false) }
    }
    fetchDetail()
  }, [so.id])

  useEffect(() => {
    if (activeTab === 'comments') {
      const fetchComments = async () => {
        setLoadingComments(true)
        try {
          const res = await api.get<SOComment[]>(`/service-orders/${so.id}/comments`)
          setComments(res.data)
        } catch { toast.error('Erro ao carregar comentários.') } finally { setLoadingComments(false) }
      }
      fetchComments()
    }
  }, [activeTab, so.id])

  const handleAddComment = async () => {
    if (!commentText.trim()) return
    setAddingComment(true)
    try {
      await api.post(`/service-orders/${so.id}/comments`, { comment: commentText.trim(), attachment_urls: [] })
      setCommentText('')
      const res = await api.get<SOComment[]>(`/service-orders/${so.id}/comments`)
      setComments(res.data)
    } catch { toast.error('Erro ao adicionar comentário.') } finally { setAddingComment(false) }
  }

  const handleStatusUpdate = async (
    status: ServiceOrderStatus,
    notes?: string,
    resolutionNotes?: string,
    cancellationReason?: string,
  ) => {
    try {
      await api.patch(`/service-orders/${so.id}/status`, {
        status,
        notes,
        resolution_notes: resolutionNotes,
        cancellation_reason: cancellationReason,
      })
      toast.success('Status atualizado.')
      setShowStatusModal(false)
      // Refresh detail
      const res = await api.get<ServiceOrder>(`/service-orders/${so.id}`)
      setDetail(res.data)
      onUpdated()
    } catch (e: any) {
      toast.error(e.response?.data?.detail ?? 'Erro ao atualizar status.')
    }
  }

  const d = loadingDetail ? so : detail
  const fmt = (v?: string) => v ? new Date(v).toLocaleDateString('pt-BR') : '—'

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-end">
      <div className="w-full max-w-xl h-full bg-white shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <span className="text-xs font-mono text-gray-400">#{String(d.number).padStart(4, '0')}</span>
            <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${STATUS_COLORS[d.status]}`}>
              {STATUS_ICONS[d.status]}
              {STATUS_LABELS[d.status]}
            </span>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 shrink-0 ml-3"><X className="w-5 h-5" /></button>
        </div>
        <div className="px-5 pt-3 pb-1 shrink-0">
          <h2 className="font-bold text-gray-900 text-base leading-tight">{d.title}</h2>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-100 shrink-0 px-5">
          <button
            onClick={() => setActiveTab('details')}
            className={`py-2.5 text-sm font-medium border-b-2 mr-4 transition ${activeTab === 'details' ? 'text-[#26619c] border-[#26619c]' : 'text-gray-500 border-transparent'}`}
          >
            Detalhes
          </button>
          <button
            onClick={() => setActiveTab('comments')}
            className={`py-2.5 text-sm font-medium border-b-2 flex items-center gap-1.5 transition ${activeTab === 'comments' ? 'text-[#26619c] border-[#26619c]' : 'text-gray-500 border-transparent'}`}
          >
            <MessageSquare className="w-3.5 h-3.5" /> Comentários
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5">
          {activeTab === 'details' && (
            <div className="flex flex-col gap-4">
              {canWrite && (
                <div className="flex gap-2">
                  {!editing && (
                    <>
                      <button
                        onClick={() => setShowStatusModal(true)}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-[#26619c] hover:bg-[#1a4f87] text-white rounded-lg text-xs font-medium transition"
                      >
                        <ChevronDown className="w-3.5 h-3.5" /> Atualizar Status
                      </button>
                      <button
                        onClick={() => {
                          setEditForm({
                            title: d.title,
                            description: d.description,
                            priority: d.priority,
                            service_impacted: d.service_impacted ?? '',
                            category_name: d.category_name ?? '',
                            org_responsible: d.org_responsible ?? '',
                            address_cep: d.address_cep ?? '',
                            reference_point: d.reference_point ?? '',
                            requester_name: d.requester_name ?? '',
                            requester_phone: d.requester_phone ?? '',
                            requester_email: d.requester_email ?? '',
                          })
                          setEditing(true)
                        }}
                        className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-300 text-gray-700 rounded-lg text-xs font-medium hover:bg-gray-50 transition"
                      >
                        <Pencil className="w-3.5 h-3.5" /> Editar
                      </button>
                    </>
                  )}
                  {editing && (
                    <>
                      <button
                        onClick={handleSaveEdit}
                        disabled={saving}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white rounded-lg text-xs font-medium transition disabled:opacity-50"
                      >
                        {saving ? 'Salvando…' : 'Salvar'}
                      </button>
                      <button
                        onClick={() => setEditing(false)}
                        className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-300 text-gray-600 rounded-lg text-xs font-medium hover:bg-gray-50 transition"
                      >
                        Cancelar
                      </button>
                    </>
                  )}
                </div>
              )}

              {editing ? (
                <div className="flex flex-col gap-3">
                  <div>
                    <label className="block text-xs text-gray-600 mb-1">Título</label>
                    <input
                      type="text"
                      value={editForm.title}
                      onChange={e => setEditForm(f => ({ ...f, title: e.target.value }))}
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-600 mb-1">Descrição</label>
                    <textarea
                      rows={3}
                      value={editForm.description}
                      onChange={e => setEditForm(f => ({ ...f, description: e.target.value }))}
                      className={`${inputCls} resize-none`}
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-600 mb-1">Prioridade</label>
                    <div className="flex gap-2 flex-wrap">
                      {(['low', 'medium', 'high', 'critical'] as ServiceOrderPriority[]).map(p => (
                        <button
                          key={p}
                          type="button"
                          onClick={() => setEditForm(f => ({ ...f, priority: p }))}
                          className={`px-3 py-1 rounded-full text-xs font-medium border transition ${editForm.priority === p ? 'border-[#26619c] bg-[#26619c] text-white' : 'border-gray-300 text-gray-600 hover:bg-gray-50'}`}
                        >
                          {PRIORITY_LABELS[p]}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs text-gray-600 mb-1">Serviço afetado</label>
                    <select
                      value={editForm.service_impacted}
                      onChange={e => setEditForm(f => ({ ...f, service_impacted: e.target.value }))}
                      className={inputCls}
                    >
                      <option value="">— Selecione —</option>
                      {SERVICES_IMPACTED.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-gray-600 mb-1">Categoria</label>
                      <select
                        value={editForm.category_name}
                        onChange={e => setEditForm(f => ({ ...f, category_name: e.target.value, org_responsible: '' }))}
                        className={inputCls}
                      >
                        <option value="">— Selecione —</option>
                        {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs text-gray-600 mb-1">Org. responsável</label>
                      <select
                        value={editForm.org_responsible}
                        onChange={e => setEditForm(f => ({ ...f, org_responsible: e.target.value }))}
                        className={inputCls}
                        disabled={!editForm.category_name}
                      >
                        <option value="">— Selecione —</option>
                        {(ORG_BY_CATEGORY[editForm.category_name] ?? []).map(o => <option key={o} value={o}>{o}</option>)}
                      </select>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-gray-600 mb-1">CEP</label>
                      <input
                        type="text"
                        value={editForm.address_cep}
                        onChange={e => setEditForm(f => ({ ...f, address_cep: e.target.value }))}
                        className={inputCls}
                        placeholder="00000-000"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-600 mb-1">Ponto de referência</label>
                      <input
                        type="text"
                        value={editForm.reference_point}
                        onChange={e => setEditForm(f => ({ ...f, reference_point: e.target.value }))}
                        className={inputCls}
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs text-gray-600 mb-1">Solicitante</label>
                    <input
                      type="text"
                      value={editForm.requester_name}
                      onChange={e => setEditForm(f => ({ ...f, requester_name: e.target.value }))}
                      className={inputCls}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-gray-600 mb-1">Telefone</label>
                      <input
                        type="text"
                        value={editForm.requester_phone}
                        onChange={e => setEditForm(f => ({ ...f, requester_phone: e.target.value }))}
                        className={inputCls}
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-600 mb-1">E-mail</label>
                      <input
                        type="email"
                        value={editForm.requester_email}
                        onChange={e => setEditForm(f => ({ ...f, requester_email: e.target.value }))}
                        className={inputCls}
                      />
                    </div>
                  </div>
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <FieldCell label="Prioridade">
                      <span className={`font-medium ${PRIORITY_TEXT[d.priority]}`}>
                        <span className={`inline-block w-2 h-2 rounded-full mr-1.5 ${PRIORITY_DOT[d.priority]}`} />
                        {PRIORITY_LABELS[d.priority]}
                      </span>
                    </FieldCell>
                    <FieldCell label="Categoria">{d.category_name ?? '—'}</FieldCell>
                    <FieldCell label="Serviço afetado">{d.service_impacted ?? '—'}</FieldCell>
                    <FieldCell label="Org. responsável">{d.org_responsible ?? '—'}</FieldCell>
                    <FieldCell label="Solicitante">{d.requester_name ?? '—'}</FieldCell>
                    <FieldCell label="Telefone">{d.requester_phone ?? '—'}</FieldCell>
                    <FieldCell label="E-mail">{d.requester_email ?? '—'}</FieldCell>
                    <FieldCell label="Data solicitação">{fmt(d.request_date ?? d.created_at)}</FieldCell>
                    <FieldCell label="CEP">{d.address_cep ?? '—'}</FieldCell>
                    <FieldCell label="Ponto de referência">{d.reference_point ?? '—'}</FieldCell>
                    {d.assigned_to && <FieldCell label="Atribuído a">{d.assigned_to}</FieldCell>}
                    {d.resolution_notes && (
                      <div className="col-span-2">
                        <FieldCell label="Notas de resolução">{d.resolution_notes}</FieldCell>
                      </div>
                    )}
                    {d.cancellation_reason && (
                      <div className="col-span-2">
                        <FieldCell label="Motivo cancelamento">{d.cancellation_reason}</FieldCell>
                      </div>
                    )}
                  </div>

                  <div>
                    <p className="text-xs text-gray-500 font-medium mb-1">Descrição</p>
                    <p className="text-sm text-gray-700 whitespace-pre-wrap bg-gray-50 rounded-lg p-3">{d.description}</p>
                  </div>
                </>
              )}

              <div className="text-xs text-gray-400 flex gap-4">
                <span>Criado: {fmt(d.created_at)}</span>
                {d.updated_at && <span>Atualizado: {fmt(d.updated_at)}</span>}
                {d.resolved_at && <span>Resolvido: {fmt(d.resolved_at)}</span>}
              </div>
            </div>
          )}

          {activeTab === 'comments' && (
            <div className="flex flex-col gap-4">
              {loadingComments ? (
                <p className="text-sm text-gray-400 text-center py-4">Carregando…</p>
              ) : comments.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-4">Nenhum comentário ainda.</p>
              ) : (
                <ul className="flex flex-col gap-3">
                  {comments.map(c => (
                    <li key={c.id} className="bg-gray-50 rounded-xl p-3">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-semibold text-gray-800">{c.author_name}</span>
                        <span className="text-xs text-gray-400">{new Date(c.created_at).toLocaleString('pt-BR')}</span>
                      </div>
                      <p className="text-sm text-gray-700 whitespace-pre-wrap">{c.comment}</p>
                    </li>
                  ))}
                </ul>
              )}

              <div className="border-t border-gray-100 pt-3 mt-1">
                <label className="block text-xs text-gray-600 mb-1">Adicionar comentário</label>
                <textarea
                  rows={3}
                  value={commentText}
                  onChange={e => setCommentText(e.target.value)}
                  className={`${inputCls} resize-none`}
                  placeholder="Escreva um comentário ou atualização…"
                />
                <button
                  onClick={handleAddComment}
                  disabled={addingComment || !commentText.trim()}
                  className="mt-2 w-full bg-[#26619c] hover:bg-[#1a4f87] text-white py-2 rounded-xl text-sm font-medium transition disabled:opacity-50"
                >
                  {addingComment ? 'Enviando…' : 'Comentar'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {showStatusModal && (
        <StatusUpdateModal
          current={d.status}
          onConfirm={handleStatusUpdate}
          onClose={() => setShowStatusModal(false)}
        />
      )}
    </div>
  )
}

function FieldCell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs text-gray-500 mb-0.5">{label}</p>
      <p className="text-sm text-gray-800">{children}</p>
    </div>
  )
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

export default function ServiceOrdersPage() {
  const { role } = useAuthStore()
  const canWrite = CAN_WRITE_ROLES.includes(role ?? '')

  const [orders, setOrders] = useState<ServiceOrder[]>([])
  const [loading, setLoading] = useState(false)
  const [showNewOS, setShowNewOS] = useState(false)
  const [selectedOrder, setSelectedOrder] = useState<ServiceOrder | null>(null)

  // Filters
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState<ServiceOrderStatus | ''>('')
  const [filterPriority, setFilterPriority] = useState<ServiceOrderPriority | ''>('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params: Record<string, string> = {}
      if (filterStatus) params.status = filterStatus
      if (filterPriority) params.priority = filterPriority
      if (search.trim()) params.q = search.trim()
      const res = await api.get<ServiceOrder[]>('/service-orders', { params })
      setOrders(res.data)
    } catch {
      toast.error('Erro ao carregar ordens de serviço.')
    } finally {
      setLoading(false)
    }
  }, [filterStatus, filterPriority, search])

  useEffect(() => { load() }, [load])

  // KPIs
  const total = orders.length
  const pending = orders.filter(o => o.status === 'pending').length
  const inProgress = orders.filter(o => o.status === 'in_progress').length
  const critical = orders.filter(o => o.priority === 'critical').length

  return (
    <div className="flex flex-col gap-5 p-4 max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <FileText className="w-6 h-6 text-[#26619c]" />
          Ordens de Serviço
        </h1>
        {canWrite && (
          <button
            onClick={() => setShowNewOS(true)}
            className="flex items-center gap-2 bg-[#26619c] hover:bg-[#1a4f87] text-white px-4 py-2 rounded-xl text-sm font-medium transition"
          >
            <Plus className="w-4 h-4" /> Nova OS
          </button>
        )}
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: 'Total', value: total, color: 'bg-gray-50 text-gray-700' },
          { label: 'Pendentes', value: pending, color: 'bg-yellow-50 text-yellow-700' },
          { label: 'Em Andamento', value: inProgress, color: 'bg-blue-50 text-blue-700' },
          { label: 'Críticas', value: critical, color: 'bg-red-50 text-red-700' },
        ].map(k => (
          <div key={k.label} className={`rounded-xl p-3 text-center ${k.color} border border-current/10`}>
            <p className="text-2xl font-bold">{k.value}</p>
            <p className="text-xs mt-0.5 opacity-80">{k.label}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-2">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar por título, solicitante…"
            className="w-full pl-9 pr-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#26619c]/30 focus:border-[#26619c]"
          />
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex gap-1.5 flex-wrap flex-1">
            <button
              onClick={() => setFilterStatus('')}
              className={`px-2.5 py-1 rounded-full text-xs font-medium transition ${filterStatus === '' ? 'bg-[#26619c] text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
            >
              Todas
            </button>
            {ALL_STATUSES.map(s => (
              <button
                key={s}
                onClick={() => setFilterStatus(filterStatus === s ? '' : s)}
                className={`px-2.5 py-1 rounded-full text-xs font-medium transition ${filterStatus === s ? 'bg-[#26619c] text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
              >
                {STATUS_LABELS[s]}
              </button>
            ))}
          </div>
          <select
            value={filterPriority}
            onChange={e => setFilterPriority(e.target.value as ServiceOrderPriority | '')}
            className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-[#26619c] bg-white text-gray-600"
          >
            <option value="">Qualquer prioridade</option>
            {(['low', 'medium', 'high', 'critical'] as ServiceOrderPriority[]).map(p => (
              <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>
            ))}
          </select>
        </div>
      </div>

      {/* List */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-gray-400 text-sm">Carregando…</div>
        ) : orders.length === 0 ? (
          <div className="p-8 text-center text-gray-400 text-sm">Nenhuma ordem de serviço encontrada.</div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {orders.map(so => (
              <li
                key={so.id}
                className="px-4 py-3.5 hover:bg-gray-50 cursor-pointer transition"
                onClick={() => setSelectedOrder(so)}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-mono text-gray-400">#{String(so.number).padStart(4, '0')}</span>
                      <span className={`inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded-full font-medium ${STATUS_COLORS[so.status]}`}>
                        {STATUS_ICONS[so.status]}
                        {STATUS_LABELS[so.status]}
                      </span>
                      <span className="flex items-center gap-1 text-xs">
                        <span className={`w-2 h-2 rounded-full ${PRIORITY_DOT[so.priority]}`} />
                        <span className={PRIORITY_TEXT[so.priority]}>{PRIORITY_LABELS[so.priority]}</span>
                      </span>
                    </div>
                    <p className="text-sm font-medium text-gray-800 truncate">{so.title}</p>
                    <p className="text-xs text-gray-400 mt-0.5 flex items-center gap-1 flex-wrap">
                      {so.category_name && <span>{so.category_name}</span>}
                      {so.requester_name && <><span>·</span><span>{so.requester_name}</span></>}
                      <span>·</span>
                      <span>{new Date(so.created_at).toLocaleDateString('pt-BR')}</span>
                    </p>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Modals */}
      {showNewOS && (
        <NewOSModal
          onClose={() => setShowNewOS(false)}
          onCreated={load}
        />
      )}

      {selectedOrder && (
        <DetailPanel
          so={selectedOrder}
          canWrite={canWrite}
          onClose={() => setSelectedOrder(null)}
          onUpdated={load}
        />
      )}
    </div>
  )
}
