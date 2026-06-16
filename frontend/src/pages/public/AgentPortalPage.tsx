import { useEffect, useState, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import toast, { Toaster } from 'react-hot-toast'
import axios from 'axios'
import { CheckCircle2, Upload, X, AlertCircle, Search, ArrowLeft } from 'lucide-react'

const API = '/api/v1'

interface PaymentMethod { id: string; name: string }
interface SearchResult {
  id: string; full_name: string; cpf: string | null
  address_street: string | null; address_number: string | null
  status: string; type: string
}
interface Mensalidade {
  id: string; reference_month: string; due_date: string | null
  amount: string; status: string
}
interface MemberData {
  resident: { id: string; full_name: string; address: string }
  mensalidades: Mensalidade[]
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
function formatCPF(v: string) {
  const d = v.replace(/\D/g, '').slice(0, 11)
  if (d.length <= 3) return d
  if (d.length <= 6) return `${d.slice(0,3)}.${d.slice(3)}`
  if (d.length <= 9) return `${d.slice(0,3)}.${d.slice(3,6)}.${d.slice(6)}`
  return `${d.slice(0,3)}.${d.slice(3,6)}.${d.slice(6,9)}-${d.slice(9)}`
}

type Flow = 'mensalidade' | 'novo'
type Step = 'choice' | 'search' | 'member' | 'register' | 'pay-new' | 'done'

export default function AgentPortalPage() {
  const [params] = useSearchParams()
  const token = params.get('token') ?? ''

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [assocName, setAssocName] = useState('')
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([])

  const [flow, setFlow] = useState<Flow | null>(null)
  const [step, setStep] = useState<Step>('choice')

  // mensalidade flow
  const [searchQ, setSearchQ] = useState('')
  const [searching, setSearching] = useState(false)
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [memberData, setMemberData] = useState<MemberData | null>(null)
  const [loadingMember, setLoadingMember] = useState(false)
  const [payMethod, setPayMethod] = useState('')
  const [paying, setPaying] = useState<string | null>(null)
  const [paidIds, setPaidIds] = useState<Set<string>>(new Set())
  const [proofUrl, setProofUrl] = useState('')
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  // novo associado flow
  const [form, setForm] = useState({
    full_name: '', cpf: '', phone_primary: '',
    address_cep: '', address_street: '', address_number: '',
    address_complement: '', address_neighborhood: '',
  })
  const [cepLoading, setCepLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [newMember, setNewMember] = useState<{
    resident_id: string; mensalidade_id: string; mensalidade_amount: string
    payment_methods: PaymentMethod[]
  } | null>(null)
  const [newPayMethod, setNewPayMethod] = useState('')
  const [newProofUrl, setNewProofUrl] = useState('')
  const [newUploading, setNewUploading] = useState(false)
  const newFileRef = useRef<HTMLInputElement>(null)
  const [newPaying, setNewPaying] = useState(false)

  useEffect(() => {
    if (!token) { setError('Token inválido.'); setLoading(false); return }
    axios.get(`${API}/crm/public/portal/init?token=${encodeURIComponent(token)}`)
      .then(r => {
        setAssocName(r.data.association?.name ?? '')
        setPaymentMethods(r.data.payment_methods ?? [])
        if (r.data.payment_methods?.length > 0) setPayMethod(r.data.payment_methods[0].id)
      })
      .catch(() => setError('Link inválido ou expirado.'))
      .finally(() => setLoading(false))
  }, [token])

  // debounced search
  useEffect(() => {
    if (step !== 'search' || searchQ.length < 2) { setSearchResults([]); return }
    const t = setTimeout(async () => {
      setSearching(true)
      try {
        const r = await axios.get(`${API}/crm/public/portal/search`, {
          params: { token, q: searchQ },
        })
        setSearchResults(r.data)
      } catch { setSearchResults([]) }
      finally { setSearching(false) }
    }, 350)
    return () => clearTimeout(t)
  }, [searchQ, step, token])

  const selectResident = async (id: string) => {
    setLoadingMember(true)
    setSearchResults([])
    try {
      const r = await axios.get(`${API}/crm/public/portal/member`, {
        params: { token, resident_id: id },
      })
      setMemberData(r.data)
      setStep('member')
    } catch { toast.error('Erro ao carregar dados.') }
    finally { setLoadingMember(false) }
  }

  const handleUpload = async (file: File, setUrl: (u: string) => void, setUpl: (b: boolean) => void) => {
    setUpl(true)
    const fd = new FormData()
    fd.append('file', file)
    fd.append('folder', 'comprovantes')
    try {
      const r = await axios.post(`${API}/uploads/image`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      setUrl(r.data.url)
      toast.success('Comprovante enviado')
    } catch { toast.error('Erro ao enviar comprovante') }
    finally { setUpl(false) }
  }

  const selectedMethod = paymentMethods.find(pm => pm.id === payMethod)
  const isPix = selectedMethod?.name?.toLowerCase().includes('pix') ?? false

  const handlePay = async (mId: string) => {
    if (!payMethod) { toast.error('Selecione a forma de pagamento'); return }
    if (isPix && !proofUrl) { toast.error('Comprovante PIX obrigatório'); return }
    if (!memberData) return
    setPaying(mId)
    try {
      await axios.post(`${API}/crm/public/portal/pay?token=${encodeURIComponent(token)}`, {
        resident_id: memberData.resident.id,
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

  const fetchCEP = async (cep: string) => {
    const digits = cep.replace(/\D/g, '')
    if (digits.length !== 8) return
    setCepLoading(true)
    try {
      const r = await axios.get(`https://viacep.com.br/ws/${digits}/json/`)
      if (!r.data.erro) {
        setForm(f => ({
          ...f,
          address_street: r.data.logradouro ?? f.address_street,
          address_neighborhood: r.data.bairro ?? f.address_neighborhood,
        }))
      }
    } catch { }
    finally { setCepLoading(false) }
  }

  const handleRegister = async () => {
    if (!form.full_name.trim()) { toast.error('Nome obrigatório'); return }
    if (!form.cpf.trim()) { toast.error('CPF obrigatório'); return }
    setSubmitting(true)
    try {
      const r = await axios.post(`${API}/crm/public/portal/register?token=${encodeURIComponent(token)}`, {
        ...form,
        cpf: form.cpf.replace(/\D/g, ''),
      })
      setNewMember(r.data)
      setNewPayMethod(r.data.payment_methods?.[0]?.id ?? '')
      setStep('pay-new')
    } catch (e: any) {
      toast.error(e.response?.data?.detail ?? 'Erro ao cadastrar')
    } finally { setSubmitting(false) }
  }

  const newSelectedMethod = newMember?.payment_methods.find(pm => pm.id === newPayMethod)
  const newIsPix = newSelectedMethod?.name?.toLowerCase().includes('pix') ?? false

  const handlePayNew = async () => {
    if (!newMember) return
    if (!newPayMethod) { toast.error('Selecione a forma de pagamento'); return }
    if (newIsPix && !newProofUrl) { toast.error('Comprovante PIX obrigatório'); return }
    setNewPaying(true)
    try {
      await axios.post(`${API}/crm/public/portal/pay?token=${encodeURIComponent(token)}`, {
        resident_id: newMember.resident_id,
        mensalidade_id: newMember.mensalidade_id,
        payment_method_id: newPayMethod,
        payment_proof_url: newProofUrl || null,
      })
      setStep('done')
      toast.success('Pagamento registrado!')
    } catch (e: any) {
      toast.error(e.response?.data?.detail ?? 'Erro ao registrar pagamento')
    } finally { setNewPaying(false) }
  }

  const reset = () => {
    setFlow(null); setStep('choice')
    setSearchQ(''); setSearchResults([]); setMemberData(null)
    setPaidIds(new Set()); setProofUrl('')
    setForm({ full_name:'', cpf:'', phone_primary:'', address_cep:'', address_street:'', address_number:'', address_complement:'', address_neighborhood:'' })
    setNewMember(null); setNewProofUrl('')
  }

  const inputCls = 'w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#26619c]/30'

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

  const pendentes = memberData?.mensalidades.filter(m => !paidIds.has(m.id)) ?? []
  const overdue = pendentes.filter(isOverdue)
  const upcoming = pendentes.filter(m => !isOverdue(m))

  return (
    <div className="min-h-screen bg-gray-50">
      <Toaster position="top-center" />

      {/* Header */}
      <div className="bg-[#26619c] text-white px-4 py-5">
        <p className="text-xs opacity-70 uppercase tracking-wide font-medium mb-0.5">Portal do Agente</p>
        <h1 className="text-lg font-bold leading-tight">{assocName || 'Associação'}</h1>
      </div>

      <div className="px-4 py-4 flex flex-col gap-4 max-w-md mx-auto">

        {/* CHOICE SCREEN */}
        {step === 'choice' && (
          <div className="flex flex-col gap-3 pt-2">
            <p className="text-sm text-gray-500 text-center mb-2">O que deseja fazer?</p>
            <button onClick={() => { setFlow('mensalidade'); setStep('search') }}
              className="w-full bg-[#26619c] text-white rounded-2xl py-5 text-base font-semibold flex flex-col items-center gap-1 shadow">
              <span className="text-2xl">💰</span>
              Mensalidade
            </button>
            <button onClick={() => { setFlow('novo'); setStep('register') }}
              className="w-full bg-green-600 text-white rounded-2xl py-5 text-base font-semibold flex flex-col items-center gap-1 shadow">
              <span className="text-2xl">🆕</span>
              Novo Associado
            </button>
          </div>
        )}

        {/* SEARCH STEP */}
        {step === 'search' && flow === 'mensalidade' && (
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <button onClick={reset} className="text-gray-400 hover:text-gray-600"><ArrowLeft className="w-5 h-5" /></button>
              <p className="text-sm font-semibold text-gray-700">Buscar associado</p>
            </div>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                value={searchQ}
                onChange={e => setSearchQ(e.target.value)}
                placeholder="Nome ou CPF…"
                className={`${inputCls} pl-9`}
                autoFocus
              />
            </div>
            {searching && (
              <div className="flex justify-center py-4">
                <div className="w-5 h-5 border-2 border-[#26619c] border-t-transparent rounded-full animate-spin" />
              </div>
            )}
            {loadingMember && (
              <div className="flex justify-center py-4">
                <div className="w-5 h-5 border-2 border-[#26619c] border-t-transparent rounded-full animate-spin" />
              </div>
            )}
            {searchResults.length > 0 && (
              <div className="flex flex-col gap-1">
                {searchResults.map(r => (
                  <button key={r.id} onClick={() => selectResident(r.id)}
                    className="bg-white border border-gray-200 rounded-xl px-4 py-3 text-left hover:bg-blue-50 transition">
                    <p className="font-medium text-gray-800 text-sm">{r.full_name}</p>
                    {r.address_street && (
                      <p className="text-xs text-gray-400">{r.address_street}{r.address_number ? `, ${r.address_number}` : ''}</p>
                    )}
                    {r.cpf && <p className="text-xs text-gray-400">CPF: {r.cpf}</p>}
                  </button>
                ))}
              </div>
            )}
            {!searching && searchQ.length >= 2 && searchResults.length === 0 && (
              <p className="text-sm text-gray-400 text-center py-4">Nenhum resultado encontrado.</p>
            )}
          </div>
        )}

        {/* MEMBER STEP */}
        {step === 'member' && memberData && (
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-2">
              <button onClick={() => { setStep('search'); setMemberData(null); setPaidIds(new Set()); setProofUrl('') }}
                className="text-gray-400 hover:text-gray-600"><ArrowLeft className="w-5 h-5" /></button>
              <div>
                <p className="text-sm font-bold text-gray-800">{memberData.resident.full_name}</p>
                {memberData.resident.address && <p className="text-xs text-gray-400">{memberData.resident.address}</p>}
              </div>
            </div>

            {/* Payment method selector */}
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
                    <button onClick={() => fileRef.current?.click()} disabled={uploading}
                      className="w-full flex items-center justify-center gap-2 border-2 border-dashed border-[#26619c]/40 rounded-xl py-3 text-sm text-[#26619c] font-medium hover:bg-[#26619c]/5 transition disabled:opacity-50">
                      <Upload className="w-4 h-4" />
                      {uploading ? 'Enviando…' : 'Anexar comprovante PIX (obrigatório)'}
                    </button>
                  )}
                  <input ref={fileRef} type="file" accept="image/*,application/pdf" className="hidden"
                    onChange={e => e.target.files?.[0] && handleUpload(e.target.files[0], setProofUrl, setUploading)} />
                </div>
              )}
            </div>

            {/* Overdue */}
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

            {/* Upcoming */}
            {upcoming.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2 px-1">Pendentes ({upcoming.length})</p>
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

            <button onClick={reset}
              className="w-full border border-gray-200 text-gray-500 rounded-xl py-2.5 text-sm hover:bg-gray-50">
              Voltar ao início
            </button>
          </div>
        )}

        {/* REGISTER STEP */}
        {step === 'register' && flow === 'novo' && (
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-2">
              <button onClick={reset} className="text-gray-400 hover:text-gray-600"><ArrowLeft className="w-5 h-5" /></button>
              <p className="text-sm font-semibold text-gray-700">Novo Associado</p>
            </div>

            <div className="bg-white rounded-2xl border border-gray-200 p-4 flex flex-col gap-3">
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Nome completo *</label>
                <input value={form.full_name} onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))}
                  className={inputCls} placeholder="Nome completo" />
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">CPF *</label>
                <input value={form.cpf}
                  onChange={e => setForm(f => ({ ...f, cpf: formatCPF(e.target.value) }))}
                  className={inputCls} placeholder="000.000.000-00" inputMode="numeric" />
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Telefone</label>
                <input value={form.phone_primary} onChange={e => setForm(f => ({ ...f, phone_primary: e.target.value }))}
                  className={inputCls} placeholder="(00) 00000-0000" inputMode="tel" />
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div className="col-span-2">
                  <label className="text-xs text-gray-500 mb-1 block">CEP</label>
                  <input value={form.address_cep}
                    onChange={e => { setForm(f => ({ ...f, address_cep: e.target.value })); fetchCEP(e.target.value) }}
                    className={inputCls} placeholder="00000-000" inputMode="numeric" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">Número</label>
                  <input value={form.address_number} onChange={e => setForm(f => ({ ...f, address_number: e.target.value }))}
                    className={inputCls} placeholder="Nº" />
                </div>
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Rua {cepLoading && <span className="text-[#26619c]">buscando…</span>}</label>
                <input value={form.address_street} onChange={e => setForm(f => ({ ...f, address_street: e.target.value }))}
                  className={inputCls} placeholder="Rua, Avenida…" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">Complemento</label>
                  <input value={form.address_complement} onChange={e => setForm(f => ({ ...f, address_complement: e.target.value }))}
                    className={inputCls} placeholder="Apto, bloco…" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">Bairro</label>
                  <input value={form.address_neighborhood} onChange={e => setForm(f => ({ ...f, address_neighborhood: e.target.value }))}
                    className={inputCls} placeholder="Bairro" />
                </div>
              </div>
            </div>

            <button onClick={handleRegister} disabled={submitting}
              className="w-full bg-green-600 text-white rounded-xl py-3 text-sm font-semibold disabled:opacity-50">
              {submitting ? 'Cadastrando…' : 'Cadastrar Associado'}
            </button>
          </div>
        )}

        {/* PAY-NEW STEP */}
        {step === 'pay-new' && newMember && (
          <div className="flex flex-col gap-4">
            <div className="bg-green-50 border border-green-200 rounded-2xl p-4 text-center">
              <CheckCircle2 className="w-8 h-8 text-green-500 mx-auto mb-1" />
              <p className="text-green-700 font-semibold text-sm">Associado cadastrado!</p>
            </div>

            <div className="bg-white rounded-2xl border border-gray-200 p-4 flex flex-col gap-3">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Mensalidade do mês</p>
              <p className="text-2xl font-bold text-gray-800 text-center">{fmtCurrency(newMember.mensalidade_amount)}</p>

              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Forma de Pagamento</p>
              <div className="flex flex-wrap gap-2">
                {newMember.payment_methods.map(pm => (
                  <button key={pm.id} onClick={() => { setNewPayMethod(pm.id); setNewProofUrl('') }}
                    className={`px-3 py-1.5 rounded-xl text-sm font-medium border transition ${newPayMethod === pm.id ? 'bg-[#26619c] text-white border-[#26619c]' : 'bg-white text-gray-600 border-gray-200'}`}>
                    {pm.name}
                  </button>
                ))}
              </div>

              {newIsPix && (
                <div>
                  {newProofUrl ? (
                    <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-xl px-3 py-2">
                      <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0" />
                      <span className="text-xs text-green-700 truncate flex-1">Comprovante anexado</span>
                      <button onClick={() => setNewProofUrl('')}><X className="w-4 h-4 text-green-500" /></button>
                    </div>
                  ) : (
                    <button onClick={() => newFileRef.current?.click()} disabled={newUploading}
                      className="w-full flex items-center justify-center gap-2 border-2 border-dashed border-[#26619c]/40 rounded-xl py-3 text-sm text-[#26619c] font-medium hover:bg-[#26619c]/5 transition disabled:opacity-50">
                      <Upload className="w-4 h-4" />
                      {newUploading ? 'Enviando…' : 'Anexar comprovante PIX (obrigatório)'}
                    </button>
                  )}
                  <input ref={newFileRef} type="file" accept="image/*,application/pdf" className="hidden"
                    onChange={e => e.target.files?.[0] && handleUpload(e.target.files[0], setNewProofUrl, setNewUploading)} />
                </div>
              )}

              <button onClick={handlePayNew} disabled={newPaying}
                className="w-full bg-[#26619c] text-white rounded-xl py-3 text-sm font-semibold disabled:opacity-50">
                {newPaying ? 'Registrando…' : 'Registrar Pagamento'}
              </button>

              <button onClick={() => { setStep('done') }}
                className="w-full border border-gray-200 text-gray-500 rounded-xl py-2 text-sm hover:bg-gray-50">
                Pular pagamento
              </button>
            </div>
          </div>
        )}

        {/* DONE */}
        {step === 'done' && (
          <div className="flex flex-col gap-4 items-center pt-6">
            <CheckCircle2 className="w-16 h-16 text-green-500" />
            <p className="text-green-700 font-semibold text-lg">Concluído!</p>
            <button onClick={reset}
              className="mt-4 w-full bg-[#26619c] text-white rounded-xl py-3 text-sm font-semibold">
              Nova operação
            </button>
          </div>
        )}

      </div>
    </div>
  )
}
