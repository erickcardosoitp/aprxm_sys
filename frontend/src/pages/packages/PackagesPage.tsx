import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, Barcode, Package as PackageIcon, Plus, Search, Shield, User, UserX } from 'lucide-react'
import toast from 'react-hot-toast'
import { SignaturePad } from '../../components/packages/SignaturePad'
import { PhotoCapture } from '../../components/packages/PhotoCapture'
import { packageService } from '../../services/packages'
import api from '../../services/api'
import type { Package, Resident } from '../../types'

const STATUS_LABELS: Record<string, string> = {
  received: 'Aguardando', notified: 'Notificado', delivered: 'Entregue', returned: 'Devolvido',
}
const STATUS_COLORS: Record<string, string> = {
  received: 'bg-blue-100 text-blue-700', notified: 'bg-yellow-100 text-yellow-700',
  delivered: 'bg-green-100 text-green-700', returned: 'bg-gray-100 text-gray-600',
}

type ReceiveStep = 'recipient' | 'details'

interface GuestForm {
  full_name: string
  phone_primary: string
  address_cep: string
  address_street: string
  address_number: string
  address_complement: string
  address_district: string
  address_city: string
  address_state: string
}

const emptyGuest = (): GuestForm => ({
  full_name: '', phone_primary: '', address_cep: '', address_street: '',
  address_number: '', address_complement: '', address_district: '', address_city: '', address_state: '',
})

