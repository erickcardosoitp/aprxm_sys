import { useEffect, useRef, useState } from 'react'
import { Search, Package } from 'lucide-react'
import toast from 'react-hot-toast'
import { SimplificaBottomSheet } from '../components/SimplificaBottomSheet'
import api from '../../../services/api'
import type { Package as Pkg } from '../../../types'
import { SECTOR_COLORS } from '../theme'

interface Props { open: boolean; onClose: () => void }

export function DevolucaoSheet({ open, onClose }: Props) {
  const color = SECTOR_COLORS.encomendas
  const [query, setQuery] = useState('')
  const [packages, setPackages] = useState<Pkg[]>([])
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<Pkg | null>(null)
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!open) { setQuery(''); setPackages([]); setSelected(null); setReason('') }
  }, [open])

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    if (query.length < 2) { setPackages([]); return }
    timerRef.current = setTimeout(async () => {
      setLoading(true)
      try {
        const r = await api.get<Pkg[]>('/packages', {
          params: { q: query, status: 'received,notified' }
        })
        setPackages(r.data.slice(0, 8))
      } catch { /* silent */ } finally { setLoading(false) }
    }, 350)
  }, [query])

  const handleReturn = async () => {
    if (!selected || !reason.trim()) return
    setSaving(true)
    try {
      await api.post(`/packages/${selected.id}/return`, { reason: reason.trim() })
      toast.success('Devolução registrada.')
      onClose()
    } catch (e: any) {
      toast.error(e.response?.data?.detail ?? 'Erro ao devolver.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <SimplificaBottomSheet open={open} title="Devolução de Encomenda" onClose={onClose}>
      <div className="flex flex-col gap-4">
        {!selected ? (
          <>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input value={query} onChange={e => setQuery(e.target.value)}
                placeholder="Nome do morador ou rastreio…"
                className="w-full border-2 border-gray-200 rounded-xl pl-10 pr-4 py-3 text-sm focus:outline-none focus:border-amber-500"
                autoFocus />
              {loading && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400">…</span>}
            </div>
            {packages.map(pkg => (
              <button key={pkg.id} onClick={() => setSelected(pkg)}
                className="flex items-center gap-3 bg-gray-50 border border-gray-200 rounded-xl p-3 text-left hover:bg-orange-50 hover:border-amber-400 transition">
                <Package className="w-5 h-5 shrink-0" style={{ color }} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-800 truncate">{pkg.resident_name ?? '—'}</p>
                  <p className="text-xs text-gray-400">{pkg.carrier_name ?? ''}{pkg.tracking_code ? ` · ${pkg.tracking_code}` : ''}</p>
                </div>
              </button>
            ))}
          </>
        ) : (
          <>
            <div className="flex items-center gap-3 bg-orange-50 border border-amber-200 rounded-xl p-3">
              <Package className="w-5 h-5 shrink-0" style={{ color }} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-gray-800">{selected.resident_name ?? '—'}</p>
                <p className="text-xs text-gray-400">{selected.carrier_name ?? ''}{selected.tracking_code ? ` · ${selected.tracking_code}` : ''}</p>
              </div>
              <button onClick={() => setSelected(null)} className="text-xs text-gray-400 underline">Trocar</button>
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">
                Motivo da devolução <span className="text-red-500">*</span>
              </label>
              <textarea rows={3} value={reason} onChange={e => setReason(e.target.value)}
                placeholder="Ex: destinatário ausente, endereço errado…"
                className="w-full border-2 border-gray-200 rounded-xl px-4 py-3 text-sm resize-none focus:outline-none focus:border-amber-500"
                autoFocus />
            </div>
            <button disabled={saving || !reason.trim()} onClick={handleReturn}
              className="w-full py-4 rounded-xl text-base font-bold text-white disabled:opacity-40"
              style={{ backgroundColor: color }}>
              {saving ? 'Registrando…' : 'Confirmar Devolução'}
            </button>
          </>
        )}
      </div>
    </SimplificaBottomSheet>
  )
}
