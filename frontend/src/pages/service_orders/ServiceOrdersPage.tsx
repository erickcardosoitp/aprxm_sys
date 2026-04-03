import { useEffect, useState } from 'react'
import { FileText, Plus, Download } from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../../services/api'
import type { ServiceOrder, ServiceOrderPriority, ServiceOrderStatus } from '../../types'

const STATUS_LABELS: Record<ServiceOrderStatus, string> = {
  open: 'Aberta',
  in_progress: 'Em Andamento',
  resolved: 'Resolvida',
  cancelled: 'Cancelada',
}

const STATUS_COLORS: Record<ServiceOrderStatus, string> = {
  open: 'bg-blue-100 text-blue-700',
  in_progress: 'bg-yellow-100 text-yellow-700',
  resolved: 'bg-green-100 text-green-700',
  cancelled: 'bg-gray-100 text-gray-500',
}

const PRIORITY_COLORS: Record<ServiceOrderPriority, string> = {
  low: 'text-gray-400',
  medium: 'text-blue-500',
  high: 'text-orange-500',
  critical: 'text-red-600',
}

const PRIORITY_LABELS: Record<ServiceOrderPriority, string> = {
  low: 'Baixa',
  medium: 'Média',
  high: 'Alta',
  critical: 'Crítica',
}

