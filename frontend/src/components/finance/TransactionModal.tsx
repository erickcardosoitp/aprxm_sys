import { useEffect, useState } from 'react'
import { printCarne as printCarneUtil } from '../../utils/printCarne'
import { X, ChevronLeft, ChevronRight, Search, AlertCircle, CheckCircle2, Download, Printer } from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../../services/api'
import { financeService } from '../../services/finance'
import { settingsService } from '../../services/settings'
import { PhotoCapture } from '../packages/PhotoCapture'
import type { AssociationSettings, TransactionCategory, PaymentMethod, Resident } from '../../types'

interface Props {
  onClose: () => void
  onSuccess: () => void
}

type IncomeSubtype = 'proof_of_residence' | 'delivery_fee' | 'mensalidade' | 'other'

interface PaymentHistory {
  total_payments: number
  last_payment_at: string | null
  current_month_paid: boolean
  is_delinquent: boolean
  monthly_payment_day: number | null
  payments: Array<{ id: string; amount: string; description: string; transaction_at: string }>
}

const INCOME_SUBTYPES: { value: IncomeSubtype; label: string; icon: string }[] = [
  { value: 'proof_of_residence', label: 'Comprovante de Residência', icon: '🏠' },
  { value: 'delivery_fee', label: 'Taxa de Entrega', icon: '📦' },
  { value: 'mensalidade', label: 'Mensalidade', icon: '💳' },
  { value: 'other', label: 'Outros', icon: '💰' },
]

const STEP_TITLES = ['Tipo', 'Dados', 'Confirmação']

