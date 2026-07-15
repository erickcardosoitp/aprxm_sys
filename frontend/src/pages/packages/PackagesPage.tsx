import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import DebouncedInput, { type DebouncedInputHandle } from '../../components/ui/DebouncedInput'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  AlertTriangle, Barcode, Camera, FileText, MapPin, MessageCircle, Package as PackageIcon, Plus,
  Search, Shield, User, UserX, List, Columns, Workflow, X, ChevronDown, Layers, Truck, Pencil, Trash2,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { SignaturePad } from '../../components/packages/SignaturePad'
import { PhotoCapture } from '../../components/packages/PhotoCapture'
import { BarcodeScannerModal } from '../../components/packages/BarcodeScanner'
import { packageService } from '../../services/packages'
import type { ReceiveHistoryEntry } from '../../services/packages'
import { financeService } from '../../services/finance'
import { maskCpf } from '../../utils'
import { uploadService } from '../../services/upload'
import { useQueryClient } from '@tanstack/react-query'
import api from '../../services/api'
import { useAssociationProfile, useDelinquentResidents, usePaymentMethods } from '../../hooks/useSharedData'
import { useAuthStore } from '../../store/authStore'
import type { Package, Resident } from '../../types'

// ─── Constants ────────────────────────────────────────────────────────────────

const STATUS_LABELS: Record<string, string> = {
  received: 'Aguardando', notified: 'Notificado', delivered: 'Entregue',
  returned: 'Devolvido', reversed: 'Estornado',
}
const STATUS_COLORS: Record<string, string> = {
  received: 'badge-brand', notified: 'bg-yellow-100 text-yellow-700',
  delivered: 'bg-green-100 text-green-700', returned: 'bg-gray-100 text-gray-600',
  reversed: 'bg-red-100 text-red-700',
}

const KANBAN_STATUSES = ['received', 'notified', 'delivered', 'returned', 'reversed'] as const

type ReceiveStep = 'recipient' | 'details'

interface GuestForm {
  full_name: string; phone_primary: string; address_cep: string
  address_street: string; address_number: string; address_complement: string
  address_district: string; address_city: string; address_state: string
}

interface PackageEvent {
  id: string; comment: string; created_at: string; author_name?: string; event_type?: string
}

const emptyGuest = (): GuestForm => ({
  full_name: '', phone_primary: '', address_cep: '', address_street: '',
  address_number: '', address_complement: '', address_district: '', address_city: '', address_state: '',
})

const inputCls = 'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#26619c]/40 focus:border-[#26619c]'

const apiErr = (e: any, fallback: string) => {
  const d = e?.response?.data?.detail
  if (!d) return fallback
  if (typeof d === 'string') return d
  if (Array.isArray(d)) return d[0]?.msg ?? fallback
  return fallback
}

// ─── Package Detail Modal ─────────────────────────────────────────────────────

interface PackageDetailModalProps {
  pkg: Package
  onClose: () => void
  onDeliverClick: () => void
  onRefresh?: () => void
  dependents?: { id: string; full_name: string; phone_primary?: string }[]
}

