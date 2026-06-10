import { useCallback, useEffect, useMemo, useRef, useState, startTransition, Fragment } from 'react'
import {
  AlertCircle, ChevronDown, FileText, MessageSquare, Pencil, Plus, Search, X,
  Clock, CheckCircle, XCircle, Archive, Loader2, User, LayoutDashboard, ArrowRight,
  Building2, Tag, Calendar, TrendingUp, UserX, AlertTriangle,
} from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../../services/api'
import { useAuthStore } from '../../store/authStore'
import DemandasBoard from './DemandasBoard'

// ─── Extended types (superset of types/index.ts) ──────────────────────────────

type ServiceOrderStatus =
  | 'draft' | 'pending' | 'in_progress' | 'resolved' | 'archived' | 'cancelled'

type ServiceOrderPriority = 'low' | 'medium' | 'high' | 'critical'

interface ServiceOrder {
  id: string; number: number; title: string; description: string
  status: ServiceOrderStatus; priority: ServiceOrderPriority
  area?: string
  service_impacted?: string; category_name?: string; org_responsible?: string
  requester_name?: string; requester_phone?: string; requester_email?: string
  reference_point?: string; address_cep?: string; address_street?: string; address_number?: string; address_complement?: string; assigned_to?: string; assigned_to_name?: string; community_wide?: boolean
  requester_resident_id?: string; resolution_notes?: string; resolved_at?: string
  cancellation_reason?: string; request_date?: string
  impacted_residents?: {id: string; name: string}[]
  created_at: string; updated_at?: string; created_by_name?: string
  association_name?: string
  phase_id?: string
  phase_name?: string
  phase_color?: string
}

interface ServiceOrderPhase {
  id: string
  name: string
  color: string
  sort_order: number
  active: boolean
}

interface SOComment {
  id: string; comment: string; attachment_urls: string[]
  created_at: string; author_name: string
}

interface SOTask {
  id: string
  title: string
  notes?: string
  priority: ServiceOrderPriority
  status: 'open' | 'pending' | 'waiting_third_party' | 'done'
  due_date?: string
  checklist: { text: string; done: boolean }[]
  assigned_to_name?: string
  created_by_name?: string
  created_at: string
}

const TASK_STATUS_LABELS: Record<string, string> = {
  pending: 'Pendente', in_progress: 'Em Andamento',
  done: 'Concluído', blocked: 'Bloqueado',
  open: 'Aberto', waiting_third_party: 'Ag. Terceiros',
}

const TASK_STATUS_COLORS: Record<string, string> = {
  pending: 'bg-gray-100 text-gray-600',
  in_progress: 'bg-blue-100 text-blue-700',
  done: 'bg-green-100 text-green-700',
  blocked: 'bg-orange-100 text-orange-700',
  open: 'bg-blue-100 text-blue-700',
  waiting_third_party: 'bg-orange-100 text-orange-700',
}

interface ResidentResult {
  id: string; full_name: string; cpf?: string; phone_primary?: string; email?: string; address_cep?: string; type?: string
}

interface UserResult {
  id: string; full_name: string; role?: string
}

// ─── Constants ────────────────────────────────────────────────────────────────

const STATUS_LABELS: Record<ServiceOrderStatus, string> = {
  draft: 'Rascunho',
  pending: 'Pendente',
  in_progress: 'Em Andamento',
  resolved: 'Concluída',
  archived: 'Arquivada',
  cancelled: 'Cancelada',
}

const STATUS_COLORS: Record<ServiceOrderStatus, string> = {
  draft: 'bg-amber-50 text-amber-600 border border-amber-200',
  pending: 'bg-gray-100 text-gray-600',
  in_progress: 'bg-yellow-100 text-yellow-700',
  resolved: 'bg-green-100 text-green-700',
  archived: 'bg-gray-100 text-gray-500',
  cancelled: 'bg-red-100 text-red-600',
}

const STATUS_ICONS: Record<ServiceOrderStatus, React.ReactNode> = {
  draft: <Pencil className="w-3 h-3" />,
  pending: <Clock className="w-3 h-3" />,
  in_progress: <Loader2 className="w-3 h-3" />,
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
  'Abastecimento de Água', 'Distribuição de Água', 'Saneamento Básico',
  'Fornecimento de Energia Elétrica', 'Distribuição de Energia Elétrica',
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
  'draft', 'pending', 'in_progress', 'resolved', 'archived', 'cancelled',
]

