import { useCallback, useEffect, useState } from 'react'
import { Plus, X, ChevronRight, Calendar, User, AlertCircle, Flag, Trash2 } from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../../services/api'

// ─── Types ────────────────────────────────────────────────────────────────────

type DemandStatus   = 'gaveta' | 'a_iniciar' | 'em_andamento' | 'parado' | 'concluido'
type DemandPhase    = 'pendente' | 'em_andamento' | 'ag_terceiros' | 'cancelado' | 'concluido'
type DemandPriority = 'low' | 'medium' | 'high'

interface Demand {
  id: string
  title: string
  description?: string
  status: DemandStatus
  phase: DemandPhase
  priority: DemandPriority
  assigned_to?: string
  assigned_to_name?: string
  due_date?: string
  notes?: string
  created_at: string
  created_by_name?: string
}

interface UserOption { id: string; full_name: string }

// ─── Constants ────────────────────────────────────────────────────────────────

const COLUMNS: { key: DemandStatus; label: string; accent: string; badge: string }[] = [
  { key: 'gaveta',       label: 'Gaveta',       accent: 'border-gray-300',   badge: 'bg-gray-100 text-gray-600'    },
  { key: 'a_iniciar',    label: 'A Iniciar',    accent: 'border-blue-400',   badge: 'bg-blue-50 text-blue-700'    },
  { key: 'em_andamento', label: 'Em Andamento', accent: 'border-indigo-400', badge: 'bg-indigo-50 text-indigo-700'},
  { key: 'parado',       label: 'Parado',       accent: 'border-orange-400', badge: 'bg-orange-50 text-orange-700'},
  { key: 'concluido',    label: 'Concluído',    accent: 'border-emerald-400',badge: 'bg-emerald-50 text-emerald-700'},
]

const PHASE_LABELS: Record<DemandPhase, string> = {
  pendente: 'Pendente', em_andamento: 'Em andamento',
  ag_terceiros: 'Ag. terceiros', cancelado: 'Cancelado', concluido: 'Concluído',
}
const PHASE_COLORS: Record<DemandPhase, string> = {
  pendente:      'bg-yellow-50 text-yellow-700 border border-yellow-200',
  em_andamento:  'bg-blue-50 text-blue-700 border border-blue-200',
  ag_terceiros:  'bg-orange-50 text-orange-700 border border-orange-200',
  cancelado:     'bg-red-50 text-red-700 border border-red-200',
  concluido:     'bg-emerald-50 text-emerald-700 border border-emerald-200',
}

const PRIORITY_CONFIG: Record<DemandPriority, { dot: string; label: string; flag: string }> = {
  low:    { dot: 'bg-slate-300',   label: 'Baixa', flag: 'text-slate-400'  },
  medium: { dot: 'bg-amber-400',   label: 'Média', flag: 'text-amber-500'  },
  high:   { dot: 'bg-red-500',     label: 'Alta',  flag: 'text-red-500'    },
}

const inputCls = 'border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#26619c]/30 focus:border-[#26619c] w-full bg-gray-50'

// ─── Modal ────────────────────────────────────────────────────────────────────

interface FormState {
  title: string
  description: string
  phase: DemandPhase
  priority: DemandPriority
  assigned_to: string
  assigned_to_name: string
  due_date: string
  notes: string
}

const EMPTY_FORM: FormState = {
  title: '', description: '', phase: 'pendente',
  priority: 'medium', assigned_to: '', assigned_to_name: '', due_date: '', notes: '',
}