function InlineRegister({ regName, setRegName, regPhone, setRegPhone, regCpf, setRegCpf, regUnit, setRegUnit, regProofUrl, setRegProofUrl, registerAs, setRegisterAs, registering, onRegister }: {
  regName: string; setRegName: (v: string) => void
  regPhone: string; setRegPhone: (v: string) => void
  regCpf: string; setRegCpf: (v: string) => void
  regUnit: string; setRegUnit: (v: string) => void
  regProofUrl: string; setRegProofUrl: (v: string) => void
  registerAs: 'member' | 'guest' | null; setRegisterAs: (v: 'member' | 'guest' | null) => void
  registering: boolean; onRegister: () => void
}) {
  return (
    <div className="mt-2 border border-dashed border-gray-300 rounded-xl p-4 flex flex-col gap-3">
      <p className="text-xs text-gray-500 font-medium">Não encontrado. Cadastrar como:</p>
      <div className="flex gap-2">
        {(['member', 'guest'] as const).map(t => (
          <button key={t} type="button"
            onClick={() => setRegisterAs(registerAs === t ? null : t)}
            className={`flex-1 py-2 rounded-lg text-xs font-semibold border transition ${
              registerAs === t
                ? t === 'member' ? 'bg-[#26619c] text-white border-[#26619c]' : 'bg-orange-500 text-white border-orange-500'
                : 'border-gray-300 text-gray-600 hover:border-gray-400'
            }`}>
            {t === 'member' ? 'Associado' : 'Visitante'}
          </button>
        ))}
      </div>
      {registerAs && (
        <div className="flex flex-col gap-2">
          <input value={regName} onChange={e => setRegName(e.target.value)}
            placeholder="Nome completo *"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#26619c]/40" />
          <div className="grid grid-cols-2 gap-2">
            <input value={regPhone} onChange={e => setRegPhone(e.target.value)}
              placeholder="Telefone" type="tel"
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#26619c]/40" />
            <input value={regCpf} onChange={e => setRegCpf(e.target.value)}
              placeholder="CPF"
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#26619c]/40" />
          </div>
          {registerAs === 'member' && (
            <input value={regUnit} onChange={e => setRegUnit(e.target.value)}
              placeholder="Unidade (ex: 201)"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#26619c]/40" />
          )}
          {registerAs === 'member' && (
            <div>
              <p className="text-xs font-medium text-gray-600 mb-1">
                Comprovante de pagamento <span className="text-red-500">*</span>
              </p>
              <PhotoCapture label="Foto do comprovante" onCapture={e => setRegProofUrl(e.url)} />
              {regProofUrl && <p className="text-xs text-green-600 mt-1 flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> Comprovante anexado</p>}
            </div>
          )}
          <button type="button" onClick={onRegister}
            disabled={registering || !regName.trim() || (registerAs === 'member' && !regProofUrl)}
            className="w-full py-2 rounded-lg text-sm font-semibold text-white bg-[#26619c] hover:bg-[#1a4f87] disabled:opacity-50 transition">
            {registering ? 'Cadastrando…' : `Cadastrar como ${registerAs === 'member' ? 'Associado' : 'Visitante'}`}
          </button>
        </div>
      )}
    </div>
  )
}


export function TransactionModal({ onClose, onSuccess }: Props) {
  const [step, setStep] = useState(0)
  const [saving, setSaving] = useState(false)

  // Step 1
  const [txType, setTxType] = useState<'income' | 'expense'>('income')
  const [incomeSubtype, setIncomeSubtype] = useState<IncomeSubtype>('other')

  // Settings
  const [settings, setSettings] = useState<AssociationSettings | null>(null)
  const [assocInfo, setAssocInfo] = useState<{ association_name?: string; assoc_logo_url?: string } | null>(null)

  // Step 2 — shared
  const [categories, setCategories] = useState<TransactionCategory[]>([])
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([])
  const [categoryId, setCategoryId] = useState('')
  const [paymentMethodId, setPaymentMethodId] = useState('')
  const [amount, setAmount] = useState('')
  const [description, setDescription] = useState('')

  // Step 2 — income specific
  const [cpfQuery, setCpfQuery] = useState('')
  const [cpfLoading, setCpfLoading] = useState(false)
  const [resident, setResident] = useState<Resident | null>(null)
  const [paymentHistory, setPaymentHistory] = useState<PaymentHistory | null>(null)
  const [historyLoading, setHistoryLoading] = useState(false)

  // delivery_fee — full-text search
  const [feeQuery, setFeeQuery] = useState('')
  const [feeResults, setFeeResults] = useState<Resident[]>([])
  const [feeSearching, setFeeSearching] = useState(false)

  // inline resident registration
  const [notFound, setNotFound] = useState(false)
  const [registerAs, setRegisterAs] = useState<'member' | 'guest' | null>(null)
  const [regName, setRegName] = useState('')
  const [regPhone, setRegPhone] = useState('')
  const [regCpf, setRegCpf] = useState('')
  const [regUnit, setRegUnit] = useState('')
  const [regProofUrl, setRegProofUrl] = useState('')
  const [registering, setRegistering] = useState(false)

  // Step 2 — proof_of_residence specific
  const [proofName, setProofName] = useState('')
  const [proofCpf, setProofCpf] = useState('')
  const [proofNeighborhood, setProofNeighborhood] = useState('')
  const [proofCep, setProofCep] = useState('')

  // Step 3 — barcode confirmation
  const [pendingBarcodeCode, setPendingBarcodeCode] = useState('')
  const [barcodeInput, setBarcodeInput] = useState('')

  // Step 2 — expense specific
  const [receiptPhotoUrl, setReceiptPhotoUrl] = useState('')

  useEffect(() => {
    settingsService.get().then(r => setSettings(r.data)).catch(() => {})
    api.get<{ association_name?: string; assoc_logo_url?: string }>('/settings/association').then(r => setAssocInfo(r.data)).catch(() => {})
  }, [])

  useEffect(() => {
    const load = async () => {
      try {
        const [cats, methods] = await Promise.all([
          api.get<TransactionCategory[]>('/finance/categories', { params: { type: txType } }),
          api.get<PaymentMethod[]>('/finance/payment-methods'),
        ])
        setCategories(cats.data)
        setPaymentMethods(methods.data)
        setCategoryId('')
      } catch {
        // ignore
      }
    }
    load()
  }, [txType])

  // Auto-fill amount from settings when mensalidade is selected
  useEffect(() => {
    if (txType === 'income' && incomeSubtype === 'mensalidade' && settings?.default_mensalidade_amount) {
      setAmount(parseFloat(settings.default_mensalidade_amount).toFixed(2))
    }
  }, [incomeSubtype, txType, settings])

  // Auto-fill from resident lookup into proof fields
  useEffect(() => {
    if (resident && incomeSubtype === 'proof_of_residence') {
      setProofName(resident.full_name)
      setProofCpf(resident.cpf ?? '')
      setProofCep(resident.address_cep ?? '')
    }
  }, [resident, incomeSubtype])

  // Auto-fill description based on income subtype
  useEffect(() => {
    if (txType !== 'income') return
    const sub = INCOME_SUBTYPES.find(s => s.value === incomeSubtype)
    if (sub && incomeSubtype !== 'other') {
      setDescription(sub.label + (resident ? ` — ${resident.full_name}` : ''))
    }
  }, [incomeSubtype, resident, txType])

  const resetNotFound = () => { setNotFound(false); setRegisterAs(null); setRegName(''); setRegPhone(''); setRegCpf(''); setRegUnit(''); setRegProofUrl('') }

  const searchFeeResident = async (q: string) => {
    setFeeQuery(q)
    setNotFound(false)
    setRegisterAs(null)
    if (q.length < 2) { setFeeResults([]); return }
    setFeeSearching(true)
    try {
      const res = await api.get<Resident[]>('/residents/search', { params: { q } })
      const results = res.data.slice(0, 8)
      setFeeResults(results)
      if (results.length === 0) {
        setNotFound(true)
        setRegName(q)
      }
    } catch { /* silent */ } finally { setFeeSearching(false) }
  }

  const selectFeeResident = (r: Resident) => {
    setResident(r)
    setFeeResults([])
    setFeeQuery(r.full_name)
    resetNotFound()
    if (r.type === 'member') loadPaymentHistory(r.id)
    else setPaymentHistory(null)
  }

  const lookupCpf = async () => {
    const cpf = cpfQuery.replace(/\D/g, '')
    if (cpf.length !== 11) { toast.error('CPF inválido.'); return }
    setCpfLoading(true)
    resetNotFound()
    try {
      const res = await api.get<Resident>(`/residents/cpf/${cpfQuery}`)
      setResident(res.data)
    } catch {
      setResident(null)
      setPaymentHistory(null)
      setNotFound(true)
      setRegCpf(cpfQuery)
    } finally {
      setCpfLoading(false)
    }
  }

  const registerResident = async () => {
    if (!regName.trim()) { toast.error('Nome é obrigatório.'); return }
    if (registerAs === 'member' && !regProofUrl) { toast.error('Anexe o comprovante de pagamento.'); return }
    setRegistering(true)
    try {
      const res = await api.post<Resident>('/residents', {
        type: registerAs,
        full_name: regName.trim(),
        phone_primary: regPhone || undefined,
        cpf: regCpf || undefined,
        unit: regUnit || undefined,
        status: 'active',
        is_member_confirmed: registerAs === 'member',
        terms_accepted: false,
        lgpd_accepted: false,
      })
      setResident(res.data)
      setFeeQuery(res.data.full_name)
      setCpfQuery(regCpf)
      resetNotFound()
      toast.success(`${registerAs === 'member' ? 'Associado' : 'Visitante'} cadastrado!`)
      if (registerAs === 'member') loadPaymentHistory(res.data.id)
    } catch (e: any) {
      toast.error(e.response?.data?.detail ?? 'Erro ao cadastrar.')
    } finally {
      setRegistering(false)
    }
  }

  const loadPaymentHistory = async (residentId: string) => {
    setHistoryLoading(true)
    try {
      const res = await api.get<PaymentHistory>(`/finance/residents/${residentId}/payment-history`)
      setPaymentHistory(res.data)
    } catch {
      setPaymentHistory(null)
    } finally {
      setHistoryLoading(false)
    }
  }

  useEffect(() => {
    if (resident && incomeSubtype === 'mensalidade') {
      loadPaymentHistory(resident.id)
    } else {
      setPaymentHistory(null)
    }
  }, [resident, incomeSubtype])

  const isProof = txType === 'income' && incomeSubtype === 'proof_of_residence'
  const stepTitles = isProof ? ['Tipo', 'Dados', 'Confirmação', 'Verificar'] : STEP_TITLES

  const canProceed = () => {
    if (step === 0) return true
    if (step === 1) {
      if (isProof) {
        return !!(proofName.trim() && proofCpf.trim() && proofNeighborhood.trim() && proofCep.trim() && amount && parseFloat(amount) > 0)
      }
      if (!amount || parseFloat(amount) <= 0) return false
      const isMensalidade = txType === 'income' && incomeSubtype === 'mensalidade'
      if (!isMensalidade && !description.trim()) return false
      if (isMensalidade && !resident) return false
      if (txType === 'income' && incomeSubtype === 'delivery_fee' && !resident) return false
      return true
    }
    return true
  }

  const handleSubmit = async () => {
    setSaving(true)
    try {
      if (isProof) {
        // Issue proof of residence — returns PDF blob
        const res = await api.post('/finance/proof-of-residence/issue', {
          resident_name: proofName.trim(),
          resident_cpf: proofCpf.trim(),
          resident_neighborhood: proofNeighborhood.trim(),
          resident_cep: proofCep.trim(),
          amount: parseFloat(amount),
          payment_method_id: paymentMethodId || undefined,
          category_id: categoryId || undefined,
          resident_id: resident?.id || undefined,
        }, { responseType: 'blob' })

        const barcodeCode: string = (res as any).headers?.['x-barcode-code'] || ''

        // Trigger download + print
        const blob = new Blob([res.data], { type: 'application/pdf' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url; a.download = 'comprovante.pdf'; a.click()
        // Open in new tab for printing
        const win = window.open(url, '_blank')
        if (win) setTimeout(() => win.print(), 800)
        URL.revokeObjectURL(url)

        if (barcodeCode) {
          setPendingBarcodeCode(barcodeCode)
          setBarcodeInput('')
          setSaving(false)
          setStep(3)
        } else {
          toast.success('Comprovante emitido! PDF gerado.')
          onSuccess()
          onClose()
        }
        return
      }

      if (!amount || !description.trim()) return
      await financeService.registerTransaction({
        type: txType,
        amount: parseFloat(amount),
        description: description.trim(),
        income_subtype: txType === 'income' ? incomeSubtype : undefined,
        category_id: categoryId || undefined,
        payment_method_id: paymentMethodId || undefined,
        resident_id: resident?.id || undefined,
      })
      toast.success('Transação registrada!')
      onSuccess()
      onClose()

      // Print carnê after mensalidade
      if (txType === 'income' && incomeSubtype === 'mensalidade' && resident) {
        try {
          const allRes = await api.get<any[]>(`/mensalidades/residents/${resident.id}`)
          printCarneUtil(resident, allRes.data, assocInfo?.association_name ?? '', { logoUrl: assocInfo?.assoc_logo_url ?? undefined })
        } catch { /* skip */ }
      }
    } catch (e: any) {
      toast.error(e.response?.data?.detail ?? 'Erro ao registrar transação.')
    } finally {
      setSaving(false)
    }
  }

  const confirmBarcode = () => {
    if (barcodeInput.trim() === pendingBarcodeCode) {
      toast.success(`Venda confirmada! Código ${pendingBarcodeCode} verificado.`)
      onSuccess()
      onClose()
    } else {
      toast.error('Código incorreto. Verifique o comprovante impresso.')
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 overflow-y-auto">
      <div className="w-full max-w-md bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl mx-0 sm:mx-4">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="font-bold text-gray-900">Nova Transação</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>

        {/* Step indicator */}
        <div className="flex border-b border-gray-100">
          {stepTitles.map((title, i) => (
            <div key={i} className={`flex-1 py-2.5 text-center text-xs font-medium transition border-b-2 ${
              step === i ? 'text-[#26619c] border-[#26619c]' :
              i < step ? 'text-green-600 border-green-400' : 'text-gray-400 border-transparent'
            }`}>
              {i + 1}. {title}
            </div>
          ))}
        </div>

        {/* Content */}
        <div className="px-6 py-5 flex flex-col gap-4">

          {/* ── Step 1: Tipo ── */}
          {step === 0 && (
            <>
              <p className="text-sm text-gray-600 font-medium">Direção</p>
              <div className="grid grid-cols-2 gap-3">
                {(['income', 'expense'] as const).map((t) => (
                  <button key={t} type="button" onClick={() => setTxType(t)}
                    className={`py-4 rounded-xl text-sm font-semibold border-2 transition flex flex-col items-center gap-1 ${
                      txType === t
                        ? t === 'income'
                          ? 'border-green-500 bg-green-50 text-green-700'
                          : 'border-red-500 bg-red-50 text-red-700'
                        : 'border-gray-200 text-gray-500 hover:border-gray-300'
                    }`}>
                    <span className="text-2xl">{t === 'income' ? '↑' : '↓'}</span>
                    {t === 'income' ? 'Entrada' : 'Saída'}
                  </button>
                ))}
              </div>

              {/* Income sub-type */}
              {txType === 'income' && (
                <>
                  <p className="text-sm text-gray-600 font-medium mt-1">Tipo de entrada <span className="text-red-500">*</span></p>
                  <div className="grid grid-cols-2 gap-2">
                    {INCOME_SUBTYPES.map(({ value, label, icon }) => (
                      <button key={value} type="button" onClick={() => setIncomeSubtype(value)}
                        className={`py-3 px-3 rounded-xl text-xs font-semibold border-2 transition flex items-center gap-2 ${
                          incomeSubtype === value
                            ? 'border-[#26619c] bg-blue-50 text-[#26619c]'
                            : 'border-gray-200 text-gray-500 hover:border-gray-300'
                        }`}>
                        <span>{icon}</span>
                        {label}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </>
          )}

          {/* ── Step 2: Dados ── */}
          {step === 1 && (
            <>
              {/* Proof of residence: special fields */}
              {isProof && (
                <div className="flex flex-col gap-3">
                  <p className="text-xs text-gray-500 bg-blue-50 border border-blue-100 rounded-lg px-3 py-2">
                    Busque o morador pelo nome, CPF ou telefone para preencher automaticamente, ou preencha manualmente.
                  </p>
                  {/* Resident search */}
                  <div className="relative">
                    <label className="block text-xs font-medium text-gray-600 mb-1">Buscar morador</label>
                    <input value={feeQuery} onChange={e => searchFeeResident(e.target.value)}
                      placeholder="Nome, CPF ou telefone…"
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#26619c]/40 focus:border-[#26619c]" />
                    {feeResults.length > 0 && (
                      <div className="absolute z-10 left-0 right-0 top-full mt-1 bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden">
                        {feeResults.map(r => (
                          <button key={r.id} type="button" onClick={() => selectFeeResident(r)}
                            className="w-full text-left px-4 py-2.5 hover:bg-blue-50 transition border-b border-gray-50 last:border-0">
                            <p className="text-sm font-medium text-gray-800">{r.full_name}</p>
                            <p className="text-xs text-gray-400">{r.cpf ?? r.phone_primary ?? ''}</p>
                          </button>
                        ))}
                      </div>
                    )}
                    {resident && (
                      <p className="text-xs text-blue-600 mt-1 bg-blue-50 rounded px-2 py-1">
                        ✓ {resident.full_name} — dados preenchidos automaticamente
                      </p>
                    )}
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Nome completo *</label>
                    <input value={proofName} onChange={e => setProofName(e.target.value)}
                      placeholder="Nome do solicitante"
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#26619c]/40 focus:border-[#26619c]" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">CPF *</label>
                    <input value={proofCpf} onChange={e => setProofCpf(e.target.value)}
                      placeholder="000.000.000-00"
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#26619c]/40 focus:border-[#26619c]" />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Bairro *</label>
                      <input value={proofNeighborhood} onChange={e => setProofNeighborhood(e.target.value)}
                        placeholder="Ex: Vaz Lobo"
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#26619c]/40 focus:border-[#26619c]" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">CEP *</label>
                      <input value={proofCep} onChange={e => setProofCep(e.target.value)}
                        placeholder="00000-000"
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#26619c]/40 focus:border-[#26619c]" />
                    </div>
                  </div>
                  {/* Valor */}
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Valor (R$) *</label>
                    <input type="number" min="0.01" step="0.01" value={amount}
                      onChange={e => setAmount(e.target.value)} placeholder="0,00"
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#26619c]/40 focus:border-[#26619c]" />
                  </div>
                  {/* Forma de pagamento */}
                  {paymentMethods.length > 0 && (
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Forma de pagamento</label>
                      <div className="flex flex-wrap gap-2">
                        {paymentMethods.map(m => (
                          <button key={m.id} type="button" onClick={() => setPaymentMethodId(m.id === paymentMethodId ? '' : m.id)}
                            className={`px-3 py-1.5 rounded-full text-xs font-medium border transition ${paymentMethodId === m.id ? 'bg-[#26619c] text-white border-[#26619c]' : 'border-gray-300 text-gray-600 hover:border-[#26619c]'}`}>
                            {m.name}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Resident lookup (income only, non-proof) */}
              {txType === 'income' && !isProof && (
                <div>
                  {/* delivery_fee: busca por nome / telefone / CEP */}
                  {incomeSubtype === 'delivery_fee' ? (
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">
                        Morador / Visitante <span className="text-red-500">*</span>
                        <span className="text-gray-400 font-normal ml-1">(nome, telefone ou CEP)</span>
                      </label>
                      <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                        <input
                          value={feeQuery}
                          onChange={e => { searchFeeResident(e.target.value); if (!e.target.value) { setResident(null); setPaymentHistory(null) } }}
                          placeholder="Buscar por nome, telefone ou CEP…"
                          className="w-full border border-gray-300 rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#26619c]/40 focus:border-[#26619c]"
                        />
                        {feeSearching && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400">…</span>}
                      </div>
                      {feeResults.length > 0 && !resident && (
                        <ul className="mt-1 border border-gray-200 rounded-lg divide-y divide-gray-100 max-h-44 overflow-y-auto">
                          {feeResults.map(r => {
                            const isGuest = r.type === 'guest'
                            return (
                              <li key={r.id}>
                                <button type="button" onClick={() => selectFeeResident(r)}
                                  className="w-full text-left px-3 py-2 hover:bg-blue-50 flex items-center gap-2 text-sm">
                                  <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium shrink-0 ${isGuest ? 'bg-orange-100 text-orange-700' : 'bg-blue-100 text-blue-700'}`}>
                                    {isGuest ? 'Visitante' : 'Associado'}
                                  </span>
                                  <span className="font-medium text-gray-800 truncate">{r.full_name}</span>
                                  {r.phone_primary && <span className="text-xs text-gray-400 shrink-0">{r.phone_primary}</span>}
                                </button>
                              </li>
                            )
                          })}
                        </ul>
                      )}
                      {resident && (
                        <div className="mt-2 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 flex items-center gap-2">
                          <div className="flex-1">
                            <p className="text-sm font-medium text-blue-800">{resident.full_name}</p>
                            <p className="text-xs text-blue-600">
                              {resident.type === 'guest' ? 'Visitante (não associado)' : 'Associado'}
                              {resident.phone_primary ? ` · ${resident.phone_primary}` : ''}
                              {resident.address_cep ? ` · CEP ${resident.address_cep}` : ''}
                            </p>
                            {paymentHistory?.is_delinquent && (
                              <p className="text-xs text-red-600 font-semibold mt-0.5 flex items-center gap-1">
                                <AlertCircle className="w-3 h-3" /> Inadimplente
                              </p>
                            )}
                          </div>
                          <button type="button" onClick={() => { setResident(null); setFeeQuery(''); setPaymentHistory(null); setNotFound(false) }}
                            className="text-gray-400 hover:text-red-500 shrink-0">
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      )}

                      {/* Sugestão de cadastro inline — delivery_fee */}
                      {notFound && !resident && <InlineRegister
                        regName={regName} setRegName={setRegName}
                        regPhone={regPhone} setRegPhone={setRegPhone}
                        regCpf={regCpf} setRegCpf={setRegCpf}
                        regUnit={regUnit} setRegUnit={setRegUnit}
                        regProofUrl={regProofUrl} setRegProofUrl={setRegProofUrl}
                        registerAs={registerAs} setRegisterAs={setRegisterAs}
                        registering={registering} onRegister={registerResident}
                      />}
                    </div>
                  ) : (
                  <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    Morador {incomeSubtype === 'mensalidade' ? <span className="text-red-500">*</span> : '(opcional)'}
                    <span className="text-gray-400 font-normal ml-1">(nome ou CPF)</span>
                  </label>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <input
                      value={feeQuery}
                      onChange={e => { searchFeeResident(e.target.value); if (!e.target.value) { setResident(null); setPaymentHistory(null) } }}
                      placeholder="Buscar por nome ou CPF…"
                      className="w-full border border-gray-300 rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#26619c]/40 focus:border-[#26619c]"
                    />
                    {feeSearching && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400">…</span>}
                  </div>
                  {feeResults.length > 0 && !resident && (
                    <ul className="mt-1 border border-gray-200 rounded-lg divide-y divide-gray-100 max-h-44 overflow-y-auto">
                      {feeResults.map(r => (
                        <li key={r.id}>
                          <button type="button" onClick={() => selectFeeResident(r)}
                            className="w-full text-left px-3 py-2 hover:bg-blue-50 flex items-center gap-2 text-sm">
                            <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium shrink-0 ${r.type === 'guest' ? 'bg-orange-100 text-orange-700' : 'bg-blue-100 text-blue-700'}`}>
                              {r.type === 'guest' ? 'Visitante' : 'Associado'}
                            </span>
                            <span className="font-medium text-gray-800 truncate">{r.full_name}</span>
                            {r.cpf && <span className="text-xs text-gray-400 shrink-0">{r.cpf}</span>}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  {resident && (
                    <div className="mt-2 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 flex items-center gap-2">
                      <div className="flex-1 text-sm text-blue-800">
                        <p className="font-medium">{resident.full_name}</p>
                        <p className="text-xs text-blue-600">
                          {resident.type === 'member' ? 'Associado' : resident.type === 'guest' ? 'Visitante' : 'Dependente'}
                          {resident.unit ? ` · Unid. ${resident.unit}` : ''}
                        </p>
                      </div>
                      <button type="button" onClick={() => { setResident(null); setFeeQuery(''); setPaymentHistory(null) }}
                        className="text-gray-400 hover:text-red-500 shrink-0"><X className="w-4 h-4" /></button>
                    </div>
                  )}
                  </div>
                  )}

                  {/* Sugestão de cadastro inline — CPF path */}
                  {notFound && !resident && <InlineRegister
                    regName={regName} setRegName={setRegName}
                    regPhone={regPhone} setRegPhone={setRegPhone}
                    regCpf={regCpf} setRegCpf={setRegCpf}
                    regUnit={regUnit} setRegUnit={setRegUnit}
                    regProofUrl={regProofUrl} setRegProofUrl={setRegProofUrl}
                    registerAs={registerAs} setRegisterAs={setRegisterAs}
                    registering={registering} onRegister={registerResident}
                  />}

                  {/* Mensalidade payment history */}
                  {incomeSubtype === 'mensalidade' && resident && (
                    <div className="mt-2">
                      {historyLoading ? (
                        <p className="text-xs text-gray-400">Consultando histórico…</p>
                      ) : paymentHistory && (
                        <div className={`rounded-lg px-3 py-2.5 border text-xs ${
                          paymentHistory.is_delinquent
                            ? 'bg-red-50 border-red-200'
                            : paymentHistory.current_month_paid
                              ? 'bg-green-50 border-green-200'
                              : 'bg-yellow-50 border-yellow-200'
                        }`}>
                          <div className="flex items-center gap-1.5 font-semibold mb-1">
                            {paymentHistory.is_delinquent
                              ? <><AlertCircle className="w-3.5 h-3.5 text-red-500" /><span className="text-red-700">Inadimplente</span></>
                              : paymentHistory.current_month_paid
                                ? <><CheckCircle2 className="w-3.5 h-3.5 text-green-500" /><span className="text-green-700">Adimplente — mês atual pago</span></>
                                : <><AlertCircle className="w-3.5 h-3.5 text-yellow-500" /><span className="text-yellow-700">Mês atual em aberto</span></>
                            }
                          </div>
                          <p className="text-gray-500">
                            {paymentHistory.total_payments} pagamento(s) registrado(s)
                            {paymentHistory.last_payment_at && (
                              <> · Último: {new Date(paymentHistory.last_payment_at).toLocaleDateString('pt-BR')}</>
                            )}
                            {paymentHistory.monthly_payment_day && (
                              <> · Vencimento: dia {paymentHistory.monthly_payment_day}</>
                            )}
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Standard fields — hidden for proof_of_residence (has its own section above) */}
              {!isProof && (
                <>
                  {/* Category — hidden for mensalidade (subtype already is the category) */}
                  {categories.length > 0 && txType !== 'income' && (
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Categoria</label>
                      <div className="flex flex-wrap gap-2">
                        {categories.map((c) => (
                          <button key={c.id} type="button" onClick={() => setCategoryId(c.id === categoryId ? '' : c.id)}
                            className={`px-3 py-1.5 rounded-full text-xs font-medium border transition ${
                              categoryId === c.id ? 'bg-[#26619c] text-white border-[#26619c]' : 'border-gray-300 text-gray-600 hover:border-[#26619c]'
                            }`}>
                            {c.name}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">
                      Valor (R$) <span className="text-red-500">*</span>
                      {txType === 'income' && incomeSubtype === 'mensalidade' && settings?.default_mensalidade_amount && (
                        <span className="ml-1 text-[#26619c] font-normal">(padrão: R$ {parseFloat(settings.default_mensalidade_amount).toFixed(2)})</span>
                      )}
                    </label>
                    <input type="number" min="0.01" step="0.01" value={amount}
                      onChange={(e) => setAmount(e.target.value)} placeholder="0,00"
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#26619c]/40 focus:border-[#26619c]" />
                  </div>
                  {!(txType === 'income' && incomeSubtype === 'mensalidade') && (
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Descrição <span className="text-red-500">*</span></label>
                      <input value={description} onChange={(e) => setDescription(e.target.value)}
                        placeholder="Descreva a transação…"
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#26619c]/40 focus:border-[#26619c]" />
                    </div>
                  )}
                  {paymentMethods.length > 0 && (
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Forma de pagamento</label>
                      <div className="flex flex-wrap gap-2">
                        {paymentMethods.map((m) => (
                          <button key={m.id} type="button" onClick={() => setPaymentMethodId(m.id === paymentMethodId ? '' : m.id)}
                            className={`px-3 py-1.5 rounded-full text-xs font-medium border transition ${
                              paymentMethodId === m.id ? 'bg-[#26619c] text-white border-[#26619c]' : 'border-gray-300 text-gray-600 hover:border-[#26619c]'
                            }`}>
                            {m.name}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  {txType === 'expense' && (
                    <PhotoCapture label="Foto do Comprovante" onCapture={(e) => setReceiptPhotoUrl(e.url)} />
                  )}
                </>
              )}
            </>
          )}

          {/* ── Step 3 (proof only): Verificar código de barras ── */}
          {step === 3 && (
            <div className="flex flex-col gap-4">
              <div className="bg-green-50 border border-green-200 rounded-xl p-4">
                <p className="text-sm font-semibold text-green-700 mb-1">PDF gerado com sucesso!</p>
                <p className="text-xs text-gray-600">Código do comprovante: <span className="font-mono font-bold text-gray-900 tracking-widest">{pendingBarcodeCode}</span></p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Bipe ou digite o código de barras do comprovante impresso:
                </label>
                <input
                  autoFocus
                  value={barcodeInput}
                  onChange={e => setBarcodeInput(e.target.value.replace(/\D/g, '').slice(0, 8))}
                  onKeyDown={e => e.key === 'Enter' && barcodeInput.length === 8 && confirmBarcode()}
                  placeholder="00000000"
                  inputMode="numeric"
                  maxLength={8}
                  className="w-full border-2 border-gray-300 rounded-xl px-4 py-3 text-xl font-mono text-center tracking-[0.3em] focus:outline-none focus:border-[#26619c]"
                />
                {barcodeInput.length === 8 && barcodeInput !== pendingBarcodeCode && (
                  <p className="text-xs text-red-500 mt-1.5 flex items-center gap-1"><AlertCircle className="w-3.5 h-3.5" /> Código não corresponde ao comprovante.</p>
                )}
                {barcodeInput === pendingBarcodeCode && (
                  <p className="text-xs text-green-600 mt-1.5 flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5" /> Código correto!</p>
                )}
              </div>
            </div>
          )}

          {/* ── Step 2: Confirmação ── */}
          {step === 2 && (
            <div className="flex flex-col gap-3">
              <p className="text-sm font-medium text-gray-700">{isProof ? 'Confirmar emissão do comprovante:' : 'Confirmar transação:'}</p>
              <div className={`rounded-xl p-4 border ${txType === 'income' ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
                <p className={`text-lg font-bold ${txType === 'income' ? 'text-green-700' : 'text-red-700'}`}>
                  {txType === 'income' ? '+' : '-'} R$ {parseFloat(amount || '0').toFixed(2)}
                </p>
                {isProof ? (
                  <>
                    <p className="text-sm text-gray-800 mt-1 font-medium">{proofName}</p>
                    <p className="text-xs text-gray-500">CPF: {proofCpf}</p>
                    <p className="text-xs text-gray-500">Bairro: {proofNeighborhood} · CEP: {proofCep}</p>
                    {paymentMethodId && <p className="text-xs text-gray-500">Pagamento: {paymentMethods.find(m => m.id === paymentMethodId)?.name}</p>}
                    <p className="text-xs text-blue-600 mt-2 font-medium">O PDF será gerado e baixado automaticamente.</p>
                  </>
                ) : (
                  <>
                    <p className="text-sm text-gray-700 mt-1">{description}</p>
                    {txType === 'income' && (
                      <p className="text-xs text-gray-500 mt-1">
                        Tipo: {INCOME_SUBTYPES.find(s => s.value === incomeSubtype)?.label}
                      </p>
                    )}
                    {resident && <p className="text-xs text-gray-500">Morador: {resident.full_name}</p>}
                    {categoryId && <p className="text-xs text-gray-500">Categoria: {categories.find(c => c.id === categoryId)?.name}</p>}
                    {paymentMethodId && <p className="text-xs text-gray-500">Pagamento: {paymentMethods.find(m => m.id === paymentMethodId)?.name}</p>}
                  </>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-gray-100">
          {step === 3 ? (
            <button onClick={() => { onSuccess(); onClose() }}
              className="text-sm text-gray-400 hover:text-gray-600">
              Pular verificação
            </button>
          ) : (
            <button onClick={step === 0 ? onClose : () => setStep(step - 1)}
              className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700">
              <ChevronLeft className="w-4 h-4" />
              {step === 0 ? 'Cancelar' : 'Anterior'}
            </button>
          )}
          {step === 3 ? (
            <button onClick={confirmBarcode} disabled={barcodeInput.length !== 8}
              className="flex items-center gap-2 bg-[#26619c] hover:bg-[#1a4f87] text-white px-6 py-2 rounded-xl text-sm font-semibold transition disabled:opacity-50">
              <CheckCircle2 className="w-4 h-4" /> Confirmar Venda
            </button>
          ) : step < 2 ? (
            <button onClick={() => setStep(step + 1)} disabled={!canProceed()}
              className="flex items-center gap-2 bg-[#26619c] hover:bg-[#1a4f87] text-white px-5 py-2 rounded-xl text-sm font-semibold transition disabled:opacity-50">
              Próximo <ChevronRight className="w-4 h-4" />
            </button>
          ) : (
            <button onClick={handleSubmit} disabled={saving}
              className="flex items-center gap-2 bg-[#26619c] hover:bg-[#1a4f87] text-white px-6 py-2 rounded-xl text-sm font-semibold transition disabled:opacity-50">
              {saving ? 'Gerando…' : isProof ? <><Download className="w-4 h-4" /> Emitir PDF</> : 'Confirmar'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