export default function PackagesPage() {
  const [packages, setPackages] = useState<Package[]>([])
  const [showReceive, setShowReceive] = useState(false)
  const [deliveryTarget, setDeliveryTarget] = useState<Package | null>(null)
  const [loading, setLoading] = useState(false)
  const [filterStatus, setFilterStatus] = useState('')

  const [step, setStep] = useState<ReceiveStep>('recipient')
  const [recipientSearch, setRecipientSearch] = useState('')
  const [searchResults, setSearchResults] = useState<Resident[]>([])
  const [selectedRecipient, setSelectedRecipient] = useState<Resident | null>(null)
  const [showGuestForm, setShowGuestForm] = useState(false)
  const [guest, setGuest] = useState<GuestForm>(emptyGuest())
  const [cepLoading, setCepLoading] = useState(false)
  const [tracking, setTracking] = useState('')
  const [carrier, setCarrier] = useState('')
  const [sender, setSender] = useState('')
  const [photos, setPhotos] = useState<{ url: string; label: string; taken_at: string }[]>([])
  const barcodeRef = useRef<HTMLInputElement>(null)

  const [recipientName, setRecipientName] = useState('')
  const [recipientCpf, setRecipientCpf] = useState('')
  const [recipientSig, setRecipientSig] = useState('')
  const [delivererName, setDelivererName] = useState('')
  const [delivererSig, setDelivererSig] = useState('')
  const [proofVerified, setProofVerified] = useState(false)
  const [recipientIdPhoto, setRecipientIdPhoto] = useState('')

  const loadPackages = async () => {
    try {
      const res = await packageService.list(filterStatus || undefined)
      setPackages(res.data)
    } catch {
      toast.error('Erro ao carregar encomendas.')
    }
  }

  useEffect(() => { loadPackages() }, [filterStatus])
  useEffect(() => { if (showReceive && step === 'recipient') barcodeRef.current?.focus() }, [showReceive, step])

  const searchResidents = async (q: string) => {
    if (q.length < 2) { setSearchResults([]); return }
    try {
      const res = await api.get<Resident[]>('/residents', { params: { q, type: 'member' } })
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
        carrier_name: carrier, tracking_code: tracking, sender_name: sender, photo_urls: photos,
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
    setGuest(emptyGuest()); setTracking(''); setCarrier(''); setSender(''); setPhotos([])
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
  const inputCls = 'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#26619c]/40 focus:border-[#26619c]'

  return (
    <div className="flex flex-col gap-5 p-4 max-w-2xl mx-auto">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <PackageIcon className="w-6 h-6 text-[#26619c]" />
          Encomendas
          {pendingCount > 0 && <span className="ml-1 bg-[#26619c] text-white text-xs font-bold px-2 py-0.5 rounded-full">{pendingCount}</span>}
        </h1>
        <button onClick={() => { setShowReceive(true); setStep('recipient') }}
          className="flex items-center gap-2 bg-[#26619c] hover:bg-[#1a4f87] text-white px-4 py-2 rounded-xl text-sm font-medium transition">
          <Plus className="w-4 h-4" /> Receber
        </button>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1">
        {(['', 'received', 'notified', 'delivered', 'returned'] as const).map((s) => (
          <button key={s} onClick={() => setFilterStatus(s)}
            className={`whitespace-nowrap px-3 py-1.5 rounded-full text-xs font-medium transition ${filterStatus === s ? 'bg-[#26619c] text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
            {s === '' ? 'Todos' : STATUS_LABELS[s]}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        {packages.length === 0
          ? <div className="p-8 text-center text-gray-400 text-sm">Nenhuma encomenda encontrada.</div>
          : <ul className="divide-y divide-gray-100">
              {packages.map((pkg) => (
                <li key={pkg.id} className="px-4 py-3">
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
                        <button onClick={() => { setDeliveryTarget(pkg); setRecipientName(pkg.resident_name ?? '') }}
                          className="text-xs text-[#26619c] hover:underline">Entregar</button>
                      )}
                      {pkg.has_delivery_fee && <span className="text-xs text-amber-600 font-medium">Taxa R$ {parseFloat(pkg.delivery_fee_amount ?? '2.50').toFixed(2)}</span>}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
        }
      </div>

      {showReceive && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40">
          <div className="w-full max-w-lg bg-white rounded-t-2xl sm:rounded-2xl shadow-xl p-6 max-h-[92vh] overflow-y-auto">
            {step === 'recipient' && (
              <>
                <h3 className="font-semibold text-gray-800 mb-1">Nova Encomenda — Destinatário</h3>
                <p className="text-xs text-gray-400 mb-4">Bipe o código de barras ou busque o morador pelo nome.</p>

                <div className="mb-4 relative">
                  <Barcode className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input ref={barcodeRef} value={tracking} onChange={e => setTracking(e.target.value)}
                    className={`${inputCls} pl-9`} placeholder="Código de barras / rastreio (opcional)" />
                </div>

                <div className="relative mb-2">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input value={recipientSearch}
                    onChange={e => { setRecipientSearch(e.target.value); searchResidents(e.target.value) }}
                    className={`${inputCls} pl-9`} placeholder="Buscar associado por nome..." />
                </div>

                {searchResults.length > 0 && (
                  <ul className="border border-gray-200 rounded-lg mb-3 divide-y divide-gray-100 max-h-48 overflow-y-auto">
                    {searchResults.map(r => (
                      <li key={r.id}>
                        <button className="w-full text-left px-3 py-2.5 hover:bg-blue-50 flex items-center gap-2"
                          onClick={() => { setSelectedRecipient(r); setSearchResults([]); setRecipientSearch(r.full_name); setStep('details') }}>
                          <User className="w-4 h-4 text-[#26619c] shrink-0" />
                          <div>
                            <p className="text-sm font-medium text-gray-800">{r.full_name}</p>
                            <p className="text-xs text-gray-400">{(r as any).unit ? `Unid. ${(r as any).unit}` : ''}{(r as any).block ? ` Bl. ${(r as any).block}` : ''}{r.phone_primary ? ` · ${r.phone_primary}` : ''}</p>
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
                    <button className="ml-auto text-xs text-gray-400 hover:text-red-500"
                      onClick={() => { setSelectedRecipient(null); setRecipientSearch('') }}>✕</button>
                  </div>
                )}

                <button onClick={() => setShowGuestForm(!showGuestForm)}
                  className="w-full flex items-center gap-2 border border-dashed border-gray-300 rounded-lg px-3 py-2.5 text-sm text-gray-500 hover:border-[#26619c] hover:text-[#26619c] transition mb-4">
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
                  <div className="flex items-center gap-2 bg-blue-50 border border-blue-100 rounded-lg px-3 py-2 mb-4">
                    <User className="w-4 h-4 text-[#26619c]" />
                    <span className="text-sm font-medium text-[#1a3f6f]">{selectedRecipient.full_name}</span>
                    {selectedRecipient.type === 'guest' && (
                      <span className="ml-auto text-xs bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full">Não associado</span>
                    )}
                  </div>
                )}
                <div className="flex flex-col gap-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-gray-600 mb-1">Transportadora</label>
                      <input value={carrier} onChange={e => setCarrier(e.target.value)} className={inputCls} placeholder="Correios, iFood…" />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-600 mb-1">Rastreio</label>
                      <input value={tracking} onChange={e => setTracking(e.target.value)} className={inputCls} placeholder="AA000000000BR" />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs text-gray-600 mb-1">Remetente</label>
                    <input value={sender} onChange={e => setSender(e.target.value)} className={inputCls} placeholder="Nome do remetente" />
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

      {deliveryTarget && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40">
          <div className="w-full max-w-lg bg-white rounded-t-2xl sm:rounded-2xl shadow-xl p-6 max-h-[92vh] overflow-y-auto">
            <h3 className="font-semibold text-gray-800 mb-1">
              Entregar — {deliveryTarget.resident_name ?? `Unid. ${deliveryTarget.unit}`}
            </h3>
            {deliveryTarget.tracking_code && (
              <p className="text-xs text-gray-400 mb-4">Rastreio: {deliveryTarget.tracking_code}</p>
            )}

            <div className="flex flex-col gap-5">
              <div className={`rounded-xl p-4 border ${proofVerified ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
                <label className="flex items-center gap-3 cursor-pointer">
                  <input type="checkbox" checked={proofVerified} onChange={e => setProofVerified(e.target.checked)} className="w-4 h-4 accent-green-600" />
                  <div>
                    <p className="text-sm font-semibold text-gray-800 flex items-center gap-1">
                      <Shield className="w-4 h-4 text-green-600" /> Comprovante de residência apresentado
                    </p>
                    <p className="text-xs text-gray-500">Obrigatório para associados e não associados</p>
                  </div>
                </label>
              </div>

              <div>
                <p className="text-xs font-semibold text-gray-600 mb-2 flex items-center gap-1">
                  <Shield className="w-3 h-3" /> Foto com documento (antifraude — opcional)
                </p>
                <PhotoCapture label="Documento do recebedor" onCapture={entry => setRecipientIdPhoto(entry.url)} />
              </div>

              <div className="border-t pt-4">
                <p className="text-xs font-semibold text-gray-600 mb-3 uppercase tracking-wide">Recebedor</p>
                <div className="flex flex-col gap-3 mb-3">
                  <div>
                    <label className="block text-xs text-gray-600 mb-1">Nome completo *</label>
                    <input value={recipientName} onChange={e => setRecipientName(e.target.value)} className={inputCls} placeholder="Nome do recebedor" />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-600 mb-1">CPF</label>
                    <input value={recipientCpf} onChange={e => setRecipientCpf(e.target.value)} className={inputCls} placeholder="000.000.000-00" />
                  </div>
                </div>
                <label className="block text-xs text-gray-600 mb-1">Assinatura do recebedor *</label>
                <SignaturePad onSave={setRecipientSig} onClear={() => setRecipientSig('')} />
              </div>

              <div className="border-t pt-4">
                <p className="text-xs font-semibold text-gray-600 mb-3 uppercase tracking-wide">Entregador</p>
                <div className="mb-3">
                  <label className="block text-xs text-gray-600 mb-1">Nome do entregador *</label>
                  <input value={delivererName} onChange={e => setDelivererName(e.target.value)} className={inputCls} placeholder="Nome de quem entrega" />
                </div>
                <label className="block text-xs text-gray-600 mb-1">Assinatura do entregador *</label>
                <SignaturePad onSave={setDelivererSig} onClear={() => setDelivererSig('')} />
              </div>
            </div>

            <div className="flex gap-3 mt-5">
              <button onClick={() => { setDeliveryTarget(null); resetDelivery() }}
                className="flex-1 border border-gray-300 text-gray-600 py-2.5 rounded-xl text-sm hover:bg-gray-50 transition">Cancelar</button>
              <button onClick={handleDeliver}
                disabled={loading || !recipientSig || !delivererSig || !proofVerified || !recipientName || !delivererName}
                className="flex-1 bg-[#26619c] hover:bg-[#1a4f87] text-white py-2.5 rounded-xl text-sm font-medium transition disabled:opacity-50">
                {loading ? 'Salvando…' : 'Confirmar Entrega'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
