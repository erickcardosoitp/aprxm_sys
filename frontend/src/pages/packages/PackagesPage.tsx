import { useEffect, useState } from 'react'
import { Package as PackageIcon, Plus, User } from 'lucide-react'
import toast from 'react-hot-toast'
import { SignaturePad } from '../../components/packages/SignaturePad'
import { PhotoCapture } from '../../components/packages/PhotoCapture'
import { packageService } from '../../services/packages'
import type { Package } from '../../types'

const STATUS_LABELS: Record<string, string> = {
  received: 'Aguardando',
  notified: 'Notificado',
  delivered: 'Entregue',
  returned: 'Devolvido',
}

const STATUS_COLORS: Record<string, string> = {
  received: 'bg-blue-100 text-blue-700',
  notified: 'bg-yellow-100 text-yellow-700',
  delivered: 'bg-green-100 text-green-700',
  returned: 'bg-gray-100 text-gray-600',
}

export default function PackagesPage() {
  const [packages, setPackages] = useState<Package[]>([])
  const [showForm, setShowForm] = useState(false)
  const [deliveryTarget, setDeliveryTarget] = useState<Package | null>(null)
  const [loading, setLoading] = useState(false)
  const [filterStatus, setFilterStatus] = useState<string>('')

  // --- Receive form state ---
  const [unit, setUnit] = useState('')
  const [block, setBlock] = useState('')
  const [carrier, setCarrier] = useState('')
  const [tracking, setTracking] = useState('')
  const [photos, setPhotos] = useState<{ url: string; label: string; taken_at: string }[]>([])

  // --- Delivery form state ---
  const [recipientName, setRecipientName] = useState('')
  const [signatureUrl, setSignatureUrl] = useState('')

  const loadPackages = async () => {
    try {
      const res = await packageService.list(filterStatus || undefined)
      setPackages(res.data)
    } catch {
      toast.error('Erro ao carregar encomendas.')
    }
  }

  useEffect(() => { loadPackages() }, [filterStatus])

  const handleReceive = async () => {
    if (!unit || photos.length === 0) {
      toast.error('Preencha a unidade e adicione ao menos uma foto.')
      return
    }
    setLoading(true)
    try {
      await packageService.receive({ unit, block, carrier_name: carrier, tracking_code: tracking, photo_urls: photos })
      toast.success('Encomenda registrada!')
      setShowForm(false)
      setUnit(''); setBlock(''); setCarrier(''); setTracking(''); setPhotos([])
      loadPackages()
    } catch (e: any) {
      toast.error(e.response?.data?.detail ?? 'Erro.')
    } finally {
      setLoading(false)
    }
  }

  const handleDeliver = async () => {
    if (!deliveryTarget || !recipientName || !signatureUrl) {
      toast.error('Preencha o nome do recebedor e a assinatura.')
      return
    }
    setLoading(true)
    try {
      const res = await packageService.deliver(deliveryTarget.id, {
        delivered_to_name: recipientName,
        signature_url: signatureUrl,
      })
      const { has_delivery_fee, delivery_fee_amount } = res.data
      if (has_delivery_fee) {
        toast.success(`Entregue! Taxa de R$ ${parseFloat(delivery_fee_amount!).toFixed(2)} cobrada.`)
      } else {
        toast.success('Encomenda entregue!')
      }
      setDeliveryTarget(null)
      setRecipientName(''); setSignatureUrl('')
      loadPackages()
    } catch (e: any) {
      toast.error(e.response?.data?.detail ?? 'Erro na entrega.')
    } finally {
      setLoading(false)
    }
  }

  const pendingCount = packages.filter((p) => p.status === 'received' || p.status === 'notified').length

  return (
    <div className="flex flex-col gap-5 p-4 max-w-2xl mx-auto">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <PackageIcon className="w-6 h-6 text-[#26619c]" />
          Encomendas
          {pendingCount > 0 && (
            <span className="ml-1 bg-[#26619c] text-white text-xs font-bold px-2 py-0.5 rounded-full">{pendingCount}</span>
          )}
        </h1>
        <button
          onClick={() => setShowForm(!showForm)}
          className="flex items-center gap-2 bg-[#26619c] hover:bg-[#1a4f87] text-white px-4 py-2 rounded-xl text-sm font-medium transition"
        >
          <Plus className="w-4 h-4" />
          Receber
        </button>
      </div>

      {/* Status filter */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {(['', 'received', 'notified', 'delivered', 'returned'] as const).map((s) => (
          <button key={s} onClick={() => setFilterStatus(s)}
            className={`whitespace-nowrap px-3 py-1.5 rounded-full text-xs font-medium transition ${
              filterStatus === s ? 'bg-[#26619c] text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}>
            {s === '' ? 'Todos' : STATUS_LABELS[s]}
          </button>
        ))}
      </div>

      {/* Receive form */}
      {showForm && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
          <h3 className="font-semibold text-gray-800 mb-4">Nova Encomenda</h3>
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-600 mb-1">Unidade *</label>
                <input value={unit} onChange={(e) => setUnit(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#26619c]/40 focus:border-[#26619c]"
                  placeholder="Ex: 201" />
              </div>
              <div>
                <label className="block text-xs text-gray-600 mb-1">Bloco</label>
                <input value={block} onChange={(e) => setBlock(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#26619c]/40 focus:border-[#26619c]"
                  placeholder="Ex: A" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-600 mb-1">Transportadora</label>
                <input value={carrier} onChange={(e) => setCarrier(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#26619c]/40 focus:border-[#26619c]"
                  placeholder="Correios, iFood…" />
              </div>
              <div>
                <label className="block text-xs text-gray-600 mb-1">Rastreio</label>
                <input value={tracking} onChange={(e) => setTracking(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#26619c]/40 focus:border-[#26619c]"
                  placeholder="AA000000000BR" />
              </div>
            </div>
            <PhotoCapture
              label="Foto da Etiqueta *"
              onCapture={(entry) => setPhotos((prev) => [...prev, entry])}
            />
            {photos.length > 0 && (
              <p className="text-xs text-green-600">{photos.length} foto(s) adicionada(s)</p>
            )}
            <button onClick={handleReceive} disabled={loading}
              className="w-full bg-[#26619c] hover:bg-[#1a4f87] text-white py-2.5 rounded-xl font-medium transition disabled:opacity-50">
              {loading ? 'Salvando…' : 'Registrar Encomenda'}
            </button>
          </div>
        </div>
      )}

      {/* Delivery modal */}
      {deliveryTarget && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40">
          <div className="w-full max-w-md bg-white rounded-t-2xl sm:rounded-2xl shadow-xl p-6">
            <h3 className="font-semibold text-gray-800 mb-1">
              Entregar — Unid. {deliveryTarget.unit}{deliveryTarget.block ? ` / Bl. ${deliveryTarget.block}` : ''}
            </h3>
            {deliveryTarget.resident_name && (
              <p className="text-xs text-gray-500 mb-4 flex items-center gap-1">
                <User className="w-3 h-3" />
                {deliveryTarget.resident_name}
                {deliveryTarget.resident_cep ? ` · CEP ${deliveryTarget.resident_cep}` : ''}
                {deliveryTarget.resident_phone ? ` · ${deliveryTarget.resident_phone}` : ''}
              </p>
            )}
            <div className="flex flex-col gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Nome do Recebedor *</label>
                <input value={recipientName} onChange={(e) => setRecipientName(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#26619c]/40"
                  placeholder="Nome completo" />
              </div>
              <SignaturePad onSave={setSignatureUrl} onClear={() => setSignatureUrl('')} />
            </div>
            <div className="flex gap-3 mt-5">
              <button onClick={() => { setDeliveryTarget(null); setRecipientName(''); setSignatureUrl('') }}
                className="flex-1 border border-gray-300 text-gray-600 py-2.5 rounded-xl text-sm font-medium hover:bg-gray-50 transition">
                Cancelar
              </button>
              <button onClick={handleDeliver} disabled={loading || !signatureUrl || !recipientName}
                className="flex-1 bg-[#26619c] hover:bg-[#1a4f87] text-white py-2.5 rounded-xl text-sm font-medium transition disabled:opacity-50">
                {loading ? 'Salvando…' : 'Confirmar Entrega'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Package list */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        {packages.length === 0 ? (
          <div className="p-8 text-center text-gray-400 text-sm">Nenhuma encomenda encontrada.</div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {packages.map((pkg) => (
              <li key={pkg.id} className="px-4 py-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-800">
                      Unid. {pkg.unit}{pkg.block ? ` / Bl. ${pkg.block}` : ''}
                    </p>
                    {pkg.resident_name && (
                      <p className="text-xs text-[#26619c] font-medium flex items-center gap-1 mt-0.5">
                        <User className="w-3 h-3" />
                        {pkg.resident_name}
                        {pkg.resident_cep ? ` · CEP ${pkg.resident_cep}` : ''}
                      </p>
                    )}
                    <p className="text-xs text-gray-400 mt-0.5">
                      {pkg.carrier_name ?? '—'}{pkg.tracking_code ? ` · ${pkg.tracking_code}` : ''}
                    </p>
                    <p className="text-xs text-gray-400">
                      Recebido {new Date(pkg.received_at).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' })}
                      {' '}às{' '}
                      {new Date(pkg.received_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[pkg.status]}`}>
                      {STATUS_LABELS[pkg.status]}
                    </span>
                    {(pkg.status === 'received' || pkg.status === 'notified') && (
                      <button onClick={() => setDeliveryTarget(pkg)}
                        className="text-xs text-[#26619c] hover:underline">
                        Entregar
                      </button>
                    )}
                    {pkg.has_delivery_fee && (
                      <span className="text-xs text-amber-600 font-medium">
                        Taxa R$ {parseFloat(pkg.delivery_fee_amount ?? '2.50').toFixed(2)}
                      </span>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
