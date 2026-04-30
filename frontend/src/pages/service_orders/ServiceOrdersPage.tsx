import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AlertCircle, ChevronDown, FileText, MessageSquare, Pencil, Plus, Search, X,
  Clock, CheckCircle, XCircle, Archive, Loader2, User, LayoutDashboard,
} from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../../services/api'
import { useAuthStore } from '../../store/authStore'
import DemandasBoard from './DemandasBoard'

// ─── Extended types (superset of types/index.ts) ──────────────────────────────

type ServiceOrderStatus =
  | 'draft' | 'pending' | 'open' | 'in_progress' | 'waiting_third_party'
  | 'resolved' | 'archived' | 'cancelled'

type ServiceOrderPriority = 'low' | 'medium' | 'high' | 'critical'

interface ServiceOrder {
  id: string; number: number; title: string; description: string
  status: ServiceOrderStatus; priority: ServiceOrderPriority
  area?: string; unit?: string; block?: string
  service_impacted?: string; category_name?: string; org_responsible?: string
  requester_name?: string; requester_phone?: string; requester_email?: string
  reference_point?: string; address_cep?: string; address_street?: string; address_number?: string; address_complement?: string; assigned_to?: string; assigned_to_name?: string; community_wide?: boolean
  requester_resident_id?: string; resolution_notes?: string; resolved_at?: string
  cancellation_reason?: string; request_date?: string
  impacted_residents?: {id: string; name: string; unit?: string}[]
  created_at: string; updated_at?: string; created_by_name?: string
  association_name?: string
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
  open: 'Aberto', pending: 'Pendente',
  waiting_third_party: 'Ag. Terceiros', done: 'Concluído',
}

const TASK_STATUS_COLORS: Record<string, string> = {
  open: 'bg-blue-100 text-blue-700',
  pending: 'bg-yellow-100 text-yellow-700',
  waiting_third_party: 'bg-orange-100 text-orange-700',
  done: 'bg-green-100 text-green-700',
}

interface ResidentResult {
  id: string; full_name: string; cpf?: string; phone_primary?: string; email?: string; address_cep?: string; unit?: string; type?: string
}

interface UserResult {
  id: string; full_name: string; role?: string
}

// ─── Constants ────────────────────────────────────────────────────────────────

const STATUS_LABELS: Record<ServiceOrderStatus, string> = {
  draft: 'Rascunho',
  pending: 'Pendente',
  open: 'Aberta',
  in_progress: 'Em Andamento',
  waiting_third_party: 'Ag. Terceiros',
  resolved: 'Concluída',
  archived: 'Arquivada',
  cancelled: 'Cancelada',
}

const STATUS_COLORS: Record<ServiceOrderStatus, string> = {
  draft: 'bg-amber-50 text-amber-600 border border-amber-200',
  pending: 'bg-gray-100 text-gray-600',
  open: 'bg-blue-100 text-blue-700',
  in_progress: 'bg-yellow-100 text-yellow-700',
  waiting_third_party: 'bg-purple-100 text-purple-700',
  resolved: 'bg-green-100 text-green-700',
  archived: 'bg-gray-100 text-gray-500',
  cancelled: 'bg-red-100 text-red-600',
}

