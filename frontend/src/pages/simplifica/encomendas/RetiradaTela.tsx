import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, Search, Package } from 'lucide-react'
import toast from 'react-hot-toast'
import { SignaturePad } from '../../../components/packages/SignaturePad'
import { packageService } from '../../../services/packages'
import { financeService } from '../../../services/finance'
import api from '../../../services/api'
import type { Package as Pkg, PaymentMethod } from '../../../types'
import { SECTOR_COLORS } from '../theme'

interface Props { onClose: () => void }

type Step = 'busca' | 'assinatura' | 'pagamento'

const STATUS_LABEL: Record<string, string> = {
  received: 'Aguardando', notified: 'Notificado', reversed: 'Estornado',
}
const STATUS_COLOR: Record<string, string> = {
  received: 'bg-amber-100 text-amber-700',
  notified: 'bg-blue-100 text-blue-700',
  reversed: 'bg-gray-100 text-gray-600',
}

export function RetiradaTela({ onClose }: Props) {
  const color = SECTOR_COLORS.encomendas

  const [step, setStep] = useState<Step>('busca')
  const [query, setQuery] = useState('')
  const [packages, setPackages] = useState<Pkg[]>([])
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<Pkg | null>(null)

  // Assinatura
  const [recipientName, setRecipientName] = useState('')
  const [sigUrl, setSigUrl] = useState('')

  // Pagamento (taxa)
  const [needsPayment, setNeedsPayment] = useState(false)
  const [checkLoading, setCheckLoading] = useState(false)
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([])
  const [methodId, setMethodId] = useState('')
  const [pixName, setPixName] = useState('')
  const [exemptionToken, setExemptionToken] = useState('')
  const [saving, setSaving] = useState(false)

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    if (query.length < 2) { setPackages([]); return }
    timerRef.current = setTimeout(async () => {
      setLoading(true)
      try {
        const r = await api.get<Pkg[]>('/packages', {
          params: { q: query, status: 'received,notified,reversed' }
        })
        setPackages(r.data.slice(0, 10))
      } catch { /* silent */ } finally { setLoading(false) }
    }, 350)
  }, [query])

  const selectPackage = async (pkg: Pkg) => {
    setSelected(pkg)
    setStep('assinatura')
    // Pre-fill recipient name with resident name
    if (pkg.resident_name) setRecipientName(pkg.resident_name)
    // Check if payment needed
    setCheckLoading(true)
    try {
      const r = await api.get<{ fee_will_apply: boolean }>(`/packages/${pkg.id}/delivery-check`)
      const feePending = r.data.fee_will_apply
      setNeedsPayment(feePending)
      if (feePending) {
        const pm = await api.get<PaymentMethod[]>('/finance/payment-methods')
        setPaymentMethods(pm.data)
      }
    } catch { setNeedsPayment(false) } finally { setCheckLoading(false) }
  }

  const proceedToPayment = () => {
    if (!recipientName.trim()) { toast.error('Informe o nome de quem está retirando.'); return }
    if (!sigUrl) { toast.error('Assinatura obrigatória.'); return }
    if (needsPayment) setStep('pagamento')
    else handleDeliver()
  }

  const isPix = paymentMethods.find(m => m.id === methodId)?.name?.toLowerCase().includes('pix')

  const handleDeliver = async () => {
    if (!selected) return
    if (!recipientName.trim()) { toast.error('Informe o nome de quem está retirando.'); return }
    if (!sigUrl) { toast.error('Assinatura obrigatória.'); return }
    if (needsPayment && !methodId && !exemptionToken) { toast.error('Selecione forma de pagamento ou token de isenção.'); return }
    if (isPix && !pixName.trim()) { toast.error('Informe o nome do pagador PIX.'); return }

    setSaving(true)
    try {
      let sessionId: string | undefined
      if (needsPayment && methodId) {
        try {
          const sess = await financeService.getCurrentSession()
          sessionId = sess.data.id
        } catch { /* no session — backend handles */ }
      }
      await packageService.deliver(selected.id, {
        delivered_to_name: recipientName.trim(),
        signature_url: sigUrl,
        payment_method_id: methodId || undefined,
        payer_name: isPix ? pixName : undefined,
        cash_session_id: sessionId,
        exemption_token: exemptionToken || undefined,
      })
      toast.success('Entrega registrada!')
      onClose()
    } catch (e: any) {
      toast.error(e.response?.data?.detail ?? 'Erro ao registrar entrega.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-40 bg-slate-100 flex flex-col">
      <div className="flex items-center gap-3 px-4 py-3 text-white"
        style={{ backgroundColor: color, paddingTop: 'max(12px, env(safe-area-inset-top))' }}>
        <button onClick={step === 'busca' ? onClose : () => setStep(step === 'pagamento' ? 'assinatura' : 'busca')}
          className="p-1 -ml-1 rounded-lg hover:bg-white/10">
          <ChevronLeft className="w-6 h-6" />
        </button>
        <span className="font-bold text-base flex-1">Retirada de Encomenda</span>
      </div>

      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4 pb-32">

        {/* BUSCA */}
        {step === 'busca' && (
          <>
            <p className="text-sm font-semibold text-gray-700">Buscar encomenda pendente</p>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input value={query} onChange={e => setQuery(e.target.value)}
                placeholder="Nome do morador, unidade ou rastreio…"
                className="w-full border-2 border-gray-200 rounded-xl pl-10 pr-4 py-3 text-sm focus:outline-none focus:border-amber-500 bg-white"
                autoFocus />
              {loading && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400">…</span>}
            </div>

            {packages.length > 0 && (
              <div className="flex flex-col gap-2">
                {packages.map(pkg => (
                  <button key={pkg.id} onClick={() => selectPackage(pkg)}
                    className="bg-white border border-gray-100 rounded-2xl p-4 text-left shadow-sm flex items-start gap-3 active:scale-[0.98] transition">
                    <Package className="w-5 h-5 mt-0.5 shrink-0" style={{ color }} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-800 truncate">{pkg.resident_name ?? 'Sem morador'}</p>
                      <p className="text-xs text-gray-500">
                        {pkg.unit ? `Casa/Apto ${pkg.unit}` : ''}
                        {pkg.carrier_name ? ` · ${pkg.carrier_name}` : ''}
                        {pkg.tracking_code ? ` · ${pkg.tracking_code}` : ''}
                      </p>
                      <p className="text-xs text-gray-400 mt-0.5">
                        {new Date(pkg.received_at).toLocaleDateString('pt-BR')}
                      </p>
                    </div>
                    <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full shrink-0 ${STATUS_COLOR[pkg.status] ?? 'bg-gray-100 text-gray-600'}`}>
                      {STATUS_LABEL[pkg.status] ?? pkg.status}
                    </span>
                  </button>
                ))}
              </div>
            )}

            {query.length >= 2 && packages.length === 0 && !loading && (
              <p className="text-sm text-gray-400 text-center py-8">Nenhuma encomenda pendente encontrada.</p>
            )}
          </>
        )}

        {/* ASSINATURA */}
        {step === 'assinatura' && selected && (
          <>
            <div className="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm">
              <p className="text-xs text-gray-500 mb-1">Encomenda selecionada</p>
              <p className="text-sm font-semibold text-gray-800">{selected.resident_name ?? 'Sem morador'}</p>
              <p className="text-xs text-gray-500">
                {selected.carrier_name ?? ''}{selected.tracking_code ? ` · ${selected.tracking_code}` : ''}
              </p>
              {needsPayment && (
                <p className="text-xs text-amber-600 font-semibold mt-1">⚠ Taxa de entrega aplicável (visitante)</p>
              )}
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">
                Quem está retirando? <span className="text-red-500">*</span>
              </label>
              <input value={recipientName} onChange={e => setRecipientName(e.target.value)}
                placeholder="Nome completo"
                className="w-full border-2 border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-amber-500 bg-white" />
            </div>

            <SignaturePad
              label="Assinatura *"
              onSave={url => setSigUrl(url)}
            />
          </>
        )}

        {/* PAGAMENTO */}
        {step === 'pagamento' && (
          <>
            <p className="text-sm font-semibold text-gray-700">Taxa de entrega (visitante)</p>
            <p className="text-xs text-gray-500">Valor definido na encomenda. Selecione a forma de pagamento.</p>

            <div className="flex flex-wrap gap-2">
              {paymentMethods.map(m => (
                <button key={m.id} onClick={() => setMethodId(m.id === methodId ? '' : m.id)}
                  className={`px-4 py-2.5 rounded-xl text-sm font-semibold border-2 transition ${
                    methodId === m.id
                      ? 'text-white border-transparent'
                      : 'bg-white border-gray-200 text-gray-700'
                  }`}
                  style={methodId === m.id ? { backgroundColor: color, borderColor: color } : undefined}>
                  {m.name}
                </button>
              ))}
            </div>

            {isPix && (
              <input value={pixName} onChange={e => setPixName(e.target.value)}
                placeholder="Nome do pagador PIX *"
                className="border-2 border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-amber-500 bg-white" />
            )}

            <div className="border-t border-gray-200 pt-4">
              <p className="text-xs text-gray-500 mb-2">Ou informe token de isenção:</p>
              <input value={exemptionToken} onChange={e => setExemptionToken(e.target.value)}
                placeholder="Token de isenção"
                className="w-full border-2 border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-amber-500 bg-white" />
            </div>
          </>
        )}
      </div>

      <div className="fixed bottom-0 left-0 right-0 p-4 bg-white border-t border-gray-200"
        style={{ paddingBottom: 'max(16px, env(safe-area-inset-bottom))' }}>
        {step === 'assinatura' && (
          <button disabled={!recipientName.trim() || !sigUrl || checkLoading}
            onClick={proceedToPayment}
            className="w-full py-4 rounded-xl text-base font-bold text-white disabled:opacity-40"
            style={{ backgroundColor: color }}>
            {checkLoading ? 'Verificando…' : needsPayment ? 'Próximo — Pagamento' : 'Confirmar Entrega'}
          </button>
        )}
        {step === 'pagamento' && (
          <button disabled={saving || (!methodId && !exemptionToken)}
            onClick={handleDeliver}
            className="w-full py-4 rounded-xl text-base font-bold text-white disabled:opacity-40"
            style={{ backgroundColor: color }}>
            {saving ? 'Registrando…' : 'Confirmar Entrega'}
          </button>
        )}
      </div>
    </div>
  )
}
