import { useEffect, useState } from 'react'
import { printCarne as printCarneUtil } from '../../utils/printCarne'
import { X, ChevronLeft, ChevronRight, Search, AlertCircle, CheckCircle2, Download, Printer, Building2 } from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../../services/api'
import { financeService } from '../../services/finance'
import { settingsService } from '../../services/settings'
import { packageService } from '../../services/packages'
import { useAuthStore } from '../../store/authStore'
import { PhotoCapture } from '../packages/PhotoCapture'
import type { AssociationSettings, TransactionCategory, PaymentMethod, Resident } from '../../types'

interface Props {
  onClose: () => void
  onSuccess: () => void
  initialSubtype?: IncomeSubtype
  skipAutoPrint?: boolean
  initialTxType?: 'income' | 'expense'
  initialStep?: number
}

type OpenSession = { id: string; opened_by: string; opened_by_name: string; opening_balance: string; opened_at: string; is_mine: boolean }

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

function InlineRegister({ regName, setRegName, regPhone, setRegPhone, regCpf, setRegCpf, regCep, setRegCep, regProofUrl, setRegProofUrl, registerAs, setRegisterAs, registering, onRegister, onlyMember = false, onCepResolved }: {
  regName: string; setRegName: (v: string) => void
  regPhone: string; setRegPhone: (v: string) => void
  regCpf: string; setRegCpf: (v: string) => void
  regCep: string; setRegCep: (v: string) => void
  regProofUrl: string; setRegProofUrl: (v: string) => void
  registerAs: 'member' | 'guest' | null; setRegisterAs: (v: 'member' | 'guest' | null) => void
  registering: boolean; onRegister: () => void
  onlyMember?: boolean
  onCepResolved?: (data: { street: string; district: string; city: string; state: string }) => void
}) {
  const [cepResult, setCepResult] = useState<{ street: string; district: string; city: string; state: string } | null>(null)
  const [cepLoading, setCepLoading] = useState(false)

  useEffect(() => {
    if (onlyMember) setRegisterAs('member')
  }, [onlyMember])

  useEffect(() => {
    const digits = regCep.replace(/\D/g, '')
    if (digits.length !== 8) { setCepResult(null); return }
    setCepLoading(true)
    packageService.lookupCep(digits)
      .then(r => { setCepResult(r.data); onCepResolved?.(r.data) })
      .catch(() => setCepResult(null))
      .finally(() => setCepLoading(false))
  }, [regCep])

  const inputCls = 'border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#26619c]/40'

  return (
    <div className="mt-2 border border-dashed border-gray-300 rounded-xl p-4 flex flex-col gap-3">
      {onlyMember ? (
        <p className="text-xs text-gray-500 font-medium">Morador não encontrado — cadastrar como Associado:</p>
      ) : (
        <>
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
        </>
      )}
      {registerAs && (
        <div className="flex flex-col gap-2">
          <input value={regName} onChange={e => setRegName(e.target.value)}
            placeholder="Nome completo *"
            className={`w-full ${inputCls}`} />
          <div className="grid grid-cols-2 gap-2">
            <input value={regPhone} onChange={e => setRegPhone(e.target.value)}
              placeholder={onlyMember ? 'Telefone *' : 'Telefone'} type="tel"
              className={inputCls} />
            <input value={regCpf} onChange={e => setRegCpf(e.target.value)}
              placeholder={onlyMember ? 'CPF *' : 'CPF'} inputMode="numeric"
              className={inputCls} />
          </div>
          {(registerAs === 'member') && (
            <div>
              <input value={regCep} onChange={e => setRegCep(e.target.value)}
                placeholder={onlyMember ? 'CEP *' : 'CEP'} inputMode="numeric"
                className={`w-full ${inputCls}`} />
              {cepLoading && <p className="text-[11px] text-gray-400 mt-1">Consultando…</p>}
              {cepResult && (
                <p className="text-[11px] text-emerald-700 mt-1 truncate">
                  {cepResult.street}, {cepResult.district}
                </p>
              )}
            </div>
          )}
          <div>
            <p className="text-xs font-medium text-gray-600 mb-1">
              Comprovante de pagamento <span className="text-gray-400">(opcional)</span>
            </p>
            <PhotoCapture label="Foto do comprovante" onCapture={e => setRegProofUrl(e.url)} />
            {regProofUrl && <p className="text-xs text-green-600 mt-1 flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> Comprovante anexado</p>}
          </div>
          <button type="button" onClick={onRegister}
            disabled={registering || !regName.trim()}
            className="w-full py-2 rounded-lg text-sm font-semibold text-white bg-[#26619c] hover:bg-[#1a4f87] disabled:opacity-50 transition">
            {registering ? 'Cadastrando…' : `Cadastrar como ${registerAs === 'member' ? 'Associado' : 'Visitante'}`}
          </button>
        </div>
      )}
    </div>
  )
}


export function TransactionModal({ onClose, onSuccess, initialSubtype, initialTxType, initialStep = 0, skipAutoPrint = false }: Props) {
  const role = useAuthStore((s) => s.role)
  const canPickSession = role === 'admin' || role === 'superadmin' || role === 'conferente'

  const [step, setStep] = useState(initialStep ?? 0)
  const [saving, setSaving] = useState(false)

  // Step 1
  const [txType, setTxType] = useState<'income' | 'expense'>(initialTxType ?? 'income')
  const [incomeSubtype, setIncomeSubtype] = useState<IncomeSubtype>(initialSubtype ?? 'other')

  // Settings
  const [settings, setSettings] = useState<AssociationSettings | null>(null)
  const [assocInfo, setAssocInfo] = useState<{ association_name?: string; assoc_logo_url?: string } | null>(null)

  // Step 2 — shared
  const [categories, setCategories] = useState<TransactionCategory[]>([])
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([])
  const [methodsLoading, setMethodsLoading] = useState(true)
  const [categoryId, setCategoryId] = useState('')
  const [paymentMethodId, setPaymentMethodId] = useState('')
  const [splitEnabled, setSplitEnabled] = useState(false)
  const [paymentMethodId2, setPaymentMethodId2] = useState('')
  const [amount2Split, setAmount2Split] = useState('')
  const [amount, setAmount] = useState('')
  const [description, setDescription] = useState('')

  const [isAcordo, setIsAcordo] = useState(false)
  const [acordoInstallments, setAcordoInstallments] = useState(2)
  const [acordoMonths, setAcordoMonths] = useState(2)
  const [acordoEntrada, setAcordoEntrada] = useState('')

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
  const [regCep, setRegCep] = useState('')
  const [regStreet, setRegStreet] = useState('')
  const [regDistrict, setRegDistrict] = useState('')
  const [regCity, setRegCity] = useState('')
  const [regStateAddr, setRegStateAddr] = useState('')
  const [regProofUrl, setRegProofUrl] = useState('')
  const [registering, setRegistering] = useState(false)

  // Step 2 — proof_of_residence specific
  const [proofIsento, setProofIsento] = useState(false)
  const [proofName, setProofName] = useState('')
  const [proofCpf, setProofCpf] = useState('')
  const [proofNeighborhood, setProofNeighborhood] = useState('')
  const [proofCep, setProofCep] = useState('')
  const [proofStreet, setProofStreet] = useState('')
  const [proofNumber, setProofNumber] = useState('')
  const [proofComplement, setProofComplement] = useState('')

  // Session picker — loaded proactively for admin/conferente
  const [openSessions, setOpenSessions] = useState<OpenSession[]>([])
  const [selectedSessionId, setSelectedSessionId] = useState<string>('')
  const [showSessionPicker, setShowSessionPicker] = useState(false)
  const [pendingPayload, setPendingPayload] = useState<Record<string, unknown> | null>(null)

  // payer identification (PIX)
  const [pixPayerName, setPixPayerName] = useState('')
  const [pixPayerEntityId, setPixPayerEntityId] = useState('')
  const [pixPayerMode, setPixPayerMode] = useState<'manual' | 'resident'>('manual')
  const [pixPayerResults, setPixPayerResults] = useState<{ id: string; full_name: string }[]>([])

  // mensalidade — months
  const [mensalidadeMode, setMensalidadeMode] = useState<'unica' | 'multipla'>('unica')
  const [mensalidadeMonths, setMensalidadeMonths] = useState<string[]>([])
  const [residentMensalidades, setResidentMensalidades] = useState<{ reference_month: string; status: string }[]>([])

  // Step 3 — barcode confirmation
  const [pendingBarcodeCode, setPendingBarcodeCode] = useState('')
  const [barcodeInput, setBarcodeInput] = useState('')
  const [proofDone, setProofDone] = useState(false)

  // Step 2 — expense specific
  const [receiptPhotoUrl, setReceiptPhotoUrl] = useState('')

  useEffect(() => {
    settingsService.get().then(r => setSettings(r.data)).catch(() => {})
    api.get<{ association_name?: string; assoc_logo_url?: string }>('/settings/association').then(r => setAssocInfo(r.data)).catch(() => {})
    financeService.listOpenSessionsPicker().then(r => {
      setOpenSessions(r.data as any)
      const mine = r.data.find(s => s.is_mine)
      if (mine) setSelectedSessionId(mine.id)
      // no auto-fallback: if no own session, user must pick explicitly
    }).catch(() => {})
  }, [])

  useEffect(() => {
    setMethodsLoading(true)
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
      } finally {
        setMethodsLoading(false)
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

  // Fetch resident mensalidades when resident selected + mensalidade subtype
  useEffect(() => {
    if (!resident || incomeSubtype !== 'mensalidade' || isAcordo) {
      setResidentMensalidades([])
      return
    }
    api.get<{ reference_month: string; status: string }[]>(`/mensalidades/residents/${resident.id}`)
      .then(r => setResidentMensalidades(r.data))
      .catch(() => setResidentMensalidades([]))
  }, [resident?.id, incomeSubtype, isAcordo])

  // Auto-select pending months based on amount
  useEffect(() => {
    if (txType !== 'income' || incomeSubtype !== 'mensalidade' || isAcordo) return
    const defaultAmt = parseFloat(settings?.default_mensalidade_amount || '0')
    const count = defaultAmt > 0 && amount ? Math.max(1, Math.round(parseFloat(amount) / defaultAmt)) : 1
    // Build candidate months: March 2026 → current + 3, skip already paid
    const paidSet = new Set(residentMensalidades.filter(m => m.status === 'paid').map(m => m.reference_month))
    const candidates: string[] = []
    const start = new Date(2026, 2, 1) // March 2026
    const end = new Date(); end.setMonth(end.getMonth() + 3)
    for (let d = new Date(start); d <= end; d.setMonth(d.getMonth() + 1)) {
      const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      if (!paidSet.has(ym)) candidates.push(ym)
    }
    setMensalidadeMonths(candidates.slice(0, count))
  }, [amount, incomeSubtype, txType, isAcordo, settings?.default_mensalidade_amount, residentMensalidades])

  // Auto-fill from resident lookup into proof fields
  useEffect(() => {
    if (resident && incomeSubtype === 'proof_of_residence') {
      setProofName(resident.full_name)
      setProofCpf(resident.cpf ?? '')
      setProofCep(resident.address_cep ?? '')
      setProofStreet(resident.address_street ?? '')
      setProofNumber(resident.address_number ?? '')
      setProofComplement((resident as any).address_complement ?? '')
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

  const resetNotFound = () => { setNotFound(false); setRegisterAs(null); setRegName(''); setRegPhone(''); setRegCpf(''); setRegCep(''); setRegStreet(''); setRegDistrict(''); setRegCity(''); setRegStateAddr(''); setRegProofUrl('') }

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
    if (incomeSubtype === 'mensalidade') {
      if (!regPhone.trim()) { toast.error('Telefone é obrigatório.'); return }
      if (!regCpf.trim()) { toast.error('CPF é obrigatório.'); return }
      if (!regCep.trim()) { toast.error('CEP é obrigatório.'); return }
    }
    setRegistering(true)
    try {
      const res = await api.post<Resident>('/residents', {
        type: registerAs,
        full_name: regName.trim(),
        phone_primary: regPhone || undefined,
        cpf: regCpf || undefined,
        address_cep: regCep || undefined,
        address_street: regStreet || undefined,
        address_neighborhood: regDistrict || undefined,
        address_city: regCity || undefined,
        address_state: regStateAddr || undefined,
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
        const amountOk = proofIsento || (!!amount && parseFloat(amount) > 0)
        return !!(proofName.trim() && proofCpf.trim() && proofNeighborhood.trim() && proofCep.trim() && amountOk)
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
        // If user has no own session and hasn't picked one, show picker
        if (!proofIsento && !selectedSessionId) {
          const noOwn = openSessions.length > 0 && !openSessions.some(s => s.is_mine)
          if (noOwn) {
            setSaving(false)
            setShowSessionPicker(true)
            setPendingPayload({ _isProof: true })
            return
          }
        }

        // Issue proof of residence — returns PDF blob
        let res: any
        try {
          res = await api.post('/finance/proof-of-residence/issue', {
          resident_name: proofName.trim(),
          resident_cpf: proofCpf.trim(),
          resident_neighborhood: proofNeighborhood.trim(),
          resident_cep: proofCep.trim(),
          resident_address_street: proofStreet.trim(),
          resident_address_number: proofNumber.trim(),
          resident_address_complement: proofComplement.trim(),
          amount: proofIsento ? 0 : parseFloat(amount),
          isento: proofIsento,
          payment_method_id: paymentMethodId || undefined,
          category_id: categoryId || undefined,
          resident_id: resident?.id || undefined,
          cash_session_id: selectedSessionId || undefined,
          }, { responseType: 'blob' })
        } catch (e: any) {
          const data = e.response?.data
          let detail = 'Erro ao emitir comprovante.'
          if (data instanceof Blob) {
            try { const text = await data.text(); detail = JSON.parse(text)?.detail ?? detail } catch { /* keep default */ }
          } else if (data?.detail) {
            detail = data.detail
          }
          toast.error(detail)
          setSaving(false)
          return
        }

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

      const isMensalidade = txType === 'income' && incomeSubtype === 'mensalidade'
      if (!amount || (!isMensalidade && !description.trim())) return
      const monthsLabel = isMensalidade && mensalidadeMonths.length > 0
        ? [...mensalidadeMonths].sort().map(ym => {
            const [y, m] = ym.split('-')
            return ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'][parseInt(m)-1] + '/' + y
          }).join(', ')
        : null
      const residentSuffix = resident ? ` — ${resident.full_name}` : ''
      const mensalidadeDesc = isMensalidade && monthsLabel
        ? `Mensalidade ${monthsLabel}${residentSuffix}`
        : description.trim()
      const isSplit = splitEnabled && paymentMethodId2 && parseFloat(amount2Split) > 0
      const a2 = isSplit ? parseFloat(amount2Split) : 0
      const a1 = isSplit ? parseFloat(amount) - a2 : parseFloat(amount)

      if (isSplit && (isNaN(a2) || a2 <= 0 || a1 <= 0)) {
        toast.error('Valor inválido para pagamento dividido.'); setSaving(false); return
      }

      const selectedPmName = paymentMethods.find(m => m.id === paymentMethodId)?.name ?? ''
      const isPix = selectedPmName.toLowerCase().includes('pix')
      const basePayload = {
        type: txType,
        description: mensalidadeDesc,
        income_subtype: txType === 'income' ? incomeSubtype : undefined,
        category_id: categoryId || undefined,
        resident_id: resident?.id || undefined,
        cash_session_id: selectedSessionId || undefined,
        is_acordo: isAcordo || undefined,
        acordo_installments: isAcordo ? acordoInstallments : undefined,
        acordo_months: isAcordo ? acordoMonths : undefined,
        acordo_entrada: isAcordo && acordoEntrada ? parseFloat(acordoEntrada) : undefined,
        payer_name: isPix && pixPayerName.trim() ? pixPayerName.trim() : undefined,
        payer_entity_id: isPix && pixPayerEntityId ? pixPayerEntityId : undefined,
        mensalidade_months: isMensalidade && !isAcordo && mensalidadeMonths.length > 0
          ? mensalidadeMonths
          : undefined,
      }

      const txPayload = {
        ...basePayload,
        amount: isSplit ? a1 : parseFloat(amount),
        payment_method_id: paymentMethodId || undefined,
        description: isSplit ? `${mensalidadeDesc} (1/2)` : mensalidadeDesc,
      }
      try {
        await financeService.registerTransaction(txPayload)
        if (isSplit) {
          await financeService.registerTransaction({
            ...basePayload,
            amount: a2,
            payment_method_id: paymentMethodId2,
            description: `${mensalidadeDesc} (2/2)`,
          })
        }
      } catch (e: any) {
        if (e.response?.data?.detail === 'NO_SESSION') {
          setSaving(false)
          try {
            const res = await financeService.listOpenSessionsPicker()
            if (res.data.length === 0) {
              toast.error('Nenhum caixa aberto. Abra um caixa antes de registrar.')
              return
            }
            setOpenSessions(res.data as any)
            setPendingPayload(txPayload as Record<string, unknown>)
            setShowSessionPicker(true)
          } catch {
            toast.error('Nenhum caixa aberto.')
          }
          return
        }
        if (e.response?.status === 503) {
          toast.error('Conflito temporário. Tente novamente em instantes.')
          return
        }
        throw e
      }
      toast.success('Transação registrada!')
      // Limpar pagador PIX para não "pendurar" na próxima transação
      setPixPayerName(''); setPixPayerEntityId(''); setPixPayerResults([])
      onSuccess()
      onClose()

      // Print carnê after mensalidade (skip in Simplifica)
      if (!skipAutoPrint && txType === 'income' && incomeSubtype === 'mensalidade' && resident) {
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
      setProofDone(true)
    } else {
      toast.error('Código incorreto. Verifique o comprovante impresso.')
    }
  }

  const resetForSamePerson = () => {
    setPendingBarcodeCode('')
    setBarcodeInput('')
    setProofDone(false)
    setStep(2)
  }

  const resetForNewPerson = () => {
    setPendingBarcodeCode('')
    setBarcodeInput('')
    setProofDone(false)
    setResident(null)
    setFeeQuery('')
    setProofName('')
    setProofCpf('')
    setProofNeighborhood('')
    setProofCep('')
    setProofStreet('')
    setProofNumber('')
    setAmount('')
    setPaymentMethodId('')
    setProofIsento(false)
    setStep(1)
  }

  const handleSessionPick = async (sessionId: string) => {
    if (!pendingPayload) return
    setSelectedSessionId(sessionId)
    setShowSessionPicker(false)

    // If triggered from proof of residence flow, re-submit handleSubmit
    if ((pendingPayload as any)._isProof) {
      setPendingPayload(null)
      // selectedSessionId update is async; call handleSubmit after state settles via flag
      setTimeout(() => {
        setSaving(true)
        api.post('/finance/proof-of-residence/issue', {
          resident_name: proofName.trim(),
          resident_cpf: proofCpf.trim(),
          resident_neighborhood: proofNeighborhood.trim(),
          resident_cep: proofCep.trim(),
          resident_address_street: proofStreet.trim(),
          resident_address_number: proofNumber.trim(),
          resident_address_complement: proofComplement.trim(),
          amount: proofIsento ? 0 : parseFloat(amount),
          isento: proofIsento,
          payment_method_id: paymentMethodId || undefined,
          category_id: categoryId || undefined,
          resident_id: resident?.id || undefined,
          cash_session_id: sessionId,
        }, { responseType: 'blob' }).then((res: any) => {
          const barcodeCode: string = res.headers?.['x-barcode-code'] || ''
          const blob = new Blob([res.data], { type: 'application/pdf' })
          const url = URL.createObjectURL(blob)
          const a = document.createElement('a')
          a.href = url; a.download = 'comprovante.pdf'; a.click()
          const win = window.open(url, '_blank')
          if (win) setTimeout(() => win.print(), 800)
          URL.revokeObjectURL(url)
          if (barcodeCode) {
            setPendingBarcodeCode(barcodeCode)
            setBarcodeInput('')
            setStep(3)
          } else {
            toast.success('Comprovante emitido!')
            onSuccess(); onClose()
          }
        }).catch((e: any) => {
          toast.error(e.response?.data?.detail ?? 'Erro ao emitir comprovante.')
        }).finally(() => setSaving(false))
      }, 0)
      return
    }

    setSaving(true)
    try {
      await financeService.registerTransaction({ ...pendingPayload as any, cash_session_id: sessionId })
      toast.success('Transação registrada!')
      onSuccess()
      onClose()
    } catch (e: any) {
      toast.error(e.response?.data?.detail ?? 'Erro ao registrar transação.')
    } finally {
      setSaving(false)
    }
    setPendingPayload(null)
  }

  if (showSessionPicker) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
        <div className="w-full max-w-sm bg-white rounded-2xl shadow-2xl overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
            <h2 className="font-bold text-gray-900 text-sm">Selecionar Caixa</h2>
            <button onClick={() => setShowSessionPicker(false)} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
          </div>
          <div className="px-5 py-4 flex flex-col gap-2">
            <p className="text-xs text-gray-500 mb-1">Você não tem caixa aberto. Selecione o caixa para registrar esta movimentação:</p>
            {openSessions.map(s => (
              <button key={s.id} onClick={() => handleSessionPick(s.id)} disabled={saving}
                className="flex items-center gap-3 px-4 py-3 rounded-xl border border-gray-200 hover:bg-blue-50 hover:border-[#26619c] transition text-left w-full">
                <Building2 className="w-4 h-4 text-gray-400 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-800">{s.opened_by_name ?? 'Operador'}</p>
                  <p className="text-xs text-gray-400">{new Date(s.opened_at).toLocaleString('pt-BR')}</p>
                </div>
                {s.is_mine && <span className="text-[10px] bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-medium">Meu caixa</span>}
              </button>
            ))}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 overflow-y-auto">
      <div className="w-full max-w-md bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl mx-0 sm:mx-4 max-h-[95dvh] overflow-y-auto flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <h2 className="font-bold text-gray-900">Nova Transação</h2>
            {initialStep > 0 && (
              <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${
                txType === 'income'
                  ? 'bg-emerald-100 text-emerald-700'
                  : 'bg-red-100 text-red-700'
              }`}>
                {txType === 'income' ? '↑ Entrada' : '↓ Saída'}
              </span>
            )}
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>

        {/* Step indicator — oculto quando começa no meio (initialStep > 0 pula steps anteriores) */}
        {initialStep === 0 && (
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
        )}

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
                      <label className="block text-xs font-medium text-gray-600 mb-1">Logradouro</label>
                      <input value={proofStreet} onChange={e => setProofStreet(e.target.value)}
                        placeholder="Rua / Beco / Travessa…"
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#26619c]/40 focus:border-[#26619c]" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Número</label>
                      <input value={proofNumber} onChange={e => setProofNumber(e.target.value)}
                        placeholder="Ex: 12"
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#26619c]/40 focus:border-[#26619c]" />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Complemento</label>
                    <input value={proofComplement} onChange={e => setProofComplement(e.target.value)}
                      placeholder="Apto / Bloco / Casa…"
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
                  {/* Isento */}
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input type="checkbox" checked={proofIsento}
                      onChange={e => { setProofIsento(e.target.checked); if (e.target.checked) setAmount('0.00') }}
                      className="w-4 h-4 rounded accent-[#26619c]" />
                    <span className="text-sm font-medium text-gray-700">Isento de Pagamento</span>
                  </label>

                  {/* Valor */}
                  {!proofIsento && (
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Valor (R$) *</label>
                    <input type="number" inputMode="decimal" min="0.01" step="0.01" value={amount}
                      onChange={e => setAmount(e.target.value)} placeholder="0,00"
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#26619c]/40 focus:border-[#26619c]" />
                  </div>
                  )}
                  {/* Forma de pagamento */}
                  {!proofIsento && paymentMethods.length > 0 && (
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
                        regCep={regCep} setRegCep={setRegCep}
                        regProofUrl={regProofUrl} setRegProofUrl={setRegProofUrl}
                        registerAs={registerAs} setRegisterAs={setRegisterAs}
                        registering={registering} onRegister={registerResident}
                        onCepResolved={d => { setRegStreet(d.street); setRegDistrict(d.district); setRegCity(d.city); setRegStateAddr(d.state) }}
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
                    regCep={regCep} setRegCep={setRegCep}
                    regProofUrl={regProofUrl} setRegProofUrl={setRegProofUrl}
                    registerAs={registerAs} setRegisterAs={setRegisterAs}
                    registering={registering} onRegister={registerResident}
                    onlyMember={incomeSubtype === 'mensalidade'}
                    onCepResolved={d => { setRegStreet(d.street); setRegDistrict(d.district); setRegCity(d.city); setRegStateAddr(d.state) }}
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

              {/* Acordo toggle — mensalidade only */}
              {txType === 'income' && incomeSubtype === 'mensalidade' && resident && (
                <div className="flex flex-col gap-2">
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input type="checkbox" checked={isAcordo} onChange={e => setIsAcordo(e.target.checked)}
                      className="w-4 h-4 rounded accent-purple-600" />
                    <span className="text-sm font-medium text-purple-700">Acordo de parcelamento</span>
                  </label>
                  {isAcordo && (() => {
                    const defaultAmt = parseFloat(settings?.default_mensalidade_amount || '0')
                    const total = acordoMonths * defaultAmt
                    const entrada = parseFloat(acordoEntrada || '0')
                    const restante = total - entrada
                    const parcelasValor = acordoInstallments > 0 ? restante / acordoInstallments : 0
                    return (
                      <div className="bg-purple-50 border border-purple-200 rounded-xl p-3 flex flex-col gap-3">
                        <div className="grid grid-cols-3 gap-2">
                          <div>
                            <label className="block text-[10px] text-purple-600 font-semibold mb-1">Meses</label>
                            <select value={acordoMonths} onChange={e => setAcordoMonths(Number(e.target.value))}
                              className="w-full border border-purple-300 rounded-lg px-2 py-1.5 text-xs text-purple-800 bg-white">
                              {[1,2,3,4,5,6,7,8,9,10,11,12,18,24].map(n => <option key={n} value={n}>{n} {n === 1 ? 'mês' : 'meses'}</option>)}
                            </select>
                          </div>
                          <div>
                            <label className="block text-[10px] text-purple-600 font-semibold mb-1">Entrada (R$)</label>
                            <input type="number" inputMode="decimal" min="0" step="0.01" value={acordoEntrada}
                              onChange={e => setAcordoEntrada(e.target.value)}
                              placeholder="0,00"
                              className="w-full border border-purple-300 rounded-lg px-2 py-1.5 text-xs bg-white" />
                          </div>
                          <div>
                            <label className="block text-[10px] text-purple-600 font-semibold mb-1">Parcelas</label>
                            <select value={acordoInstallments} onChange={e => setAcordoInstallments(Number(e.target.value))}
                              className="w-full border border-purple-300 rounded-lg px-2 py-1.5 text-xs text-purple-800 bg-white">
                              {[1,2,3,4,5,6,7,8,9,10,11,12].map(n => <option key={n} value={n}>{n}x</option>)}
                            </select>
                          </div>
                        </div>
                        {defaultAmt > 0 && (
                          <div className="bg-white rounded-lg px-3 py-2 text-xs grid grid-cols-2 gap-x-4 gap-y-1 border border-purple-100">
                            <div className="flex justify-between"><span className="text-gray-500">Total dívida</span><span className="font-semibold text-purple-700">R$ {total.toFixed(2)}</span></div>
                            <div className="flex justify-between"><span className="text-gray-500">Entrada</span><span className="font-semibold">R$ {entrada.toFixed(2)}</span></div>
                            <div className="flex justify-between"><span className="text-gray-500">Restante</span><span className="font-semibold">R$ {restante.toFixed(2)}</span></div>
                            <div className="flex justify-between"><span className="text-gray-500">Cada parcela</span><span className="font-semibold text-blue-700">R$ {parcelasValor.toFixed(2)}</span></div>
                          </div>
                        )}
                      </div>
                    )
                  })()}
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
                  {txType === 'income' && incomeSubtype === 'mensalidade' && !isAcordo && resident && (() => {
                    const MONTH_NAMES = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez']
                    const paidSet = new Set(residentMensalidades.filter(m => m.status === 'paid').map(m => m.reference_month))
                    const months: string[] = []
                    const start = new Date(2026, 2, 1)
                    const end = new Date(); end.setMonth(end.getMonth() + 3)
                    for (let d = new Date(start); d <= end; d.setMonth(d.getMonth() + 1)) {
                      months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
                    }
                    return (
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1.5">
                          Meses {mensalidadeMonths.length > 0 && <span className="text-[#26619c] font-normal">({mensalidadeMonths.length} selecionado{mensalidadeMonths.length > 1 ? 's' : ''})</span>}
                        </label>
                        <div className="flex flex-wrap gap-1.5">
                          {months.map(ym => {
                            const [y, m] = ym.split('-')
                            const isPaid = paidSet.has(ym)
                            const isSelected = mensalidadeMonths.includes(ym)
                            if (isPaid) return (
                              <span key={ym} className="px-2.5 py-1 rounded-full text-xs font-medium bg-green-50 text-green-600 border border-green-200 opacity-60">
                                ✓ {MONTH_NAMES[parseInt(m)-1]}/{y}
                              </span>
                            )
                            return (
                              <button key={ym} type="button"
                                onClick={() => setMensalidadeMonths(prev => isSelected ? prev.filter(x => x !== ym) : [...prev, ym])}
                                className={`px-2.5 py-1 rounded-full text-xs font-medium border transition ${
                                  isSelected ? 'bg-[#26619c] text-white border-[#26619c]' : 'border-orange-300 text-orange-700 bg-orange-50 hover:bg-orange-100'
                                }`}>
                                {MONTH_NAMES[parseInt(m)-1]}/{y}
                              </button>
                            )
                          })}
                        </div>
                      </div>
                    )
                  })()}
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">
                      Valor (R$) <span className="text-red-500">*</span>
                      {txType === 'income' && incomeSubtype === 'mensalidade' && settings?.default_mensalidade_amount && (
                        <span className="ml-1 text-[#26619c] font-normal">(padrão: R$ {parseFloat(settings.default_mensalidade_amount).toFixed(2)})</span>
                      )}
                    </label>
                    <input type="number" inputMode="decimal" min="0.01" step="0.01" value={amount}
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
                  {methodsLoading ? (
                    <div className="flex items-center gap-2 py-2 text-xs text-gray-400">
                      <div className="w-4 h-4 border-2 border-gray-300 border-t-[#26619c] rounded-full animate-spin shrink-0" />
                      Carregando formas de pagamento…
                    </div>
                  ) : paymentMethods.length > 0 ? (
                    <div className="flex flex-col gap-2">
                      <label className="block text-xs font-medium text-gray-600">
                        {splitEnabled ? '1ª forma de pagamento' : 'Forma de pagamento'}
                        {splitEnabled && amount && amount2Split && parseFloat(amount2Split) > 0 && (
                          <span className="ml-1 text-gray-400 font-normal">
                            (R$ {(parseFloat(amount) - parseFloat(amount2Split)).toFixed(2)})
                          </span>
                        )}
                      </label>
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
                      <label className="flex items-center gap-2 cursor-pointer select-none mt-1">
                        <input
                          type="checkbox"
                          checked={splitEnabled}
                          onChange={e => { setSplitEnabled(e.target.checked); setPaymentMethodId2(''); setAmount2Split('') }}
                          className="w-4 h-4 rounded accent-[#26619c]"
                        />
                        <span className="text-xs text-gray-600">Pagamento dividido (2 formas)</span>
                      </label>
                      {splitEnabled && (
                        <div className="flex flex-col gap-2 border border-gray-100 rounded-xl p-3 bg-gray-50">
                          <div>
                            <label className="block text-xs font-medium text-gray-600 mb-1">
                              2ª forma
                            </label>
                            <div className="flex flex-wrap gap-2">
                              {paymentMethods.map((m) => (
                                <button key={m.id} type="button" onClick={() => setPaymentMethodId2(m.id === paymentMethodId2 ? '' : m.id)}
                                  className={`px-3 py-1.5 rounded-full text-xs font-medium border transition ${
                                    paymentMethodId2 === m.id ? 'bg-indigo-600 text-white border-indigo-600' : 'border-gray-300 text-gray-600 hover:border-indigo-400'
                                  }`}>
                                  {m.name}
                                </button>
                              ))}
                            </div>
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-gray-600 mb-1">Valor da 2ª forma (R$)</label>
                            <input
                              type="number" inputMode="decimal" min="0.01" step="0.01"
                              value={amount2Split}
                              onChange={e => setAmount2Split(e.target.value)}
                              placeholder="0,00"
                              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
                            />
                          </div>
                          {amount && parseFloat(amount2Split) > 0 && (
                            <p className="text-xs text-gray-500">
                              1ª: R$ {(parseFloat(amount) - parseFloat(amount2Split)).toFixed(2)}
                              {' · '}2ª: R$ {parseFloat(amount2Split).toFixed(2)}
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  ) : null}
                  {/* PIX payer identification */}
                  {txType === 'income' && paymentMethods.find(m => m.id === paymentMethodId)?.name?.toLowerCase().includes('pix') && (
                    <div className="flex flex-col gap-2 border border-blue-100 rounded-xl p-3 bg-blue-50">
                      <label className="text-xs font-semibold text-blue-700">Nome Pagador PIX</label>
                      <div className="flex gap-1">
                        <button type="button" onClick={() => { setPixPayerMode('manual'); setPixPayerName(''); setPixPayerEntityId('') }}
                          className={`flex-1 py-1 rounded-lg text-xs font-medium border transition ${pixPayerMode === 'manual' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-200'}`}>
                          Manual
                        </button>
                        <button type="button" onClick={() => { setPixPayerMode('resident'); setPixPayerName(''); setPixPayerEntityId('') }}
                          className={`flex-1 py-1 rounded-lg text-xs font-medium border transition ${pixPayerMode === 'resident' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-200'}`}>
                          Buscar Morador
                        </button>
                      </div>
                      {pixPayerMode === 'manual' ? (
                        <input
                          type="text"
                          value={pixPayerName}
                          onChange={e => setPixPayerName(e.target.value)}
                          placeholder="Nome de quem fez o PIX"
                          className="w-full border border-blue-200 rounded-lg px-3 py-2 text-sm bg-white"
                        />
                      ) : (
                        <div className="relative">
                          <input
                            type="text"
                            value={pixPayerName}
                            onChange={async e => {
                              setPixPayerName(e.target.value)
                              setPixPayerEntityId('')
                              if (e.target.value.length >= 3) {
                                try {
                                  const r = await api.get<{ id: string; full_name: string }[]>('/residents/search', { params: { q: e.target.value } })
                                  setPixPayerResults(r.data.slice(0, 5))
                                } catch { setPixPayerResults([]) }
                              } else { setPixPayerResults([]) }
                            }}
                            placeholder="Buscar por nome..."
                            className="w-full border border-blue-200 rounded-lg px-3 py-2 text-sm bg-white"
                          />
                          {pixPayerResults.length > 0 && (
                            <div className="absolute z-10 w-full bg-white border border-gray-200 rounded-lg shadow-lg mt-1 max-h-36 overflow-y-auto">
                              {pixPayerResults.map(r => (
                                <button key={r.id} type="button"
                                  onClick={() => { setPixPayerName(r.full_name); setPixPayerEntityId(r.id); setPixPayerResults([]) }}
                                  className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50 border-b border-gray-100 last:border-0">
                                  {r.full_name}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                      {pixPayerEntityId && <p className="text-xs text-blue-600">Morador vinculado ✓</p>}
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
          {step === 3 && !proofDone && (
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

          {/* ── Step 3 done: opções multi-comprovante ── */}
          {step === 3 && proofDone && (
            <div className="flex flex-col gap-3">
              <div className="bg-green-50 border border-green-200 rounded-xl p-4 text-center">
                <CheckCircle2 className="w-8 h-8 text-green-500 mx-auto mb-2" />
                <p className="text-sm font-semibold text-green-700">Comprovante confirmado!</p>
                <p className="text-xs text-gray-500 mt-1">Deseja emitir outro comprovante?</p>
              </div>
              <button onClick={resetForSamePerson}
                className="w-full py-3 rounded-xl border-2 border-[#26619c] text-[#26619c] text-sm font-semibold hover:bg-blue-50 transition flex items-center justify-center gap-2">
                <Printer className="w-4 h-4" /> Emitir outro para <strong>{proofName}</strong>
              </button>
              <button onClick={resetForNewPerson}
                className="w-full py-3 rounded-xl border-2 border-gray-300 text-gray-700 text-sm font-semibold hover:bg-gray-50 transition">
                Emitir para outra pessoa
              </button>
            </div>
          )}

          {/* ── Step 2: Confirmação ── */}
          {step === 2 && (
            <div className="flex flex-col gap-3">
              {openSessions.length > 0 && (openSessions.length > 1 || !openSessions.some(s => s.is_mine)) && (
                <div>
                  <p className="text-xs font-medium text-gray-600 mb-1">Caixa de destino <span className="text-red-500">*</span></p>
                  {!openSessions.some(s => s.is_mine) && (
                    <p className="text-[11px] text-amber-600 mb-1.5">Você não tem caixa aberto. Selecione o caixa destino:</p>
                  )}
                  <div className="flex flex-col gap-1.5">
                    {openSessions.map(s => (
                      <button key={s.id} type="button" onClick={() => setSelectedSessionId(s.id)}
                        className={`flex items-center justify-between px-3 py-2 rounded-lg border text-left transition ${selectedSessionId === s.id ? 'border-[#26619c] bg-blue-50' : 'border-gray-200 hover:border-gray-300'}`}>
                        <span className="text-sm font-medium text-gray-800">{s.opened_by_name}</span>
                        {s.is_mine && <span className="text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full">Meu caixa</span>}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <p className="text-sm font-medium text-gray-700">{isProof ? 'Confirmar emissão do comprovante:' : 'Confirmar transação:'}</p>
              <div className={`rounded-xl p-4 border ${isAcordo ? 'bg-purple-50 border-purple-200' : txType === 'income' ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
                <p className={`text-lg font-bold ${isAcordo ? 'text-purple-700' : txType === 'income' ? 'text-green-700' : 'text-red-700'}`}>
                  {isProof && proofIsento ? 'ISENTO' : `${txType === 'income' ? '+' : '-'} R$ ${parseFloat(amount || '0').toFixed(2)}`}
                  {isAcordo && <span className="ml-2 text-sm font-semibold bg-purple-200 text-purple-800 px-2 py-0.5 rounded-full">ACORDO {acordoInstallments}x</span>}
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
          {step === 3 && !proofDone ? (
            <button onClick={() => { onSuccess(); onClose() }}
              className="text-sm text-gray-400 hover:text-gray-600">
              Pular verificação
            </button>
          ) : step === 3 && proofDone ? (
            <span />
          ) : (
            <button onClick={step === 0 || step === initialStep ? onClose : () => setStep(step - 1)}
              className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700">
              <ChevronLeft className="w-4 h-4" />
              {step === 0 || step === initialStep ? 'Cancelar' : 'Anterior'}
            </button>
          )}
          {step === 3 && proofDone ? (
            <button onClick={onClose}
              className="flex items-center gap-2 bg-gray-800 hover:bg-gray-900 text-white px-6 py-2 rounded-xl text-sm font-semibold transition">
              Finalizar
            </button>
          ) : step === 3 ? (
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
