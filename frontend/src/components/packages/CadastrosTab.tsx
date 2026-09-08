import { useEffect, useState } from 'react'
import { Pencil, Plus, Trash2, Truck, User } from 'lucide-react'
import toast from 'react-hot-toast'
import { SignaturePad } from './SignaturePad'
import api from '../../services/api'
import { uploadService } from '../../services/upload'

export function CadastrosTab() {
  const [carriers, setCarriers] = useState<{ id: string; name: string }[]>([])
  const [deliverers, setDeliverers] = useState<{ id: string; name: string; carrier_id: string | null; carrier_name: string | null }[]>([])
  const [newCarrierName, setNewCarrierName] = useState('')
  const [newDelivererName, setNewDelivererName] = useState('')
  const [newDelivererCarrierId, setNewDelivererCarrierId] = useState('')
  const [savingCarrier, setSavingCarrier] = useState(false)
  const [savingDeliverer, setSavingDeliverer] = useState(false)
  const [newDelivererSig, setNewDelivererSig] = useState('')
  const [editDeliverer, setEditDeliverer] = useState<{ id: string; name: string; carrier_id: string | null; carrier_name: string | null; signature_url?: string | null } | null>(null)
  const [editDelivererName, setEditDelivererName] = useState('')
  const [editDelivererCarrierId, setEditDelivererCarrierId] = useState('')
  const [editDelivererSig, setEditDelivererSig] = useState('')

  const loadCadastros = async () => {
    try {
      const [rc, rd] = await Promise.all([api.get<{ id: string; name: string }[]>('/carriers'), api.get<{ id: string; name: string; carrier_id: string | null; carrier_name: string | null }[]>('/carriers/deliverers')])
      setCarriers(rc.data)
      setDeliverers(rd.data)
    } catch { /* ignore */ }
  }

  useEffect(() => { loadCadastros() }, [])

  const addCarrier = async () => {
    if (!newCarrierName.trim()) return
    setSavingCarrier(true)
    try {
      const r = await api.post<{ id: string; name: string }>('/carriers', { name: newCarrierName.trim() })
      setCarriers(prev => [...prev, r.data].sort((a, b) => a.name.localeCompare(b.name)))
      setNewCarrierName('')
    } catch { toast.error('Erro ao cadastrar transportadora') } finally { setSavingCarrier(false) }
  }

  const removeCarrier = async (id: string) => {
    await api.delete(`/carriers/${id}`)
    setCarriers(prev => prev.filter(c => c.id !== id))
  }

  const addDeliverer = async () => {
    if (!newDelivererName.trim()) return
    if (!newDelivererSig) { toast.error('Assinatura do entregador é obrigatória.'); return }
    setSavingDeliverer(true)
    try {
      const r = await api.post<{ id: string; name: string; carrier_id: string | null }>('/carriers/deliverers', {
        name: newDelivererName.trim(),
        carrier_id: newDelivererCarrierId || null,
        signature_url: newDelivererSig,
      })
      setDeliverers(prev => [...prev, { ...r.data, carrier_name: carriers.find(c => c.id === newDelivererCarrierId)?.name ?? null, signature_url: newDelivererSig }].sort((a, b) => a.name.localeCompare(b.name)))
      setNewDelivererName('')
      setNewDelivererCarrierId('')
      setNewDelivererSig('')
    } catch { toast.error('Erro ao cadastrar entregador') } finally { setSavingDeliverer(false) }
  }

  const removeDeliverer = async (id: string) => {
    await api.delete(`/carriers/deliverers/${id}`)
    setDeliverers(prev => prev.filter(d => d.id !== id))
  }

  const saveEditDeliverer = async () => {
    if (!editDeliverer) return
    const sig = editDelivererSig || editDeliverer.signature_url
    if (!sig) { toast.error('Assinatura do entregador é obrigatória.'); return }
    await api.patch(`/carriers/deliverers/${editDeliverer.id}`, {
      name: editDelivererName.trim(),
      carrier_id: editDelivererCarrierId || null,
      signature_url: sig,
    })
    setDeliverers(prev => prev.map(d => d.id === editDeliverer.id
      ? { ...d, name: editDelivererName, carrier_id: editDelivererCarrierId || null, carrier_name: carriers.find(c => c.id === editDelivererCarrierId)?.name ?? null, signature_url: sig }
      : d
    ))
    setEditDeliverer(null)
    setEditDelivererSig('')
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Carriers */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-gray-800 flex items-center gap-2">
          <Truck className="w-4 h-4 text-[#26619c]" /> Transportadoras
        </h2>
        <div className="flex gap-2">
          <input value={newCarrierName} onChange={e => setNewCarrierName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addCarrier()}
            placeholder="Nome da transportadora" className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#26619c]/30 focus:border-[#26619c]" />
          <button onClick={addCarrier} disabled={savingCarrier || !newCarrierName.trim()}
            className="bg-[#26619c] text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-[#1a4f87] disabled:opacity-50 transition flex items-center gap-1">
            <Plus className="w-4 h-4" /> Adicionar
          </button>
        </div>
        {carriers.length === 0
          ? <p className="text-xs text-gray-400 text-center py-3">Nenhuma transportadora cadastrada.</p>
          : <ul className="divide-y divide-gray-100">
              {carriers.map(c => (
                <li key={c.id} className="flex items-center justify-between py-2.5">
                  <span className="text-sm text-gray-800">{c.name}</span>
                  <button onClick={() => removeCarrier(c.id)} className="p-1.5 text-gray-300 hover:text-red-500 rounded-lg hover:bg-red-50 transition">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </li>
              ))}
            </ul>
        }
      </div>

      {/* Deliverers */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-gray-800 flex items-center gap-2">
          <User className="w-4 h-4 text-[#26619c]" /> Entregadores
        </h2>
        <div className="flex flex-col gap-2">
          <div className="flex gap-2">
            <input value={newDelivererName} onChange={e => setNewDelivererName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addDeliverer()}
              placeholder="Nome do entregador" className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#26619c]/30 focus:border-[#26619c]" />
            <select value={newDelivererCarrierId} onChange={e => setNewDelivererCarrierId(e.target.value)}
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-600 bg-white focus:outline-none focus:ring-2 focus:ring-[#26619c]/30">
              <option value="">Transportadora (opcional)</option>
              {carriers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Assinatura <span className="text-red-500">*</span></label>
            {newDelivererSig
              ? <div className="flex items-center gap-3">
                  <img src={newDelivererSig} alt="assinatura" className="h-14 border border-gray-200 rounded-lg bg-white object-contain px-2" />
                  <button onClick={() => setNewDelivererSig('')} className="text-xs text-red-500 hover:underline">Refazer</button>
                </div>
              : <SignaturePad label="Assinatura do entregador" onSave={setNewDelivererSig} onClear={() => setNewDelivererSig('')}
                  onUpload={dataUrl => uploadService.uploadBase64(dataUrl, 'packages/signatures')} />
            }
          </div>
          <button onClick={addDeliverer} disabled={savingDeliverer || !newDelivererName.trim() || !newDelivererSig}
            className="self-end bg-[#26619c] text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-[#1a4f87] disabled:opacity-50 transition flex items-center gap-1">
            <Plus className="w-4 h-4" /> Adicionar
          </button>
        </div>
        {deliverers.length === 0
          ? <p className="text-xs text-gray-400 text-center py-3">Nenhum entregador cadastrado.</p>
          : <ul className="divide-y divide-gray-100">
              {deliverers.map(d => (
                <li key={d.id} className="py-2.5">
                  {editDeliverer?.id === d.id ? (
                    <div className="flex flex-col gap-2">
                      <div className="flex gap-2">
                        <input value={editDelivererName} onChange={e => setEditDelivererName(e.target.value)}
                          className="flex-1 border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#26619c]/30" />
                        <select value={editDelivererCarrierId} onChange={e => setEditDelivererCarrierId(e.target.value)}
                          className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm text-gray-600 bg-white focus:outline-none">
                          <option value="">Sem transportadora</option>
                          {carriers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">Assinatura</label>
                        {(editDelivererSig || editDeliverer?.signature_url)
                          ? <div className="flex items-center gap-3">
                              <img src={editDelivererSig || editDeliverer?.signature_url!} alt="assinatura" className="h-12 border border-gray-200 rounded-lg bg-white object-contain px-2" />
                              <button onClick={() => setEditDelivererSig('')} className="text-xs text-red-500 hover:underline">Trocar</button>
                            </div>
                          : <SignaturePad label="Nova assinatura" onSave={setEditDelivererSig} onClear={() => setEditDelivererSig('')}
                              onUpload={dataUrl => uploadService.uploadBase64(dataUrl, 'packages/signatures')} />
                        }
                      </div>
                      <div className="flex gap-2 justify-end">
                        <button onClick={() => { setEditDeliverer(null); setEditDelivererSig('') }} className="text-xs text-gray-500 px-3 py-1 rounded-lg border border-gray-200 hover:bg-gray-50">Cancelar</button>
                        <button onClick={saveEditDeliverer} className="text-xs text-white bg-[#26619c] px-3 py-1 rounded-lg hover:bg-[#1a4f87]">Salvar</button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-3 min-w-0">
                        {(d as any).signature_url && (
                          <img src={(d as any).signature_url} alt="" className="h-10 w-16 border border-gray-200 rounded bg-white object-contain px-1 shrink-0" />
                        )}
                        <div>
                          <p className="text-sm text-gray-800">{d.name}</p>
                          {d.carrier_name && <p className="text-xs text-gray-400">{d.carrier_name}</p>}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button onClick={() => { setEditDeliverer(d as any); setEditDelivererName(d.name); setEditDelivererCarrierId(d.carrier_id ?? ''); setEditDelivererSig('') }}
                          className="p-1.5 text-gray-300 hover:text-blue-500 rounded-lg hover:bg-blue-50 transition">
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button onClick={() => removeDeliverer(d.id)} className="p-1.5 text-gray-300 hover:text-red-500 rounded-lg hover:bg-red-50 transition">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              ))}
            </ul>
        }
      </div>
    </div>
  )
}
