import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, Plus, RefreshCw, Circle, CheckCircle2, Clock, AlertCircle, X } from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../../services/api'
import { SECTOR_COLORS } from './theme'
import { useAuthStore } from '../../store/authStore'

interface Task {
  id: string
  title: string
  description?: string | null
  status: 'pending' | 'in_progress' | 'done' | 'blocked'
  assigned_to_name?: string | null
  due_date?: string | null
  checklist?: { text: string; done?: boolean; status?: string }[]
}

const STATUS_NEXT: Record<string, string> = {
  pending: 'in_progress',
  in_progress: 'done',
  done: 'pending',
  blocked: 'in_progress',
}

const STATUS_ICON = {
  pending: Circle,
  in_progress: Clock,
  done: CheckCircle2,
  blocked: AlertCircle,
}

const STATUS_COLOR: Record<string, string> = {
  pending: '#9ca3af',
  in_progress: '#f59e0b',
  done: '#10b981',
  blocked: '#ef4444',
}

const STATUS_LABEL: Record<string, string> = {
  pending: 'Pendente',
  in_progress: 'Em andamento',
  done: 'Concluída',
  blocked: 'Bloqueada',
}

interface Props { onClose: () => void }

export function SimplificaTarefas({ onClose }: Props) {
  const color = SECTOR_COLORS.ordens
  const { fullName } = useAuthStore()

  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [toggling, setToggling] = useState<string | null>(null)

  // Novo form
  const [showForm, setShowForm] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [newDesc, setNewDesc] = useState('')
  const [saving, setSaving] = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      const r = await api.get<Task[]>('/daily-tasks', { params: { view: 'default' } })
      setTasks(r.data)
    } catch { toast.error('Erro ao carregar tarefas.') }
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  const toggleStatus = async (task: Task) => {
    if (toggling) return
    const next = STATUS_NEXT[task.status] ?? 'pending'
    setToggling(task.id)
    try {
      await api.patch(`/daily-tasks/${task.id}`, { status: next })
      setTasks(prev => prev.map(t => t.id === task.id ? { ...t, status: next as Task['status'] } : t))
    } catch (e: any) {
      toast.error(e.response?.data?.detail ?? 'Erro ao atualizar.')
    } finally { setToggling(null) }
  }

  const createTask = async () => {
    if (!newTitle.trim()) { toast.error('Título obrigatório.'); return }
    setSaving(true)
    try {
      await api.post('/daily-tasks', {
        title: newTitle.trim(),
        description: newDesc.trim() || undefined,
        assigned_to_name: fullName || undefined,
      })
      toast.success('Tarefa criada!')
      setNewTitle('')
      setNewDesc('')
      setShowForm(false)
      load()
    } catch (e: any) {
      toast.error(e.response?.data?.detail ?? 'Erro ao criar.')
    } finally { setSaving(false) }
  }

  const pending  = tasks.filter(t => t.status !== 'done')
  const done     = tasks.filter(t => t.status === 'done')

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-slate-100">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 text-white shrink-0"
        style={{ backgroundColor: color, paddingTop: 'max(12px, env(safe-area-inset-top))' }}>
        <button onClick={onClose} className="p-1 -ml-1 rounded-lg hover:bg-white/10">
          <ChevronLeft className="w-6 h-6" />
        </button>
        <span className="font-bold text-base flex-1">Tarefas Diárias</span>
        <button onClick={load} className="p-2 rounded-lg hover:bg-white/10">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
        <button onClick={() => setShowForm(true)} className="p-2 rounded-lg hover:bg-white/10">
          <Plus className="w-5 h-5" />
        </button>
      </div>

      {/* Lista */}
      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-2"
        style={{ paddingBottom: 'max(16px, env(safe-area-inset-bottom))' }}>

        {loading ? (
          <div className="flex justify-center py-12">
            <div className="w-6 h-6 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: color }} />
          </div>
        ) : tasks.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-16 text-gray-400">
            <CheckCircle2 className="w-12 h-12" />
            <p className="text-sm">Nenhuma tarefa para hoje.</p>
            <button onClick={() => setShowForm(true)}
              className="mt-2 text-sm font-semibold px-4 py-2 rounded-xl text-white"
              style={{ backgroundColor: color }}>
              + Nova Tarefa
            </button>
          </div>
        ) : (
          <>
            {pending.length > 0 && (
              <>
                <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wider px-1 mb-1">
                  Em aberto · {pending.length}
                </p>
                {pending.map(task => <TaskCard key={task.id} task={task} onToggle={toggleStatus} toggling={toggling === task.id} />)}
              </>
            )}
            {done.length > 0 && (
              <>
                <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wider px-1 mt-3 mb-1">
                  Concluídas · {done.length}
                </p>
                {done.map(task => <TaskCard key={task.id} task={task} onToggle={toggleStatus} toggling={toggling === task.id} />)}
              </>
            )}
          </>
        )}
      </div>

      {/* Modal nova tarefa */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-end bg-black/40" onClick={() => setShowForm(false)}>
          <div className="bg-white rounded-t-2xl w-full p-5 flex flex-col gap-4"
            style={{ paddingBottom: 'max(20px, env(safe-area-inset-bottom))' }}
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <span className="font-bold text-gray-900">Nova Tarefa</span>
              <button onClick={() => setShowForm(false)} className="text-gray-400">
                <X className="w-5 h-5" />
              </button>
            </div>
            <input value={newTitle} onChange={e => setNewTitle(e.target.value)}
              placeholder="Título da tarefa *"
              className="w-full border-2 border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-purple-400"
              autoFocus />
            <textarea rows={3} value={newDesc} onChange={e => setNewDesc(e.target.value)}
              placeholder="Descrição (opcional)"
              className="w-full border-2 border-gray-200 rounded-xl px-4 py-3 text-sm resize-none focus:outline-none focus:border-purple-400" />
            <button disabled={saving || !newTitle.trim()} onClick={createTask}
              className="w-full py-4 rounded-xl text-base font-bold text-white disabled:opacity-40"
              style={{ backgroundColor: color }}>
              {saving ? 'Criando…' : 'Criar Tarefa'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function TaskCard({ task, onToggle, toggling }: { task: Task; onToggle: (t: Task) => void; toggling: boolean }) {
  const Icon = STATUS_ICON[task.status] ?? Circle
  const iconColor = STATUS_COLOR[task.status]
  const isDone = task.status === 'done'

  return (
    <div className={`bg-white rounded-2xl shadow-sm border p-4 flex items-start gap-3 ${isDone ? 'opacity-60' : ''}`}
      style={{ borderColor: isDone ? '#e5e7eb' : 'rgba(0,0,0,0.06)' }}>
      <button
        onClick={() => onToggle(task)}
        disabled={toggling}
        className="mt-0.5 shrink-0 transition"
        style={{ color: iconColor }}
      >
        {toggling
          ? <div className="w-5 h-5 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: iconColor }} />
          : <Icon className="w-5 h-5" />
        }
      </button>
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-semibold text-gray-800 ${isDone ? 'line-through text-gray-400' : ''}`}>
          {task.title}
        </p>
        {task.description && (
          <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{task.description}</p>
        )}
        <div className="flex items-center gap-2 mt-1.5 flex-wrap">
          <span className="text-[11px] font-semibold px-1.5 py-0.5 rounded-full"
            style={{ backgroundColor: `${iconColor}18`, color: iconColor }}>
            {STATUS_LABEL[task.status]}
          </span>
          {task.assigned_to_name && (
            <span className="text-[11px] text-gray-400 truncate max-w-[120px]">{task.assigned_to_name}</span>
          )}
          {task.due_date && (
            <span className="text-[11px] text-gray-400">
              {new Date(task.due_date + 'T00:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}
            </span>
          )}
        </div>
        {task.checklist && task.checklist.length > 0 && (
          <div className="mt-2 flex items-center gap-1.5">
            <div className="flex-1 bg-gray-100 rounded-full h-1.5 overflow-hidden">
              <div className="h-full bg-emerald-500 rounded-full transition-all"
                style={{ width: `${Math.round(task.checklist.filter(c => c.done || c.status === 'done').length / task.checklist.length * 100)}%` }} />
            </div>
            <span className="text-[10px] text-gray-400 shrink-0">
              {task.checklist.filter(c => c.done || c.status === 'done').length}/{task.checklist.length}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