function DemandModal({ demand, users, onClose, onSaved, serviceOrderId, defaultStatus }: {
  demand: Demand | null
  users: UserOption[]
  onClose: () => void
  onSaved: (d: Demand) => void
  serviceOrderId?: string
  defaultStatus?: DemandStatus
}) {
  const isEdit = !!demand
  const [form, setForm] = useState<FormState>(demand ? {
    title: demand.title,
    description: demand.description ?? '',
    phase: demand.phase,
    priority: demand.priority,
    assigned_to: demand.assigned_to ?? '',
    assigned_to_name: demand.assigned_to_name ?? '',
    due_date: demand.due_date ?? '',
    notes: demand.notes ?? '',
  } : EMPTY_FORM)
  const [saving, setSaving] = useState(false)

  const set = (k: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }))

  const handleUserChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const uid = e.target.value
    const user = users.find(u => u.id === uid)
    setForm(f => ({ ...f, assigned_to: uid, assigned_to_name: user?.full_name ?? '' }))
  }

  const handleSubmit = async () => {
    if (!form.title.trim()) { toast.error('Título obrigatório.'); return }
    setSaving(true)
    try {
      const payload: Record<string, unknown> = {
        title: form.title.trim(),
        description: form.description || null,
        phase: form.phase,
        priority: form.priority,
        assigned_to: form.assigned_to || null,
        assigned_to_name: form.assigned_to_name || null,
        due_date: form.due_date || null,
        notes: form.notes || null,
      }
      if (!isEdit) {
        payload.status = defaultStatus ?? 'gaveta'
        if (serviceOrderId) payload.service_order_id = serviceOrderId
      }
      let saved: Demand
      if (isEdit) {
        const res = await api.patch(`/demands/${demand!.id}`, payload)
        saved = { ...demand!, ...res.data }
      } else {
        const res = await api.post('/demands', payload)
        saved = res.data as Demand
      }
      onSaved(saved)
    } catch (e: any) {
      toast.error(e.response?.data?.detail ?? 'Erro ao salvar.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-4" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg flex flex-col max-h-[92vh]">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="font-bold text-gray-900 text-base">{isEdit ? 'Editar Demanda' : 'Nova Demanda'}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1 rounded-lg hover:bg-gray-100 transition"><X className="w-5 h-5" /></button>
        </div>

        <div className="overflow-y-auto p-6 flex flex-col gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1.5">Título *</label>
            <input value={form.title} onChange={set('title')} className={inputCls} placeholder="Descreva a demanda…" autoFocus />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1.5">Descrição</label>
            <textarea value={form.description} onChange={set('description')} rows={2}
              className={inputCls + ' resize-none'} placeholder="Detalhes opcionais…" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">Fase</label>
              <select value={form.phase} onChange={set('phase')} className={inputCls}>
                {(Object.keys(PHASE_LABELS) as DemandPhase[]).map(p => (
                  <option key={p} value={p}>{PHASE_LABELS[p]}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">Prioridade</label>
              <select value={form.priority} onChange={set('priority')} className={inputCls}>
                {(Object.keys(PRIORITY_CONFIG) as DemandPriority[]).map(p => (
                  <option key={p} value={p}>{PRIORITY_CONFIG[p].label}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">Responsável</label>
              <select value={form.assigned_to} onChange={handleUserChange} className={inputCls}>
                <option value="">Nenhum</option>
                {users.map(u => <option key={u.id} value={u.id}>{u.full_name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">Data limite</label>
              <input type="date" value={form.due_date} onChange={set('due_date')} className={inputCls} />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1.5">Notas</label>
            <textarea value={form.notes} onChange={set('notes')} rows={2}
              className={inputCls + ' resize-none'} placeholder="Observações…" />
          </div>
        </div>

        <div className="flex justify-end gap-2 px-6 py-4 border-t border-gray-100 bg-gray-50 rounded-b-2xl">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700 rounded-xl hover:bg-gray-100 transition">Cancelar</button>
          <button onClick={handleSubmit} disabled={saving}
            className="px-5 py-2 bg-[#26619c] hover:bg-[#1a4f87] text-white rounded-xl text-sm font-semibold disabled:opacity-50 transition">
            {saving ? 'Salvando…' : isEdit ? 'Salvar' : 'Criar'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Card ─────────────────────────────────────────────────────────────────────

function DemandCard({ demand, onEdit, onMove, onDelete, canWrite }: {
  demand: Demand
  canWrite: boolean
  onEdit: () => void
  onDelete: () => void
  onMove: (status: DemandStatus) => void
}) {
  const isOverdue = demand.due_date && new Date(demand.due_date + 'T23:59:59') < new Date() && demand.status !== 'concluido'
  const colIdx = COLUMNS.findIndex(c => c.key === demand.status)
  const canLeft  = canWrite && colIdx > 0
  const canRight = canWrite && colIdx < COLUMNS.length - 1
  const pc = PRIORITY_CONFIG[demand.priority]

  return (
    <div
      className="bg-white rounded-xl border border-gray-100 shadow-sm p-3.5 flex flex-col gap-2.5 hover:shadow-md hover:border-gray-200 transition-all group cursor-pointer"
      onClick={onEdit}
    >
      {/* Top row: phase + priority flag */}
      <div className="flex items-center justify-between gap-1.5">
        <span className={`inline-flex items-center text-[10px] px-2 py-0.5 rounded-full font-medium ${PHASE_COLORS[demand.phase]}`}>
          {PHASE_LABELS[demand.phase]}
        </span>
        <div className="flex items-center gap-1">
          {isOverdue && <AlertCircle className="w-3.5 h-3.5 text-red-500" />}
          <Flag className={`w-3.5 h-3.5 ${pc.flag}`} title={pc.label} />
        </div>
      </div>

      {/* Title */}
      <p className="text-sm font-semibold text-gray-800 leading-snug line-clamp-2">{demand.title}</p>

      {/* Meta */}
      <div className="flex flex-col gap-1">
        {demand.assigned_to_name && (
          <span className="flex items-center gap-1 text-[11px] text-gray-500">
            <User className="w-3 h-3 shrink-0 text-gray-400" />
            <span className="truncate">{demand.assigned_to_name}</span>
          </span>
        )}
        {demand.due_date && (
          <span className={`flex items-center gap-1 text-[11px] ${isOverdue ? 'text-red-500 font-semibold' : 'text-gray-400'}`}>
            <Calendar className="w-3 h-3 shrink-0" />
            {new Date(demand.due_date + 'T12:00:00').toLocaleDateString('pt-BR')}
          </span>
        )}
      </div>

      {/* Actions */}
      {canWrite && (
        <div className="flex items-center gap-1 mt-0.5" onClick={e => e.stopPropagation()}>
          {canLeft && (
            <button onClick={() => onMove(COLUMNS[colIdx - 1].key)}
              className="flex-1 text-[10px] text-gray-400 hover:text-gray-700 border border-gray-100 hover:border-gray-300 rounded-lg py-1 transition flex items-center justify-center gap-0.5">
              <ChevronRight className="w-3 h-3 rotate-180" />{COLUMNS[colIdx - 1].label}
            </button>
          )}
          {canRight && (
            <button onClick={() => onMove(COLUMNS[colIdx + 1].key)}
              className="flex-1 text-[10px] text-gray-400 hover:text-[#26619c] border border-gray-100 hover:border-[#26619c]/30 rounded-lg py-1 transition flex items-center justify-center gap-0.5">
              {COLUMNS[colIdx + 1].label}<ChevronRight className="w-3 h-3" />
            </button>
          )}
          <button onClick={onDelete}
            className="p-1 text-gray-300 hover:text-red-500 rounded-lg hover:bg-red-50 transition">
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
      )}
    </div>
  )
}

// ─── Board ────────────────────────────────────────────────────────────────────

export default function DemandasBoard({ canWrite, serviceOrderId }: { canWrite: boolean; serviceOrderId?: string }) {
  const [demands, setDemands] = useState<Demand[]>([])
  const [users, setUsers] = useState<UserOption[]>([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState<{ demand: Demand | null; status?: DemandStatus } | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = serviceOrderId ? { service_order_id: serviceOrderId } : {}
      const res = await api.get<Demand[]>('/demands', { params })
      setDemands(res.data)
    } catch {
      toast.error('Erro ao carregar demandas.')
    } finally {
      setLoading(false)
    }
  }, [serviceOrderId])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    api.get<UserOption[]>('/admin/users').then(r => setUsers(r.data)).catch(() => {})
  }, [])

  const handleSaved = (saved: Demand) => {
    setDemands(prev => {
      const idx = prev.findIndex(d => d.id === saved.id)
      if (idx >= 0) { const n = [...prev]; n[idx] = { ...prev[idx], ...saved }; return n }
      return [saved, ...prev]
    })
    setModal(null)
    toast.success(saved.id ? 'Salvo!' : 'Demanda criada!')
  }

  const handleMove = async (demand: Demand, status: DemandStatus) => {
    const prev = demands
    setDemands(ds => ds.map(d => d.id === demand.id ? { ...d, status } : d))
    try {
      await api.patch(`/demands/${demand.id}`, { status })
    } catch {
      setDemands(prev)
      toast.error('Erro ao mover.')
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Excluir esta demanda?')) return
    setDeleting(id)
    try {
      await api.delete(`/demands/${id}`)
      setDemands(ds => ds.filter(d => d.id !== id))
      toast.success('Excluído.')
    } catch {
      toast.error('Erro ao excluir.')
    } finally {
      setDeleting(null)
    }
  }

  if (loading) return (
    <div className="flex items-center justify-center py-16 text-gray-400 text-sm gap-2">
      <div className="w-4 h-4 border-2 border-gray-200 border-t-[#26619c] rounded-full animate-spin" />
      Carregando demandas…
    </div>
  )

  const total = demands.length
  const done  = demands.filter(d => d.status === 'concluido').length

  return (
    <div className="flex flex-col gap-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-500">{total} demanda{total !== 1 ? 's' : ''}</span>
          {total > 0 && (
            <div className="flex items-center gap-1.5">
              <div className="w-24 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                <div className="h-full bg-emerald-400 rounded-full transition-all" style={{ width: `${(done / total) * 100}%` }} />
              </div>
              <span className="text-[10px] text-gray-400">{done}/{total}</span>
            </div>
          )}
        </div>
        {canWrite && (
          <button
            onClick={() => setModal({ demand: null, status: 'gaveta' })}
            className="flex items-center gap-1.5 bg-[#26619c] hover:bg-[#1a4f87] text-white px-3.5 py-2 rounded-xl text-xs font-semibold transition shadow-sm"
          >
            <Plus className="w-3.5 h-3.5" /> Nova Demanda
          </button>
        )}
      </div>

      {/* Board */}
      <div className="flex gap-3 overflow-x-auto pb-4 -mx-4 px-4 sm:mx-0 sm:px-0 items-start snap-x">
        {COLUMNS.map(col => {
          const colDemands = demands.filter(d => d.status === col.key)
          const highCount  = colDemands.filter(d => d.priority === 'high').length

          return (
            <div key={col.key} className="flex-shrink-0 w-60 sm:w-64 flex flex-col gap-2 snap-start">
              {/* Column header */}
              <div className={`flex items-center justify-between px-3 py-2 rounded-xl border-l-2 bg-white shadow-sm ${col.accent}`}>
                <span className="text-xs font-bold text-gray-700 tracking-wide">{col.label}</span>
                <div className="flex items-center gap-1.5">
                  {highCount > 0 && (
                    <span className="text-[10px] bg-red-50 text-red-500 px-1.5 py-0.5 rounded-full font-semibold">
                      {highCount} alta
                    </span>
                  )}
                  <span className={`text-xs font-bold px-1.5 py-0.5 rounded-full ${col.badge}`}>{colDemands.length}</span>
                </div>
              </div>

              {/* Cards */}
              <div className="flex flex-col gap-2 min-h-[80px]">
                {colDemands.map(d => (
                  <DemandCard
                    key={d.id}
                    demand={d}
                    canWrite={canWrite && deleting !== d.id}
                    onEdit={() => setModal({ demand: d })}
                    onMove={status => handleMove(d, status)}
                    onDelete={() => handleDelete(d.id)}
                  />
                ))}
                {colDemands.length === 0 && (
                  <div className="text-[11px] text-gray-300 text-center py-6 border border-dashed border-gray-100 rounded-xl">
                    Vazio
                  </div>
                )}
              </div>

              {canWrite && (
                <button
                  onClick={() => setModal({ demand: null, status: col.key })}
                  className="text-xs text-gray-400 hover:text-[#26619c] py-1.5 flex items-center justify-center gap-1 border border-dashed border-gray-200 hover:border-[#26619c]/40 rounded-xl transition hover:bg-[#26619c]/5"
                >
                  <Plus className="w-3 h-3" /> Adicionar
                </button>
              )}
            </div>
          )
        })}
      </div>

      {modal && (
        <DemandModal
          demand={modal.demand}
          users={users}
          onClose={() => setModal(null)}
          onSaved={handleSaved}
          serviceOrderId={serviceOrderId}
          defaultStatus={modal.status}
        />
      )}
    </div>
  )
}
