import { useEffect, useState } from 'react'
import { ChevronLeft, RefreshCw, Package } from 'lucide-react'
import { packageService, type ReceiveHistoryEntry } from '../../../services/packages'
import api from '../../../services/api'
import type { Package as Pkg } from '../../../types'
import { useAuthStore } from '../../../store/authStore'
import { SECTOR_COLORS } from '../theme'

interface Props { onClose: () => void }

export function MinhasTela({ onClose }: Props) {
  const color = SECTOR_COLORS.encomendas
  const userId = useAuthStore(s => s.userId)
  const fullName = useAuthStore(s => s.fullName)

  const [tab, setTab] = useState<'recebidas' | 'entregues'>('recebidas')
  const [history, setHistory] = useState<ReceiveHistoryEntry[]>([])
  const [delivered, setDelivered] = useState<Pkg[]>([])
  const [loading, setLoading] = useState(true)

  const loadRecebidas = async () => {
    setLoading(true)
    try {
      const r = await packageService.receiveHistory({ limit: 50 })
      setHistory(r.data)
    } catch { /* silent */ } finally { setLoading(false) }
  }

  const loadEntregues = async () => {
    setLoading(true)
    try {
      const r = await api.get<Pkg[]>('/packages', { params: { status: 'delivered', delivered_by_me: true } })
      setDelivered(r.data.slice(0, 50))
    } catch { /* silent */ } finally { setLoading(false) }
  }

  useEffect(() => {
    if (tab === 'recebidas') loadRecebidas()
    else loadEntregues()
  }, [tab])

  return (
    <div className="fixed inset-0 z-40 bg-slate-100 flex flex-col">
      <div className="flex items-center gap-3 px-4 py-3 text-white"
        style={{ backgroundColor: color, paddingTop: 'max(12px, env(safe-area-inset-top))' }}>
        <button onClick={onClose} className="p-1 -ml-1 rounded-lg hover:bg-white/10">
          <ChevronLeft className="w-6 h-6" />
        </button>
        <span className="font-bold text-base flex-1">Minhas Encomendas</span>
        <button onClick={() => tab === 'recebidas' ? loadRecebidas() : loadEntregues()}
          className="p-2 rounded-lg hover:bg-white/10">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 p-4 bg-white border-b border-gray-100">
        {(['recebidas', 'entregues'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`flex-1 py-2.5 rounded-xl text-sm font-semibold border-2 transition ${
              tab === t ? 'text-white border-transparent' : 'bg-gray-50 border-gray-200 text-gray-600'
            }`}
            style={tab === t ? { backgroundColor: color, borderColor: color } : undefined}>
            {t === 'recebidas' ? 'Por mim recebidas' : 'Por mim entregues'}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex justify-center py-12">
            <div className="w-6 h-6 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: color }} />
          </div>
        ) : tab === 'recebidas' ? (
          history.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-16 text-gray-400">
              <Package className="w-10 h-10" />
              <p className="text-sm">Nenhuma encomenda recebida por você.</p>
            </div>
          ) : (
            <div className="p-4 flex flex-col gap-3">
              {history.map(entry => (
                <div key={entry.id} className="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs text-gray-400">
                      {new Date(entry.received_at).toLocaleDateString('pt-BR', {
                        day: '2-digit', month: '2-digit', year: 'numeric',
                        hour: '2-digit', minute: '2-digit'
                      })}
                    </span>
                    <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${
                      entry.status === 'confirmed' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'
                    }`}>
                      {entry.is_bulk ? `Lote · ${entry.count} encomendas` : '1 encomenda'}
                    </span>
                  </div>
                  {entry.items.map((item, i) => (
                    <div key={i} className="flex items-center gap-2 py-1.5 border-t border-gray-50 first:border-0">
                      <Package className="w-4 h-4 shrink-0 text-gray-400" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-gray-700 truncate">{item.resident_name}</p>
                        <p className="text-xs text-gray-400">
                          {item.unit ? `Casa/Apto ${item.unit}` : ''}
                          {item.carrier_name ? ` · ${item.carrier_name}` : ''}
                          {item.tracking_code ? ` · ${item.tracking_code}` : ''}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )
        ) : (
          delivered.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-16 text-gray-400">
              <Package className="w-10 h-10" />
              <p className="text-sm">Nenhuma encomenda entregue por você.</p>
            </div>
          ) : (
            <div className="p-4 flex flex-col gap-2">
              {delivered.map(pkg => (
                <div key={pkg.id} className="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm flex items-start gap-3">
                  <Package className="w-5 h-5 mt-0.5 shrink-0" style={{ color }} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-800 truncate">{pkg.resident_name ?? '—'}</p>
                    <p className="text-xs text-gray-500">
                      {pkg.unit ? `Casa/Apto ${pkg.unit}` : ''}
                      {pkg.carrier_name ? ` · ${pkg.carrier_name}` : ''}
                    </p>
                    {pkg.delivered_at && (
                      <p className="text-xs text-gray-400 mt-0.5">
                        Entregue {new Date(pkg.delivered_at).toLocaleDateString('pt-BR')}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )
        )}
      </div>
    </div>
  )
}
