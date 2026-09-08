import { useState, useEffect } from 'react'
import { Pencil, X, MessageCircle } from 'lucide-react'
import toast from 'react-hot-toast'
import { PhotoCapture } from './PhotoCapture'
import api from '../../services/api'
import { maskCpf } from '../../utils'
import { useAuthStore } from '../../store/authStore'
import type { Package } from '../../types'
import { STATUS_LABELS, STATUS_COLORS, apiErr } from './packageShared'

interface PackageEvent {
  id: string; comment: string; created_at: string; author_name?: string; event_type?: string
}

interface PackageDetailModalProps {
  pkg: Package
  onClose: () => void
  onDeliverClick: () => void
  onRefresh?: () => void
  dependents?: { id: string; full_name: string; phone_primary?: string }[]
}

export function PackageDetailModal({ pkg: initialPkg, onClose, onDeliverClick, onRefresh, dependents = [] }: PackageDetailModalProps) {
  const [pkg, setPkg] = useState<Package>(initialPkg)
  const [events, setEvents] = useState<PackageEvent[]>([])
  const [newComment, setNewComment] = useState('')
  const [addingEvent, setAddingEvent] = useState(false)
  const [notifying, setNotifying] = useState(false)

  useEffect(() => {
    api.get<Package>(`/packages/${initialPkg.id}`).then(r => setPkg(r.data)).catch(() => {})
  }, [initialPkg.id])
  const [showReturnForm, setShowReturnForm] = useState(false)
  const [returnReason, setReturnReason] = useState('')
  const [returning, setReturning] = useState(false)
  const [showReversal, setShowReversal] = useState(false)
  const [reversalReason, setReversalReason] = useState('')
  const [reversalPassword, setReversalPassword] = useState('')
  const [reversing, setReversing] = useState(false)
  const [editingDelivery, setEditingDelivery] = useState(false)
  const [deliveryEdit, setDeliveryEdit] = useState({ delivered_to_name: '', delivered_to_cpf: '', delivery_person_name: '', notes: '', admin_password: '' })
  const [savingDelivery, setSavingDelivery] = useState(false)
  const [showEditPanel, setShowEditPanel] = useState(false)
  const [editForm, setEditForm] = useState({ notes: '', carrier_name: '', tracking_code: '', cep: '', street: '', number: '', complement: '' })
  const [editPhotos, setEditPhotos] = useState<{ url: string; label?: string }[]>([])
  const [savingEdit, setSavingEdit] = useState(false)
  const [cepLoading, setCepLoading] = useState(false)
  const role = useAuthStore((s) => s.role)
  const isConferenteOrAbove = role === 'conferente' || role === 'admin' || role === 'superadmin'

  const openEditPanel = () => {
    const initialCep = pkg.resident_cep ?? ''
    const initialStreet = pkg.resident_address_street ?? ''
    setEditForm({
      notes: pkg.notes ?? '',
      carrier_name: pkg.carrier_name ?? '',
      tracking_code: pkg.tracking_code ?? '',
      cep: initialCep,
      street: initialStreet,
      number: pkg.resident_address_number ?? '',
      complement: pkg.resident_address_complement ?? '',
    })
    setEditPhotos((pkg.photo_urls ?? []).filter((p: any) => !p.url?.startsWith('blob:')))
    setShowEditPanel(true)
    if (initialCep.replace(/\D/g, '').length === 8 && !initialStreet) {
      handleCepChange(initialCep)
    }
  }

  const handleSaveEdit = async () => {
    setSavingEdit(true)
    try {
      const payload: Record<string, unknown> = {}
      if (editForm.notes !== (pkg.notes ?? '')) payload.notes = editForm.notes || null
      if (editForm.carrier_name !== (pkg.carrier_name ?? '')) payload.carrier_name = editForm.carrier_name || null
      if (editForm.tracking_code !== (pkg.tracking_code ?? '')) payload.tracking_code = editForm.tracking_code || null
      if (editForm.cep !== (pkg.resident_cep ?? '')) payload.resident_address_cep = editForm.cep || null
      if (editForm.street !== (pkg.resident_address_street ?? '')) payload.resident_address_street = editForm.street || null
      if (editForm.number !== (pkg.resident_address_number ?? '')) payload.resident_address_number = editForm.number || null
      if (editForm.complement !== (pkg.resident_address_complement ?? '')) payload.resident_address_complement = editForm.complement || null
      const currentUrls = JSON.stringify((pkg.photo_urls ?? []).filter((p: any) => !p.url?.startsWith('blob:')))
      if (JSON.stringify(editPhotos) !== currentUrls) payload.photo_urls = editPhotos
      if (Object.keys(payload).length === 0) { setShowEditPanel(false); return }
      await api.patch(`/packages/${pkg.id}/info`, payload)
      const refreshed = await api.get<Package>(`/packages/${pkg.id}`)
      setPkg(refreshed.data)
      toast.success('Encomenda atualizada.')
      setShowEditPanel(false)
      onRefresh?.()
    } catch { toast.error('Erro ao salvar.') } finally { setSavingEdit(false) }
  }

  const handleCepChange = async (cep: string) => {
    setEditForm(f => ({ ...f, cep }))
    const digits = cep.replace(/\D/g, '')
    if (digits.length !== 8) return
    setCepLoading(true)
    try {
      const res = await fetch(`https://viacep.com.br/ws/${digits}/json/`)
      const data = await res.json()
      if (!data.erro) {
        setEditForm(f => ({ ...f, street: data.logradouro || f.street }))
      }
    } catch { /* silent */ } finally { setCepLoading(false) }
  }

  const handleNotify = async () => {
    setNotifying(true)
    try {
      await api.post(`/packages/${pkg.id}/notify`, {})
      toast.success('Morador notificado!')
      onRefresh?.()
      onClose()
    } catch { toast.error('Erro ao notificar.') } finally { setNotifying(false) }
  }

  const handleReturn = async () => {
    if (!returnReason.trim()) { toast.error('Informe o motivo.'); return }
    setReturning(true)
    try {
      await api.post(`/packages/${pkg.id}/return`, { reason: returnReason.trim() })
      toast.success('Encomenda marcada como devolvida.')
      onRefresh?.()
      onClose()
    } catch { toast.error('Erro ao registrar devolução.') } finally { setReturning(false) }
  }

  const handleSaveDeliveryEdit = async () => {
    if (!deliveryEdit.admin_password.trim()) { toast.error('Senha de admin obrigatória.'); return }
    setSavingDelivery(true)
    try {
      await api.patch(`/packages/${pkg.id}/delivery-info`, deliveryEdit)
      toast.success('Informações de entrega atualizadas.')
      setEditingDelivery(false)
      onRefresh?.()
    } catch (e: any) {
      toast.error(apiErr(e, 'Erro ao salvar.'))
    } finally { setSavingDelivery(false) }
  }

  const handleReversal = async () => {
    if (!reversalReason.trim()) { toast.error('Informe o motivo.'); return }
    if (!reversalPassword.trim()) { toast.error('Senha de admin obrigatória.'); return }
    setReversing(true)
    try {
      await api.post(`/packages/${pkg.id}/reverse-delivery`, {
        reason: reversalReason.trim(), admin_password: reversalPassword,
      })
      toast.success('Entrega estornada. Encomenda voltou para Notificado.')
      onRefresh?.(); onClose()
    } catch (e: any) {
      toast.error(apiErr(e, 'Erro ao estornar.'))
    } finally { setReversing(false) }
  }

  useEffect(() => {
    const fetchEvents = async () => {
      try {
        const res = await api.get<PackageEvent[]>(`/packages/${pkg.id}/events`)
        setEvents(res.data)
      } catch { /* silent */ }
    }
    fetchEvents()
  }, [pkg.id])

  const handleAddEvent = async () => {
    if (!newComment.trim()) return
    setAddingEvent(true)
    try {
      await api.post(`/packages/${pkg.id}/events`, { comment: newComment.trim() })
      setNewComment('')
      const res = await api.get<PackageEvent[]>(`/packages/${pkg.id}/events`)
      setEvents(res.data)
    } catch { toast.error('Erro ao adicionar observação.') } finally { setAddingEvent(false) }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 overflow-y-auto">
      <div className="flex min-h-full items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl max-h-[calc(100dvh-2rem)] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h3 className="font-semibold text-gray-900">Detalhes da Encomenda</h3>
          <div className="flex items-center gap-2">
            {!showEditPanel && pkg.status !== 'delivered' && (
              <button onClick={openEditPanel} className="text-xs text-[#26619c] border border-[#26619c] px-2.5 py-1 rounded-lg hover:bg-blue-50 transition flex items-center gap-1">
                <Pencil className="w-3 h-3" /> Editar
              </button>
            )}
            <button onClick={onClose} className="p-2 -mr-2"><X className="w-5 h-5 text-gray-400" /></button>
          </div>
        </div>

        <div className="px-5 py-4 flex flex-col gap-3">
          {/* Edit panel */}
          {showEditPanel && (
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 flex flex-col gap-3">
              <p className="text-xs font-semibold text-[#26619c] uppercase tracking-wide">Editar Encomenda</p>
              {[
                { label: 'Transportadora', key: 'carrier_name' },
                { label: 'Código de rastreio', key: 'tracking_code' },
                { label: 'Observações', key: 'notes' },
              ].map(({ label, key }) => (
                <div key={key}>
                  <label className="text-xs text-gray-600 mb-0.5 block">{label}</label>
                  <input value={editForm[key as keyof typeof editForm]}
                    onChange={e => setEditForm(f => ({ ...f, [key]: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#26619c]/30 bg-white"
                    placeholder={label} />
                </div>
              ))}
              <p className="text-xs font-medium text-gray-600 mt-1">Endereço do destinatário</p>
              <div className="flex flex-col gap-2">
                <div>
                  <label className="text-xs text-gray-500 mb-0.5 block">CEP</label>
                  <div className="relative">
                    <input value={editForm.cep} onChange={e => handleCepChange(e.target.value)}
                      className="w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#26619c]/30 bg-white" placeholder="00000-000" maxLength={9} inputMode="numeric" />
                    {cepLoading && <span className="absolute right-2.5 top-1.5 text-xs text-gray-400">buscando…</span>}
                  </div>
                </div>
                {editForm.cep.replace(/\D/g, '').length === 8 && (
                  <div>
                    <label className="text-xs text-gray-500 mb-0.5 block">Rua</label>
                    <input value={editForm.street}
                      onChange={e => setEditForm(f => ({ ...f, street: e.target.value }))}
                      className="w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#26619c]/30 bg-white"
                      placeholder={cepLoading ? 'Buscando…' : 'Rua (preencha se não auto-preencheu)'} />
                  </div>
                )}
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-xs text-gray-500 mb-0.5 block">Nº</label>
                    <input value={editForm.number} onChange={e => setEditForm(f => ({ ...f, number: e.target.value }))}
                      className="w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#26619c]/30 bg-white" placeholder="123" />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 mb-0.5 block">Complemento</label>
                    <input value={editForm.complement} onChange={e => setEditForm(f => ({ ...f, complement: e.target.value }))}
                      className="w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#26619c]/30 bg-white" placeholder="Apto, bloco..." />
                  </div>
                </div>
              </div>
              <p className="text-xs font-medium text-gray-600 mt-1">Fotos</p>
              {editPhotos.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {editPhotos.map((p, i) => (
                    <div key={i} className="relative">
                      <img src={p.url} className="w-16 h-16 object-cover rounded-lg border border-gray-200" />
                      <button onClick={() => setEditPhotos(ps => ps.filter((_, j) => j !== i))}
                        className="absolute -top-1 -right-1 bg-red-500 text-white rounded-full w-4 h-4 flex items-center justify-center text-xs">×</button>
                    </div>
                  ))}
                </div>
              )}
              <PhotoCapture
                onCapture={entry => setEditPhotos(ps => [...ps, { url: entry.url, label: entry.label }])}
                label="Adicionar foto"
              />
              <div className="flex gap-2 mt-1">
                <button onClick={() => setShowEditPanel(false)} className="flex-1 border border-gray-300 text-gray-600 py-2 rounded-xl text-sm hover:bg-gray-50">Cancelar</button>
                <button disabled={savingEdit} onClick={handleSaveEdit}
                  className="flex-1 bg-[#26619c] text-white py-2 rounded-xl text-sm font-semibold hover:bg-[#1e4d7d] disabled:opacity-50">
                  {savingEdit ? 'Salvando…' : 'Salvar'}
                </button>
              </div>
            </div>
          )}

          {/* Status */}
          <span className={`inline-flex self-start text-xs font-medium px-2 py-0.5 rounded-full ${STATUS_COLORS[pkg.status]}`}>
            {STATUS_LABELS[pkg.status]}
          </span>

          {/* Fields */}
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="col-span-2">
              <p className="text-xs text-gray-500">Destinatário</p>
              <p className="font-medium text-gray-800">{pkg.resident_name ?? '—'}</p>
              {pkg.resident_cpf && <p className="text-xs text-gray-400">CPF: {maskCpf(pkg.resident_cpf)}</p>}
              {pkg.resident_phone && <p className="text-xs text-gray-400">Tel: {pkg.resident_phone}</p>}
              {(pkg.resident_address_street || pkg.resident_cep) && (
                <p className="text-xs text-gray-400">
                  {pkg.resident_address_street
                    ? `${pkg.resident_address_street}${pkg.resident_address_number ? `, ${pkg.resident_address_number}` : ''}${pkg.resident_address_complement ? ` ${pkg.resident_address_complement}` : ''}${pkg.resident_address_district ? ` — ${pkg.resident_address_district}` : ''}${pkg.resident_address_city ? `, ${pkg.resident_address_city}` : ''}${pkg.resident_cep ? ` — CEP ${pkg.resident_cep}` : ''}`
                    : `CEP: ${pkg.resident_cep}`}
                </p>
              )}
              {dependents.length > 0 && (
                <div className="mt-1">
                  <p className="text-xs text-gray-400 font-medium">Dependentes:</p>
                  {dependents.map((d: { id: string; full_name: string; phone_primary?: string }) => (
                    <p key={d.id} className="text-xs text-gray-400">{d.full_name}{d.phone_primary ? ` · ${d.phone_primary}` : ''}</p>
                  ))}
                </div>
              )}
            </div>
            {pkg.object_type && (
              <div>
                <p className="text-xs text-gray-500">Tipo de objeto</p>
                <p className="font-medium text-gray-800">{pkg.object_type}</p>
              </div>
            )}
            {pkg.sender_name && (
              <div>
                <p className="text-xs text-gray-500">Remetente</p>
                <p className="font-medium text-gray-800">{pkg.sender_name}</p>
              </div>
            )}
            {pkg.carrier_name && (
              <div>
                <p className="text-xs text-gray-500">Transportadora</p>
                <p className="font-medium text-gray-800">{pkg.carrier_name}</p>
              </div>
            )}
            {pkg.tracking_code && (
              <div>
                <p className="text-xs text-gray-500">Rastreio</p>
                <p className="font-medium text-gray-800">{pkg.tracking_code}</p>
              </div>
            )}
            <div>
              <p className="text-xs text-gray-500">Recebido em</p>
              <p className="font-medium text-gray-800">
                {new Date(pkg.received_at).toLocaleString('pt-BR', {
                  day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit',
                })}
              </p>
            </div>
            {pkg.has_delivery_fee && (
              <div>
                <p className="text-xs text-gray-500">Taxa de entrega</p>
                <p className="font-medium text-amber-600">R$ {parseFloat(pkg.delivery_fee_amount ?? '2.50').toFixed(2)}</p>
              </div>
            )}
          </div>

          {/* Notes */}
          {pkg.notes && (
            <div className="bg-gray-50 rounded-lg px-3 py-2">
              <p className="text-xs text-gray-500 mb-0.5">Observações</p>
              <p className="text-sm text-gray-700">{pkg.notes}</p>
            </div>
          )}

          {/* Package photos */}
          {pkg.photo_urls && pkg.photo_urls.length > 0 && (
            <div>
              <p className="text-xs text-gray-500 mb-1.5">Fotos</p>
              <div className="flex gap-2 flex-wrap">
                {pkg.photo_urls.filter(p => !p.url.startsWith('blob:')).map((photo, i) => (
                  <a key={i} href={photo.url} target="_blank" rel="noopener noreferrer">
                    <img
                      src={photo.url}
                      alt={photo.label || `Foto ${i + 1}`}
                      className="w-16 h-16 object-cover rounded-lg border border-gray-200"
                      onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
                    />
                  </a>
                ))}
              </div>
            </div>
          )}

          {/* Delivery info */}
          {pkg.status === 'delivered' && (
            <div className="bg-green-50 border border-green-200 rounded-lg px-3 py-2.5">
              <div className="flex items-center justify-between mb-1.5">
                <p className="text-xs font-semibold text-green-700">Informações de Entrega</p>
                {isConferenteOrAbove && !editingDelivery && (
                  <button onClick={() => { setDeliveryEdit({ delivered_to_name: pkg.delivered_to_name ?? '', delivered_to_cpf: pkg.delivered_to_cpf ?? '', delivery_person_name: pkg.deliverer_name ?? '', notes: pkg.notes ?? '', admin_password: '' }); setEditingDelivery(true) }}
                    className="text-xs text-[#26619c] border border-[#26619c] px-2 py-0.5 rounded-lg hover:bg-blue-50">
                    Editar
                  </button>
                )}
              </div>
              {editingDelivery ? (
                <div className="flex flex-col gap-2">
                  {[['Recebido por', 'delivered_to_name'], ['CPF', 'delivered_to_cpf'], ['Entregador', 'delivery_person_name'], ['Observações', 'notes']].map(([label, key]) => (
                    <div key={key}>
                      <label className="text-xs text-gray-500">{label}</label>
                      <input type="text" value={deliveryEdit[key as keyof typeof deliveryEdit]}
                        onChange={e => setDeliveryEdit(p => ({ ...p, [key]: e.target.value }))}
                        className="w-full border border-green-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-300 bg-white" />
                    </div>
                  ))}
                  <div>
                    <label className="text-xs text-gray-500">Senha de admin *</label>
                    <input type="password" value={deliveryEdit.admin_password}
                      onChange={e => setDeliveryEdit(p => ({ ...p, admin_password: e.target.value }))}
                      className="w-full border border-red-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-300 bg-white" />
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => setEditingDelivery(false)} className="flex-1 border border-gray-300 text-gray-600 py-3 rounded-xl text-sm">Cancelar</button>
                    <button onClick={handleSaveDeliveryEdit} disabled={savingDelivery} className="flex-1 bg-[#26619c] text-white py-3 rounded-xl text-sm font-semibold disabled:opacity-50">{savingDelivery ? 'Salvando…' : 'Salvar'}</button>
                  </div>
                </div>
              ) : (<>
              <div className="grid grid-cols-2 gap-2 text-sm mb-2">
                {pkg.received_by_name && (
                  <div>
                    <p className="text-xs text-gray-500">Recebido por</p>
                    <p className="font-medium text-gray-800">{pkg.received_by_name}</p>
                    {pkg.deliverer_name && <p className="text-xs text-gray-400">{pkg.deliverer_name}</p>}
                  </div>
                )}
                {pkg.delivered_at && (
                  <div>
                    <p className="text-xs text-gray-500">Entregue em</p>
                    <p className="font-medium text-gray-800">
                      {new Date(pkg.delivered_at).toLocaleString('pt-BR', {
                        day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit',
                      })}
                    </p>
                  </div>
                )}
                {pkg.delivered_by_name && (
                  <div>
                    <p className="text-xs text-gray-500">Entregue por</p>
                    <p className="font-medium text-gray-800">{pkg.delivered_by_name}</p>
                  </div>
                )}
                {pkg.delivered_to_name && (
                  <div>
                    <p className="text-xs text-gray-500">Entregue para</p>
                    <p className="font-medium text-gray-800">{pkg.delivered_to_name}</p>
                    {pkg.delivered_to_cpf && <p className="text-xs text-gray-400">CPF: {maskCpf(pkg.delivered_to_cpf)}</p>}
                  </div>
                )}
              </div>

              {/* Signatures */}
              <div className="flex gap-3 mt-1">
                <div className="flex-1">
                  <p className="text-xs text-gray-500 mb-1 flex items-center gap-1">
                    Assinatura do morador
                    {pkg.signature_url
                      ? <span className="text-green-600 font-medium">✓ Assinado</span>
                      : <span className="text-gray-400">Não assinado</span>}
                  </p>
                  {pkg.signature_url && (
                    <img
                      src={pkg.signature_url}
                      alt="Assinatura do morador"
                      className="w-full h-16 object-contain bg-white border border-green-200 rounded"
                    />
                  )}
                </div>
                {pkg.deliverer_signature_url && (
                  <div className="flex-1">
                    <p className="text-xs text-gray-500 mb-1 flex items-center gap-1">
                      Assinatura do entregador
                      <span className="text-green-600 font-medium">✓ Assinado</span>
                    </p>
                    <img
                      src={pkg.deliverer_signature_url}
                      alt="Assinatura do entregador"
                      className="w-full h-16 object-contain bg-white border border-green-200 rounded"
                    />
                  </div>
                )}
              </div>
              </>)}
            </div>
          )}

          {pkg.status === 'delivered' && !showReversal && (
            <button onClick={() => setShowReversal(true)}
              className="w-full border border-red-300 text-red-600 py-2.5 rounded-xl text-sm font-medium hover:bg-red-50 transition">
              Estornar Entrega
            </button>
          )}

          {pkg.status === 'delivered' && showReversal && (
            <div className="border border-red-200 rounded-xl p-4 flex flex-col gap-3 bg-red-50">
              <p className="text-sm font-semibold text-red-700">Estorno de Entrega</p>
              <p className="text-xs text-red-600">A encomenda voltará para <strong>Notificado</strong> e a taxa será estornada se houver.</p>
              <textarea value={reversalReason} onChange={e => setReversalReason(e.target.value)}
                placeholder="Motivo do estorno *" rows={2}
                className="w-full border border-red-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-300 resize-none" />
              <input type="password" value={reversalPassword} onChange={e => setReversalPassword(e.target.value)}
                placeholder="Senha de administrador *"
                className="w-full border border-red-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-300" />
              <div className="flex gap-2">
                <button onClick={() => { setShowReversal(false); setReversalReason(''); setReversalPassword('') }}
                  className="flex-1 border border-gray-300 text-gray-600 py-3 rounded-lg text-sm">Cancelar</button>
                <button onClick={handleReversal} disabled={reversing}
                  className="flex-1 bg-red-600 hover:bg-red-700 text-white py-3 rounded-lg text-sm font-semibold disabled:opacity-50">
                  {reversing ? 'Estornando…' : 'Confirmar Estorno'}
                </button>
              </div>
            </div>
          )}

          {pkg.status === 'received' && (
            <button onClick={handleNotify} disabled={notifying}
              className="w-full bg-amber-500 hover:bg-amber-600 text-white py-2.5 rounded-xl text-sm font-medium transition disabled:opacity-50">
              {notifying ? 'Notificando…' : 'Marcar como Notificado'}
            </button>
          )}

          {(pkg.status === 'received' || pkg.status === 'notified' || pkg.status === 'reversed') && (
            <button
              onClick={() => { onDeliverClick() }}
              className="w-full bg-[#26619c] hover:bg-[#1a4f87] text-white py-2.5 rounded-xl text-sm font-medium transition"
            >
              Entregar Encomenda
            </button>
          )}

          {(pkg.status === 'received' || pkg.status === 'notified' || pkg.status === 'reversed') && !showReturnForm && (
            <button onClick={() => setShowReturnForm(true)}
              className="w-full border border-red-300 text-red-600 py-2.5 rounded-xl text-sm font-medium hover:bg-red-50 transition">
              Devolver Encomenda
            </button>
          )}

          {showReturnForm && (
            <div className="border border-red-200 rounded-xl p-4 flex flex-col gap-3 bg-red-50">
              <p className="text-sm font-medium text-red-700">Motivo da Devolução</p>
              <input
                value={returnReason}
                onChange={e => setReturnReason(e.target.value)}
                placeholder="Ex: Destinatário não encontrado, recusou receber…"
                className="w-full border border-red-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-300"
              />
              <div className="flex gap-2">
                <button onClick={() => setShowReturnForm(false)}
                  className="flex-1 border border-gray-300 text-gray-600 py-3 rounded-lg text-sm">
                  Cancelar
                </button>
                <button onClick={handleReturn} disabled={returning}
                  className="flex-1 bg-red-600 hover:bg-red-700 text-white py-3 rounded-lg text-sm font-medium disabled:opacity-50">
                  {returning ? 'Salvando…' : 'Confirmar Devolução'}
                </button>
              </div>
            </div>
          )}

          {/* Signature status badges for non-delivered */}
          {pkg.status !== 'delivered' && (
            <div className="flex gap-2">
              <span className={`text-xs px-2 py-1 rounded-full font-medium ${pkg.deliverer_signature_url ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                {pkg.deliverer_signature_url ? '✓ Entregador assinado' : 'Entregador não assinado'}
              </span>
            </div>
          )}

          {pkg.resident_phone && (pkg.status === 'received' || pkg.status === 'notified') && (
            <a
              href={`https://wa.me/55${pkg.resident_phone.replace(/\D/g, '')}?text=${encodeURIComponent(`Olá ${pkg.resident_name ?? 'morador'}! Sua encomenda chegou na portaria. Por favor, venha retirar o mais breve possível. 📦`)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full flex items-center justify-center gap-2 bg-green-500 hover:bg-green-600 text-white py-2.5 rounded-xl text-sm font-medium transition"
            >
              <MessageCircle className="w-4 h-4" />
              Avisar via WhatsApp
            </a>
          )}

          {/* Timeline */}
          {(() => {
            type TLItem = { key: string; at: string; label: string; sub?: string; color: string }
            const items: TLItem[] = []
            items.push({ key: 'received', at: pkg.received_at, label: 'Recebido', sub: pkg.received_by_name ?? undefined, color: 'bg-blue-500' })
            for (const ev of events) {
              if (ev.event_type === 'notification') items.push({ key: ev.id, at: ev.created_at, label: 'Notificado', sub: ev.author_name, color: 'bg-yellow-400' })
              else if (ev.event_type === 'return') items.push({ key: ev.id, at: ev.created_at, label: 'Devolvido', sub: ev.comment ?? undefined, color: 'bg-red-400' })
              else if (ev.event_type === 'reversal') items.push({ key: ev.id, at: ev.created_at, label: 'Entrega estornada', sub: ev.comment ?? undefined, color: 'bg-orange-400' })
              else if (ev.event_type === 'comment') items.push({ key: ev.id, at: ev.created_at, label: ev.comment ?? '', sub: ev.author_name, color: 'bg-gray-400' })
            }
            if (pkg.delivered_at && !events.some(e => e.event_type === 'reversal')) {
              items.push({ key: 'delivered', at: pkg.delivered_at, label: 'Entregue para', sub: pkg.delivered_to_name ?? undefined, color: 'bg-green-500' })
            }
            items.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())
            return (
              <div className="border-t border-gray-100 pt-3 mt-1">
                <p className="text-xs font-semibold text-gray-700 uppercase tracking-wide mb-3">Histórico</p>
                <ol className="relative border-l border-gray-200 ml-2 flex flex-col gap-3 mb-3">
                  {items.map(item => (
                    <li key={item.key} className="ml-4">
                      <span className={`absolute -left-1.5 w-3 h-3 rounded-full border-2 border-white ${item.color}`} />
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-sm font-medium text-gray-800">{item.label}</span>
                        <span className="text-xs text-gray-400 shrink-0">
                          {new Date(item.at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                      {item.sub && <p className="text-xs text-gray-500 mt-0.5">{item.sub}</p>}
                    </li>
                  ))}
                </ol>
              </div>
            )
          })()}

          {/* Events / Observações */}
          <div className="border-t border-gray-100 pt-3 mt-1">
            <p className="text-xs font-semibold text-gray-700 uppercase tracking-wide mb-3">Observações</p>
            {events.filter(e => e.event_type === 'comment').length === 0 ? (
              <p className="text-xs text-gray-400 mb-3">Nenhuma observação registrada.</p>
            ) : (
              <ul className="flex flex-col gap-2 mb-3">
                {events.filter(e => e.event_type === 'comment').map(ev => (
                  <li key={ev.id} className="bg-gray-50 rounded-lg px-3 py-2">
                    <div className="flex items-center justify-between mb-0.5">
                      <span className="text-xs font-medium text-gray-700">{ev.author_name ?? 'Sistema'}</span>
                      <span className="text-xs text-gray-400">
                        {new Date(ev.created_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    <p className="text-sm text-gray-700">{ev.comment}</p>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex gap-2">
              <input
                value={newComment}
                onChange={e => setNewComment(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleAddEvent() }}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#26619c]/40 focus:border-[#26619c]"
                placeholder="Adicionar observação…"
              />
              <button
                onClick={handleAddEvent}
                disabled={addingEvent || !newComment.trim()}
                className="px-3 py-2 bg-[#26619c] hover:bg-[#1a4f87] text-white rounded-lg text-sm font-medium transition disabled:opacity-50 shrink-0"
              >
                OK
              </button>
            </div>
          </div>
        </div>
      </div>
      </div>
    </div>
  )
}
