import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, Search, RefreshCw, Package } from 'lucide-react'
import api from '../../../services/api'
import type { Package as Pkg } from '../../../types'
import { SECTOR_COLORS } from '../theme'

interface Props { onClose: () => void }

const STATUS_LABEL: Record<string, string> = {
  received: 'Aguardando', notified: 'Notificado',
  delivered: 'Entregue', returned: 'Devolvido', reversed: 'Estornado',
}
const STATUS_COLOR: Record<string, string> = {
  received: 'bg-amber-100 text-amber-700',
  notified: 'bg-blue-100 text-blue-700',
  delivered: 'bg-emerald-100 text-emerald-700',
  returned: 'bg-gray-100 text-gray-500',
  reversed: 'bg-red-100 text-red-600',
}

export function ConsultarTela({ onClose }: Props) {
  const color = SECTOR_COLORS.encomendas
  const [query, setQuery] = useState('')
  const [packages, setPackages] = useState<Pkg[]>([])
  const [loading, setLoading] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const load = async (q: string) => {
    setLoading(true)
    try {
      const r = await api.get<Pkg[]>('/packages', { params: q ? { q } : {} })
      setPackages(r.data.slice(0, 30))
    } catch { /* silent */ } finally { setLoading(false) }
  }

  useEffect(() => { load('') }, [])

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => load(query), 400)
  }, [query])

  return (
    <div className="fixed inset-0 z-40 bg-slate-100 flex flex-col">
      <div className="flex items-center gap-3 px-4 py-3 text-white"
        style={{ backgroundColor: color, paddingTop: 'max(12px, env(safe-area-inset-top))' }}>
        <button onClick={onClose} className="p-1 -ml-1 rounded-lg hover:bg-white/10">
          <ChevronLeft className="w-6 h-6" />
        </button>
        <span className="font-bold text-base flex-1">Consultar Encomendas</span>
        <button onClick={() => load(query)} className="p-2 rounded-lg hover:bg-white/10">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <div className="p-4 bg-white border-b border-gray-100">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input value={query} onChange={e => setQuery(e.target.value)}
            placeholder="Nome, unidade, rastreio…"
            className="w-full border-2 border-gray-200 rounded-xl pl-10 pr-4 py-3 text-sm focus:outline-none focus:border-amber-500" />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading && packages.length === 0 ? (
          <div className="flex justify-center py-12">
            <div className="w-6 h-6 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: color }} />
          </div>
        ) : packages.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-16 text-gray-400">
            <Package className="w-10 h-10" />
            <p className="text-sm">Nenhuma encomenda encontrada.</p>
          </div>
        ) : (
          <div className="p-4 flex flex-col gap-2">
            {packages.map(pkg => (
              <div key={pkg.id} className="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm flex items-start gap-3">
                <Package className="w-5 h-5 mt-0.5 shrink-0" style={{ color }} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-800 truncate">{pkg.resident_name ?? '—'}</p>
                  <p className="text-xs text-gray-500 truncate">
                    {pkg.unit ? `Casa/Apto ${pkg.unit}` : ''}
                    {pkg.carrier_name ? ` · ${pkg.carrier_name}` : ''}
                    {pkg.tracking_code ? ` · ${pkg.tracking_code}` : ''}
                  </p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {new Date(pkg.received_at).toLocaleDateString('pt-BR')}
                    {pkg.delivered_at ? ` → ${new Date(pkg.delivered_at).toLocaleDateString('pt-BR')}` : ''}
                  </p>
                </div>
                <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full shrink-0 ${STATUS_COLOR[pkg.status] ?? 'bg-gray-100 text-gray-500'}`}>
                  {STATUS_LABEL[pkg.status] ?? pkg.status}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
