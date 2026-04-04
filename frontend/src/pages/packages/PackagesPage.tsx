import { useEffect, useRef, useState } from 'react'
import {
  AlertTriangle, Barcode, Camera, MessageCircle, Package as PackageIcon, Plus,
  Search, Shield, User, UserX, List, Columns, Workflow, X, ChevronDown,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { SignaturePad } from '../../components/packages/SignaturePad'
import { PhotoCapture } from '../../components/packages/PhotoCapture'
import { BarcodeScannerModal } from '../../components/packages/BarcodeScanner'
import { packageService } from '../../services/packages'
import api from '../../services/api'
import type { Package, Resident } from '../../types'

// ─── Constants ────────────────────────────────────────────────────────────────

const STATUS_LABELS: Record<string, string> = {
  received: 'Aguardando', notified: 'Notificado', delivered: 'Entregue', returned: 'Devolvido',
}
const STATUS_COLORS: Record<string, string> = {
  received: 'bg-blue-100 text-blue-700', notified: 'bg-yellow-100 text-yellow-700',
  delivered: 'bg-green-100 text-green-700', returned: 'bg-gray-100 text-gray-600',
}

const KANBAN_STATUSES = ['received', 'notified', 'delivered', 'returned'] as const

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

// ─── Package Detail Modal ─────────────────────────────────────────────────────

interface PackageDetailModalProps {
  pkg: Package
  onClose: () => void
  onDeliverClick: () => void
}

function PackageDetailModal({ pkg, onClose, onDeliverClick }: PackageDetailModalProps) {
  const [events, setEvents] = useState<PackageEvent[]>([])
  const [newComment, setNewComment] = useState('')
  const [addingEvent, setAddingEvent] = useState(false)
  const [residentPhone, setResidentPhone] = useState<string | null>(null)

  useEffect(() => {
    const fetchEvents = async () => {
      try {
        const res = await api.get<PackageEvent[]>(`/packages/${pkg.id}/events`)
        setEvents(res.data)
      } catch { /* silent */ }
    }
    fetchEvents()
  }, [pkg.id])

  useEffect(() => {
    if (pkg.resident_name) {
      api.get<Resident[]>('/residents', { params: { q: pkg.resident_name } })
        .then(res => {
          const found = res.data.find(r => r.id === pkg.resident_id || r.full_name === pkg.resident_name)
          if (found?.phone_primary) setResidentPhone(found.phone_primary)
        })
        .catch(() => {})
    }
  }, [pkg.resident_name, pkg.resident_id])

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
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 sticky top-0 bg-white z-10">
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
            </div>
            {pkg.unit && (
              <div>
                <p className="text-xs text-gray-500">Unidade</p>
                <p className="font-medium text-gray-800">
                  {pkg.unit}{pkg.block ? ` / Bl. ${pkg.block}` : ''}
                </p>
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

          {(pkg.status === 'received' || pkg.status === 'notified') && (
            <button
              onClick={onDeliverClick}
              className="w-full bg-[#26619c] hover:bg-[#1a4f87] text-white py-2.5 rounded-xl text-sm font-medium transition"
            >
              Entregar Encomenda
            </button>
          )}

          {residentPhone && (pkg.status === 'received' || pkg.status === 'notified') && (
            <a
              href={`https://wa.me/55${residentPhone.replace(/\D/g, '')}?text=${encodeURIComponent(`Olá ${pkg.resident_name ?? 'morador'}! Sua encomenda chegou na portaria. Por favor, venha retirar o mais breve possível. 📦`)}`}
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

  // Receive flow
  const [step, setStep] = useState<ReceiveStep>('recipient')
  const [recipientSearch, setRecipientSearch] = useState('')
  const [searchResults, setSearchResults] = useState<Resident[]>([])
  const [selectedRecipient, setSelectedRecipient] = useState<Resident | null>(null)
  const [showGuestForm, setShowGuestForm] = useState(false)
  const [guest, setGuest] = useState<GuestForm>(emptyGuest())
  const [cepLoading, setCepLoading] = useState(false)
  const [tracking, setTracking] = useState('')
  const [carrier, setCarrier] = useState('')
  const [photos, setPhotos] = useState<{ url: string; label: string; taken_at: string }[]>([])
  const barcodeRef = useRef<HTMLInputElement>(null)
  const [showScanner, setShowScanner] = useState(false)

  // Delivery flow
  const [recipientName, setRecipientName] = useState('')
  const [recipientCpf, setRecipientCpf] = useState('')
  const [recipientSig, setRecipientSig] = useState('')
  const [delivererName, setDelivererName] = useState('')
  const [delivererSig, setDelivererSig] = useState('')
  const [proofVerified, setProofVerified] = useState(false)
  const [recipientIdPhoto, setRecipientIdPhoto] = useState('')

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

  const searchResidents = async (q: string) => {
    if (q.length < 2) { setSearchResults([]); return }
    try {
      const res = await api.get<Resident[]>('/residents', { params: { q } })
      setSearchResults(res.data.slice(0, 6))
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

  const createGuest = async () => {
    if (!guest.full_name || !guest.phone_primary || !guest.address_cep) {
      toast.error('Preencha nome, telefone e CEP.')
      return
    }
    setLoading(true)
    try {
      const res = await api.post<Resident>('/residents', {
        type: 'guest', status: 'active', is_member_confirmed: false,
        terms_accepted: false, lgpd_accepted: false, ...guest,
      })
      setSelectedRecipient(res.data)
      setShowGuestForm(false)
      setStep('details')
    } catch (e: any) {
      toast.error(e.response?.data?.detail ?? 'Erro ao criar visitante.')
    } finally {
      setLoading(false)
    }
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
      })
      toast.success('Encomenda registrada!')
      resetReceive()
      loadPackages()
    } catch (e: any) {
      toast.error(e.response?.data?.detail ?? 'Erro.')
    } finally {
      setLoading(false)
    }
  }

  const resetReceive = () => {
    setShowReceive(false); setStep('recipient'); setRecipientSearch('')
    setSearchResults([]); setSelectedRecipient(null); setShowGuestForm(false)
    setGuest(emptyGuest()); setTracking(''); setCarrier(''); setPhotos([])
  }

  const handleDeliver = async () => {
    if (!deliveryTarget) return
    if (!recipientName || !recipientSig) { toast.error('Nome e assinatura do recebedor obrigatórios.'); return }
    if (!delivererName || !delivererSig) { toast.error('Nome e assinatura do entregador obrigatórios.'); return }
    if (!proofVerified) { toast.error('Confirme a apresentação do comprovante de residência.'); return }
    setLoading(true)
    try {
      const res = await packageService.deliver(deliveryTarget.id, {
        delivered_to_name: recipientName,
        signature_url: recipientSig,
        delivered_to_cpf: recipientCpf || undefined,
        delivered_to_resident_id: deliveryTarget.resident_id,
        deliverer_name: delivererName,
        deliverer_signature_url: delivererSig,
        proof_of_residence_verified: proofVerified,
        recipient_id_photo_url: recipientIdPhoto || undefined,
      })
      const pkg = res.data as any
      toast.success(pkg.has_delivery_fee
        ? `Entregue! Taxa R$ ${parseFloat(pkg.delivery_fee_amount).toFixed(2)} cobrada.`
        : 'Encomenda entregue!')
      setDeliveryTarget(null)
      resetDelivery()
      loadPackages()
    } catch (e: any) {
      toast.error(e.response?.data?.detail ?? 'Erro na entrega.')
    } finally {
      setLoading(false)
    }
  }

  const resetDelivery = () => {
    setRecipientName(''); setRecipientCpf(''); setRecipientSig('')
    setDelivererName(''); setDelivererSig(''); setProofVerified(false); setRecipientIdPhoto('')
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
          <p className="text-sm font-medium text-gray-800">
            {pkg.resident_name ?? '—'}
            {pkg.unit ? ` · Unid. ${pkg.unit}${pkg.block ? `/Bl.${pkg.block}` : ''}` : ''}
          </p>
          <p className="text-xs text-gray-400 mt-0.5">
            {pkg.carrier_name ?? '—'}{pkg.tracking_code ? ` · ${pkg.tracking_code}` : ''}
          </p>
          <p className="text-xs text-gray-400">
            {new Date(pkg.received_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[pkg.status]}`}>{STATUS_LABELS[pkg.status]}</span>
          {(pkg.status === 'received' || pkg.status === 'notified') && (
            <button
              onClick={e => { e.stopPropagation(); setDeliveryTarget(pkg); setRecipientName(pkg.resident_name ?? '') }}
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
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <PackageIcon className="w-6 h-6 text-[#26619c]" />
          Encomendas
          {pendingCount > 0 && (
            <span className="ml-1 bg-[#26619c] text-white text-xs font-bold px-2 py-0.5 rounded-full">{pendingCount}</span>
          )}
        </h1>
        <div className="flex items-center gap-2">
          {/* View toggle */}
          <div className="flex border border-gray-200 rounded-lg overflow-hidden">
            <button
              onClick={() => setViewMode('list')}
              className={`flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium transition ${viewMode === 'list' ? 'bg-[#26619c] text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
            >
              <List className="w-3.5 h-3.5" /> Lista
            </button>
            <button
              onClick={() => setViewMode('kanban')}
              className={`flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium transition ${viewMode === 'kanban' ? 'bg-[#26619c] text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
            >
              <Columns className="w-3.5 h-3.5" /> Kanban
            </button>
            <button
              onClick={() => setViewMode('esteira')}
              className={`flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium transition ${viewMode === 'esteira' ? 'bg-[#26619c] text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
            >
              <Workflow className="w-3.5 h-3.5" /> Esteira
            </button>
          </div>
          <button
            onClick={() => { setShowReceive(true); setStep('recipient') }}
            className="flex items-center gap-2 bg-[#26619c] hover:bg-[#1a4f87] text-white px-4 py-2 rounded-xl text-sm font-medium transition"
          >
            <Plus className="w-4 h-4" /> Receber
          </button>
        </div>
      </div>

      {/* Filter bar */}
      <div className="flex flex-col gap-2">
        <div className="flex gap-2 items-center">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              value={filterQ}
              onChange={e => setFilterQ(e.target.value)}
              placeholder="Buscar por nome, CPF ou CEP…"
              className="w-full pl-9 pr-4 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#26619c]/30 focus:border-[#26619c]"
            />
          </div>
          <input
            type="date"
            value={filterDateFrom}
            onChange={e => setFilterDateFrom(e.target.value)}
            title="Data inicial"
            className="border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-600 focus:outline-none focus:ring-2 focus:ring-[#26619c]/30 focus:border-[#26619c]"
          />
          <input
            type="date"
            value={filterDateTo}
            onChange={e => setFilterDateTo(e.target.value)}
            title="Data final"
            className="border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-600 focus:outline-none focus:ring-2 focus:ring-[#26619c]/30 focus:border-[#26619c]"
          />
          {(filterQ || filterDateFrom || filterDateTo || filterStatus) && (
            <button onClick={clearFilters} className="text-xs text-gray-500 hover:text-red-500 flex items-center gap-1 whitespace-nowrap">
              <X className="w-3.5 h-3.5" /> Limpar
            </button>
          )}
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
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40">
          <div className="w-full max-w-lg bg-white rounded-t-2xl sm:rounded-2xl shadow-xl p-6 max-h-[92vh] overflow-y-auto">
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
                    onChange={e => { setRecipientSearch(e.target.value); searchResidents(e.target.value) }}
                    className={`${inputCls} pl-9`}
                    placeholder="Buscar por nome, CPF ou CEP…"
                  />
                </div>

                {searchResults.length > 0 && (
                  <ul className="border border-gray-200 rounded-lg mb-3 divide-y divide-gray-100 max-h-48 overflow-y-auto">
                    {searchResults.map(r => (
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
                          <User className="w-4 h-4 text-[#26619c] shrink-0" />
                          <div>
                            <p className="text-sm font-medium text-gray-800">{r.full_name}</p>
                            <p className="text-xs text-gray-400">
                              {r.cpf ? `CPF: ${r.cpf}` : ''}
                              {r.address_cep ? ` · CEP: ${r.address_cep}` : ''}
                              {(r as any).unit ? ` · Unid. ${(r as any).unit}` : ''}
                              {r.phone_primary ? ` · ${r.phone_primary}` : ''}
                            </p>
                          </div>
                        </button>
                      </li>
                    ))}
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

                <button
                  onClick={() => setShowGuestForm(!showGuestForm)}
                  className="w-full flex items-center gap-2 border border-dashed border-gray-300 rounded-lg px-3 py-2.5 text-sm text-gray-500 hover:border-[#26619c] hover:text-[#26619c] transition mb-4"
                >
                  <UserX className="w-4 h-4" /> Não associado / Visitante
                </button>

                {showGuestForm && (
                  <div className="border border-orange-200 bg-orange-50 rounded-xl p-4 mb-4 flex flex-col gap-3">
                    <p className="text-xs font-semibold text-orange-700 flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3" /> Cadastro rápido de não associado
                    </p>
                    <input value={guest.full_name} onChange={e => setGuest(g => ({ ...g, full_name: e.target.value }))}
                      className={inputCls} placeholder="Nome completo *" />
                    <input value={guest.phone_primary} onChange={e => setGuest(g => ({ ...g, phone_primary: e.target.value }))}
                      className={inputCls} placeholder="Telefone *" type="tel" />
                    <div className="grid grid-cols-3 gap-2">
                      <div>
                        <input value={guest.address_cep}
                          onChange={e => { setGuest(g => ({ ...g, address_cep: e.target.value })); lookupCep(e.target.value) }}
                          className={inputCls} placeholder="CEP *" maxLength={9} />
                        {cepLoading && <p className="text-xs text-gray-400 mt-0.5">Buscando…</p>}
                      </div>
                      <input value={guest.address_number} onChange={e => setGuest(g => ({ ...g, address_number: e.target.value }))}
                        className={inputCls} placeholder="Número" />
                      <input value={guest.address_complement} onChange={e => setGuest(g => ({ ...g, address_complement: e.target.value }))}
                        className={inputCls} placeholder="Compl." />
                    </div>
                    <input value={guest.address_street} onChange={e => setGuest(g => ({ ...g, address_street: e.target.value }))}
                      className={inputCls} placeholder="Rua" />
                    <div className="grid grid-cols-2 gap-2">
                      <input value={guest.address_district} onChange={e => setGuest(g => ({ ...g, address_district: e.target.value }))}
                        className={inputCls} placeholder="Bairro" />
                      <input value={guest.address_city} onChange={e => setGuest(g => ({ ...g, address_city: e.target.value }))}
                        className={inputCls} placeholder="Cidade" />
                    </div>
                    <button onClick={createGuest} disabled={loading}
                      className="w-full bg-orange-500 hover:bg-orange-600 text-white py-2 rounded-lg text-sm font-medium transition disabled:opacity-50">
                      {loading ? 'Salvando…' : 'Salvar e continuar'}
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
                    <p className="text-xs text-amber-800 font-medium">
                      Não associado — <strong>taxa de R$ 2,50</strong> será cobrada automaticamente na entrega e lançada no caixa.
                    </p>
                  </div>
                )}
                <div className="flex flex-col gap-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-gray-600 mb-1">Transportadora</label>
                      <input value={carrier} onChange={e => setCarrier(e.target.value)} className={inputCls} placeholder="Correios, iFood… (opcional)" />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-600 mb-1">Rastreio</label>
                      <input value={tracking} onChange={e => setTracking(e.target.value)} className={inputCls} placeholder="AA000000000BR (opcional)" />
                    </div>
                  </div>
                  <PhotoCapture label="Foto da Etiqueta *" onCapture={entry => setPhotos(prev => [...prev, entry])} />
                  {photos.length > 0 && <p className="text-xs text-green-600">{photos.length} foto(s) adicionada(s)</p>}
                  <button onClick={handleReceive} disabled={loading || photos.length === 0}
                    className="w-full bg-[#26619c] hover:bg-[#1a4f87] text-white py-2.5 rounded-xl font-medium transition disabled:opacity-50">
                    {loading ? 'Salvando…' : 'Registrar Encomenda'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Delivery Modal */}
      {deliveryTarget && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40">
          <div className="w-full max-w-lg bg-white rounded-t-2xl sm:rounded-2xl shadow-xl max-h-[92vh] overflow-y-auto">
            {/* Modal header */}
            <div className="sticky top-0 bg-white border-b border-gray-100 px-5 py-4 flex items-center justify-between z-10">
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

            <div className="p-5 flex flex-col gap-4">
              {/* Proof of residence */}
              <div className={`rounded-xl p-4 border transition ${proofVerified ? 'bg-green-50 border-green-300' : 'bg-red-50 border-red-200'}`}>
                <label className="flex items-center gap-3 cursor-pointer">
                  <input type="checkbox" checked={proofVerified} onChange={e => setProofVerified(e.target.checked)} className="w-5 h-5 accent-green-600 shrink-0" />
                  <div>
                    <p className="text-sm font-semibold text-gray-800 flex items-center gap-1.5">
                      <Shield className={`w-4 h-4 ${proofVerified ? 'text-green-600' : 'text-red-400'}`} />
                      Comprovante de residência apresentado
                    </p>
                    <p className="text-xs text-gray-500 mt-0.5">Obrigatório — verifique o documento antes de entregar</p>
                  </div>
                </label>
              </div>

              {/* Anti-fraud photo */}
              <div className="bg-gray-50 rounded-xl p-4 border border-gray-200">
                <p className="text-xs font-semibold text-gray-600 mb-2 flex items-center gap-1.5">
                  <Shield className="w-3.5 h-3.5 text-gray-400" /> Foto do documento (antifraude — opcional)
                </p>
                <PhotoCapture label="Documento do recebedor" onCapture={entry => setRecipientIdPhoto(entry.url)} />
              </div>

              {/* Recipient section */}
              <div className="rounded-xl border border-blue-200 overflow-hidden">
                <div className="bg-blue-600 px-4 py-2.5 flex items-center gap-2">
                  <User className="w-4 h-4 text-white" />
                  <span className="text-sm font-semibold text-white">Recebedor (Morador)</span>
                </div>
                <div className="p-4 flex flex-col gap-3">
                  <div>
                    <label className="block text-xs text-gray-600 mb-1">Nome completo <span className="text-red-500">*</span></label>
                    <input value={recipientName} onChange={e => setRecipientName(e.target.value)} className={inputCls} placeholder="Nome de quem está recebendo" />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-600 mb-1">CPF</label>
                    <input value={recipientCpf} onChange={e => setRecipientCpf(e.target.value)} className={inputCls} placeholder="000.000.000-00" />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-600 mb-1">Assinatura <span className="text-red-500">*</span></label>
                    <SignaturePad onSave={setRecipientSig} onClear={() => setRecipientSig('')} />
                  </div>
                </div>
              </div>

              {/* Deliverer section */}
              <div className="rounded-xl border border-amber-200 overflow-hidden">
                <div className="bg-amber-500 px-4 py-2.5 flex items-center gap-2">
                  <User className="w-4 h-4 text-white" />
                  <span className="text-sm font-semibold text-white">Entregador (Quem entrega)</span>
                </div>
                <div className="p-4 flex flex-col gap-3">
                  <div>
                    <label className="block text-xs text-gray-600 mb-1">Nome do entregador <span className="text-red-500">*</span></label>
                    <input value={delivererName} onChange={e => setDelivererName(e.target.value)} className={inputCls} placeholder="Nome do funcionário que entrega" />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-600 mb-1">Assinatura <span className="text-red-500">*</span></label>
                    <SignaturePad onSave={setDelivererSig} onClear={() => setDelivererSig('')} />
                  </div>
                </div>
              </div>
            </div>

            <div className="flex gap-3 px-5 pb-5 sticky bottom-0 bg-white border-t border-gray-100 pt-4">
              <button onClick={() => { setDeliveryTarget(null); resetDelivery() }}
                className="flex-1 border border-gray-300 text-gray-600 py-2.5 rounded-xl text-sm hover:bg-gray-50 transition">Cancelar</button>
              <button onClick={handleDeliver}
                disabled={loading || !recipientSig || !delivererSig || !proofVerified || !recipientName || !delivererName}
                className="flex-1 bg-[#26619c] hover:bg-[#1a4f87] text-white py-2.5 rounded-xl text-sm font-semibold transition disabled:opacity-50">
                {loading ? 'Registrando…' : 'Confirmar Entrega'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Barcode Scanner */}
      {showScanner && (
        <BarcodeScannerModal
          onScan={(code) => { setTracking(code); setShowScanner(false); document.getElementById('recipient-search')?.focus() }}
          onClose={() => setShowScanner(false)}
        />
      )}

      {/* Package Detail */}
      {detailPkg && (
        <PackageDetailModal
          pkg={detailPkg}
          onClose={() => setDetailPkg(null)}
          onDeliverClick={() => {
            setDeliveryTarget(detailPkg)
            setRecipientName(detailPkg.resident_name ?? '')
            setDetailPkg(null)
          }}
        />
      )}
    </div>
  )
}
