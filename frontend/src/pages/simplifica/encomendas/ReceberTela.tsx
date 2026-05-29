import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, Search, X, QrCode } from 'lucide-react'
import toast from 'react-hot-toast'
import { PhotoCapture } from '../../../components/packages/PhotoCapture'
import { BarcodeScannerModal } from '../../../components/packages/BarcodeScanner'
import { packageService } from '../../../services/packages'
import api from '../../../services/api'
import type { Resident } from '../../../types'
import { SECTOR_COLORS } from '../theme'

interface Props { onClose: () => void }

type Step = 'recipient' | 'details'

interface PhotoEntry { url: string; label: string; taken_at: string }

export function ReceberTela({ onClose }: Props) {
  const color = SECTOR_COLORS.encomendas

  // Step
  const [step, setStep] = useState<Step>('recipient')

  // Recipient
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Resident[]>([])
  const [searching, setSearching] = useState(false)
  const [selected, setSelected] = useState<Resident | null>(null)
  const [guestMode, setGuestMode] = useState(false)
  const [guestName, setGuestName] = useState('')
  const [guestPhone, setGuestPhone] = useState('')
  const [guestCep, setGuestCep] = useState('')
  const [cepInfo, setCepInfo] = useState<{ street: string; district: string } | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Details
  const [photos, setPhotos] = useState<PhotoEntry[]>([])
  const [carrier, setCarrier] = useState('')
  const [tracking, setTracking] = useState('')
  const [showScanner, setShowScanner] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    if (query.length < 2) { setResults([]); return }
    timerRef.current = setTimeout(async () => {
      setSearching(true)
      try {
        const r = await api.get<Resident[]>('/residents/search', { params: { q: query } })
        setResults(r.data.slice(0, 8))
        if (r.data.length === 0) setGuestMode(true)
      } catch { /* silent */ } finally { setSearching(false) }
    }, 350)
  }, [query])

  useEffect(() => {
    const digits = guestCep.replace(/\D/g, '')
    if (digits.length !== 8) { setCepInfo(null); return }
    packageService.lookupCep(digits)
      .then(r => setCepInfo(r.data))
      .catch(() => setCepInfo(null))
  }, [guestCep])

  const selectResident = (r: Resident) => {
    setSelected(r)
    setResults([])
    setGuestMode(false)
    setQuery(r.full_name)
  }

  const clearRecipient = () => {
    setSelected(null)
    setGuestMode(false)
    setQuery('')
    setResults([])
    setGuestName('')
    setGuestPhone('')
    setGuestCep('')
  }

  const canProceed = selected || (guestMode && guestName.trim())

  const handleSave = async () => {
    if (photos.length === 0) { toast.error('Adicione ao menos 1 foto da encomenda.'); return }
    setSaving(true)
    try {
      let residentId = selected?.id
      if (!residentId && guestMode && guestName.trim()) {
        const r = await api.post<Resident>('/residents', {
          type: 'guest',
          full_name: guestName.trim(),
          phone_primary: guestPhone || undefined,
          address_cep: guestCep || undefined,
          status: 'active',
          terms_accepted: false,
          lgpd_accepted: false,
        })
        residentId = r.data.id
      }
      await packageService.receive({
        resident_id: residentId,
        carrier_name: carrier || undefined,
        tracking_code: tracking || undefined,
        photo_urls: photos,
      })
      toast.success('Encomenda registrada!')
      onClose()
    } catch (e: any) {
      toast.error(e.response?.data?.detail ?? 'Erro ao registrar.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-40 bg-slate-100 flex flex-col">
      <div className="flex items-center gap-3 px-4 py-3 text-white"
        style={{ backgroundColor: color, paddingTop: 'max(12px, env(safe-area-inset-top))' }}>
        <button onClick={step === 'details' ? () => setStep('recipient') : onClose}
          className="p-1 -ml-1 rounded-lg hover:bg-white/10">
          <ChevronLeft className="w-6 h-6" />
        </button>
        <span className="font-bold text-base flex-1">Receber Encomenda</span>
        <span className="text-xs bg-white/20 px-2 py-0.5 rounded-full">
          {step === 'recipient' ? '1/2' : '2/2'}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4 pb-32">

        {step === 'recipient' && (
          <>
            <p className="text-sm font-semibold text-gray-700">Para quem é a encomenda?</p>

            {!selected ? (
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  value={query}
                  onChange={e => { setQuery(e.target.value); setGuestMode(false) }}
                  placeholder="Nome, CPF ou CEP do morador…"
                  className="w-full border-2 border-gray-200 rounded-xl pl-10 pr-4 py-3 text-sm focus:outline-none focus:border-amber-500 bg-white"
                  autoFocus
                />
                {searching && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400">…</span>}
              </div>
            ) : (
              <div className="flex items-center gap-3 bg-white border-2 border-amber-400 rounded-xl p-3">
                <div className="flex-1">
                  <p className="text-sm font-semibold text-gray-800">{selected.full_name}</p>
                  <p className="text-xs text-gray-400">
                    {selected.unit ? `Casa/Apto ${selected.unit}` : ''}
                    {selected.phone_primary ? ` · ${selected.phone_primary}` : ''}
                  </p>
                </div>
                <button onClick={clearRecipient} className="text-gray-400 hover:text-red-500">
                  <X className="w-5 h-5" />
                </button>
              </div>
            )}

            {results.length > 0 && !selected && (
              <div className="flex flex-col divide-y divide-gray-100 bg-white border border-gray-200 rounded-xl overflow-hidden">
                {results.map(r => (
                  <button key={r.id} onClick={() => selectResident(r)}
                    className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 text-left">
                    <div className="flex-1">
                      <p className="text-sm font-semibold text-gray-800">{r.full_name}</p>
                      <p className="text-xs text-gray-400">
                        {r.type === 'member' ? 'Associado' : 'Visitante'}
                        {r.unit ? ` · Casa/Apto ${r.unit}` : ''}
                      </p>
                    </div>
                  </button>
                ))}
                <button onClick={() => { setGuestMode(true); setGuestName(query); setResults([]) }}
                  className="flex items-center gap-2 px-4 py-3 text-sm text-amber-600 font-medium hover:bg-amber-50">
                  + Cadastrar novo morador
                </button>
              </div>
            )}

            {guestMode && !selected && (
              <div className="bg-white border border-amber-200 rounded-xl p-4 flex flex-col gap-3">
                <p className="text-xs font-semibold text-amber-700">Morador não encontrado — cadastrar novo visitante:</p>
                <input value={guestName} onChange={e => setGuestName(e.target.value)}
                  placeholder="Nome completo *"
                  className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-amber-400" />
                <div className="grid grid-cols-2 gap-2">
                  <input value={guestPhone} onChange={e => setGuestPhone(e.target.value)}
                    placeholder="Telefone" type="tel"
                    className="border border-gray-200 rounded-xl px-3 py-3 text-sm focus:outline-none focus:border-amber-400" />
                  <div>
                    <input value={guestCep} onChange={e => setGuestCep(e.target.value)}
                      placeholder="CEP" inputMode="numeric"
                      className="w-full border border-gray-200 rounded-xl px-3 py-3 text-sm focus:outline-none focus:border-amber-400" />
                    {cepInfo && <p className="text-[11px] text-emerald-700 mt-1 truncate">{cepInfo.street}, {cepInfo.district}</p>}
                  </div>
                </div>
              </div>
            )}

            {query.length >= 2 && results.length === 0 && !searching && !guestMode && !selected && (
              <button onClick={() => { setGuestMode(true); setGuestName(query) }}
                className="text-sm text-amber-600 font-medium underline self-start">
                + Cadastrar "{query}" como novo visitante
              </button>
            )}
          </>
        )}

        {step === 'details' && (
          <>
            <p className="text-sm font-semibold text-gray-700">Detalhes da encomenda</p>

            <div className="flex gap-2">
              <input value={tracking} onChange={e => setTracking(e.target.value)}
                placeholder="Código de rastreio (opcional)"
                className="flex-1 border-2 border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-amber-500 bg-white" />
              <button onClick={() => setShowScanner(true)}
                className="w-12 h-12 flex items-center justify-center rounded-xl border-2 border-gray-200 bg-white text-gray-500 hover:border-amber-400 hover:text-amber-600 transition">
                <QrCode className="w-5 h-5" />
              </button>
            </div>

            <input value={carrier} onChange={e => setCarrier(e.target.value)}
              placeholder="Transportadora (opcional)"
              className="border-2 border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-amber-500 bg-white" />

            <div>
              <p className="text-sm font-semibold text-gray-700 mb-2">Fotos <span className="text-red-500">*</span></p>
              {photos.map((p, i) => (
                <div key={i} className="relative mb-2 rounded-xl overflow-hidden border border-gray-200">
                  <img src={p.url} alt="" className="w-full h-32 object-cover" />
                  <button onClick={() => setPhotos(prev => prev.filter((_, j) => j !== i))}
                    className="absolute top-2 right-2 bg-white/80 rounded-full p-1">
                    <X className="w-4 h-4 text-gray-700" />
                  </button>
                </div>
              ))}
              <PhotoCapture
                label={`Foto ${photos.length + 1}`}
                onCapture={entry => setPhotos(prev => [...prev, entry])}
              />
            </div>
          </>
        )}
      </div>

      <div className="fixed bottom-0 left-0 right-0 p-4 bg-white border-t border-gray-200"
        style={{ paddingBottom: 'max(16px, env(safe-area-inset-bottom))' }}>
        {step === 'recipient' ? (
          <button
            disabled={!canProceed}
            onClick={() => setStep('details')}
            className="w-full py-4 rounded-xl text-base font-bold text-white disabled:opacity-40 transition"
            style={{ backgroundColor: color }}>
            Próximo — Detalhes
          </button>
        ) : (
          <button
            disabled={saving || photos.length === 0}
            onClick={handleSave}
            className="w-full py-4 rounded-xl text-base font-bold text-white disabled:opacity-40 transition"
            style={{ backgroundColor: color }}>
            {saving ? 'Registrando…' : 'Confirmar Recebimento'}
          </button>
        )}
      </div>

      {showScanner && (
        <BarcodeScannerModal
          onScan={code => { setTracking(code); setShowScanner(false) }}
          onClose={() => setShowScanner(false)}
        />
      )}
    </div>
  )
}
