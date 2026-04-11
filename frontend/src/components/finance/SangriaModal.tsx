import { useEffect, useState } from 'react'
import { X, AlertTriangle } from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../../services/api'
import { financeService } from '../../services/finance'
import { PhotoCapture } from '../packages/PhotoCapture'

interface Props {
  onClose: () => void
  onSuccess: () => void
}

interface Dest { id: string; name: string }

export function SangriaModal({ onClose, onSuccess }: Props) {
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const [destinationId, setDestinationId] = useState('')
  const [destinationText, setDestinationText] = useState('')
  const [receiptPhotoUrl, setReceiptPhotoUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [destinations, setDestinations] = useState<Dest[]>([])

  useEffect(() => {
    api.get<Dest[]>('/finance/sangria-destinations').then(r => setDestinations(r.data)).catch(() => {})
  }, [])

  const destination = destinations.length > 0
    ? (destinations.find(d => d.id === destinationId)?.name ?? '')
    : destinationText

  const canSubmit = amount && reason && destination && receiptPhotoUrl

  const handleSubmit = async () => {
    if (!canSubmit) return
    setLoading(true)
    try {
      await financeService.performSangria({
        amount: parseFloat(amount),
        reason,
        destination,
        receipt_photo_url: receiptPhotoUrl,
      })
      toast.success('Sangria registrada com sucesso!')
      onSuccess()
      onClose()
    } catch (e: any) {
      toast.error(e.response?.data?.detail ?? 'Erro ao realizar sangria.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40">
      <div className="w-full max-w-md bg-white rounded-t-2xl sm:rounded-2xl shadow-xl p-6">
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-amber-500" />
            Realizar Sangria
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>

        <div className="flex flex-col gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Valor (R$) *</label>
            <input type="number" min="0.01" step="0.01" value={amount} onChange={e => setAmount(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              placeholder="0,00" />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Justificativa *</label>
            <textarea rows={2} value={reason} onChange={e => setReason(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 resize-none"
              placeholder="Motivo da sangria…" />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Destino *</label>
            {destinations.length > 0 ? (
              <select value={destinationId} onChange={e => setDestinationId(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 bg-white">
                <option value="">Selecione o destino…</option>
                {destinations.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            ) : (
              <input type="text" value={destinationText} onChange={e => setDestinationText(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                placeholder="Ex: Cofre, Banco Bradesco…" />
            )}
          </div>

          <PhotoCapture label="Foto do Recibo *" onCapture={entry => setReceiptPhotoUrl(entry.url)} />
        </div>

        <button onClick={handleSubmit} disabled={!canSubmit || loading}
          className="mt-5 w-full bg-amber-500 hover:bg-amber-600 text-white py-3 rounded-xl font-semibold transition disabled:opacity-50">
          {loading ? 'Registrando…' : 'Confirmar Sangria'}
        </button>
      </div>
    </div>
  )
}
