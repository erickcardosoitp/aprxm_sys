import { useEffect, useState } from 'react'
import { Trash2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { SimplificaBottomSheet } from '../components/SimplificaBottomSheet'
import { SignaturePad } from '../../../components/packages/SignaturePad'
import api from '../../../services/api'
import { SECTOR_COLORS } from '../theme'

interface Props { open: boolean; onClose: () => void }

interface Carrier { id: string; name: string }
interface Deliverer { id: string; name: string; signature_url?: string }

export function CadastroSheet({ open, onClose }: Props) {
  const color = SECTOR_COLORS.encomendas
  const [tab, setTab] = useState<'carrier' | 'deliverer'>('carrier')

  // Transportadora
  const [carriers, setCarriers] = useState<Carrier[]>([])
  const [newCarrier, setNewCarrier] = useState('')
  const [savingCarrier, setSavingCarrier] = useState(false)

  // Entregador
  const [deliverers, setDeliverers] = useState<Deliverer[]>([])
  const [newDeliverer, setNewDeliverer] = useState('')
  const [delivererSig, setDelivererSig] = useState('')
  const [savingDeliverer, setSavingDeliverer] = useState(false)

  useEffect(() => {
    if (!open) return
    api.get<Carrier[]>('/carriers').then(r => setCarriers(r.data)).catch(() => {})
    api.get<Deliverer[]>('/carriers/deliverers').then(r => setDeliverers(r.data)).catch(() => {})
  }, [open])

  const addCarrier = async () => {
    if (!newCarrier.trim()) return
    setSavingCarrier(true)
    try {
      const r = await api.post<Carrier>('/carriers', { name: newCarrier.trim() })
      setCarriers(prev => [...prev, r.data])
      setNewCarrier('')
      toast.success('Transportadora cadastrada.')
    } catch (e: any) {
      toast.error(e.response?.data?.detail ?? 'Erro ao cadastrar.')
    } finally { setSavingCarrier(false) }
  }

  const removeCarrier = async (id: string) => {
    try {
      await api.delete(`/carriers/${id}`)
      setCarriers(prev => prev.filter(c => c.id !== id))
    } catch { toast.error('Erro ao remover.') }
  }

  const addDeliverer = async () => {
    if (!newDeliverer.trim()) return
    setSavingDeliverer(true)
    try {
      const r = await api.post<Deliverer>('/carriers/deliverers', {
        name: newDeliverer.trim(),
        signature_url: delivererSig || undefined,
      })
      setDeliverers(prev => [...prev, r.data])
      setNewDeliverer('')
      setDelivererSig('')
      toast.success('Entregador cadastrado.')
    } catch (e: any) {
      toast.error(e.response?.data?.detail ?? 'Erro ao cadastrar.')
    } finally { setSavingDeliverer(false) }
  }

  const removeDeliverer = async (id: string) => {
    try {
      await api.delete(`/carriers/deliverers/${id}`)
      setDeliverers(prev => prev.filter(d => d.id !== id))
    } catch { toast.error('Erro ao remover.') }
  }

  return (
    <SimplificaBottomSheet open={open} title="Cadastros" onClose={onClose}>
      {/* Tabs */}
      <div className="flex gap-2 mb-4">
        {(['carrier', 'deliverer'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`flex-1 py-2.5 rounded-xl text-sm font-semibold border-2 transition ${
              tab === t ? 'text-white border-transparent' : 'bg-white border-gray-200 text-gray-600'
            }`}
            style={tab === t ? { backgroundColor: color, borderColor: color } : undefined}>
            {t === 'carrier' ? 'Transportadoras' : 'Entregadores'}
          </button>
        ))}
      </div>

      {tab === 'carrier' && (
        <div className="flex flex-col gap-3">
          <div className="flex gap-2">
            <input value={newCarrier} onChange={e => setNewCarrier(e.target.value)}
              placeholder="Nome da transportadora"
              onKeyDown={e => e.key === 'Enter' && addCarrier()}
              className="flex-1 border-2 border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-amber-500" />
            <button disabled={savingCarrier || !newCarrier.trim()} onClick={addCarrier}
              className="px-4 py-3 rounded-xl text-sm font-bold text-white disabled:opacity-40"
              style={{ backgroundColor: color }}>
              {savingCarrier ? '…' : 'Add'}
            </button>
          </div>
          <div className="flex flex-col gap-2 max-h-64 overflow-y-auto">
            {carriers.length === 0 && <p className="text-sm text-gray-400 text-center py-4">Nenhuma transportadora cadastrada.</p>}
            {carriers.map(c => (
              <div key={c.id} className="flex items-center gap-3 bg-gray-50 rounded-xl px-4 py-3">
                <span className="flex-1 text-sm text-gray-800">{c.name}</span>
                <button onClick={() => removeCarrier(c.id)} className="text-gray-300 hover:text-red-500 transition">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'deliverer' && (
        <div className="flex flex-col gap-3">
          <input value={newDeliverer} onChange={e => setNewDeliverer(e.target.value)}
            placeholder="Nome do entregador"
            className="border-2 border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-amber-500" />
          <SignaturePad label="Assinatura do entregador (opcional)" onSave={url => setDelivererSig(url)} />
          <button disabled={savingDeliverer || !newDeliverer.trim()} onClick={addDeliverer}
            className="w-full py-3 rounded-xl text-sm font-bold text-white disabled:opacity-40"
            style={{ backgroundColor: color }}>
            {savingDeliverer ? 'Cadastrando…' : 'Cadastrar Entregador'}
          </button>
          <div className="flex flex-col gap-2 max-h-48 overflow-y-auto">
            {deliverers.length === 0 && <p className="text-sm text-gray-400 text-center py-4">Nenhum entregador cadastrado.</p>}
            {deliverers.map(d => (
              <div key={d.id} className="flex items-center gap-3 bg-gray-50 rounded-xl px-4 py-3">
                <span className="flex-1 text-sm text-gray-800">{d.name}</span>
                <button onClick={() => removeDeliverer(d.id)} className="text-gray-300 hover:text-red-500 transition">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </SimplificaBottomSheet>
  )
}
