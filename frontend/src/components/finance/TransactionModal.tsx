import { useEffect, useState } from 'react'
import { X, ChevronLeft, ChevronRight, Search, AlertCircle, CheckCircle2 } from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../../services/api'
import { financeService } from '../../services/finance'
import { PhotoCapture } from '../packages/PhotoCapture'
import type { TransactionCategory, PaymentMethod, Resident } from '../../types'

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

export function TransactionModal({ onClose, onSuccess }: Props) {
  const [step, setStep] = useState(0)
  const [saving, setSaving] = useState(false)

  // Step 1
  const [txType, setTxType] = useState<'income' | 'expense'>('income')
  const [incomeSubtype, setIncomeSubtype] = useState<IncomeSubtype>('other')

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

  // Step 2 — expense specific
  const [receiptPhotoUrl, setReceiptPhotoUrl] = useState('')

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

  // Auto-fill description based on income subtype
  useEffect(() => {
    if (txType !== 'income') return
    const sub = INCOME_SUBTYPES.find(s => s.value === incomeSubtype)
    if (sub && incomeSubtype !== 'other') {
      setDescription(sub.label + (resident ? ` — ${resident.full_name}` : ''))
    }
  }, [incomeSubtype, resident, txType])

  const lookupCpf = async () => {
    const cpf = cpfQuery.replace(/\D/g, '')
    if (cpf.length !== 11) { toast.error('CPF inválido.'); return }
    setCpfLoading(true)
    try {
      const res = await api.get<Resident>(`/residents/cpf/${cpfQuery}`)
      setResident(res.data)
    } catch {
      toast.error('Morador não encontrado para este CPF.')
      setResident(null)
      setPaymentHistory(null)
    } finally {
      setCpfLoading(false)
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

  const canProceed = () => {
    if (step === 0) return true
    if (step === 1) {
      if (!amount || parseFloat(amount) <= 0) return false
      if (!description.trim()) return false
      if (txType === 'income' && incomeSubtype === 'mensalidade' && !resident) return false
      return true
    }
    return true
  }

  const handleSubmit = async () => {
    if (!amount || !description.trim()) return
    setSaving(true)
    try {
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
    } catch (e: any) {
      toast.error(e.response?.data?.detail ?? 'Erro ao registrar transação.')
    } finally {
      setSaving(false)
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
          {STEP_TITLES.map((title, i) => (
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
              {/* Resident lookup (income only) */}
              {txType === 'income' && (
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    CPF do morador {incomeSubtype === 'mensalidade' ? <span className="text-red-500">*</span> : '(opcional)'}
                  </label>
                  <div className="flex gap-2">
                    <input value={cpfQuery} onChange={(e) => setCpfQuery(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && lookupCpf()}
                      placeholder="000.000.000-00"
                      className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#26619c]/40 focus:border-[#26619c]" />
                    <button type="button" onClick={lookupCpf} disabled={cpfLoading}
                      className="px-3 py-2 bg-[#26619c] text-white rounded-lg hover:bg-[#1a4f87] disabled:opacity-50">
                      {cpfLoading ? '…' : <Search className="w-4 h-4" />}
                    </button>
                  </div>
                  {resident && (
                    <div className="mt-2 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 text-sm text-blue-800">
                      <p className="font-medium">{resident.full_name}</p>
                      <p className="text-xs text-blue-600">
                        {resident.type === 'member' ? 'Associado' : 'Dependente'}
                        {resident.unit ? ` · Unid. ${resident.unit}` : ''}
                        {' · '}
                        <span className={resident.status === 'active' ? 'text-green-600' : 'text-red-600'}>
                          {resident.status === 'active' ? 'Ativo' : resident.status === 'suspended' ? 'Suspenso' : 'Inativo'}
                        </span>
                      </p>
                    </div>
                  )}

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

              {/* Category */}
              {categories.length > 0 && (
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Categoria</label>
                  <div className="flex flex-wrap gap-2">
                    {categories.map((c) => (
                      <button key={c.id} type="button" onClick={() => setCategoryId(c.id === categoryId ? '' : c.id)}
                        className={`px-3 py-1.5 rounded-full text-xs font-medium border transition ${
                          categoryId === c.id
                            ? 'bg-[#26619c] text-white border-[#26619c]'
                            : 'border-gray-300 text-gray-600 hover:border-[#26619c]'
                        }`}>
                        {c.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Amount */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Valor (R$) <span className="text-red-500">*</span></label>
                <input type="number" min="0.01" step="0.01" value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0,00"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#26619c]/40 focus:border-[#26619c]" />
              </div>

              {/* Description */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Descrição <span className="text-red-500">*</span></label>
                <input value={description} onChange={(e) => setDescription(e.target.value)}
                  placeholder="Descreva a transação…"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#26619c]/40 focus:border-[#26619c]" />
              </div>

              {/* Payment method */}
              {paymentMethods.length > 0 && (
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Forma de pagamento</label>
                  <div className="flex flex-wrap gap-2">
                    {paymentMethods.map((m) => (
                      <button key={m.id} type="button" onClick={() => setPaymentMethodId(m.id === paymentMethodId ? '' : m.id)}
                        className={`px-3 py-1.5 rounded-full text-xs font-medium border transition ${
                          paymentMethodId === m.id
                            ? 'bg-[#26619c] text-white border-[#26619c]'
                            : 'border-gray-300 text-gray-600 hover:border-[#26619c]'
                        }`}>
                        {m.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Receipt photo (expense only) */}
              {txType === 'expense' && (
                <PhotoCapture label="Foto do Comprovante" onCapture={(e) => setReceiptPhotoUrl(e.url)} />
              )}
            </>
          )}

          {/* ── Step 3: Confirmação ── */}
          {step === 2 && (
            <div className="flex flex-col gap-3">
              <p className="text-sm font-medium text-gray-700">Confirmar transação:</p>
              <div className={`rounded-xl p-4 border ${txType === 'income' ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
                <p className={`text-lg font-bold ${txType === 'income' ? 'text-green-700' : 'text-red-700'}`}>
                  {txType === 'income' ? '+' : '-'} R$ {parseFloat(amount || '0').toFixed(2)}
                </p>
                <p className="text-sm text-gray-700 mt-1">{description}</p>
                {txType === 'income' && (
                  <p className="text-xs text-gray-500 mt-1">
                    Tipo: {INCOME_SUBTYPES.find(s => s.value === incomeSubtype)?.label}
                  </p>
                )}
                {resident && <p className="text-xs text-gray-500">Morador: {resident.full_name}</p>}
                {categoryId && <p className="text-xs text-gray-500">Categoria: {categories.find(c => c.id === categoryId)?.name}</p>}
                {paymentMethodId && <p className="text-xs text-gray-500">Pagamento: {paymentMethods.find(m => m.id === paymentMethodId)?.name}</p>}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-gray-100">
          <button onClick={step === 0 ? onClose : () => setStep(step - 1)}
            className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700">
            <ChevronLeft className="w-4 h-4" />
            {step === 0 ? 'Cancelar' : 'Anterior'}
          </button>
          {step < 2 ? (
            <button onClick={() => setStep(step + 1)} disabled={!canProceed()}
              className="flex items-center gap-2 bg-[#26619c] hover:bg-[#1a4f87] text-white px-5 py-2 rounded-xl text-sm font-semibold transition disabled:opacity-50">
              Próximo <ChevronRight className="w-4 h-4" />
            </button>
          ) : (
            <button onClick={handleSubmit} disabled={saving}
              className="bg-[#26619c] hover:bg-[#1a4f87] text-white px-6 py-2 rounded-xl text-sm font-semibold transition disabled:opacity-50">
              {saving ? 'Salvando…' : 'Confirmar'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
