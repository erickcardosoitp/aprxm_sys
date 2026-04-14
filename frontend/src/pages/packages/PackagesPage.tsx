import { useEffect, useRef, useState } from 'react'
import {
  AlertTriangle, Barcode, Camera, FileText, MessageCircle, Package as PackageIcon, Plus,
  Search, Shield, User, UserX, List, Columns, Workflow, X, ChevronDown, Layers,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { SignaturePad } from '../../components/packages/SignaturePad'
import { PhotoCapture } from '../../components/packages/PhotoCapture'
import { BarcodeScannerModal } from '../../components/packages/BarcodeScanner'
import { packageService } from '../../services/packages'
import { maskCpf } from '../../utils'
import { uploadService } from '../../services/upload'
import api from '../../services/api'
import { useAuthStore } from '../../store/authStore'
import type { Package, Resident } from '../../types'

// ─── Constants ────────────────────────────────────────────────────────────────

const STATUS_LABELS: Record<string, string> = {
  received: 'Aguardando', notified: 'Notificado', delivered: 'Entregue',
  returned: 'Devolvido', reversed: 'Estornado',
}
const STATUS_COLORS: Record<string, string> = {
  received: 'bg-blue-100 text-blue-700', notified: 'bg-yellow-100 text-yellow-700',
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
  id: string; comment: string; created_at: string; author_name?: string
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
}

function PackageDetailModal({ pkg, onClose, onDeliverClick, onRefresh }: PackageDetailModalProps) {
  const [events, setEvents] = useState<PackageEvent[]>([])
  const [newComment, setNewComment] = useState('')
  const [addingEvent, setAddingEvent] = useState(false)
  const [notifying, setNotifying] = useState(false)
  const [showReturnForm, setShowReturnForm] = useState(false)
  const [returnReason, setReturnReason] = useState('')
  const [returning, setReturning] = useState(false)
  const [showReversal, setShowReversal] = useState(false)
  const [reversalReason, setReversalReason] = useState('')
  const [reversalPassword, setReversalPassword] = useState('')
  const [reversing, setReversing] = useState(false)

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
      <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h3 className="font-semibold text-gray-900">Detalhes da Encomenda</h3>
          <button onClick={onClose}><X className="w-5 h-5 text-gray-400" /></button>
        </div>

        <div className="px-5 py-4 flex flex-col gap-3">
          {/* Status */}
          <span className={`inline-flex self-start text-xs font-medium px-2 py-0.5 rounded-full ${STATUS_COLORS[pkg.status]}`}>
            {STATUS_LABELS[pkg.status]}
          </span>

          {/* Fields */}
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <p className="text-xs text-gray-500">Destinatário</p>
              <p className="font-medium text-gray-800">{pkg.resident_name ?? '—'}</p>
              {pkg.resident_cpf && <p className="text-xs text-gray-400">CPF: {maskCpf(pkg.resident_cpf)}</p>}
              {pkg.resident_phone && <p className="text-xs text-gray-400">Tel: {pkg.resident_phone}</p>}
            </div>
            {pkg.unit && (
              <div>
                <p className="text-xs text-gray-500">Unidade</p>
                <p className="font-medium text-gray-800">
                  {pkg.unit}{pkg.block ? ` / Bl. ${pkg.block}` : ''}
                </p>
              </div>
            )}
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
              <p className="text-xs font-semibold text-green-700 mb-1.5">Informações de Entrega</p>
              <div className="grid grid-cols-2 gap-2 text-sm mb-2">
                {pkg.delivered_to_name && (
                  <div>
                    <p className="text-xs text-gray-500">Recebido por</p>
                    <p className="font-medium text-gray-800">{pkg.delivered_to_name}</p>
                    {pkg.delivered_to_cpf && <p className="text-xs text-gray-400">CPF: {maskCpf(pkg.delivered_to_cpf)}</p>}
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
                {pkg.deliverer_name && (
                  <div>
                    <p className="text-xs text-gray-500">Entregador</p>
                    <p className="font-medium text-gray-800">{pkg.deliverer_name}</p>
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
                  className="flex-1 border border-gray-300 text-gray-600 py-2 rounded-lg text-sm">Cancelar</button>
                <button onClick={handleReversal} disabled={reversing}
                  className="flex-1 bg-red-600 hover:bg-red-700 text-white py-2 rounded-lg text-sm font-semibold disabled:opacity-50">
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
                  className="flex-1 border border-gray-300 text-gray-600 py-2 rounded-lg text-sm">
                  Cancelar
                </button>
                <button onClick={handleReturn} disabled={returning}
                  className="flex-1 bg-red-600 hover:bg-red-700 text-white py-2 rounded-lg text-sm font-medium disabled:opacity-50">
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

          {/* Events / Observações */}
          <div className="border-t border-gray-100 pt-3 mt-1">
            <p className="text-xs font-semibold text-gray-700 uppercase tracking-wide mb-3">Observações</p>
            {events.length === 0 ? (
              <p className="text-xs text-gray-400 mb-3">Nenhuma observação registrada.</p>
            ) : (
              <ul className="flex flex-col gap-2 mb-3">
                {events.map(ev => (
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

export default function PackagesPage() {
  const { fullName } = useAuthStore()
  const [packages, setPackages] = useState<Package[]>([])
  const [showReceive, setShowReceive] = useState(false)
  const [deliveryTarget, setDeliveryTarget] = useState<Package | null>(null)
  const [loading, setLoading] = useState(false)
  const [filterStatus, setFilterStatus] = useState('')
  const [viewMode, setViewMode] = useState<'list' | 'kanban' | 'esteira'>('list')
  const [detailPkg, setDetailPkg] = useState<Package | null>(null)

  // Filters
  const [filterQ, setFilterQ] = useState('')
  const [filterDateFrom, setFilterDateFrom] = useState('')
  const [filterDateTo, setFilterDateTo] = useState('')

  // Report state
  const [showReport, setShowReport] = useState(false)
  const [reportFrom, setReportFrom] = useState(new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10))
  const [reportTo, setReportTo] = useState(new Date().toISOString().slice(0, 10))
  const [reportData, setReportData] = useState<any>(null)
  const [loadingReport, setLoadingReport] = useState(false)

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
  const [tracking, setTracking] = useState('')
  const [carrier, setCarrier] = useState('')
  const [photos, setPhotos] = useState<{ url: string; label: string; taken_at: string }[]>([])
  const barcodeRef = useRef<HTMLInputElement>(null)
  const [showScanner, setShowScanner] = useState(false)

  // Delivery flow
  const [recipientName, setRecipientName] = useState('')
  const [recipientSig, setRecipientSig] = useState('')
  const [proofResidenceUrl, setProofResidenceUrl] = useState('')
  const [recipientIdPhoto, setRecipientIdPhoto] = useState('')
  const [deliveryPersonName, setDeliveryPersonName] = useState('')
  const [isThirdParty, setIsThirdParty] = useState(false)
  const [ownerIdPhoto, setOwnerIdPhoto] = useState('')
  const [pickerIdPhoto, setPickerIdPhoto] = useState('')
  const [pickerPhone, setPickerPhone] = useState('')
  const [deliveryPaymentMethodId, setDeliveryPaymentMethodId] = useState('')
  const [paymentMethods, setPaymentMethods] = useState<{ id: string; name: string }[]>([])

  // Upgrade guest to member modal
  const [showUpgrade, setShowUpgrade] = useState(false)
  const [upgradeCpf, setUpgradeCpf] = useState('')
  const [upgradeLoading, setUpgradeLoading] = useState(false)
  // Reassign package to existing resident
  const [reassignSearch, setReassignSearch] = useState('')
  const [reassignResults, setReassignResults] = useState<{ id: string; full_name: string; type: string; unit?: string; responsible_id?: string; responsible_name?: string }[]>([])
  const [reassignLoading, setReassignLoading] = useState(false)

  const searchReassign = async (q: string) => {
    setReassignSearch(q)
    if (q.length < 2) { setReassignResults([]); return }
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

  const handleUpgradeToMember = async () => {
    if (!deliveryTarget?.resident_id) return
    if (!upgradeCpf.trim()) { toast.error('CPF obrigatório para associado.'); return }
    setUpgradeLoading(true)
    try {
      await api.put(`/residents/${deliveryTarget.resident_id}`, {
        type: 'member', cpf: upgradeCpf.trim(), status: 'active',
        is_member_confirmed: true, terms_accepted: true, lgpd_accepted: true,
      })
      toast.success('Morador cadastrado como associado!')
      setShowUpgrade(false); setUpgradeCpf('')
      loadPackages()
    } catch (e: any) {
      toast.error(apiErr(e, 'Erro ao atualizar cadastro.'))
    } finally { setUpgradeLoading(false) }
  }

  useEffect(() => {
    if (!deliveryTarget) return
    api.get<{ id: string; name: string }[]>('/finance/payment-methods').then(r => setPaymentMethods(r.data)).catch(() => {})
  }, [deliveryTarget])

  // Bulk delivery flow
  const [showBulkDeliver, setShowBulkDeliver] = useState(false)
  const [bulkStep, setBulkStep] = useState<'select' | 'sign'>('select')
  const [bulkSelected, setBulkSelected] = useState<Set<string>>(new Set())
  const [bulkRecipientName, setBulkRecipientName] = useState('')
  const [bulkSig, setBulkSig] = useState('')
  const [bulkDeliveryPersonName, setBulkDeliveryPersonName] = useState('')
  const [bulkLoading, setBulkLoading] = useState(false)
  const [bulkResult, setBulkResult] = useState<{ delivered: number; errors: string[]; items: any[] } | null>(null)

  const pendingPackages = packages.filter(p => p.status === 'received' || p.status === 'notified' || p.status === 'reversed')

  const resetBulk = () => {
    setShowBulkDeliver(false); setBulkStep('select'); setBulkSelected(new Set())
    setBulkRecipientName(''); setBulkSig(''); setBulkDeliveryPersonName('')
    setBulkLoading(false); setBulkResult(null)
  }

  const handleBulkDeliver = async () => {
    if (!bulkRecipientName || !bulkSig) { toast.error('Nome e assinatura obrigatórios.'); return }
    if (bulkSelected.size === 0) { toast.error('Selecione ao menos uma encomenda.'); return }
    setBulkLoading(true)
    try {
      const res = await api.post<{ delivered: number; errors: string[]; items: any[] }>('/packages/bulk-deliver', {
        package_ids: Array.from(bulkSelected),
        delivered_to_name: bulkRecipientName,
        signature_url: bulkSig,
        delivery_person_name: bulkDeliveryPersonName || fullName || undefined,
      })
      setBulkResult(res.data)
      loadPackages()
      toast.success(`${res.data.delivered} encomenda(s) entregue(s)!`)
    } catch (e: any) {
      toast.error(apiErr(e, 'Erro na entrega múltipla.'))
    } finally {
      setBulkLoading(false)
    }
  }

  // Receive mode choice
  const [showReceiveMode, setShowReceiveMode] = useState(false)

  // Bulk receive flow
  const [showBulkReceive, setShowBulkReceive] = useState(false)
  const [bulkRxStep, setBulkRxStep] = useState<'add' | 'sign'>('add')
  type BulkRxItem = { id: string; tracking_code: string; carrier_name: string; resident_id?: string; resident_name: string; resident_type?: string; unit?: string; block?: string; photo_urls: { url: string; label: string; taken_at: string }[] }
  type BrxPending = { resident: Resident; tracking: string }
  const [bulkRxQueue, setBulkRxQueue] = useState<BulkRxItem[]>([])
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
  const brxBarcodeRef = useRef<HTMLInputElement>(null)
  const brxSearchRef = useRef<HTMLInputElement>(null)

  const searchBrxResidents = async (q: string) => {
    if (q.length < 2) { setBrxResults([]); return }
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
      unit: (resident as any).unit,
      block: (resident as any).block,
      photo_urls: photoUrls,
    }
    setBulkRxQueue(q => [...q, entry])
    setBrxPending(null)
    setBrxLastAdded(resident.full_name + (tracking ? ` · ${tracking}` : ''))
    setBrxTracking('')
    setBrxSearch('')
    setBrxResults([])
    setBrxSelected(null)
    setTimeout(() => { brxBarcodeRef.current?.focus(); setBrxLastAdded(null) }, 1200)
  }

  const requestBrxPhoto = (resident: Resident, tracking: string) => {
    setBrxPending({ resident, tracking })
    setBrxTracking('')
    setBrxSearch('')
    setBrxResults([])
    setBrxSelected(null)
  }

  const handleBarcodeEnter = () => {
    if (brxSelected) {
      requestBrxPhoto(brxSelected, brxTracking)
    } else {
      setTimeout(() => brxSearchRef.current?.focus(), 30)
    }
  }

  const selectBrxResident = (r: Resident) => {
    if (brxTracking.trim()) {
      requestBrxPhoto(r, brxTracking)
    } else {
      setBrxSelected(r)
      setBrxSearch(r.full_name)
      setBrxResults([])
      setTimeout(() => brxBarcodeRef.current?.focus(), 30)
    }
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
          unit: item.unit, block: item.block,
          carrier_name: item.carrier_name || undefined,
          tracking_code: item.tracking_code || undefined,
          photo_urls: item.photo_urls,
          deliverer_name: brxDelivererName || undefined,
          deliverer_signature_url: brxDelivererSig || undefined,
        })
        received++
      } catch {
        errors.push(item.resident_name + (item.tracking_code ? ` (${item.tracking_code})` : ''))
      }
    }
    setBrxResult({ received, errors })
    loadPackages()
    setBrxLoading(false)
  }

  const resetBulkRx = () => {
    setShowBulkReceive(false); setBulkRxStep('add'); setBulkRxQueue([])
    setBrxDelivererName(''); setBrxDelivererSig(''); setBrxLoading(false); setBrxResult(null)
    setBrxTracking(''); setBrxCarrier(''); setBrxSearch(''); setBrxResults([])
    setBrxSelected(null); setBrxLastAdded(null); setShowBrxScanner(false); setBrxPending(null)
    setBrxGuestName(''); setBrxShowGuest(false)
  }

  // Bulk receive — guest creation
  const [brxShowGuest, setBrxShowGuest] = useState(false)
  const [brxGuestName, setBrxGuestName] = useState('')
  const [brxGuestLoading, setBrxGuestLoading] = useState(false)

  const createBrxGuest = async () => {
    if (!brxGuestName.trim()) return
    if (newResType === 'dependent' && !newResResponsible) { toast.error('Selecione o responsável.'); return }
    setBrxGuestLoading(true)
    try {
      const payload: any = {
        status: 'active', full_name: brxGuestName.trim(),
        is_member_confirmed: newResType !== 'guest', terms_accepted: newResType !== 'guest', lgpd_accepted: true,
        type: newResType === 'guest' ? 'guest' : 'member',
      }
      if (newResType === 'member' && newResCpf.trim()) payload.cpf = newResCpf.trim()
      if (newResType === 'dependent' && newResResponsible) payload.responsible_id = newResResponsible.id
      const res = await api.post<Resident>('/residents', payload)
      setBrxShowGuest(false); setBrxGuestName('')
      setNewResType('guest'); setNewResCpf(''); setNewResResponsible(null); setNewResResponsibleSearch(''); setNewResResponsibleResults([])
      requestBrxPhoto(res.data, brxTracking)
    } catch (e: any) {
      toast.error(apiErr(e, 'Erro ao criar.'))
    } finally { setBrxGuestLoading(false) }
  }

  // Upgrade guest → member (receive flow)
  const [rxUpgradeTarget, setRxUpgradeTarget] = useState<Resident | null>(null)
  const [rxUpgradeCpf, setRxUpgradeCpf] = useState('')
  const [rxUpgradeLoading, setRxUpgradeLoading] = useState(false)

  const handleRxUpgrade = async () => {
    if (!rxUpgradeTarget) return
    if (!rxUpgradeCpf.trim()) { toast.error('CPF obrigatório.'); return }
    setRxUpgradeLoading(true)
    try {
      const res = await api.put<Resident>(`/residents/${rxUpgradeTarget.id}`, {
        type: 'member', cpf: rxUpgradeCpf.trim(), status: 'active',
        is_member_confirmed: true, terms_accepted: true, lgpd_accepted: true,
      })
      toast.success('Cadastro atualizado para Associado!')
      const updated = res.data
      setRxUpgradeTarget(null); setRxUpgradeCpf('')
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

  // Carriers & Deliverers catalog
  type CarrierOpt = { id: string; name: string }
  type DelivererOpt = { id: string; name: string; carrier_id: string | null; signature_url: string | null }
  const [carrierOpts, setCarrierOpts] = useState<CarrierOpt[]>([])
  const [delivererOpts, setDelivererOpts] = useState<DelivererOpt[]>([])

  useEffect(() => {
    api.get<CarrierOpt[]>('/carriers').then(r => setCarrierOpts(r.data)).catch(() => {})
    api.get<DelivererOpt[]>('/carriers/deliverers').then(r => setDelivererOpts(r.data)).catch(() => {})
  }, [])

  const loadPackages = async () => {
    try {
      const params: Record<string, string> = {}
      if (filterStatus) params.status = filterStatus
      if (filterQ.trim()) params.q = filterQ.trim()
      if (filterDateFrom) params.date_from = filterDateFrom
      if (filterDateTo) params.date_to = filterDateTo
      const res = await api.get<Package[]>('/packages', { params })
      setPackages(res.data)
    } catch {
      toast.error('Erro ao carregar encomendas.')
    }
  }

  useEffect(() => { loadPackages() }, [filterStatus, filterQ, filterDateFrom, filterDateTo])
  useEffect(() => { if (showReceive && step === 'recipient') barcodeRef.current?.focus() }, [showReceive, step])
  useEffect(() => { if (showBulkReceive && bulkRxStep === 'add') setTimeout(() => brxBarcodeRef.current?.focus(), 100) }, [showBulkReceive, bulkRxStep])

  const searchResidents = async (q: string) => {
    if (q.length < 2) { setSearchResults([]); setSearchEmpty(false); setShowGuestForm(false); return }
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
      const res = await packageService.lookupCep(clean)
      const d = res.data
      setGuest(g => ({ ...g, address_street: d.street, address_district: d.district, address_city: d.city, address_state: d.state }))
    } catch { /* silent */ } finally { setCepLoading(false) }
  }

  const searchResponsible = async (q: string) => {
    if (q.length < 2) { setNewResResponsibleResults([]); return }
    try {
      const res = await api.get<Resident[]>('/residents/search', { params: { q } })
      setNewResResponsibleResults(res.data.filter(r => r.type === 'member' && !('responsible_id' in r && (r as any).responsible_id)).slice(0, 6))
    } catch { }
  }

  const createGuest = async () => {
    if (!guest.full_name.trim()) { toast.error('Nome é obrigatório.'); return }
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
        unit: (selectedRecipient as any)?.unit ?? undefined,
        block: (selectedRecipient as any)?.block ?? undefined,
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
    setShowReceive(false); setStep('recipient'); setRecipientSearch('')
    setSearchResults([]); setSelectedRecipient(null); setShowGuestForm(false); setSearchEmpty(false)
    setGuest(emptyGuest()); setTracking(''); setCarrier(''); setPhotos([])
    setDelivererName(''); setDelivererSig('')
    setNewResType('guest'); setNewResCpf(''); setNewResResponsibleSearch(''); setNewResResponsible(null); setNewResResponsibleResults([])
  }

  const handleDeliver = async () => {
    if (!deliveryTarget) return
    const isGuest = !deliveryTarget.resident_id || deliveryTarget.resident_type === 'guest'
    if (!recipientName || !recipientSig) { toast.error('Nome e assinatura do recebedor obrigatórios.'); return }
    if (isThirdParty && !ownerIdPhoto) { toast.error('Identidade do dono da encomenda obrigatória.'); return }
    if (isThirdParty && !pickerIdPhoto) { toast.error('Identidade de quem está retirando obrigatória.'); return }
    if (isThirdParty && !pickerPhone.trim()) { toast.error('Telefone de contato obrigatório.'); return }
    setLoading(true)
    try {
      const res = await packageService.deliver(deliveryTarget.id, {
        delivered_to_name: recipientName,
        signature_url: recipientSig,
        delivered_to_resident_id: deliveryTarget.resident_id,
        proof_of_residence_url: proofResidenceUrl || undefined,
        recipient_id_photo_url: recipientIdPhoto || undefined,
        delivery_person_name: deliveryPersonName || fullName || undefined,
        third_party_pickup: isThirdParty,
        owner_id_photo_url: ownerIdPhoto || undefined,
        picker_id_photo_url: pickerIdPhoto || undefined,
        picker_phone: pickerPhone.trim() || undefined,
        payment_method_id: deliveryPaymentMethodId || undefined,
      })
      const pkg = res.data as any
      toast.success(pkg.has_delivery_fee
        ? `Entregue! Taxa R$ ${parseFloat(pkg.delivery_fee_amount).toFixed(2)} cobrada.`
        : 'Encomenda entregue!')
      setDeliveryTarget(null)
      resetDelivery()
      loadPackages()
    } catch (e: any) {
      toast.error(apiErr(e, 'Erro na entrega.'))
    } finally {
      setLoading(false)
    }
  }

  const resetDelivery = () => {
    setRecipientName(''); setRecipientSig('')
    setProofResidenceUrl(''); setRecipientIdPhoto(''); setDeliveryPersonName('')
    setIsThirdParty(false); setOwnerIdPhoto(''); setPickerIdPhoto(''); setPickerPhone('')
    setDeliveryPaymentMethodId(''); setShowUpgrade(false); setUpgradeCpf('')
  }

  const pendingCount = packages.filter(p => p.status === 'received' || p.status === 'notified').length
  const clearFilters = () => { setFilterQ(''); setFilterDateFrom(''); setFilterDateTo(''); setFilterStatus('') }

  const PackageCard = ({ pkg }: { pkg: Package }) => (
    <div
      className="px-4 py-3 hover:bg-gray-50 cursor-pointer transition"
      onClick={() => setDetailPkg(pkg)}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium text-gray-800 flex items-center gap-1.5 flex-wrap">
            <span>{pkg.resident_name ?? '—'}{pkg.unit ? ` · Unid. ${pkg.unit}${pkg.block ? `/Bl.${pkg.block}` : ''}` : ''}</span>
            {pkg.resident_type === 'guest' && <span className="text-[10px] bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded-full font-semibold shrink-0">VISITANTE</span>}
          </p>
          <p className="text-xs text-gray-400 mt-0.5">
            {pkg.carrier_name ?? '—'}{pkg.tracking_code ? ` · ${pkg.tracking_code}` : ''}
          </p>
          {(pkg.resident_address_street || pkg.resident_cep) && (
            <p className="text-xs text-gray-400">
              {pkg.resident_address_street ? `${pkg.resident_address_street}${pkg.resident_address_number ? `, ${pkg.resident_address_number}` : ''}` : `CEP: ${pkg.resident_cep}`}
            </p>
          )}
          <p className="text-xs text-gray-400">
            {new Date(pkg.received_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[pkg.status]}`}>{STATUS_LABELS[pkg.status]}</span>
          {(pkg.status === 'received' || pkg.status === 'notified' || pkg.status === 'reversed') && (
            <button
              onClick={e => { e.stopPropagation(); setDeliveryTarget(pkg); setRecipientName(pkg.resident_name ?? ''); setDeliveryPersonName(fullName ?? '') }}
              className="text-xs text-[#26619c] hover:underline"
            >
              Entregar
            </button>
          )}
          {pkg.has_delivery_fee && <span className="text-xs text-amber-600 font-medium">Taxa R$ {parseFloat(pkg.delivery_fee_amount ?? '2.50').toFixed(2)}</span>}
        </div>
      </div>
    </div>
  )

  return (
    <div className="flex flex-col gap-5 p-4 max-w-3xl mx-auto">
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

      {/* Filter bar */}
      <div className="flex flex-col gap-2">
        <div className="flex gap-2 items-center">
          <div className="relative flex-1 min-w-0">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              value={filterQ}
              onChange={e => setFilterQ(e.target.value)}
              placeholder="Buscar nome, rastreio…"
              className="w-full pl-9 pr-4 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#26619c]/30 focus:border-[#26619c]"
            />
          </div>
          {(filterQ || filterDateFrom || filterDateTo || filterStatus) && (
            <button onClick={clearFilters} className="text-xs text-gray-500 hover:text-red-500 flex items-center gap-1 shrink-0">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
        <div className="flex gap-2 items-center">
          <input
            type="date"
            value={filterDateFrom}
            onChange={e => setFilterDateFrom(e.target.value)}
            title="Data inicial"
            className="flex-1 min-w-0 border border-gray-200 rounded-xl px-2 py-1.5 text-xs text-gray-600 focus:outline-none focus:ring-2 focus:ring-[#26619c]/30 focus:border-[#26619c]"
          />
          <span className="text-gray-400 text-xs shrink-0">até</span>
          <input
            type="date"
            value={filterDateTo}
            onChange={e => setFilterDateTo(e.target.value)}
            title="Data final"
            className="flex-1 min-w-0 border border-gray-200 rounded-xl px-2 py-1.5 text-xs text-gray-600 focus:outline-none focus:ring-2 focus:ring-[#26619c]/30 focus:border-[#26619c]"
          />
        </div>

        {/* Status pills — only in list view */}
        {viewMode === 'list' && (
          <div className="flex gap-2 overflow-x-auto pb-1">
            {(['', 'received', 'notified', 'delivered', 'returned'] as const).map((s) => (
              <button key={s} onClick={() => setFilterStatus(s)}
                className={`whitespace-nowrap px-3 py-1.5 rounded-full text-xs font-medium transition ${filterStatus === s ? 'bg-[#26619c] text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                {s === '' ? 'Todos' : STATUS_LABELS[s]}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* List View */}
      {viewMode === 'list' && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          {packages.length === 0
            ? <div className="p-8 text-center text-gray-400 text-sm">Nenhuma encomenda encontrada.</div>
            : <ul className="divide-y divide-gray-100">
                {packages.map((pkg) => (
                  <li key={pkg.id}><PackageCard pkg={pkg} /></li>
                ))}
              </ul>
          }
        </div>
      )}

      {/* Kanban View */}
      {viewMode === 'kanban' && (
        <div className="flex gap-3 overflow-x-auto pb-4 -mx-4 px-4">
          {KANBAN_STATUSES.map(status => {
            const col = packages.filter(p => p.status === status)
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
                        {pkg.unit && <p className="text-xs text-gray-400">Unid. {pkg.unit}{pkg.block ? ` / Bl. ${pkg.block}` : ''}</p>}
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
      {viewMode === 'esteira' && (
        <div className="flex flex-col gap-3">
          <div className="flex gap-2 overflow-x-auto pb-1">
            {(['', 'received', 'notified', 'delivered', 'returned'] as const).map((s) => (
              <button key={s} onClick={() => setFilterStatus(s)}
                className={`whitespace-nowrap px-3 py-1.5 rounded-full text-xs font-medium transition ${filterStatus === s ? 'bg-[#26619c] text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                {s === '' ? 'Todos' : STATUS_LABELS[s]}
              </button>
            ))}
          </div>
          {packages.length === 0 ? (
            <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-400 text-sm">Nenhuma encomenda encontrada.</div>
          ) : (
            packages.map(pkg => (
              <div
                key={pkg.id}
                className="bg-white rounded-xl border border-gray-200 shadow-sm px-4 py-3 cursor-pointer hover:border-[#26619c]/40 transition"
                onClick={() => setDetailPkg(pkg)}
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-gray-800 truncate">
                      {pkg.resident_name ?? '—'}
                      {pkg.unit ? ` · Unid. ${pkg.unit}${pkg.block ? `/Bl.${pkg.block}` : ''}` : ''}
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
            ))
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
                    onClick={() => setShowScanner(true)}
                    title="Escanear com câmera"
                    className="flex items-center justify-center gap-1.5 bg-[#26619c] hover:bg-[#1a4f87] text-white px-3 rounded-lg text-sm font-medium transition shrink-0"
                  >
                    <Camera className="w-4 h-4" />
                    <span className="text-xs">Câmera</span>
                  </button>
                </div>

                <div className="relative mb-2">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input
                    id="recipient-search"
                    value={recipientSearch}
                    onChange={e => { setRecipientSearch(e.target.value); setSearchEmpty(false); setShowGuestForm(false); searchResidents(e.target.value) }}
                    className={`${inputCls} pl-9`}
                    placeholder="Buscar por nome, telefone, CPF ou CEP…"
                  />
                </div>

                {searchResults.length > 0 && (
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
                                {(r as any).unit ? ` · Unid. ${(r as any).unit}` : ''}
                                {r.phone_primary ? ` · ${r.phone_primary}` : ''}
                              </p>
                            </div>
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                )}

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

                {/* Sugestão de não associado — só aparece quando busca retornou vazio */}
                {searchEmpty && !selectedRecipient && (
                  <button
                    onClick={() => { setGuest(g => ({ ...g, full_name: recipientSearch })); setShowGuestForm(true) }}
                    className="w-full flex items-center gap-2 border border-dashed border-orange-300 bg-orange-50 rounded-lg px-3 py-2.5 text-sm text-orange-600 hover:border-orange-400 transition mb-3"
                  >
                    <UserX className="w-4 h-4" /> Não encontrado — cadastrar como não associado
                  </button>
                )}

                {/* Botão fixo de não associado — sempre visível */}
                {!searchEmpty && !selectedRecipient && (
                  <button
                    onClick={() => { setShowGuestForm(!showGuestForm); setGuest(emptyGuest()) }}
                    className="w-full flex items-center gap-2 border border-dashed border-gray-300 rounded-lg px-3 py-2.5 text-sm text-gray-500 hover:border-[#26619c] hover:text-[#26619c] transition mb-3"
                  >
                    <UserX className="w-4 h-4" /> Não associado / Visitante
                  </button>
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
                    <input value={guest.full_name} onChange={e => setGuest(g => ({ ...g, full_name: e.target.value }))}
                      className={inputCls} placeholder="Nome completo *" autoFocus />
                    {newResType === 'member' && (
                      <input value={newResCpf} onChange={e => setNewResCpf(e.target.value)}
                        className={inputCls} placeholder="CPF (opcional)" />
                    )}
                    {newResType === 'dependent' && (
                      <div className="flex flex-col gap-1">
                        <label className="text-xs text-gray-600">Responsável (associado titular) *</label>
                        <input value={newResResponsibleSearch}
                          onChange={e => { setNewResResponsibleSearch(e.target.value); setNewResResponsible(null); searchResponsible(e.target.value) }}
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
                        <input value={guest.phone_primary} onChange={e => setGuest(g => ({ ...g, phone_primary: e.target.value }))}
                          className={inputCls} placeholder="Telefone (opcional)" type="tel" />
                        <div className="grid grid-cols-3 gap-2">
                          <div>
                            <input value={guest.address_cep}
                              onChange={e => { setGuest(g => ({ ...g, address_cep: e.target.value })); lookupCep(e.target.value) }}
                              className={inputCls} placeholder="CEP" maxLength={9} />
                            {cepLoading && <p className="text-xs text-gray-400 mt-0.5">Buscando…</p>}
                          </div>
                          <input value={guest.address_number} onChange={e => setGuest(g => ({ ...g, address_number: e.target.value }))} className={inputCls} placeholder="Número" />
                          <input value={guest.address_complement} onChange={e => setGuest(g => ({ ...g, address_complement: e.target.value }))} className={inputCls} placeholder="Compl." />
                        </div>
                        <input value={guest.address_street} onChange={e => setGuest(g => ({ ...g, address_street: e.target.value }))} className={inputCls} placeholder="Rua (opcional)" />
                        <div className="grid grid-cols-2 gap-2">
                          <input value={guest.address_district} onChange={e => setGuest(g => ({ ...g, address_district: e.target.value }))} className={inputCls} placeholder="Bairro" />
                          <input value={guest.address_city} onChange={e => setGuest(g => ({ ...g, address_city: e.target.value }))} className={inputCls} placeholder="Cidade" />
                        </div>
                      </>
                    )}
                    <button onClick={createGuest} disabled={loading}
                      className={`w-full text-white py-2 rounded-lg text-sm font-medium transition disabled:opacity-50 ${newResType === 'guest' ? 'bg-orange-500 hover:bg-orange-600' : 'bg-[#26619c] hover:bg-[#1a4f87]'}`}>
                      {loading ? 'Salvando…' : newResType === 'guest' ? 'Salvar Visitante' : newResType === 'member' ? 'Salvar Associado' : 'Salvar Dependente'}
                    </button>
                  </div>
                )}

                <div className="flex gap-3">
                  <button onClick={resetReceive} className="flex-1 border border-gray-300 text-gray-600 py-2.5 rounded-xl text-sm hover:bg-gray-50 transition">Cancelar</button>
                  <button onClick={() => setStep('details')} disabled={!selectedRecipient}
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
                      <button onClick={() => { setRxUpgradeTarget(selectedRecipient); setRxUpgradeCpf('') }}
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
                        {delivererOpts.length > 0 ? (
                          <select
                            value={delivererOpts.find(d => d.name === delivererName)?.id ?? ''}
                            onChange={e => {
                              const d = delivererOpts.find(x => x.id === e.target.value)
                              if (d) { setDelivererName(d.name); if (d.signature_url) setDelivererSig(d.signature_url) }
                              else { setDelivererName(''); setDelivererSig('') }
                            }}
                            className={`${inputCls} bg-white`}
                          >
                            <option value="">— Selecione —</option>
                            {delivererOpts.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                          </select>
                        ) : (
                          <input value={delivererName} onChange={e => setDelivererName(e.target.value)} className={inputCls} placeholder="Nome do courier/transportadora" />
                        )}
                      </div>
                      {delivererOpts.length === 0 && (
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
                      {delivererOpts.length > 0 && delivererSig && (
                        <div>
                          <label className="block text-xs text-gray-600 mb-1">Assinatura</label>
                          <img src={delivererSig} alt="assinatura" className="h-16 border border-gray-200 rounded-lg bg-white object-contain" />
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
      {deliveryTarget && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-black/40">
          <div className="flex min-h-full items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="w-full max-w-lg bg-white rounded-t-2xl sm:rounded-2xl shadow-xl">
            {/* Modal header */}
            <div className="bg-white border-b border-gray-100 px-5 py-4 flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-gray-900">Registrar Entrega</h3>
                <p className="text-xs text-gray-400 mt-0.5">
                  {deliveryTarget.resident_name ?? `Unid. ${deliveryTarget.unit}`}
                  {deliveryTarget.tracking_code ? ` · ${deliveryTarget.tracking_code}` : ''}
                </p>
              </div>
              <button onClick={() => { setDeliveryTarget(null); resetDelivery() }}>
                <X className="w-5 h-5 text-gray-400" />
              </button>
            </div>

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
              {/* Third-party toggle */}
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
                <p className="text-xs font-semibold text-amber-900 mb-2 flex items-center gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
                  Quem está retirando?
                </p>
                <div className="flex gap-2">
                  <button type="button"
                    onClick={() => setIsThirdParty(false)}
                    className={`flex-1 py-2 rounded-lg text-xs font-semibold border transition ${!isThirdParty ? 'bg-[#26619c] text-white border-[#26619c]' : 'border-gray-300 text-gray-600'}`}>
                    O próprio morador
                  </button>
                  <button type="button"
                    onClick={() => setIsThirdParty(true)}
                    className={`flex-1 py-2 rounded-lg text-xs font-semibold border transition ${isThirdParty ? 'bg-amber-500 text-white border-amber-500' : 'border-gray-300 text-gray-600'}`}>
                    Outra pessoa
                  </button>
                </div>
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

              {/* Third-party extra docs */}
              {isThirdParty && (
                <div className="rounded-xl border border-amber-200 overflow-hidden">
                  <div className="bg-amber-500 px-4 py-2.5 flex items-center gap-2">
                    <Shield className="w-4 h-4 text-white" />
                    <span className="text-sm font-semibold text-white">Documentação — Retirada por Terceiros</span>
                  </div>
                  <div className="p-4 flex flex-col gap-4">
                    <div>
                      <p className="text-xs font-semibold text-gray-700 mb-2">
                        Identidade do dono da encomenda (xerox ou PDF) <span className="text-red-500">*</span>
                      </p>
                      <PhotoCapture
                        label="RG/CNH do morador dono"
                        onCapture={entry => setOwnerIdPhoto(entry.url)}
                        onUpload={file => uploadService.uploadFile(file, 'packages/ids')}
                      />
                      {ownerIdPhoto && <p className="text-xs text-green-600 mt-1">✓ Documento registrado</p>}
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-gray-700 mb-2">
                        Identidade de quem está retirando <span className="text-red-500">*</span>
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
                        Telefone de contato de quem retira <span className="text-red-500">*</span>
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
                      <input value={reassignSearch} onChange={e => searchReassign(e.target.value)}
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
                                {r.unit ? ` · Unid. ${r.unit}` : ''}
                              </span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Upgrade current guest to member */}
                  {!showUpgrade ? (
                    <button onClick={() => setShowUpgrade(true)}
                      className="text-xs text-[#26619c] underline self-start">
                      Ou cadastrar este visitante como associado
                    </button>
                  ) : (
                    <div className="flex flex-col gap-2">
                      <input value={upgradeCpf} onChange={e => setUpgradeCpf(e.target.value)}
                        className={inputCls} placeholder="CPF do morador *" />
                      <div className="flex gap-2">
                        <button onClick={() => { setShowUpgrade(false); setUpgradeCpf('') }}
                          className="flex-1 border border-gray-300 text-gray-600 py-1.5 rounded-lg text-xs">Cancelar</button>
                        <button onClick={handleUpgradeToMember} disabled={upgradeLoading}
                          className="flex-1 bg-[#26619c] text-white py-1.5 rounded-lg text-xs font-semibold disabled:opacity-50">
                          {upgradeLoading ? '…' : 'Confirmar'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Payment method for fee */}
              {(deliveryTarget?.resident_type === 'guest') && paymentMethods.length > 0 && (
                <div>
                  <label className="block text-xs text-gray-600 mb-1">Forma de pagamento da taxa</label>
                  <select value={deliveryPaymentMethodId} onChange={e => setDeliveryPaymentMethodId(e.target.value)}
                    className={inputCls}>
                    <option value="">Selecione (opcional)</option>
                    {paymentMethods.map(pm => (
                      <option key={pm.id} value={pm.id}>{pm.name}</option>
                    ))}
                  </select>
                </div>
              )}

              {/* Recipient section */}
              <div className="rounded-xl border border-blue-200 overflow-hidden">
                <div className="bg-blue-600 px-4 py-2.5 flex items-center gap-2">
                  <User className="w-4 h-4 text-white" />
                  <span className="text-sm font-semibold text-white">
                    {isThirdParty ? 'Portador (quem está retirando)' : 'Recebedor (Morador)'}
                  </span>
                </div>
                <div className="p-4 flex flex-col gap-3">
                  <div>
                    <label className="block text-xs text-gray-600 mb-1">Nome completo <span className="text-red-500">*</span></label>
                    <input value={recipientName} onChange={e => setRecipientName(e.target.value)} className={inputCls}
                      placeholder={isThirdParty ? 'Nome de quem está retirando' : 'Nome de quem está recebendo'} />
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
                <div className="p-5 flex flex-col gap-3 max-h-[60vh] overflow-y-auto">
                  {pendingPackages.length === 0 ? (
                    <p className="text-sm text-gray-400 text-center py-6">Nenhuma encomenda pendente.</p>
                  ) : (
                    <>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs text-gray-500">{bulkSelected.size} selecionada(s)</span>
                        <button
                          onClick={() => setBulkSelected(bulkSelected.size === pendingPackages.length
                            ? new Set()
                            : new Set(pendingPackages.map(p => p.id)))}
                          className="text-xs text-[#26619c] hover:underline"
                        >
                          {bulkSelected.size === pendingPackages.length ? 'Desmarcar todas' : 'Selecionar todas'}
                        </button>
                      </div>
                      {pendingPackages.map(pkg => (
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
                              {pkg.unit ? ` · Unid. ${pkg.unit}${pkg.block ? `/Bl.${pkg.block}` : ''}` : ''}
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
                </div>
                <div className="flex gap-3 px-5 pb-5 pt-4 border-t border-gray-100">
                  <button onClick={() => setBulkStep('select')} className="flex-1 border border-gray-300 text-gray-600 py-2.5 rounded-xl text-sm hover:bg-gray-50 transition">← Voltar</button>
                  <button
                    onClick={handleBulkDeliver}
                    disabled={bulkLoading || !bulkSig || !bulkRecipientName}
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
                      {bulkResult.errors.map((e, i) => <li key={i}>{e}</li>)}
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
            <button onClick={() => { setShowReceiveMode(false); setShowBulkReceive(true); setBulkRxStep('add') }}
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
          <div className="w-full max-w-lg bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl flex flex-col max-h-[92vh]">

            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 shrink-0">
              <div className="flex items-center gap-2">
                <Layers className="w-4 h-4 text-amber-500" />
                <div>
                  <h3 className="font-semibold text-gray-900 text-sm">Recebimento Múltiplo</h3>
                  <p className="text-xs text-gray-400">
                    {bulkRxStep === 'add'
                      ? bulkRxQueue.length === 0 ? 'Bipe ou busque cada encomenda' : `${bulkRxQueue.length} na fila — continue bipando`
                      : `${bulkRxQueue.length} encomenda(s) · dados do entregador`}
                  </p>
                </div>
              </div>
              <button onClick={resetBulkRx}><X className="w-5 h-5 text-gray-400" /></button>
            </div>

            {/* Step: add */}
            {bulkRxStep === 'add' && !brxResult && (
              <>
                <div className="overflow-y-auto flex-1 p-4 flex flex-col gap-3">

                  {/* Photo capture step */}
                  {brxPending && (
                    <div className="flex flex-col gap-3 bg-blue-50 border border-blue-200 rounded-xl p-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-semibold text-blue-900">{brxPending.resident.full_name}</p>
                          {brxPending.tracking && <p className="text-xs font-mono text-blue-600 mt-0.5">{brxPending.tracking}</p>}
                        </div>
                        <button onClick={() => { setBrxPending(null); setTimeout(() => brxBarcodeRef.current?.focus(), 50) }}
                          className="text-xs text-blue-400 hover:text-blue-600">Cancelar</button>
                      </div>
                      <PhotoCapture
                        label="Foto da Etiqueta *"
                        onCapture={entry => doAddToBulkRxQueue(brxPending.resident, brxPending.tracking, [entry])}
                        onUpload={file => uploadService.uploadFile(file, 'packages/labels')}
                      />
                    </div>
                  )}

                  {/* Carrier — persists across items */}
                  <div className="flex gap-2 items-center">
                    <label className="text-xs text-gray-500 shrink-0 w-20">Transportadora</label>
                    {carrierOpts.length > 0 ? (
                      <select value={brxCarrier} onChange={e => setBrxCarrier(e.target.value)}
                        className={`${inputCls} flex-1 bg-white`}>
                        <option value="">— Selecione —</option>
                        {carrierOpts.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                      </select>
                    ) : (
                      <input value={brxCarrier} onChange={e => setBrxCarrier(e.target.value)}
                        className={`${inputCls} flex-1`} placeholder="Correios, Mercado Envios…" />
                    )}
                  </div>

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
                      onClick={() => setShowBrxScanner(true)}
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
                      onChange={e => { setBrxSearch(e.target.value); setBrxSelected(null); searchBrxResidents(e.target.value) }}
                      onKeyDown={e => {
                        if (e.key === 'Enter' && brxResults.length > 0) { e.preventDefault(); selectBrxResident(brxResults[0]) }
                      }}
                      className={`${inputCls} pl-9`}
                      placeholder="Buscar destinatário por nome, unidade…"
                    />
                  </div>

                  {/* Search results */}
                  {brxResults.length > 0 && (
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
                              {(r as any).unit && <p className="text-xs text-gray-400">Unidade {(r as any).unit}{(r as any).block ? ` · Bl. ${(r as any).block}` : ''}</p>}
                            </div>
                            <div className="flex items-center gap-1 shrink-0">
                              {r.type === 'guest' && (
                                <>
                                  <span className="text-[10px] bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded-full">R$2,50</span>
                                  <button
                                    type="button"
                                    onClick={e => { e.stopPropagation(); setRxUpgradeTarget(r); setRxUpgradeCpf('') }}
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
                  )}

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
                        {newResType === 'member' && (
                          <input value={newResCpf} onChange={e => setNewResCpf(e.target.value)} className={inputCls} placeholder="CPF (opcional)" />
                        )}
                        {newResType === 'dependent' && (
                          <div className="flex flex-col gap-1">
                            <input value={newResResponsibleSearch}
                              onChange={e => { setNewResResponsibleSearch(e.target.value); setNewResResponsible(null); searchResponsible(e.target.value) }}
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
                      <button onClick={() => { setBrxShowGuest(true); setBrxGuestName(brxSearch) }}
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
                        <button onClick={() => setBulkRxStep('sign')}
                          className="text-xs bg-white text-[#26619c] px-2.5 py-1 rounded-lg font-semibold">
                          Finalizar →
                        </button>
                      </div>
                      <ul className="divide-y divide-gray-100 max-h-40 overflow-y-auto">
                        {bulkRxQueue.map((item, i) => (
                          <li key={item.id} className="flex items-center gap-2 px-3 py-2">
                            <span className="text-xs font-bold text-gray-300 shrink-0 w-5">{i + 1}</span>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-gray-800 truncate">{item.resident_name}</p>
                              {item.tracking_code && <p className="text-xs text-gray-400 font-mono truncate">{item.tracking_code}</p>}
                            </div>
                            <button onClick={() => setBulkRxQueue(q => q.filter(x => x.id !== item.id))}
                              className="text-gray-300 hover:text-red-500 shrink-0 transition"><X className="w-4 h-4" /></button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>

                <div className="flex gap-3 px-4 py-3 border-t border-gray-100 shrink-0">
                  <button onClick={resetBulkRx} className="border border-gray-300 text-gray-600 px-4 py-2.5 rounded-xl text-sm hover:bg-gray-50 transition">Cancelar</button>
                  <button onClick={() => setBulkRxStep('sign')} disabled={bulkRxQueue.length === 0}
                    className="flex-1 bg-[#26619c] hover:bg-[#1a4f87] text-white py-2.5 rounded-xl text-sm font-semibold transition disabled:opacity-50">
                    Finalizar ({bulkRxQueue.length}) →
                  </button>
                </div>
              </>
            )}

            {/* Step: sign */}
            {bulkRxStep === 'sign' && !brxResult && (
              <>
                <div className="overflow-y-auto flex-1 p-5 flex flex-col gap-4">
                  <div className="bg-[#26619c]/5 border border-[#26619c]/20 rounded-xl px-4 py-3">
                    <p className="text-xs font-bold text-[#26619c] mb-1">{bulkRxQueue.length} encomenda(s) a registrar</p>
                    <ul className="flex flex-col gap-0.5 max-h-32 overflow-y-auto">
                      {bulkRxQueue.map(item => (
                        <li key={item.id} className="text-xs text-gray-600 flex items-center gap-1.5">
                          <span className="w-1.5 h-1.5 rounded-full bg-[#26619c]/40 shrink-0" />
                          <span className="font-medium truncate">{item.resident_name}</span>
                          {item.tracking_code && <span className="font-mono text-gray-400 truncate">{item.tracking_code}</span>}
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Entregador (opcional)</label>
                    {delivererOpts.length > 0 ? (
                      <select
                        value={delivererOpts.find(d => d.name === brxDelivererName)?.id ?? ''}
                        onChange={e => {
                          const d = delivererOpts.find(x => x.id === e.target.value)
                          if (d) { setBrxDelivererName(d.name); if (d.signature_url) setBrxDelivererSig(d.signature_url) }
                          else { setBrxDelivererName(''); setBrxDelivererSig('') }
                        }}
                        className={`${inputCls} bg-white`}
                      >
                        <option value="">— Selecione —</option>
                        {delivererOpts.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                      </select>
                    ) : (
                      <input value={brxDelivererName} onChange={e => setBrxDelivererName(e.target.value)}
                        className={inputCls} placeholder="Nome do courier / transportadora" autoFocus />
                    )}
                  </div>
                  {delivererOpts.length > 0 && brxDelivererSig ? (
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Assinatura</label>
                      <img src={brxDelivererSig} alt="assinatura" className="h-16 border border-gray-200 rounded-lg bg-white object-contain" />
                    </div>
                  ) : delivererOpts.length === 0 && (
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Assinatura do entregador (opcional)</label>
                      <SignaturePad label="Assinatura do entregador" onSave={setBrxDelivererSig}
                        onClear={() => setBrxDelivererSig('')}
                        onUpload={dataUrl => uploadService.uploadBase64(dataUrl, 'packages/signatures')} />
                    </div>
                  )}
                </div>
                <div className="flex gap-3 px-4 py-3 border-t border-gray-100 shrink-0">
                  <button onClick={() => setBulkRxStep('add')} className="border border-gray-300 text-gray-600 px-4 py-2.5 rounded-xl text-sm hover:bg-gray-50 transition">← Voltar</button>
                  <button onClick={handleBulkRxSubmit} disabled={brxLoading}
                    className="flex-1 bg-[#26619c] hover:bg-[#1a4f87] text-white py-2.5 rounded-xl text-sm font-semibold transition disabled:opacity-50">
                    {brxLoading ? 'Registrando…' : `Confirmar ${bulkRxQueue.length} Recebimento(s)`}
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
              <label className="block text-xs text-gray-600 mb-1">CPF <span className="text-red-500">*</span></label>
              <input value={rxUpgradeCpf} onChange={e => setRxUpgradeCpf(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleRxUpgrade() }}
                className={inputCls} placeholder="000.000.000-00" autoFocus />
            </div>
            <div className="flex gap-2">
              <button onClick={() => { setRxUpgradeTarget(null); setRxUpgradeCpf('') }}
                className="flex-1 border border-gray-300 text-gray-600 py-2 rounded-xl text-sm">Cancelar</button>
              <button onClick={handleRxUpgrade} disabled={rxUpgradeLoading || !rxUpgradeCpf.trim()}
                className="flex-1 bg-[#26619c] text-white py-2 rounded-xl text-sm font-semibold disabled:opacity-50">
                {rxUpgradeLoading ? 'Salvando…' : 'Confirmar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Barcode Scanner — single receive */}
      {showScanner && (
        <BarcodeScannerModal
          onScan={(code) => { setTracking(code); setShowScanner(false); document.getElementById('recipient-search')?.focus() }}
          onClose={() => setShowScanner(false)}
        />
      )}

      {/* Barcode Scanner — bulk receive */}
      {showBrxScanner && (
        <BarcodeScannerModal
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
    </div>
  )
}
