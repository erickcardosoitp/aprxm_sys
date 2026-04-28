import { useCallback, useEffect, useState } from 'react'
import { Plus, X, ChevronRight, Calendar, User, AlertCircle } from 'lucide-react'
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

const COLUMNS: { key: DemandStatus; label: string; color: string; bg: string }[] = [
  { key: 'gaveta',       label: 'Gaveta',       color: 'text-gray-600',  bg: 'bg-gray-100'   },
  { key: 'a_iniciar',    label: 'A Iniciar',    color: 'text-blue-600',  bg: 'bg-blue-100'   },
  { key: 'em_andamento', label: 'Em Andamento', color: 'text-indigo-600',bg: 'bg-indigo-100' },
  { key: 'parado',       label: 'Parado',       color: 'text-orange-600',bg: 'bg-orange-100' },
  { key: 'concluido',    label: 'Concluído',    color: 'text-green-600', bg: 'bg-green-100'  },
]

const PHASE_LABELS: Record<DemandPhase, string> = {
  pendente: 'Pendente', em_andamento: 'Em Andamento',
  ag_terceiros: 'Ag. Terceiros', cancelado: 'Cancelado', concluido: 'Concluído',
}
const PHASE_COLORS: Record<DemandPhase, string> = {
  pendente: 'bg-yellow-100 text-yellow-700',
  em_andamento: 'bg-blue-100 text-blue-700',
  ag_terceiros: 'bg-orange-100 text-orange-700',
  cancelado: 'bg-red-100 text-red-700',
  concluido: 'bg-green-100 text-green-700',
}

const PRIORITY_DOT: Record<DemandPriority, string> = {
  low: 'bg-gray-400', medium: 'bg-yellow-400', high: 'bg-red-500',
}
const PRIORITY_LABELS: Record<DemandPriority, string> = {
  low: 'Baixa', medium: 'Média', high: 'Alta',
}

const inputCls = 'border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#26619c]/40 focus:border-[#26619c] w-full'
const selectCls = inputCls

// ─── Demand form (create / edit) ──────────────────────────────────────────────

interface FormState {
  title: string
  description: string
  phase: DemandPhase
  priority: DemandPriority
  assigned_to_name: string
  due_date: string
  notes: string
}

const EMPTY_FORM: FormState = {
  title: '', description: '', phase: 'pendente',
  priority: 'medium', assigned_to_name: '', due_date: '', notes: '',
}