const CAN_WRITE_ROLES = ['admin', 'conferente', 'diretoria_adjunta', 'diretoria', 'conselho', 'superadmin']

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

  const [communityWide, setCommunityWide] = useState(false)
  const [addressStreet, setAddressStreet] = useState('')
  const [addressNumber, setAddressNumber] = useState('')
  const [addressComplement, setAddressComplement] = useState('')
  const [cepLoading, setCepLoading] = useState(false)

  const [assignedToId, setAssignedToId] = useState<string | null>(null)
  const [assignedToName, setAssignedToName] = useState('')
  const [assignedQuery, setAssignedQuery] = useState('')
  const [assignedResults, setAssignedResults] = useState<UserResult[]>([])
  const [energiaData, setEnergiaData] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [showExitConfirm, setShowExitConfirm] = useState(false)
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const isDirty = !!(title || description || selectedResident || serviceImpacted || category || cep || referencePoint || communityWide)

  useEffect(() => {
    if (!isDirty) return
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [isDirty])

  const handleClose = () => {
    if (isDirty) { setShowExitConfirm(true) } else { onClose() }
  }

  const handleSaveDraft = async () => {
    if (!title.trim() && !description.trim()) { onClose(); return }
    setSaving(true)
    try {
      await api.post('/service-orders', {
        title: title.trim() || '(Rascunho)',
        description: description.trim() || '(sem descrição)',
        priority, status: 'draft',
        community_wide: communityWide,
        service_impacted: serviceImpacted || undefined,
        category_name: category || undefined,
        org_responsible: orgResponsible || undefined,
        address_cep: cep || undefined,
        address_street: addressStreet || undefined,
        address_number: addressNumber || undefined,
        address_complement: addressComplement || undefined,
        reference_point: referencePoint || undefined,
        requester_resident_id: communityWide ? undefined : (selectedResident?.id ?? undefined),
        requester_name: communityWide ? undefined : (selectedResident?.full_name ?? undefined),
        requester_phone: communityWide ? undefined : (requesterPhone || undefined),
        requester_email: communityWide ? undefined : (requesterEmail || undefined),
        request_date: requestDate || undefined,
        assigned_to: assignedToId || undefined,
        assigned_to_name: assignedToName || undefined,
        impacted_residents: communityWide ? [] : impactedResidents,
      })
      toast.success('Rascunho salvo.')
      onCreated()
      onClose()
    } catch {
      toast.error('Erro ao salvar rascunho.')
    } finally {
      setSaving(false)
    }
  }

  const [allUsers, setAllUsers] = useState<UserResult[]>([])
  useEffect(() => {
    api.get('/admin/users').then(r => setAllUsers(r.data)).catch(() => {})
  }, [])

  const searchAssigned = (q: string) => {
    setAssignedQuery(q)
    if (!q) { setAssignedToId(null); setAssignedToName(''); setAssignedResults([]); return }
    if (q.length < 2) { setAssignedResults([]); return }
    const ql = q.toLowerCase()
    setAssignedResults(allUsers.filter(u => u.full_name.toLowerCase().includes(ql)).slice(0, 5))
  }

  const pickAssigned = (u: UserResult) => {
    setAssignedToId(u.id)
    setAssignedToName(u.full_name)
    setAssignedQuery(u.full_name)
    setAssignedResults([])
  }

  // Moradores impactados
  const [impactedResidents, setImpactedResidents] = useState<{id: string; name: string}[]>([])
  const [impactedQuery, setImpactedQuery] = useState('')
  const [impactedResults, setImpactedResults] = useState<ResidentResult[]>([])
  const impactedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const searchImpacted = (q: string) => {
    if (impactedTimer.current) clearTimeout(impactedTimer.current)
    if (q.length < 2) { setImpactedResults([]); return }
    impactedTimer.current = setTimeout(async () => {
      try {
        const res = await api.get('/residents', { params: { q, limit: 5 } })
        setImpactedResults(res.data)
      } catch { setImpactedResults([]) }
    }, 300)
  }

  const addImpacted = (r: ResidentResult) => {
    if (!impactedResidents.find(x => x.id === r.id)) {
      setImpactedResidents(prev => [...prev, { id: r.id, name: r.full_name }])
    }
    setImpactedQuery('')
    setImpactedResults([])
  }

  const orgOptions = category ? (ORG_BY_CATEGORY[category] ?? []) : []
  const isEnergiaEletrica = serviceImpacted === 'Distribuição de Energia Elétrica'

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
    if (r.type === 'guest') setPriority('low')
  }

  useEffect(() => {
    if (useMoradorCep && selectedResident?.address_cep) {
      setCep(selectedResident.address_cep)
    }
  }, [useMoradorCep, selectedResident])

  useEffect(() => {
    const digits = cep.replace(/\D/g, '')
    if (digits.length !== 8) return
    setCepLoading(true)
    api.get(`/packages/cep/${digits}`)
      .then(res => { if (res.data?.street) setAddressStreet(res.data.street) })
      .catch(() => {})
      .finally(() => setCepLoading(false))
  }, [cep])

  const handleSubmit = async () => {
    if (!title.trim()) { toast.error('Título é obrigatório.'); return }
    if (!description.trim()) { toast.error('Descrição é obrigatória.'); return }
    setSaving(true)
    try {
      await api.post('/service-orders', {
        title: title.trim(),
        description: description.trim(),
        priority, status: 'pending',
        community_wide: communityWide,
        service_impacted: serviceImpacted || undefined,
        category_name: category || undefined,
        org_responsible: (orgResponsible && orgResponsible !== '\x00') ? orgResponsible : undefined,
        address_cep: cep || undefined,
        address_street: addressStreet || undefined,
        address_number: addressNumber || undefined,
        address_complement: addressComplement || undefined,
        reference_point: referencePoint || undefined,
        requester_resident_id: communityWide ? undefined : (selectedResident?.id ?? undefined),
        requester_name: communityWide ? undefined : (selectedResident?.full_name ?? undefined),
        requester_phone: communityWide ? undefined : (requesterPhone || undefined),
        requester_email: communityWide ? undefined : (requesterEmail || undefined),
        request_date: requestDate || undefined,
        assigned_to: assignedToId || undefined,
        assigned_to_name: assignedToName || undefined,
        energia_eletrica_data: isEnergiaEletrica && Object.keys(energiaData).length ? energiaData : undefined,
        impacted_residents: communityWide ? [] : impactedResidents,
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
      <div className="relative w-full max-w-xl bg-white rounded-2xl shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="font-bold text-gray-900 text-lg">Nova Ordem de Serviço</h2>
          <button onClick={handleClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>

        {showExitConfirm && (
          <div className="absolute inset-0 z-10 bg-black/50 rounded-2xl flex items-center justify-center p-6">
            <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-sm flex flex-col gap-4">
              <p className="font-semibold text-gray-900 text-center">O que deseja fazer?</p>
              <p className="text-sm text-gray-500 text-center">Você tem informações não salvas nesta OS.</p>
              <button
                onClick={handleSaveDraft}
                disabled={saving}
                className="w-full bg-amber-500 hover:bg-amber-600 text-white rounded-lg py-2.5 text-sm font-medium transition"
              >
                Salvar como rascunho
              </button>
              <button
                onClick={() => setShowExitConfirm(false)}
                className="w-full border border-gray-200 text-gray-700 rounded-lg py-2.5 text-sm font-medium hover:bg-gray-50 transition"
              >
                Continuar editando
              </button>
              <button
                onClick={onClose}
                className="w-full text-red-500 text-sm font-medium hover:underline"
              >
                Desistir e fechar
              </button>
            </div>
          </div>
        )}

        <div className="px-6 py-5 flex flex-col gap-5">
          {/* TITLE + DESCRIÇÃO — primeiros, são os mais importantes */}
          <div className="flex flex-col gap-3">
            <div>
              <label className="block text-xs text-gray-600 mb-1">Título <span className="text-red-500">*</span></label>
              <input value={title} onChange={e => setTitle(e.target.value)} className={inputCls} placeholder="Resumo da solicitação" autoFocus />
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">Descrição detalhada <span className="text-red-500">*</span></label>
              <textarea
                rows={3}
                value={description}
                onChange={e => setDescription(e.target.value)}
                className={`${inputCls} resize-none`}
                placeholder="Descreva o problema em detalhes…"
              />
            </div>
          </div>

          <div className="border-t border-gray-100" />

          {/* Comunidade inteira */}
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={communityWide}
              onChange={e => setCommunityWide(e.target.checked)}
              className="w-4 h-4 accent-[#26619c]"
            />
            <span className="text-sm font-medium text-gray-700">Toda a comunidade (sem morador específico)</span>
          </label>

          {/* SECTION 1 */}
          {!communityWide && <div>
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
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-medium text-gray-800">{r.full_name}</p>
                            {r.type === 'guest' && <span className="text-[10px] bg-orange-100 text-orange-600 px-1.5 py-0.5 rounded font-medium">Visitante</span>}
                            {r.type === 'member' && <span className="text-[10px] bg-blue-100 text-blue-600 px-1.5 py-0.5 rounded font-medium">Associado</span>}
                          </div>
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
                  {selectedResident.type === 'guest' && (
                    <span className="text-[10px] bg-orange-100 text-orange-600 px-1.5 py-0.5 rounded font-medium">Visitante · prioridade baixa</span>
                  )}
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
          </div>}

          {/* SECTION 2 */}
          <div>
            <p className="text-xs font-semibold text-[#26619c] uppercase tracking-wide mb-3">Seção 2 — Ordem de Serviço</p>
            <div className="flex flex-col gap-3">
              {/* Priority */}
              <div>
                <label className="block text-xs text-gray-600 mb-1.5">Prioridade</label>
                <div className="flex gap-2 flex-wrap">
                  {([
                    { key: 'low',      label: PRIORITY_LABELS.low,      sel: 'bg-gray-600 text-white border-gray-600',    unsel: 'border-gray-300 text-gray-600' },
                    { key: 'medium',   label: PRIORITY_LABELS.medium,   sel: 'bg-blue-600 text-white border-blue-600',    unsel: 'border-blue-300 text-blue-700' },
                    { key: 'high',     label: PRIORITY_LABELS.high,     sel: 'bg-orange-500 text-white border-orange-500', unsel: 'border-orange-300 text-orange-600' },
                    { key: 'critical', label: PRIORITY_LABELS.critical, sel: 'bg-red-600 text-white border-red-600',      unsel: 'border-red-300 text-red-600' },
                  ] as const).map(p => (
                    <button
                      key={p.key}
                      type="button"
                      onClick={() => setPriority(p.key as ServiceOrderPriority)}
                      className={`px-3 py-1.5 rounded-full text-xs font-medium border-2 transition ${
                        priority === p.key ? p.sel : `${p.unsel} hover:opacity-80 bg-white`
                      }`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
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
                  <select
                    value={orgOptions.includes(orgResponsible) ? orgResponsible : (orgResponsible ? '__outro__' : '')}
                    onChange={e => setOrgResponsible(e.target.value === '__outro__' ? '\x00' : e.target.value)}
                    className={inputCls}
                    disabled={!category}
                  >
                    <option value="">— selecione —</option>
                    {orgOptions.map(o => <option key={o} value={o}>{o}</option>)}
                    <option value="__outro__">Outro…</option>
                  </select>
                  {(orgResponsible === '\x00' || (orgResponsible && !orgOptions.includes(orgResponsible))) && (
                    <input
                      value={orgResponsible === '\x00' ? '' : orgResponsible}
                      onChange={e => setOrgResponsible(e.target.value || '\x00')}
                      className={`${inputCls} mt-1.5`}
                      placeholder="Digite o órgão responsável"
                      autoFocus
                    />
                  )}
                </div>
              </div>

              <div>
                <label className="block text-xs text-gray-600 mb-1">CEP do local</label>
                <div className="flex items-center gap-3">
                  <div className="relative flex-1">
                    <input
                      value={cep}
                      onChange={e => setCep(e.target.value)}
                      className={inputCls}
                      placeholder="00000-000"
                      disabled={useMoradorCep}
                    />
                    {cepLoading && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400">buscando…</span>}
                  </div>
                  {!communityWide && (
                    <label className="flex items-center gap-1.5 text-xs text-gray-600 whitespace-nowrap cursor-pointer">
                      <input
                        type="checkbox"
                        checked={useMoradorCep}
                        onChange={e => setUseMoradorCep(e.target.checked)}
                        className="w-3.5 h-3.5 accent-[#26619c]"
                      />
                      Usar CEP do morador
                    </label>
                  )}
                </div>
                <div className="grid grid-cols-3 gap-2 mt-2">
                  <div className="col-span-2">
                    <input
                      value={addressStreet}
                      onChange={e => setAddressStreet(e.target.value)}
                      className={inputCls}
                      placeholder="Logradouro"
                    />
                  </div>
                  <div>
                    <input
                      value={addressNumber}
                      onChange={e => setAddressNumber(e.target.value)}
                      className={inputCls}
                      placeholder="Nº"
                    />
                  </div>
                  <div className="col-span-3">
                    <input
                      value={addressComplement}
                      onChange={e => setAddressComplement(e.target.value)}
                      className={inputCls}
                      placeholder="Complemento (opcional)"
                    />
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-xs text-gray-600 mb-1">Ponto de referência</label>
                <input value={referencePoint} onChange={e => setReferencePoint(e.target.value)} className={inputCls} placeholder="Ex: Em frente à escola" />
              </div>

              <div>
                <label className="block text-xs text-gray-600 mb-1">Atribuído a</label>
                <div className="relative">
                  <input
                    value={assignedQuery}
                    onChange={e => searchAssigned(e.target.value)}
                    className={inputCls}
                    placeholder="Buscar usuário por nome…"
                  />
                  {assignedResults.length > 0 && (
                    <ul className="absolute z-10 left-0 right-0 bg-white border border-gray-200 rounded-lg shadow-lg mt-1 max-h-40 overflow-y-auto">
                      {assignedResults.map(u => (
                        <li key={u.id} onMouseDown={() => pickAssigned(u)}
                          className="px-3 py-2 hover:bg-blue-50 cursor-pointer text-sm">
                          <span className="font-medium">{u.full_name}</span>
                          {u.role && <span className="ml-2 text-xs text-gray-400">{u.role}</span>}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                {assignedToId && (
                  <p className="text-xs text-green-700 mt-1 flex items-center gap-1">
                    <CheckCircle className="w-3 h-3" /> {assignedToName}
                  </p>
                )}
              </div>

              {isEnergiaEletrica && (
                <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-3 flex flex-col gap-2">
                  <p className="text-xs font-semibold text-yellow-800">Dados — Distribuição de Energia Elétrica</p>
                  {[
                    { key: 'data', label: 'Data', type: 'date' },
                    { key: 'comunidade', label: 'Comunidade' },
                    { key: 'ponto_focal', label: 'Ponto focal' },
                    { key: 'contato', label: 'Contato' },
                    { key: 'instalacao', label: 'Instalação' },
                    { key: 'protocolo', label: 'Protocolo' },
                    { key: 'servico', label: 'Serviço' },
                    { key: 'endereco', label: 'Endereço' },
                  ].map(({ key, label, type }) => (
                    <div key={key}>
                      <label className="block text-xs text-yellow-700 mb-1">{label}</label>
                      <input
                        type={type ?? 'text'}
                        value={energiaData[key] ?? ''}
                        onChange={e => setEnergiaData(d => ({ ...d, [key]: e.target.value }))}
                        className="w-full border border-yellow-300 rounded-lg px-3 py-1.5 text-xs bg-white focus:outline-none"
                      />
                    </div>
                  ))}
                </div>
              )}

              <div>
                <label className="block text-xs text-gray-600 mb-1">Moradores impactados</label>
                <div className="relative">
                  <input
                    value={impactedQuery}
                    onChange={e => { setImpactedQuery(e.target.value); searchImpacted(e.target.value) }}
                    className={inputCls}
                    placeholder="Buscar morador por nome ou CPF…"
                  />
                  {impactedResults.length > 0 && (
                    <ul className="absolute z-10 left-0 right-0 bg-white border border-gray-200 rounded-lg shadow-lg mt-1 max-h-40 overflow-y-auto">
                      {impactedResults.map(r => (
                        <li key={r.id} onMouseDown={() => addImpacted(r)}
                          className="px-3 py-2 hover:bg-blue-50 cursor-pointer text-sm">
                          <span className="font-medium">{r.full_name}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                {impactedResidents.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {impactedResidents.map(r => (
                      <span key={r.id} className="flex items-center gap-1 bg-blue-50 border border-blue-200 text-blue-700 text-xs px-2 py-1 rounded-full">
                        {r.name}
                        <button type="button" onClick={() => setImpactedResidents(prev => prev.filter(x => x.id !== r.id))} className="ml-0.5 text-blue-400 hover:text-red-500">✕</button>
                      </span>
                    ))}
                  </div>
                )}
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
  currentPhaseId?: string
  phases: ServiceOrderPhase[]
  onConfirm: (status: ServiceOrderStatus, notes?: string, resolutionNotes?: string, cancellationReason?: string, phaseId?: string) => void
  onClose: () => void
}

function StatusUpdateModal({ current, currentPhaseId, phases, onConfirm, onClose }: StatusUpdateModalProps) {
  const [newStatus, setNewStatus] = useState<ServiceOrderStatus>(current)
  const [notes, setNotes] = useState('')
  const [resolutionNotes, setResolutionNotes] = useState('')
  const [cancellationReason, setCancellationReason] = useState('')
  const [selectedPhaseId, setSelectedPhaseId] = useState<string | undefined>(currentPhaseId)

  const changed = newStatus !== current
  const needsResolution = newStatus === 'resolved' && !resolutionNotes.trim()
  const needsCancellation = newStatus === 'cancelled' && !cancellationReason.trim()
  const canConfirm = changed && !needsResolution && !needsCancellation

  const STATUS_ORDER: ServiceOrderStatus[] = ['pending', 'in_progress', 'resolved']

  return (
    <div className="fixed inset-0 z-[60] bg-black/50 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div>
            <h3 className="font-semibold text-gray-900">Atualizar Status</h3>
            <p className="text-xs text-gray-500 mt-0.5">
              Atual: <span className="font-medium text-gray-700">{STATUS_LABELS[current]}</span>
            </p>
          </div>
          <button onClick={onClose}><X className="w-5 h-5 text-gray-400" /></button>
        </div>

        <div className="p-5 flex flex-col gap-4 max-h-[80vh] overflow-y-auto">
          {/* Pipeline visual */}
          <div>
            <p className="text-xs font-medium text-gray-500 mb-2">Fluxo principal</p>
            <div className="flex flex-col gap-1.5">
              {STATUS_ORDER.map(s => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setNewStatus(s)}
                  className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl border-2 text-sm font-medium transition text-left ${
                    newStatus === s
                      ? `${STATUS_COLORS[s]} border-current/60 ring-2 ring-current/20`
                      : s === current
                      ? 'bg-gray-50 border-gray-300 text-gray-500 opacity-60 cursor-default'
                      : 'bg-white border-gray-200 text-gray-700 hover:border-gray-300 hover:bg-gray-50'
                  }`}
                  disabled={s === current}
                >
                  <span className="shrink-0">{STATUS_ICONS[s]}</span>
                  <span>{STATUS_LABELS[s]}</span>
                  {s === current && <span className="ml-auto text-[10px] bg-gray-200 text-gray-500 px-1.5 py-0.5 rounded-full">atual</span>}
                  {s === 'resolved' && <span className="ml-auto text-[10px] text-amber-600">requer notas</span>}
                </button>
              ))}
            </div>
          </div>

          {/* Fase — só visível em Em Andamento */}
          {newStatus === 'in_progress' && phases.length > 0 && (
            <div>
              <p className="text-xs font-medium text-gray-500 mb-2">Fase (opcional)</p>
              <div className="flex flex-col gap-1.5">
                <button
                  type="button"
                  onClick={() => setSelectedPhaseId(undefined)}
                  className={`flex items-center gap-2 px-3 py-2 rounded-xl border-2 text-sm transition text-left ${
                    !selectedPhaseId ? 'bg-gray-100 border-gray-400 text-gray-700 font-medium' : 'bg-white border-gray-200 text-gray-500 hover:bg-gray-50'
                  }`}
                >
                  <span className="w-2.5 h-2.5 rounded-full bg-gray-300 shrink-0" />
                  Sem fase específica
                </button>
                {phases.map(p => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setSelectedPhaseId(p.id)}
                    className={`flex items-center gap-2 px-3 py-2 rounded-xl border-2 text-sm transition text-left ${
                      selectedPhaseId === p.id ? 'border-current/60 font-medium' : 'bg-white border-gray-200 text-gray-700 hover:bg-gray-50'
                    }`}
                    style={selectedPhaseId === p.id ? { backgroundColor: p.color + '20', color: p.color, borderColor: p.color + '80' } : {}}
                  >
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: p.color }} />
                    {p.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Ações laterais */}
          <div>
            <p className="text-xs font-medium text-gray-500 mb-2">Encerrar</p>
            <div className="grid grid-cols-2 gap-1.5">
              {(['archived', 'cancelled'] as ServiceOrderStatus[]).map(s => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setNewStatus(s)}
                  disabled={s === current}
                  className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border-2 text-sm font-medium transition ${
                    newStatus === s
                      ? `${STATUS_COLORS[s]} border-current/60`
                      : s === current
                      ? 'bg-gray-50 border-gray-200 text-gray-400 opacity-60 cursor-default'
                      : 'bg-white border-gray-200 text-gray-700 hover:border-gray-300 hover:bg-gray-50'
                  }`}
                >
                  <span className="shrink-0">{STATUS_ICONS[s]}</span>
                  {STATUS_LABELS[s]}
                  {s === 'cancelled' && <span className="ml-auto text-[10px] text-red-400">requer motivo</span>}
                </button>
              ))}
            </div>
          </div>

          {/* Observações */}
          <div>
            <label className="block text-xs text-gray-600 mb-1">Observações</label>
            <textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)}
              className={`${inputCls} resize-none`} placeholder="Contexto sobre a mudança…" />
          </div>

          {/* Notas de resolução — obrigatório */}
          {newStatus === 'resolved' && (
            <div>
              <label className="block text-xs font-semibold text-amber-700 mb-1">
                Notas de resolução <span className="text-red-500">*</span>
              </label>
              <textarea
                rows={3}
                value={resolutionNotes}
                onChange={e => setResolutionNotes(e.target.value)}
                className={`${inputCls} resize-none ${needsResolution ? 'border-amber-400 focus:ring-amber-400/30 focus:border-amber-500' : ''}`}
                placeholder="Como foi resolvido? Descreva a solução em detalhes."
                autoFocus
              />
              {needsResolution && (
                <p className="text-xs text-amber-600 mt-1 flex items-center gap-1">
                  <AlertCircle className="w-3 h-3" /> Obrigatório para marcar como Concluída.
                </p>
              )}
            </div>
          )}

          {/* Motivo do cancelamento — obrigatório */}
          {newStatus === 'cancelled' && (
            <div>
              <label className="block text-xs font-semibold text-red-700 mb-1">
                Motivo do cancelamento <span className="text-red-500">*</span>
              </label>
              <textarea
                rows={2}
                value={cancellationReason}
                onChange={e => setCancellationReason(e.target.value)}
                className={`${inputCls} resize-none ${needsCancellation ? 'border-red-400 focus:ring-red-400/30' : ''}`}
                placeholder="Por que está sendo cancelado?"
                autoFocus
              />
              {needsCancellation && (
                <p className="text-xs text-red-600 mt-1 flex items-center gap-1">
                  <AlertCircle className="w-3 h-3" /> Obrigatório para cancelar.
                </p>
              )}
            </div>
          )}

          <div className="flex gap-2">
            <button onClick={onClose}
              className="flex-1 border border-gray-300 text-gray-600 py-2 rounded-xl text-sm hover:bg-gray-50">
              Cancelar
            </button>
            <button
              onClick={() => canConfirm && onConfirm(newStatus, notes || undefined, resolutionNotes || undefined, cancellationReason || undefined, newStatus === 'in_progress' ? selectedPhaseId : undefined)}
              disabled={!canConfirm}
              className="flex-1 bg-[#26619c] hover:bg-[#1a4f87] text-white py-2 rounded-xl text-sm font-medium transition disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {!changed ? 'Selecione um status' : 'Confirmar'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── DailyRecordsTab ──────────────────────────────────────────────────────────

function DailyRecordsTab({ soId, canWrite }: { soId: string; canWrite: boolean }) {
  const [tasks, setTasks] = useState<SOTask[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)

  const [fTitle, setFTitle] = useState('')
  const [fNotes, setFNotes] = useState('')
  const [fPriority, setFPriority] = useState<ServiceOrderPriority>('medium')
  const [fStatus, setFStatus] = useState('open')
  const [fDueDate, setFDueDate] = useState('')
  const [fChecklist, setFChecklist] = useState<{ text: string; done: boolean }[]>([])
  const [fCheckInput, setFCheckInput] = useState('')
  const [saving, setSaving] = useState(false)

  const load = async () => {
    try {
      const res = await api.get<SOTask[]>(`/service-orders/${soId}/tasks`)
      setTasks(res.data)
    } catch { /* silent */ } finally { setLoading(false) }
  }

  useEffect(() => { load() }, [soId])

  const resetForm = () => {
    setFTitle(''); setFNotes(''); setFPriority('medium'); setFStatus('open')
    setFDueDate(''); setFChecklist([]); setFCheckInput(''); setShowForm(false); setEditingId(null)
  }

  const startEdit = (t: SOTask) => {
    setFTitle(t.title); setFNotes(t.notes ?? ''); setFPriority(t.priority)
    setFStatus(t.status); setFDueDate(t.due_date ?? ''); setFChecklist(t.checklist)
    setEditingId(t.id); setShowForm(true); setExpandedId(null)
  }

  const handleSubmit = async () => {
    if (!fTitle.trim()) { toast.error('Título obrigatório.'); return }
    setSaving(true)
    try {
      const body = { title: fTitle.trim(), notes: fNotes || undefined, priority: fPriority,
        status: fStatus, due_date: fDueDate || undefined, checklist: fChecklist }
      if (editingId) {
        await api.patch(`/service-orders/${soId}/tasks/${editingId}`, body)
        toast.success('Registro atualizado.')
      } else {
        await api.post(`/service-orders/${soId}/tasks`, body)
        toast.success('Registro criado.')
      }
      resetForm(); load()
    } catch (e: any) {
      toast.error(e.response?.data?.detail ?? 'Erro ao salvar.')
    } finally { setSaving(false) }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Excluir este registro?')) return
    try {
      await api.delete(`/service-orders/${soId}/tasks/${id}`)
      setTasks(prev => prev.filter(t => t.id !== id))
    } catch { toast.error('Erro ao excluir.') }
  }

  const toggleChecklist = async (task: SOTask, idx: number) => {
    const checklist = task.checklist.map((item, i) => i === idx ? { ...item, done: !item.done } : item)
    try {
      await api.patch(`/service-orders/${soId}/tasks/${task.id}`, { checklist })
      setTasks(prev => prev.map(t => t.id === task.id ? { ...t, checklist } : t))
    } catch { toast.error('Erro ao atualizar checklist.') }
  }

  const addCheckItem = () => {
    if (!fCheckInput.trim()) return
    setFChecklist(prev => [...prev, { text: fCheckInput.trim(), done: false }])
    setFCheckInput('')
  }

  const today = new Date().toISOString().split('T')[0]

  const taskForm = (
    <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 flex flex-col gap-3">
      <p className="text-xs font-semibold text-blue-800">{editingId ? 'Editar Registro' : 'Novo Registro'}</p>
      <input value={fTitle} onChange={e => setFTitle(e.target.value)} placeholder="Título do registro *"
        className={inputCls} />
      <textarea rows={2} value={fNotes} onChange={e => setFNotes(e.target.value)} placeholder="Notas / observações"
        className={`${inputCls} resize-none`} />
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="block text-xs text-gray-600 mb-1">Prioridade</label>
          <select value={fPriority} onChange={e => setFPriority(e.target.value as ServiceOrderPriority)} className={inputCls}>
            {(['low','medium','high','critical'] as ServiceOrderPriority[]).map(p => (
              <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-600 mb-1">Status</label>
          <select value={fStatus} onChange={e => setFStatus(e.target.value)} className={inputCls}>
            {Object.entries(TASK_STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
      </div>
      <div>
        <label className="block text-xs text-gray-600 mb-1">Data de entrega</label>
        <input type="date" value={fDueDate} onChange={e => setFDueDate(e.target.value)} className={inputCls} />
      </div>
      <div>
        <label className="block text-xs text-gray-600 mb-1">Checklist</label>
        <div className="flex gap-2 mb-2">
          <input value={fCheckInput} onChange={e => setFCheckInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addCheckItem())}
            placeholder="Adicionar item…" className={inputCls} />
          <button type="button" onClick={addCheckItem}
            className="px-3 py-2 bg-[#26619c] text-white rounded-lg text-xs shrink-0">+</button>
        </div>
        {fChecklist.length > 0 && (
          <ul className="flex flex-col gap-1">
            {fChecklist.map((item, i) => (
              <li key={i} className="flex items-center gap-2 text-sm bg-white rounded-lg px-3 py-1.5 border border-gray-200">
                <span className="flex-1">{item.text}</span>
                <button onClick={() => setFChecklist(prev => prev.filter((_, j) => j !== i))}
                  className="text-gray-400 hover:text-red-500 text-xs">✕</button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="flex gap-2">
        <button onClick={resetForm} className="flex-1 border border-gray-300 text-gray-600 py-2 rounded-xl text-sm">Cancelar</button>
        <button onClick={handleSubmit} disabled={saving}
          className="flex-1 bg-[#26619c] text-white py-2 rounded-xl text-sm font-semibold disabled:opacity-50">
          {saving ? 'Salvando…' : editingId ? 'Atualizar' : 'Criar'}
        </button>
      </div>
    </div>
  )

  if (loading) return <p className="text-sm text-gray-400 text-center py-6">Carregando…</p>

  return (
    <div className="flex flex-col gap-3">
      {canWrite && !showForm && (
        <button onClick={() => setShowForm(true)}
          className="flex items-center gap-2 px-4 py-2.5 border-2 border-dashed border-[#26619c]/30 rounded-xl text-[#26619c] text-sm font-medium hover:bg-blue-50 transition w-full justify-center">
          + Novo Registro Diário
        </button>
      )}
      {showForm && taskForm}
      {tasks.length === 0 && !showForm && (
        <p className="text-sm text-gray-400 text-center py-6">Nenhum registro ainda.</p>
      )}
      {tasks.map(task => {
        const isExpanded = expandedId === task.id
        const doneCount = task.checklist.filter(i => i.done).length
        const isOverdue = task.due_date && task.due_date < today && task.status !== 'done'
        return (
          <div key={task.id} className={`rounded-xl border shadow-sm overflow-hidden ${task.status === 'done' ? 'border-gray-200 bg-gray-50 opacity-75' : 'border-gray-200 bg-white'}`}>
            <div className="p-3 cursor-pointer" onClick={() => setExpandedId(isExpanded ? null : task.id)}>
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap gap-1.5 mb-1.5">
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${TASK_STATUS_COLORS[task.status]}`}>
                      {TASK_STATUS_LABELS[task.status]}
                    </span>
                    <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${
                      task.priority === 'critical' ? 'bg-red-100 text-red-700' :
                      task.priority === 'high' ? 'bg-orange-100 text-orange-700' :
                      task.priority === 'medium' ? 'bg-yellow-100 text-yellow-700' : 'bg-gray-100 text-gray-600'
                    }`}>{PRIORITY_LABELS[task.priority]}</span>
                    {task.due_date && (
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${isOverdue ? 'bg-red-100 text-red-600' : 'bg-gray-100 text-gray-600'}`}>
                        {isOverdue ? '⚠ ' : ''}Entrega: {new Date(task.due_date + 'T12:00:00').toLocaleDateString('pt-BR')}
                      </span>
                    )}
                  </div>
                  <p className={`text-sm font-semibold text-gray-800 ${task.status === 'done' ? 'line-through text-gray-500' : ''}`}>{task.title}</p>
                  {task.checklist.length > 0 && (
                    <div className="flex items-center gap-2 mt-1.5">
                      <div className="flex-1 bg-gray-200 rounded-full h-1.5 max-w-[80px]">
                        <div className="bg-[#26619c] h-1.5 rounded-full" style={{ width: `${task.checklist.length ? (doneCount / task.checklist.length) * 100 : 0}%` }} />
                      </div>
                      <span className="text-xs text-gray-500">{doneCount}/{task.checklist.length}</span>
                    </div>
                  )}
                  {task.assigned_to_name && (
                    <p className="text-xs text-gray-400 mt-1">Responsável: {task.assigned_to_name}</p>
                  )}
                </div>
                <span className="text-gray-300 text-xs mt-1">{isExpanded ? '▲' : '▼'}</span>
              </div>
            </div>
            {isExpanded && (
              <div className="border-t border-gray-100 p-3 flex flex-col gap-3">
                {task.notes && <p className="text-sm text-gray-600 whitespace-pre-wrap">{task.notes}</p>}
                {task.checklist.length > 0 && (
                  <ul className="flex flex-col gap-1.5">
                    {task.checklist.map((item, i) => (
                      <li key={i} className="flex items-center gap-2 cursor-pointer" onClick={() => toggleChecklist(task, i)}>
                        <div className={`w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 transition ${item.done ? 'bg-[#26619c] border-[#26619c]' : 'border-gray-400'}`}>
                          {item.done && <span className="text-white text-[10px]">✓</span>}
                        </div>
                        <span className={`text-sm ${item.done ? 'line-through text-gray-400' : 'text-gray-700'}`}>{item.text}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {canWrite && (
                  <div className="flex gap-2 pt-1">
                    <button onClick={() => startEdit(task)}
                      className="text-xs text-[#26619c] hover:underline flex items-center gap-0.5">
                      ✏ Editar
                    </button>
                    <button onClick={() => handleDelete(task.id)}
                      className="text-xs text-red-500 hover:underline flex items-center gap-0.5">
                      🗑 Excluir
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ─── SOPrintModal ─────────────────────────────────────────────────────────────

function SOPrintModal({ so, onClose }: { so: ServiceOrder; onClose: () => void }) {
  const associationName = useAuthStore(s => s.associationName)
  const fmt = (v?: string) => v ? new Date(v).toLocaleDateString('pt-BR') : '—'

  const handleCopy = () => {
    const lines = [
      `ORDEM DE SERVIÇO Nº ${String(so.number).padStart(4, '0')}`,
      associationName ? `Associação: ${associationName}` : '',
      '',
      `Título: ${so.title}`,
      `Status: ${STATUS_LABELS[so.status]}`,
      `Prioridade: ${PRIORITY_LABELS[so.priority]}`,
      so.category_name ? `Categoria: ${so.category_name}` : '',
      so.service_impacted ? `Serviço afetado: ${so.service_impacted}` : '',
      so.org_responsible ? `Org. responsável: ${so.org_responsible}` : '',
      '',
      'SOLICITANTE',
      so.requester_name ? `Nome: ${so.requester_name}` : '',
      so.requester_phone ? `Telefone: ${so.requester_phone}` : '',
      so.requester_email ? `E-mail: ${so.requester_email}` : '',
      so.request_date ? `Data da solicitação: ${fmt(so.request_date)}` : '',
      '',
      'LOCALIZAÇÃO',
      so.address_cep ? `CEP: ${so.address_cep}` : '',
      so.reference_point ? `Ponto de referência: ${so.reference_point}` : '',
      '',
      'DESCRIÇÃO',
      so.description,
      '',
      so.resolution_notes ? `RESOLUÇÃO: ${so.resolution_notes}` : '',
      `Criado em: ${fmt(so.created_at)}`,
    ].filter(Boolean).join('\n')
    navigator.clipboard.writeText(lines).then(() => toast.success('Copiado!')).catch(() => toast.error('Erro ao copiar.'))
  }

  const PField = ({ label, value }: { label: string; value?: string }) =>
    value ? <div className="mb-2"><span className="text-[10px] uppercase tracking-wide text-gray-400 font-semibold">{label}</span><p className="text-sm text-gray-800">{value}</p></div> : null

  return (
    <div className="fixed inset-0 z-[100] bg-white overflow-y-auto">
      <div className="print:hidden sticky top-0 bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between z-10">
        <h3 className="font-bold text-gray-900 text-sm">OS #{String(so.number).padStart(4, '0')}</h3>
        <div className="flex items-center gap-2">
          <button onClick={handleCopy}
            className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-300 text-gray-700 rounded-lg text-xs hover:bg-gray-50">
            📋 Copiar texto
          </button>
          <button onClick={() => window.print()}
            className="flex items-center gap-1.5 px-4 py-1.5 bg-[#26619c] text-white rounded-lg text-xs font-medium hover:bg-[#1a4f87]">
            🖨 Imprimir
          </button>
          <button onClick={onClose}
            className="text-gray-400 hover:text-gray-600 ml-2">
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      <div id="os-print-overlay" className="max-w-2xl mx-auto px-8 py-8 print:py-0 print:px-0">
        <div className="text-center mb-8 border-b-2 border-gray-800 pb-4">
          {associationName && <p className="text-xs uppercase tracking-widest text-gray-500 mb-1">{associationName}</p>}
          <h1 className="text-2xl font-black text-gray-900 uppercase tracking-wide">Ordem de Serviço</h1>
          <p className="text-4xl font-mono font-bold text-[#1a3f6f] mt-1">#{String(so.number).padStart(4, '0')}</p>
        </div>

        <div className="flex gap-3 mb-6 justify-center flex-wrap">
          <span className={`px-4 py-1.5 rounded-full text-sm font-semibold ${STATUS_COLORS[so.status]}`}>
            {STATUS_LABELS[so.status]}
          </span>
          <span className={`px-4 py-1.5 rounded-full text-sm font-semibold ${
            so.priority === 'critical' ? 'bg-red-100 text-red-700' :
            so.priority === 'high' ? 'bg-orange-100 text-orange-700' :
            so.priority === 'medium' ? 'bg-yellow-100 text-yellow-700' : 'bg-gray-100 text-gray-600'
          }`}>
            {PRIORITY_LABELS[so.priority]}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-x-8 gap-y-1 mb-6">
          <PField label="Categoria" value={so.category_name} />
          <PField label="Serviço Afetado" value={so.service_impacted} />
          <PField label="Org. Responsável" value={so.org_responsible} />
          <PField label="Data de Abertura" value={fmt(so.request_date ?? so.created_at)} />
        </div>

        <div className="border-t border-gray-200 pt-4 mb-6">
          <h2 className="text-xs uppercase tracking-widest text-gray-400 font-semibold mb-3">Solicitante</h2>
          <div className="grid grid-cols-2 gap-x-8 gap-y-1">
            <PField label="Nome" value={so.requester_name} />
            <PField label="Telefone" value={so.requester_phone} />
            <PField label="E-mail" value={so.requester_email} />
          </div>
        </div>

        <div className="border-t border-gray-200 pt-4 mb-6">
          <h2 className="text-xs uppercase tracking-widest text-gray-400 font-semibold mb-3">Localização</h2>
          {so.community_wide && (
            <p className="text-xs font-semibold text-blue-700 bg-blue-50 border border-blue-200 rounded-lg px-3 py-1.5 mb-3 inline-block">
              Toda a comunidade
            </p>
          )}
          <div className="grid grid-cols-2 gap-x-8 gap-y-1">
            <PField label="CEP" value={so.address_cep} />
            <PField label="Logradouro" value={[so.address_street, so.address_number, so.address_complement].filter(Boolean).join(', ') || undefined} />
            <PField label="Ponto de Referência" value={so.reference_point} />
          </div>
        </div>

        <div className="border-t border-gray-200 pt-4 mb-6">
          <h2 className="text-xs uppercase tracking-widest text-gray-400 font-semibold mb-3">Descrição</h2>
          <p className="text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">{so.description}</p>
        </div>

        {so.impacted_residents && so.impacted_residents.length > 0 && (
          <div className="border-t border-gray-200 pt-4 mb-6">
            <h2 className="text-xs uppercase tracking-widest text-gray-400 font-semibold mb-3">Moradores Impactados</h2>
            <ul className="flex flex-col gap-1">
              {so.impacted_residents.map(r => (
                <li key={r.id} className="text-sm text-gray-800">• {r.name}</li>
              ))}
            </ul>
          </div>
        )}

        {so.resolution_notes && (
          <div className="border-t border-gray-200 pt-4 mb-6">
            <h2 className="text-xs uppercase tracking-widest text-gray-400 font-semibold mb-3">Resolução</h2>
            <p className="text-sm text-gray-800 whitespace-pre-wrap">{so.resolution_notes}</p>
          </div>
        )}

        {so.cancellation_reason && (
          <div className="border-t border-gray-200 pt-4 mb-6">
            <h2 className="text-xs uppercase tracking-widest text-gray-400 font-semibold mb-3">Motivo do Cancelamento</h2>
            <p className="text-sm text-gray-800">{so.cancellation_reason}</p>
          </div>
        )}

        <div className="border-t-2 border-gray-300 pt-4 mt-8 text-center text-[10px] text-gray-400">
          Gerado em {new Date().toLocaleDateString('pt-BR')} às {new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
        </div>
      </div>
    </div>
  )
}

// ─── Detail Panel ─────────────────────────────────────────────────────────────

interface DetailPanelProps {
  so: ServiceOrder
  canWrite: boolean
  phases: ServiceOrderPhase[]
  onClose: () => void
  onUpdated: () => void
}

interface PresenceUser { user_id: string; full_name: string; last_seen_at: string }

function DetailPanel({ so, canWrite, phases, onClose, onUpdated }: DetailPanelProps) {
  const [activeTab, setActiveTab] = useState<'details' | 'comments' | 'demands'>('details')
  const [showPrint, setShowPrint] = useState(false)
  const [comments, setComments] = useState<SOComment[]>([])
  const [commentText, setCommentText] = useState('')
  const [loadingComments, setLoadingComments] = useState(false)
  const [addingComment, setAddingComment] = useState(false)
  const [showStatusModal, setShowStatusModal] = useState(false)
  const [detail, setDetail] = useState<ServiceOrder>(so)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [editing, setEditing] = useState(false)
  const [presence, setPresence] = useState<PresenceUser[]>([])
  const [newCommentsCount, setNewCommentsCount] = useState(0)
  const [editForm, setEditForm] = useState({
    title: so.title,
    description: so.description,
    priority: so.priority as ServiceOrderPriority,
    service_impacted: so.service_impacted ?? '',
    category_name: so.category_name ?? '',
    org_responsible: so.org_responsible ?? '',
    address_cep: so.address_cep ?? '',
    address_street: so.address_street ?? '',
    address_number: so.address_number ?? '',
    address_complement: so.address_complement ?? '',
    reference_point: so.reference_point ?? '',
    requester_name: so.requester_name ?? '',
    requester_phone: so.requester_phone ?? '',
    requester_email: so.requester_email ?? '',
  })
  const [saving, setSaving] = useState(false)

  const handleSaveEdit = async () => {
    setSaving(true)
    try {
      const payload = { ...editForm, org_responsible: editForm.org_responsible === '\x00' ? '' : editForm.org_responsible }
      await api.put(`/service-orders/${so.id}`, payload)
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
          const key = `so_comments_viewed_${so.id}`
          const lastViewed = localStorage.getItem(key)
          if (lastViewed) {
            const since = new Date(lastViewed)
            setNewCommentsCount(res.data.filter(c => new Date(c.created_at) > since).length)
          }
          localStorage.setItem(key, new Date().toISOString())
          setNewCommentsCount(0)
        } catch { toast.error('Erro ao carregar comentários.') } finally { setLoadingComments(false) }
      }
      fetchComments()
    } else {
      const key = `so_comments_viewed_${so.id}`
      const lastViewed = localStorage.getItem(key)
      if (lastViewed && comments.length > 0) {
        const since = new Date(lastViewed)
        setNewCommentsCount(comments.filter(c => new Date(c.created_at) > since).length)
      }
    }
  }, [activeTab, so.id])

  // Presença em tempo real
  useEffect(() => {
    const ping = () => api.post(`/service-orders/${so.id}/presence`).catch(() => {})
    const fetchPresence = () =>
      api.get<PresenceUser[]>(`/service-orders/${so.id}/presence`)
        .then(r => setPresence(r.data))
        .catch(() => {})

    ping()
    fetchPresence()
    const interval = setInterval(() => { ping(); fetchPresence() }, 5 * 60 * 1000)
    return () => clearInterval(interval)
  }, [so.id])

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
    phaseId?: string,
  ) => {
    try {
      await api.patch(`/service-orders/${so.id}/status`, {
        status,
        notes,
        resolution_notes: resolutionNotes,
        cancellation_reason: cancellationReason,
        phase_id: phaseId,
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
          <div className="flex items-center gap-3 min-w-0 flex-wrap">
            <span className="text-xs font-mono text-gray-400">#{String(d.number).padStart(4, '0')}</span>
            <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${STATUS_COLORS[d.status]}`}>
              {STATUS_ICONS[d.status]}
              {STATUS_LABELS[d.status]}
            </span>
            {d.phase_id && d.phase_name && (
              <span className="flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full"
                style={{ backgroundColor: (d.phase_color ?? '#9333ea') + '15', color: d.phase_color ?? '#9333ea' }}>
                <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: d.phase_color ?? '#9333ea' }} />
                {d.phase_name}
              </span>
            )}
          </div>
          <div className="flex items-center shrink-0 ml-3 gap-2">
            {presence.length > 0 && (
              <div className="flex items-center gap-1">
                {presence.slice(0, 4).map(p => {
                  const initials = p.full_name.split(' ').slice(0, 2).map(n => n[0]).join('').toUpperCase()
                  const mins = Math.floor((Date.now() - new Date(p.last_seen_at).getTime()) / 60000)
                  const label = `${p.full_name} · ${mins < 1 ? 'agora' : `${mins}min atrás`}`
                  return (
                    <div key={p.user_id} title={label}
                      className="w-7 h-7 rounded-full bg-[#26619c] text-white text-[10px] font-bold flex items-center justify-center cursor-default ring-2 ring-white"
                    >
                      {initials}
                    </div>
                  )
                })}
                {presence.length > 4 && (
                  <span className="text-xs text-gray-400">+{presence.length - 4}</span>
                )}
              </div>
            )}
            <button onClick={() => setShowPrint(true)} title="Visualizar OS"
              className="text-gray-400 hover:text-[#26619c]">
              <FileText className="w-4 h-4" />
            </button>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
          </div>
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
            className={`py-2.5 text-sm font-medium border-b-2 flex items-center gap-1.5 transition mr-4 ${activeTab === 'comments' ? 'text-[#26619c] border-[#26619c]' : 'text-gray-500 border-transparent'}`}
          >
            <MessageSquare className="w-3.5 h-3.5" /> Comentários
            {comments.length > 0 && (
              <span className="flex items-center gap-1">
                <span className="bg-gray-100 text-gray-600 text-[10px] font-medium px-1.5 py-0.5 rounded-full">{comments.length}</span>
                {newCommentsCount > 0 && (
                  <span className="bg-blue-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">{newCommentsCount} nov.</span>
                )}
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveTab('demands')}
            className={`py-2.5 text-sm font-medium border-b-2 flex items-center gap-1.5 transition ${activeTab === 'demands' ? 'text-[#26619c] border-[#26619c]' : 'text-gray-500 border-transparent'}`}
          >
            🗂 Demandas
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5">
          {activeTab === 'details' && (
            <div className="flex flex-col gap-4">
              {/* Status pipeline */}
              {(() => {
                const PIPE: ServiceOrderStatus[] = ['pending', 'in_progress', 'resolved']
                const curIdx = PIPE.indexOf(d.status)
                const isSideStatus = d.status === 'cancelled' || d.status === 'archived' || d.status === 'draft'
                return (
                  <div className="flex items-center gap-0 overflow-x-auto pb-1 -mx-1 px-1">
                    {PIPE.map((s, i) => {
                      const isDone = !isSideStatus && i < curIdx
                      const isCurrent = s === d.status
                      return (
                        <div key={s} className="flex items-center shrink-0">
                          <div className={`flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-semibold whitespace-nowrap transition ${
                            isCurrent ? `${STATUS_COLORS[s]}` :
                            isDone ? 'bg-green-50 text-green-600' :
                            'bg-gray-100 text-gray-400'
                          }`}>
                            {isCurrent ? STATUS_ICONS[s] : isDone ? <CheckCircle className="w-3 h-3" /> : null}
                            {STATUS_LABELS[s]}
                          </div>
                          {i < PIPE.length - 1 && (
                            <div className={`w-4 h-px mx-0.5 shrink-0 ${!isSideStatus && i < curIdx ? 'bg-green-400' : 'bg-gray-200'}`} />
                          )}
                        </div>
                      )
                    })}
                    {isSideStatus && (
                      <div className={`ml-2 flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-semibold ${STATUS_COLORS[d.status]}`}>
                        {STATUS_ICONS[d.status]}{STATUS_LABELS[d.status]}
                      </div>
                    )}
                  </div>
                )
              })()}

              {/* Alerta de inconsistência: resolved_at preenchido mas status não é resolved/archived/cancelled */}
              {!!d.resolved_at && !['resolved', 'archived', 'cancelled'].includes(d.status) && (
                <div className="flex items-start gap-2.5 p-3 bg-amber-50 border border-amber-300 rounded-xl">
                  <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-semibold text-amber-800">Status desatualizado</p>
                    <p className="text-xs text-amber-700 mt-0.5">
                      Notas de resolução foram registradas em <strong>{new Date(d.resolved_at).toLocaleDateString('pt-BR')}</strong>,
                      mas o status ainda é <strong>{STATUS_LABELS[d.status]}</strong>.
                      {canWrite && ' Use "Atualizar Status" para marcar como Concluída.'}
                    </p>
                  </div>
                </div>
              )}

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
                            address_street: d.address_street ?? '',
                            address_number: d.address_number ?? '',
                            address_complement: d.address_complement ?? '',
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
                      {([
                        { key: 'low',      sel: 'bg-gray-600 text-white border-gray-600' },
                        { key: 'medium',   sel: 'bg-blue-600 text-white border-blue-600' },
                        { key: 'high',     sel: 'bg-orange-500 text-white border-orange-500' },
                        { key: 'critical', sel: 'bg-red-600 text-white border-red-600' },
                      ] as const).map(({ key, sel }) => (
                        <button
                          key={key}
                          type="button"
                          onClick={() => setEditForm(f => ({ ...f, priority: key as ServiceOrderPriority }))}
                          className={`px-3 py-1 rounded-full text-xs font-medium border-2 transition ${editForm.priority === key ? sel : 'border-gray-300 text-gray-600 hover:bg-gray-50 bg-white'}`}
                        >
                          {PRIORITY_LABELS[key as ServiceOrderPriority]}
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
                        value={(ORG_BY_CATEGORY[editForm.category_name] ?? []).includes(editForm.org_responsible) ? editForm.org_responsible : (editForm.org_responsible ? '__outro__' : '')}
                        onChange={e => setEditForm(f => ({ ...f, org_responsible: e.target.value === '__outro__' ? '\x00' : e.target.value }))}
                        className={inputCls}
                        disabled={!editForm.category_name}
                      >
                        <option value="">— Selecione —</option>
                        {(ORG_BY_CATEGORY[editForm.category_name] ?? []).map(o => <option key={o} value={o}>{o}</option>)}
                        <option value="__outro__">Outro…</option>
                      </select>
                      {(editForm.org_responsible === '\x00' || (editForm.org_responsible && !(ORG_BY_CATEGORY[editForm.category_name] ?? []).includes(editForm.org_responsible))) && (
                        <input
                          value={editForm.org_responsible === '\x00' ? '' : editForm.org_responsible}
                          onChange={e => setEditForm(f => ({ ...f, org_responsible: e.target.value }))}
                          className={`${inputCls} mt-1.5`}
                          placeholder="Digite o órgão responsável"
                        />
                      )}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-gray-600 mb-1">CEP</label>
                      <input
                        type="text"
                        value={editForm.address_cep}
                        onChange={async e => {
                          const v = e.target.value
                          setEditForm(f => ({ ...f, address_cep: v }))
                          const digits = v.replace(/\D/g, '')
                          if (digits.length === 8) {
                            try {
                              const { data: d } = await api.get(`/packages/cep/${digits}`)
                              if (d?.street) setEditForm(f => ({ ...f, address_street: d.street }))
                            } catch { /* silent */ }
                          }
                        }}
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
                  <div className="grid grid-cols-3 gap-2">
                    <div className="col-span-2">
                      <label className="block text-xs text-gray-600 mb-1">Logradouro</label>
                      <input value={editForm.address_street} onChange={e => setEditForm(f => ({ ...f, address_street: e.target.value }))} className={inputCls} placeholder="Logradouro" />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-600 mb-1">Nº</label>
                      <input value={editForm.address_number} onChange={e => setEditForm(f => ({ ...f, address_number: e.target.value }))} className={inputCls} placeholder="Nº" />
                    </div>
                    <div className="col-span-3">
                      <label className="block text-xs text-gray-600 mb-1">Complemento</label>
                      <input value={editForm.address_complement} onChange={e => setEditForm(f => ({ ...f, address_complement: e.target.value }))} className={inputCls} placeholder="Complemento" />
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
                  {/* Resolução destacada — aparece mesmo com status inconsistente */}
                  {d.resolution_notes && (
                    <div className="rounded-xl p-3 bg-green-50 border border-green-200">
                      <p className="text-xs font-semibold text-green-700 uppercase tracking-wide mb-1">Resolução</p>
                      <p className="text-sm text-green-900 whitespace-pre-wrap">{d.resolution_notes}</p>
                      {d.resolved_at && (
                        <p className="text-[10px] text-green-600 mt-1.5">Registrado em {new Date(d.resolved_at).toLocaleDateString('pt-BR')}</p>
                      )}
                    </div>
                  )}
                  {d.cancellation_reason && (
                    <div className="rounded-xl p-3 bg-red-50 border border-red-200">
                      <p className="text-xs font-semibold text-red-700 uppercase tracking-wide mb-1">Motivo do Cancelamento</p>
                      <p className="text-sm text-red-900">{d.cancellation_reason}</p>
                    </div>
                  )}

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
                    {d.impacted_residents && d.impacted_residents.length > 0 && (
                      <FieldCell label="Moradores impactados">
                        <div className="flex flex-wrap gap-1 mt-0.5">
                          {d.impacted_residents.map(r => (
                            <span key={r.id} className="text-xs bg-blue-50 border border-blue-200 text-blue-700 px-2 py-0.5 rounded-full">
                              {r.name}
                            </span>
                          ))}
                        </div>
                      </FieldCell>
                    )}
                    <FieldCell label="Solicitante">{d.requester_name ?? '—'}</FieldCell>
                    <FieldCell label="Telefone">
                      {d.requester_phone ? (
                        <span className="flex items-center gap-2">
                          <span>{d.requester_phone}</span>
                          <a
                            href={`https://wa.me/55${d.requester_phone.replace(/\D/g, '')}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-xs bg-green-500 hover:bg-green-600 text-white px-2 py-0.5 rounded-full transition"
                          >
                            <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
                            WhatsApp
                          </a>
                        </span>
                      ) : '—'}
                    </FieldCell>
                    <FieldCell label="E-mail">{d.requester_email ?? '—'}</FieldCell>
                    <FieldCell label="Data solicitação">{fmt(d.request_date ?? d.created_at)}</FieldCell>
                    <FieldCell label="CEP">{d.address_cep ?? '—'}</FieldCell>
                    <FieldCell label="Ponto de referência">{d.reference_point ?? '—'}</FieldCell>
                    {d.assigned_to_name && (
                      <FieldCell label="Atribuído a">
                        <span className="flex items-center gap-1.5">
                          <span className="w-5 h-5 rounded-full bg-[#26619c] text-white text-[9px] font-bold flex items-center justify-center shrink-0">
                            {d.assigned_to_name.split(' ').slice(0, 2).map(n => n[0]).join('').toUpperCase()}
                          </span>
                          {d.assigned_to_name}
                        </span>
                      </FieldCell>
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

          {activeTab === 'demands' && (
            <div className="pt-2">
              <DemandasBoard canWrite={canWrite} serviceOrderId={so.id} />
            </div>
          )}
        </div>
      </div>

      {showStatusModal && (
        <StatusUpdateModal
          current={d.status}
          currentPhaseId={detail.phase_id}
          phases={phases}
          onConfirm={handleStatusUpdate}
          onClose={() => setShowStatusModal(false)}
        />
      )}
      {showPrint && <SOPrintModal so={detail} onClose={() => setShowPrint(false)} />}
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


// ─── TarefasDiariasTab ────────────────────────────────────────────────────────

interface DailyTask {
  id: string
  title: string
  description?: string
  assigned_to?: string
  assigned_to_name?: string
  due_date?: string
  reminder_at?: string
  status: 'pending' | 'in_progress' | 'done' | 'blocked' | 'waiting_validation'
  blocked_reason?: string
  checklist: { text: string; done: boolean; status?: string }[]
  attachment_urls: string[]
  service_order_id?: string
  service_order_title?: string
  creator_name?: string
  created_at: string
  updated_at?: string
}

const ITEM_STATUSES = [
  { value: 'pending',       label: 'Pendente',             badge: 'bg-gray-100 text-gray-600 border-gray-200',       sel: 'bg-gray-200 text-gray-800 border-gray-400' },
  { value: 'in_progress',   label: 'Em Andamento',          badge: 'bg-amber-50 text-amber-700 border-amber-200',      sel: 'bg-amber-100 text-amber-900 border-amber-400' },
  { value: 'done',          label: 'Concluído',             badge: 'bg-green-50 text-green-700 border-green-200',      sel: 'bg-green-100 text-green-900 border-green-400' },
  { value: 'cancelled',     label: 'Cancelado',             badge: 'bg-red-50 text-red-600 border-red-200',            sel: 'bg-red-100 text-red-900 border-red-400' },
  { value: 'waiting_third', label: 'Ag. Terceiros',         badge: 'bg-purple-50 text-purple-600 border-purple-200',   sel: 'bg-purple-100 text-purple-900 border-purple-400' },
  { value: 'waiting_public', label: 'Ag. Órgão Público',  badge: 'bg-blue-50 text-blue-600 border-blue-200',         sel: 'bg-blue-100 text-blue-900 border-blue-400' },
  { value: 'postergado',     label: 'Postergado',          badge: 'bg-orange-50 text-orange-600 border-orange-200',    sel: 'bg-orange-100 text-orange-900 border-orange-400' },
] as const

const getItemStatus = (item: { done: boolean; status?: string }) =>
  item.status || (item.done ? 'done' : 'pending')

interface GroupUser {
  id: string
  full_name: string
  role?: string
  assoc_name?: string
}

interface TaskComment {
  id: string
  comment: string
  attachment_urls: string[]
  created_at: string
  author_name: string
  checklist_index: number | null
}

function TarefasDiariasTab({ canWrite }: { canWrite: boolean }) {
  const { userId, role } = useAuthStore()
  const isManager = canWrite  // admins/managers veem todas; operadores veem só as suas
  const isAdmin = role === 'admin' || role === 'superadmin' || role === 'admin_master'
  const [tasks, setTasks] = useState<DailyTask[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [showReport, setShowReport] = useState(false)
  const [reportData, setReportData] = useState<any[]>([])
  const [reportFrom, setReportFrom] = useState(new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10))
  const [reportTo, setReportTo] = useState(new Date().toISOString().slice(0, 10))
  const [loadingReport, setLoadingReport] = useState(false)
  const [filterStatus, setFilterStatus] = useState('')
  const [users, setUsers] = useState<GroupUser[]>([])

  const [fTitle, setFTitle] = useState('')
  const [fDesc, setFDesc] = useState('')
  const [fAssignedTo, setFAssignedTo] = useState('')
  const [fAssignedName, setFAssignedName] = useState('')
  const [fDueDate, setFDueDate] = useState('')
  const [fReminder, setFReminder] = useState('')
  const [fChecklist, setFChecklist] = useState<{ text: string; done: boolean }[]>([])
  const [fCheckInput, setFCheckInput] = useState('')
  const [fAttachments, setFAttachments] = useState<string[]>([])
  const [uploadingFile, setUploadingFile] = useState(false)
  const [viewerUrl, setViewerUrl] = useState<string | null>(null)
  const [fSOId, setFSOId] = useState('')
  const [fSOTitle, setFSOTitle] = useState('')
  const [soSearch, setSOSearch] = useState('')
  const [soResults, setSOResults] = useState<any[]>([])
  const [saving, setSaving] = useState(false)

  // comments — keyed por taskId
  const [comments, setComments] = useState<Record<string, TaskComment[]>>({})
  const [commentDraft, setCommentDraft] = useState<
    Record<string, { text: string; photos: string[]; uploading: boolean }>
  >({})
  const [savingComment, setSavingComment] = useState(false)
  // expanded acompanhamentos per checklist item: key = `${taskId}:${idx}`
  const [expandedAcomp, setExpandedAcomp] = useState<Record<string, boolean>>({})
  // status change panel per item
  const [statusChangeOpen, setStatusChangeOpen] = useState<Record<string, boolean>>({})
  const [statusChangeDraft, setStatusChangeDraft] = useState<Record<string, { newStatus: string; comment: string }>>({}
  )
  // comment editing: key = commentId
  const [editingComment, setEditingComment] = useState<Record<string, string | null>>({})
  const [savingEditComment, setSavingEditComment] = useState<string | null>(null)

  // filtros avançados
  const today = new Date().toISOString().split('T')[0]
  const [viewDate, setViewDate] = useState(today)
  const [filterAssigned, setFilterAssigned] = useState('')
  const [filterPeriodFrom, setFilterPeriodFrom] = useState('')
  const [filterPeriodTo, setFilterPeriodTo] = useState('')
  const [fInitialStatus, setFInitialStatus] = useState('pending')
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null)
  const [reportUserId, setReportUserId] = useState('')
  const [onlyMine, setOnlyMine] = useState(false)
  const [sortBy, setSortBy] = useState<'title' | 'assigned' | 'due_date' | 'status' | 'created_at' | 'updated_at' | ''>('')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const [viewMode, setViewMode] = useState<'list' | 'byUser'>(() => (role === 'admin' || role === 'superadmin' || role === 'admin_master') ? 'byUser' : 'list')
  const [collapsedUsers, setCollapsedUsers] = useState<Set<string>>(new Set())
  const [expandedByUserTask, setExpandedByUserTask] = useState<Set<string>>(new Set())
  const toggleByUserTask = (id: string) => setExpandedByUserTask(prev => {
    const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next
  })

  const draftKey = (taskId: string, idx: number) => `${taskId}:${idx}`
  const getDraft = (taskId: string, idx: number) =>
    commentDraft[draftKey(taskId, idx)] ?? { text: '', photos: [], uploading: false }
  const setDraft = (taskId: string, idx: number, patch: Partial<{ text: string; photos: string[]; uploading: boolean }>) =>
    setCommentDraft(prev => ({ ...prev, [draftKey(taskId, idx)]: { ...getDraft(taskId, idx), ...patch } }))

  const load = async () => {
    setLoading(true)
    try {
      const params: any = {}
      if (filterStatus) params.status = filterStatus
      if (filterAssigned) {
        params.assigned_to = filterAssigned
      } else if (!isManager && userId) {
        params.assigned_to = userId
      }
      if (filterPeriodFrom || filterPeriodTo) {
        if (filterPeriodFrom) params.date_from = filterPeriodFrom
        if (filterPeriodTo) params.date_to = filterPeriodTo
      } else if (viewDate === today) {
        // hoje: view=default inclui tarefas atrasadas
        params.view = 'default'
      } else {
        // outro dia: filtra exatamente pelo dia navegado
        params.date_from = viewDate
        params.date_to = viewDate
      }
      const res = await api.get<DailyTask[]>('/daily-tasks', { params })
      setTasks(res.data)
    } catch { toast.error('Erro ao carregar tarefas.') }
    finally { setLoading(false) }
  }

  const loadUsers = async () => {
    try {
      const res = await api.get<GroupUser[]>('/daily-tasks/users/group')
      setUsers(res.data)
    } catch { /* silent */ }
  }

  useEffect(() => { load() }, [viewDate, filterStatus, filterAssigned, filterPeriodFrom, filterPeriodTo])
  useEffect(() => { loadUsers() }, [])

  const loadComments = async (taskId: string) => {
    try {
      const res = await api.get<TaskComment[]>(`/daily-tasks/${taskId}/comments`)
      setComments(prev => ({ ...prev, [taskId]: res.data }))
    } catch { /* silent */ }
  }

  const toggleExpanded = (taskId: string) => {
    const next = expandedId === taskId ? null : taskId
    setExpandedId(next)
    if (next) loadComments(next)
  }

  const handleCommentPhotoUpload = async (taskId: string, idx: number, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setDraft(taskId, idx, { uploading: true })
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('folder', 'task-comments')
      const res = await api.post<{ url: string }>('/uploads', fd)
      setDraft(taskId, idx, { photos: [...getDraft(taskId, idx).photos, res.data.url], uploading: false })
    } catch {
      toast.error('Erro ao enviar foto.')
      setDraft(taskId, idx, { uploading: false })
    } finally { e.target.value = '' }
  }

  const submitComment = async (taskId: string, checklistIdx: number) => {
    const draft = getDraft(taskId, checklistIdx)
    if (!draft.text.trim() && draft.photos.length === 0) return
    setSavingComment(true)
    try {
      const res = await api.post<TaskComment>(`/daily-tasks/${taskId}/comments`, {
        comment: draft.text.trim(),
        attachment_urls: draft.photos,
        checklist_index: checklistIdx,
      })
      setComments(prev => ({ ...prev, [taskId]: [...(prev[taskId] || []), res.data] }))
      setDraft(taskId, checklistIdx, { text: '', photos: [] })
    } catch { toast.error('Erro ao salvar acompanhamento.') }
    finally { setSavingComment(false) }
  }

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadingFile(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('folder', 'daily-tasks')
      const res = await api.post<{ url: string }>('/uploads', fd)
      setFAttachments(prev => [...prev, res.data.url])
    } catch { toast.error('Erro ao enviar arquivo.') }
    finally { setUploadingFile(false); e.target.value = '' }
  }

  const resetForm = () => {
    setFTitle(''); setFDesc(''); setFAssignedTo(''); setFAssignedName('')
    setFDueDate(''); setFReminder(''); setFChecklist([]); setFCheckInput('')
    setFAttachments([])
    setFSOId(''); setFSOTitle(''); setSOSearch(''); setSOResults([])
    setFInitialStatus('pending')
    setShowForm(false); setEditingId(null)
  }

  const startEdit = (t: DailyTask) => {
    setFTitle(t.title); setFDesc(t.description ?? ''); setFAssignedTo(t.assigned_to ?? '')
    setFAssignedName(t.assigned_to_name ?? ''); setFDueDate(t.due_date ?? '')
    setFReminder(t.reminder_at ? (() => { const d = new Date(t.reminder_at!); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16) })() : '')
    setFChecklist(t.checklist); setFAttachments(t.attachment_urls ?? [])
    setFSOId(t.service_order_id ?? ''); setFSOTitle(t.service_order_title ?? '')
    setEditingId(t.id); setShowForm(true)
  }

  const searchSO = async (q: string) => {
    setSOSearch(q)
    if (q.length < 2) { setSOResults([]); return }
    try {
      const res = await api.get<any[]>('/service-orders/search', { params: { q } })
      setSOResults(res.data)
    } catch { /* silent */ }
  }

  const handleSubmit = async () => {
    if (!fTitle.trim()) { toast.error('Título obrigatório.'); return }
    setSaving(true)
    try {
      const body: any = {
        title: fTitle.trim(),
        description: fDesc || undefined,
        assigned_to: fAssignedTo || undefined,
        assigned_to_name: fAssignedName || undefined,
        due_date: fDueDate || undefined,
        reminder_at: fReminder ? new Date(fReminder).toISOString() : undefined,
        checklist: fChecklist,
        attachment_urls: fAttachments,
        service_order_id: fSOId || undefined,
        service_order_title: fSOTitle || undefined,
      }
      if (!editingId) body.status = fInitialStatus
      if (editingId) {
        await api.patch(`/daily-tasks/${editingId}`, body)
        toast.success('Tarefa atualizada com sucesso.')
      } else {
        await api.post('/daily-tasks', body)
        toast.success('Tarefa criada.')
      }
      resetForm(); load()
    } catch (e: any) {
      const detail = e.response?.data?.detail
      const msg = typeof detail === 'string' ? detail
        : Array.isArray(detail) ? detail.map((d: any) => d.msg ?? d).join('; ')
        : 'Erro ao salvar. Verifique os campos e tente novamente.'
      toast.error(msg, { duration: 6000 })
    } finally { setSaving(false) }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Excluir esta tarefa? Ela ficará na lixeira por 30 dias e pode ser restaurada.')) return
    try {
      await api.delete(`/daily-tasks/${id}`)
      setTasks(prev => prev.filter(t => t.id !== id))
      toast.success('Tarefa movida para a lixeira.')
    } catch { toast.error('Erro ao excluir.') }
  }

  const [deletedTasks, setDeletedTasks] = useState<any[]>([])
  const [showDeleted, setShowDeleted] = useState(false)
  const [showDone, setShowDone] = useState(true)
  const [loadingDeleted, setLoadingDeleted] = useState(false)

  const loadDeleted = async () => {
    setLoadingDeleted(true)
    try {
      const r = await api.get('/daily-tasks/deleted')
      setDeletedTasks(r.data)
    } catch { /* silent */ }
    finally { setLoadingDeleted(false) }
  }

  const handleRestore = async (id: string, title: string) => {
    try {
      await api.post(`/daily-tasks/${id}/restore`)
      setDeletedTasks(prev => prev.filter(t => t.id !== id))
      toast.success(`"${title}" restaurada.`)
      load()
    } catch { toast.error('Erro ao restaurar.') }
  }

  const TASK_STATUS_LABELS: Record<string, string> = {
    pending: 'Pendente', in_progress: 'Em andamento', done: 'Concluída', blocked: 'Bloqueada',
    waiting_validation: 'Ag. Validação',
  }

  const setTaskStatus = async (task: DailyTask, newStatus: DailyTask['status']) => {
    if (newStatus === task.status) return

    if (newStatus === 'done' && !isAdmin) {
      toast.error('Apenas administradores podem concluir tarefas. Use "Ag. Validação" para solicitar aprovação.', { duration: 5000 })
      return
    }

    if (newStatus === 'done' && task.checklist.length > 0) {
      const blocking = ['pending', 'in_progress', 'waiting_third', 'waiting_public']
      const openItems = task.checklist.filter(item => blocking.includes(getItemStatus(item)))
      if (openItems.length > 0) {
        toast.error(
          `Não é possível concluir: ${openItems.length} item(s) ainda em aberto. Abra a tarefa, atualize o status de cada item e registre um acompanhamento antes de finalizar.`,
          { duration: 7000 }
        )
        return
      }
    }

    try {
      await api.patch(`/daily-tasks/${task.id}`, { status: newStatus })
      setTasks(prev => prev.map(t => {
        if (t.id !== task.id) return t
        const checklist = newStatus === 'done'
          ? t.checklist.map(item => {
              const st = getItemStatus(item)
              return ['cancelled', 'postergado'].includes(st) ? item : { ...item, done: true, status: 'done' }
            })
          : t.checklist
        return { ...t, status: newStatus, checklist }
      }))
    } catch (e: any) {
      const detail = e?.response?.data?.detail
      toast.error(
        typeof detail === 'string' ? detail : 'Não foi possível atualizar o status. Verifique os itens da tarefa e tente novamente.',
        { duration: 7000 }
      )
    }
  }

  const cycleStatus = (task: DailyTask) => {
    const cycle: DailyTask['status'][] = ['pending', 'in_progress', 'done', 'blocked']
    const idx = cycle.indexOf(task.status)
    setTaskStatus(task, cycle[(idx + 1) % cycle.length])
  }

  const toggleChecklist = async (task: DailyTask, idx: number) => {
    const checklist = task.checklist.map((item, i) => i === idx ? { ...item, done: !item.done } : item)
    try {
      await api.patch(`/daily-tasks/${task.id}`, { checklist })
      setTasks(prev => prev.map(t => t.id === task.id ? { ...t, checklist } : t))
    } catch { toast.error('Erro ao atualizar checklist.') }
  }

  const saveCommentEdit = async (taskId: string, commentId: string, newText: string) => {
    if (!newText.trim()) return
    setSavingEditComment(commentId)
    try {
      await api.patch(`/daily-tasks/${taskId}/comments/${commentId}`, { comment: newText.trim() })
      setComments(prev => ({
        ...prev,
        [taskId]: (prev[taskId] || []).map(c => c.id === commentId ? { ...c, comment: newText.trim() } : c),
      }))
      setEditingComment(prev => ({ ...prev, [commentId]: null }))
    } catch { toast.error('Erro ao editar comentário.') }
    finally { setSavingEditComment(null) }
  }

  const changeItemStatus = async (task: DailyTask, itemIdx: number, newStatus: string, comment: string) => {
    const statusInfo = ITEM_STATUSES.find(s => s.value === newStatus)
    const checklist = task.checklist.map((item, i) =>
      i === itemIdx ? { ...item, status: newStatus, done: newStatus === 'done' } : item
    )
    try {
      await api.patch(`/daily-tasks/${task.id}`, { checklist })
      await api.post(`/daily-tasks/${task.id}/comments`, {
        comment: `[${statusInfo?.label ?? newStatus}] ${comment}`,
        checklist_index: itemIdx,
        attachment_urls: [],
      })
      setTasks(prev => prev.map(t => t.id === task.id ? { ...t, checklist } : t))
      setComments(prev => { const n = { ...prev }; delete n[task.id]; return n })
      loadComments(task.id)
      const scKey = `${task.id}:${itemIdx}`
      setStatusChangeOpen(prev => ({ ...prev, [scKey]: false }))
      setStatusChangeDraft(prev => ({ ...prev, [scKey]: { newStatus, comment: '' } }))
      setExpandedAcomp(prev => ({ ...prev, [scKey]: true }))
      toast.success('Status atualizado.')
    } catch { toast.error('Erro ao atualizar status.') }
  }

  const loadReport = async () => {
    setLoadingReport(true)
    try {
      const res = await api.get('/daily-tasks/report/by-user', {
        params: {
          date_from: reportFrom || undefined,
          date_to: reportTo || undefined,
          user_id: reportUserId || undefined,
        }
      })
      setReportData(res.data)
    } catch { toast.error('Erro ao carregar relatório.') }
    finally { setLoadingReport(false) }
  }

  const downloadPdf = async () => {
    try {
      const params: any = { _t: Date.now() }
      if (reportFrom) params.date_from = reportFrom
      if (reportTo) params.date_to = reportTo
      if (reportUserId) params.user_id = reportUserId
      const res = await api.get('/daily-tasks/report/pdf', { params, responseType: 'blob' })

      // extrai filename do Content-Disposition (com fallback)
      const disp = res.headers?.['content-disposition'] || res.headers?.['Content-Disposition'] || ''
      const match = disp.match(/filename\*?=(?:UTF-8'')?["']?([^"';]+)["']?/i)
      const fname = match
        ? decodeURIComponent(match[1])
        : `Tarefas - ${reportFrom || 'periodo'}.pdf`

      const url = URL.createObjectURL(res.data)
      const a = document.createElement('a')
      a.href = url; a.download = fname
      a.click(); URL.revokeObjectURL(url)
    } catch { toast.error('Erro ao gerar PDF.') }
  }

  // Moved before showReport early-return to avoid React hooks violation
  const statusOrder: Record<string, number> = { pending: 0, in_progress: 1, blocked: 2, waiting_validation: 3, done: 4 }
  const doneTasks = useMemo(() => tasks.filter(t => t.status === 'done' && (!onlyMine || t.assigned_to === userId)), [tasks, onlyMine, userId])
  const sortFn = (a: DailyTask, b: DailyTask) => {
    if (!sortBy) {
      const sd = (statusOrder[a.status] ?? 9) - (statusOrder[b.status] ?? 9)
      if (sd !== 0) return sd
      return (b.created_at ?? '') < (a.created_at ?? '') ? -1 : 1
    }
    let va = '', vb = ''
    if (sortBy === 'title') { va = a.title.toLowerCase(); vb = b.title.toLowerCase() }
    else if (sortBy === 'assigned') { va = (a.assigned_to_name ?? '').toLowerCase(); vb = (b.assigned_to_name ?? '').toLowerCase() }
    else if (sortBy === 'due_date') { va = a.due_date ?? '9999'; vb = b.due_date ?? '9999' }
    else if (sortBy === 'status') { va = String(statusOrder[a.status] ?? 9); vb = String(statusOrder[b.status] ?? 9) }
    else if (sortBy === 'created_at') { va = a.created_at ?? ''; vb = b.created_at ?? '' }
    else if (sortBy === 'updated_at') { va = a.updated_at ?? ''; vb = b.updated_at ?? '' }
    const cmp = va < vb ? -1 : va > vb ? 1 : 0
    return sortDir === 'asc' ? cmp : -cmp
  }
  const displayedTasks = useMemo(() => [...tasks]
    .filter(t => t.status !== 'done' && (!onlyMine || t.assigned_to === userId))
    .sort(sortFn), [tasks, onlyMine, userId, sortBy, sortDir])
  const myTasks = useMemo(() => displayedTasks.filter(t => t.assigned_to === userId), [displayedTasks, userId])
  const otherTasks = useMemo(() => displayedTasks.filter(t => t.assigned_to !== userId), [displayedTasks, userId])

  const byUserSortDesc = (a: DailyTask, b: DailyTask) =>
    (b.updated_at ?? b.created_at ?? '') > (a.updated_at ?? a.created_at ?? '') ? 1 : -1

  const tasksByUser = useMemo(() => {
    const map = new Map<string, { name: string; tasks: DailyTask[] }>()
    for (const t of tasks.filter(t => t.status !== 'done' && t.assigned_to !== userId)) {
      const key = t.assigned_to ?? '__unassigned__'
      const name = t.assigned_to_name ?? 'Sem responsável'
      if (!map.has(key)) map.set(key, { name, tasks: [] })
      map.get(key)!.tasks.push(t)
    }
    return Array.from(map.entries())
      .map(([uid, v]) => ({ uid, name: v.name, tasks: [...v.tasks].sort(byUserSortDesc) }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [tasks, userId])

  const taskForm = (
    <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 flex flex-col gap-3">
      <p className="text-xs font-semibold text-blue-800">{editingId ? 'Editar Tarefa' : 'Nova Tarefa Diária'}</p>
      <input value={fTitle} onChange={e => setFTitle(e.target.value)} placeholder="Título *" className={inputCls} />
      <textarea rows={2} value={fDesc} onChange={e => setFDesc(e.target.value)} placeholder="Descrição / observações" className={`${inputCls} resize-none`} />
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="block text-xs text-gray-600 mb-1">Responsável</label>
          <select value={fAssignedTo} onChange={e => {
            const u = users.find(u => u.id === e.target.value)
            setFAssignedTo(e.target.value)
            setFAssignedName(u?.full_name ?? '')
          }} className={inputCls}>
            <option value="">Sem responsável</option>
            {users.map(u => <option key={u.id} value={u.id}>{u.full_name}{u.assoc_name ? ` — ${u.assoc_name}` : ''}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-600 mb-1">Prazo</label>
          <input type="date" value={fDueDate} onChange={e => setFDueDate(e.target.value)} className={inputCls} />
        </div>
      </div>
      <div>
        <label className="block text-xs text-gray-600 mb-1">Lembrete</label>
        <input type="datetime-local" value={fReminder} onChange={e => setFReminder(e.target.value)} className={inputCls} />
      </div>
      <div>
        <label className="block text-xs text-gray-600 mb-1">O.S. vinculada (opcional)</label>
        <div className="relative">
          <input value={soSearch || fSOTitle} onChange={e => searchSO(e.target.value)}
            placeholder="Buscar OS por número ou título…" className={inputCls} />
          {soResults.length > 0 && (
            <div className="absolute z-10 bg-white border border-gray-200 rounded-lg shadow-lg w-full mt-1 max-h-40 overflow-y-auto">
              {soResults.map(s => (
                <button key={s.id} type="button" onClick={() => {
                  setFSOId(s.id); setFSOTitle(`#${s.number} — ${s.title}`)
                  setSOSearch(''); setSOResults([])
                }} className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50 border-b border-gray-100 last:border-0">
                  <span className="font-medium">OS #{s.number}</span> — {s.title}
                </button>
              ))}
            </div>
          )}
        </div>
        {fSOId && (
          <div className="mt-1 flex items-center gap-2">
            <span className="text-xs text-blue-700 bg-blue-50 px-2 py-0.5 rounded-full">{fSOTitle}</span>
            <button type="button" onClick={() => { setFSOId(''); setFSOTitle('') }} className="text-gray-400 hover:text-red-500 text-xs">✕</button>
          </div>
        )}
      </div>
      {!editingId && (
        <div>
          <label className="block text-xs text-gray-600 mb-1">Status inicial</label>
          <select value={fInitialStatus} onChange={e => setFInitialStatus(e.target.value)} className={inputCls}>
            <option value="pending">⬜ Pendente</option>
            <option value="in_progress">🔄 Em andamento</option>
          </select>
        </div>
      )}
      <hr className="border-gray-200 my-1" />
      <div>
        <label className="block text-xs text-gray-600 mb-0.5">Itens a entregar</label>
        <p className="text-[10px] text-gray-400 mb-1">Cada item representa uma entrega a confirmar</p>
        <div className="flex gap-2 mb-2">
          <input value={fCheckInput} onChange={e => setFCheckInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), fCheckInput.trim() && (setFChecklist(p => [...p, { text: fCheckInput.trim(), done: false, status: 'pending' }]), setFCheckInput('')))}
            placeholder="Adicionar item…" className={inputCls} />
          <button type="button" onClick={() => { if (fCheckInput.trim()) { setFChecklist(p => [...p, { text: fCheckInput.trim(), done: false, status: 'pending' }]); setFCheckInput('') } }}
            className="px-3 py-2 bg-[#26619c] text-white rounded-lg text-xs shrink-0">+</button>
        </div>
        {fChecklist.length > 0 && (
          <ul className="flex flex-col gap-1">
            {fChecklist.map((item, i) => (
              <li key={i} className="flex items-center gap-2 text-sm bg-white rounded-lg px-3 py-1.5 border border-gray-200">
                <span className="flex-1">{item.text}</span>
                <button onClick={() => setFChecklist(p => p.filter((_, j) => j !== i))} className="text-gray-400 hover:text-red-500 text-xs">✕</button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div>
        <label className="block text-xs text-gray-600 mb-1">Anexos</label>
        <label className={`flex items-center gap-2 cursor-pointer border border-dashed border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-500 hover:bg-gray-50 transition ${uploadingFile ? 'opacity-50 pointer-events-none' : ''}`}>
          📎 {uploadingFile ? 'Enviando…' : 'Adicionar arquivo'}
          <input type="file" className="hidden" onChange={handleFileUpload} disabled={uploadingFile} />
        </label>
        {fAttachments.length > 0 && (
          <ul className="flex flex-col gap-1 mt-2">
            {fAttachments.map((url, i) => {
              const name = decodeURIComponent(url.split('/').pop() ?? 'arquivo')
              const isImg = /\.(jpe?g|png|gif|webp|svg)$/i.test(url)
              const isPdf = /\.pdf$/i.test(url)
              return (
                <li key={i} className="flex items-center gap-2 bg-white border border-gray-200 rounded-lg px-3 py-1.5 text-xs">
                  <span className="text-gray-400 shrink-0">{isImg ? '🖼' : isPdf ? '📄' : '📎'}</span>
                  <button
                    type="button"
                    onClick={() => setViewerUrl(url)}
                    className="flex-1 text-blue-600 hover:underline truncate text-left"
                  >{name}</button>
                  <button onClick={() => setFAttachments(p => p.filter((_, j) => j !== i))} className="text-gray-400 hover:text-red-500 shrink-0">✕</button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
      <div className="flex gap-2">
        <button onClick={resetForm} className="flex-1 border border-gray-300 text-gray-600 py-2 rounded-xl text-sm">Cancelar</button>
        <button onClick={handleSubmit} disabled={saving} className="flex-1 bg-[#26619c] text-white py-2 rounded-xl text-sm font-semibold disabled:opacity-50">
          {saving ? 'Salvando…' : editingId ? 'Atualizar' : 'Criar'}
        </button>
      </div>
    </div>
  )

  if (showReport) {
    const handlePrint = () => {
      document.body.classList.add('printing-tasks-report')
      const restore = () => { document.body.classList.remove('printing-tasks-report'); window.removeEventListener('afterprint', restore) }
      window.addEventListener('afterprint', restore)
      setTimeout(() => window.print(), 50)
    }
    const fmtBR = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString('pt-BR')
    const periodLabel = reportFrom || reportTo
      ? `${reportFrom ? fmtBR(reportFrom) : '—'}  →  ${reportTo ? fmtBR(reportTo) : '—'}`
      : 'Todo o período'

    return (
      <div className="flex flex-col gap-4">
        <div className="no-print flex items-center gap-3">
          <button onClick={() => setShowReport(false)} className="text-sm text-[#26619c] hover:underline flex items-center gap-1">← Voltar</button>
          <h2 className="text-base font-semibold text-gray-800">Relatório por Colaborador</h2>
        </div>
        <div className="no-print flex gap-2 items-end flex-wrap">
          <div>
            <label className="block text-xs text-gray-500 mb-1">De</label>
            <input type="date" value={reportFrom} onChange={e => setReportFrom(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Até</label>
            <input type="date" value={reportTo} onChange={e => setReportTo(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Operador</label>
            <select value={reportUserId} onChange={e => setReportUserId(e.target.value)} className={inputCls}>
              <option value="">Todos</option>
              {users.map(u => {
                const dup = users.filter(x => x.full_name === u.full_name).length > 1
                return <option key={u.id} value={u.id}>{u.full_name}{dup && u.assoc_name ? ` — ${u.assoc_name}` : ''}</option>
              })}
            </select>
          </div>
          <button onClick={loadReport} disabled={loadingReport}
            className="px-4 py-2 bg-[#26619c] text-white rounded-xl text-sm font-medium disabled:opacity-50">
            {loadingReport ? 'Carregando…' : 'Gerar'}
          </button>
          {reportData.length > 0 && (
            <>
              <button onClick={handlePrint}
                className="flex items-center gap-1.5 border border-gray-300 text-gray-700 px-3 py-2 rounded-xl text-sm hover:bg-gray-50 font-medium">
                🖨 Imprimir
              </button>
              <button onClick={downloadPdf}
                className="flex items-center gap-1.5 border border-gray-200 text-gray-600 px-3 py-2 rounded-xl text-sm hover:bg-gray-50">
                📄 Baixar PDF
              </button>
            </>
          )}
        </div>

        {reportData.length === 0 && !loadingReport && (
          <p className="no-print text-sm text-gray-400 text-center py-8">Clique em "Gerar" para ver o relatório.</p>
        )}

        <div id="tasks-report-print" className="flex flex-col gap-4">
          {reportData.map((user, ui) => {
            const pct = user.total_items > 0 ? Math.round((user.done_items / user.total_items) * 100) : 0
            const pctColor = pct >= 80 ? '#15803d' : pct >= 50 ? '#a16207' : '#b91c1c'
            const pendentes = Math.max(0, user.total - user.concluidas - user.atrasadas - (user.bloqueadas ?? 0))
            const hasOS = (user.os_entregas?.length ?? 0) + (user.os_andamento?.length ?? 0) > 0
            return (
              <article key={ui} className="report-card bg-white border border-gray-200 rounded-2xl px-5 py-4 shadow-sm">
                {/* Header */}
                <header className="flex items-start justify-between gap-3 pb-3 border-b border-gray-200">
                  <div className="min-w-0">
                    <p className="text-[9px] uppercase tracking-[0.18em] text-gray-400 font-semibold mb-0.5">Colaborador</p>
                    <h3 className="text-lg font-bold text-gray-900 leading-tight">{user.user_name}</h3>
                    <p className="text-[10px] text-gray-400 mt-0.5 tabular-nums">{periodLabel}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="font-mono text-2xl font-bold tabular-nums leading-none" style={{ color: pctColor }}>{pct}<span className="text-sm text-gray-400">%</span></p>
                    <p className="text-[9px] uppercase tracking-wider text-gray-400">checklist</p>
                  </div>
                </header>

                {/* KPI strip — 6 colunas compactas */}
                <div className="grid grid-cols-6 gap-1.5 mt-3 mb-3">
                  {[
                    { v: user.total, label: 'Total', color: 'border-gray-300', tc: 'text-gray-900' },
                    { v: user.concluidas, label: 'Feitas', color: 'border-green-600', tc: 'text-green-700' },
                    { v: pendentes, label: 'Pend.', color: 'border-yellow-500', tc: 'text-yellow-700' },
                    { v: user.atrasadas, label: 'Atraso', color: user.atrasadas > 0 ? 'border-red-600' : 'border-gray-200', tc: user.atrasadas > 0 ? 'text-red-700' : 'text-gray-300' },
                    { v: user.bloqueadas ?? 0, label: 'Bloq.', color: (user.bloqueadas ?? 0) > 0 ? 'border-orange-500' : 'border-gray-200', tc: (user.bloqueadas ?? 0) > 0 ? 'text-orange-600' : 'text-gray-300' },
                    { v: user.total_os ?? 0, label: 'O.S.', color: 'border-blue-400', tc: 'text-blue-700' },
                  ].map(({ v, label, color, tc }) => (
                    <div key={label} className={`border-l-2 pl-2 ${color}`}>
                      <p className={`font-mono text-base font-bold tabular-nums leading-none ${tc}`}>{v}</p>
                      <p className="text-[9px] uppercase tracking-wide text-gray-400 mt-0.5">{label}</p>
                    </div>
                  ))}
                </div>

                {/* Tarefas com comentários inline */}
                {(user.tasks?.length ?? 0) > 0 && (
                  <section className={hasOS ? 'mb-3' : ''}>
                    <h4 className="text-[9px] font-bold text-gray-500 uppercase tracking-[0.18em] mb-1.5 pb-1 border-b border-gray-100">Tarefas Diárias</h4>
                    <ul className="flex flex-col divide-y divide-gray-100">
                      {(user.tasks ?? []).map((t: any) => {
                        const overdue = t.status !== 'done' && t.status !== 'blocked' && t.due_date && t.due_date < today
                        const effStatus = overdue ? 'overdue' : t.status
                        const dotColor = effStatus === 'done' ? 'bg-green-600' : effStatus === 'overdue' ? 'bg-red-500' : effStatus === 'in_progress' ? 'bg-blue-500' : effStatus === 'blocked' ? 'bg-orange-500' : 'bg-gray-300'
                        const statusLabel = effStatus === 'overdue' ? 'Em Atraso' : TASK_STATUS_LABELS[t.status] ?? t.status
                        return (
                          <li key={t.id} className="py-2">
                            <div className="flex items-start gap-2">
                              <span aria-hidden className={`mt-1 inline-block w-2 h-2 rounded-full shrink-0 ${dotColor}`} />
                              <div className="flex-1 min-w-0">
                                <div className="flex items-baseline gap-2 flex-wrap">
                                  <p className={`text-[12px] font-semibold leading-snug ${t.status === 'done' ? 'line-through text-gray-400' : 'text-gray-900'}`}>{t.title}</p>
                                  <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded ${
                                    effStatus === 'done' ? 'bg-green-50 text-green-700' :
                                    effStatus === 'overdue' ? 'bg-red-50 text-red-700' :
                                    effStatus === 'in_progress' ? 'bg-blue-50 text-blue-700' :
                                    effStatus === 'blocked' ? 'bg-orange-50 text-orange-700' :
                                    'bg-gray-100 text-gray-500'
                                  }`}>{statusLabel}</span>
                                  {t.due_date && <span className={`text-[10px] tabular-nums ${overdue ? 'text-red-500 font-semibold' : 'text-gray-400'}`}>{fmtBR(t.due_date)}</span>}
                                  {t.so_title && <span className="text-[10px] text-[#26619c]">OS: {t.so_title}</span>}
                                </div>
                                {/* Checklist + acompanhamentos intercalados por índice */}
                                {t.checklist?.length > 0 && (
                                  <ul className="mt-1 flex flex-col gap-0.5">
                                    {t.checklist.map((cl: any, ci: number) => {
                                      const itemComments = (t.comments ?? []).filter((c: any) => c.checklist_index === ci)
                                      return (
                                        <li key={ci}>
                                          <div className="flex items-baseline gap-1.5 text-[11px] leading-snug">
                                            <span className={`font-mono shrink-0 text-[10px] ${cl.done ? 'text-green-600' : 'text-gray-300'}`}>{cl.done ? '✓' : '○'}</span>
                                            <span className={`font-bold ${cl.done ? 'line-through text-gray-400' : 'text-gray-900'}`}>{cl.text}</span>
                                          </div>
                                          {itemComments.map((c: any) => (
                                            <div key={c.id} className="flex items-baseline gap-1.5 pl-4 text-[10px] text-gray-500 leading-snug">
                                              <span className="shrink-0">↳</span>
                                              <span className="italic">{c.comment}</span>
                                              <span className="shrink-0 tabular-nums ml-1">{c.created_at?.slice(0,10)}</span>
                                            </div>
                                          ))}
                                        </li>
                                      )
                                    })}
                                  </ul>
                                )}
                                {/* Comentários gerais (sem checklist_index) */}
                                {(t.comments ?? []).filter((c: any) => c.checklist_index == null).map((c: any) => (
                                  <div key={c.id} className="flex items-baseline gap-1.5 mt-0.5 pl-3 text-[10px] text-gray-500 leading-snug">
                                    <span className="shrink-0">↳</span>
                                    <span className="italic">{c.comment}</span>
                                    <span className="shrink-0 tabular-nums ml-1">{c.created_at?.slice(0,10)}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          </li>
                        )
                      })}
                    </ul>
                  </section>
                )}

                {/* Ordens de Serviço — compacto */}
                {hasOS && (
                  <section className="mt-2 pt-2 border-t border-dashed border-gray-200">
                    <h4 className="text-[9px] font-bold text-gray-500 uppercase tracking-[0.18em] mb-1.5">Ordens de Serviço</h4>
                    <ul className="flex flex-col divide-y divide-gray-100">
                      {user.os_entregas?.map((o: any, i: number) => (
                        <li key={`e-${i}`} className="py-1.5 flex items-start gap-2">
                          <span aria-hidden className="mt-0.5 inline-block w-2 h-2 rounded-full bg-green-600 shrink-0" />
                          <div className="flex-1 min-w-0">
                            <span className="text-[11px] font-medium text-gray-900">
                              {o.so_number ? <span className="font-mono text-[10px] text-gray-400 mr-1">#{String(o.so_number).padStart(4,'0')}</span> : null}
                              {o.so_title}
                            </span>
                            <span className="ml-2 text-[9px] bg-green-50 text-green-700 font-semibold px-1 rounded">Resolvida</span>
                          </div>
                        </li>
                      ))}
                      {user.os_andamento?.map((o: any, i: number) => (
                        <li key={`a-${i}`} className="py-1.5 flex items-start gap-2">
                          <span aria-hidden className={`mt-0.5 inline-block w-2 h-2 rounded-full shrink-0 ${o.action === 'in_progress' ? 'bg-blue-500' : 'bg-gray-400'}`} />
                          <div className="flex-1 min-w-0">
                            <span className="text-[11px] font-medium text-gray-900">
                              {o.so_number ? <span className="font-mono text-[10px] text-gray-400 mr-1">#{String(o.so_number).padStart(4,'0')}</span> : null}
                              {o.so_title}
                            </span>
                            <span className={`ml-2 text-[9px] font-semibold px-1 rounded ${o.action === 'in_progress' ? 'bg-blue-50 text-blue-700' : 'bg-gray-100 text-gray-500'}`}>
                              {o.action === 'in_progress' ? 'Iniciou' : o.action === 'cancelled' ? 'Cancelou' : 'Comentou'}
                            </span>
                            {o.action === 'commented' && o.comment && (
                              <p className="text-[10px] text-gray-500 italic truncate mt-0.5">{o.comment}</p>
                            )}
                          </div>
                        </li>
                      ))}
                    </ul>
                  </section>
                )}
              </article>
            )
          })}
        </div>
      </div>
    )
  }

  const avatarColor = (name: string) => {
    const colors = ['#26619c', '#7c3aed', '#059669', '#dc2626', '#d97706', '#0891b2']
    let hash = 0
    for (const c of name) hash = (hash * 31 + c.charCodeAt(0)) & 0xffff
    return colors[hash % colors.length]
  }
  const relTime = (isoStr: string) => {
    const diff = Date.now() - new Date(isoStr).getTime()
    const m = Math.floor(diff / 60000)
    if (m < 1) return 'agora'
    if (m < 60) return `há ${m}min`
    const h = Math.floor(m / 60)
    if (h < 24) return `há ${h}h`
    return `há ${Math.floor(h / 24)}d`
  }

  const toggleSort = (col: typeof sortBy) => {
    if (sortBy === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortBy(col); setSortDir('asc') }
  }

  const SortBtn = ({ col, label }: { col: typeof sortBy; label: string }) => (
    <button
      onClick={() => toggleSort(col)}
      className={`flex items-center gap-0.5 text-xs font-medium transition select-none ${sortBy === col ? 'text-[#26619c]' : 'text-gray-500 hover:text-gray-700'}`}
    >
      {label}
      <span className="text-[10px] ml-0.5">
        {sortBy === col ? (sortDir === 'asc' ? '▲' : '▼') : '⇅'}
      </span>
    </button>
  )

  return (
    <div className="flex flex-col gap-3">
      {/* ── Barra de controles ── */}
      <div className="flex items-center gap-2 flex-wrap">
        {/* Navegação de data */}
        <div className="flex items-center gap-0.5 border border-gray-200 rounded-xl overflow-hidden bg-white shrink-0">
          <button onClick={() => {
            const d = new Date(viewDate + 'T12:00:00'); d.setDate(d.getDate() - 1)
            setViewDate(d.toISOString().slice(0, 10)); setFilterPeriodFrom(''); setFilterPeriodTo('')
          }} className="w-8 h-8 flex items-center justify-center text-gray-500 hover:bg-gray-50 text-xs">←</button>
          <span className="px-2 text-xs font-semibold text-gray-700 border-x border-gray-200 h-8 flex items-center min-w-[52px] justify-center">
            {viewDate === today ? 'Hoje' : new Date(viewDate + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}
          </span>
          <button onClick={() => {
            const d = new Date(viewDate + 'T12:00:00'); d.setDate(d.getDate() + 1)
            setViewDate(d.toISOString().slice(0, 10)); setFilterPeriodFrom(''); setFilterPeriodTo('')
          }} className="w-8 h-8 flex items-center justify-center text-gray-500 hover:bg-gray-50 text-xs">→</button>
        </div>

        {/* Filtro status — chips */}
        <div className="flex items-center gap-1 flex-wrap">
          {[['', 'Todos'], ['pending', 'Pendente'], ['in_progress', 'Andamento'], ['waiting_validation', 'Ag. Validação'], ['done', 'Concluídas']].map(([v, label]) => (
            <button key={v} onClick={() => setFilterStatus(v)}
              className={`h-7 px-2.5 rounded-full text-xs font-medium border transition ${filterStatus === v ? 'bg-[#26619c] text-white border-[#26619c]' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'}`}>
              {label}
            </button>
          ))}
        </div>

        {/* Filtro responsável */}
        <select value={filterAssigned} onChange={e => setFilterAssigned(e.target.value)}
          className="h-7 border border-gray-200 rounded-full px-2.5 text-xs text-gray-600 bg-white appearance-none cursor-pointer">
          <option value="">Todos</option>
          {users.map(u => {
            const dup = users.filter(x => x.full_name === u.full_name).length > 1
            return <option key={u.id} value={u.id}>{u.full_name}{dup && u.assoc_name ? ` — ${u.assoc_name}` : ''}</option>
          })}
        </select>

        {/* Período */}
        <div className="flex items-center gap-1">
          <input type="date" value={filterPeriodFrom}
            onChange={e => { setFilterPeriodFrom(e.target.value); setViewDate(today) }}
            className="h-7 border border-gray-200 rounded-full px-2.5 text-xs text-gray-600 min-w-0 w-32" />
          <span className="text-xs text-gray-400">–</span>
          <input type="date" value={filterPeriodTo}
            onChange={e => { setFilterPeriodTo(e.target.value); setViewDate(today) }}
            className="h-7 border border-gray-200 rounded-full px-2.5 text-xs text-gray-600 min-w-0 w-32" />
        </div>

        {/* Só minhas + contagem + ações */}
        <div className="flex items-center gap-2 ml-auto shrink-0">
          <label className="flex items-center gap-1.5 cursor-pointer select-none">
            <input type="checkbox" checked={onlyMine} onChange={e => setOnlyMine(e.target.checked)}
              className="w-3.5 h-3.5 accent-[#26619c]" />
            <span className="text-xs text-gray-500">Minhas</span>
          </label>
          <span className="text-xs text-gray-400 font-medium">{displayedTasks.length}</span>
          {isAdmin && (
            <div className="flex border border-gray-200 rounded-lg overflow-hidden">
              <button onClick={() => setViewMode('byUser')}
                className={`px-2 py-1 ${viewMode === 'byUser' ? 'bg-[#26619c] text-white' : 'text-gray-500 hover:bg-gray-50'} transition`}
                title="Visão por usuário">
                <LayoutDashboard className="w-3.5 h-3.5" />
              </button>
              <button onClick={() => setViewMode('list')}
                className={`px-2 py-1 border-l border-gray-200 ${viewMode === 'list' ? 'bg-[#26619c] text-white' : 'text-gray-500 hover:bg-gray-50'} transition`}
                title="Lista">
                <Tag className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
          <button onClick={() => setShowReport(true)}
            className="w-7 h-7 flex items-center justify-center border border-gray-200 text-gray-500 rounded-lg hover:bg-gray-50 transition" title="Relatório">
            <FileText className="w-3.5 h-3.5" />
          </button>
          {canWrite && !showForm && (
            <button onClick={() => setShowForm(true)}
              className="h-7 flex items-center gap-1 bg-[#26619c] hover:bg-[#1a4f87] text-white px-2.5 rounded-lg text-xs font-semibold transition">
              <Plus className="w-3.5 h-3.5" />Nova
            </button>
          )}
        </div>
      </div>

      {showForm && taskForm}

      {loading && <p className="text-sm text-gray-400 text-center py-8">Carregando…</p>}

      {!loading && displayedTasks.length === 0 && !showForm && (
        <p className="text-sm text-gray-400 text-center py-10">{tasks.length === 0 ? 'Nenhuma tarefa. Crie a primeira!' : 'Nenhuma tarefa corresponde ao filtro.'}</p>
      )}

      {/* ── Visão por usuário (admin): minhas tarefas em cima, outros agrupados abaixo ── */}
      {!loading && isAdmin && viewMode === 'byUser' && (
        <div className="flex flex-col gap-3">
          {/* Minhas tarefas — lista normal */}
          {myTasks.length > 0 && (
            <>
              <div className="flex items-center gap-2 px-1">
                <span className="text-xs font-semibold text-[#26619c]">Minhas tarefas</span>
                <span className="text-xs bg-[#26619c]/10 text-[#26619c] px-1.5 py-0.5 rounded-full font-semibold">{myTasks.length}</span>
              </div>
              {[...myTasks].sort(byUserSortDesc).map(t => {
                const itemDone = t.checklist.filter(i => ['done','cancelled','postergado'].includes(i.status ?? (i.done ? 'done' : ''))).length
                const overdue = t.due_date && t.due_date < today
                const isOpen = expandedByUserTask.has(t.id)
                return (
                  <div key={t.id} className={`rounded-2xl border shadow-sm overflow-hidden ${
                    t.status === 'in_progress' ? 'border-amber-200 bg-amber-50/40' :
                    t.status === 'waiting_validation' ? 'border-yellow-300 bg-yellow-50/50' :
                    overdue ? 'border-red-200 bg-red-50/30' : 'border-gray-200 bg-white'
                  }`}>
                    <button onClick={() => toggleByUserTask(t.id)} className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-black/[.02] transition">
                      <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                        t.status === 'in_progress' ? 'bg-amber-400' :
                        t.status === 'blocked' ? 'bg-red-500' :
                        t.status === 'waiting_validation' ? 'bg-yellow-400' : 'bg-gray-300'
                      }`} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-800 truncate">{t.title}</p>
                        {t.description && <p className="text-xs text-gray-400 truncate">{t.description}</p>}
                      </div>
                      {t.checklist.length > 0 && <span className="text-xs text-gray-400 shrink-0">{itemDone}/{t.checklist.length}</span>}
                      {t.due_date && <span className={`text-xs shrink-0 ${overdue ? 'text-red-500 font-semibold' : 'text-gray-400'}`}>{t.due_date.slice(5)}</span>}
                      <span className={`text-xs px-2 py-0.5 rounded-full shrink-0 font-medium ${
                        t.status === 'in_progress' ? 'bg-amber-100 text-amber-700' :
                        t.status === 'blocked' ? 'bg-red-100 text-red-600' :
                        t.status === 'waiting_validation' ? 'bg-yellow-100 text-yellow-700' : 'bg-gray-100 text-gray-500'
                      }`}>
                        {t.status === 'in_progress' ? 'Andamento' : t.status === 'blocked' ? 'Bloqueada' : t.status === 'waiting_validation' ? 'Validação' : 'Pendente'}
                      </span>
                      <span className="text-gray-300 text-xs shrink-0">{isOpen ? '▲' : '▼'}</span>
                    </button>
                    {isOpen && t.checklist.length > 0 && (
                      <div className="border-t border-gray-100 px-4 py-2 flex flex-col gap-1.5">
                        {t.checklist.map((item, idx) => {
                          const st = item.status ?? (item.done ? 'done' : 'pending')
                          return (
                            <div key={idx} className="flex items-center gap-2">
                              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${st === 'done' ? 'bg-green-400' : st === 'cancelled' ? 'bg-gray-300' : 'bg-gray-400'}`} />
                              <p className={`text-xs ${st === 'done' ? 'line-through text-gray-400' : 'text-gray-600'}`}>{item.text}</p>
                            </div>
                          )
                        })}
                      </div>
                    )}
                    {isOpen && t.description && t.checklist.length === 0 && (
                      <p className="border-t border-gray-100 px-4 py-2 text-xs text-gray-500">{t.description}</p>
                    )}
                  </div>
                )
              })}
            </>
          )}

          {/* Outros usuários — agrupados, colapsáveis */}
          {tasksByUser.length > 0 && (
            <>
              <div className="flex items-center gap-2 px-1 mt-1">
                <div className="flex-1 h-px bg-gray-200" />
                <span className="text-xs font-semibold text-gray-400">Equipe</span>
                <div className="flex-1 h-px bg-gray-200" />
              </div>
              {tasksByUser.map(({ uid, name, tasks: uTasks }) => {
                const doneCount = tasks.filter(t => t.status === 'done' && t.assigned_to === uid).length
                const total = uTasks.length + doneCount
                const pct = total > 0 ? Math.round((doneCount / total) * 100) : 0
                const isCollapsed = collapsedUsers.has(uid)
                const toggle = () => setCollapsedUsers(prev => {
                  const next = new Set(prev)
                  next.has(uid) ? next.delete(uid) : next.add(uid)
                  return next
                })
                const initials = name.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase()
                const allDone = uTasks.length === 0
                return (
                  <div key={uid} className={`rounded-2xl border overflow-hidden ${allDone ? 'border-green-200 bg-green-50/30' : 'border-gray-200 bg-white'}`}>
                    <button onClick={toggle} className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50/60 transition text-left">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${allDone ? 'bg-green-100 text-green-700' : 'bg-[#26619c]/10 text-[#26619c]'}`}>
                        {allDone ? '✓' : initials}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-gray-800 truncate">{name}</span>
                          {allDone && <span className="text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full font-semibold">Concluído</span>}
                        </div>
                        <div className="flex items-center gap-2 mt-1">
                          <div className="w-20 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                            <div className="h-full bg-green-400 rounded-full transition-all" style={{ width: `${pct}%` }} />
                          </div>
                          <span className="text-xs text-gray-400">{doneCount}/{total}</span>
                          {uTasks.filter(t => t.status === 'in_progress').length > 0 && (
                            <span className="text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full">{uTasks.filter(t => t.status === 'in_progress').length} em and.</span>
                          )}
                          {uTasks.filter(t => t.due_date && t.due_date < today).length > 0 && (
                            <span className="text-xs bg-red-100 text-red-600 px-1.5 py-0.5 rounded-full">{uTasks.filter(t => t.due_date && t.due_date < today).length} atras.</span>
                          )}
                        </div>
                      </div>
                      <span className="text-gray-300 text-xs">{isCollapsed ? '▼' : '▲'}</span>
                    </button>
                    {!isCollapsed && uTasks.length > 0 && (
                      <div className="border-t border-gray-100 divide-y divide-gray-50">
                        {uTasks.map(t => {
                          const itemDone = t.checklist.filter(i => ['done','cancelled','postergado'].includes(i.status ?? (i.done ? 'done' : ''))).length
                          const overdue = t.due_date && t.due_date < today
                          return (
                            <div key={t.id} className={`flex items-center gap-3 px-4 py-2.5 ${overdue ? 'bg-red-50/40' : ''}`}>
                              <span className={`w-2 h-2 rounded-full shrink-0 ${
                                t.status === 'in_progress' ? 'bg-amber-400' :
                                t.status === 'blocked' ? 'bg-red-500' :
                                t.status === 'waiting_validation' ? 'bg-yellow-400' : 'bg-gray-300'
                              }`} />
                              <p className="flex-1 text-sm text-gray-700 truncate">{t.title}</p>
                              {t.checklist.length > 0 && <span className="text-xs text-gray-400 shrink-0">{itemDone}/{t.checklist.length}</span>}
                              {t.due_date && <span className={`text-xs shrink-0 ${overdue ? 'text-red-500 font-semibold' : 'text-gray-400'}`}>{t.due_date.slice(5)}</span>}
                              <span className={`text-xs px-1.5 py-0.5 rounded-full shrink-0 ${
                                t.status === 'in_progress' ? 'bg-amber-100 text-amber-700' :
                                t.status === 'blocked' ? 'bg-red-100 text-red-600' :
                                t.status === 'waiting_validation' ? 'bg-yellow-100 text-yellow-700' : 'bg-gray-100 text-gray-500'
                              }`}>
                                {t.status === 'in_progress' ? 'Andamento' : t.status === 'blocked' ? 'Bloqueada' : t.status === 'waiting_validation' ? 'Validação' : 'Pendente'}
                              </span>
                            </div>
                          )
                        })}
                      </div>
                    )}
                    {!isCollapsed && uTasks.length === 0 && (
                      <p className="border-t border-gray-100 px-4 py-3 text-xs text-gray-400">Todas concluídas.</p>
                    )}
                  </div>
                )
              })}
            </>
          )}
        </div>
      )}

      {/* ── Visão lista ── */}
      {(!isAdmin || viewMode === 'list') && !loading && displayedTasks.length > 0 && (
        <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 bg-gray-50 border border-gray-200 rounded-lg text-[11px]">
          <div className="w-8 shrink-0" />
          <div className="flex-1 flex items-center gap-4">
            <SortBtn col="title" label="Título" />
            <SortBtn col="assigned" label="Responsável" />
            <SortBtn col="due_date" label="Prazo" />
          </div>
          <div className="hidden md:flex items-center gap-4 shrink-0">
            <SortBtn col="created_at" label="Abertura" />
            <span className="text-gray-400 w-16 text-center">Dias aberto</span>
            <SortBtn col="updated_at" label="Últ. atualiz." />
          </div>
          <SortBtn col="status" label="Status" />
          <div className="w-4 shrink-0" />
        </div>
      )}

      {myTasks.length > 0 && (
        <div className="flex items-center gap-2 px-1">
          <span className="text-xs font-semibold text-[#26619c]">Minhas tarefas</span>
          <span className="text-xs bg-[#26619c]/10 text-[#26619c] px-1.5 py-0.5 rounded-full font-semibold">{myTasks.length}</span>
        </div>
      )}

      {[...myTasks, ...otherTasks].map((task, idx) => {
        const isExpanded = expandedId === task.id
        const doneCount = task.checklist.filter(i => ['done', 'cancelled', 'postergado'].includes(getItemStatus(i))).length
        const isOverdue = task.due_date && task.due_date < today && task.status !== 'done'
        return (
          <Fragment key={task.id}>
          {idx === myTasks.length && otherTasks.length > 0 && (
            <div className="flex items-center gap-2 px-1 mt-2">
              <div className="flex-1 h-px bg-gray-200" />
              <span className="text-xs font-semibold text-gray-400">Demais tarefas</span>
              <span className="text-xs bg-gray-100 text-gray-400 px-1.5 py-0.5 rounded-full font-semibold">{otherTasks.length}</span>
              <div className="flex-1 h-px bg-gray-200" />
            </div>
          )}
          <div className={`rounded-2xl border shadow-sm overflow-hidden ${
            task.status === 'done' ? 'border-gray-200 bg-gray-50' :
            task.status === 'in_progress' ? 'border-amber-200 bg-amber-50/40' :
            task.status === 'waiting_validation' ? 'border-yellow-300 bg-yellow-50/50' :
            isOverdue ? 'border-red-200 bg-red-50/30' :
            'border-gray-200 bg-white'
          }`}>
            <div className="p-4">
              <div className="flex items-start gap-3">
                {/* Status selector */}
                <select
                  value={task.status}
                  onChange={e => setTaskStatus(task, e.target.value as DailyTask['status'])}
                  className={`shrink-0 text-xs font-semibold rounded-xl border px-2 py-1.5 cursor-pointer appearance-none text-center min-w-[100px] transition focus:outline-none focus:ring-2 focus:ring-[#26619c]
                    ${task.status === 'done' ? 'bg-green-50 border-green-300 text-green-700' :
                      task.status === 'in_progress' ? 'bg-amber-50 border-amber-300 text-amber-700' :
                      task.status === 'blocked' ? 'bg-red-50 border-red-300 text-red-700' :
                      task.status === 'waiting_validation' ? 'bg-yellow-50 border-yellow-300 text-yellow-700' :
                      'bg-gray-50 border-gray-300 text-gray-600'}`}
                >
                  <option value="pending">⬜ Pendente</option>
                  <option value="in_progress">🔄 Em andamento</option>
                  <option value="blocked">🚫 Bloqueada</option>
                  <option value="waiting_validation">⏳ Ag. Validação</option>
                  {isAdmin && <option value="done">✅ Concluída</option>}
                </select>
                {/* Bolinha verde animada — admin conclui diretamente */}
                {isAdmin && task.status !== 'done' && (
                  <button
                    onClick={() => setTaskStatus(task, 'done')}
                    title="Concluir tarefa"
                    className="relative shrink-0 w-7 h-7 rounded-full bg-green-500 hover:bg-green-600 active:scale-95 flex items-center justify-center transition-all duration-150 shadow-sm"
                  >
                    <span className="absolute inset-0 rounded-full bg-green-400 animate-ping opacity-60" />
                    <CheckCircle className="w-4 h-4 text-white relative z-10" />
                  </button>
                )}

                <div className="flex-1 min-w-0 cursor-pointer" onClick={() => toggleExpanded(task.id)}>
                  {/* Badges */}
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {task.assigned_to_name && (
                      <span className="text-xs px-2.5 py-1 rounded-full bg-blue-50 text-blue-700 font-medium flex items-center gap-1 leading-none">
                        👤 {task.assigned_to_name}
                      </span>
                    )}
                    {task.due_date && (
                      <span className={`text-xs px-2.5 py-1 rounded-full font-medium leading-none ${isOverdue ? 'bg-red-100 text-red-600' : 'bg-gray-100 text-gray-500'}`}>
                        {isOverdue ? '⚠ Atrasada · ' : ''}📅 {new Date(task.due_date + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}
                      </span>
                    )}
                    {task.service_order_title && (
                      <span className="text-xs px-2.5 py-1 rounded-full bg-purple-50 text-purple-700 leading-none truncate max-w-[140px]">{task.service_order_title}</span>
                    )}
                  </div>
                  {/* Título */}
                  <p className={`text-base font-semibold leading-snug ${task.status === 'done' ? 'line-through text-gray-400' : 'text-gray-800'}`}>{task.title}</p>
                  {/* Progresso */}
                  {task.checklist.length > 0 && (
                    <div className="flex items-center gap-2 mt-2">
                      <div className="flex-1 bg-gray-200 rounded-full h-2 max-w-[100px]">
                        <div className="bg-[#26619c] h-2 rounded-full transition-all" style={{ width: `${(doneCount / task.checklist.length) * 100}%` }} />
                      </div>
                      <span className="text-xs text-gray-500 font-medium">{doneCount}/{task.checklist.length} itens</span>
                    </div>
                  )}
                </div>

                {/* Chevron expand */}
                <button
                  onClick={() => toggleExpanded(task.id)}
                  className="w-8 h-8 flex items-center justify-center rounded-xl text-gray-400 hover:bg-gray-100 transition shrink-0"
                >
                  {isExpanded ? '▲' : '▼'}
                </button>
              </div>
              {/* Date metadata row — desktop only */}
              {(() => {
                const openedDate = task.created_at ? task.created_at.slice(0, 10) : null
                const daysOpen = openedDate && task.status !== 'done'
                  ? Math.floor((Date.now() - new Date(openedDate + 'T12:00:00').getTime()) / 86400000)
                  : null
                const updatedDate = task.updated_at ? task.updated_at.slice(0, 10) : null
                return (
                  <div className="hidden md:flex items-center gap-4 px-4 pb-3 text-[11px] text-gray-400 border-t border-gray-50 pt-2 mt-1">
                    <span className="flex items-center gap-1">
                      <span className="font-medium text-gray-500">Abertura:</span>
                      {openedDate ? new Date(openedDate + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '—'}
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="font-medium text-gray-500">Dias aberto:</span>
                      {daysOpen !== null
                        ? <span className={`font-semibold ${daysOpen > 7 ? 'text-red-500' : daysOpen > 3 ? 'text-amber-500' : 'text-gray-600'}`}>{daysOpen}d</span>
                        : '—'}
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="font-medium text-gray-500">Últ. atualiz.:</span>
                      {updatedDate ? new Date(updatedDate + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '—'}
                    </span>
                  </div>
                )
              })()}
            </div>
            {isExpanded && (
              <div className="border-t border-gray-100 p-4 flex flex-col gap-4">
                {task.description && <p className="text-sm text-gray-600 whitespace-pre-wrap leading-relaxed">{task.description}</p>}
                {task.checklist.length > 0 && (
                  <ul className="flex flex-col gap-2">
                    {task.checklist
                      .map((item, i) => ({ item, i }))
                      .sort((a, b) => {
                        const terminal = ['done', 'cancelled', 'postergado']
                        const aT = terminal.includes(getItemStatus(a.item)) ? 1 : 0
                        const bT = terminal.includes(getItemStatus(b.item)) ? 1 : 0
                        return aT - bT
                      })
                      .map(({ item, i }) => {
                      const itemComments = (comments[task.id] || []).filter(c => c.checklist_index === i)
                      const scKey = `${task.id}:${i}`
                      const currentStatus = getItemStatus(item)
                      const statusInfo = ITEM_STATUSES.find(s => s.value === currentStatus) ?? ITEM_STATUSES[0]
                      const scOpen = statusChangeOpen[scKey] ?? false
                      const scDraft = statusChangeDraft[scKey] ?? { newStatus: currentStatus, comment: '' }
                      const acompOpen = expandedAcomp[scKey] ?? false
                      const draft = getDraft(task.id, i)
                      return (
                        <li key={i} className="flex flex-col rounded-2xl border border-gray-100 overflow-hidden bg-white shadow-sm">
                          {/* Item header */}
                          <div className="flex items-start gap-3 px-4 py-3">
                            <div className="flex-1 min-w-0 flex flex-col gap-1.5">
                              {/* Status pill */}
                              <button
                                onClick={() => setStatusChangeOpen(prev => ({ ...prev, [scKey]: !scOpen }))}
                                title="Alterar status do item"
                                className={`self-start px-3 py-1 rounded-full text-xs font-semibold border transition hover:opacity-80 whitespace-nowrap ${statusInfo.badge}`}
                              >
                                {statusInfo.label}
                              </button>
                              {/* Texto do item */}
                              <span className={`text-sm leading-snug ${currentStatus === 'done' ? 'line-through text-gray-400' : currentStatus === 'cancelled' ? 'line-through text-red-400' : currentStatus === 'postergado' ? 'line-through text-orange-400' : 'text-gray-800'}`}>
                                {item.text}
                              </span>
                            </div>
                            {/* Botão acompanhar */}
                            <button
                              onClick={() => {
                                setExpandedAcomp(prev => ({ ...prev, [scKey]: !acompOpen }))
                                if (!acompOpen) loadComments(task.id)
                              }}
                              className={`flex items-center gap-1.5 text-xs px-3 py-2 rounded-xl font-semibold transition shrink-0 min-w-[44px] min-h-[36px] ${acompOpen ? 'bg-[#26619c] text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                            >
                              <MessageSquare className="w-3.5 h-3.5" />
                              {itemComments.length > 0 ? itemComments.length : <span className="hidden sm:inline">Acompanhar</span>}
                            </button>
                          </div>

                          {/* Status change panel */}
                          {scOpen && (
                            <div className="border-t border-gray-100 bg-gray-50 px-3 py-3 flex flex-col gap-2.5">
                              <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">Alterar status do item</p>
                              <div className="flex flex-wrap gap-1.5">
                                {ITEM_STATUSES.map(s => (
                                  <button key={s.value}
                                    onClick={() => setStatusChangeDraft(prev => ({ ...prev, [scKey]: { ...scDraft, newStatus: s.value } }))}
                                    className={`px-2.5 py-1 rounded-full text-[10px] font-medium border transition ${scDraft.newStatus === s.value ? s.sel : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300'}`}
                                  >
                                    {s.label}
                                  </button>
                                ))}
                              </div>
                              <textarea
                                value={scDraft.comment}
                                onChange={e => setStatusChangeDraft(prev => ({ ...prev, [scKey]: { ...scDraft, comment: e.target.value } }))}
                                placeholder="Descreva o que aconteceu (obrigatório ao alterar status)…"
                                rows={2}
                                className="w-full text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 resize-none focus:outline-none focus:ring-1 focus:ring-[#26619c] bg-white"
                              />
                              <div className="flex justify-end gap-2">
                                <button onClick={() => setStatusChangeOpen(prev => ({ ...prev, [scKey]: false }))}
                                  className="text-xs text-gray-500 hover:text-gray-700 px-3 py-1.5">Cancelar</button>
                                <button
                                  onClick={() => changeItemStatus(task, i, scDraft.newStatus, scDraft.comment)}
                                  disabled={!scDraft.comment.trim() || scDraft.newStatus === currentStatus}
                                  className="text-xs px-3 py-1.5 bg-[#26619c] text-white rounded-lg disabled:opacity-40 hover:bg-[#1a4a7a] transition font-medium"
                                >
                                  Salvar
                                </button>
                              </div>
                            </div>
                          )}

                          {/* Acompanhamento panel */}
                          {acompOpen && (
                            <div className="border-t border-blue-100 bg-blue-50/30 px-3 py-3 flex flex-col gap-2.5">
                              {itemComments.length === 0 && (
                                <p className="text-[10px] text-gray-400 italic">Nenhum acompanhamento ainda. Seja o primeiro!</p>
                              )}
                              {itemComments.map(c => {
                                const isEditing = editingComment[c.id] !== null && editingComment[c.id] !== undefined
                                const isMine = c.author_name !== 'Usuário' // complemented below
                                return (
                                <div key={c.id} className="flex items-start gap-2">
                                  <div className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 text-white text-[10px] font-bold mt-0.5"
                                    style={{ backgroundColor: avatarColor(c.author_name) }}>
                                    {c.author_name.charAt(0).toUpperCase()}
                                  </div>
                                  <div className="flex-1 rounded-xl rounded-tl-sm px-3 py-2 bg-white border border-gray-100 shadow-sm flex flex-col gap-0.5">
                                    <div className="flex items-center justify-between">
                                      <span className="text-[10px] font-semibold text-gray-600">{c.author_name}</span>
                                      <div className="flex items-center gap-2">
                                        <span className="text-[10px] text-gray-400" title={new Date(c.created_at).toLocaleString('pt-BR')}>{relTime(c.created_at)}</span>
                                        <button
                                          onClick={() => setEditingComment(prev => ({
                                            ...prev,
                                            [c.id]: isEditing ? null : c.comment,
                                          }))}
                                          className={`text-xs px-2 py-1 rounded-lg border transition min-w-[36px] min-h-[28px] flex items-center justify-center ${isEditing ? 'border-red-200 text-red-500 bg-red-50 hover:bg-red-100' : 'border-gray-200 text-gray-500 bg-gray-50 hover:bg-gray-100 hover:text-[#26619c]'}`}
                                          title={isEditing ? 'Cancelar edição' : 'Editar comentário'}
                                        >
                                          {isEditing ? '✕' : '✏️'}
                                        </button>
                                      </div>
                                    </div>
                                    {isEditing ? (
                                      <div className="flex flex-col gap-1.5 mt-1">
                                        <textarea
                                          value={editingComment[c.id] ?? ''}
                                          onChange={e => setEditingComment(prev => ({ ...prev, [c.id]: e.target.value }))}
                                          rows={2}
                                          className="w-full text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 resize-none focus:outline-none focus:ring-1 focus:ring-[#26619c]"
                                          autoFocus
                                        />
                                        <div className="flex justify-end gap-1.5">
                                          <button onClick={() => setEditingComment(prev => ({ ...prev, [c.id]: null }))}
                                            className="text-[10px] text-gray-500 px-2 py-1">Cancelar</button>
                                          <button
                                            onClick={() => saveCommentEdit(task.id, c.id, editingComment[c.id] ?? '')}
                                            disabled={savingEditComment === c.id || !(editingComment[c.id] ?? '').trim()}
                                            className="text-[10px] px-3 py-1 bg-[#26619c] text-white rounded-lg disabled:opacity-40 hover:bg-[#1a4a7a] transition">
                                            {savingEditComment === c.id ? '...' : 'Salvar'}
                                          </button>
                                        </div>
                                      </div>
                                    ) : (
                                      c.comment && <p className="text-xs text-gray-700 whitespace-pre-wrap leading-relaxed">{c.comment}</p>
                                    )}
                                    {c.attachment_urls?.length > 0 && (
                                      <div className="flex flex-wrap gap-1 mt-1">
                                        {c.attachment_urls.map((url, j) =>
                                          url.match(/\.(jpg|jpeg|png|gif|webp)$/i)
                                            ? <img key={j} src={url} alt="" onClick={() => setLightboxUrl(url)}
                                                className="h-12 w-12 object-cover rounded border border-gray-200 cursor-pointer hover:opacity-80" />
                                            : <a key={j} href={url} target="_blank" rel="noopener noreferrer"
                                                className="text-[10px] text-blue-600 hover:underline">📎 {url.split('/').pop()}</a>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                </div>
                                )
                              })}
                              {/* Input */}
                              <div className="flex flex-col gap-1.5 bg-white border border-gray-200 rounded-xl p-2.5 shadow-sm">
                                <textarea
                                  value={draft.text}
                                  onChange={e => setDraft(task.id, i, { text: e.target.value })}
                                  placeholder="Escreva seu acompanhamento…"
                                  rows={2}
                                  className="w-full text-xs border-0 resize-none focus:outline-none placeholder-gray-400 text-gray-800"
                                />
                                {draft.photos.length > 0 && (
                                  <div className="flex flex-wrap gap-1.5">
                                    {draft.photos.map((url, j) =>
                                      url.match(/\.(jpg|jpeg|png|gif|webp)$/i)
                                        ? <img key={j} src={url} alt="" className="h-10 w-10 object-cover rounded border border-gray-200" />
                                        : <span key={j} className="text-[10px] text-blue-600">📎 {url.split('/').pop()}</span>
                                    )}
                                  </div>
                                )}
                                <div className="flex items-center gap-2 border-t border-gray-100 pt-1.5">
                                  <label className={`text-[10px] px-2.5 py-1.5 rounded-lg border border-gray-200 cursor-pointer hover:bg-gray-50 transition flex items-center gap-1 text-gray-600 ${draft.uploading ? 'opacity-50' : ''}`}>
                                    📷 {draft.uploading ? '...' : 'Foto'}
                                    <input type="file" accept="image/*" className="hidden"
                                      onChange={e => handleCommentPhotoUpload(task.id, i, e)}
                                      disabled={draft.uploading} />
                                  </label>
                                  <button
                                    onClick={() => submitComment(task.id, i)}
                                    disabled={savingComment || (!draft.text.trim() && draft.photos.length === 0)}
                                    className="ml-auto text-xs px-4 py-1.5 bg-[#26619c] text-white rounded-lg hover:bg-[#1a4a7a] disabled:opacity-40 transition font-medium">
                                    {savingComment ? 'Enviando…' : 'Enviar'}
                                  </button>
                                </div>
                              </div>
                            </div>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                )}
                {/* Comentários gerais */}
                {(comments[task.id] || []).filter(c => c.checklist_index == null).length > 0 && (
                  <div className="flex flex-col gap-2 border-t border-gray-100 pt-2">
                    <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">Observações gerais</p>
                    {(comments[task.id] || []).filter(c => c.checklist_index == null).map(c => (
                      <div key={c.id} className="flex items-end gap-2">
                        <div className="w-6 h-6 rounded-full flex items-center justify-center shrink-0 text-white text-[10px] font-bold"
                          style={{ backgroundColor: avatarColor(c.author_name) }}>
                          {(c.author_name || 'U').charAt(0).toUpperCase()}
                        </div>
                        <div className="max-w-[85%] rounded-2xl rounded-bl-sm px-2.5 py-1.5 bg-gray-100 flex flex-col gap-0.5">
                          <span className="text-[10px] font-semibold text-gray-500">{c.author_name}</span>
                          {c.comment && <p className="text-xs text-gray-700 whitespace-pre-wrap">{c.comment}</p>}
                          <span className="text-[10px] text-gray-400 self-end">{relTime(c.created_at)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {task.attachment_urls?.length > 0 && (
                  <div className="flex flex-col gap-1">
                    <p className="text-xs text-gray-500 font-medium">Anexos</p>
                    {task.attachment_urls.map((url, i) => {
                      const name = decodeURIComponent(url.split('/').pop() ?? 'arquivo')
                      const isImg = /\.(jpe?g|png|gif|webp|svg)$/i.test(url)
                      const isPdf = /\.pdf$/i.test(url)
                      return (
                        <button key={i} onClick={() => setViewerUrl(url)}
                          className="text-xs text-blue-600 hover:underline flex items-center gap-1 text-left">
                          {isImg ? '🖼' : isPdf ? '📄' : '📎'} {name}
                        </button>
                      )
                    })}
                  </div>
                )}

                {canWrite && (
                  <div className="flex items-center gap-3 pt-1 border-t border-gray-100">
                    <button onClick={() => startEdit(task)} className="text-xs text-[#26619c] hover:underline">✏ Editar</button>
                    {role !== 'operator' && role !== 'viewer' && (
                      <button onClick={() => handleDelete(task.id)}
                        className="text-xs text-red-400 hover:text-red-600 ml-auto border border-red-200 px-2 py-0.5 rounded-lg hover:bg-red-50 transition">
                        🗑 Excluir
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
          </Fragment>
        )
      })}

      {doneTasks.length > 0 && (
        <div className="border border-green-200 rounded-2xl overflow-hidden">
          <button onClick={() => setShowDone(v => !v)}
            className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-green-700 hover:bg-green-50 transition">
            <span>✓</span>
            Concluídas hoje
            <span className="text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full font-semibold">{doneTasks.length}</span>
            <span className="ml-auto text-gray-300">{showDone ? '▲' : '▼'}</span>
          </button>
          {showDone && (
            <div className="border-t border-green-100 divide-y divide-green-50">
              {doneTasks.map(task => (
                <div key={task.id} className="px-4 py-3 flex items-center gap-3 bg-green-50/40">
                  <span className="text-green-500 text-base shrink-0">✓</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-500 line-through truncate">{task.title}</p>
                    {task.assigned_to_name && <p className="text-xs text-gray-400">{task.assigned_to_name}</p>}
                  </div>
                  {task.updated_at && <span className="text-xs text-gray-400 shrink-0">{task.updated_at.slice(11,16)}</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Lixeira — tarefas excluídas nos últimos 30 dias */}
      {role !== 'operator' && role !== 'viewer' && (
        <div className="border border-dashed border-gray-300 rounded-2xl overflow-hidden">
          <button
            onClick={() => { setShowDeleted(v => !v); if (!showDeleted) loadDeleted() }}
            className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-gray-500 hover:bg-gray-50 transition"
          >
            🗑 Lixeira
            {deletedTasks.length > 0 && <span className="text-xs bg-red-100 text-red-600 px-1.5 py-0.5 rounded-full">{deletedTasks.length}</span>}
            <span className="ml-auto text-gray-300">{showDeleted ? '▲' : '▼'}</span>
          </button>
          {showDeleted && (
            <div className="border-t border-dashed border-gray-200 px-4 py-3 flex flex-col gap-2">
              {loadingDeleted && <p className="text-xs text-gray-400 text-center py-2">Carregando…</p>}
              {!loadingDeleted && deletedTasks.length === 0 && (
                <p className="text-xs text-gray-400 text-center py-2">Nenhuma tarefa excluída nos últimos 30 dias.</p>
              )}
              {deletedTasks.map(t => (
                <div key={t.id} className="flex items-center gap-3 bg-white border border-gray-100 rounded-xl px-3 py-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-700 font-medium truncate">{t.title}</p>
                    <p className="text-xs text-gray-400">
                      {t.assigned_to_name && `Para: ${t.assigned_to_name} · `}Excluída em {t.deleted_at}
                    </p>
                  </div>
                  <button
                    onClick={() => handleRestore(t.id, t.title)}
                    className="text-xs px-3 py-1.5 bg-green-50 text-green-700 border border-green-200 rounded-lg hover:bg-green-100 transition shrink-0"
                  >
                    ↩ Restaurar
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {lightboxUrl && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4 cursor-pointer"
          onClick={() => setLightboxUrl(null)}
        >
          <img src={lightboxUrl} alt="" className="max-w-full max-h-full object-contain rounded" onClick={e => e.stopPropagation()} />
        </div>
      )}

      {/* Visualizador de anexo da tarefa */}
      {viewerUrl && (() => {
        const name = decodeURIComponent(viewerUrl.split('/').pop() ?? 'arquivo')
        const isImg = /\.(jpe?g|png|gif|webp|svg)$/i.test(viewerUrl)
        const isPdf = /\.pdf$/i.test(viewerUrl)
        return (
          <div className="fixed inset-0 z-50 bg-black/70 flex flex-col" onClick={() => setViewerUrl(null)}>
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-2 bg-gray-900 shrink-0" onClick={e => e.stopPropagation()}>
              <span className="text-white text-sm font-medium truncate max-w-[60vw]">{name}</span>
              <div className="flex items-center gap-3">
                <a href={viewerUrl} download={name}
                  className="text-xs text-gray-300 hover:text-white border border-gray-600 hover:border-gray-400 px-3 py-1 rounded-lg transition"
                  onClick={e => e.stopPropagation()}>
                  ↓ Baixar
                </a>
                <button onClick={() => setViewerUrl(null)} className="text-gray-300 hover:text-white text-lg leading-none">✕</button>
              </div>
            </div>
            {/* Conteúdo */}
            <div className="flex-1 overflow-hidden flex items-center justify-center p-2" onClick={e => e.stopPropagation()}>
              {isImg ? (
                <img src={viewerUrl} alt={name} className="max-w-full max-h-full object-contain rounded" />
              ) : isPdf ? (
                <iframe src={viewerUrl} title={name} className="w-full h-full rounded border-0 bg-white" />
              ) : (
                <div className="bg-white rounded-xl p-8 text-center flex flex-col gap-4">
                  <span className="text-5xl">📎</span>
                  <p className="font-medium text-gray-800">{name}</p>
                  <p className="text-sm text-gray-500">Pré-visualização não disponível para este tipo de arquivo.</p>
                  <a href={viewerUrl} download={name}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-[#26619c] text-white rounded-xl text-sm font-semibold hover:bg-[#1a4f87] transition">
                    ↓ Baixar arquivo
                  </a>
                </div>
              )}
            </div>
          </div>
        )
      })()}
    </div>
  )
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

interface ServiceOrdersPageProps {
  /** Criar OS — abre NewOSModal direto */
  criarMode?: boolean
  /** Consultar — picker de busca de OS */
  consultarMode?: boolean
  /** Tarefas Diárias — abre aba tarefas */
  tarefasMode?: boolean
  /** Minhas Ordens — picker filtrado pelo usuário atual */
  minhasMode?: boolean
  onModalClosed?: () => void
}

export default function ServiceOrdersPage({ criarMode = false, consultarMode = false, tarefasMode = false, minhasMode = false, onModalClosed }: ServiceOrdersPageProps) {
  const { role, permissions, fullName, userId } = useAuthStore()
  const canWrite = permissions?.service_orders?.can_write ?? CAN_WRITE_ROLES.includes(role ?? '')
  const canViewOS = role === 'superadmin' || role === 'admin_master' || permissions?.service_orders?.can_view !== false

  const [pageTab, setPageTab] = useState<'ordens' | 'demandas' | 'tarefas'>(
    tarefasMode ? 'tarefas' : (canViewOS ? 'ordens' : 'tarefas')
  )

  const [phases, setPhases] = useState<ServiceOrderPhase[]>([])

  const [orders, setOrders] = useState<ServiceOrder[]>([])
  const [loading, setLoading] = useState(false)
  const [showNewOS, setShowNewOS] = useState(false)
  const [selectedOrder, setSelectedOrder] = useState<ServiceOrder | null>(null)

  // Pickers do Simplifica
  const [showPickerConsultar, setShowPickerConsultar] = useState(false)
  const [showPickerMinhas, setShowPickerMinhas] = useState(false)
  const [pickerSearch, setPickerSearch] = useState('')
  const [pickerOrders, setPickerOrders] = useState<ServiceOrder[]>([])
  const [pickerLoading, setPickerLoading] = useState(false)

  // Report state
  const [showReport, setShowReport] = useState(false)
  const [reportFrom, setReportFrom] = useState(new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10))
  const [reportTo, setReportTo] = useState(new Date().toISOString().slice(0, 10))
  const [reportData, setReportData] = useState<any>(null)
  const [loadingReport, setLoadingReport] = useState(false)

  const loadReport = async () => {
    setLoadingReport(true)
    try {
      const res = await api.get('/service-orders/report', { params: { date_from: reportFrom, date_to: reportTo } })
      setReportData(res.data)
    } catch { toast.error('Erro ao carregar relatório.') }
    finally { setLoadingReport(false) }
  }

  // Filters
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState<ServiceOrderStatus | ''>('')
  const [filterPriority, setFilterPriority] = useState<ServiceOrderPriority | ''>('')
  const [sortBy, setSortBy] = useState<'number' | 'title' | 'priority' | 'status' | 'category' | 'date' | 'requester' | 'assigned' | ''>('priority')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')

  const HIDDEN_BY_DEFAULT: ServiceOrderStatus[] = ['cancelled', 'archived']

  const PRIORITY_WEIGHT: Record<ServiceOrderPriority, number> = { critical: 0, high: 1, medium: 2, low: 3 }
  const STATUS_WEIGHT: Record<ServiceOrderStatus, number> = { draft: 0, pending: 1, in_progress: 2, resolved: 3, archived: 4, cancelled: 5 }

  const toggleOsSort = (col: typeof sortBy) => {
    if (sortBy === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortBy(col); setSortDir('asc') }
  }

  const loadPhases = useCallback(async () => {
    try {
      const res = await api.get<ServiceOrderPhase[]>('/service-order-phases')
      setPhases(res.data)
    } catch { /* silent */ }
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params: Record<string, string> = {}
      if (filterStatus) params.status = filterStatus
      if (filterPriority) params.priority = filterPriority
      if (search.trim()) params.q = search.trim()
      const res = await api.get<ServiceOrder[]>('/service-orders', { params })
      const data = filterStatus === ''
        ? res.data.filter(o => !HIDDEN_BY_DEFAULT.includes(o.status as ServiceOrderStatus))
        : res.data
      setOrders(data)
    } catch {
      toast.error('Erro ao carregar ordens de serviço.')
    } finally {
      setLoading(false)
    }
  }, [filterStatus, filterPriority, search])

  const sortedOrders = useMemo(() => {
    return [...orders].sort((a, b) => {
      let va: string | number = 0
      let vb: string | number = 0
      if (sortBy === 'number')   { va = a.number;                              vb = b.number }
      else if (sortBy === 'title')    { va = a.title.toLowerCase();            vb = b.title.toLowerCase() }
      else if (sortBy === 'priority') { va = PRIORITY_WEIGHT[a.priority] ?? 9; vb = PRIORITY_WEIGHT[b.priority] ?? 9 }
      else if (sortBy === 'status')   { va = STATUS_WEIGHT[a.status] ?? 9;     vb = STATUS_WEIGHT[b.status] ?? 9 }
      else if (sortBy === 'category') { va = (a.category_name ?? '').toLowerCase(); vb = (b.category_name ?? '').toLowerCase() }
      else if (sortBy === 'date')     { va = a.created_at;                     vb = b.created_at }
      else if (sortBy === 'requester'){ va = (a.community_wide ? 'zzz' : (a.requester_name ?? '').toLowerCase()); vb = (b.community_wide ? 'zzz' : (b.requester_name ?? '').toLowerCase()) }
      else if (sortBy === 'assigned') { va = (a.assigned_to_name ?? '').toLowerCase(); vb = (b.assigned_to_name ?? '').toLowerCase() }
      else /* default: priority */    { va = PRIORITY_WEIGHT[a.priority] ?? 9; vb = PRIORITY_WEIGHT[b.priority] ?? 9 }
      const cmp = va < vb ? -1 : va > vb ? 1 : 0
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [orders, sortBy, sortDir])

  const isSimplificaMode = criarMode || consultarMode || tarefasMode || minhasMode
  useEffect(() => { if (!isSimplificaMode) load() }, [load])
  useEffect(() => { loadPhases() }, [loadPhases])

  // Simplifica: auto-abertura
  const soModalWasOpenRef = useRef(false)
  useEffect(() => {
    if (criarMode)    { setShowNewOS(true); return }
    if (consultarMode){ setShowPickerConsultar(true); return }
    if (minhasMode)   {
      setShowPickerMinhas(true)
      api.get<ServiceOrder[]>('/service-orders').then(r => {
        const mine = r.data.filter(o => o.assigned_to === fullName || (o as any).created_by_name === fullName)
        setPickerOrders(mine)
      }).catch(() => {})
      return
    }
  }, [])

  const anySOModalOpen = showNewOS || !!selectedOrder || showPickerConsultar || showPickerMinhas
  useEffect(() => {
    if (!onModalClosed) return
    if (anySOModalOpen) { soModalWasOpenRef.current = true; return }
    if (soModalWasOpenRef.current) { soModalWasOpenRef.current = false; onModalClosed() }
  }, [anySOModalOpen])

  // KPIs
  const OPEN_STATUSES: ServiceOrderStatus[] = ['pending', 'in_progress']
  const abertas = orders.filter(o => OPEN_STATUSES.includes(o.status)).length
  const criticas = orders.filter(o => o.priority === 'critical' && OPEN_STATUSES.includes(o.status)).length
  const semResponsavel = orders.filter(o => !o.assigned_to && OPEN_STATUSES.includes(o.status)).length
  const resolvidas = orders.filter(o => o.status === 'resolved').length
  const inconsistent = orders.filter(o => !!o.resolved_at && !['resolved', 'archived', 'cancelled'].includes(o.status)).length

  return (
    <div className="flex flex-col gap-5 p-4 sm:p-6 max-w-screen-xl mx-auto w-full">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <FileText className="w-6 h-6 text-[#26619c]" />
          Ordens de Serviço
        </h1>
        <div className="flex gap-2">
          {pageTab === 'ordens' && (
            <button onClick={() => { setShowReport(true); loadReport() }}
              className="flex items-center gap-1.5 border border-gray-200 text-gray-600 px-3 py-2 rounded-xl text-sm font-medium hover:bg-gray-50 transition">
              <FileText className="w-4 h-4" /><span className="hidden sm:inline">Relatório</span>
            </button>
          )}
          {pageTab === 'ordens' && canWrite && (
            <button
              onClick={() => setShowNewOS(true)}
              className="flex items-center gap-2 bg-[#26619c] hover:bg-[#1a4f87] text-white px-4 py-2 rounded-xl text-sm font-medium transition"
            >
              <Plus className="w-4 h-4" /> Nova OS
            </button>
          )}
        </div>
      </div>

      {/* Page tabs */}
      <div className="flex gap-1 border-b border-gray-200 overflow-x-auto whitespace-nowrap scrollbar-none">
        {canViewOS && <button
          onClick={() => setPageTab('ordens')}
          className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition ${pageTab === 'ordens' ? 'text-[#26619c] border-[#26619c]' : 'text-gray-500 border-transparent hover:text-gray-700'}`}
        >
          <FileText className="w-4 h-4" /> Ordens
        </button>}
        {canViewOS && <button
          onClick={() => setPageTab('demandas')}
          className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition ${pageTab === 'demandas' ? 'text-[#26619c] border-[#26619c]' : 'text-gray-500 border-transparent hover:text-gray-700'}`}
        >
          <LayoutDashboard className="w-4 h-4" /> Demandas
        </button>}
        <button
          onClick={() => setPageTab('tarefas')}
          className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition ${pageTab === 'tarefas' ? 'text-[#26619c] border-[#26619c]' : 'text-gray-500 border-transparent hover:text-gray-700'}`}
        >
          ✅ Tarefas Diárias
        </button>
      </div>

      {pageTab === 'demandas' && <DemandasBoard canWrite={canWrite} />}
      {pageTab === 'tarefas' && <TarefasDiariasTab canWrite={canWrite} />}

      {pageTab === 'ordens' && <>

      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-white rounded-xl border border-gray-200 p-4 flex items-center gap-3 shadow-sm">
          <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center shrink-0">
            <TrendingUp className="w-5 h-5 text-blue-600" />
          </div>
          <div>
            <p className="text-2xl font-bold text-gray-900">{abertas}</p>
            <p className="text-xs text-gray-500 mt-0.5">Abertas</p>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4 flex items-center gap-3 shadow-sm">
          <div className="w-10 h-10 rounded-xl bg-red-50 flex items-center justify-center shrink-0">
            <AlertTriangle className="w-5 h-5 text-red-600" />
          </div>
          <div>
            <p className="text-2xl font-bold text-red-600">{criticas}</p>
            <p className="text-xs text-gray-500 mt-0.5">Críticas abertas</p>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4 flex items-center gap-3 shadow-sm">
          <div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center shrink-0">
            <UserX className="w-5 h-5 text-amber-600" />
          </div>
          <div>
            <p className="text-2xl font-bold text-amber-600">{semResponsavel}</p>
            <p className="text-xs text-gray-500 mt-0.5">Sem responsável</p>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4 flex items-center gap-3 shadow-sm">
          <div className="w-10 h-10 rounded-xl bg-green-50 flex items-center justify-center shrink-0">
            <CheckCircle className="w-5 h-5 text-green-600" />
          </div>
          <div>
            <p className="text-2xl font-bold text-green-600">{resolvidas}</p>
            <p className="text-xs text-gray-500 mt-0.5">Resolvidas</p>
          </div>
        </div>
        {inconsistent > 0 && (
          <div className="col-span-2 sm:col-span-4 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex items-center gap-3">
            <AlertCircle className="w-5 h-5 text-amber-600 shrink-0" />
            <p className="text-sm text-amber-800">
              <strong>{inconsistent} OS</strong> com notas de resolução registradas mas status desatualizado. Clique nelas para corrigir.
            </p>
          </div>
        )}
      </div>

      {/* Toolbar — filtros + busca */}
      <div className="flex flex-col gap-2">
        <div className="flex gap-2 items-center">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Buscar por título, solicitante…"
              className="w-full pl-9 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#26619c]/30 focus:border-[#26619c]"
            />
          </div>
          <select
            value={filterPriority}
            onChange={e => setFilterPriority(e.target.value as ServiceOrderPriority | '')}
            className="text-xs border border-gray-200 rounded-lg px-2.5 py-2 focus:outline-none bg-white text-gray-600 shrink-0"
          >
            <option value="">Prioridade</option>
            {(['low', 'medium', 'high', 'critical'] as ServiceOrderPriority[]).map(p => (
              <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>
            ))}
          </select>
        </div>
        <div className="flex gap-1.5 flex-wrap">
          <button onClick={() => setFilterStatus('')} className={`px-2.5 py-1 rounded-full text-xs font-medium transition ${filterStatus === '' ? 'bg-[#26619c] text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`} title="Oculta canceladas e arquivadas">Ativas</button>
          {ALL_STATUSES.map(s => (
            <button key={s} onClick={() => setFilterStatus(filterStatus === s ? '' : s)}
              className={`px-2.5 py-1 rounded-full text-xs font-medium transition ${filterStatus === s ? 'bg-[#26619c] text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
              {STATUS_LABELS[s]}
            </button>
          ))}
        </div>
      </div>

      {/* Tabela */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        {/* Cabeçalho da tabela */}
        {(() => {
          const Th = ({ col, label, className = '' }: { col: typeof sortBy; label: string; className?: string }) => (
            <button onClick={() => toggleOsSort(col)}
              className={`flex items-center gap-0.5 text-[10px] font-semibold uppercase tracking-wide transition select-none ${sortBy === col ? 'text-[#26619c]' : 'text-gray-400 hover:text-gray-600'} ${className}`}>
              {label}
              <span className="ml-0.5 text-[9px]">{sortBy === col ? (sortDir === 'asc' ? '▲' : '▼') : '⇅'}</span>
            </button>
          )
          return (
            <div className="hidden sm:grid grid-cols-[4px_56px_1fr_120px_130px_140px_110px_100px_110px] bg-gray-50 border-b border-gray-200 px-4 py-2.5 gap-3 items-center">
              <div />
              <Th col="number" label="#" />
              <Th col="title" label="Título" />
              <Th col="priority" label="Prioridade" />
              <Th col="status" label="Status" />
              <Th col="category" label="Categoria" />
              <Th col="date" label="Data" />
              <Th col="requester" label="Solicitante" />
              <Th col="assigned" label="Atribuído a" />
            </div>
          )
        })()}

        {loading ? (
          <div className="p-10 text-center text-gray-400 text-sm flex flex-col items-center gap-2">
            <Loader2 className="w-5 h-5 animate-spin" />
            Carregando…
          </div>
        ) : orders.length === 0 ? (
          <div className="p-10 text-center text-gray-400 text-sm">
            <FileText className="w-8 h-8 mx-auto mb-2 opacity-30" />
            Nenhuma ordem de serviço encontrada.
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {sortedOrders.map(so => {
              const isInconsistent = !!so.resolved_at && !['resolved', 'archived', 'cancelled'].includes(so.status)
              const priorityBar =
                isInconsistent       ? 'bg-amber-400' :
                so.priority === 'critical' ? 'bg-red-500' :
                so.priority === 'high'     ? 'bg-orange-400' :
                so.priority === 'medium'   ? 'bg-blue-400' : 'bg-gray-200'

              return (
                <button
                  key={so.id}
                  className="w-full text-left group hover:bg-gray-50/80 transition"
                  onClick={() => setSelectedOrder(so)}
                >
                  {/* Mobile layout */}
                  <div className="sm:hidden flex items-start gap-3 px-4 py-3.5">
                    <div className={`w-1 self-stretch rounded-full shrink-0 ${priorityBar}`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                        <span className="text-xs font-mono text-gray-400">#{String(so.number).padStart(4, '0')}</span>
                        <span className={`inline-flex items-center gap-0.5 text-xs px-1.5 py-0.5 rounded-full font-medium ${STATUS_COLORS[so.status]}`}>
                          {STATUS_ICONS[so.status]}{STATUS_LABELS[so.status]}
                        </span>
                        {isInconsistent && <AlertCircle className="w-3.5 h-3.5 text-amber-500" />}
                      </div>
                      <p className="text-sm font-semibold text-gray-800 truncate">{so.title}</p>
                      <p className="text-xs text-gray-400 mt-0.5">
                        {so.category_name ?? '—'} · {new Date(so.created_at).toLocaleDateString('pt-BR')}
                      </p>
                    </div>
                    <span className={`text-[10px] font-semibold ${PRIORITY_TEXT[so.priority]} shrink-0 mt-0.5`}>{PRIORITY_LABELS[so.priority]}</span>
                  </div>

                  {/* Desktop layout — tabular */}
                  <div className="hidden sm:grid grid-cols-[4px_56px_1fr_120px_130px_140px_110px_100px_110px] items-center gap-3 px-4 py-3">
                    <div className={`h-full rounded-full ${priorityBar}`} style={{minHeight: '32px'}} />
                    <span className="text-xs font-mono text-gray-400 group-hover:text-gray-600">#{String(so.number).padStart(4, '0')}</span>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-gray-800 truncate group-hover:text-[#26619c] transition-colors">{so.title}</p>
                      {so.requester_name && <p className="text-[11px] text-gray-400 truncate">{so.requester_name}</p>}
                    </div>
                    <span className={`text-xs font-semibold ${PRIORITY_TEXT[so.priority]}`}>
                      <span className={`inline-block w-1.5 h-1.5 rounded-full mr-1.5 ${PRIORITY_DOT[so.priority]}`} />
                      {PRIORITY_LABELS[so.priority]}
                    </span>
                    <span className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full font-medium w-fit ${STATUS_COLORS[so.status]}`}>
                      {STATUS_ICONS[so.status]}{STATUS_LABELS[so.status]}
                      {isInconsistent && <AlertCircle className="w-3 h-3 text-amber-500 ml-0.5" />}
                    </span>
                    {so.phase_id && so.phase_name && (
                      <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full font-medium ml-1"
                        style={{ backgroundColor: (so.phase_color ?? '#9333ea') + '20', color: so.phase_color ?? '#9333ea' }}>
                        <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: so.phase_color ?? '#9333ea' }} />
                        {so.phase_name}
                      </span>
                    )}
                    <div className="min-w-0">
                      <p className="text-xs text-gray-700 truncate">{so.category_name ?? '—'}</p>
                      {so.org_responsible && <p className="text-[11px] text-gray-400 truncate">{so.org_responsible}</p>}
                    </div>
                    <span className="text-xs text-gray-500">{new Date(so.created_at).toLocaleDateString('pt-BR')}</span>
                    <div className="min-w-0">
                      {so.community_wide ? (
                        <span className="inline-flex items-center gap-1 text-xs text-blue-600 font-medium">
                          <User className="w-3 h-3" />Toda Comunidade
                        </span>
                      ) : so.requester_name ? (
                        <span className="text-xs text-gray-700 truncate block">{so.requester_name.split(' ').slice(0,2).join(' ')}</span>
                      ) : <span className="text-xs text-gray-300">—</span>}
                    </div>
                    <div className="min-w-0">
                      {so.assigned_to_name ? (
                        <span className="flex items-center gap-1.5">
                          <span className="w-5 h-5 rounded-full bg-[#26619c]/10 text-[#26619c] text-[8px] font-bold flex items-center justify-center shrink-0 border border-[#26619c]/20">
                            {so.assigned_to_name.split(' ').filter(Boolean).slice(0,2).map(n => n[0]).join('').toUpperCase()}
                          </span>
                          <span className="text-xs text-gray-600 truncate">{so.assigned_to_name.split(' ')[0]}</span>
                        </span>
                      ) : <span className="text-xs text-gray-300">—</span>}
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        )}

        {/* Footer da tabela */}
        {orders.length > 0 && (
          <div className="px-4 py-2.5 border-t border-gray-100 bg-gray-50/50 flex items-center justify-between">
            <p className="text-xs text-gray-400">{sortedOrders.length} ordem{sortedOrders.length !== 1 ? 's' : ''} exibida{sortedOrders.length !== 1 ? 's' : ''}</p>
            <p className="text-xs text-gray-400">{abertas} abertas · {resolvidas} resolvidas</p>
          </div>
        )}
      </div>

      {/* ── Simplifica: Picker Consultar OS ── */}
      {showPickerConsultar && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 px-0 sm:px-4">
          <div className="w-full max-w-lg bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl flex flex-col max-h-[90vh]">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 shrink-0">
              <div>
                <h3 className="font-semibold text-gray-900 text-sm">Consultar Ordens de Serviço</h3>
                <p className="text-xs text-gray-400 mt-0.5">Busque por título ou número</p>
              </div>
              <button onClick={() => { setShowPickerConsultar(false); setPickerSearch(''); setPickerOrders([]) }}>
                <X className="w-5 h-5 text-gray-400" />
              </button>
            </div>
            <div className="px-5 py-3 border-b border-gray-100 shrink-0">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  value={pickerSearch}
                  onChange={async e => {
                    const q = e.target.value
                    setPickerSearch(q)
                    if (q.length < 2) { setPickerOrders([]); return }
                    setPickerLoading(true)
                    try {
                      const r = await api.get<ServiceOrder[]>('/service-orders', { params: { q } })
                      setPickerOrders(r.data.slice(0, 15))
                    } catch { /* silent */ } finally { setPickerLoading(false) }
                  }}
                  placeholder="Título ou número da OS…"
                  className="w-full border border-gray-300 rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#6d28d9]/40 focus:border-[#6d28d9]"
                  autoFocus
                />
                {pickerLoading && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400">…</span>}
              </div>
            </div>
            <div className="flex-1 overflow-y-auto divide-y divide-gray-50">
              {pickerOrders.length === 0 && pickerSearch.length >= 2 && !pickerLoading && (
                <p className="text-sm text-gray-400 text-center py-8">Nenhuma OS encontrada.</p>
              )}
              {pickerSearch.length < 2 && <p className="text-xs text-gray-400 text-center py-8">Digite para buscar</p>}
              {pickerOrders.map(o => (
                <button key={o.id} onClick={() => { setShowPickerConsultar(false); setPickerSearch(''); setPickerOrders([]); setSelectedOrder(o) }}
                  className="w-full flex items-start gap-3 px-5 py-3 hover:bg-purple-50 transition text-left">
                  <FileText className="w-4 h-4 mt-0.5 text-[#6d28d9] shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-800 truncate">#{o.number} — {o.title}</p>
                    <p className="text-xs text-gray-500">{o.status} · {o.priority}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Simplifica: Picker Minhas Ordens ── */}
      {showPickerMinhas && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 px-0 sm:px-4">
          <div className="w-full max-w-lg bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl flex flex-col max-h-[90vh]">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 shrink-0">
              <div>
                <h3 className="font-semibold text-gray-900 text-sm">Minhas Ordens</h3>
                <p className="text-xs text-gray-400 mt-0.5">{pickerOrders.length} OS atribuídas a você</p>
              </div>
              <button onClick={() => setShowPickerMinhas(false)}><X className="w-5 h-5 text-gray-400" /></button>
            </div>
            <div className="flex-1 overflow-y-auto divide-y divide-gray-50">
              {pickerOrders.length === 0 && (
                <p className="text-sm text-gray-400 text-center py-8">Nenhuma OS encontrada para você.</p>
              )}
              {pickerOrders.map(o => (
                <button key={o.id} onClick={() => { setShowPickerMinhas(false); setPickerOrders([]); setSelectedOrder(o) }}
                  className="w-full flex items-start gap-3 px-5 py-3 hover:bg-purple-50 transition text-left">
                  <FileText className="w-4 h-4 mt-0.5 text-[#6d28d9] shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-800 truncate">#{o.number} — {o.title}</p>
                    <p className="text-xs text-gray-500">{o.status} · {o.priority}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

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
          phases={phases}
          onClose={() => setSelectedOrder(null)}
          onUpdated={load}
        />
      )}

      {showReport && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl mx-4 max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 shrink-0">
              <h3 className="font-semibold text-gray-900">Relatório de OS</h3>
              <button onClick={() => setShowReport(false)}><X className="w-5 h-5 text-gray-400" /></button>
            </div>
            <div className="p-5 flex flex-col gap-4 overflow-y-auto">
              <div className="flex gap-3 items-end">
                <div className="flex-1">
                  <label className="block text-xs font-medium text-gray-600 mb-1">De</label>
                  <input type="date" value={reportFrom} onChange={e => setReportFrom(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                </div>
                <div className="flex-1">
                  <label className="block text-xs font-medium text-gray-600 mb-1">Até</label>
                  <input type="date" value={reportTo} onChange={e => setReportTo(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                </div>
                <button onClick={loadReport} disabled={loadingReport}
                  className="px-4 py-2 bg-[#26619c] text-white rounded-lg text-sm font-medium disabled:opacity-50">
                  {loadingReport ? '…' : 'Buscar'}
                </button>
              </div>
              {reportData && (
                <div className="flex flex-col gap-3">
                  <div className="grid grid-cols-2 gap-3">
                    {[
                      { label: 'Total', value: reportData.total, color: 'text-gray-800' },
                      { label: 'Abertas', value: reportData.abertas, color: 'text-blue-600' },
                      { label: 'Resolvidas', value: reportData.resolvidas, color: 'text-green-600' },
                      { label: 'Canceladas', value: reportData.canceladas, color: 'text-gray-500' },
                      { label: 'Críticas', value: reportData.criticas, color: 'text-red-600' },
                    ].map(({ label, value, color }) => (
                      <div key={label} className="bg-gray-50 rounded-xl p-3">
                        <p className="text-xs text-gray-500">{label}</p>
                        <p className={`text-2xl font-bold ${color}`}>{value}</p>
                      </div>
                    ))}
                  </div>
                  {reportData.by_category?.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-gray-600 mb-2 flex items-center gap-1"><Tag className="w-3.5 h-3.5" /> Por Categoria</p>
                      <ul className="flex flex-col gap-1">
                        {reportData.by_category.map((a: any) => (
                          <li key={a.label} className="flex justify-between items-center text-xs">
                            <span className="text-gray-700 truncate">{a.label}</span>
                            <span className="font-semibold text-gray-800 shrink-0 ml-2">{a.count}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {reportData.by_org?.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-gray-600 mb-2 flex items-center gap-1"><Building2 className="w-3.5 h-3.5" /> Por Órgão Responsável</p>
                      <ul className="flex flex-col gap-1">
                        {reportData.by_org.map((a: any) => (
                          <li key={a.label} className="flex justify-between items-center text-xs">
                            <span className="text-gray-700 truncate">{a.label}</span>
                            <span className="font-semibold text-gray-800 shrink-0 ml-2">{a.count}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {reportData.by_priority?.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-gray-600 mb-2 flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5" /> Por Prioridade</p>
                      <ul className="flex flex-col gap-1">
                        {reportData.by_priority.map((a: any) => (
                          <li key={a.label} className="flex justify-between items-center text-xs">
                            <span className={`font-medium ${a.label === 'critical' ? 'text-red-600' : a.label === 'high' ? 'text-orange-500' : a.label === 'medium' ? 'text-blue-600' : 'text-gray-500'}`}>
                              {PRIORITY_LABELS[a.label as ServiceOrderPriority] ?? a.label}
                            </span>
                            <span className="font-semibold text-gray-800">{a.count}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <div>
                    <p className="text-xs font-medium text-gray-600 mb-2">Atividade Diária</p>
                    {reportData.by_day?.length > 0 ? (
                      <div className="overflow-x-auto rounded-lg border border-gray-100">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="bg-gray-50 text-gray-500 uppercase text-[10px]">
                              <th className="text-left px-3 py-2">Data</th>
                              <th className="text-right px-3 py-2">Total</th>
                              <th className="text-right px-3 py-2">Abertas</th>
                              <th className="text-right px-3 py-2">Resolvidas</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100">
                            {reportData.by_day.map((d: any) => (
                              <tr key={d.dia} className="hover:bg-gray-50">
                                <td className="px-3 py-2 text-gray-700">{new Date(d.dia + 'T12:00:00').toLocaleDateString('pt-BR')}</td>
                                <td className="px-3 py-2 text-right font-semibold text-gray-800">{d.total}</td>
                                <td className="px-3 py-2 text-right text-blue-600">{d.abertas}</td>
                                <td className="px-3 py-2 text-right text-green-600">{d.resolvidas}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <p className="text-xs text-gray-400">Nenhuma OS registrada no período.</p>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      </>}
    </div>
  )
}
