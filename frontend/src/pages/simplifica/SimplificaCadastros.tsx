import { useEffect, useState } from 'react'
import { ChevronLeft, Trash2, Plus } from 'lucide-react'
import toast from 'react-hot-toast'
import { SignaturePad } from '../../components/packages/SignaturePad'
import api from '../../services/api'
import { SECTOR_COLORS } from './theme'

interface Carrier   { id: string; name: string }
interface Deliverer { id: string; name: string; carrier_id: string | null; carrier_name: string | null; signature_url?: string | null }

interface Props { onClose: () => void }

export function SimplificaCadastros({ onClose }: Props) {
  const color = SECTOR_COLORS.encomendas
  const [tab, setTab] = useState<'transportadoras' | 'entregadores'>('transportadoras')

  // Transportadoras
  const [carriers, setCarriers] = useState<Carrier[]>([])
  const [newCarrier, setNewCarrier] = useState('')
  const [savingCarrier, setSavingCarrier] = useState(false)

  // Entregadores
  const [deliverers, setDeliverers] = useState<Deliverer[]>([])
  const [newDeliverer, setNewDeliverer] = useState('')
  const [newDelivererCarrierId, setNewDelivererCarrierId] = useState('')
  const [newDelivererSig, setNewDelivererSig] = useState('')
  const [savingDeliverer, setSavingDeliverer] = useState(false)

  const load = async () => {
    try {
      const [rc, rd] = await Promise.all([
        api.get<Carrier[]>('/carriers'),
        api.get<Deliverer[]>('/carriers/deliverers'),
      ])
      setCarriers(rc.data)
      setDeliverers(rd.data)
    } catch { /* silent */ }
  }

  useEffect(() => { load() }, [])

  const addCarrier = async () => {
    if (!newCarrier.trim()) return
    setSavingCarrier(true)
    try {
      const r = await api.post<Carrier>('/carriers', { name: newCarrier.trim() })
      setCarriers(prev => [...prev, r.data].sort((a, b) => a.name.localeCompare(b.name)))
      setNewCarrier('')
      toast.success('Transportadora cadastrada.')
    } catch (e: any) { toast.error(e.response?.data?.detail ?? 'Erro.') } finally { setSavingCarrier(false) }
  }

  const removeCarrier = async (id: string) => {
    try {
      await api.delete(`/carriers/${id}`)
      setCarriers(prev => prev.filter(c => c.id !== id))
    } catch { toast.error('Erro ao remover.') }
  }

  const addDeliverer = async () => {
    if (!newDeliverer.trim()) { toast.error('Nome obrigatório.'); return }
    if (!newDelivererSig) { toast.error('Assinatura obrigatória.'); return }
    setSavingDeliverer(true)
    try {
      const r = await api.post<Deliverer>('/carriers/deliverers', {
        name: newDeliverer.trim(),
        carrier_id: newDelivererCarrierId || null,
        signature_url: newDelivererSig,
      })
      setDeliverers(prev => [...prev, {
        ...r.data,
        carrier_name: carriers.find(c => c.id === newDelivererCarrierId)?.name ?? null,
        signature_url: newDelivererSig,
      }].sort((a, b) => a.name.localeCompare(b.name)))
      setNewDeliverer('')
      setNewDelivererCarrierId('')
      setNewDelivererSig('')
      toast.success('Entregador cadastrado.')
    } catch (e: any) { toast.error(e.response?.data?.detail ?? 'Erro.') } finally { setSavingDeliverer(false) }
  }

  const removeDeliverer = async (id: string) => {
    try {
      await api.delete(`/carriers/deliverers/${id}`)
      setDeliverers(prev => prev.filter(d => d.id !== id))
    } catch { toast.error('Erro ao remover.') }
  }

  const inputCls = 'w-full border-2 border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-amber-500 bg-white'

  return (
    <div className="fixed inset-0 z-40 bg-slate-100 flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 text-white shrink-0"
        style={{ backgroundColor: color, paddingTop: 'max(12px, env(safe-area-inset-top))' }}>
        <button onClick={onClose} className="p-1 -ml-1 rounded-lg hover:bg-white/10">
          <ChevronLeft className="w-6 h-6" />
        </button>
        <span className="font-bold text-base">Cadastros</span>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 px-4 py-3 bg-white border-b border-gray-100 shrink-0">
        {(['transportadoras', 'entregadores'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`flex-1 py-2.5 rounded-xl text-sm font-semibold border-2 capitalize transition ${
              tab === t ? 'text-white border-transparent' : 'bg-white border-gray-200 text-gray-600'
            }`}
            style={tab === t ? { backgroundColor: color, borderColor: color } : undefined}>
            {t === 'transportadoras' ? 'Transportadoras' : 'Entregadores'}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">

        {/* ── Transportadoras ── */}
        {tab === 'transportadoras' && (
          <>
            <div className="flex gap-2">
              <input value={newCarrier} onChange={e => setNewCarrier(e.target.value)}
                placeholder="Nome da transportadora"
                onKeyDown={e => e.key === 'Enter' && addCarrier()}
                className="flex-1 border-2 border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-amber-500 bg-white" />
              <button disabled={savingCarrier || !newCarrier.trim()} onClick={addCarrier}
                className="w-12 h-12 flex items-center justify-center rounded-xl text-white disabled:opacity-40"
                style={{ backgroundColor: color }}>
                <Plus className="w-5 h-5" />
              </button>
            </div>
            {carriers.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-8">Nenhuma transportadora cadastrada.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {carriers.map(c => (
                  <div key={c.id} className="flex items-center gap-3 bg-white border border-gray-100 rounded-2xl px-4 py-3 shadow-sm">
                    <span className="flex-1 text-sm font-medium text-gray-800">{c.name}</span>
                    <button onClick={() => removeCarrier(c.id)} className="text-gray-300 hover:text-red-500 transition">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {/* ── Entregadores ── */}
        {tab === 'entregadores' && (
          <>
            <input value={newDeliverer} onChange={e => setNewDeliverer(e.target.value)}
              placeholder="Nome do entregador *"
              className={inputCls} />

            {carriers.length > 0 && (
              <select value={newDelivererCarrierId} onChange={e => setNewDelivererCarrierId(e.target.value)}
                className={inputCls}>
                <option value="">Transportadora (opcional)</option>
                {carriers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            )}

            <SignaturePad
              label="Assinatura do entregador *"
              onSave={url => setNewDelivererSig(url)}
            />

            <button disabled={savingDeliverer || !newDeliverer.trim() || !newDelivererSig} onClick={addDeliverer}
              className="w-full py-4 rounded-xl text-base font-bold text-white disabled:opacity-40 transition"
              style={{ backgroundColor: color }}>
              {savingDeliverer ? 'Cadastrando…' : 'Cadastrar Entregador'}
            </button>

            {deliverers.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-4">Nenhum entregador cadastrado.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {deliverers.map(d => (
                  <div key={d.id} className="flex items-center gap-3 bg-white border border-gray-100 rounded-2xl px-4 py-3 shadow-sm">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-800">{d.name}</p>
                      {d.carrier_name && <p className="text-xs text-gray-400">{d.carrier_name}</p>}
                    </div>
                    {d.signature_url && (
                      <img src={d.signature_url} alt="Assinatura" className="h-8 w-16 object-contain border border-gray-100 rounded" />
                    )}
                    <button onClick={() => removeDeliverer(d.id)} className="text-gray-300 hover:text-red-500 transition">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
