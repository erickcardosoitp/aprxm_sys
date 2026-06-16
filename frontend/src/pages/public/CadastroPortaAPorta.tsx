import { useEffect, useState, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import toast, { Toaster } from 'react-hot-toast'
import axios from 'axios'
import { CheckCircle2, Upload, X, ChevronDown, ChevronUp, AlertCircle } from 'lucide-react'

const API = '/api/v1'

interface Mensalidade {
  id: string
  reference_month: string
  due_date: string | null
  amount: string
  status: string
}
interface PaymentMethod { id: string; name: string }
interface Resident {
  id: string; full_name: string; phone: string | null
  address: string; unit: string | null; status: string
}

const MONTH_LABELS: Record<string, string> = {
  '01':'Jan','02':'Fev','03':'Mar','04':'Abr','05':'Mai','06':'Jun',
  '07':'Jul','08':'Ago','09':'Set','10':'Out','11':'Nov','12':'Dez',
}
function fmtMonth(ref: string) {
  const [y, m] = ref.split('-')
  return `${MONTH_LABELS[m] ?? m}/${y}`
}
function fmtCurrency(v: string | number) {
  return Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}
function isOverdue(m: Mensalidade) {
  if (!m.due_date) return false
  return new Date(m.due_date) < new Date()
}

export default function AgentPaymentPage() {
  const [params] = useSearchParams()
  const token = params.get('token') ?? ''

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [resident, setResident] = useState<Resident | null>(null)
  const [mensalidades, setMensalidades] = useState<Mensalidade[]>([])
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([])

  // Pay state
  const [paying, setPaying] = useState<string | null>(null)
  const [payMethod, setPayMethod] = useState('')
  const [proofUrl, setProofUrl] = useState('')
  const [uploading, setUploading] = useState(false)
  const [paidIds, setPaidIds] = useState<Set<string>>(new Set())
  const fileRef = useRef<HTMLInputElement>(null)

  // Acordo state
  const [acordoOpen, setAcordoOpen] = useState(false)
  const [acordoFrom, setAcordoFrom] = useState('')
  const [acordoTo, setAcordoTo] = useState('')
  const [acordoInstallments, setAcordoInstallments] = useState('1')
  const [acordoAmount, setAcordoAmount] = useState('')
  const [acordoSubmitting, setAcordoSubmitting] = useState(false)
  const [acordoDone, setAcordoDone] = useState(false)

  useEffect(() => {
    if (!token) { setError('Token inválido.'); setLoading(false); return }
    axios.get(`${API}/crm/public/member?token=${encodeURIComponent(token)}`)
      .then(r => {
        setResident(r.data.resident)
        setMensalidades(r.data.mensalidades)
        setPaymentMethods(r.data.payment_methods)
        if (r.data.payment_methods.length > 0) setPayMethod(r.data.payment_methods[0].id)
      })
      .catch(() => setError('Link inválido ou expirado.'))
      .finally(() => setLoading(false))
  }, [token])

  const selectedMethod = paymentMethods.find(pm => pm.id === payMethod)
  const isPix = selectedMethod?.name?.toLowerCase().includes('pix') ?? false

  const handleUpload = async (file: File) => {
    setUploading(true)
    const fd = new FormData()
    fd.append('file', file)
    fd.append('folder', 'comprovantes')
    try {
      const r = await axios.post(`${API}/uploads/image`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      setProofUrl(r.data.url)
      toast.success('Comprovante enviado')
    } catch { toast.error('Erro ao enviar comprovante') }
    finally { setUploading(false) }
  }

  const handlePay = async (mId: string) => {
    if (!payMethod) { toast.error('Selecione a forma de pagamento'); return }
    if (isPix && !proofUrl) { toast.error('Comprovante PIX obrigatório'); return }
    setPaying(mId)
    try {
      await axios.post(`${API}/crm/public/pay?token=${encodeURIComponent(token)}`, {
        mensalidade_id: mId,
        payment_method_id: payMethod,
        payment_proof_url: proofUrl || null,
      })
      setPaidIds(s => new Set([...s, mId]))
      setProofUrl('')
      toast.success('Pagamento registrado!')
    } catch (e: any) {
      toast.error(e.response?.data?.detail ?? 'Erro ao registrar pagamento')
    } finally { setPaying(null) }
  }

  const handleAcordo = async () => {
    if (!acordoFrom || !acordoTo) { toast.error('Informe o período'); return }
    if (!acordoAmount) { toast.error('Informe o valor da parcela'); return }
    setAcordoSubmitting(true)
    try {
      await axios.post(`${API}/crm/public/acordo?token=${encodeURIComponent(token)}`, {
        date_from: acordoFrom,
        date_to: acordoTo,
        installments: parseInt(acordoInstallments),
        monthly_amount: acordoAmount,
        payment_method_id: payMethod || null,
      })
      setAcordoDone(true)
      toast.success('Acordo registrado!')
    } catch (e: any) {
      toast.error(e.response?.data?.detail ?? 'Erro ao registrar acordo')
    } finally { setAcordoSubmitting(false) }
  }

  const pendentes = mensalidades.filter(m => !paidIds.has(m.id))
  const overdue = pendentes.filter(isOverdue)
  const upcoming = pendentes.filter(m => !isOverdue(m))

  if (loading) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-[#26619c] border-t-transparent rounded-full animate-spin" />
    </div>
  )

  if (error) return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center gap-3 p-6">
      <AlertCircle className="w-12 h-12 text-red-400" />
      <p className="text-gray-600 text-center">{error}</p>
    </div>
  )

  return (
    <div className="min-h-screen bg-gray-50">
      <Toaster position="top-center" />

      {/* Header */}
      <div className="bg-[#26619c] text-white px-4 py-5">
        <p className="text-xs opacity-70 uppercase tracking-wide font-medium mb-0.5">Cobrança</p>
        <h1 className="text-lg font-bold leading-tight">{resident?.full_name}</h1>
        {resident?.address && <p className="text-xs opacity-80 mt-0.5">{resident.address}{resident.unit ? ` — ${resident.unit}` : ''}</p>}
      </div>

      <div className="px-4 py-4 flex flex-col gap-4 max-w-md mx-auto">

        {/* Forma de pagamento (global) */}
        <div className="bg-white rounded-2xl border border-gray-200 p-4">
          <p className="text-xs font-semibold text-gray-500 mb-2 uppercase tracking-wide">Forma de Pagamento</p>
          <div className="flex flex-wrap gap-2">
            {paymentMethods.map(pm => (
              <button key={pm.id} onClick={() => { setPayMethod(pm.id); setProofUrl('') }}
                className={`px-3 py-1.5 rounded-xl text-sm font-medium border transition ${payMethod === pm.id ? 'bg-[#26619c] text-white border-[#26619c]' : 'bg-white text-gray-600 border-gray-200'}`}>
                {pm.name}
              </button>
            ))}
          </div>

          {isPix && (
            <div className="mt-3">
              {proofUrl ? (
                <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-xl px-3 py-2">
                  <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0" />
                  <span className="text-xs text-green-700 truncate flex-1">Comprovante anexado</span>
                  <button onClick={() => setProofUrl('')}><X className="w-4 h-4 text-green-500" /></button>
                </div>
              ) : (
                <button onClick={() => fileRef.current?.click()}
                  disabled={uploading}
                  className="w-full flex items-center justify-center gap-2 border-2 border-dashed border-[#26619c]/40 rounded-xl py-3 text-sm text-[#26619c] font-medium hover:bg-[#26619c]/5 transition disabled:opacity-50">
                  <Upload className="w-4 h-4" />
                  {uploading ? 'Enviando…' : 'Anexar comprovante PIX (obrigatório)'}
                </button>
              )}
              <input ref={fileRef} type="file" accept="image/*,application/pdf" className="hidden"
                onChange={e => e.target.files?.[0] && handleUpload(e.target.files[0])} />
            </div>
          )}
        </div>

        {/* Mensalidades em atraso */}
        {overdue.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-red-600 uppercase tracking-wide mb-2 px-1">Em atraso ({overdue.length})</p>
            <div className="flex flex-col gap-2">
              {overdue.map(m => (
                <div key={m.id} className="bg-white rounded-2xl border border-red-100 p-4 flex items-center justify-between gap-3">
                  <div>
                    <p className="font-semibold text-gray-800 text-sm">{fmtMonth(m.reference_month)}</p>
                    <p className="text-xs text-red-500">{m.due_date ? `Venceu ${new Date(m.due_date).toLocaleDateString('pt-BR')}` : 'Vencido'}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <p className="font-bold text-gray-800">{fmtCurrency(m.amount)}</p>
                    <button onClick={() => handlePay(m.id)}
                      disabled={paying === m.id || (isPix && !proofUrl)}
                      className="bg-[#26619c] text-white text-xs font-semibold px-3 py-1.5 rounded-xl disabled:opacity-40">
                      {paying === m.id ? '…' : 'Pagar'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Mensalidades futuras/atuais */}
        {upcoming.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2 px-1">Próximas / Atuais ({upcoming.length})</p>
            <div className="flex flex-col gap-2">
              {upcoming.map(m => (
                <div key={m.id} className="bg-white rounded-2xl border border-gray-100 p-4 flex items-center justify-between gap-3">
                  <div>
                    <p className="font-semibold text-gray-800 text-sm">{fmtMonth(m.reference_month)}</p>
                    {m.due_date && <p className="text-xs text-gray-400">Vence {new Date(m.due_date).toLocaleDateString('pt-BR')}</p>}
                  </div>
                  <div className="flex items-center gap-2">
                    <p className="font-bold text-gray-800">{fmtCurrency(m.amount)}</p>
                    <button onClick={() => handlePay(m.id)}
                      disabled={paying === m.id || (isPix && !proofUrl)}
                      className="bg-gray-100 text-gray-700 text-xs font-semibold px-3 py-1.5 rounded-xl disabled:opacity-40 hover:bg-gray-200">
                      {paying === m.id ? '…' : 'Pagar'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {pendentes.length === 0 && (
          <div className="bg-green-50 border border-green-200 rounded-2xl p-5 text-center">
            <CheckCircle2 className="w-8 h-8 text-green-500 mx-auto mb-2" />
            <p className="text-green-700 font-semibold text-sm">Tudo em dia!</p>
          </div>
        )}

        {/* Acordo */}
        {overdue.length > 0 && (
          <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
            <button onClick={() => setAcordoOpen(o => !o)}
              className="w-full flex items-center justify-between px-4 py-3 text-sm font-semibold text-gray-700">
              Registrar Acordo de Dívida
              {acordoOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
            {acordoOpen && !acordoDone && (
              <div className="px-4 pb-4 flex flex-col gap-3 border-t border-gray-100">
                <div className="grid grid-cols-2 gap-2 mt-3">
                  <div>
                    <label className="text-xs text-gray-500 mb-1 block">De (AAAA-MM)</label>
                    <input type="month" value={acordoFrom} onChange={e => setAcordoFrom(e.target.value)}
                      className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#26619c]/30" />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 mb-1 block">Até (AAAA-MM)</label>
                    <input type="month" value={acordoTo} onChange={e => setAcordoTo(e.target.value)}
                      className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#26619c]/30" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-xs text-gray-500 mb-1 block">Parcelas</label>
                    <input type="number" min="1" max="24" value={acordoInstallments} onChange={e => setAcordoInstallments(e.target.value)}
                      className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#26619c]/30" />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 mb-1 block">Valor/parcela (R$)</label>
                    <input type="number" min="0" step="0.01" value={acordoAmount} onChange={e => setAcordoAmount(e.target.value)}
                      placeholder="0,00"
                      className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#26619c]/30" />
                  </div>
                </div>
                <button onClick={handleAcordo} disabled={acordoSubmitting}
                  className="w-full bg-[#26619c] text-white rounded-xl py-3 text-sm font-semibold disabled:opacity-50">
                  {acordoSubmitting ? 'Registrando…' : 'Confirmar Acordo'}
                </button>
              </div>
            )}
            {acordoOpen && acordoDone && (
              <div className="px-4 pb-4 pt-3 border-t border-gray-100 flex items-center gap-2 text-green-700">
                <CheckCircle2 className="w-5 h-5" />
                <span className="text-sm font-medium">Acordo registrado com sucesso.</span>
              </div>
            )}
          </div>
        )}

      </div>
    </div>
  )
}