function PackageDetailModal({ pkg: initialPkg, onClose, onDeliverClick, onRefresh, dependents = [] }: PackageDetailModalProps) {
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
                className={inputCls}
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

// ─── Esteira Stepper ──────────────────────────────────────────────────────────

const WORKFLOW_STEPS = ['Recebido', 'Notificado', 'Entregue']

function EsteiraStepper({ status }: { status: string }) {
  const stepIndex = status === 'received' ? 0 : status === 'notified' ? 1 : status === 'delivered' || status === 'returned' ? 2 : 0
  const isReturned = status === 'returned'
  return (
    <div className="flex items-center gap-0 flex-1">
      {WORKFLOW_STEPS.map((step, i) => {
        const active = i <= stepIndex
        const current = i === stepIndex
        const isLast = i === WORKFLOW_STEPS.length - 1
        const label = isLast && isReturned ? 'Devolvido' : step
        return (
          <div key={step} className="flex items-center flex-1">
            <div className="flex flex-col items-center gap-1 shrink-0">
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold border-2 transition ${
                active
                  ? isReturned && isLast ? 'bg-gray-400 border-gray-400 text-white' : current ? 'bg-[#26619c] border-[#26619c] text-white' : 'bg-green-500 border-green-500 text-white'
                  : 'border-gray-300 text-gray-400 bg-white'
              }`}>
                {active && !current ? '✓' : i + 1}
              </div>
              <span className={`text-[10px] font-medium whitespace-nowrap ${active ? 'text-gray-700' : 'text-gray-400'}`}>{label}</span>
            </div>
            {!isLast && (
              <div className={`flex-1 h-0.5 mx-1 ${i < stepIndex ? 'bg-green-400' : 'bg-gray-200'}`} />
            )}
          </div>
        )
      })}
    </div>
  )
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

interface PackagesPageProps {
  /** Receber — não carrega lista, abre seletor unitário/múltiplo */
  modalMode?: boolean
  /** Retirada — picker de pendentes para entrega */
  retiradaMode?: boolean
  /** Devolução — picker para devolver */
  devolucaoMode?: boolean
  /** Consultar — picker de todas as encomendas (todos os status) */
  consultarMode?: boolean
  /** Minhas — receive-history + entregues pelo usuário atual */
  minhasMode?: boolean
  /** Chamado quando todos os modais do modo ativo fecham */
  onModalClosed?: () => void
}

export default function PackagesPage({ modalMode = false, retiradaMode = false, devolucaoMode = false, consultarMode = false, minhasMode = false, onModalClosed }: PackagesPageProps) {
  const { fullName, role, associationId, associationName } = useAuthStore()
  const queryClient = useQueryClient()
  const isAdmin = role === 'admin' || role === 'superadmin'
  const isConferenteOrAbove = role === 'conferente' || role === 'admin' || role === 'superadmin'
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [upgradedResidentInfo, setUpgradedResidentInfo] = useState<{ id: string; name: string } | null>(null)
  const [pageTab, setPageTab] = useState<'encomendas' | 'recebimentos' | 'cadastros'>('encomendas')
  const PKG_PAGE_SIZE = 50
  const [packages, setPackages] = useState<Package[]>([])
  const [pkgOffset, setPkgOffset] = useState(0)
  const [hasMorePkgs, setHasMorePkgs] = useState(false)
  const [showReceive, setShowReceive] = useState(false)
  const [deliveryTarget, setDeliveryTarget] = useState<Package | null>(null)
  const [deliveryCheck, setDeliveryCheck] = useState<{ is_delinquent: boolean; overdue_count: number; fee_will_apply: boolean; is_member: boolean } | null>(null)
  // Pickers do Simplifica
  const [showRetiradaPicker, setShowRetiradaPicker] = useState(false)
  const [showDevolucaoPicker, setShowDevolucaoPicker] = useState(false)
  const [showConsultarPicker, setShowConsultarPicker] = useState(false)
  const [showMinhasPicker, setShowMinhasPicker] = useState(false)
  const [pickerSearch, setPickerSearch] = useState('')
  const [pickerPackages, setPickerPackages] = useState<Package[]>([])
  const [pickerLoading, setPickerLoading] = useState(false)
  const [minhasHistory, setMinhasHistory] = useState<ReceiveHistoryEntry[]>([])
  const [minhasDelivered, setMinhasDelivered] = useState<Package[]>([])
  const [minhasTab, setMinhasTab] = useState<'recebidas' | 'entregues'>('recebidas')
  const { data: delinquentList = [] } = useDelinquentResidents<{ resident_id?: string; id?: string }[]>()
  const delinquentIds = useMemo(
    () => new Set(delinquentList.map(d => d.resident_id ?? d.id ?? '')),
    [delinquentList],
  )
  const [loading, setLoading] = useState(false)
  const [packagesLoading, setPackagesLoading] = useState(true)
  const [filterStatus, setFilterStatus] = useState('received')
  const [showDeliveredSearch, setShowDeliveredSearch] = useState(false)
  const deliveredInputRef = useRef<DebouncedInputHandle>(null)
  const [deliveredQ, setDeliveredQ] = useState('')
  const [deliveredPackages, setDeliveredPackages] = useState<Package[]>([])
  const [deliveredLoading, setDeliveredLoading] = useState(false)
  const [filterOp, setFilterOp] = useState<string | null>(null)
  const [filterOpSet, setFilterOpSet] = useState<Set<string>>(new Set())
  const [showOpDropdown, setShowOpDropdown] = useState(false)
  const [showFilters, setShowFilters] = useState(false)
  const [viewMode, setViewMode] = useState<'list' | 'kanban' | 'esteira'>('list')
  const [detailPkg, setDetailPkg] = useState<Package | null>(null)
  const [detailDependents, setDetailDependents] = useState<{ id: string; full_name: string; phone_primary?: string }[]>([])
  const [statusCounts, setStatusCounts] = useState<Record<string, number>>({})
  const [photoPreviewUrls, setPhotoPreviewUrls] = useState<{ url: string; label?: string }[] | null>(null)
  const [waDropdownPkgId, setWaDropdownPkgId] = useState<string | null>(null)
  const { data: assocProfile } = useAssociationProfile()

  useEffect(() => {
    if (!waDropdownPkgId) return
    const close = () => setWaDropdownPkgId(null)
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [waDropdownPkgId])

  // Auto-abre modal via prop de modo (Simplifica) ou ?action= (URL)
  useEffect(() => {
    if (modalMode)     { setShowReceiveMode(true); return }
    if (retiradaMode)  { setShowRetiradaPicker(true); return }
    if (devolucaoMode) { setShowDevolucaoPicker(true); return }
    if (consultarMode) { setShowConsultarPicker(true); return }
    if (minhasMode)    {
      setShowMinhasPicker(true)
      packageService.receiveHistory({ limit: 50 }).then(r => setMinhasHistory(r.data)).catch(() => {})
      api.get<Package[]>('/packages', { params: { statuses: 'delivered', delivered_by_me: true } })
        .then(r => setMinhasDelivered(r.data.slice(0, 50))).catch(() => {})
      return
    }
    const action = searchParams.get('action')
    if (action === 'receive') { setShowReceiveMode(true); navigate('/packages', { replace: true }) }
    if (action === 'esteira') { setViewMode('esteira') }
  }, [])

  useEffect(() => {
    if (detailPkg?.resident_id) {
      api.get<{ id: string; full_name: string; phone_primary?: string }[]>(`/residents?responsible_id=${detailPkg.resident_id}`)
        .then(r => setDetailDependents(r.data))
        .catch(() => setDetailDependents([]))
    } else {
      setDetailDependents([])
    }
  }, [detailPkg?.resident_id])

  useEffect(() => {
    if (!deliveryTarget) { setDeliveryCheck(null); return }
    api.get<any>(`/packages/${deliveryTarget.id}/delivery-check`)
      .then(r => setDeliveryCheck(r.data))
      .catch(() => setDeliveryCheck(null))
  }, [deliveryTarget?.id])

  // Filters
  const [filterQ, setFilterQ] = useState('')
  const [filterDateFrom, setFilterDateFrom] = useState('')
  const [filterDateTo, setFilterDateTo] = useState('')
  const loadPackagesKeyRef = useRef(0)
  const residentSearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const filterInputRef = useRef<DebouncedInputHandle>(null)
  const recipientInputRef = useRef<DebouncedInputHandle>(null)
  const cardReassignTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const responsibleTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const reassignTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const brxSearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const SEARCH_DELAY = 300

  // Carriers & Deliverers
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

  useEffect(() => { if (pageTab === 'cadastros') loadCadastros() }, [pageTab])

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

  // Reassign resident for "received" packages
  const [cardReassignPkgId, setCardReassignPkgId] = useState<string | null>(null)
  const [cardReassignSearch, setCardReassignSearch] = useState('')
  const [cardReassignResults, setCardReassignResults] = useState<{ id: string; full_name: string; type: string; responsible_name?: string }[]>([])
  const [cardReassignRect, setCardReassignRect] = useState<{ top: number; left: number; width: number } | null>(null)
  const cardReassignInputRef = useRef<HTMLInputElement>(null)
  const searchCardReassign = async (q: string) => {
    setCardReassignSearch(q)
    if (q.length < 3) { setCardReassignResults([]); return }
    try { const r = await api.get<any[]>(`/residents/search?q=${encodeURIComponent(q)}`); setCardReassignResults(r.data.slice(0, 5)) } catch { setCardReassignResults([]) }
  }
  const doCardReassign = async (pkgId: string, residentId: string, residentName: string) => {
    try {
      await api.patch(`/packages/${pkgId}/reassign`, { resident_id: residentId })
      toast.success(`Reatribuído para ${residentName}`)
      setCardReassignPkgId(null); setCardReassignSearch(''); setCardReassignResults([])
      loadPackages()
    } catch (e: any) { toast.error(apiErr(e, 'Erro ao reatribuir.')) }
  }

  // Report state
  const [showReport, setShowReport] = useState(false)
  const [reportFrom, setReportFrom] = useState(new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10))
  const [reportTo, setReportTo] = useState(new Date().toISOString().slice(0, 10))
  const [reportData, setReportData] = useState<any>(null)
  const [loadingReport, setLoadingReport] = useState(false)

  const [showAddrReport, setShowAddrReport] = useState(false)
  const [addrReportData, setAddrReportData] = useState<any>(null)
  const [loadingAddrReport, setLoadingAddrReport] = useState(false)
  const [addrReportStreet, setAddrReportStreet] = useState<string | null>(null)

  const loadAddrReport = async () => {
    setLoadingAddrReport(true)
    try {
      const res = await api.get('/packages/by-address')
      setAddrReportData(res.data)
    } catch { toast.error('Erro ao carregar relatório por endereço') }
    finally { setLoadingAddrReport(false) }
  }

  const loadReport = async () => {
    setLoadingReport(true)
    try {
      const res = await api.get('/packages/report', { params: { date_from: reportFrom, date_to: reportTo } })
      setReportData(res.data)
    } catch { toast.error('Erro ao carregar relatório.') }
    finally { setLoadingReport(false) }
  }

  // Receive flow
  const [step, setStep] = useState<ReceiveStep>('recipient')
  const [recipientSearch, setRecipientSearch] = useState('')
  const [searchResults, setSearchResults] = useState<Resident[]>([])
  const [selectedRecipient, setSelectedRecipient] = useState<Resident | null>(null)
  const [showGuestForm, setShowGuestForm] = useState(false)
  const [searchEmpty, setSearchEmpty] = useState(false)
  const [guest, setGuest] = useState<GuestForm>(emptyGuest())
  const [cepLoading, setCepLoading] = useState(false)
  const [newResType, setNewResType] = useState<'guest' | 'member' | 'dependent'>('guest')
  const [newResCpf, setNewResCpf] = useState('')
  const [newResResponsibleSearch, setNewResResponsibleSearch] = useState('')
  const [newResResponsible, setNewResResponsible] = useState<Resident | null>(null)
  const [newResResponsibleResults, setNewResResponsibleResults] = useState<Resident[]>([])
  const [duplicateMatches, setDuplicateMatches] = useState<Resident[]>([])
  const duplicateTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // CEP gate — duplicate prevention second layer
  const [showCepGate, setShowCepGate] = useState(false)
  const [cepGateValue, setCepGateValue] = useState('')
  const [cepGateStreet, setCepGateStreet] = useState('')
  const [cepGateResidents, setCepGateResidents] = useState<Resident[]>([])
  const [cepGateLoading, setCepGateLoading] = useState(false)
  const [cepGateDone, setCepGateDone] = useState(false)
  const cepGateTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [tracking, setTracking] = useState('')
  const [carrier, setCarrier] = useState('')
  const [photos, setPhotos] = useState<{ url: string; label: string; taken_at: string }[]>([])
  const barcodeRef = useRef<HTMLInputElement>(null)
  const [showScanner, setShowScanner] = useState(false)

  // Missing-CEP prompt (single receive)
  const [missingCepCep, setMissingCepCep] = useState('')
  const [missingCepNumber, setMissingCepNumber] = useState('')
  const [missingCepStreet, setMissingCepStreet] = useState('')
  const [missingCepNeighborhood, setMissingCepNeighborhood] = useState('')
  const [missingCepCity, setMissingCepCity] = useState('')
  const [missingCepState, setMissingCepState] = useState('')
  const [missingCepLoading, setMissingCepLoading] = useState(false)
  const [missingCepSaving, setMissingCepSaving] = useState(false)

  const lookupMissingCep = async (cep: string) => {
    const digits = cep.replace(/\D/g, '')
    if (digits.length !== 8) return
    setMissingCepLoading(true)
    try {
      const r = await fetch(`https://viacep.com.br/ws/${digits}/json/`)
      const data = await r.json()
      if (!data.erro) {
        setMissingCepStreet(data.logradouro ?? '')
        setMissingCepNeighborhood(data.bairro ?? '')
        setMissingCepCity(data.localidade ?? '')
        setMissingCepState(data.uf ?? '')
      }
    } catch { /* silent */ } finally { setMissingCepLoading(false) }
  }

  const saveMissingCep = async () => {
    if (!selectedRecipient) return
    if (!missingCepCep.replace(/\D/g, '').trim()) { toast.error('CEP obrigatório.'); return }
    if (!missingCepNumber.trim()) { toast.error('Número obrigatório.'); return }
    setMissingCepSaving(true)
    try {
      await api.put(`/residents/${selectedRecipient.id}`, {
        address_cep: missingCepCep.replace(/\D/g, ''),
        address_number: missingCepNumber.trim(),
        address_street: missingCepStreet || undefined,
        address_neighborhood: missingCepNeighborhood || undefined,
        address_city: missingCepCity || undefined,
        address_state: missingCepState || undefined,
      })
      setSelectedRecipient({ ...selectedRecipient, address_cep: missingCepCep.replace(/\D/g, '') } as Resident)
      setMissingCepCep(''); setMissingCepNumber(''); setMissingCepStreet(''); setMissingCepNeighborhood(''); setMissingCepCity(''); setMissingCepState('')
      setStep('details')
    } catch (e: any) {
      toast.error(apiErr(e, 'Erro ao salvar endereço.'))
    } finally { setMissingCepSaving(false) }
  }

  // Delivery flow
  const [recipientName, setRecipientName] = useState('')
  const [recipientSig, setRecipientSig] = useState('')
  const [proofResidenceUrl, setProofResidenceUrl] = useState('')
  const [recipientIdPhoto, setRecipientIdPhoto] = useState('')
  const [deliveryPersonName, setDeliveryPersonName] = useState('')
  const [pickupType, setPickupType] = useState<'resident' | 'dependent' | 'other'>('resident')
  const [dependents, setDependents] = useState<{ id: string; full_name: string }[]>([])
  const [selectedDependent, setSelectedDependent] = useState<{ id: string; full_name: string } | null>(null)
  const [addingDependent, setAddingDependent] = useState(false)
  const [newDepName, setNewDepName] = useState('')
  const [newDepPhone, setNewDepPhone] = useState('')
  const [savingDep, setSavingDep] = useState(false)
  const [pickerIdPhoto, setPickerIdPhoto] = useState('')
  const [pickerPhone, setPickerPhone] = useState('')
  const [deliveryPaymentMethodId, setDeliveryPaymentMethodId] = useState('')
  const [deliveryPixPayerName, setDeliveryPixPayerName] = useState('')
  const { data: paymentMethods = [] } = usePaymentMethods()
  const [deliverySessionPicker, setDeliverySessionPicker] = useState<{ id: string; opened_by_name: string; opening_balance: string }[] | null>(null)
  type DeliverPayload = Parameters<typeof packageService.deliver>[1]
  const [pendingDeliveryPayload, setPendingDeliveryPayload] = useState<DeliverPayload | null>(null)
  const [exemptionToken, setExemptionToken] = useState('')
  const [exemptionTokenError, setExemptionTokenError] = useState('')

  // Pay mensalidade quick-modal (inside delivery flow)
  const [showPayMenModal, setShowPayMenModal] = useState(false)
  const [payMenId, setPayMenId] = useState<string | null>(null)
  const [payMenInfo, setPayMenInfo] = useState<{ reference_month: string; amount: string } | null>(null)
  const [payMenPmId, setPayMenPmId] = useState('')
  const [payMenLoading, setPayMenLoading] = useState(false)

  // Upgrade guest to member modal
  const [showUpgrade, setShowUpgrade] = useState(false)
  const [upgradeCpf, setUpgradeCpf] = useState('')
  const [upgradePhone, setUpgradePhone] = useState('')
  const [upgradeCep, setUpgradeCep] = useState('')
  const [upgradeLoading, setUpgradeLoading] = useState(false)
  // Reassign package to existing resident
  const [reassignSearch, setReassignSearch] = useState('')
  const [reassignResults, setReassignResults] = useState<{ id: string; full_name: string; type: string; responsible_id?: string; responsible_name?: string }[]>([])
  const [reassignLoading, setReassignLoading] = useState(false)

  const searchReassign = async (q: string) => {
    setReassignSearch(q)
    if (q.length < 3) { setReassignResults([]); return }
    try {
      const res = await api.get<any[]>(`/residents/search?q=${encodeURIComponent(q)}`)
      setReassignResults(res.data.slice(0, 6))
    } catch { setReassignResults([]) }
  }

  const handleReassign = async (residentId: string, residentName: string) => {
    if (!deliveryTarget) return
    setReassignLoading(true)
    try {
      await api.patch(`/packages/${deliveryTarget.id}/reassign`, { resident_id: residentId })
      toast.success(`Encomenda reatribuída para ${residentName}`)
      setReassignSearch(''); setReassignResults([])
      loadPackages()
    } catch (e: any) {
      toast.error(apiErr(e, 'Erro ao reatribuir.'))
    } finally { setReassignLoading(false) }
  }

  const openPayMensalidadeQuick = async () => {
    if (!deliveryTarget?.resident_id) return
    try {
      const res = await api.get<{ id: string; reference_month: string; amount: string }[]>(
        `/mensalidades/residents/${deliveryTarget.resident_id}`
      )
      const pending = res.data.filter((m: any) => m.status === 'pending').sort((a: any, b: any) => a.reference_month.localeCompare(b.reference_month))
      if (!pending.length) { toast.error('Nenhuma mensalidade pendente encontrada.'); return }
      setPayMenId(pending[0].id)
      setPayMenInfo({ reference_month: pending[0].reference_month, amount: pending[0].amount })
      setPayMenPmId(paymentMethods[0]?.id ?? '')
      setShowPayMenModal(true)
    } catch { toast.error('Erro ao buscar mensalidades.') }
  }

  const confirmPayMensalidadeQuick = async () => {
    if (!payMenId || !deliveryTarget?.resident_id || !payMenInfo) return
    setPayMenLoading(true)
    try {
      // Tenta via caixa aberto; se não houver sessão, usa lançamento offline
      try {
        await api.post(`/mensalidades/${payMenId}/pay`, {
          payment_method_id: payMenPmId || undefined,
        })
      } catch (e: any) {
        const code = e.response?.data?.code ?? e.response?.data?.detail
        const isNoSession = e.response?.status === 422 && (
          String(code).includes('NO_SESSION') || String(e.response?.data?.detail).toLowerCase().includes('caixa')
        )
        if (!isNoSession) throw e
        // Fallback: lançamento sem caixa — o backend agora quita a mensalidade automaticamente
        await api.post('/finance/transactions/offline', {
          type: 'income',
          amount: parseFloat(payMenInfo.amount),
          description: `Mensalidade ${payMenInfo.reference_month} — ${deliveryTarget.resident_name}`,
          income_subtype: 'mensalidade',
          resident_id: deliveryTarget.resident_id,
          payment_method_id: payMenPmId || null,
          payment_status: 'paid',
        })
      }
      toast.success('Mensalidade regularizada! Taxa de entrega removida.')
      setShowPayMenModal(false)
      setPayMenId(null); setPayMenInfo(null)
      queryClient.invalidateQueries({ queryKey: ['mensalidades', 'delinquent'] })
      const checkRes = await api.get<any>(`/packages/${deliveryTarget.id}/delivery-check`).catch(() => ({ data: null }))
      if (checkRes.data) setDeliveryCheck(checkRes.data)
    } catch (e: any) {
      toast.error(e.response?.data?.detail ?? 'Erro ao registrar pagamento.')
    } finally { setPayMenLoading(false) }
  }

  const handleUpgradeToMember = async () => {
    if (!deliveryTarget?.resident_id) return
    if (!upgradePhone.trim()) { toast.error('Telefone obrigatório para associado.'); return }
    if (!upgradeCep.trim()) { toast.error('CEP obrigatório para associado.'); return }
    setUpgradeLoading(true)
    try {
      await api.put(`/residents/${deliveryTarget.resident_id}`, {
        type: 'member', cpf: upgradeCpf.trim() || undefined,
        phone_primary: upgradePhone.trim(), address_cep: upgradeCep.trim(), status: 'active',
        is_member_confirmed: true, terms_accepted: true, lgpd_accepted: true,
      })
      toast.success('Morador cadastrado como associado! Taxa isenta nesta entrega.')
      setUpgradedResidentInfo({ id: deliveryTarget.resident_id!, name: deliveryTarget.resident_name ?? '' })
      setDeliveryTarget(prev => prev ? { ...prev, resident_type: 'member', has_delivery_fee: false } : prev)
      setShowUpgrade(false); setUpgradeCpf(''); setUpgradePhone(''); setUpgradeCep('')
      loadPackages()
    } catch (e: any) {
      toast.error(apiErr(e, 'Erro ao atualizar cadastro.'))
    } finally { setUpgradeLoading(false) }
  }

  // Receive history
  const [receiveHistory, setReceiveHistory] = useState<ReceiveHistoryEntry[]>([])
  const [rxHistoryLoading, setRxHistoryLoading] = useState(false)
  const [rxHistoryExpanded, setRxHistoryExpanded] = useState<Set<string>>(new Set())
  const loadReceiveHistory = async () => {
    setRxHistoryLoading(true)
    try {
      const res = await packageService.receiveHistory({ limit: 50 })
      setReceiveHistory(res.data)
    } catch { /* silent */ } finally { setRxHistoryLoading(false) }
  }
  useEffect(() => { if (!modalMode) loadReceiveHistory() }, [modalMode])

  // Bulk delivery flow
  const [showBulkDeliver, setShowBulkDeliver] = useState(false)
  const [bulkStep, setBulkStep] = useState<'select' | 'sign'>('select')
  const [bulkSelected, setBulkSelected] = useState<Set<string>>(new Set())
  const [bulkRecipientName, setBulkRecipientName] = useState('')
  const [bulkSig, setBulkSig] = useState('')
  const [bulkDeliveryPersonName, setBulkDeliveryPersonName] = useState('')
  const [bulkLoading, setBulkLoading] = useState(false)
  const [bulkResult, setBulkResult] = useState<{ delivered: number; errors: { id: string; error: string }[]; items: any[] } | null>(null)

  const pendingPackages = packages.filter(p => p.status === 'received' || p.status === 'notified' || p.status === 'reversed')

  const [bulkPaymentMethodId, setBulkPaymentMethodId] = useState('')
  const [bulkCashSessionId, setBulkCashSessionId] = useState('')
  const [bulkSessionPicker, setBulkSessionPicker] = useState<{ id: string; opened_by_name: string; opening_balance: string }[] | null>(null)
  const [bulkSearch, setBulkSearch] = useState('')
  const [bulkExemptionToken, setBulkExemptionToken] = useState('')
  const [bulkExemptionError, setBulkExemptionError] = useState('')

  const resetBulk = () => {
    setShowBulkDeliver(false); setBulkStep('select'); setBulkSelected(new Set())
    setBulkRecipientName(''); setBulkSig(''); setBulkDeliveryPersonName('')
    setBulkLoading(false); setBulkResult(null); setBulkPaymentMethodId('')
    setBulkCashSessionId(''); setBulkSessionPicker(null); setBulkSearch('')
    setBulkExemptionToken(''); setBulkExemptionError('')
  }

  const bulkFiltered = bulkSearch.trim()
    ? pendingPackages.filter(p => {
        const q = bulkSearch.toLowerCase()
        return (p.resident_name ?? '').toLowerCase().includes(q)
          || (p.tracking_code ?? '').toLowerCase().includes(q)
          || (p.carrier_name ?? '').toLowerCase().includes(q)
      })
    : pendingPackages

  const bulkHasGuest = Array.from(bulkSelected).some(id => {
    const p = packages.find(x => x.id === id)
    return p && (p.resident_type === 'guest' || !p.resident_id)
  })

  const doBulkDeliver = async (cash_session_id?: string) => {
    setBulkLoading(true)
    setBulkSessionPicker(null)
    try {
      const res = await api.post<{ delivered: number; errors: { id: string; error: string }[]; items: any[] }>('/packages/bulk-deliver', {
        package_ids: Array.from(bulkSelected),
        delivered_to_name: bulkRecipientName,
        signature_url: bulkSig,
        delivery_person_name: bulkDeliveryPersonName || fullName || undefined,
        payment_method_id: bulkPaymentMethodId || undefined,
        cash_session_id: cash_session_id || undefined,
        exemption_token: bulkExemptionToken.trim().toUpperCase() || undefined,
      })
      setBulkResult(res.data)
      loadPackages()
      toast.success(`${res.data.delivered} encomenda(s) entregue(s)!`)
    } catch (e: any) {
      const detail = e?.response?.data?.detail
      if (detail === 'TOKEN_INVALID') { setBulkExemptionError('Código inválido, expirado ou já utilizado.'); setBulkLoading(false); return }
      toast.error(apiErr(e, 'Erro na entrega múltipla.'))
    } finally {
      setBulkLoading(false)
    }
  }

  const handleBulkDeliver = async () => {
    if (!bulkRecipientName || !bulkSig) { toast.error('Nome e assinatura obrigatórios.'); return }
    if (bulkSelected.size === 0) { toast.error('Selecione ao menos uma encomenda.'); return }
    if (bulkHasGuest && !bulkPaymentMethodId && !bulkExemptionToken.trim()) { toast.error('Informe a forma de pagamento ou um código de isenção.'); return }
    if (bulkHasGuest && !bulkExemptionToken.trim() && !bulkCashSessionId) {
      try {
        const sessRes = await financeService.listOpenSessions()
        if (sessRes.data.length === 0) { toast.error('Nenhum caixa aberto para registrar a taxa.'); return }
        const mine = sessRes.data.find((s: any) => s.is_mine)
        if (mine) { await doBulkDeliver(undefined); return }
        setBulkSessionPicker(sessRes.data)
      } catch { toast.error('Erro ao buscar caixas abertos.') }
      return
    }
    await doBulkDeliver(bulkCashSessionId || undefined)
  }

  // Receive mode choice
  const [showReceiveMode, setShowReceiveMode] = useState(false)

  // Bulk receive flow
  const [showBulkReceive, setShowBulkReceive] = useState(false)
  const [bulkRxStep, setBulkRxStep] = useState<'add' | 'sign'>('sign')
  type BulkRxItem = { id: string; tracking_code: string; carrier_name: string; resident_id?: string; resident_name: string; resident_type?: string; photo_urls: { url: string; label: string; taken_at: string }[] }
  type BrxPending = { resident: Resident; tracking: string }
  const brxStorageKey = `brx_queue_${associationId}`
  const brxBatchStorageKey = `brx_batch_${associationId}`
  const [bulkRxQueue, setBulkRxQueue] = useState<BulkRxItem[]>(() => {
    try { return JSON.parse(localStorage.getItem(`brx_queue_${associationId}`) ?? '[]') } catch { return [] }
  })
  const [brxBatchId, setBrxBatchId] = useState<string>(() => {
    return localStorage.getItem(`brx_batch_${associationId}`) ?? crypto.randomUUID()
  })
  const [brxPending, setBrxPending] = useState<BrxPending | null>(null)
  const [brxDelivererName, setBrxDelivererName] = useState('')
  const [brxDelivererSig, setBrxDelivererSig] = useState('')
  const [brxLoading, setBrxLoading] = useState(false)
  const [brxResult, setBrxResult] = useState<{ received: number; errors: string[] } | null>(null)
  const [brxTracking, setBrxTracking] = useState('')
  const [brxCarrier, setBrxCarrier] = useState('')
  const [brxSearch, setBrxSearch] = useState('')
  const [brxResults, setBrxResults] = useState<Resident[]>([])
  const [brxSelected, setBrxSelected] = useState<Resident | null>(null)
  const [brxLastAdded, setBrxLastAdded] = useState<string | null>(null)
  const [showBrxScanner, setShowBrxScanner] = useState(false)
  const [scanChoice, setScanChoice] = useState<'single' | 'bulk' | null>(null)
  const [scanMode, setScanMode] = useState<'barcode' | 'qrcode'>('barcode')
  const isMobile = typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches
  const brxBarcodeRef = useRef<HTMLInputElement>(null)
  const brxSearchRef = useRef<HTMLInputElement>(null)

  const searchBrxResidents = async (q: string) => {
    if (q.length < 3) { setBrxResults([]); return }
    try {
      const res = await api.get<Resident[]>('/residents/search', { params: { q } })
      setBrxResults(res.data.slice(0, 8))
    } catch { /* silent */ }
  }

  const doAddToBulkRxQueue = (resident: Resident, tracking: string, photoUrls: { url: string; label: string; taken_at: string }[]) => {
    const entry: BulkRxItem = {
      id: crypto.randomUUID(),
      tracking_code: tracking,
      carrier_name: brxCarrier,
      resident_id: resident.id,
      resident_name: resident.full_name,
      resident_type: resident.type,
      photo_urls: photoUrls,
    }
    setBulkRxQueue(q => [...q, entry])
    setBrxPending(null)
    setBrxCarrier('')
    setBrxLastAdded(resident.full_name + (tracking ? ` · ${tracking}` : ''))
    setBrxTracking('')
    setBrxSearch('')
    setBrxResults([])
    setBrxSelected(null)
    setTimeout(() => { brxBarcodeRef.current?.focus(); setBrxLastAdded(null) }, 1200)
  }

  const requestBrxPhoto = (resident: Resident, tracking: string) => {
    setBrxCarrier('')
    setBrxPending({ resident, tracking })
    setBrxTracking('')
    setBrxSearch('')
    setBrxResults([])
    setBrxSelected(null)
  }

  const handleBarcodeEnter = () => {
    if (brxTracking.trim() && brxResults.length > 0) {
      requestBrxPhoto(brxResults[0], brxTracking)
    } else if (brxSelected) {
      requestBrxPhoto(brxSelected, brxTracking)
    } else {
      setTimeout(() => brxSearchRef.current?.focus(), 30)
    }
  }

  const selectBrxResident = (r: Resident) => {
    requestBrxPhoto(r, brxTracking)
  }

  const handleBulkRxSubmit = async () => {
    if (bulkRxQueue.length === 0) return
    setBrxLoading(true)
    let received = 0
    const errors: string[] = []
    for (const item of bulkRxQueue) {
      try {
        await packageService.receive({
          resident_id: item.resident_id,
          carrier_name: item.carrier_name || undefined,
          tracking_code: item.tracking_code || undefined,
          photo_urls: item.photo_urls,
          deliverer_name: brxDelivererName || undefined,
          deliverer_signature_url: brxDelivererSig || undefined,
          receive_batch_id: brxBatchId,
        })
        received++
      } catch {
        errors.push(item.resident_name + (item.tracking_code ? ` (${item.tracking_code})` : ''))
      }
    }
    setBrxResult({ received, errors })
    localStorage.removeItem(brxStorageKey)
    localStorage.removeItem(brxBatchStorageKey)
    loadPackages()
    loadReceiveHistory()
    setBrxLoading(false)
  }

  const [brxExitConfirm, setBrxExitConfirm] = useState(false)

  const resetBulkRx = () => {
    setBrxExitConfirm(false)
    setShowBulkReceive(false); setBulkRxStep('sign'); setBulkRxQueue([])
    setBrxDelivererName(''); setBrxDelivererSig(''); setBrxLoading(false); setBrxResult(null)
    setBrxTracking(''); setBrxCarrier(''); setBrxSearch(''); setBrxResults([])
    setBrxSelected(null); setBrxLastAdded(null); setShowBrxScanner(false); setBrxPending(null)
    setBrxGuestName(''); setBrxShowGuest(false)
    setBrxGuestCep(''); setBrxGuestNumber(''); setBrxGuestStreet(''); setBrxGuestNeighborhood(''); setBrxGuestCity(''); setBrxGuestState('')
    setBrxBatchId(crypto.randomUUID())
  }

  const closeBulkRx = () => {
    if (bulkRxQueue.length > 0 && !brxResult) {
      setBrxExitConfirm(true)
    } else {
      resetBulkRx()
    }
  }

  // Bulk receive — guest creation
  const [brxShowGuest, setBrxShowGuest] = useState(false)
  const [brxGuestName, setBrxGuestName] = useState('')
  const [brxGuestCep, setBrxGuestCep] = useState('')
  const [brxGuestNumber, setBrxGuestNumber] = useState('')
  const [brxGuestStreet, setBrxGuestStreet] = useState('')
  const [brxGuestNeighborhood, setBrxGuestNeighborhood] = useState('')
  const [brxGuestCity, setBrxGuestCity] = useState('')
  const [brxGuestState, setBrxGuestState] = useState('')
  const [brxGuestCepLoading, setBrxGuestCepLoading] = useState(false)
  const [brxGuestLoading, setBrxGuestLoading] = useState(false)

  const lookupBrxGuestCep = async (cep: string) => {
    const digits = cep.replace(/\D/g, '')
    if (digits.length !== 8) return
    setBrxGuestCepLoading(true)
    try {
      const r = await fetch(`https://viacep.com.br/ws/${digits}/json/`)
      const data = await r.json()
      if (!data.erro) {
        setBrxGuestStreet(data.logradouro ?? '')
        setBrxGuestNeighborhood(data.bairro ?? '')
        setBrxGuestCity(data.localidade ?? '')
        setBrxGuestState(data.uf ?? '')
      }
    } catch { /* silent */ } finally { setBrxGuestCepLoading(false) }
  }

  const createBrxGuest = async () => {
    if (!brxGuestName.trim()) { toast.error('Nome obrigatório.'); return }
    if (newResType === 'guest') {
      if (!brxGuestCep.replace(/\D/g, '').trim()) { toast.error('CEP obrigatório para visitante.'); return }
      if (!brxGuestNumber.trim()) { toast.error('Número do endereço obrigatório.'); return }
    }
    if (newResType === 'dependent' && !newResResponsible) { toast.error('Selecione o responsável.'); return }
    setBrxGuestLoading(true)
    try {
      const payload: any = {
        status: 'active', full_name: brxGuestName.trim(),
        is_member_confirmed: newResType !== 'guest', terms_accepted: newResType !== 'guest', lgpd_accepted: true,
        type: newResType === 'guest' ? 'guest' : 'member',
      }
      if (newResType === 'guest') {
        payload.address_cep = brxGuestCep.replace(/\D/g, '')
        payload.address_number = brxGuestNumber.trim()
        if (brxGuestStreet) payload.address_street = brxGuestStreet
        if (brxGuestNeighborhood) payload.address_neighborhood = brxGuestNeighborhood
        if (brxGuestCity) payload.address_city = brxGuestCity
        if (brxGuestState) payload.address_state = brxGuestState
      }
      if (newResType === 'member' && newResCpf.trim()) payload.cpf = newResCpf.trim()
      if (newResType === 'dependent' && newResResponsible) payload.responsible_id = newResResponsible.id
      const res = await api.post<Resident>('/residents', payload)
      setBrxShowGuest(false); setBrxGuestName(''); setBrxGuestCep(''); setBrxGuestNumber(''); setBrxGuestStreet(''); setBrxGuestNeighborhood(''); setBrxGuestCity(''); setBrxGuestState('')
      setNewResType('guest'); setNewResCpf(''); setNewResResponsible(null); setNewResResponsibleSearch(''); setNewResResponsibleResults([])
      requestBrxPhoto(res.data, brxTracking)
    } catch (e: any) {
      toast.error(apiErr(e, 'Erro ao criar.'))
    } finally { setBrxGuestLoading(false) }
  }

  // Upgrade guest → member (receive flow)
  const [rxUpgradeTarget, setRxUpgradeTarget] = useState<Resident | null>(null)
  const [rxUpgradeCpf, setRxUpgradeCpf] = useState('')
  const [rxUpgradePhone, setRxUpgradePhone] = useState('')
  const [rxUpgradeCep, setRxUpgradeCep] = useState('')
  const [rxUpgradeLoading, setRxUpgradeLoading] = useState(false)

  const handleRxUpgrade = async () => {
    if (!rxUpgradeTarget) return
    if (!rxUpgradePhone.trim()) { toast.error('Telefone obrigatório.'); return }
    if (!rxUpgradeCep.trim()) { toast.error('CEP obrigatório.'); return }
    setRxUpgradeLoading(true)
    try {
      const res = await api.put<Resident>(`/residents/${rxUpgradeTarget.id}`, {
        type: 'member', cpf: rxUpgradeCpf.trim() || undefined,
        phone_primary: rxUpgradePhone.trim(), address_cep: rxUpgradeCep.trim(), status: 'active',
        is_member_confirmed: true, terms_accepted: true, lgpd_accepted: true,
      })
      toast.success('Cadastro atualizado para Associado!')
      const updated = res.data
      setRxUpgradeTarget(null); setRxUpgradeCpf(''); setRxUpgradePhone(''); setRxUpgradeCep('')
      // if in single receive, update selectedRecipient
      if (selectedRecipient?.id === updated.id) setSelectedRecipient(updated)
      // if in bulk receive, set pending with updated resident
      if (rxUpgradeTarget) requestBrxPhoto(updated, brxTracking)
    } catch (e: any) {
      toast.error(apiErr(e, 'Erro ao atualizar.'))
    } finally { setRxUpgradeLoading(false) }
  }

  // Receive flow — deliverer
  const [delivererName, setDelivererName] = useState('')
  const [delivererSig, setDelivererSig] = useState('')
  const [delivererManual, setDelivererManual] = useState(false)

  // Carriers & Deliverers catalog
  type CarrierOpt = { id: string; name: string }
  type DelivererOpt = { id: string; name: string; carrier_id: string | null; signature_url: string | null }
  const [carrierOpts, setCarrierOpts] = useState<CarrierOpt[]>([])
  const [delivererOpts, setDelivererOpts] = useState<DelivererOpt[]>([])

  const [delivererOptsLoading, setDelivererOptsLoading] = useState(false)
  const loadDelivererOpts = () => {
    setDelivererOptsLoading(true)
    Promise.all([
      api.get<CarrierOpt[]>('/carriers'),
      api.get<DelivererOpt[]>('/carriers/deliverers'),
    ]).then(([rc, rd]) => {
      setCarrierOpts(rc.data)
      setDelivererOpts(rd.data)
    }).catch(() => {}).finally(() => setDelivererOptsLoading(false))
  }
  useEffect(() => { loadDelivererOpts() }, [])
  useEffect(() => { if (showReceiveMode) loadDelivererOpts() }, [showReceiveMode])

  const enrichMissingStreets = async (pkgs: Package[]) => {
    const toEnrich = pkgs.filter(p => p.resident_cep && !p.resident_address_street && p.resident_id)
    if (toEnrich.length === 0) return
    const uniqueCeps = [...new Set(toEnrich.map(p => p.resident_cep!.replace(/\D/g, '')))]
    const streetMap: Record<string, string> = {}
    await Promise.allSettled(uniqueCeps.map(async cep => {
      try {
        const r = await fetch(`https://viacep.com.br/ws/${cep}/json/`)
        const data = await r.json()
        if (!data.erro && data.logradouro) streetMap[cep] = data.logradouro
      } catch { /* silent */ }
    }))
    if (Object.keys(streetMap).length === 0) return
    setPackages(prev => prev.map(p => {
      if (!p.resident_cep || p.resident_address_street) return p
      const street = streetMap[p.resident_cep.replace(/\D/g, '')]
      return street ? { ...p, resident_address_street: street } : p
    }))
    // Persist to backend — one PATCH per unique resident_id + cep combination
    const seen = new Set<string>()
    for (const p of toEnrich) {
      const cep = p.resident_cep!.replace(/\D/g, '')
      const street = streetMap[cep]
      if (!street) continue
      const key = `${p.resident_id}:${cep}`
      if (seen.has(key)) continue
      seen.add(key)
      api.patch(`/packages/${p.id}/info`, { resident_address_street: street }).catch(() => {})
    }
  }

  const loadPackages = async (append = false, offsetOverride?: number) => {
    const key = ++loadPackagesKeyRef.current
    setPackagesLoading(true)
    try {
      const params: Record<string, string | number> = {}
      if (filterStatus) params.status = filterStatus
      else params.statuses = 'received,notified,reversed'
      if (filterQ.trim()) params.q = filterQ.trim()
      if (filterDateFrom) params.date_from = filterDateFrom
      if (filterDateTo) params.date_to = filterDateTo
      const off = offsetOverride ?? (append ? pkgOffset : 0)
      params.limit = PKG_PAGE_SIZE
      params.offset = off
      const [res, cntRes] = await Promise.all([
        api.get<Package[]>('/packages', { params }),
        ...(append ? [] : [api.get<Record<string, number>>('/packages/counts', {
          params: { q: filterQ.trim() || undefined, date_from: filterDateFrom || undefined, date_to: filterDateTo || undefined },
        })]),
      ])
      if (key !== loadPackagesKeyRef.current) return
      const loaded = append ? [] : res.data  // only enrich on fresh load, not pagination
      setPackages(prev => append ? [...prev, ...res.data] : res.data)
      if (!append) enrichMissingStreets(loaded)
      setHasMorePkgs(res.data.length === PKG_PAGE_SIZE)
      if (!append) {
        setPkgOffset(0)
        setStatusCounts((cntRes as any).data ?? {})
      }
    } catch {
      if (key === loadPackagesKeyRef.current) toast.error('Erro ao carregar encomendas.')
    } finally {
      if (key === loadPackagesKeyRef.current) setPackagesLoading(false)
    }
  }

  const loadMorePkgs = async () => {
    const next = pkgOffset + PKG_PAGE_SIZE
    setPkgOffset(next)
    await loadPackages(true, next)
  }

  useEffect(() => {
    if (modalMode) return
    const t = setTimeout(loadPackages, filterQ ? 300 : 0)
    return () => clearTimeout(t)
  }, [filterStatus, filterQ, filterDateFrom, filterDateTo, modalMode])

  useEffect(() => { if (showReceive && step === 'recipient') barcodeRef.current?.focus() }, [showReceive, step])
  useEffect(() => { if (showBulkReceive && bulkRxStep === 'add') setTimeout(() => brxBarcodeRef.current?.focus(), 200) }, [showBulkReceive, bulkRxStep])
  const anyModeModalOpen = showReceiveMode || showReceive || showBulkReceive
    || showRetiradaPicker || !!deliveryTarget
    || showDevolucaoPicker || !!detailPkg
    || showConsultarPicker || showMinhasPicker
  const anyModalWasOpenRef = useRef(false)
  useEffect(() => {
    if (!onModalClosed) return
    if (anyModeModalOpen) { anyModalWasOpenRef.current = true; return }
    if (anyModalWasOpenRef.current) { anyModalWasOpenRef.current = false; onModalClosed() }
  }, [anyModeModalOpen])
  useEffect(() => {
    if (bulkRxQueue.length > 0) {
      localStorage.setItem(brxStorageKey, JSON.stringify(bulkRxQueue))
      localStorage.setItem(brxBatchStorageKey, brxBatchId)
    } else {
      localStorage.removeItem(brxStorageKey)
      localStorage.removeItem(brxBatchStorageKey)
    }
  }, [bulkRxQueue])

  const searchResidents = async (q: string) => {
    if (q.length < 3) { setSearchResults([]); setSearchEmpty(false); setShowGuestForm(false); return }
    try {
      const res = await api.get<Resident[]>('/residents/search', { params: { q } })
      const results = res.data.slice(0, 8)
      setSearchResults(results)
      setSearchEmpty(results.length === 0)
      if (results.length > 0) setShowGuestForm(false)
    } catch { /* silent */ }
  }

  const lookupCep = async (cep: string) => {
    const clean = cep.replace(/\D/g, '')
    if (clean.length !== 8) return
    setCepLoading(true)
    try {
      const r = await fetch(`https://viacep.com.br/ws/${clean}/json/`)
      const d = await r.json()
      if (!d.erro) {
        setGuest(g => ({ ...g, address_street: d.logradouro ?? '', address_district: d.bairro ?? '', address_city: d.localidade ?? '', address_state: d.uf ?? '' }))
      }
    } catch { /* silent */ } finally { setCepLoading(false) }
  }

  const searchResponsible = async (q: string) => {
    if (q.length < 3) { setNewResResponsibleResults([]); return }
    try {
      const res = await api.get<Resident[]>('/residents/search', { params: { q } })
      setNewResResponsibleResults(res.data.filter(r => r.type === 'member' && !('responsible_id' in r && (r as any).responsible_id)).slice(0, 6))
    } catch { }
  }

  const checkDuplicates = (name: string) => {
    if (duplicateTimer.current) clearTimeout(duplicateTimer.current)
    if (name.trim().length < 3) { setDuplicateMatches([]); return }
    duplicateTimer.current = setTimeout(async () => {
      try {
        const res = await api.get<Resident[]>('/residents/search', { params: { q: name.trim() } })
        setDuplicateMatches(res.data.slice(0, 5))
      } catch { setDuplicateMatches([]) }
    }, 400)
  }

  const resetCepGate = () => {
    setShowCepGate(false); setCepGateValue(''); setCepGateStreet('')
    setCepGateResidents([]); setCepGateLoading(false); setCepGateDone(false)
    if (cepGateTimer.current) clearTimeout(cepGateTimer.current)
  }

  const runCepGate = (rawCep: string) => {
    setCepGateValue(rawCep)
    const digits = rawCep.replace(/\D/g, '')
    if (digits.length !== 8) {
      setCepGateStreet(''); setCepGateResidents([]); setCepGateDone(false); setCepGateLoading(false)
      return
    }
    if (cepGateTimer.current) clearTimeout(cepGateTimer.current)
    cepGateTimer.current = setTimeout(async () => {
      setCepGateLoading(true); setCepGateDone(false); setCepGateResidents([])
      let street = ''
      try {
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), 2000)
        const r = await fetch(`https://viacep.com.br/ws/${digits}/json/`, { signal: controller.signal })
        clearTimeout(timeout)
        const data = await r.json()
        if (!data.erro) { street = data.logradouro ?? ''; setCepGateStreet(street) }
      } catch { /* ViaCEP timeout — proceed without street filter */ }
      try {
        const params: Record<string, string> = { q: recipientSearch.trim() || ' ' }
        if (street) params.street = street
        const res = await api.get<Resident[]>('/residents/search', { params })
        setCepGateResidents(res.data.slice(0, 5))
      } catch { setCepGateResidents([]) }
      setCepGateLoading(false)
      setCepGateDone(true)
    }, 400)
  }

  const createGuest = async () => {
    if (!guest.full_name.trim()) { toast.error('Nome é obrigatório.'); return }
    if (newResType === 'guest' && !newResCpf.trim()) { toast.error('CPF é obrigatório.'); return }
    if (newResType === 'dependent' && !newResResponsible) { toast.error('Selecione o responsável.'); return }
    setLoading(true)
    try {
      const payload: any = {
        status: 'active',
        full_name: guest.full_name, phone_primary: guest.phone_primary || undefined,
        address_cep: guest.address_cep || undefined, address_street: guest.address_street || undefined,
        address_number: guest.address_number || undefined, address_complement: guest.address_complement || undefined,
        address_district: guest.address_district || undefined, address_city: guest.address_city || undefined,
      }
      if (newResType === 'guest') {
        payload.type = 'guest'; payload.is_member_confirmed = false; payload.terms_accepted = false; payload.lgpd_accepted = true
        if (newResCpf.trim()) payload.cpf = newResCpf.replace(/\D/g, '')
      } else {
        payload.type = 'member'; payload.is_member_confirmed = true; payload.terms_accepted = true; payload.lgpd_accepted = true
        if (newResCpf.trim()) payload.cpf = newResCpf.trim()
        if (newResType === 'dependent' && newResResponsible) payload.responsible_id = newResResponsible.id
      }
      const res = await api.post<Resident>('/residents', payload)
      setSelectedRecipient(res.data)
      setShowGuestForm(false)
      setStep('details')
    } catch (e: any) {
      toast.error(apiErr(e, 'Erro ao criar.'))
    } finally { setLoading(false) }
  }

  const handleReceive = async () => {
    if (photos.length === 0) { toast.error('Adicione ao menos uma foto da etiqueta.'); return }
    setLoading(true)
    try {
      await packageService.receive({
        resident_id: selectedRecipient?.id,
        carrier_name: carrier || undefined,
        tracking_code: tracking || undefined,
        photo_urls: photos,
        deliverer_name: delivererName || undefined,
        deliverer_signature_url: delivererSig || undefined,
      })
      toast.success('Encomenda registrada!')
      resetReceive()
      loadPackages()
    } catch (e: any) {
      toast.error(apiErr(e, 'Erro.'))
    } finally {
      setLoading(false)
    }
  }

  const resetReceive = () => {
    setShowReceive(false); setStep('recipient'); setRecipientSearch(''); recipientInputRef.current?.clear()
    setSearchResults([]); setSelectedRecipient(null); setShowGuestForm(false); setSearchEmpty(false)
    setGuest(emptyGuest()); setTracking(''); setCarrier(''); setPhotos([]); setDuplicateMatches([])
    setDelivererName(''); setDelivererSig(''); setDelivererManual(false)
    setNewResType('guest'); setNewResCpf(''); setNewResResponsibleSearch(''); setNewResResponsible(null); setNewResResponsibleResults([])
    resetCepGate()
  }

  const doDeliver = async (cash_session_id?: string) => {
    if (!deliveryTarget) return
    const base: DeliverPayload = pendingDeliveryPayload ?? {
      delivered_to_name: recipientName,
      signature_url: recipientSig,
      delivered_to_resident_id: pickupType === 'dependent' ? selectedDependent?.id : deliveryTarget.resident_id,
      proof_of_residence_url: proofResidenceUrl || undefined,
      recipient_id_photo_url: recipientIdPhoto || undefined,
      delivery_person_name: deliveryPersonName || fullName || undefined,
      third_party_pickup: pickupType === 'other',
      picker_id_photo_url: pickupType === 'other' ? pickerIdPhoto || undefined : undefined,
      picker_phone: pickupType === 'other' ? pickerPhone.trim() || undefined : undefined,
      payment_method_id: deliveryPaymentMethodId || undefined,
      payer_name: deliveryPixPayerName.trim() || undefined,
      exemption_token: exemptionToken.trim().toUpperCase() || undefined,
    }
    const payload: DeliverPayload = cash_session_id ? { ...base, cash_session_id } : base
    setLoading(true)
    try {
      const res = await packageService.deliver(deliveryTarget.id, payload)
      const pkg = res.data as any
      toast.success(pkg.has_delivery_fee
        ? `Entregue! Taxa R$ ${parseFloat(pkg.delivery_fee_amount).toFixed(2)} cobrada.`
        : 'Encomenda entregue!')
      if (pkg.possible_duplicates?.length > 0) {
        const names = pkg.possible_duplicates.map((d: any) => d.full_name).join(', ')
        toast(`⚠️ Possível cadastro duplicado: ${names}`, {
          duration: 8000,
          style: { background: '#fef3c7', color: '#92400e', fontWeight: 500 },
        })
      }
      const upgraded = upgradedResidentInfo
      setDeliveryTarget(null)
      resetDelivery()
      setUpgradedResidentInfo(null)
      setPendingDeliveryPayload(null)
      setDeliverySessionPicker(null)
      if (upgraded) {
        navigate('/financeiro', { state: { tab: 'cobrancas', cobrancasView: 'historico', residentId: upgraded.id, residentName: upgraded.name } })
        return
      }
      loadPackages()
    } catch (e: any) {
      const detail = e.response?.data?.detail
      if (detail === 'TOKEN_INVALID') {
        setExemptionTokenError('Código inválido, expirado ou já utilizado.')
        return
      }
      if (detail === 'NO_SESSION') {
        try {
          const sessRes = await financeService.listOpenSessions()
          if (sessRes.data.length === 0) { toast.error('Nenhum caixa aberto para registrar a taxa.'); return }
          setPendingDeliveryPayload(payload)
          setDeliverySessionPicker(sessRes.data)
        } catch { toast.error('Erro ao buscar caixas abertos.') }
      } else {
        toast.error(apiErr(e, 'Erro na entrega.'))
      }
    } finally {
      setLoading(false)
    }
  }

  const handleDeliver = async () => {
    if (!deliveryTarget) return
    const isGuest = !deliveryTarget.resident_id || deliveryTarget.resident_type === 'guest'
    if (!recipientName || !recipientSig) { toast.error('Nome e assinatura do recebedor obrigatórios.'); return }
    if (isGuest && !deliveryPaymentMethodId && !exemptionToken.trim()) { toast.error('Informe a forma de pagamento ou um código de isenção.'); return }
    const selectedPm = paymentMethods.find(m => m.id === deliveryPaymentMethodId)
    if (selectedPm?.name?.toLowerCase().includes('pix') && !deliveryPixPayerName.trim()) { toast.error('Informe o nome do pagador PIX.'); return }
    if (pickupType === 'dependent' && !selectedDependent) { toast.error('Selecione um dependente.'); return }
    if (pickupType === 'other' && !pickerIdPhoto) { toast.error('Documento de identificação obrigatório para retirada por terceiros.'); return }
    await doDeliver()
  }

  const resetDelivery = () => {
    setRecipientName(''); setRecipientSig('')
    setProofResidenceUrl(''); setRecipientIdPhoto(''); setDeliveryPersonName('')
    setPickupType('resident'); setDependents([]); setSelectedDependent(null)
    setAddingDependent(false); setNewDepName(''); setNewDepPhone(''); setPickerIdPhoto(''); setPickerPhone('')
    setDeliveryPaymentMethodId(''); setDeliveryPixPayerName(''); setShowUpgrade(false); setUpgradeCpf(''); setUpgradedResidentInfo(null)
    setExemptionToken(''); setExemptionTokenError('')
  }

  const pendingCount = packages.filter(p => p.status === 'received' || p.status === 'notified').length
  const clearFilters = () => { setFilterQ(''); filterInputRef.current?.clear(); setFilterDateFrom(''); setFilterDateTo(''); setFilterStatus(''); setFilterOp(null); setFilterOpSet(new Set()) }

  const searchDelivered = async (q: string) => {
    setDeliveredQ(q)
    if (q.trim().length < 3) { setDeliveredPackages([]); return }
    setDeliveredLoading(true)
    try {
      const res = await api.get<Package[]>('/packages', { params: { statuses: 'delivered,returned', q: q.trim() } })
      setDeliveredPackages(res.data)
    } catch { /* silent */ } finally { setDeliveredLoading(false) }
  }
  const opNames = [...new Set(packages.map(p => p.received_by_name).filter(Boolean))] as string[]
  const displayPackages = filterOpSet.size > 0 ? packages.filter(p => p.received_by_name && filterOpSet.has(p.received_by_name)) : packages
  const activeFilterCount = [filterQ, filterDateFrom, filterDateTo, filterStatus].filter(Boolean).length + filterOpSet.size

  const buildWaNotification = (pkg: Package): string => {
    const pending = packages.filter(
      p => p.resident_id === pkg.resident_id && (p.status === 'received' || p.status === 'notified')
    )
    const fmt = (d: string) => new Date(d).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
    const lines = pending.map(p => `📦 *${p.tracking_code ?? 'Sem código'}* — chegou ${fmt(p.received_at)}`)
    const assocAddr = assocProfile?.address ? `, ${assocProfile.address}` : ''
    const assocNm = assocProfile?.name ?? associationName
    return [
      `Olá, *${pkg.resident_name ?? 'morador'}*! 😊`,
      ``,
      `Sou *${fullName ?? 'sua portaria'}*, falo em nome da *${assocNm}*.`,
      ``,
      `${pending.length === 1 ? 'Sua encomenda está' : `Suas ${pending.length} encomendas estão`} aguardando retirada:`,
      ``,
      ...lines,
      ``,
      `🏠 ${pending.length === 1 ? 'Ela está' : 'Elas estão'} aqui na Associação de Moradores${assocAddr}.`,
      `⏰ Venha buscar o mais rápido possível, de *9h às 18h*. 🙏`,
    ].join('\n')
  }

  const PackageCard = ({ pkg }: { pkg: Package }) => (
    <div className="px-4 py-3 hover:bg-gray-50/80 cursor-pointer transition group" onClick={() => setDetailPkg(pkg)}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {/* Row 1: name + badges */}
          <div className="flex items-center gap-1.5 flex-wrap mb-0.5">
            <span className="text-sm font-semibold text-gray-800 break-words">{pkg.resident_name ?? '—'}</span>
            {pkg.resident_type === 'guest' && <span className="text-[10px] bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded-full font-bold shrink-0">VISITANTE</span>}
            {pkg.resident_type === 'member' && delinquentIds.has(pkg.resident_id ?? '') && (pkg.status === 'received' || pkg.status === 'notified') && (
              <span className="text-[10px] bg-red-100 text-red-700 px-1.5 py-0.5 rounded-full font-bold shrink-0">INADIMPLENTE</span>
            )}
            {pkg.has_delivery_fee && <span className="text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full font-bold shrink-0">Taxa R${parseFloat(pkg.delivery_fee_amount ?? '2.50').toFixed(2)}</span>}
          </div>
          {/* Row 2: carrier + tracking */}
          <div className="flex items-center gap-1.5 flex-wrap">
            {pkg.carrier_name && <span className="text-xs text-gray-500">{pkg.carrier_name}</span>}
            {pkg.tracking_code && <span className="text-xs text-gray-400 font-mono">{pkg.tracking_code}</span>}
            {!pkg.carrier_name && !pkg.tracking_code && <span className="text-xs text-gray-300">Sem transportadora</span>}
          </div>
          {/* Row 3: received info */}
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <span className="text-xs text-gray-400">
              {new Date(pkg.received_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })}
            </span>
            {pkg.received_by_name && <span className="text-xs text-gray-400">· <span className="text-gray-500">{pkg.received_by_name}</span></span>}
            {pkg.delivered_by_name && <span className="text-xs text-gray-400">· Entregue: <span className="text-gray-500">{pkg.delivered_by_name}</span></span>}
            {(pkg.status === 'received' || pkg.status === 'notified') && (() => {
              const days = Math.floor((Date.now() - new Date(pkg.received_at).getTime()) / 86400000)
              if (days < 1) return null
              return <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full shrink-0 ${days >= 7 ? 'bg-red-100 text-red-700' : days >= 3 ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-500'}`}>{days}d</span>
            })()}
          </div>
          {(pkg.resident_address_street || pkg.resident_cep) && (
            <p className="text-xs text-gray-400 mt-0.5">
              {pkg.resident_address_street ? `${pkg.resident_address_street}${pkg.resident_address_number ? `, ${pkg.resident_address_number}` : ''}` : `CEP ${pkg.resident_cep}`}
            </p>
          )}
          {/* Reassign resident — not for delivered */}
          {['received', 'notified', 'reversed', 'returned'].includes(pkg.status) && (
            <div onClick={e => e.stopPropagation()} className="mt-1.5">
              {cardReassignPkgId === pkg.id ? (
                <div className="relative">
                  <input
                    ref={cardReassignInputRef}
                    autoFocus
                    value={cardReassignSearch}
                    onFocus={e => { const r = e.currentTarget.getBoundingClientRect(); setCardReassignRect({ top: r.bottom, left: r.left, width: r.width }) }}
                    onChange={e => {
                      const v = e.target.value
                      setCardReassignSearch(v)
                      const r = e.currentTarget.getBoundingClientRect()
                      setCardReassignRect({ top: r.bottom, left: r.left, width: r.width })
                      if (cardReassignTimer.current) clearTimeout(cardReassignTimer.current)
                      cardReassignTimer.current = setTimeout(() => {
                        if (v.length >= 3) api.get<any[]>(`/residents/search?q=${encodeURIComponent(v)}`).then(r => setCardReassignResults(r.data.slice(0, 5))).catch(() => setCardReassignResults([]))
                        else setCardReassignResults([])
                      }, SEARCH_DELAY)
                    }}
                    placeholder="Buscar morador…"
                    className="w-full text-xs border border-gray-300 rounded-lg px-2 py-1 focus:outline-none focus:ring-1 focus:ring-[#26619c]"
                  />
                  <button onClick={() => { setCardReassignPkgId(null); setCardReassignSearch(''); setCardReassignResults([]); setCardReassignRect(null) }} className="absolute right-1 top-1 text-gray-400 text-xs">✕</button>
                </div>
              ) : (
                <button onClick={() => { setCardReassignPkgId(pkg.id); setCardReassignSearch('') }} className="text-[10px] text-gray-400 hover:text-[#26619c] underline">Trocar morador</button>
              )}
            </div>
          )}
        </div>
        <div className="flex flex-col items-end gap-1.5 shrink-0">
          <div className="flex items-center gap-1.5">
            {pkg.photo_urls && pkg.photo_urls.length > 0 && (
              <button onClick={e => { e.stopPropagation(); setPhotoPreviewUrls((pkg.photo_urls ?? []).filter((p: any) => !p.url.startsWith('blob:'))) }}
                className="text-gray-400 hover:text-[#26619c] transition" title="Ver fotos">
                <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
              </button>
            )}
            <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${STATUS_COLORS[pkg.status]}`}>{STATUS_LABELS[pkg.status]}</span>
          </div>
          {(pkg.status === 'received' || pkg.status === 'notified') && pkg.resident_phone && (
            <div className="relative" onClick={e => e.stopPropagation()}>
              <button
                onClick={() => setWaDropdownPkgId(waDropdownPkgId === pkg.id ? null : pkg.id)}
                className="flex items-center justify-center w-7 h-7 rounded-full bg-green-100 hover:bg-green-200 transition"
                title="WhatsApp"
              >
                <svg viewBox="0 0 24 24" className="w-4 h-4 fill-green-600">
                  <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z"/>
                </svg>
              </button>
              {waDropdownPkgId === pkg.id && (
                <div className="absolute right-0 top-8 z-50 bg-white rounded-xl shadow-xl border border-gray-100 min-w-[210px] py-1 overflow-hidden">
                  <a
                    href={`https://wa.me/55${pkg.resident_phone.replace(/\D/g, '')}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2.5 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition"
                    onClick={() => setWaDropdownPkgId(null)}
                  >
                    <span className="text-base">💬</span> Falar com morador
                  </a>
                  <div className="h-px bg-gray-100 mx-3" />
                  <a
                    href={`https://wa.me/55${pkg.resident_phone.replace(/\D/g, '')}?text=${encodeURIComponent(buildWaNotification(pkg))}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2.5 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition"
                    onClick={() => setWaDropdownPkgId(null)}
                  >
                    <span className="text-base">📦</span> Notificar sobre encomendas
                  </a>
                </div>
              )}
            </div>
          )}
          {(pkg.status === 'received' || pkg.status === 'notified' || pkg.status === 'reversed') && (
            <button onClick={e => { e.stopPropagation(); setDeliveryTarget(pkg); setRecipientName(pkg.resident_name ?? ''); setDeliveryPersonName(fullName ?? '') }}
              className="text-xs font-medium text-[#26619c] hover:bg-[#26619c]/10 px-2 py-1 rounded-lg transition">
              Entregar
            </button>
          )}
        </div>
      </div>
    </div>
  )

  return (
    <div className="flex flex-col gap-5 p-4 sm:p-6 max-w-screen-xl mx-auto w-full">
      {/* Bulk receive draft alert */}
      {bulkRxQueue.length > 0 && !showBulkReceive && (
        <div className="flex items-center justify-between gap-3 bg-amber-50 border border-amber-300 rounded-xl px-4 py-3">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-amber-600 text-lg">⚠️</span>
            <span className="text-sm font-medium text-amber-800 truncate">
              Recebimento múltiplo em andamento — {bulkRxQueue.length} encomenda(s) na fila
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button onClick={() => { setShowBulkReceive(true); setBulkRxStep('add') }}
              className="text-xs font-semibold text-white bg-amber-500 hover:bg-amber-600 px-3 py-1.5 rounded-lg transition">
              Retomar
            </button>
            <button onClick={() => setBulkRxQueue([])}
              className="text-xs font-semibold text-amber-700 hover:text-amber-900 px-2 py-1.5 transition">
              Descartar
            </button>
          </div>
        </div>
      )}
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2 min-w-0">
          <PackageIcon className="w-5 h-5 text-[#26619c] shrink-0" />
          <span className="truncate">Encomendas</span>
          {pendingCount > 0 && (
            <span className="shrink-0 bg-[#26619c] text-white text-xs font-bold px-2 py-0.5 rounded-full">{pendingCount}</span>
          )}
        </h1>
        <div className="flex items-center gap-1.5 shrink-0">
          {/* View toggle — icons only on mobile */}
          <div className="flex border border-gray-200 rounded-lg overflow-hidden">
            <button onClick={() => setViewMode('list')}
              className={`flex items-center justify-center p-1.5 transition ${viewMode === 'list' ? 'bg-[#26619c] text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
              title="Lista"><List className="w-4 h-4" /></button>
            <button onClick={() => setViewMode('kanban')}
              className={`flex items-center justify-center p-1.5 transition ${viewMode === 'kanban' ? 'bg-[#26619c] text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
              title="Kanban"><Columns className="w-4 h-4" /></button>
            <button onClick={() => setViewMode('esteira')}
              className={`flex items-center justify-center p-1.5 transition ${viewMode === 'esteira' ? 'bg-[#26619c] text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
              title="Esteira"><Workflow className="w-4 h-4" /></button>
          </div>
          <button onClick={() => { setShowReport(true); loadReport() }}
            className="flex items-center gap-1.5 border border-gray-200 text-gray-600 px-3 py-2 rounded-xl text-sm font-medium hover:bg-gray-50 transition"
            title="Relatório">
            <FileText className="w-4 h-4" /><span className="hidden sm:inline">Relatório</span>
          </button>
          <button onClick={() => { setShowAddrReport(true); loadAddrReport() }}
            className="flex items-center gap-1.5 border border-gray-200 text-gray-600 px-3 py-2 rounded-xl text-sm font-medium hover:bg-gray-50 transition"
            title="Por Rua/CEP">
            <MapPin className="w-4 h-4" /><span className="hidden sm:inline">Por Rua</span>
          </button>
          <button
            onClick={() => { setBulkDeliveryPersonName(fullName ?? ''); setShowBulkDeliver(true); setBulkStep('select') }}
            className="flex items-center gap-1.5 border border-[#26619c] text-[#26619c] px-3 py-2 rounded-xl text-sm font-medium hover:bg-[#26619c]/5 transition"
            title="Entrega Múltipla"
          >
            <Layers className="w-4 h-4" /><span className="hidden sm:inline">Múltipla</span>
          </button>
          <button
            onClick={() => setShowReceiveMode(true)}
            className="flex items-center gap-1.5 bg-[#26619c] hover:bg-[#1a4f87] text-white px-3 py-2 rounded-xl text-sm font-medium transition"
          >
            <Plus className="w-4 h-4" /><span className="hidden sm:inline">Receber</span>
          </button>
        </div>
      </div>

      {/* Page tabs */}
      <div className="flex gap-0 border-b border-gray-200 -mx-4 sm:mx-0 px-4 sm:px-0 overflow-x-auto scrollbar-none">
        {([
          { key: 'encomendas', label: 'Encomendas', badge: pendingCount > 0 ? pendingCount : undefined },
          { key: 'recebimentos', label: 'Recebimentos', badge: bulkRxQueue.length > 0 ? '!' : undefined },
          { key: 'cadastros', label: 'Transportadoras' },
        ] as { key: 'encomendas' | 'recebimentos' | 'cadastros'; label: string; badge?: number | string }[]).map(t => (
          <button key={t.key} onClick={() => setPageTab(t.key)}
            className={`whitespace-nowrap flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition -mb-px ${pageTab === t.key ? 'border-[#26619c] text-[#26619c]' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
            {t.label}
            {t.badge !== undefined && (
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${pageTab === t.key ? 'bg-[#26619c] text-white' : t.key === 'recebimentos' ? 'bg-amber-500 text-white' : 'bg-gray-200 text-gray-600'}`}>{t.badge}</span>
            )}
          </button>
        ))}
      </div>

      {pageTab === 'cadastros' && (
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
      )}

      {/* Filter bar */}
      {pageTab === 'encomendas' && <div className="flex flex-col gap-2">
        {/* Search row + filter toggle */}
        <div className="flex gap-2 items-center">
          <div className="relative flex-1 min-w-0">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
            <DebouncedInput
              ref={filterInputRef}
              onSearch={v => startTransition(() => setFilterQ(v))}
              delay={300}
              placeholder="Buscar nome, rastreio, unidade ou CPF…"
              className="w-full pl-9 pr-4 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#26619c]/30 focus:border-[#26619c] bg-white"
            />
          </div>
          <button onClick={() => setShowFilters(v => !v)}
            className={`relative flex items-center gap-1.5 px-3 py-2 rounded-xl border text-sm font-medium transition shrink-0 ${showFilters || activeFilterCount > 0 ? 'border-[#26619c] text-[#26619c] bg-[#26619c]/5' : 'border-gray-200 text-gray-600 bg-white hover:bg-gray-50'}`}>
            <Layers className="w-4 h-4" />
            <span className="hidden sm:inline">Filtros</span>
            {activeFilterCount > 0 && (
              <span className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-[#26619c] text-white text-[10px] font-bold rounded-full flex items-center justify-center">{activeFilterCount}</span>
            )}
          </button>
          {activeFilterCount > 0 && (
            <button onClick={clearFilters} title="Limpar filtros" className="text-gray-400 hover:text-red-500 transition shrink-0">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Expanded filters */}
        {showFilters && (
          <div className="bg-white border border-gray-200 rounded-xl p-3 flex flex-col gap-3 shadow-sm">
            {/* Date range */}
            <div>
              <p className="text-xs font-semibold text-gray-500 mb-1.5">Período de recebimento</p>
              <div className="flex gap-2 items-center">
                <input type="date" value={filterDateFrom} onChange={e => setFilterDateFrom(e.target.value)}
                  className="flex-1 min-w-0 border border-gray-200 rounded-lg px-2 py-1.5 text-xs text-gray-600 focus:outline-none focus:ring-2 focus:ring-[#26619c]/30 focus:border-[#26619c]" />
                <span className="text-gray-400 text-xs shrink-0">—</span>
                <input type="date" value={filterDateTo} onChange={e => setFilterDateTo(e.target.value)}
                  className="flex-1 min-w-0 border border-gray-200 rounded-lg px-2 py-1.5 text-xs text-gray-600 focus:outline-none focus:ring-2 focus:ring-[#26619c]/30 focus:border-[#26619c]" />
              </div>
            </div>

            {/* Status */}
            <div>
              <p className="text-xs font-semibold text-gray-500 mb-1.5">Status</p>
              <div className="flex gap-1.5 flex-wrap">
                {(['', 'received', 'notified', 'delivered', 'returned', 'reversed'] as const).map(s => {
                  const cnt = s === '' ? (statusCounts.total ?? 0) : (statusCounts[s] ?? 0)
                  return (
                    <button key={s} onClick={() => setFilterStatus(s)}
                      className={`flex items-center gap-1 whitespace-nowrap px-2.5 py-1 rounded-full text-xs font-medium transition ${filterStatus === s ? 'bg-[#26619c] text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                      {s === '' ? 'Todos' : STATUS_LABELS[s as keyof typeof STATUS_LABELS]}
                      {cnt > 0 && <span className={`text-[10px] font-bold px-1 py-0.5 rounded-full ${filterStatus === s ? 'bg-white/25' : 'bg-gray-200 text-gray-500'}`}>{cnt}</span>}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Operator multi-select */}
            {opNames.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-gray-500 mb-1.5">Operador responsável</p>
                <div className="flex flex-col gap-1">
                  {opNames.map(name => (
                    <label key={name} className="flex items-center gap-2 cursor-pointer group/op py-1 px-1 rounded-lg hover:bg-gray-50">
                      <input type="checkbox" checked={filterOpSet.has(name)}
                        onChange={() => setFilterOpSet(prev => {
                          const next = new Set(prev)
                          next.has(name) ? next.delete(name) : next.add(name)
                          return next
                        })}
                        className="w-3.5 h-3.5 accent-[#26619c]" />
                      <span className="text-sm text-gray-700 group-hover/op:text-gray-900">{name}</span>
                      <span className="ml-auto text-xs text-gray-400">{packages.filter(p => p.received_by_name === name).length}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Status pills — always visible in list/esteira */}
        {!showFilters && (
          <div className="flex gap-1.5 overflow-x-auto pb-0.5 scrollbar-none">
            {(['', 'received', 'notified', 'delivered', 'returned', 'reversed'] as const).map((s) => {
              const cnt = s === '' ? (statusCounts.total ?? 0) : (statusCounts[s] ?? 0)
              return (
                <button key={s} onClick={() => setFilterStatus(s)}
                  className={`whitespace-nowrap flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium transition ${filterStatus === s ? 'bg-[#26619c] text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                  {s === '' ? 'Todos' : STATUS_LABELS[s as keyof typeof STATUS_LABELS]}
                  {cnt > 0 && <span className={`text-[10px] font-bold px-1 py-0.5 rounded-full ${filterStatus === s ? 'bg-white/25' : 'bg-gray-200 text-gray-500'}`}>{cnt}</span>}
                </button>
              )
            })}
          </div>
        )}

        {/* Active filter chips */}
        {activeFilterCount > 0 && !showFilters && (
          <div className="flex gap-1.5 flex-wrap">
            {filterDateFrom && <span className="inline-flex items-center gap-1 text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full">De: {filterDateFrom} <button onClick={() => setFilterDateFrom('')} className="hover:text-red-500">×</button></span>}
            {filterDateTo && <span className="inline-flex items-center gap-1 text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full">Até: {filterDateTo} <button onClick={() => setFilterDateTo('')} className="hover:text-red-500">×</button></span>}
            {[...filterOpSet].map(op => (
              <span key={op} className="inline-flex items-center gap-1 text-xs bg-purple-50 text-purple-700 px-2 py-0.5 rounded-full">
                {op} <button onClick={() => setFilterOpSet(prev => { const n = new Set(prev); n.delete(op); return n })} className="hover:text-red-500">×</button>
              </span>
            ))}
          </div>
        )}
      </div>}

      {/* List View */}
      {pageTab === 'encomendas' && viewMode === 'list' && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
          {packagesLoading
            ? <div className="flex items-center justify-center gap-2 p-8 text-gray-400 text-sm">
                <svg className="animate-spin w-5 h-5 text-[#26619c]" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                </svg>
                Carregando encomendas…
              </div>
            : displayPackages.length === 0
              ? <div className="p-8 text-center text-gray-400 text-sm">Nenhuma encomenda aguardando.</div>
              : <ul className="divide-y divide-gray-100">
                  {displayPackages.map((pkg) => (
                    <li key={pkg.id}><PackageCard pkg={pkg} /></li>
                  ))}
                </ul>
          }
        </div>
      )}

      {/* Kanban View */}
      {pageTab === 'encomendas' && viewMode === 'kanban' && (
        <div className="flex gap-3 overflow-x-auto pb-4 -mx-4 px-4">
          {KANBAN_STATUSES.map(status => {
            const col = displayPackages.filter(p => p.status === status)
            return (
              <div key={status} className="shrink-0 w-64 sm:w-72 flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <span className={`text-xs font-semibold px-2 py-1 rounded-full ${STATUS_COLORS[status]}`}>
                    {STATUS_LABELS[status]}
                  </span>
                  <span className="text-xs text-gray-400 font-medium">{col.length}</span>
                </div>
                <div className="flex flex-col gap-2 min-h-[120px]">
                  {col.length === 0 ? (
                    <div className="bg-gray-50 rounded-xl p-4 text-center text-xs text-gray-400">Nenhuma</div>
                  ) : (
                    col.map(pkg => (
                      <div
                        key={pkg.id}
                        className="bg-white border border-gray-200 rounded-xl px-3 py-2.5 shadow-sm cursor-pointer hover:border-[#26619c]/40 transition"
                        onClick={() => setDetailPkg(pkg)}
                      >
                        <p className="text-sm font-medium text-gray-800 truncate">{pkg.resident_name ?? '—'}</p>
                        {pkg.carrier_name && <p className="text-xs text-gray-400">{pkg.carrier_name}</p>}
                        <p className="text-xs text-gray-400 mt-1">
                          {new Date(pkg.received_at).toLocaleDateString('pt-BR')}
                        </p>
                        {pkg.has_delivery_fee && (
                          <p className="text-xs text-amber-600 font-medium mt-0.5">
                            Taxa R$ {parseFloat(pkg.delivery_fee_amount ?? '2.50').toFixed(2)}
                          </p>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Esteira View */}
      {pageTab === 'encomendas' && viewMode === 'esteira' && (
        <div className="flex flex-col gap-3">
          {packages.length === 0 ? (
            <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-400 text-sm">Nenhuma encomenda encontrada.</div>
          ) : (
            <>
            {packages.map(pkg => (
              <div
                key={pkg.id}
                className="bg-white rounded-xl border border-gray-200 shadow-sm px-4 py-3 cursor-pointer hover:border-[#26619c]/40 transition"
                onClick={() => setDetailPkg(pkg)}
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-gray-800 truncate">
                      {pkg.resident_name ?? '—'}
                    </p>
                    <p className="text-xs text-gray-400">
                      {pkg.carrier_name ?? 'Sem transportadora'}{pkg.tracking_code ? ` · ${pkg.tracking_code}` : ''}
                      {' · '}
                      {new Date(pkg.received_at).toLocaleDateString('pt-BR')}
                    </p>
                  </div>
                  {pkg.has_delivery_fee && (
                    <span className="text-xs text-amber-600 font-medium shrink-0 ml-2">Taxa R$ {parseFloat(pkg.delivery_fee_amount ?? '2.50').toFixed(2)}</span>
                  )}
                </div>
                <EsteiraStepper status={pkg.status} />
              </div>
            ))}
            {hasMorePkgs && !filterQ.trim() && (
              <div className="flex justify-center py-4">
                <button onClick={loadMorePkgs}
                  className="text-sm text-[#26619c] border border-[#26619c] px-5 py-2 rounded-xl hover:bg-[#26619c]/5 transition">
                  Carregar mais
                </button>
              </div>
            )}
            </>
          )}
        </div>
      )}

      {/* ─── Buscar entregues ─────────────────────────────────────────────────── */}
      {pageTab === 'encomendas' && (
        <div className="border border-gray-200 rounded-xl bg-gray-50 overflow-hidden">
          <button
            onClick={() => { setShowDeliveredSearch(v => !v); if (!showDeliveredSearch) setTimeout(() => deliveredInputRef.current?.focus(), 100) }}
            className="w-full flex items-center justify-between px-4 py-3 text-sm text-gray-500 hover:bg-gray-100 transition"
          >
            <span className="flex items-center gap-2 font-medium">
              <Search className="w-4 h-4" />
              Buscar encomenda entregue / devolvida
            </span>
            <span className="text-xs text-gray-400">{showDeliveredSearch ? '▲' : '▼'}</span>
          </button>
          {showDeliveredSearch && (
            <div className="px-4 pb-4 flex flex-col gap-2 border-t border-gray-200 pt-3 bg-white">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                <DebouncedInput
                  ref={deliveredInputRef}
                  onSearch={searchDelivered}
                  delay={1200}
                  placeholder="Nome, rastreio, unidade… (mín. 3 caracteres)"
                  className="w-full pl-9 pr-4 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#26619c]/30 focus:border-[#26619c] bg-white"
                />
              </div>
              {deliveredLoading && <p className="text-xs text-gray-400 text-center py-2">Buscando…</p>}
              {!deliveredLoading && deliveredQ.length >= 3 && deliveredPackages.length === 0 && (
                <p className="text-xs text-gray-400 text-center py-2">Nenhuma encomenda encontrada.</p>
              )}
              {deliveredPackages.length > 0 && (
                <ul className="divide-y divide-gray-100 border border-gray-200 rounded-xl overflow-hidden bg-white">
                  {deliveredPackages.map(pkg => (
                    <li key={pkg.id}>
                      <button className="w-full text-left px-4 py-3 hover:bg-gray-50 transition" onClick={() => setDetailPkg(pkg)}>
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-gray-800 truncate">{pkg.resident_name ?? '—'}</p>
                            <p className="text-xs text-gray-400">{pkg.carrier_name ?? ''}{pkg.tracking_code ? ` · ${pkg.tracking_code}` : ''}</p>
                          </div>
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium shrink-0 ${STATUS_COLORS[pkg.status] ?? 'bg-gray-100 text-gray-600'}`}>
                            {STATUS_LABELS[pkg.status] ?? pkg.status}
                          </span>
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}

      {/* ─── Recebimentos tab ──────────────────────────────────────────────────── */}
      {pageTab === 'recebimentos' && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="text-xs text-gray-400">Histórico de recebimentos — unitários e lotes múltiplos</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button onClick={() => { setShowBulkReceive(true); setBulkRxStep('add') }}
                className="flex items-center gap-1.5 text-xs font-semibold text-white bg-[#26619c] hover:bg-[#1a4f87] px-3 py-1.5 rounded-xl transition">
                <Plus className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Novo lote</span>
                <span className="sm:hidden">Lote</span>
              </button>
              <button onClick={loadReceiveHistory} disabled={rxHistoryLoading}
                className="text-xs text-gray-500 hover:text-[#26619c] border border-gray-200 hover:border-[#26619c]/40 px-3 py-1.5 rounded-xl transition disabled:opacity-40">
                {rxHistoryLoading ? '…' : '↺'}
              </button>
            </div>
          </div>

          {/* Draft in-progress from localStorage */}
          {bulkRxQueue.length > 0 && (
            <div className="bg-white rounded-xl border border-amber-300 shadow-sm overflow-hidden">
              <div className="flex items-center gap-3 px-4 py-3">
                <div className="flex flex-col flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="inline-flex items-center gap-1 text-xs font-semibold bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">Em Andamento</span>
                    <span className="text-xs font-semibold text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">Múltiplo</span>
                    <span className="text-xs text-gray-500">{bulkRxQueue.length} encomenda(s)</span>
                  </div>
                  <p className="text-xs text-gray-400 mt-0.5">Rascunho local — não confirmado ainda</p>
                </div>
                <button onClick={() => { setShowBulkReceive(true); setBulkRxStep('add') }}
                  className="shrink-0 text-xs font-semibold text-white bg-amber-500 hover:bg-amber-600 px-3 py-1.5 rounded-lg transition">
                  Retomar
                </button>
              </div>
              <div className="border-t border-gray-100 divide-y divide-gray-50">
                {bulkRxQueue.map(item => (
                  <div key={item.id} className="flex items-center gap-3 px-4 py-2.5">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-gray-700 truncate">{item.resident_name}</p>
                      <p className="text-xs text-gray-400">
                        {item.tracking_code ? item.tracking_code : ''}
                        {item.carrier_name ? ` · ${item.carrier_name}` : ''}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* History from backend */}
          {rxHistoryLoading && receiveHistory.length === 0 ? (
            <div className="bg-white rounded-xl border border-gray-200 p-6 text-center text-sm text-gray-400">Carregando histórico…</div>
          ) : receiveHistory.length === 0 && bulkRxQueue.length === 0 ? (
            <div className="bg-white rounded-xl border border-gray-200 p-6 text-center text-sm text-gray-400">Nenhum recebimento registrado ainda.</div>
          ) : (
            <div className="flex flex-col gap-2">
              {receiveHistory.map(entry => {
                const isExpanded = rxHistoryExpanded.has(entry.id)
                const statusBadge =
                  entry.status === 'reversed'
                    ? <span className="inline-flex items-center text-xs font-semibold bg-red-100 text-red-700 px-2 py-0.5 rounded-full">Estornado</span>
                    : <span className="inline-flex items-center text-xs font-semibold bg-green-100 text-green-700 px-2 py-0.5 rounded-full">Confirmado</span>
                const dt = new Date(entry.received_at)
                const dateStr = dt.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
                const timeStr = dt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
                return (
                  <div key={entry.id} className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                    <button
                      className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-50 transition"
                      onClick={() => setRxHistoryExpanded(prev => {
                        const next = new Set(prev)
                        next.has(entry.id) ? next.delete(entry.id) : next.add(entry.id)
                        return next
                      })}>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-0.5">
                          {statusBadge}
                          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${entry.is_bulk ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>
                            {entry.is_bulk ? 'Múltiplo' : 'Unitário'}
                          </span>
                          <span className="text-xs text-gray-500">{entry.count} encomenda{entry.count !== 1 ? 's' : ''}</span>
                        </div>
                        <p className="text-xs text-gray-500">
                          {entry.received_by_name} · {dateStr} às {timeStr}
                        </p>
                      </div>
                      <ChevronDown className={`w-4 h-4 text-gray-400 shrink-0 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                    </button>
                    {isExpanded && (
                      <div className="border-t border-gray-100 divide-y divide-gray-50">
                        {entry.items.map((item, i) => (
                          <div key={i} className="flex items-center gap-3 px-4 py-2.5">
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-medium text-gray-700 truncate">{item.resident_name || '—'}</p>
                              <p className="text-xs text-gray-400">
                                {item.tracking_code ? item.tracking_code : ''}
                                {item.carrier_name ? ` · ${item.carrier_name}` : ''}
                              </p>
                            </div>
                            {entry.is_bulk && item.status === 'reversed' && (
                              <span className="text-xs text-red-500 font-medium shrink-0">Estornado</span>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}


      {/* Receive Modal */}
      {showReceive && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-black/40">
          <div className="flex min-h-full items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="w-full max-w-lg bg-white rounded-t-2xl sm:rounded-2xl shadow-xl p-6">
            {step === 'recipient' && (
              <>
                <h3 className="font-semibold text-gray-800 mb-1">Nova Encomenda — Destinatário</h3>
                <p className="text-xs text-gray-400 mb-4">Bipe o código de barras ou busque o morador pelo nome, CPF ou CEP.</p>

                <div className="mb-4 flex gap-2">
                  <div className="relative flex-1">
                    <Barcode className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <input
                      ref={barcodeRef}
                      value={tracking}
                      onChange={e => setTracking(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter' && tracking) {
                          e.preventDefault()
                          selectedRecipient ? setStep('details') : document.getElementById('recipient-search')?.focus()
                        }
                      }}
                      className={`${inputCls} pl-9`}
                      placeholder="Bipe ou escaneie o código…"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => isMobile ? setScanChoice('single') : setShowScanner(true)}
                    title="Escanear com câmera"
                    className="flex items-center justify-center gap-1.5 bg-[#26619c] hover:bg-[#1a4f87] text-white px-3 rounded-lg text-sm font-medium transition shrink-0"
                  >
                    <Camera className="w-4 h-4" />
                    <span className="text-xs">Câmera</span>
                  </button>
                </div>

                <div className="relative mb-2">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <DebouncedInput
                    ref={recipientInputRef}
                    id="recipient-search"
                    onSearch={v => { setRecipientSearch(v); startTransition(() => { setSearchEmpty(false); setShowGuestForm(false) }); searchResidents(v) }}
                    delay={SEARCH_DELAY}
                    className={`${inputCls} pl-9`}
                    placeholder="Buscar por nome, telefone, CPF ou CEP…"
                  />
                </div>

                {searchResults.length > 0 && (() => {
                  const firstName = (n: string) => n.trim().split(/\s+/)[0].toLowerCase()
                  const names = searchResults.map(r => firstName(r.full_name))
                  const hasDuplicate = names.some((w, i) => names.indexOf(w) !== i)
                  return (
                    <>
                      {hasDuplicate && (
                        <div className="flex items-start gap-2 bg-amber-50 border border-amber-300 rounded-lg px-3 py-2 mb-2 text-xs text-amber-800">
                          <span className="text-base leading-none mt-0.5">⚠️</span>
                          <p><strong>Possível duplicata:</strong> {searchResults.length} cadastros com nomes similares encontrados. Verifique se é a mesma pessoa e use a tela de Moradores para mesclar se necessário.</p>
                        </div>
                      )}
                      <ul className="border border-gray-200 rounded-lg mb-3 divide-y divide-gray-100 max-h-52 overflow-y-auto">
                        {searchResults.map(r => {
                      const isGuest = r.type === 'guest'
                      return (
                        <li key={r.id}>
                          <button
                            className="w-full text-left px-3 py-2.5 hover:bg-blue-50 flex items-center gap-2"
                            onClick={() => {
                              setSelectedRecipient(r)
                              setSearchResults([])
                              setRecipientSearch(r.full_name)
                              if (!r.address_cep) return  // stays on recipient step to fill CEP
                              setStep('details')
                            }}
                          >
                            <User className={`w-4 h-4 shrink-0 ${isGuest ? 'text-orange-500' : 'text-[#26619c]'}`} />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <p className="text-sm font-medium text-gray-800 truncate">{r.full_name}</p>
                                {isGuest && (
                                  <span className="shrink-0 text-[10px] bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded-full font-medium">Não assoc. · R$2,50</span>
                                )}
                              </div>
                              <p className="text-xs text-gray-400 truncate">
                                {r.cpf ? `CPF: ${maskCpf(r.cpf)}` : ''}
                                {r.address_cep ? ` · CEP: ${r.address_cep}` : ''}
                                {r.phone_primary ? ` · ${r.phone_primary}` : ''}
                              </p>
                            </div>
                          </button>
                        </li>
                      )
                    })}
                      </ul>
                    </>
                  )
                })()}

                {selectedRecipient && (
                  <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-lg px-3 py-2 mb-3">
                    <User className="w-4 h-4 text-green-600" />
                    <span className="text-sm font-medium text-green-800">{selectedRecipient.full_name}</span>
                    <button
                      className="ml-auto text-xs text-gray-400 hover:text-red-500"
                      onClick={() => { setSelectedRecipient(null); setRecipientSearch('') }}
                    >✕</button>
                  </div>
                )}

                {/* Gate trigger — "Não encontrei" */}
                {!selectedRecipient && !showCepGate && !showGuestForm && (
                  <button
                    onClick={() => { resetCepGate(); setShowCepGate(true); setShowGuestForm(false); setDuplicateMatches([]) }}
                    className="w-full flex items-center gap-2 border border-dashed border-gray-300 rounded-lg px-3 py-2.5 text-sm text-gray-500 hover:border-[#26619c] hover:text-[#26619c] transition mb-3"
                  >
                    <UserX className="w-4 h-4" /> Não encontrei o morador
                  </button>
                )}

                {/* CEP Gate */}
                {showCepGate && !showGuestForm && (
                  <div className="border border-blue-200 bg-blue-50 rounded-xl p-4 mb-4 flex flex-col gap-3">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-semibold text-blue-800 flex items-center gap-1.5">
                        <MapPin className="w-3.5 h-3.5" /> Informe o CEP da etiqueta da encomenda
                      </p>
                      <button type="button" onClick={resetCepGate} className="text-xs text-gray-400 hover:text-gray-600">← Voltar</button>
                    </div>
                    <input
                      value={cepGateValue}
                      onChange={e => runCepGate(e.target.value)}
                      className={`${inputCls} ${cepGateValue.replace(/\D/g, '').length > 0 && cepGateValue.replace(/\D/g, '').length < 8 ? 'border-red-300' : ''}`}
                      placeholder="CEP (apenas números)"
                      maxLength={9}
                      inputMode="numeric"
                      autoFocus
                    />
                    {cepGateLoading && (
                      <p className="text-xs text-blue-600 flex items-center gap-1.5">
                        <span className="inline-block w-3 h-3 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
                        Buscando moradores na mesma rua…
                      </p>
                    )}
                    {cepGateDone && cepGateResidents.length > 0 && (
                      <div className="border border-amber-300 bg-amber-50 rounded-lg p-2">
                        <p className="text-xs font-semibold text-amber-800 mb-1.5 flex items-center gap-1">
                          <AlertTriangle className="w-3 h-3 shrink-0" /> Possíveis cadastros na mesma rua — verifique antes de criar:
                        </p>
                        <ul className="flex flex-col gap-0.5">
                          {cepGateResidents.map(r => (
                            <li key={r.id}>
                              <button type="button"
                                onClick={() => { setSelectedRecipient(r); resetCepGate(); setShowGuestForm(false) }}
                                className="w-full text-left px-2 py-1.5 rounded-md hover:bg-amber-100 flex items-center gap-2 transition">
                                <User className="w-3 h-3 text-amber-600 shrink-0" />
                                <span className="text-xs font-medium text-amber-900">{r.full_name}</span>
                                <span className="text-[10px] text-amber-600 ml-auto">{r.type === 'member' ? 'Associado' : r.type === 'dependent' ? 'Dependente' : 'Visitante'}</span>
                              </button>
                            </li>
                          ))}
                        </ul>
                        <p className="text-[10px] text-amber-600 mt-1.5">Não é nenhum desses? Continue para criar novo cadastro.</p>
                      </div>
                    )}
                    {cepGateDone && (
                      <button
                        onClick={() => { setShowGuestForm(true); setShowCepGate(false); setGuest(g => ({ ...g, full_name: recipientSearch, address_cep: cepGateValue.replace(/\D/g, ''), address_street: cepGateStreet })) }}
                        className="w-full flex items-center justify-center gap-2 border border-dashed border-orange-300 bg-orange-50 rounded-lg px-3 py-2.5 text-sm text-orange-600 hover:border-orange-400 transition"
                      >
                        <UserX className="w-4 h-4" /> Cadastrar novo morador
                      </button>
                    )}
                  </div>
                )}

                {showGuestForm && (
                  <div className="border border-gray-200 bg-gray-50 rounded-xl p-4 mb-4 flex flex-col gap-3">
                    {/* Type selector */}
                    <div className="grid grid-cols-3 gap-1.5">
                      {([['guest','Visitante','border-orange-300 bg-orange-50 text-orange-700'],['member','Associado','border-green-300 bg-green-50 text-green-700'],['dependent','Dependente','border-blue-300 bg-blue-50 text-blue-700']] as const).map(([t, label, cls]) => (
                        <button key={t} type="button" onClick={() => setNewResType(t)}
                          className={`py-1.5 rounded-lg text-xs font-semibold border transition ${newResType === t ? cls : 'border-gray-200 bg-white text-gray-500'}`}>
                          {label}
                        </button>
                      ))}
                    </div>
                    {newResType === 'guest' && (
                      <p className="text-xs text-orange-700 bg-orange-50 border border-orange-200 rounded-lg px-2 py-1.5 flex items-center gap-1">
                        <AlertTriangle className="w-3 h-3 shrink-0" /> Taxa de R$ 2,50 aplicada na entrega
                      </p>
                    )}
                    <div>
                      <input value={guest.full_name}
                        onChange={e => { const v = e.target.value; setGuest(g => ({ ...g, full_name: v })); checkDuplicates(v) }}
                        className={inputCls} placeholder="Nome completo *" autoFocus />
                      {duplicateMatches.length > 0 && (
                        <div className="mt-1.5 border border-amber-300 bg-amber-50 rounded-lg p-2">
                          <p className="text-xs font-semibold text-amber-800 mb-1.5 flex items-center gap-1">
                            <AlertTriangle className="w-3 h-3 shrink-0" /> Possível duplicata — selecione se já está cadastrado:
                          </p>
                          <ul className="flex flex-col gap-0.5">
                            {duplicateMatches.map(r => (
                              <li key={r.id}>
                                <button type="button"
                                  onClick={() => { setSelectedRecipient(r); setShowGuestForm(false); setDuplicateMatches([]) }}
                                  className="w-full text-left px-2 py-1.5 rounded-md hover:bg-amber-100 flex items-center gap-2 transition">
                                  <User className="w-3 h-3 text-amber-600 shrink-0" />
                                  <span className="text-xs font-medium text-amber-900">{r.full_name}</span>
                                  <span className="text-[10px] text-amber-600 ml-auto">{r.type === 'member' ? 'Associado' : r.type === 'dependent' ? 'Dependente' : 'Visitante'}</span>
                                </button>
                              </li>
                            ))}
                          </ul>
                          <p className="text-[10px] text-amber-600 mt-1.5">Não é nenhum desses? Continue preenchendo para criar novo cadastro.</p>
                        </div>
                      )}
                    </div>
                    {newResType === 'member' && (
                      <>
                        <input value={newResCpf} onChange={e => { const v = e.target.value; startTransition(() => setNewResCpf(v)) }}
                          className={inputCls} placeholder="CPF (opcional)" inputMode="numeric" />
                        <input value={guest.phone_primary} onChange={e => { const v = e.target.value; startTransition(() => setGuest(g => ({ ...g, phone_primary: v }))) }}
                          className={inputCls} placeholder="Telefone (opcional)" type="tel" inputMode="tel" />
                      </>
                    )}
                    {newResType === 'dependent' && (
                      <div className="flex flex-col gap-1">
                        <label className="text-xs text-gray-600">Responsável (associado titular) *</label>
                        <input value={newResResponsibleSearch}
                          onChange={e => { const v = e.target.value; setNewResResponsibleSearch(v); setNewResResponsible(null); if (responsibleTimer.current) clearTimeout(responsibleTimer.current); responsibleTimer.current = setTimeout(() => searchResponsible(v), SEARCH_DELAY) }}
                          className={inputCls} placeholder="Buscar associado…" />
                        {newResResponsibleResults.length > 0 && (
                          <ul className="border border-gray-200 rounded-lg divide-y divide-gray-100 max-h-32 overflow-y-auto">
                            {newResResponsibleResults.map(r => (
                              <li key={r.id}>
                                <button type="button" onClick={() => { setNewResResponsible(r); setNewResResponsibleSearch(r.full_name); setNewResResponsibleResults([]) }}
                                  className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50">{r.full_name}</button>
                              </li>
                            ))}
                          </ul>
                        )}
                        {newResResponsible && <p className="text-xs text-green-700">✓ {newResResponsible.full_name}</p>}
                      </div>
                    )}
                    {newResType === 'guest' && (
                      <>
                        <input value={newResCpf} onChange={e => { const v = e.target.value; startTransition(() => setNewResCpf(v)) }}
                          className={inputCls} placeholder="CPF *" inputMode="numeric" />
                        <input value={guest.phone_primary} onChange={e => { const v = e.target.value; startTransition(() => setGuest(g => ({ ...g, phone_primary: v }))) }}
                          className={inputCls} placeholder="Telefone (opcional)" type="tel" inputMode="tel" />
                        <div className="grid grid-cols-3 gap-2">
                          <div>
                            <input value={guest.address_cep}
                              onChange={e => { const v = e.target.value; startTransition(() => setGuest(g => ({ ...g, address_cep: v }))); lookupCep(v) }}
                              className={inputCls} placeholder="CEP" maxLength={9} inputMode="numeric" />
                            {cepLoading && <p className="text-xs text-gray-400 mt-0.5">Buscando…</p>}
                          </div>
                          <input value={guest.address_number} onChange={e => { const v = e.target.value; startTransition(() => setGuest(g => ({ ...g, address_number: v }))) }} className={inputCls} placeholder="Número" inputMode="numeric" />
                          <input value={guest.address_complement} onChange={e => { const v = e.target.value; startTransition(() => setGuest(g => ({ ...g, address_complement: v }))) }} className={inputCls} placeholder="Compl." />
                        </div>
                        <input value={guest.address_street} onChange={e => { const v = e.target.value; startTransition(() => setGuest(g => ({ ...g, address_street: v }))) }} className={inputCls} placeholder="Rua (opcional)" />
                        <div className="grid grid-cols-2 gap-2">
                          <input value={guest.address_district} onChange={e => { const v = e.target.value; startTransition(() => setGuest(g => ({ ...g, address_district: v }))) }} className={inputCls} placeholder="Bairro" />
                          <input value={guest.address_city} onChange={e => { const v = e.target.value; startTransition(() => setGuest(g => ({ ...g, address_city: v }))) }} className={inputCls} placeholder="Cidade" />
                        </div>
                      </>
                    )}
                    <button onClick={createGuest} disabled={loading}
                      className={`w-full text-white py-2 rounded-lg text-sm font-medium transition disabled:opacity-50 ${newResType === 'guest' ? 'bg-orange-500 hover:bg-orange-600' : 'bg-[#26619c] hover:bg-[#1a4f87]'}`}>
                      {loading ? 'Salvando…' : newResType === 'guest' ? 'Salvar Visitante' : newResType === 'member' ? 'Salvar Associado' : 'Salvar Dependente'}
                    </button>
                  </div>
                )}

                {/* Missing CEP prompt */}
                {selectedRecipient && !selectedRecipient.address_cep && !showGuestForm && (
                  <div className="border border-amber-300 bg-amber-50 rounded-xl p-3 flex flex-col gap-2 mb-2">
                    <p className="text-xs font-semibold text-amber-800">Endereço incompleto — informe o CEP para continuar</p>
                    <div className="flex gap-2">
                      <div className="flex-1">
                        <input value={missingCepCep}
                          onChange={e => { setMissingCepCep(e.target.value); lookupMissingCep(e.target.value) }}
                          className={inputCls} placeholder={missingCepLoading ? 'Buscando…' : 'CEP *'} maxLength={9} />
                      </div>
                      <div className="w-24">
                        <input value={missingCepNumber} onChange={e => setMissingCepNumber(e.target.value)}
                          className={inputCls} placeholder="Nº *" />
                      </div>
                    </div>
                    {missingCepStreet && <p className="text-xs text-gray-500">{missingCepStreet}, {missingCepNeighborhood} — {missingCepCity}/{missingCepState}</p>}
                    <button onClick={saveMissingCep} disabled={missingCepSaving || !missingCepCep.trim() || !missingCepNumber.trim()}
                      className="w-full bg-amber-500 hover:bg-amber-600 text-white py-2 rounded-lg text-sm font-semibold disabled:opacity-50 transition">
                      {missingCepSaving ? 'Salvando…' : 'Salvar e continuar →'}
                    </button>
                  </div>
                )}

                <div className="flex gap-3">
                  <button onClick={resetReceive} className="flex-1 border border-gray-300 text-gray-600 py-2.5 rounded-xl text-sm hover:bg-gray-50 transition">Cancelar</button>
                  <button
                    onClick={() => {
                      if (selectedRecipient && !selectedRecipient.address_cep) {
                        toast.error('Informe o CEP do morador antes de continuar.')
                        return
                      }
                      setStep('details')
                    }}
                    disabled={!selectedRecipient}
                    className="flex-1 bg-[#26619c] hover:bg-[#1a4f87] text-white py-2.5 rounded-xl text-sm font-medium transition disabled:opacity-50">
                    Continuar →
                  </button>
                </div>
              </>
            )}

            {step === 'details' && (
              <>
                <div className="flex items-center gap-2 mb-4">
                  <button onClick={() => setStep('recipient')} className="text-xs text-gray-400 hover:text-gray-600">← voltar</button>
                  <h3 className="font-semibold text-gray-800">Detalhes da Encomenda</h3>
                </div>
                {selectedRecipient && (
                  <div className="flex items-center gap-2 bg-blue-50 border border-blue-100 rounded-lg px-3 py-2 mb-2">
                    <User className="w-4 h-4 text-[#26619c]" />
                    <span className="text-sm font-medium text-[#1a3f6f]">{selectedRecipient.full_name}</span>
                    {selectedRecipient.type === 'guest' && (
                      <span className="ml-auto text-xs bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full">Não associado</span>
                    )}
                  </div>
                )}
                {selectedRecipient?.type === 'guest' && (
                  <div className="flex items-start gap-2 bg-amber-50 border border-amber-300 rounded-lg px-3 py-2.5 mb-4">
                    <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-amber-800 font-medium">
                        Não associado — <strong>taxa de R$ 2,50</strong> será cobrada automaticamente na entrega.
                      </p>
                      <button onClick={() => { setRxUpgradeTarget(selectedRecipient); setRxUpgradeCpf(''); setRxUpgradePhone(selectedRecipient?.phone_primary ?? ''); setRxUpgradeCep(selectedRecipient?.address_cep ?? '') }}
                        className="text-xs text-[#26619c] underline mt-0.5">
                        É associado? Atualizar cadastro agora
                      </button>
                    </div>
                  </div>
                )}
                <div className="flex flex-col gap-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-gray-600 mb-1">Transportadora</label>
                      {carrierOpts.length > 0 ? (
                        <select value={carrier} onChange={e => setCarrier(e.target.value)} className={`${inputCls} bg-white`}>
                          <option value="">— Selecione —</option>
                          {carrierOpts.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                        </select>
                      ) : (
                        <input value={carrier} onChange={e => setCarrier(e.target.value)} className={inputCls} placeholder="Correios, iFood… (opcional)" />
                      )}
                    </div>
                    <div>
                      <label className="block text-xs text-gray-600 mb-1">Rastreio</label>
                      <input value={tracking} onChange={e => setTracking(e.target.value)} className={inputCls} placeholder="AA000000000BR (opcional)" />
                    </div>
                  </div>
                  <PhotoCapture
                    label="Foto da Etiqueta *"
                    onCapture={entry => setPhotos(prev => [...prev, entry])}
                    onUpload={file => uploadService.uploadFile(file, 'packages/labels')}
                  />
                  {photos.length > 0 && <p className="text-xs text-green-600">{photos.length} foto(s) adicionada(s)</p>}

                  {/* Entregador section */}
                  <div className="rounded-xl border border-amber-200 overflow-hidden">
                    <div className="bg-amber-500 px-4 py-2.5 flex items-center gap-2">
                      <User className="w-4 h-4 text-white" />
                      <span className="text-sm font-semibold text-white">Entregador (quem trouxe)</span>
                    </div>
                    <div className="p-4 flex flex-col gap-3">
                      <div>
                        <label className="block text-xs text-gray-600 mb-1">Entregador</label>
                        {delivererOpts.length > 0 && !delivererManual ? (
                          <select
                            value={delivererOpts.find(d => d.name === delivererName)?.id ?? ''}
                            onChange={e => {
                              if (e.target.value === '__manual__') { setDelivererManual(true); setDelivererName(''); setDelivererSig('') }
                              else {
                                const d = delivererOpts.find(x => x.id === e.target.value)
                                if (d) { setDelivererName(d.name); setDelivererSig(d.signature_url ?? '') }
                                else { setDelivererName(''); setDelivererSig('') }
                              }
                            }}
                            className={`${inputCls} bg-white`}
                          >
                            <option value="">— Selecione —</option>
                            {delivererOpts.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                            <option value="__manual__">✏️ Digitar manualmente</option>
                          </select>
                        ) : null}
                        {(delivererOpts.length === 0 || delivererManual) && (
                          <div className="flex flex-col gap-1.5">
                            {delivererOpts.length === 0 && !delivererManual && (
                              <p className="text-[11px] text-amber-600 bg-amber-50 px-2 py-1 rounded-lg">
                                Nenhum entregador cadastrado. <a href="/settings" className="underline font-medium">Cadastrar em Configurações</a>
                              </p>
                            )}
                            <div className="flex gap-2">
                              <input
                                value={delivererName}
                                onChange={e => setDelivererName(e.target.value)}
                                className={`${inputCls} flex-1 ${delivererManual ? 'mt-2' : ''}`}
                                placeholder="Nome do entregador"
                              />
                              {delivererManual && (
                                <button onClick={() => { setDelivererManual(false); setDelivererName(''); setDelivererSig('') }}
                                  className="mt-2 text-xs text-gray-400 hover:text-red-500 shrink-0">✕ Cancelar</button>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                      {(!delivererSig) && (
                      <div>
                        <label className="block text-xs text-gray-600 mb-1">Assinatura do entregador</label>
                        <SignaturePad
                          label="Assinatura do entregador"
                          onSave={setDelivererSig}
                          onClear={() => setDelivererSig('')}
                          onUpload={dataUrl => uploadService.uploadBase64(dataUrl, 'packages/signatures')}
                        />
                      </div>
                      )}
                      {delivererSig && (
                        <div>
                          <label className="block text-xs text-gray-600 mb-1">Assinatura</label>
                          <div className="flex items-center gap-3">
                            <img src={delivererSig} alt="assinatura" className="h-16 border border-gray-200 rounded-lg bg-white object-contain flex-1" />
                            <button onClick={() => setDelivererSig('')} className="text-xs text-red-500 hover:underline shrink-0">Refazer</button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  <button onClick={handleReceive} disabled={loading || photos.length === 0}
                    className="w-full bg-[#26619c] hover:bg-[#1a4f87] text-white py-2.5 rounded-xl font-medium transition disabled:opacity-50">
                    {loading ? 'Salvando…' : 'Registrar Encomenda'}
                  </button>
                </div>
              </>
            )}
          </div>
          </div>
        </div>
      )}

      {/* Delivery Modal */}
      {deliverySessionPicker && (
        <div className="fixed inset-0 z-[60] overflow-y-auto bg-black/50">
          <div className="flex min-h-full items-center justify-center p-4">
            <div className="w-full max-w-sm bg-white rounded-2xl shadow-2xl overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
                <h3 className="font-semibold text-gray-900 text-sm">Selecionar Caixa</h3>
                <button onClick={() => { setDeliverySessionPicker(null); setPendingDeliveryPayload(null) }}><X className="w-4 h-4 text-gray-400" /></button>
              </div>
              <div className="p-4">
                <p className="text-xs text-gray-500 mb-3">Selecione o caixa para registrar a taxa de entrega:</p>
                <div className="flex flex-col gap-2">
                  {deliverySessionPicker.map(s => (
                    <button key={s.id} onClick={() => doDeliver(s.id)}
                      className="flex items-center justify-between px-4 py-3 rounded-xl border border-gray-200 hover:border-[#26619c] hover:bg-blue-50 transition text-left">
                      <span className="text-sm font-medium text-gray-800">{s.opened_by_name}</span>
                      <span className="text-xs text-gray-400">Saldo inicial: R$ {parseFloat(s.opening_balance).toFixed(2)}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Bulk deliver — session picker */}
      {bulkSessionPicker && (
        <div className="fixed inset-0 z-[65] overflow-y-auto bg-black/50">
          <div className="flex min-h-full items-center justify-center p-4">
            <div className="w-full max-w-sm bg-white rounded-2xl shadow-2xl overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
                <h3 className="font-semibold text-gray-900 text-sm">Selecionar Caixa</h3>
                <button onClick={() => setBulkSessionPicker(null)}><X className="w-4 h-4 text-gray-400" /></button>
              </div>
              <div className="p-4">
                <p className="text-xs text-gray-500 mb-3">Selecione o caixa para registrar a taxa de entrega:</p>
                <div className="flex flex-col gap-2">
                  {bulkSessionPicker.map(s => (
                    <button key={s.id} onClick={() => doBulkDeliver(s.id)}
                      className="flex items-center justify-between px-4 py-3 rounded-xl border border-gray-200 hover:border-[#26619c] hover:bg-blue-50 transition text-left">
                      <span className="text-sm font-medium text-gray-800">{s.opened_by_name}</span>
                      <span className="text-xs text-gray-400">Saldo inicial: R$ {parseFloat(s.opening_balance).toFixed(2)}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {deliveryTarget && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-black/40">
          <div className="flex min-h-full items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="w-full max-w-lg bg-white rounded-t-2xl sm:rounded-2xl shadow-xl">
            {/* Modal header */}
            <div className="bg-white border-b border-gray-100 px-5 py-4 flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-gray-900">Registrar Entrega</h3>
                <p className="text-xs text-gray-400 mt-0.5">
                  {deliveryTarget.resident_name ?? '—'}
                  {deliveryTarget.tracking_code ? ` · ${deliveryTarget.tracking_code}` : ''}
                </p>
              </div>
              <button onClick={() => { setDeliveryTarget(null); resetDelivery() }}>
                <X className="w-5 h-5 text-gray-400" />
              </button>
            </div>

            {deliveryCheck?.is_delinquent && (
              <div className="mx-5 mt-4 bg-red-50 border border-red-300 rounded-xl px-4 py-3 flex flex-col gap-2">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-xs font-semibold text-red-800">Associado inadimplente</p>
                    <p className="text-xs text-red-600 mt-0.5">
                      {deliveryCheck.overdue_count} mensalidade(s) em atraso. Taxa de entrega será cobrada automaticamente.
                    </p>
                  </div>
                </div>
                <button
                  onClick={openPayMensalidadeQuick}
                  className="w-full bg-green-600 hover:bg-green-700 text-white text-xs font-semibold py-2 rounded-lg transition"
                >
                  Regularizar Mensalidade Agora
                </button>
              </div>
            )}

            {(() => {
              const otherPending = packages.filter(p =>
                p.id !== deliveryTarget!.id &&
                p.resident_id === deliveryTarget!.resident_id &&
                deliveryTarget!.resident_id &&
                (p.status === 'received' || p.status === 'notified')
              )
              if (!otherPending.length) return null
              return (
                <div className="mx-5 mt-4 bg-blue-50 border border-blue-200 rounded-xl px-4 py-3">
                  <p className="text-xs font-semibold text-blue-800 mb-1">Este morador tem mais {otherPending.length} encomenda(s) pendente(s)</p>
                  <p className="text-xs text-gray-500 mb-2">A taxa é por retirada — retirar todas de uma vez é mais vantajoso.</p>
                  <button
                    onClick={() => {
                      const allIds = new Set([deliveryTarget!.id, ...otherPending.map(p => p.id)])
                      setBulkSelected(allIds)
                      setBulkRecipientName(deliveryTarget!.resident_name ?? '')
                      setBulkDeliveryPersonName(fullName ?? '')
                      setDeliveryTarget(null); resetDelivery()
                      setShowBulkDeliver(true); setBulkStep('sign')
                    }}
                    className="w-full bg-blue-600 hover:bg-blue-700 text-white py-2 rounded-lg text-xs font-semibold transition"
                  >
                    Retirar todas ({otherPending.length + 1} encomendas)
                  </button>
                </div>
              )
            })()}

            <div className="p-5 flex flex-col gap-4">
              {/* Pickup type selector */}
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
                <p className="text-xs font-semibold text-amber-900 mb-2 flex items-center gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
                  Quem está retirando?
                </p>
                <div className="flex gap-2">
                  {(['resident', 'dependent', 'other'] as const).map(t => (
                    <button key={t} type="button"
                      onClick={async () => {
                        setPickupType(t)
                        setSelectedDependent(null)
                        setAddingDependent(false)
                        if (t === 'resident') {
                          setRecipientName(deliveryTarget?.resident_name ?? '')
                        } else if (t === 'dependent') {
                          setRecipientName('')
                          if (deliveryTarget?.resident_id) {
                            try {
                              const r = await api.get<{ id: string; full_name: string }[]>('/residents', { params: { responsible_id: deliveryTarget.resident_id } })
                              setDependents(r.data)
                            } catch { setDependents([]) }
                          }
                        } else {
                          setRecipientName('')
                        }
                      }}
                      className={`flex-1 py-2 rounded-lg text-xs font-semibold border transition ${
                        pickupType === t
                          ? t === 'other' ? 'bg-amber-500 text-white border-amber-500' : 'bg-[#26619c] text-white border-[#26619c]'
                          : 'border-gray-300 text-gray-600'
                      }`}>
                      {t === 'resident' ? 'Morador' : t === 'dependent' ? 'Dependente' : 'Outra pessoa'}
                    </button>
                  ))}
                </div>

                {/* Dependent selector */}
                {pickupType === 'dependent' && (
                  <div className="mt-3 flex flex-col gap-2">
                    {dependents.length > 0 ? (
                      <div className="flex flex-col gap-1">
                        {dependents.map(d => (
                          <button key={d.id} type="button"
                            onClick={() => { setSelectedDependent(d); setRecipientName(d.full_name) }}
                            className={`text-left px-3 py-2 rounded-lg border text-xs transition ${selectedDependent?.id === d.id ? 'border-[#26619c] bg-blue-50 font-semibold text-[#26619c]' : 'border-gray-200 text-gray-700 hover:border-gray-300'}`}>
                            {d.full_name}
                          </button>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-gray-500">Nenhum dependente cadastrado.</p>
                    )}
                    {!addingDependent ? (
                      <button type="button" onClick={() => setAddingDependent(true)}
                        className="text-xs text-[#26619c] underline self-start mt-1">
                        + Cadastrar dependente
                      </button>
                    ) : (
                      <div className="flex flex-col gap-2 mt-1 border border-dashed border-gray-300 rounded-xl p-3">
                        <p className="text-xs font-medium text-gray-700">Novo dependente</p>
                        <input value={newDepName} onChange={e => setNewDepName(e.target.value)}
                          className={inputCls} placeholder="Nome completo *" />
                        <input value={newDepPhone} onChange={e => setNewDepPhone(e.target.value)}
                          className={inputCls} placeholder="Telefone" type="tel" />
                        <div className="flex gap-2">
                          <button type="button" onClick={() => { setAddingDependent(false); setNewDepName(''); setNewDepPhone('') }}
                            className="flex-1 border border-gray-300 text-gray-600 py-1.5 rounded-lg text-xs">Cancelar</button>
                          <button type="button" disabled={savingDep || !newDepName.trim()}
                            onClick={async () => {
                              if (!deliveryTarget?.resident_id || !newDepName.trim()) return
                              setSavingDep(true)
                              try {
                                const r = await api.post<{ id: string; full_name: string }>('/residents', {
                                  full_name: newDepName.trim(),
                                  phone_primary: newDepPhone.trim() || undefined,
                                  type: 'member',
                                  responsible_id: deliveryTarget.resident_id,
                                })
                                const dep = { id: r.data.id, full_name: r.data.full_name }
                                setDependents(prev => [...prev, dep])
                                setSelectedDependent(dep)
                                setRecipientName(dep.full_name)
                                setAddingDependent(false); setNewDepName(''); setNewDepPhone('')
                              } catch (e: any) { toast.error(apiErr(e, 'Erro ao cadastrar dependente.')) }
                              finally { setSavingDep(false) }
                            }}
                            className="flex-1 bg-[#26619c] text-white py-1.5 rounded-lg text-xs font-semibold disabled:opacity-50">
                            {savingDep ? '…' : 'Salvar'}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Proof of residence — obrigatório p/ visitante ou terceiro */}
              {(() => {
                return (
                  <div className="bg-gray-50 rounded-xl p-4 border border-gray-200">
                    <p className="text-xs font-semibold text-gray-700 mb-2 flex items-center gap-1.5">
                      <Shield className="w-3.5 h-3.5 text-[#26619c]" />
                      Comprovante de Residência
                      <span className="text-gray-400 font-normal">(opcional)</span>
                    </p>
                    <PhotoCapture
                      label="Foto do comprovante"
                      onCapture={entry => setProofResidenceUrl(entry.url)}
                      onUpload={file => uploadService.uploadFile(file, 'packages/proofs')}
                    />
                    {proofResidenceUrl && <p className="text-xs text-green-600 mt-1">✓ Comprovante registrado</p>}
                  </div>
                )
              })()}

              {/* Other-person extra docs */}
              {pickupType === 'other' && (
                <div className="rounded-xl border border-amber-200 overflow-hidden">
                  <div className="bg-amber-500 px-4 py-2.5 flex items-center gap-2">
                    <Shield className="w-4 h-4 text-white" />
                    <span className="text-sm font-semibold text-white">Documentação — Retirada por Terceiros</span>
                  </div>
                  <div className="p-4 flex flex-col gap-4">
                    <div>
                      <p className="text-xs font-semibold text-gray-700 mb-2">
                        Documento de identificação de quem retira <span className="text-red-500">*</span>
                      </p>
                      <PhotoCapture
                        label="RG/CNH do portador"
                        onCapture={entry => setPickerIdPhoto(entry.url)}
                        onUpload={file => uploadService.uploadFile(file, 'packages/ids')}
                      />
                      {pickerIdPhoto && <p className="text-xs text-green-600 mt-1">✓ Documento registrado</p>}
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-700 mb-1">
                        Telefone de contato <span className="text-gray-400 font-normal">(opcional)</span>
                      </label>
                      <input value={pickerPhone} onChange={e => setPickerPhone(e.target.value)}
                        type="tel" placeholder="(00) 00000-0000" className={inputCls} />
                    </div>
                  </div>
                </div>
              )}

              {/* Guest upgrade banner */}
              {deliveryTarget?.resident_type === 'guest' && deliveryTarget?.resident_id && (
                <div className="bg-orange-50 border border-orange-200 rounded-xl px-4 py-3 flex flex-col gap-2">
                  <p className="text-xs font-semibold text-orange-800">Visitante — taxa R$ 2,50 será cobrada</p>

                  {/* Reassign to existing resident/dependent */}
                  <div>
                    <p className="text-xs text-gray-600 mb-1">Atribuir encomenda a outro morador/dependente:</p>
                    <div className="relative">
                      <input value={reassignSearch} onChange={e => { const v = e.target.value; setReassignSearch(v); if (reassignTimer.current) clearTimeout(reassignTimer.current); reassignTimer.current = setTimeout(() => { if (v.length >= 3) api.get<any[]>(`/residents/search?q=${encodeURIComponent(v)}`).then(r => setReassignResults(r.data.slice(0, 6))).catch(() => setReassignResults([])); else setReassignResults([]) }, SEARCH_DELAY) }}
                        className={inputCls} placeholder="Buscar por nome ou CPF…" />
                      {reassignResults.length > 0 && (
                        <div className="absolute z-10 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden">
                          {reassignResults.map(r => (
                            <button key={r.id} type="button" disabled={reassignLoading}
                              onClick={() => handleReassign(r.id, r.full_name)}
                              className="w-full text-left px-3 py-2 hover:bg-blue-50 flex flex-col border-b last:border-0 border-gray-100">
                              <span className="text-xs font-semibold text-gray-800">{r.full_name}</span>
                              <span className="text-[10px] text-gray-500">
                                {r.responsible_name ? `Dependente de ${r.responsible_name}` : r.type === 'guest' ? 'Visitante' : 'Associado'}
                              </span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Upgrade current guest to member */}
                  <div className="border-t border-orange-200 pt-2">
                    {!showUpgrade ? (
                      <button onClick={() => setShowUpgrade(true)}
                        className="w-full bg-green-600 hover:bg-green-700 text-white text-xs font-semibold py-2 rounded-lg transition flex items-center justify-center gap-1.5">
                        ✓ Associar morador — isentar taxa
                      </button>
                    ) : (
                      <div className="flex flex-col gap-2">
                        <p className="text-xs font-medium text-green-700">Ao confirmar, o morador vira associado e a taxa é isenta nesta entrega.</p>
                        <input value={upgradePhone} onChange={e => setUpgradePhone(e.target.value)}
                          className={inputCls} placeholder="Telefone do associado *" />
                        <input value={upgradeCep} onChange={e => setUpgradeCep(e.target.value)}
                          className={inputCls} placeholder="CEP do associado *" inputMode="numeric" />
                        <input value={upgradeCpf} onChange={e => setUpgradeCpf(e.target.value)}
                          className={inputCls} placeholder="CPF (opcional)" />
                        <div className="flex gap-2">
                          <button onClick={() => { setShowUpgrade(false); setUpgradeCpf(''); setUpgradePhone(''); setUpgradeCep('') }}
                            className="flex-1 border border-gray-300 text-gray-600 py-1.5 rounded-lg text-xs">Cancelar</button>
                          <button onClick={handleUpgradeToMember} disabled={upgradeLoading}
                            className="flex-1 bg-green-600 text-white py-1.5 rounded-lg text-xs font-semibold disabled:opacity-50">
                            {upgradeLoading ? '…' : 'Confirmar Associação'}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Exemption token + payment method for non-members */}
              {(!deliveryTarget?.resident_id || deliveryTarget?.resident_type === 'guest') && (
                <div className="flex flex-col gap-2">
                  <div>
                    <label className="block text-xs text-gray-600 mb-1">Código de isenção (opcional)</label>
                    <input
                      value={exemptionToken}
                      onChange={e => { setExemptionToken(e.target.value.toUpperCase()); setExemptionTokenError('') }}
                      className={`${inputCls} font-mono tracking-widest uppercase`}
                      placeholder="Ex: A3F8C1"
                      maxLength={8}
                    />
                    {exemptionTokenError && <p className="text-xs text-red-500 mt-1">{exemptionTokenError}</p>}
                    {exemptionToken.length >= 6 && !exemptionTokenError && (
                      <p className="text-xs text-green-600 mt-1">Código informado — taxa será isenta se válido.</p>
                    )}
                  </div>
                  {!exemptionToken.trim() && paymentMethods.length > 0 && (
                    <div className="flex flex-col gap-2">
                      <div>
                        <label className="block text-xs text-gray-600 mb-1">Forma de pagamento da taxa <span className="text-red-500">*</span></label>
                        <select value={deliveryPaymentMethodId} onChange={e => { setDeliveryPaymentMethodId(e.target.value); setDeliveryPixPayerName('') }}
                          className={inputCls}>
                          <option value="">Selecione...</option>
                          {paymentMethods.map(pm => (
                            <option key={pm.id} value={pm.id}>{pm.name}</option>
                          ))}
                        </select>
                      </div>
                      {paymentMethods.find(m => m.id === deliveryPaymentMethodId)?.name?.toLowerCase().includes('pix') && (
                        <div>
                          <label className="block text-xs text-gray-600 mb-1">Nome do pagador PIX <span className="text-red-500">*</span></label>
                          <input
                            value={deliveryPixPayerName}
                            onChange={e => setDeliveryPixPayerName(e.target.value)}
                            className={inputCls}
                            placeholder="Nome de quem fez o PIX"
                          />
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Recipient section */}
              <div className="rounded-xl border border-blue-200 overflow-hidden">
                <div className="bg-blue-600 px-4 py-2.5 flex items-center gap-2">
                  <User className="w-4 h-4 text-white" />
                  <span className="text-sm font-semibold text-white">
                    {pickupType === 'other' ? 'Portador (quem está retirando)' : pickupType === 'dependent' ? 'Dependente' : 'Recebedor (Morador)'}
                  </span>
                </div>
                <div className="p-4 flex flex-col gap-3">
                  <div>
                    <label className="block text-xs text-gray-600 mb-1">Nome completo <span className="text-red-500">*</span></label>
                    <input value={recipientName} onChange={e => setRecipientName(e.target.value)} className={inputCls}
                      placeholder={pickupType === 'other' ? 'Nome de quem está retirando' : 'Nome de quem está recebendo'} />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-600 mb-1">Funcionário que está entregando</label>
                    <input value={deliveryPersonName} onChange={e => setDeliveryPersonName(e.target.value)} className={inputCls} placeholder="Nome do funcionário da portaria" />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-600 mb-1">Assinatura <span className="text-red-500">*</span></label>
                    <SignaturePad
                      label="Assinatura do recebedor"
                      onSave={setRecipientSig}
                      onClear={() => setRecipientSig('')}
                      onUpload={dataUrl => uploadService.uploadBase64(dataUrl, 'packages/signatures')}
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="flex gap-3 px-5 pb-5 bg-white border-t border-gray-100 pt-4">
              <button onClick={() => { setDeliveryTarget(null); resetDelivery() }}
                className="flex-1 border border-gray-300 text-gray-600 py-2.5 rounded-xl text-sm hover:bg-gray-50 transition">Cancelar</button>
              <button onClick={handleDeliver}
                disabled={loading || !recipientSig || !recipientName}
                className="flex-1 bg-[#26619c] hover:bg-[#1a4f87] text-white py-2.5 rounded-xl text-sm font-semibold transition disabled:opacity-50">
                {loading ? 'Registrando…' : 'Confirmar Entrega'}
              </button>
            </div>
          </div>
          </div>
        </div>
      )}

      {/* Pay Mensalidade Quick Modal */}
      {showPayMenModal && (
        <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-5 flex flex-col gap-3">
            <h2 className="text-base font-semibold text-gray-800">Regularizar Mensalidade</h2>
            {payMenInfo && (
              <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3 text-sm text-green-800">
                <p className="font-semibold">{deliveryTarget?.resident_name}</p>
                <p className="text-xs text-green-600 mt-0.5">
                  Competência: {payMenInfo.reference_month} · R$ {parseFloat(payMenInfo.amount).toFixed(2)}
                </p>
              </div>
            )}
            {paymentMethods.length > 0 && (
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Forma de pagamento</label>
                <select
                  value={payMenPmId}
                  onChange={e => setPayMenPmId(e.target.value)}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm"
                >
                  <option value="">Não informar</option>
                  {paymentMethods.map(pm => <option key={pm.id} value={pm.id}>{pm.name}</option>)}
                </select>
              </div>
            )}
            <p className="text-xs text-gray-400">Após o pagamento, a taxa de entrega será removida automaticamente.</p>
            <div className="flex gap-2">
              <button onClick={() => { setShowPayMenModal(false); setPayMenId(null); setPayMenInfo(null) }}
                className="flex-1 py-2 rounded-xl border border-gray-200 text-sm text-gray-600">Cancelar</button>
              <button onClick={confirmPayMensalidadeQuick} disabled={payMenLoading}
                className="flex-1 py-2 rounded-xl bg-green-600 text-white text-sm font-semibold disabled:opacity-50">
                {payMenLoading ? '…' : 'Confirmar Pagamento'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk Delivery Modal */}
      {showBulkDeliver && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-black/40">
          <div className="flex min-h-full items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="w-full max-w-lg bg-white rounded-t-2xl sm:rounded-2xl shadow-xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <div>
                <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                  <Layers className="w-4 h-4 text-[#26619c]" />
                  Entrega Múltipla
                </h3>
                <p className="text-xs text-gray-400 mt-0.5">
                  {bulkStep === 'select' ? 'Selecione as encomendas a entregar' : 'Dados do recebedor'}
                </p>
              </div>
              <button onClick={resetBulk}><X className="w-5 h-5 text-gray-400" /></button>
            </div>

            {/* Step: select */}
            {bulkStep === 'select' && !bulkResult && (
              <>
                <div className="px-5 pt-4">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                    <input
                      value={bulkSearch}
                      onChange={e => setBulkSearch(e.target.value)}
                      placeholder="Buscar por morador, rastreio, transportadora..."
                      className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#26619c]/30"
                    />
                  </div>
                </div>
                <div className="p-5 flex flex-col gap-3 max-h-[50vh] overflow-y-auto">
                  {pendingPackages.length === 0 ? (
                    <p className="text-sm text-gray-400 text-center py-6">Nenhuma encomenda pendente.</p>
                  ) : bulkFiltered.length === 0 ? (
                    <p className="text-sm text-gray-400 text-center py-6">Nenhum resultado para "{bulkSearch}".</p>
                  ) : (
                    <>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs text-gray-500">{bulkSelected.size} selecionada(s)</span>
                        <button
                          onClick={() => {
                            const allFilteredSelected = bulkFiltered.every(p => bulkSelected.has(p.id))
                            const next = new Set(bulkSelected)
                            if (allFilteredSelected) bulkFiltered.forEach(p => next.delete(p.id))
                            else bulkFiltered.forEach(p => next.add(p.id))
                            setBulkSelected(next)
                          }}
                          className="text-xs text-[#26619c] hover:underline"
                        >
                          {bulkFiltered.every(p => bulkSelected.has(p.id)) ? 'Desmarcar visíveis' : 'Selecionar visíveis'}
                        </button>
                      </div>
                      {bulkFiltered.map(pkg => (
                        <label key={pkg.id}
                          className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition ${bulkSelected.has(pkg.id) ? 'border-[#26619c] bg-[#26619c]/5' : 'border-gray-200 hover:border-gray-300'}`}>
                          <input
                            type="checkbox"
                            checked={bulkSelected.has(pkg.id)}
                            onChange={e => {
                              const next = new Set(bulkSelected)
                              e.target.checked ? next.add(pkg.id) : next.delete(pkg.id)
                              setBulkSelected(next)
                            }}
                            className="mt-0.5 w-4 h-4 accent-[#26619c] shrink-0"
                          />
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-gray-800 truncate">
                              {pkg.resident_name ?? '—'}
                            </p>
                            <p className="text-xs text-gray-400">
                              {pkg.carrier_name ?? '—'}{pkg.tracking_code ? ` · ${pkg.tracking_code}` : ''}
                            </p>
                            <div className="flex items-center gap-2 mt-0.5">
                              <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${STATUS_COLORS[pkg.status]}`}>{STATUS_LABELS[pkg.status]}</span>
                              {pkg.has_delivery_fee && <span className="text-[10px] text-amber-600 font-medium">Taxa R$ {parseFloat(pkg.delivery_fee_amount ?? '2.50').toFixed(2)}</span>}
                            </div>
                          </div>
                        </label>
                      ))}
                    </>
                  )}
                </div>
                <div className="flex gap-3 px-5 pb-5 pt-4 border-t border-gray-100">
                  <button onClick={resetBulk} className="flex-1 border border-gray-300 text-gray-600 py-2.5 rounded-xl text-sm hover:bg-gray-50 transition">Cancelar</button>
                  <button
                    onClick={() => setBulkStep('sign')}
                    disabled={bulkSelected.size === 0}
                    className="flex-1 bg-[#26619c] hover:bg-[#1a4f87] text-white py-2.5 rounded-xl text-sm font-semibold transition disabled:opacity-50"
                  >
                    Continuar ({bulkSelected.size}) →
                  </button>
                </div>
              </>
            )}

            {/* Step: sign */}
            {bulkStep === 'sign' && !bulkResult && (
              <>
                <div className="p-5 flex flex-col gap-4">
                  <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-3">
                    <p className="text-xs font-semibold text-blue-800 mb-1">{bulkSelected.size} encomenda(s) selecionada(s)</p>
                    <p className="text-xs text-blue-600">O recebedor assina uma única vez por todas.</p>
                  </div>
                  <div>
                    <label className="block text-xs text-gray-600 mb-1">Nome de quem está retirando <span className="text-red-500">*</span></label>
                    <input value={bulkRecipientName} onChange={e => setBulkRecipientName(e.target.value)}
                      className={inputCls} placeholder="Nome completo do recebedor" autoFocus />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-600 mb-1">Funcionário que está entregando</label>
                    <input value={bulkDeliveryPersonName} onChange={e => setBulkDeliveryPersonName(e.target.value)}
                      className={inputCls} placeholder="Nome do funcionário da portaria" />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-600 mb-1">Assinatura do recebedor <span className="text-red-500">*</span></label>
                    <SignaturePad
                      label="Assinatura do recebedor"
                      onSave={setBulkSig}
                      onClear={() => setBulkSig('')}
                      onUpload={dataUrl => uploadService.uploadBase64(dataUrl, 'packages/signatures')}
                    />
                  </div>
                  {bulkHasGuest && (
                    <div className="flex flex-col gap-3">
                      <div>
                        <label className="block text-xs text-gray-600 mb-1">Código de isenção (opcional)</label>
                        <input
                          value={bulkExemptionToken}
                          onChange={e => { setBulkExemptionToken(e.target.value.toUpperCase()); setBulkExemptionError('') }}
                          className={`${inputCls} font-mono tracking-widest uppercase`}
                          placeholder="Ex: A3F8C1"
                          maxLength={8}
                        />
                        {bulkExemptionError && <p className="text-xs text-red-500 mt-1">{bulkExemptionError}</p>}
                        {bulkExemptionToken.length >= 6 && !bulkExemptionError && (
                          <p className="text-xs text-green-600 mt-1">Código informado — taxa será isenta se válido.</p>
                        )}
                      </div>
                      {!bulkExemptionToken.trim() && paymentMethods.length > 0 && (
                        <div>
                          <label className="block text-xs text-gray-600 mb-1">Forma de pagamento da taxa <span className="text-red-500">*</span></label>
                          <select value={bulkPaymentMethodId} onChange={e => setBulkPaymentMethodId(e.target.value)} className={inputCls}>
                            <option value="">Selecione...</option>
                            {paymentMethods.map(pm => <option key={pm.id} value={pm.id}>{pm.name}</option>)}
                          </select>
                        </div>
                      )}
                    </div>
                  )}
                </div>
                <div className="flex gap-3 px-5 pb-5 pt-4 border-t border-gray-100">
                  <button onClick={() => setBulkStep('select')} className="flex-1 border border-gray-300 text-gray-600 py-2.5 rounded-xl text-sm hover:bg-gray-50 transition">← Voltar</button>
                  <button
                    onClick={handleBulkDeliver}
                    disabled={bulkLoading || !bulkSig || !bulkRecipientName || (bulkHasGuest && !bulkPaymentMethodId && !bulkExemptionToken.trim())}
                    className="flex-1 bg-[#26619c] hover:bg-[#1a4f87] text-white py-2.5 rounded-xl text-sm font-semibold transition disabled:opacity-50"
                  >
                    {bulkLoading ? 'Registrando…' : 'Confirmar Entrega'}
                  </button>
                </div>
              </>
            )}

            {/* Result */}
            {bulkResult && (
              <div className="p-5 flex flex-col gap-4">
                <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-4 text-center">
                  <p className="text-2xl font-bold text-green-700">{bulkResult.delivered}</p>
                  <p className="text-sm text-green-600 mt-1">encomenda(s) entregue(s) com sucesso</p>
                  {bulkResult.items.filter((i: any) => i.has_delivery_fee).length > 0 && (
                    <p className="text-xs text-amber-600 mt-2 font-medium">
                      Taxa cobrada em {bulkResult.items.filter((i: any) => i.has_delivery_fee).length} encomenda(s)
                    </p>
                  )}
                </div>
                {bulkResult.errors.length > 0 && (
                  <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3">
                    <p className="text-xs font-semibold text-red-700 mb-1">{bulkResult.errors.length} erro(s):</p>
                    <ul className="text-xs text-red-600 flex flex-col gap-0.5">
                      {bulkResult.errors.map((e, i) => <li key={i}>{e.error}</li>)}
                    </ul>
                  </div>
                )}
                <button onClick={resetBulk} className="w-full bg-[#26619c] hover:bg-[#1a4f87] text-white py-2.5 rounded-xl text-sm font-semibold transition">
                  Fechar
                </button>
              </div>
            )}
          </div>
          </div>
        </div>
      )}

      {/* ── Simplifica: Picker de Retirada ── */}
      {showRetiradaPicker && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 px-0 sm:px-4">
          <div className="w-full max-w-lg bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl flex flex-col max-h-[90vh]">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 shrink-0">
              <div>
                <h3 className="font-semibold text-gray-900 text-sm">Retirada de Encomenda</h3>
                <p className="text-xs text-gray-400 mt-0.5">Busque a encomenda pelo nome do morador</p>
              </div>
              <button onClick={() => { setShowRetiradaPicker(false); setPickerSearch(''); setPickerPackages([]) }}>
                <X className="w-5 h-5 text-gray-400" />
              </button>
            </div>
            <div className="px-5 py-3 border-b border-gray-100 shrink-0">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  value={pickerSearch}
                  onChange={async e => {
                    const q = e.target.value
                    setPickerSearch(q)
                    if (q.length < 2) { setPickerPackages([]); return }
                    setPickerLoading(true)
                    try {
                      const r = await api.get<Package[]>('/packages', { params: { q, statuses: 'received,notified,reversed' } })
                      setPickerPackages(r.data.slice(0, 15))
                    } catch { /* silent */ } finally { setPickerLoading(false) }
                  }}
                  placeholder="Nome do morador, unidade ou rastreio…"
                  className="w-full border border-gray-300 rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#26619c]/40 focus:border-[#26619c]"
                  autoFocus
                />
                {pickerLoading && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400">…</span>}
              </div>
            </div>
            <div className="flex-1 overflow-y-auto divide-y divide-gray-50">
              {pickerPackages.length === 0 && pickerSearch.length >= 2 && !pickerLoading && (
                <p className="text-sm text-gray-400 text-center py-8">Nenhuma encomenda pendente encontrada.</p>
              )}
              {pickerSearch.length < 2 && (
                <p className="text-xs text-gray-400 text-center py-8">Digite o nome do morador para buscar</p>
              )}
              {pickerPackages.map(pkg => (
                <button key={pkg.id} onClick={() => {
                  setShowRetiradaPicker(false)
                  setPickerSearch('')
                  setPickerPackages([])
                  setDeliveryTarget(pkg)
                  setRecipientName(pkg.resident_name ?? '')
                  setDeliveryPersonName(fullName ?? '')
                }}
                  className="w-full flex items-start gap-3 px-5 py-3 hover:bg-blue-50 transition text-left"
                >
                  <PackageIcon className="w-5 h-5 mt-0.5 text-[#26619c] shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-800 truncate">{pkg.resident_name ?? '—'}</p>
                    <p className="text-xs text-gray-500 truncate">
                      {pkg.carrier_name ? ` · ${pkg.carrier_name}` : ''}
                      {pkg.tracking_code ? ` · ${pkg.tracking_code}` : ''}
                    </p>
                    <p className="text-xs text-gray-400">{new Date(pkg.received_at).toLocaleDateString('pt-BR')}</p>
                  </div>
                  <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full shrink-0 ${STATUS_COLORS[pkg.status] ?? 'bg-gray-100 text-gray-500'}`}>
                    {STATUS_LABELS[pkg.status] ?? pkg.status}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Simplifica: Picker de Devolução ── */}
      {showDevolucaoPicker && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 px-0 sm:px-4">
          <div className="w-full max-w-lg bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl flex flex-col max-h-[90vh]">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 shrink-0">
              <div>
                <h3 className="font-semibold text-gray-900 text-sm">Devolução de Encomenda</h3>
                <p className="text-xs text-gray-400 mt-0.5">Busque a encomenda pelo nome do morador</p>
              </div>
              <button onClick={() => { setShowDevolucaoPicker(false); setPickerSearch(''); setPickerPackages([]) }}>
                <X className="w-5 h-5 text-gray-400" />
              </button>
            </div>
            <div className="px-5 py-3 border-b border-gray-100 shrink-0">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  value={pickerSearch}
                  onChange={async e => {
                    const q = e.target.value
                    setPickerSearch(q)
                    if (q.length < 2) { setPickerPackages([]); return }
                    setPickerLoading(true)
                    try {
                      const r = await api.get<Package[]>('/packages', { params: { q, statuses: 'received,notified' } })
                      setPickerPackages(r.data.slice(0, 15))
                    } catch { /* silent */ } finally { setPickerLoading(false) }
                  }}
                  placeholder="Nome do morador, unidade ou rastreio…"
                  className="w-full border border-gray-300 rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#26619c]/40 focus:border-[#26619c]"
                  autoFocus
                />
                {pickerLoading && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400">…</span>}
              </div>
            </div>
            <div className="flex-1 overflow-y-auto divide-y divide-gray-50">
              {pickerPackages.length === 0 && pickerSearch.length >= 2 && !pickerLoading && (
                <p className="text-sm text-gray-400 text-center py-8">Nenhuma encomenda encontrada.</p>
              )}
              {pickerSearch.length < 2 && (
                <p className="text-xs text-gray-400 text-center py-8">Digite o nome do morador para buscar</p>
              )}
              {pickerPackages.map(pkg => (
                <button key={pkg.id} onClick={() => {
                  setShowDevolucaoPicker(false)
                  setPickerSearch('')
                  setPickerPackages([])
                  setDetailPkg(pkg)
                }}
                  className="w-full flex items-start gap-3 px-5 py-3 hover:bg-orange-50 transition text-left"
                >
                  <PackageIcon className="w-5 h-5 mt-0.5 text-orange-500 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-800 truncate">{pkg.resident_name ?? '—'}</p>
                    <p className="text-xs text-gray-500 truncate">
                      {pkg.carrier_name ? ` · ${pkg.carrier_name}` : ''}
                      {pkg.tracking_code ? ` · ${pkg.tracking_code}` : ''}
                    </p>
                    <p className="text-xs text-gray-400">{new Date(pkg.received_at).toLocaleDateString('pt-BR')}</p>
                  </div>
                  <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full shrink-0 ${STATUS_COLORS[pkg.status] ?? 'bg-gray-100 text-gray-500'}`}>
                    {STATUS_LABELS[pkg.status] ?? pkg.status}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Simplifica: Picker de Consulta (todos os status) ── */}
      {showConsultarPicker && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 px-0 sm:px-4">
          <div className="w-full max-w-lg bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl flex flex-col max-h-[90vh]">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 shrink-0">
              <div>
                <h3 className="font-semibold text-gray-900 text-sm">Consultar Encomendas</h3>
                <p className="text-xs text-gray-400 mt-0.5">Busque por nome, unidade ou rastreio</p>
              </div>
              <button onClick={() => { setShowConsultarPicker(false); setPickerSearch(''); setPickerPackages([]) }}>
                <X className="w-5 h-5 text-gray-400" />
              </button>
            </div>
            <div className="px-5 py-3 border-b border-gray-100 shrink-0">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  value={pickerSearch}
                  onChange={async e => {
                    const q = e.target.value
                    setPickerSearch(q)
                    if (q.length < 2) { setPickerPackages([]); return }
                    setPickerLoading(true)
                    try {
                      const r = await api.get<Package[]>('/packages', { params: { q } })
                      setPickerPackages(r.data.slice(0, 15))
                    } catch { /* silent */ } finally { setPickerLoading(false) }
                  }}
                  placeholder="Nome do morador, unidade ou rastreio…"
                  className="w-full border border-gray-300 rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#26619c]/40 focus:border-[#26619c]"
                  autoFocus
                />
                {pickerLoading && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400">…</span>}
              </div>
            </div>
            <div className="flex-1 overflow-y-auto divide-y divide-gray-50">
              {pickerPackages.length === 0 && pickerSearch.length >= 2 && !pickerLoading && (
                <p className="text-sm text-gray-400 text-center py-8">Nenhuma encomenda encontrada.</p>
              )}
              {pickerSearch.length < 2 && (
                <p className="text-xs text-gray-400 text-center py-8">Digite para buscar</p>
              )}
              {pickerPackages.map(pkg => (
                <button key={pkg.id} onClick={() => {
                  setShowConsultarPicker(false)
                  setPickerSearch('')
                  setPickerPackages([])
                  setDetailPkg(pkg)
                }}
                  className="w-full flex items-start gap-3 px-5 py-3 hover:bg-blue-50 transition text-left"
                >
                  <PackageIcon className="w-5 h-5 mt-0.5 text-[#26619c] shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-800 truncate">{pkg.resident_name ?? '—'}</p>
                    <p className="text-xs text-gray-500 truncate">
                      {pkg.carrier_name ? ` · ${pkg.carrier_name}` : ''}
                      {pkg.tracking_code ? ` · ${pkg.tracking_code}` : ''}
                    </p>
                    <p className="text-xs text-gray-400">{new Date(pkg.received_at).toLocaleDateString('pt-BR')}</p>
                  </div>
                  <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full shrink-0 ${STATUS_COLORS[pkg.status] ?? 'bg-gray-100 text-gray-500'}`}>
                    {STATUS_LABELS[pkg.status] ?? pkg.status}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Simplifica: Minhas Encomendas ── */}
      {showMinhasPicker && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 px-0 sm:px-4">
          <div className="w-full max-w-lg bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl flex flex-col max-h-[90vh]">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 shrink-0">
              <h3 className="font-semibold text-gray-900 text-sm">Minhas Encomendas</h3>
              <button onClick={() => setShowMinhasPicker(false)}>
                <X className="w-5 h-5 text-gray-400" />
              </button>
            </div>
            {/* Tabs */}
            <div className="flex border-b border-gray-100 shrink-0">
              {(['recebidas', 'entregues'] as const).map(t => (
                <button key={t} onClick={() => setMinhasTab(t)}
                  className={`flex-1 py-2.5 text-xs font-semibold transition border-b-2 ${
                    minhasTab === t ? 'text-[#26619c] border-[#26619c]' : 'text-gray-400 border-transparent'
                  }`}>
                  {t === 'recebidas' ? 'Por mim recebidas' : 'Por mim entregues'}
                </button>
              ))}
            </div>
            <div className="flex-1 overflow-y-auto divide-y divide-gray-50">
              {minhasTab === 'recebidas' && (
                minhasHistory.length === 0
                  ? <p className="text-xs text-gray-400 text-center py-8">Nenhum recebimento registrado.</p>
                  : minhasHistory.map(entry => (
                    <div key={entry.id} className="px-5 py-3">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs text-gray-400">
                          {new Date(entry.received_at).toLocaleDateString('pt-BR', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' })}
                        </span>
                        <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${entry.is_bulk ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>
                          {entry.is_bulk ? `Lote · ${entry.count}` : '1 encomenda'}
                        </span>
                      </div>
                      {entry.items.map((item, i) => (
                        <p key={i} className="text-sm text-gray-700 truncate">{item.resident_name}</p>
                      ))}
                    </div>
                  ))
              )}
              {minhasTab === 'entregues' && (
                minhasDelivered.length === 0
                  ? <p className="text-xs text-gray-400 text-center py-8">Nenhuma entrega registrada.</p>
                  : minhasDelivered.map(pkg => (
                    <div key={pkg.id} className="flex items-start gap-3 px-5 py-3">
                      <PackageIcon className="w-4 h-4 mt-0.5 text-[#26619c] shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-800 truncate">{pkg.resident_name ?? '—'}</p>
                        <p className="text-xs text-gray-500">{pkg.delivered_at ? new Date(pkg.delivered_at).toLocaleDateString('pt-BR') : ''}</p>
                      </div>
                    </div>
                  ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* Receive Mode Choice */}
      {showReceiveMode && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-sm bg-white rounded-2xl shadow-2xl p-6 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-gray-900">Tipo de Recebimento</h3>
              <button onClick={() => setShowReceiveMode(false)}><X className="w-5 h-5 text-gray-400" /></button>
            </div>
            <button onClick={() => { setShowReceiveMode(false); setShowReceive(true); setStep('recipient') }}
              className="flex items-center gap-4 p-4 rounded-2xl border-2 border-[#26619c] bg-[#26619c]/5 hover:bg-[#26619c]/10 transition text-left">
              <PackageIcon className="w-8 h-8 text-[#26619c] shrink-0" />
              <div>
                <p className="font-semibold text-[#26619c]">Recebimento Unitário</p>
                <p className="text-xs text-gray-500 mt-0.5">Uma encomenda com foto da etiqueta</p>
              </div>
            </button>
            <button onClick={() => { setShowReceiveMode(false); setShowBulkReceive(true); setBulkRxStep('sign') }}
              className="flex items-center gap-4 p-4 rounded-2xl border-2 border-amber-400 bg-amber-50 hover:bg-amber-100 transition text-left">
              <Layers className="w-8 h-8 text-amber-500 shrink-0" />
              <div>
                <p className="font-semibold text-amber-700">Recebimento Múltiplo</p>
                <p className="text-xs text-gray-500 mt-0.5">Várias encomendas, entregador assina uma vez</p>
              </div>
            </button>
          </div>
        </div>
      )}

      {/* Bulk Receive Modal */}
      {showBulkReceive && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4">
          <div className="relative w-full max-w-lg bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl flex flex-col max-h-[92vh]">

            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 shrink-0">
              <div className="flex items-center gap-2">
                <Layers className="w-4 h-4 text-amber-500" />
                <div>
                  <h3 className="font-semibold text-gray-900 text-sm">Recebimento Múltiplo</h3>
                  <p className="text-xs text-gray-400">
                    {bulkRxStep === 'sign'
                      ? 'Entregador assina antes de liberar'
                      : bulkRxQueue.length === 0 ? 'Bipe ou busque cada encomenda' : `${bulkRxQueue.length} na fila — continue bipando`}
                  </p>
                </div>
              </div>
              <button onClick={closeBulkRx}><X className="w-5 h-5 text-gray-400" /></button>
            </div>

            {/* Exit confirmation */}
            {brxExitConfirm && (
              <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/40 rounded-t-2xl sm:rounded-2xl">
                <div className="bg-white rounded-2xl shadow-xl p-5 mx-4 w-full max-w-sm flex flex-col gap-3">
                  <p className="font-semibold text-gray-900 text-sm">Sair do recebimento múltiplo?</p>
                  <p className="text-xs text-gray-500">Você tem <span className="font-bold text-amber-600">{bulkRxQueue.length} encomenda(s)</span> na fila. Deseja manter como rascunho ou descartar?</p>
                  <div className="flex gap-2 pt-1">
                    <button onClick={() => { setBrxExitConfirm(false); setShowBulkReceive(false) }}
                      className="flex-1 bg-amber-500 text-white rounded-xl py-2.5 text-sm font-semibold hover:bg-amber-600 transition">
                      Manter rascunho
                    </button>
                    <button onClick={resetBulkRx}
                      className="flex-1 border border-red-200 text-red-600 rounded-xl py-2.5 text-sm font-semibold hover:bg-red-50 transition">
                      Descartar
                    </button>
                  </div>
                  <button onClick={() => setBrxExitConfirm(false)} className="text-xs text-gray-400 hover:text-gray-600 text-center">Voltar ao recebimento</button>
                </div>
              </div>
            )}

            {/* Step: add */}
            {bulkRxStep === 'add' && !brxResult && (
              <>
                <div className="overflow-y-auto flex-1 p-4 flex flex-col gap-3">

                  {/* Photo capture step */}
                  {brxPending ? (
                    <div className="flex flex-col gap-3 bg-blue-50 border border-blue-200 rounded-xl p-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-semibold text-blue-900">{brxPending.resident.full_name}</p>
                          {brxPending.tracking && <p className="text-xs font-mono text-blue-600 mt-0.5">{brxPending.tracking}</p>}
                        </div>
                        <button onClick={() => { setBrxPending(null); setBrxCarrier(''); setBrxSearch(''); setBrxResults([]); setTimeout(() => brxBarcodeRef.current?.focus(), 50) }}
                          className="text-xs text-blue-400 hover:text-blue-600">Cancelar</button>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-blue-800 mb-1">Transportadora (opcional)</label>
                        {carrierOpts.length > 0 ? (
                          <select value={brxCarrier} onChange={e => setBrxCarrier(e.target.value)}
                            className="w-full border border-blue-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-400/40">
                            <option value="">— Sem transportadora —</option>
                            {carrierOpts.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                          </select>
                        ) : (
                          <input value={brxCarrier} onChange={e => setBrxCarrier(e.target.value)}
                            className="w-full border border-blue-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400/40"
                            placeholder="Correios, Mercado Envios… (opcional)" />
                        )}
                      </div>
                      <PhotoCapture
                        label="Foto da Etiqueta"
                        onCapture={entry => doAddToBulkRxQueue(brxPending.resident, brxPending.tracking, [entry])}
                        onUpload={file => uploadService.uploadFile(file, 'packages/labels')}
                      />
                      <button
                        type="button"
                        onClick={() => doAddToBulkRxQueue(brxPending.resident, brxPending.tracking, [])}
                        className="text-xs text-blue-500 hover:text-blue-700 underline text-center"
                      >
                        Adicionar sem foto
                      </button>
                    </div>
                  ) : (
                  <>
                  {/* Barcode — primary focus target */}
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <Barcode className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-[#26619c]" />
                      <input
                        ref={brxBarcodeRef}
                        value={brxTracking}
                        onChange={e => setBrxTracking(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleBarcodeEnter() } }}
                        className={`${inputCls} pl-10 py-3 text-base font-mono`}
                        placeholder="Bipe ou escaneie o código…"
                        autoComplete="off"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => isMobile ? setScanChoice('bulk') : setShowBrxScanner(true)}
                      title="Escanear com câmera"
                      className="flex items-center justify-center gap-1.5 bg-[#26619c] hover:bg-[#1a4f87] text-white px-3 rounded-lg text-sm font-medium transition shrink-0"
                    >
                      <Camera className="w-4 h-4" />
                      <span className="text-xs">Câmera</span>
                    </button>
                  </div>

                  {/* Flash: last added */}
                  {brxLastAdded && (
                    <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-lg px-3 py-2 animate-pulse">
                      <span className="text-green-600 text-lg">✓</span>
                      <span className="text-sm text-green-800 font-medium truncate">{brxLastAdded}</span>
                    </div>
                  )}

                  {/* Resident search */}
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <input
                      ref={brxSearchRef}
                      value={brxSearch}
                      onChange={e => { const v = e.target.value; setBrxSearch(v); setBrxSelected(null); if (brxSearchTimer.current) clearTimeout(brxSearchTimer.current); brxSearchTimer.current = setTimeout(() => searchBrxResidents(v), SEARCH_DELAY) }}
                      onKeyDown={e => {
                        if (e.key === 'Enter' && brxResults.length > 0) { e.preventDefault(); selectBrxResident(brxResults[0]) }
                      }}
                      className={`${inputCls} pl-9`}
                      placeholder="Buscar destinatário por nome, unidade…"
                    />
                  </div>

                  {/* Search results */}
                  {brxResults.length > 0 && (() => {
                    const fn = (n: string) => n.trim().split(/\s+/)[0].toLowerCase()
                    const ns = brxResults.map(r => fn(r.full_name))
                    const dup = ns.some((w, i) => ns.indexOf(w) !== i)
                    return (
                      <>
                        {dup && (
                          <div className="flex items-start gap-2 bg-amber-50 border border-amber-300 rounded-lg px-3 py-2 mb-2 text-xs text-amber-800">
                            <span className="text-base leading-none mt-0.5">⚠️</span>
                            <p><strong>Possível duplicata:</strong> {brxResults.length} cadastros com nomes similares. Verifique antes de registrar.</p>
                          </div>
                        )}
                        <ul className="border border-gray-200 rounded-xl divide-y divide-gray-100 max-h-48 overflow-y-auto shadow-sm">
                      {brxResults.map((r, idx) => (
                        <li key={r.id}>
                          <button
                            className={`w-full text-left px-3 py-2.5 hover:bg-blue-50 flex items-center gap-2 transition ${idx === 0 ? 'bg-blue-50/50' : ''}`}
                            onClick={() => selectBrxResident(r)}
                          >
                            <User className={`w-4 h-4 shrink-0 ${r.type === 'guest' ? 'text-orange-500' : 'text-[#26619c]'}`} />
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-gray-800 truncate">{r.full_name}</p>
                            </div>
                            <div className="flex items-center gap-1 shrink-0">
                              {r.type === 'guest' && (
                                <>
                                  <span className="text-[10px] bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded-full">R$2,50</span>
                                  <button
                                    type="button"
                                    onClick={e => { e.stopPropagation(); setRxUpgradeTarget(r); setRxUpgradeCpf(''); setRxUpgradePhone(r?.phone_primary ?? ''); setRxUpgradeCep(r?.address_cep ?? '') }}
                                    className="text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full hover:bg-blue-200"
                                  >→ Assoc.</button>
                                </>
                              )}
                              {idx === 0 && brxTracking && <span className="text-[10px] bg-[#26619c]/10 text-[#26619c] px-1.5 py-0.5 rounded-full">Enter ↵</span>}
                            </div>
                          </button>
                        </li>
                      ))}
                        </ul>
                      </>
                    )
                  })()}

                  {/* No results — suggest guest */}
                  {brxSearch.length >= 2 && brxResults.length === 0 && !brxPending && (
                    brxShowGuest ? (
                      <div className="border border-gray-200 bg-gray-50 rounded-xl p-3 flex flex-col gap-2">
                        <p className="text-xs font-semibold text-gray-700">Cadastrar novo morador</p>
                        <div className="grid grid-cols-3 gap-1">
                          {([['guest','Visitante'],['member','Associado'],['dependent','Dependente']] as const).map(([t, label]) => (
                            <button key={t} type="button" onClick={() => setNewResType(t)}
                              className={`py-1 rounded-lg text-xs font-medium border transition ${newResType === t ? 'bg-[#26619c] border-[#26619c] text-white' : 'border-gray-200 bg-white text-gray-500'}`}>
                              {label}
                            </button>
                          ))}
                        </div>
                        <input value={brxGuestName} onChange={e => setBrxGuestName(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter' && newResType !== 'dependent') createBrxGuest() }}
                          className={inputCls} placeholder="Nome completo *" autoFocus />
                        {newResType === 'guest' && (
                          <>
                            <div className="flex gap-2">
                              <div className="flex-1">
                                <input value={brxGuestCep} onChange={e => { setBrxGuestCep(e.target.value); lookupBrxGuestCep(e.target.value) }}
                                  className={inputCls} placeholder={brxGuestCepLoading ? 'Buscando…' : 'CEP *'} maxLength={9} />
                              </div>
                              <div className="w-24">
                                <input value={brxGuestNumber} onChange={e => setBrxGuestNumber(e.target.value)}
                                  className={inputCls} placeholder="Nº *" />
                              </div>
                            </div>
                            {brxGuestStreet && <p className="text-xs text-gray-500">{brxGuestStreet}, {brxGuestNeighborhood} — {brxGuestCity}/{brxGuestState}</p>}
                          </>
                        )}
                        {newResType === 'member' && (
                          <>
                            <input value={newResCpf} onChange={e => setNewResCpf(e.target.value)} className={inputCls} placeholder="CPF (opcional)" />
                            <input value={guest.phone_primary} onChange={e => setGuest(g => ({ ...g, phone_primary: e.target.value }))}
                              className={inputCls} placeholder="Telefone (opcional)" type="tel" />
                          </>
                        )}
                        {newResType === 'dependent' && (
                          <div className="flex flex-col gap-1">
                            <input value={newResResponsibleSearch}
                              onChange={e => { const v = e.target.value; setNewResResponsibleSearch(v); setNewResResponsible(null); if (responsibleTimer.current) clearTimeout(responsibleTimer.current); responsibleTimer.current = setTimeout(() => searchResponsible(v), SEARCH_DELAY) }}
                              className={inputCls} placeholder="Responsável (associado)…" />
                            {newResResponsibleResults.length > 0 && (
                              <ul className="border border-gray-200 rounded-lg divide-y divide-gray-100 max-h-24 overflow-y-auto">
                                {newResResponsibleResults.map(r => (
                                  <li key={r.id}>
                                    <button type="button" onClick={() => { setNewResResponsible(r); setNewResResponsibleSearch(r.full_name); setNewResResponsibleResults([]) }}
                                      className="w-full text-left px-2 py-1.5 text-xs hover:bg-blue-50">{r.full_name}</button>
                                  </li>
                                ))}
                              </ul>
                            )}
                            {newResResponsible && <p className="text-xs text-green-700">✓ {newResResponsible.full_name}</p>}
                          </div>
                        )}
                        <div className="flex gap-2">
                          <button onClick={() => { setBrxShowGuest(false); setBrxGuestName(''); setNewResType('guest'); setNewResCpf(''); setNewResResponsible(null); setNewResResponsibleSearch('') }}
                            className="flex-1 border border-gray-300 text-gray-600 py-1.5 rounded-lg text-xs">Cancelar</button>
                          <button onClick={createBrxGuest} disabled={brxGuestLoading || !brxGuestName.trim()}
                            className="flex-1 bg-[#26619c] text-white py-1.5 rounded-lg text-xs font-medium disabled:opacity-50">
                            {brxGuestLoading ? 'Salvando…' : 'Salvar'}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button onClick={() => { setBrxShowGuest(true); setBrxGuestName(brxSearch); setNewResType('guest') }}
                        className="w-full flex items-center gap-2 border border-dashed border-orange-300 bg-orange-50 rounded-lg px-3 py-2.5 text-sm text-orange-600 hover:border-orange-400 transition">
                        <UserX className="w-4 h-4" /> Não encontrado — cadastrar como visitante
                      </button>
                    )
                  )}

                  {/* Pending item (tracking set, no resident yet) */}
                  {brxTracking && !brxSelected && brxResults.length === 0 && brxSearch.length < 2 && (
                    <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-700">
                      <Barcode className="w-4 h-4 shrink-0" />
                      <span className="font-mono font-medium truncate">{brxTracking}</span>
                      <span className="text-amber-500">— busque o destinatário</span>
                    </div>
                  )}

                  {/* Queue */}
                  {bulkRxQueue.length > 0 && (
                    <div className="border border-gray-200 rounded-xl overflow-hidden">
                      <div className="bg-[#26619c] px-3 py-2 flex items-center justify-between">
                        <span className="text-xs font-bold text-white">{bulkRxQueue.length} encomenda(s) na fila</span>
                        <button onClick={handleBulkRxSubmit} disabled={brxLoading}
                          className="text-xs bg-white text-[#26619c] px-2.5 py-1 rounded-lg font-semibold disabled:opacity-50">
                          {brxLoading ? '…' : 'Confirmar →'}
                        </button>
                      </div>
                      <ul className="divide-y divide-gray-100 max-h-40 overflow-y-auto">
                        {bulkRxQueue.map((item, i) => (
                          <li key={item.id} className="flex items-center gap-2 px-3 py-2">
                            <span className="text-xs font-bold text-gray-300 shrink-0 w-5">{i + 1}</span>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-gray-800 truncate">{item.resident_name}</p>
                              <p className="text-xs text-gray-400 truncate">
                                {item.carrier_name || <span className="text-amber-500">Sem transportadora</span>}
                                {item.tracking_code ? ` · ${item.tracking_code}` : ''}
                              </p>
                            </div>
                            <button onClick={() => setBulkRxQueue(q => q.filter(x => x.id !== item.id))}
                              className="text-gray-300 hover:text-red-500 shrink-0 transition"><X className="w-4 h-4" /></button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  </>
                  )}
                </div>

                <div className="flex gap-3 px-4 py-3 border-t border-gray-100 shrink-0">
                  <button onClick={() => setBulkRxStep('sign')} className="border border-gray-300 text-gray-600 px-4 py-2.5 rounded-xl text-sm hover:bg-gray-50 transition">← Voltar</button>
                  <button onClick={handleBulkRxSubmit} disabled={brxLoading || bulkRxQueue.length === 0}
                    className="flex-1 bg-[#26619c] hover:bg-[#1a4f87] text-white py-2.5 rounded-xl text-sm font-semibold transition disabled:opacity-50">
                    {brxLoading ? 'Registrando…' : `Confirmar ${bulkRxQueue.length} Recebimento(s)`}
                  </button>
                </div>
              </>
            )}

            {/* Step: sign */}
            {bulkRxStep === 'sign' && !brxResult && (
              <>
                <div className="overflow-y-auto flex-1 p-5 flex flex-col gap-4">
                  <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
                    <p className="text-xs font-bold text-amber-700">Etapa 1 de 2 — Identificar entregador</p>
                    <p className="text-xs text-gray-500 mt-0.5">Colete a assinatura antes de liberar o entregador. As encomendas serão bipadas na próxima etapa.</p>
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-xs font-medium text-gray-600">
                        Entregador (opcional)
                        {!delivererOptsLoading && <span className="ml-1 text-gray-400">({delivererOpts.length} cadastrado{delivererOpts.length !== 1 ? 's' : ''})</span>}
                      </label>
                      <button onClick={loadDelivererOpts} className="text-[10px] text-[#26619c] hover:underline">
                        {delivererOptsLoading ? 'Carregando…' : '↻ Atualizar'}
                      </button>
                    </div>
                    {delivererOptsLoading ? (
                      <div className={`${inputCls} text-gray-400 text-xs`}>Carregando entregadores…</div>
                    ) : delivererOpts.length > 0 ? (
                      <select
                        value={delivererOpts.find(d => d.name === brxDelivererName)?.id ?? ''}
                        onChange={e => {
                          const d = delivererOpts.find(x => x.id === e.target.value)
                          if (d) { setBrxDelivererName(d.name); setBrxDelivererSig(d.signature_url ?? '') }
                          else { setBrxDelivererName(''); setBrxDelivererSig('') }
                        }}
                        className={`${inputCls} bg-white`}
                      >
                        <option value="">— Selecione —</option>
                        {delivererOpts.map(d => <option key={d.id} value={d.id}>{d.name}{d.signature_url ? ' ✓' : ''}</option>)}
                      </select>
                    ) : (
                      <input value={brxDelivererName} onChange={e => setBrxDelivererName(e.target.value)}
                        className={inputCls} placeholder="Nome do courier / transportadora" autoFocus />
                    )}
                  </div>
                  {brxDelivererSig ? (
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Assinatura</label>
                      <div className="flex items-center gap-3">
                        <img src={brxDelivererSig} alt="assinatura" className="h-16 border border-gray-200 rounded-lg bg-white object-contain flex-1" />
                        <button onClick={() => setBrxDelivererSig('')} className="text-xs text-red-500 hover:underline shrink-0">Refazer</button>
                      </div>
                    </div>
                  ) : (
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Assinatura do entregador (opcional)</label>
                      <SignaturePad label="Assinatura do entregador" onSave={setBrxDelivererSig}
                        onClear={() => setBrxDelivererSig('')}
                        onUpload={dataUrl => uploadService.uploadBase64(dataUrl, 'packages/signatures')} />
                    </div>
                  )}
                </div>
                <div className="flex gap-3 px-4 py-3 border-t border-gray-100 shrink-0">
                  <button onClick={resetBulkRx} className="border border-gray-300 text-gray-600 px-4 py-2.5 rounded-xl text-sm hover:bg-gray-50 transition">Cancelar</button>
                  <button onClick={() => setBulkRxStep('add')}
                    className="flex-1 bg-[#26619c] hover:bg-[#1a4f87] text-white py-2.5 rounded-xl text-sm font-semibold transition">
                    Próximo → Bipar Encomendas
                  </button>
                </div>
              </>
            )}

            {/* Result */}
            {brxResult && (
              <div className="p-5 flex flex-col gap-4">
                <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-5 text-center">
                  <p className="text-3xl font-bold text-green-700">{brxResult.received}</p>
                  <p className="text-sm text-green-600 mt-1">encomenda(s) registrada(s) com sucesso</p>
                </div>
                {brxResult.errors.length > 0 && (
                  <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3">
                    <p className="text-xs font-semibold text-red-700 mb-1">{brxResult.errors.length} erro(s):</p>
                    <ul className="text-xs text-red-600 flex flex-col gap-0.5">{brxResult.errors.map((e, i) => <li key={i}>· {e}</li>)}</ul>
                  </div>
                )}
                <button onClick={resetBulkRx} className="w-full bg-[#26619c] text-white py-2.5 rounded-xl text-sm font-semibold">Fechar</button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Upgrade guest → member (receive flow) */}
      {rxUpgradeTarget && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm bg-white rounded-2xl shadow-2xl p-5 flex flex-col gap-4">
            <div>
              <h3 className="font-semibold text-gray-900">Atualizar para Associado</h3>
              <p className="text-sm text-gray-500 mt-1">{rxUpgradeTarget.full_name}</p>
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">Telefone <span className="text-red-500">*</span></label>
              <input value={rxUpgradePhone} onChange={e => setRxUpgradePhone(e.target.value)}
                className={inputCls} placeholder="(00) 00000-0000" autoFocus />
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">CEP <span className="text-red-500">*</span></label>
              <input value={rxUpgradeCep} onChange={e => setRxUpgradeCep(e.target.value)}
                className={inputCls} placeholder="00000-000" inputMode="numeric" />
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">CPF <span className="text-gray-400">(opcional)</span></label>
              <input value={rxUpgradeCpf} onChange={e => setRxUpgradeCpf(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleRxUpgrade() }}
                className={inputCls} placeholder="000.000.000-00" />
            </div>
            <div className="flex gap-2">
              <button onClick={() => { setRxUpgradeTarget(null); setRxUpgradeCpf(''); setRxUpgradePhone(''); setRxUpgradeCep('') }}
                className="flex-1 border border-gray-300 text-gray-600 py-2 rounded-xl text-sm">Cancelar</button>
              <button onClick={handleRxUpgrade} disabled={rxUpgradeLoading || !rxUpgradePhone.trim() || !rxUpgradeCep.trim()}
                className="flex-1 bg-[#26619c] text-white py-2 rounded-xl text-sm font-semibold disabled:opacity-50">
                {rxUpgradeLoading ? 'Salvando…' : 'Confirmar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Scan type choice — mobile only */}
      {scanChoice && (
        <div className="fixed inset-0 z-[70] bg-black/50 flex items-end" onClick={() => setScanChoice(null)}>
          <div className="w-full bg-white rounded-t-2xl p-6 pb-8" onClick={e => e.stopPropagation()}>
            <p className="text-center text-sm font-semibold text-gray-700 mb-4">O que você vai escanear?</p>
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => {
                  setScanMode('barcode')
                  setScanChoice(null)
                  if (scanChoice === 'single') setShowScanner(true)
                  else setShowBrxScanner(true)
                }}
                className="flex flex-col items-center gap-2 border-2 border-[#26619c] rounded-xl p-4 text-[#26619c] font-semibold text-sm active:bg-blue-50"
              >
                <span className="text-3xl">▬</span>
                Código de Barras
              </button>
              <button
                onClick={() => {
                  setScanMode('qrcode')
                  setScanChoice(null)
                  if (scanChoice === 'single') setShowScanner(true)
                  else setShowBrxScanner(true)
                }}
                className="flex flex-col items-center gap-2 border-2 border-gray-300 rounded-xl p-4 text-gray-700 font-semibold text-sm active:bg-gray-50"
              >
                <span className="text-3xl">⊞</span>
                QR Code
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Barcode Scanner — single receive */}
      {showScanner && (
        <BarcodeScannerModal
          scanMode={scanMode}
          onScan={(code) => { setTracking(code); setShowScanner(false); document.getElementById('recipient-search')?.focus() }}
          onClose={() => setShowScanner(false)}
        />
      )}

      {/* Barcode Scanner — bulk receive */}
      {showBrxScanner && (
        <BarcodeScannerModal
          scanMode={scanMode}
          onScan={(code) => {
            setShowBrxScanner(false)
            setBrxTracking(code)
            if (brxSelected) {
              requestBrxPhoto(brxSelected, code)
            } else {
              setTimeout(() => brxSearchRef.current?.focus(), 50)
            }
          }}
          onClose={() => setShowBrxScanner(false)}
        />
      )}

      {/* Package Detail */}
      {detailPkg && (
        <PackageDetailModal
          pkg={detailPkg}
          onClose={() => setDetailPkg(null)}
          onRefresh={loadPackages}
          dependents={detailDependents}
          onDeliverClick={() => {
            setDeliveryTarget(detailPkg)
            setRecipientName(detailPkg.resident_name ?? '')
            setDetailPkg(null)
          }}
        />
      )}

      {/* Package Report Modal */}
      {showReport && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl mx-4 max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 shrink-0">
              <h3 className="font-semibold text-gray-900">Relatório de Encomendas</h3>
              <button onClick={() => setShowReport(false)}><X className="w-5 h-5 text-gray-400" /></button>
            </div>
            <div className="p-5 flex flex-col gap-4 overflow-y-auto">
              <div className="flex gap-3 items-end">
                <div className="flex-1">
                  <label className="block text-xs font-medium text-gray-600 mb-1">De</label>
                  <input type="date" value={reportFrom} onChange={e => setReportFrom(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                </div>
                <div className="flex-1">
                  <label className="block text-xs font-medium text-gray-600 mb-1">Até</label>
                  <input type="date" value={reportTo} onChange={e => setReportTo(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                </div>
                <button onClick={loadReport} disabled={loadingReport}
                  className="px-4 py-2 bg-[#26619c] text-white rounded-lg text-sm font-medium disabled:opacity-50">
                  {loadingReport ? '…' : 'Buscar'}
                </button>
              </div>
              {reportData && (
                <div className="flex flex-col gap-3">
                  <div className="grid grid-cols-2 gap-3">
                    {[
                      { label: 'Total', value: reportData.total, color: 'text-gray-800' },
                      { label: 'Entregues', value: reportData.delivered, color: 'text-green-600' },
                      { label: 'Aguardando', value: reportData.received, color: 'text-blue-600' },
                      { label: 'Notificados', value: reportData.notified, color: 'text-amber-600' },
                      { label: 'Devolvidos', value: reportData.returned, color: 'text-gray-600' },
                      { label: 'Com Taxa', value: `${reportData.with_fee} (R$ ${parseFloat(reportData.fee_total).toFixed(2)})`, color: 'text-purple-600' },
                    ].map(({ label, value, color }) => (
                      <div key={label} className="bg-gray-50 rounded-xl p-3">
                        <p className="text-xs text-gray-500">{label}</p>
                        <p className={`text-lg font-bold ${color}`}>{value}</p>
                      </div>
                    ))}
                  </div>
                  {reportData.by_carrier.length > 0 && (
                    <div>
                      <p className="text-xs font-medium text-gray-600 mb-2">Por Transportadora</p>
                      <ul className="flex flex-col gap-1">
                        {reportData.by_carrier.map((c: any) => (
                          <li key={c.carrier} className="flex justify-between text-sm">
                            <span className="text-gray-700">{c.carrier}</span>
                            <span className="font-medium text-gray-800">{c.count}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Address Report Modal */}
      {showAddrReport && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-2xl bg-white rounded-2xl shadow-2xl mx-4 max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 shrink-0">
              <div>
                <h3 className="font-semibold text-gray-900">Encomendas por Rua / CEP</h3>
                {addrReportData && (
                  <p className="text-xs text-gray-500 mt-0.5">{addrReportData.total_awaiting} aguardando retirada</p>
                )}
              </div>
              <button onClick={() => { setShowAddrReport(false); setAddrReportStreet(null) }}>
                <X className="w-5 h-5 text-gray-400" />
              </button>
            </div>
            <div className="p-5 flex flex-col gap-4 overflow-y-auto">
              {loadingAddrReport && (
                <div className="flex justify-center py-8">
                  <div className="w-6 h-6 border-2 border-[#26619c] border-t-transparent rounded-full animate-spin" />
                </div>
              )}
              {addrReportData && !loadingAddrReport && (
                <>
                  <div>
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Por CEP</p>
                    <div className="flex flex-wrap gap-2">
                      {addrReportData.by_cep.map((c: any) => (
                        <span key={c.cep} className="px-3 py-1 bg-blue-50 text-blue-700 rounded-full text-sm font-medium">
                          {c.cep} <span className="font-bold">{c.count}</span>
                        </span>
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Por Rua</p>
                    <div className="flex flex-col gap-2">
                      {addrReportData.by_street.map((s: any) => (
                        <div key={s.street} className="border border-gray-100 rounded-xl overflow-hidden">
                          <button
                            className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-gray-50 transition"
                            onClick={() => setAddrReportStreet(addrReportStreet === s.street ? null : s.street)}
                          >
                            <div className="min-w-0">
                              <span className="font-medium text-gray-800 text-sm">{s.street}</span>
                              {s.neighborhood && <span className="text-xs text-gray-400 ml-2">{s.neighborhood}</span>}
                              {s.cep !== '(sem CEP)' && <span className="text-xs text-gray-400 ml-2">{s.cep}</span>}
                            </div>
                            <span className="text-sm font-bold text-[#26619c] shrink-0 ml-3">{s.count}</span>
                          </button>
                          {addrReportStreet === s.street && (
                            <div className="border-t border-gray-100 divide-y divide-gray-50">
                              {s.packages.map((p: any) => (
                                <div key={p.id} className="px-4 py-2.5 flex items-center justify-between gap-2">
                                  <div className="min-w-0">
                                    <p className="text-sm font-medium text-gray-800 truncate">{p.resident ?? '—'}</p>
                                    <p className="text-xs text-gray-400">
                                      {p.carrier ?? ''}
                                      {p.tracking_code && ` · ${p.tracking_code}`}
                                    </p>
                                  </div>
                                  <div className="text-right shrink-0">
                                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                                      p.status === 'notified' ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700'
                                    }`}>
                                      {p.status === 'notified' ? 'Notificado' : 'Recebido'}
                                    </span>
                                    <p className="text-xs text-gray-400 mt-0.5">{p.received_at}</p>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Photo preview modal */}
      {photoPreviewUrls && (
        <div className="fixed inset-0 z-[80] bg-black/70 flex items-center justify-center p-4" onClick={() => setPhotoPreviewUrls(null)}>
          <div className="relative max-w-lg w-full bg-white rounded-2xl overflow-hidden shadow-2xl" onClick={e => e.stopPropagation()}>
            <button onClick={() => setPhotoPreviewUrls(null)} className="absolute top-3 right-3 z-10 bg-black/40 text-white rounded-full p-1">
              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
            <div className="flex flex-col gap-2 p-2 max-h-[80vh] overflow-y-auto">
              {photoPreviewUrls.map((p, i) => (
                <div key={i} className="flex flex-col gap-1">
                  {p.label && <p className="text-xs text-gray-500 px-1">{p.label}</p>}
                  <img src={p.url} alt={p.label ?? `Foto ${i + 1}`} className="w-full rounded-xl object-contain max-h-[60vh]" />
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Dropdown fixo para "Trocar morador" — fora de qualquer overflow */}
      {cardReassignResults.length > 0 && cardReassignRect && cardReassignPkgId && (
        <div
          className="fixed z-[200] bg-white border border-gray-200 rounded-lg shadow-xl overflow-y-auto max-h-48"
          style={{ top: cardReassignRect.top + 2, left: cardReassignRect.left, width: cardReassignRect.width }}
        >
          {cardReassignResults.map(r => (
            <button key={r.id} type="button" onClick={() => doCardReassign(cardReassignPkgId, r.id, r.full_name)}
              className="w-full text-left px-2 py-2.5 hover:bg-blue-50 flex flex-col border-b last:border-0 border-gray-100">
              <span className="text-xs font-semibold">{r.full_name}</span>
              <span className="text-[10px] text-gray-400">{(r as any).responsible_name ? `Dep. de ${(r as any).responsible_name}` : r.type === 'guest' ? 'Visitante' : 'Associado'}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
