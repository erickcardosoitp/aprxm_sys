import { useState } from 'react'
import { Download, DollarSign, Users, Package, FileText, CreditCard, ClipboardList } from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../../services/api'

interface Module {
  key: string
  label: string
  endpoint: string
  icon: React.ComponentType<{ className?: string }>
  hasDate: boolean
  description: string
}

const MODULES: Module[] = [
  { key: 'finance', label: 'Financeiro', endpoint: 'finance', icon: DollarSign, hasDate: true, description: 'Entradas e saídas por período' },
  { key: 'residents', label: 'Moradores', endpoint: 'residents', icon: Users, hasDate: false, description: 'Cadastro completo de moradores' },
  { key: 'packages', label: 'Encomendas', endpoint: 'packages', icon: Package, hasDate: true, description: 'Encomendas recebidas no período' },
  { key: 'service_orders', label: 'Ordens de Serviço', endpoint: 'service-orders', icon: FileText, hasDate: true, description: 'Todas as OS abertas no período' },
  { key: 'mensalidades', label: 'Mensalidades', endpoint: 'mensalidades', icon: CreditCard, hasDate: true, description: 'Mensalidades com vencimento no período' },
  { key: 'daily_records', label: 'Registros Diários', endpoint: 'daily-records', icon: ClipboardList, hasDate: true, description: 'Tarefas com data de entrega no período' },
]

function firstDayOfMonth() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}

function today() {
  return new Date().toISOString().split('T')[0]
}

export default function ReportsPage() {
  const [dateFrom, setDateFrom] = useState(firstDayOfMonth)
  const [dateTo, setDateTo] = useState(today)
  const [loading, setLoading] = useState<string | null>(null)

  const exportReport = async (mod: Module) => {
    setLoading(mod.key)
    try {
      const params = mod.hasDate ? { date_from: dateFrom, date_to: dateTo } : {}
      const res = await api.get(`/reports/${mod.endpoint}`, { params, responseType: 'blob' })
      const url = URL.createObjectURL(new Blob([res.data], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      }))
      const a = document.createElement('a')
      const suffix = mod.hasDate ? `_${dateFrom}_${dateTo}` : ''
      a.href = url
      a.download = `${mod.endpoint}${suffix}.xlsx`
      a.click()
      URL.revokeObjectURL(url)
      toast.success(`${mod.label} exportado!`)
    } catch (e: any) {
      toast.error(e.response?.data?.detail ?? 'Erro ao exportar.')
    } finally {
      setLoading(null)
    }
  }

  const inputCls = 'border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#26619c]/40 focus:border-[#26619c]'

  return (
    <div className="flex flex-col gap-5 p-4 sm:p-6 max-w-screen-lg mx-auto w-full">
      <div className="flex items-center gap-3">
        <Download className="w-6 h-6 text-[#26619c]" />
        <h1 className="text-2xl font-bold text-gray-900">Relatórios</h1>
      </div>

      {/* Period filter */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Período padrão</p>
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="block text-xs text-gray-600 mb-1">De</label>
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className="block text-xs text-gray-600 mb-1">Até</label>
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className={inputCls} />
          </div>
          <p className="text-xs text-gray-400 self-center">Módulos sem filtro de data exportam o cadastro completo.</p>
        </div>
      </div>

      {/* Module cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {MODULES.map(mod => {
          const Icon = mod.icon
          const isLoading = loading === mod.key
          return (
            <div key={mod.key} className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 flex items-center gap-4">
              <div className="w-11 h-11 rounded-xl bg-[#e8f0fb] flex items-center justify-center shrink-0">
                <Icon className="w-5 h-5 text-[#26619c]" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-gray-900 text-sm">{mod.label}</p>
                <p className="text-xs text-gray-400 truncate">{mod.description}</p>
                {mod.hasDate && (
                  <p className="text-[10px] text-gray-300 mt-0.5">
                    {new Date(dateFrom + 'T12:00:00').toLocaleDateString('pt-BR')} — {new Date(dateTo + 'T12:00:00').toLocaleDateString('pt-BR')}
                  </p>
                )}
              </div>
              <button
                onClick={() => exportReport(mod)}
                disabled={isLoading}
                className="flex items-center gap-1.5 px-4 py-2 bg-[#26619c] hover:bg-[#1a4f87] text-white rounded-xl text-xs font-semibold transition disabled:opacity-50 shrink-0"
              >
                {isLoading ? (
                  <span className="inline-block w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  <Download className="w-3.5 h-3.5" />
                )}
                Excel
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