export default function ServiceOrdersPage() {
  const [orders, setOrders] = useState<ServiceOrder[]>([])
  const [showForm, setShowForm] = useState(false)
  const [loading, setLoading] = useState(false)
  const [filterStatus, setFilterStatus] = useState<ServiceOrderStatus | ''>('')

  // form state
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [area, setArea] = useState('')
  const [unit, setUnit] = useState('')
  const [block, setBlock] = useState('')
  const [priority, setPriority] = useState<ServiceOrderPriority>('medium')
  const [requesterName, setRequesterName] = useState('')
  const [requesterPhone, setRequesterPhone] = useState('')

  const load = async () => {
    try {
      const res = await api.get<ServiceOrder[]>('/service-orders', {
        params: filterStatus ? { status: filterStatus } : {},
      })
      setOrders(res.data)
    } catch {
      toast.error('Erro ao carregar ordens de serviço.')
    }
  }

  useEffect(() => { load() }, [filterStatus])

  const handleCreate = async () => {
    if (!title || !description) {
      toast.error('Título e descrição são obrigatórios.')
      return
    }
    setLoading(true)
    try {
      await api.post('/service-orders', {
        title, description, area, unit, block, priority,
        requester_name: requesterName, requester_phone: requesterPhone,
      })
      toast.success('Ordem de serviço criada!')
      setShowForm(false)
      setTitle(''); setDescription(''); setArea(''); setUnit(''); setBlock('')
      setRequesterName(''); setRequesterPhone(''); setPriority('medium')
      load()
    } catch (e: any) {
      toast.error(e.response?.data?.detail ?? 'Erro ao criar OS.')
    } finally {
      setLoading(false)
    }
  }

  const updateStatus = async (id: string, status: ServiceOrderStatus, extra?: object) => {
    try {
      await api.patch(`/service-orders/${id}/status`, { status, ...extra })
      toast.success('Status atualizado.')
      load()
    } catch (e: any) {
      toast.error(e.response?.data?.detail ?? 'Erro.')
    }
  }

  const downloadPdf = async (so: ServiceOrder) => {
    try {
      const res = await api.get(`/service-orders/${so.id}/pdf`, { responseType: 'blob' })
      const url = URL.createObjectURL(res.data)
      const a = document.createElement('a')
      a.href = url
      a.download = `OS-${String(so.number).padStart(4, '0')}.pdf`
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      toast.error('Erro ao gerar PDF.')
    }
  }

  return (
    <div className="flex flex-col gap-5 p-4 max-w-2xl mx-auto">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <FileText className="w-6 h-6 text-brand-600" />
          Ordens de Serviço
        </h1>
        <button
          onClick={() => setShowForm(!showForm)}
          className="flex items-center gap-2 bg-brand-600 hover:bg-brand-700 text-white px-4 py-2 rounded-xl text-sm font-medium transition"
        >
          <Plus className="w-4 h-4" />
          Nova OS
        </button>
      </div>

      {/* Filter */}
      <div className="flex gap-2 flex-wrap">
        {(['', 'open', 'in_progress', 'resolved', 'cancelled'] as const).map((s) => (
          <button
            key={s}
            onClick={() => setFilterStatus(s)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition ${
              filterStatus === s
                ? 'bg-brand-600 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {s === '' ? 'Todas' : STATUS_LABELS[s]}
          </button>
        ))}
      </div>

      {/* Form */}
      {showForm && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
          <h3 className="font-semibold text-gray-800 mb-4">Nova Ordem de Serviço</h3>
          <div className="flex flex-col gap-3">
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Título *"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
            <textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Descrição detalhada *"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 resize-none" />
            <div className="grid grid-cols-2 gap-2">
              <input value={area} onChange={(e) => setArea(e.target.value)} placeholder="Área (ex: Elétrica)"
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
              <select value={priority} onChange={(e) => setPriority(e.target.value as ServiceOrderPriority)}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500">
                {(['low', 'medium', 'high', 'critical'] as ServiceOrderPriority[]).map((p) => (
                  <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="Unidade"
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
              <input value={block} onChange={(e) => setBlock(e.target.value)} placeholder="Bloco"
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input value={requesterName} onChange={(e) => setRequesterName(e.target.value)} placeholder="Nome do solicitante"
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
              <input value={requesterPhone} onChange={(e) => setRequesterPhone(e.target.value)} placeholder="Telefone"
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
            </div>
            <button onClick={handleCreate} disabled={loading}
              className="w-full bg-brand-600 hover:bg-brand-700 text-white py-2.5 rounded-xl font-medium transition disabled:opacity-50">
              {loading ? 'Criando…' : 'Criar Ordem de Serviço'}
            </button>
          </div>
        </div>
      )}

      {/* List */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        {orders.length === 0 ? (
          <div className="p-8 text-center text-gray-400 text-sm">Nenhuma ordem de serviço encontrada.</div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {orders.map((so) => (
              <li key={so.id} className="px-4 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-mono text-gray-400">
                        #{String(so.number).padStart(4, '0')}
                      </span>
                      <span className={`text-xs font-semibold ${PRIORITY_COLORS[so.priority]}`}>
                        ● {PRIORITY_LABELS[so.priority]}
                      </span>
                    </div>
                    <p className="text-sm font-medium text-gray-800 truncate">{so.title}</p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {so.area ?? '—'}
                      {so.unit ? ` · Unid. ${so.unit}` : ''}
                      {so.block ? ` / Bl. ${so.block}` : ''}
                      {' · '}{new Date(so.created_at).toLocaleDateString('pt-BR')}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-2 shrink-0">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[so.status]}`}>
                      {STATUS_LABELS[so.status]}
                    </span>
                    <button onClick={() => downloadPdf(so)}
                      className="flex items-center gap-1 text-xs text-brand-600 hover:underline">
                      <Download className="w-3 h-3" /> PDF
                    </button>
                  </div>
                </div>

                {/* Status actions */}
                {so.status === 'open' && (
                  <div className="flex gap-2 mt-3">
                    <button onClick={() => updateStatus(so.id, 'in_progress')}
                      className="flex-1 py-1.5 text-xs rounded-lg border border-yellow-400 text-yellow-600 hover:bg-yellow-50 transition">
                      Iniciar
                    </button>
                    <button onClick={() => {
                      const reason = prompt('Motivo do cancelamento:')
                      if (reason) updateStatus(so.id, 'cancelled', { cancellation_reason: reason })
                    }}
                      className="flex-1 py-1.5 text-xs rounded-lg border border-gray-300 text-gray-500 hover:bg-gray-50 transition">
                      Cancelar
                    </button>
                  </div>
                )}
                {so.status === 'in_progress' && (
                  <button onClick={() => {
                    const notes = prompt('Notas de resolução:')
                    if (notes) updateStatus(so.id, 'resolved', { resolution_notes: notes })
                  }}
                    className="mt-3 w-full py-1.5 text-xs rounded-lg border border-green-400 text-green-600 hover:bg-green-50 transition">
                    Marcar como Resolvida
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