const STATUS_ICONS: Record<ServiceOrderStatus, React.ReactNode> = {
  draft: <Pencil className="w-3 h-3" />,
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
  'draft', 'pending', 'open', 'in_progress', 'waiting_third_party', 'resolved', 'archived', 'cancelled',
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
  const [impactedResidents, setImpactedResidents] = useState<{id: string; name: string; unit?: string}[]>([])
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
      setImpactedResidents(prev => [...prev, { id: r.id, name: r.full_name, unit: r.unit ?? undefined }])
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
    fetch(`https://viacep.com.br/ws/${digits}/json/`)
      .then(r => r.json())
      .then(data => { if (!data.erro) setAddressStreet(data.logradouro ?? '') })
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
        priority, status,
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
                  <select
                    value={orgOptions.includes(orgResponsible) ? orgResponsible : (orgResponsible ? '__outro__' : '')}
                    onChange={e => setOrgResponsible(e.target.value === '__outro__' ? '' : e.target.value)}
                    className={inputCls}
                    disabled={!category}
                  >
                    <option value="">— selecione —</option>
                    {orgOptions.map(o => <option key={o} value={o}>{o}</option>)}
                    <option value="__outro__">Outro…</option>
                  </select>
                  {(!orgOptions.includes(orgResponsible) || orgResponsible === '') && (
                    <input
                      value={orgOptions.includes(orgResponsible) ? '' : orgResponsible}
                      onChange={e => setOrgResponsible(e.target.value)}
                      className={`${inputCls} mt-1.5`}
                      placeholder="Digite o órgão responsável"
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
                          {r.unit && <span className="ml-2 text-xs text-gray-400">Ap. {r.unit}</span>}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                {impactedResidents.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {impactedResidents.map(r => (
                      <span key={r.id} className="flex items-center gap-1 bg-blue-50 border border-blue-200 text-blue-700 text-xs px-2 py-1 rounded-full">
                        {r.name}{r.unit ? ` · Ap. ${r.unit}` : ''}
                        <button type="button" onClick={() => setImpactedResidents(prev => prev.filter(x => x.id !== r.id))} className="ml-0.5 text-blue-400 hover:text-red-500">✕</button>
                      </span>
                    ))}
                  </div>
                )}
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
                <li key={r.id} className="text-sm text-gray-800">• {r.name}{r.unit ? ` — Ap. ${r.unit}` : ''}</li>
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
  onClose: () => void
  onUpdated: () => void
}

interface PresenceUser { user_id: string; full_name: string; last_seen_at: string }

function DetailPanel({ so, canWrite, onClose, onUpdated }: DetailPanelProps) {
  const [activeTab, setActiveTab] = useState<'details' | 'comments' | 'tasks' | 'demands'>('details')
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
            onClick={() => setActiveTab('tasks')}
            className={`py-2.5 text-sm font-medium border-b-2 flex items-center gap-1.5 transition mr-4 ${activeTab === 'tasks' ? 'text-[#26619c] border-[#26619c]' : 'text-gray-500 border-transparent'}`}
          >
            📋 Registros
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
                              const r = await fetch(`https://viacep.com.br/ws/${digits}/json/`)
                              const d = await r.json()
                              if (!d.erro) setEditForm(f => ({ ...f, address_street: d.logradouro ?? f.address_street }))
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
                              {r.name}{r.unit ? ` · Ap. ${r.unit}` : ''}
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
                    {d.assigned_to && <FieldCell label="Atribuído a">{d.assigned_to_name ?? d.assigned_to}</FieldCell>}
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

          {activeTab === 'tasks' && (
            <DailyRecordsTab soId={so.id} canWrite={canWrite} />
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

// ─── Main Page ─────────────────────────────────────────────────────────────────

export default function ServiceOrdersPage() {
  const { role, permissions } = useAuthStore()
  const canWrite = permissions?.service_orders?.can_write ?? CAN_WRITE_ROLES.includes(role ?? '')

  const [pageTab, setPageTab] = useState<'ordens' | 'demandas'>('ordens')

  const [orders, setOrders] = useState<ServiceOrder[]>([])
  const [loading, setLoading] = useState(false)
  const [showNewOS, setShowNewOS] = useState(false)
  const [selectedOrder, setSelectedOrder] = useState<ServiceOrder | null>(null)

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

  const HIDDEN_BY_DEFAULT: ServiceOrderStatus[] = ['cancelled', 'archived']

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

  useEffect(() => { load() }, [load])

  // KPIs
  const total = orders.length
  const pending = orders.filter(o => o.status === 'pending').length
  const inProgress = orders.filter(o => o.status === 'in_progress').length
  const critical = orders.filter(o => o.priority === 'critical').length

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
      <div className="flex gap-1 border-b border-gray-200">
        <button
          onClick={() => setPageTab('ordens')}
          className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition ${pageTab === 'ordens' ? 'text-[#26619c] border-[#26619c]' : 'text-gray-500 border-transparent hover:text-gray-700'}`}
        >
          <FileText className="w-4 h-4" /> Ordens
        </button>
        <button
          onClick={() => setPageTab('demandas')}
          className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition ${pageTab === 'demandas' ? 'text-[#26619c] border-[#26619c]' : 'text-gray-500 border-transparent hover:text-gray-700'}`}
        >
          <LayoutDashboard className="w-4 h-4" /> Demandas
        </button>
      </div>

      {pageTab === 'demandas' && <DemandasBoard canWrite={canWrite} />}

      {pageTab === 'ordens' && <>
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
              title="Oculta canceladas e arquivadas"
            >
              Ativas
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
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className="text-xs font-mono text-gray-400">#{String(so.number).padStart(4, '0')}</span>
                      <span className={`inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded-full font-medium ${STATUS_COLORS[so.status]}`}>
                        {STATUS_ICONS[so.status]}
                        {STATUS_LABELS[so.status]}
                      </span>
                      <span className="flex items-center gap-1 text-xs">
                        <span className={`w-2 h-2 rounded-full ${PRIORITY_DOT[so.priority]}`} />
                        <span className={PRIORITY_TEXT[so.priority]}>{PRIORITY_LABELS[so.priority]}</span>
                      </span>
                      {so.association_name && (
                        <span className="px-1.5 py-0.5 rounded-full bg-indigo-100 text-indigo-600 text-[10px] font-semibold leading-none">
                          {so.association_name}
                        </span>
                      )}
                    </div>
                    <p className="text-sm font-medium text-gray-800 truncate">{so.title}</p>
                    <p className="text-xs text-gray-400 mt-0.5 flex items-center gap-1 flex-wrap">
                      {so.community_wide && <span className="text-blue-600 font-medium">Toda a comunidade</span>}
                      {so.category_name && <span>{so.category_name}</span>}
                      {!so.community_wide && so.requester_name && <><span>·</span><span>{so.requester_name}</span></>}
                      <span>·</span>
                      <span>{new Date(so.created_at).toLocaleDateString('pt-BR')}</span>
                      {so.created_by_name && <><span>·</span><span className="flex items-center gap-0.5"><User className="w-3 h-3" />{so.created_by_name}</span></>}
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
                  {reportData.by_area?.length > 0 && (
                    <div>
                      <p className="text-xs font-medium text-gray-600 mb-2">Por Área</p>
                      <ul className="flex flex-col gap-1">
                        {reportData.by_area.map((a: any) => (
                          <li key={a.area} className="flex justify-between text-sm">
                            <span className="text-gray-700">{a.area}</span>
                            <span className="font-medium text-gray-800">{a.count}</span>
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