function DemandModal({
  demand, users, onClose, onSaved, serviceOrderId,
}: {
  demand: Demand | null
  users: UserOption[]
  onClose: () => void
  onSaved: (d: Demand) => void
  serviceOrderId?: string
}) {
  const isEdit = !!demand
  const [form, setForm] = useState<FormState>(demand ? {
    title: demand.title,
    description: demand.description ?? '',
    phase: demand.phase,
    priority: demand.priority,
    assigned_to_name: demand.assigned_to_name ?? '',
    due_date: demand.due_date ?? '',
    notes: demand.notes ?? '',
  } : EMPTY_FORM)
  const [saving, setSaving] = useState(false)

  const set = (k: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }))

  const handleSubmit = async () => {
    if (!form.title.trim()) { toast.error('Título obrigatório.'); return }
    setSaving(true)
    try {
      const payload: Record<string, unknown> = {
        title: form.title.trim(),
        description: form.description || null,
        phase: form.phase,
        priority: form.priority,
        assigned_to_name: form.assigned_to_name || null,
        due_date: form.due_date || null,
        notes: form.notes || null,
      }
      if (!isEdit && serviceOrderId) payload.service_order_id = serviceOrderId
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
    <div className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="font-bold text-gray-900">{isEdit ? 'Editar Demanda' : 'Nova Demanda'}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>
        <div className="overflow-y-auto p-5 flex flex-col gap-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Título *</label>
            <input value={form.title} onChange={set('title')} className={inputCls} placeholder="Descreva a demanda…" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Descrição</label>
            <textarea value={form.description} onChange={set('description')} rows={2}
              className={inputCls + ' resize-none'} placeholder="Detalhes opcionais…" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Fase</label>
              <select value={form.phase} onChange={set('phase')} className={selectCls}>
                {(Object.keys(PHASE_LABELS) as DemandPhase[]).map(p => (
                  <option key={p} value={p}>{PHASE_LABELS[p]}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Prioridade</label>
              <select value={form.priority} onChange={set('priority')} className={selectCls}>
                {(Object.keys(PRIORITY_LABELS) as DemandPriority[]).map(p => (
                  <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Responsável</label>
              {users.length > 0 ? (
                <select value={form.assigned_to_name} onChange={set('assigned_to_name')} className={selectCls}>
                  <option value="">Nenhum</option>
                  {users.map(u => <option key={u.id} value={u.full_name}>{u.full_name}</option>)}
                </select>
              ) : (
                <input value={form.assigned_to_name} onChange={set('assigned_to_name')} className={inputCls} placeholder="Nome…" />
              )}
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Data limite</label>
              <input type="date" value={form.due_date} onChange={set('due_date')} className={inputCls} />
            </div>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Notas</label>
            <textarea value={form.notes} onChange={set('notes')} rows={2}
              className={inputCls + ' resize-none'} placeholder="Observações…" />
          </div>
        </div>
        <div className="flex justify-end gap-2 px-5 py-4 border-t border-gray-100">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700">Cancelar</button>
          <button onClick={handleSubmit} disabled={saving}
            className="px-5 py-2 bg-[#26619c] hover:bg-[#1a4f87] text-white rounded-xl text-sm font-semibold disabled:opacity-50">
            {saving ? '…' : isEdit ? 'Salvar' : 'Criar'}
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
  const [menuOpen, setMenuOpen] = useState(false)
  const isOverdue = demand.due_date && new Date(demand.due_date + 'T23:59:59') < new Date() && demand.status !== 'concluido'
  const colIdx = COLUMNS.findIndex(c => c.key === demand.status)
  const canLeft  = canWrite && colIdx > 0
  const canRight = canWrite && colIdx < COLUMNS.length - 1

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-3 flex flex-col gap-2 cursor-pointer hover:shadow-md transition group"
      onClick={onEdit}>
      {/* Priority + phase */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full font-medium ${PHASE_COLORS[demand.phase]}`}>
          {PHASE_LABELS[demand.phase]}
        </span>
        <span className={`w-2 h-2 rounded-full ${PRIORITY_DOT[demand.priority]} shrink-0`} title={PRIORITY_LABELS[demand.priority]} />
        {isOverdue && <AlertCircle className="w-3 h-3 text-red-500" />}
      </div>

      {/* Title */}
      <p className="text-sm font-semibold text-gray-800 leading-snug line-clamp-2">{demand.title}</p>

      {/* Meta */}
      <div className="flex items-center gap-2 flex-wrap text-[10px] text-gray-400">
        {demand.assigned_to_name && (
          <span className="flex items-center gap-0.5"><User className="w-2.5 h-2.5" />{demand.assigned_to_name}</span>
        )}
        {demand.due_date && (
          <span className={`flex items-center gap-0.5 ${isOverdue ? 'text-red-500 font-medium' : ''}`}>
            <Calendar className="w-2.5 h-2.5" />
            {new Date(demand.due_date + 'T12:00:00').toLocaleDateString('pt-BR')}
          </span>
        )}
      </div>

      {/* Move buttons */}
      {(canLeft || canRight) && (
        <div className="flex gap-1 mt-0.5" onClick={e => e.stopPropagation()}>
          {canLeft && (
            <button onClick={() => onMove(COLUMNS[colIdx - 1].key)}
              className="flex-1 text-[10px] text-gray-400 hover:text-gray-700 border border-gray-100 hover:border-gray-300 rounded-lg py-0.5 transition flex items-center justify-center gap-0.5">
              <ChevronRight className="w-3 h-3 rotate-180" />
              {COLUMNS[colIdx - 1].label}
            </button>
          )}
          {canRight && (
            <button onClick={() => onMove(COLUMNS[colIdx + 1].key)}
              className="flex-1 text-[10px] text-gray-400 hover:text-[#26619c] border border-gray-100 hover:border-[#26619c]/30 rounded-lg py-0.5 transition flex items-center justify-center gap-0.5">
              {COLUMNS[colIdx + 1].label}
              <ChevronRight className="w-3 h-3" />
            </button>
          )}
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
  }, [])

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
    toast.success('Salvo!')
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
    } catch {
      toast.error('Erro ao excluir.')
    } finally {
      setDeleting(null)
    }
  }

  if (loading) return <div className="p-8 text-center text-gray-400 text-sm">Carregando…</div>

  return (
    <div className="flex flex-col gap-4">
      {/* Toolbar */}
      {canWrite && (
        <div className="flex justify-end">
          <button
            onClick={() => setModal({ demand: null, status: 'gaveta' })}
            className="flex items-center gap-2 bg-[#26619c] hover:bg-[#1a4f87] text-white px-4 py-2 rounded-xl text-sm font-medium transition"
          >
            <Plus className="w-4 h-4" /> Nova Demanda
          </button>
        </div>
      )}

      {/* Kanban columns — horizontal scroll on mobile */}
      <div className="flex gap-3 overflow-x-auto pb-4 -mx-4 px-4 sm:mx-0 sm:px-0 items-start">
        {COLUMNS.map(col => {
          const colDemands = demands.filter(d => d.status === col.key)
          return (
            <div key={col.key} className="flex-shrink-0 w-64 sm:w-72 flex flex-col gap-2">
              {/* Column header */}
              <div className={`flex items-center justify-between px-3 py-2 rounded-xl ${col.bg}`}>
                <span className={`text-xs font-bold uppercase tracking-wide ${col.color}`}>{col.label}</span>
                <span className={`text-xs font-bold ${col.color} opacity-60`}>{colDemands.length}</span>
              </div>

              {/* Cards */}
              <div className="flex flex-col gap-2 min-h-[60px]">
                {colDemands.map(d => (
                  <DemandCard
                    key={d.id}
                    demand={d}
                    canWrite={canWrite}
                    onEdit={() => setModal({ demand: d })}
                    onMove={status => handleMove(d, status)}
                    onDelete={() => handleDelete(d.id)}
                  />
                ))}
                {colDemands.length === 0 && (
                  <div className="text-[11px] text-gray-300 text-center py-4">Vazio</div>
                )}
              </div>

              {/* Add in column */}
              {canWrite && (
                <button
                  onClick={() => setModal({ demand: null, status: col.key })}
                  className="text-xs text-gray-400 hover:text-[#26619c] py-1 flex items-center justify-center gap-1 border border-dashed border-gray-200 hover:border-[#26619c]/30 rounded-xl transition"
                >
                  <Plus className="w-3 h-3" /> Adicionar
                </button>
              )}
            </div>
          )
        })}
      </div>

      {/* Modal */}
      {modal && (
        <DemandModal
          demand={modal.demand}
          users={users}
          onClose={() => setModal(null)}
          onSaved={handleSaved}
          serviceOrderId={serviceOrderId}
        />
      )}
    </div>
  )
}
