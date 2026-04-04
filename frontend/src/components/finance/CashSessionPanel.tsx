import { useState } from 'react'
import {
  AlertTriangle, CheckCircle, ClipboardCheck, DollarSign, Lock, MinusCircle,
  PlusCircle, TrendingUp, Unlock, User, X,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { financeService } from '../../services/finance'
import { useAuthStore } from '../../store/authStore'
import type { CashSession, Transaction } from '../../types'

interface Props {
  session: CashSession | null
  onRefresh: () => void
  canConferencia?: boolean
}

type CloseStep = 'blind' | 'review' | 'done'

// ── helpers ──────────────────────────────────────────────────────────────────

function fmt(v: number) {
  return v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function elapsed(openedAt: string) {
  const ms = Date.now() - new Date(openedAt).getTime()
  const h = Math.floor(ms / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  return h > 0 ? `${h}h ${m}min` : `${m}min`
}

// ── Close multi-step modal ────────────────────────────────────────────────────

interface CloseModalProps {
  session: CashSession
  onDone: () => void
  onCancel: () => void
}

function CloseModal({ session, onDone, onCancel }: CloseModalProps) {
  const [step, setStep] = useState<CloseStep>('blind')
  const [blindAmount, setBlindAmount] = useState('')
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<{ expected: number; counted: number; diff: number } | null>(null)

  const openingBalance = parseFloat(session.opening_balance)

  const fetchAndReview = async () => {
    const counted = parseFloat(blindAmount.replace(',', '.'))
    if (isNaN(counted) || counted < 0) { toast.error('Valor inválido.'); return }
    setLoading(true)
    try {
      const res = await financeService.listTransactions()
      const txs: Transaction[] = res.data
      setTransactions(txs)
      const income = txs.filter(t => t.type === 'income').reduce((s, t) => s + parseFloat(t.amount), 0)
      const exits = txs.filter(t => t.type !== 'income').reduce((s, t) => s + parseFloat(t.amount), 0)
      const expected = openingBalance + income - exits
      setResult({ expected, counted, diff: counted - expected })
      setStep('review')
    } catch {
      toast.error('Erro ao buscar movimentações.')
    } finally {
      setLoading(false)
    }
  }

  const handleConfirm = async () => {
    if (!result) return
    setLoading(true)
    try {
      await financeService.closeSession(result.counted)
      setStep('done')
      setTimeout(() => { onDone() }, 1800)
    } catch (e: any) {
      toast.error(e.response?.data?.detail ?? 'Erro ao fechar caixa.')
    } finally {
      setLoading(false)
    }
  }

  const income = transactions.filter(t => t.type === 'income').reduce((s, t) => s + parseFloat(t.amount), 0)
  const exits = transactions.filter(t => t.type !== 'income').reduce((s, t) => s + parseFloat(t.amount), 0)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <Lock className="w-4 h-4 text-gray-500" />
            <span className="font-bold text-gray-900 text-sm">Fechamento de Caixa</span>
          </div>
          {step !== 'done' && (
            <button onClick={onCancel} className="text-gray-400 hover:text-gray-600"><X className="w-4 h-4" /></button>
          )}
        </div>

        {/* Step indicators */}
        {step !== 'done' && (
          <div className="flex border-b border-gray-100">
            {(['blind', 'review'] as const).map((s, i) => (
              <div key={s} className={`flex-1 py-2 text-center text-xs font-medium border-b-2 transition ${
                step === s ? 'border-[#26619c] text-[#26619c]' :
                (step === 'review' && s === 'blind') ? 'border-green-400 text-green-600' :
                'border-transparent text-gray-400'
              }`}>
                {i + 1}. {s === 'blind' ? 'Contagem Cega' : 'Conferência'}
              </div>
            ))}
          </div>
        )}

        <div className="px-6 py-5">
          {/* ── Step 1: Blind count ── */}
          {step === 'blind' && (
            <div className="flex flex-col gap-4">
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-semibold text-amber-900">Contagem Cega</p>
                    <p className="text-xs text-amber-700 mt-1">
                      Conte o dinheiro na gaveta <strong>sem olhar o sistema</strong>.
                      Informe o valor contado abaixo.
                    </p>
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Valor total contado (R$) *</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={blindAmount}
                  onChange={e => setBlindAmount(e.target.value)}
                  placeholder="0,00"
                  autoFocus
                  onKeyDown={e => { if (e.key === 'Enter' && blindAmount) fetchAndReview() }}
                  className="w-full border border-gray-300 rounded-xl px-4 py-3 text-lg font-semibold text-center focus:outline-none focus:ring-2 focus:ring-[#26619c]/40 focus:border-[#26619c]"
                />
              </div>

              <div className="flex gap-3">
                <button onClick={onCancel}
                  className="flex-1 border border-gray-300 text-gray-600 py-2.5 rounded-xl text-sm hover:bg-gray-50 transition">
                  Cancelar
                </button>
                <button onClick={fetchAndReview} disabled={!blindAmount || loading}
                  className="flex-1 bg-[#26619c] hover:bg-[#1a4f87] text-white py-2.5 rounded-xl text-sm font-semibold transition disabled:opacity-50">
                  {loading ? 'Calculando…' : 'Ver Conferência →'}
                </button>
              </div>
            </div>
          )}

          {/* ── Step 2: Review ── */}
          {step === 'review' && result && (
            <div className="flex flex-col gap-4">
              {/* Summary grid */}
              <div className="bg-gray-50 rounded-xl p-4 grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-xs text-gray-400">Saldo de abertura</p>
                  <p className="font-semibold text-gray-800">R$ {fmt(openingBalance)}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-400">Duração</p>
                  <p className="font-semibold text-gray-800">{elapsed(session.opened_at)}</p>
                </div>
                <div className="flex items-center gap-1">
                  <PlusCircle className="w-3.5 h-3.5 text-green-500 shrink-0" />
                  <div>
                    <p className="text-xs text-gray-400">Entradas</p>
                    <p className="font-semibold text-green-700">R$ {fmt(income)}</p>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <MinusCircle className="w-3.5 h-3.5 text-red-500 shrink-0" />
                  <div>
                    <p className="text-xs text-gray-400">Saídas</p>
                    <p className="font-semibold text-red-600">R$ {fmt(exits)}</p>
                  </div>
                </div>
              </div>

              {/* Expected vs Counted */}
              <div className="border border-gray-200 rounded-xl overflow-hidden">
                <div className="flex">
                  <div className="flex-1 p-4 text-center border-r border-gray-200">
                    <p className="text-xs text-gray-500 mb-1">Saldo esperado</p>
                    <p className="text-xl font-bold text-gray-800">R$ {fmt(result.expected)}</p>
                  </div>
                  <div className="flex-1 p-4 text-center">
                    <p className="text-xs text-gray-500 mb-1">Você contou</p>
                    <p className="text-xl font-bold text-[#26619c]">R$ {fmt(result.counted)}</p>
                  </div>
                </div>
                <div className={`px-4 py-3 text-center border-t border-gray-200 ${
                  result.diff === 0 ? 'bg-green-50' : result.diff > 0 ? 'bg-blue-50' : 'bg-red-50'
                }`}>
                  <p className="text-xs font-medium text-gray-500 mb-0.5">Diferença</p>
                  <p className={`text-lg font-bold ${
                    result.diff === 0 ? 'text-green-700' : result.diff > 0 ? 'text-blue-700' : 'text-red-700'
                  }`}>
                    {result.diff >= 0 ? '+' : ''}R$ {fmt(result.diff)}
                  </p>
                  <p className={`text-xs mt-0.5 ${
                    result.diff === 0 ? 'text-green-600' : result.diff > 0 ? 'text-blue-600' : 'text-red-600'
                  }`}>
                    {result.diff === 0 ? 'Caixa conferido — sem diferença' :
                     result.diff > 0 ? 'Sobra de caixa detectada' : 'Falta de caixa detectada'}
                  </p>
                </div>
              </div>

              <div className="flex gap-3">
                <button onClick={() => setStep('blind')}
                  className="flex-1 border border-gray-300 text-gray-600 py-2.5 rounded-xl text-sm hover:bg-gray-50 transition">
                  ← Redigitar
                </button>
                <button onClick={handleConfirm} disabled={loading}
                  className="flex-1 bg-red-600 hover:bg-red-700 text-white py-2.5 rounded-xl text-sm font-semibold transition disabled:opacity-50 flex items-center justify-center gap-1.5">
                  <Lock className="w-3.5 h-3.5" />
                  {loading ? 'Fechando…' : 'Confirmar Fechamento'}
                </button>
              </div>
            </div>
          )}

          {/* ── Step 3: Done ── */}
          {step === 'done' && result && (
            <div className="flex flex-col items-center gap-4 py-4">
              <div className={`w-16 h-16 rounded-full flex items-center justify-center ${
                result.diff === 0 ? 'bg-green-100' : 'bg-amber-100'
              }`}>
                <CheckCircle className={`w-8 h-8 ${result.diff === 0 ? 'text-green-600' : 'text-amber-500'}`} />
              </div>
              <div className="text-center">
                <p className="font-bold text-gray-900 mb-1">Caixa fechado!</p>
                <p className="text-sm text-gray-500">
                  {result.diff === 0
                    ? 'Caixa conferido com sucesso. Sem diferença.'
                    : result.diff > 0
                      ? `Sobra de R$ ${fmt(result.diff)} registrada.`
                      : `Falta de R$ ${fmt(Math.abs(result.diff))} registrada.`}
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Conferência modal ─────────────────────────────────────────────────────────

interface ConferenciaModalProps {
  session: CashSession
  onDone: () => void
  onCancel: () => void
}

function ConferenciaModal({ session, onDone, onCancel }: ConferenciaModalProps) {
  const [step, setStep] = useState<'blind' | 'review' | 'done'>('blind')
  const [blindAmount, setBlindAmount] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<{ expected: number; counted: number; diff: number; income: number; exits: number } | null>(null)

  const handleConferencia = async () => {
    const counted = parseFloat(blindAmount.replace(',', '.'))
    if (isNaN(counted) || counted < 0) { toast.error('Valor inválido.'); return }
    setLoading(true)
    try {
      const res = await financeService.conferencia(counted)
      const d = res.data
      setResult({
        expected: parseFloat(d.expected),
        counted: parseFloat(d.counted),
        diff: parseFloat(d.difference),
        income: parseFloat(d.income),
        exits: parseFloat(d.exits),
      })
      setStep('review')
    } catch (e: any) {
      toast.error(e.response?.data?.detail ?? 'Erro ao realizar conferência.')
    } finally {
      setLoading(false)
    }
  }

  const openingBalance = parseFloat(session.opening_balance)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <ClipboardCheck className="w-4 h-4 text-gray-500" />
            <span className="font-bold text-gray-900 text-sm">Conferência de Caixa</span>
          </div>
          {step !== 'done' && (
            <button onClick={onCancel} className="text-gray-400 hover:text-gray-600"><X className="w-4 h-4" /></button>
          )}
        </div>

        {/* Step indicators */}
        {step !== 'done' && (
          <div className="flex border-b border-gray-100">
            {(['blind', 'review'] as const).map((s, i) => (
              <div key={s} className={`flex-1 py-2 text-center text-xs font-medium border-b-2 transition ${
                step === s ? 'border-[#26619c] text-[#26619c]' :
                (step === 'review' && s === 'blind') ? 'border-green-400 text-green-600' :
                'border-transparent text-gray-400'
              }`}>
                {i + 1}. {s === 'blind' ? 'Contagem Cega' : 'Resultado'}
              </div>
            ))}
          </div>
        )}

        <div className="px-6 py-5">
          {/* ── Step 1: Blind count ── */}
          {step === 'blind' && (
            <div className="flex flex-col gap-4">
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-semibold text-amber-900">Contagem Cega</p>
                    <p className="text-xs text-amber-700 mt-1">
                      Conte o dinheiro na gaveta <strong>sem olhar o sistema</strong>.
                      Informe o valor contado abaixo.
                    </p>
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Valor total contado (R$) *</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={blindAmount}
                  onChange={e => setBlindAmount(e.target.value)}
                  placeholder="0,00"
                  autoFocus
                  onKeyDown={e => { if (e.key === 'Enter' && blindAmount) handleConferencia() }}
                  className="w-full border border-gray-300 rounded-xl px-4 py-3 text-lg font-semibold text-center focus:outline-none focus:ring-2 focus:ring-[#26619c]/40 focus:border-[#26619c]"
                />
              </div>

              <div className="flex gap-3">
                <button onClick={onCancel}
                  className="flex-1 border border-gray-300 text-gray-600 py-2.5 rounded-xl text-sm hover:bg-gray-50 transition">
                  Cancelar
                </button>
                <button onClick={handleConferencia} disabled={!blindAmount || loading}
                  className="flex-1 bg-[#26619c] hover:bg-[#1a4f87] text-white py-2.5 rounded-xl text-sm font-semibold transition disabled:opacity-50">
                  {loading ? 'Calculando…' : 'Ver Resultado →'}
                </button>
              </div>
            </div>
          )}

          {/* ── Step 2: Review/Result ── */}
          {step === 'review' && result && (
            <div className="flex flex-col gap-4">
              {/* Summary grid */}
              <div className="bg-gray-50 rounded-xl p-4 grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-xs text-gray-400">Saldo de abertura</p>
                  <p className="font-semibold text-gray-800">R$ {fmt(openingBalance)}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-400">Duração</p>
                  <p className="font-semibold text-gray-800">{elapsed(session.opened_at)}</p>
                </div>
                <div className="flex items-center gap-1">
                  <PlusCircle className="w-3.5 h-3.5 text-green-500 shrink-0" />
                  <div>
                    <p className="text-xs text-gray-400">Entradas</p>
                    <p className="font-semibold text-green-700">R$ {fmt(result.income)}</p>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <MinusCircle className="w-3.5 h-3.5 text-red-500 shrink-0" />
                  <div>
                    <p className="text-xs text-gray-400">Saídas</p>
                    <p className="font-semibold text-red-600">R$ {fmt(result.exits)}</p>
                  </div>
                </div>
              </div>

              {/* Expected vs Counted */}
              <div className="border border-gray-200 rounded-xl overflow-hidden">
                <div className="flex">
                  <div className="flex-1 p-4 text-center border-r border-gray-200">
                    <p className="text-xs text-gray-500 mb-1">Saldo esperado</p>
                    <p className="text-xl font-bold text-gray-800">R$ {fmt(result.expected)}</p>
                  </div>
                  <div className="flex-1 p-4 text-center">
                    <p className="text-xs text-gray-500 mb-1">Você contou</p>
                    <p className="text-xl font-bold text-[#26619c]">R$ {fmt(result.counted)}</p>
                  </div>
                </div>
                <div className={`px-4 py-3 text-center border-t border-gray-200 ${
                  result.diff === 0 ? 'bg-green-50' : result.diff > 0 ? 'bg-blue-50' : 'bg-red-50'
                }`}>
                  <p className="text-xs font-medium text-gray-500 mb-0.5">Diferença</p>
                  <p className={`text-lg font-bold ${
                    result.diff === 0 ? 'text-green-700' : result.diff > 0 ? 'text-blue-700' : 'text-red-700'
                  }`}>
                    {result.diff >= 0 ? '+' : ''}R$ {fmt(result.diff)}
                  </p>
                  <p className={`text-xs mt-0.5 ${
                    result.diff === 0 ? 'text-green-600' : result.diff > 0 ? 'text-blue-600' : 'text-red-600'
                  }`}>
                    {result.diff === 0 ? 'Caixa conferido — sem diferença' :
                     result.diff > 0 ? 'Sobra de caixa detectada' : 'Falta de caixa detectada'}
                  </p>
                </div>
              </div>

              <div className="flex gap-3">
                <button onClick={() => setStep('blind')}
                  className="flex-1 border border-gray-300 text-gray-600 py-2.5 rounded-xl text-sm hover:bg-gray-50 transition">
                  ← Redigitar
                </button>
                <button
                  onClick={() => { setStep('done'); setTimeout(() => { onDone() }, 1500) }}
                  className="flex-1 bg-[#26619c] hover:bg-[#1a4f87] text-white py-2.5 rounded-xl text-sm font-semibold transition flex items-center justify-center gap-1.5">
                  <ClipboardCheck className="w-3.5 h-3.5" />
                  Registrar Conferência
                </button>
              </div>
            </div>
          )}

          {/* ── Step 3: Done ── */}
          {step === 'done' && result && (
            <div className="flex flex-col items-center gap-4 py-4">
              <div className={`w-16 h-16 rounded-full flex items-center justify-center ${
                result.diff === 0 ? 'bg-green-100' : 'bg-amber-100'
              }`}>
                <CheckCircle className={`w-8 h-8 ${result.diff === 0 ? 'text-green-600' : 'text-amber-500'}`} />
              </div>
              <div className="text-center">
                <p className="font-bold text-gray-900 mb-1">Conferência registrada!</p>
                <p className="text-sm text-gray-500">
                  {result.diff === 0
                    ? 'Caixa conferido com sucesso. Sem diferença.'
                    : result.diff > 0
                      ? `Sobra de R$ ${fmt(result.diff)} registrada.`
                      : `Falta de R$ ${fmt(Math.abs(result.diff))} registrada.`}
                </p>
                <p className="text-xs text-gray-400 mt-1">O caixa continua aberto.</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Main panel ────────────────────────────────────────────────────────────────

export function CashSessionPanel({ session, onRefresh, canConferencia = true }: Props) {
  const fullName = useAuthStore((s) => s.fullName)
  const [openBalance, setOpenBalance] = useState('')
  const [opening, setOpening] = useState(false)
  const [showClose, setShowClose] = useState(false)
  const [showConferencia, setShowConferencia] = useState(false)

  const handleOpen = async () => {
    setOpening(true)
    try {
      await financeService.openSession(parseFloat(openBalance) || 0)
      toast.success('Caixa aberto!')
      onRefresh()
    } catch (e: any) {
      toast.error(e.response?.data?.detail ?? 'Erro ao abrir caixa.')
    } finally {
      setOpening(false)
    }
  }

  // ── Caixa fechado ─────────────────────────────────────────────────────────
  if (!session) {
    return (
      <div className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
        <div className="bg-gray-50 px-5 py-4 border-b border-gray-100">
          <h2 className="font-bold text-gray-800 flex items-center gap-2 text-sm">
            <DollarSign className="w-4 h-4 text-gray-400" />
            Frente de Caixa
          </h2>
          <p className="text-xs text-gray-400 mt-0.5">Nenhuma sessão ativa</p>
        </div>

        <div className="p-5 flex flex-col gap-4">
          {fullName && (
            <div className="flex items-center gap-2 text-sm text-gray-600 bg-gray-50 rounded-xl px-4 py-2.5 border border-gray-100">
              <User className="w-4 h-4 text-gray-400" />
              <span>Operador: <strong>{fullName}</strong></span>
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1.5">Saldo inicial (R$)</label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={openBalance}
              onChange={e => setOpenBalance(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleOpen() }}
              placeholder="0,00"
              className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#26619c]/40 focus:border-[#26619c]"
            />
          </div>

          <button
            onClick={handleOpen}
            disabled={opening}
            className="w-full flex items-center justify-center gap-2 bg-[#26619c] hover:bg-[#1a4f87] text-white py-3 rounded-xl font-semibold text-sm transition disabled:opacity-50"
          >
            <Unlock className="w-4 h-4" />
            {opening ? 'Abrindo…' : 'Abrir Caixa'}
          </button>
        </div>
      </div>
    )
  }

  // ── Caixa aberto ──────────────────────────────────────────────────────────
  const openedTime = new Date(session.opened_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })

  return (
    <>
      <div className="rounded-2xl border border-green-200 bg-white shadow-sm overflow-hidden">
        {/* Session header */}
        <div className="bg-green-600 px-5 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2 text-white">
            <Unlock className="w-4 h-4" />
            <span className="font-bold text-sm">Caixa Aberto</span>
          </div>
          <div className="flex items-center gap-3 text-green-100 text-xs">
            <span>Aberto às {openedTime}</span>
            <span className="bg-green-500 px-2 py-0.5 rounded-full font-medium text-white">
              {elapsed(session.opened_at)}
            </span>
          </div>
        </div>

        <div className="p-5 flex flex-col gap-4">
          {/* Operator + opening balance */}
          <div className="grid grid-cols-2 gap-3">
            {fullName && (
              <div className="bg-gray-50 rounded-xl px-3 py-2.5 border border-gray-100">
                <p className="text-xs text-gray-400 mb-0.5">Operador</p>
                <p className="text-sm font-semibold text-gray-800 truncate">{fullName}</p>
              </div>
            )}
            <div className="bg-gray-50 rounded-xl px-3 py-2.5 border border-gray-100">
              <p className="text-xs text-gray-400 mb-0.5">Saldo de abertura</p>
              <p className="text-sm font-semibold text-gray-800">
                R$ {fmt(parseFloat(session.opening_balance))}
              </p>
            </div>
          </div>

          {/* Instructions */}
          <div className="flex items-start gap-2 bg-blue-50 border border-blue-100 rounded-xl px-4 py-3 text-xs text-blue-800">
            <TrendingUp className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" />
            <p>Registre entradas e saídas usando os botões acima. Ao encerrar o turno, clique em <strong>Fechar Caixa</strong> para realizar a conferência.</p>
          </div>

          {/* Conferência + Close buttons */}
          {canConferencia ? (
            <div className="grid grid-cols-2 gap-3">
              <button onClick={() => setShowConferencia(true)} className="flex items-center justify-center gap-2 border-2 border-[#26619c] text-[#26619c] hover:bg-[#26619c]/5 py-3 rounded-xl font-semibold text-sm transition">
                <ClipboardCheck className="w-4 h-4" />
                Conferência
              </button>
              <button onClick={() => setShowClose(true)} className="flex items-center justify-center gap-2 bg-red-600 hover:bg-red-700 text-white py-3 rounded-xl font-semibold text-sm transition">
                <Lock className="w-4 h-4" />
                Fechar Caixa
              </button>
            </div>
          ) : (
            <button onClick={() => setShowClose(true)} className="w-full flex items-center justify-center gap-2 bg-red-600 hover:bg-red-700 text-white py-3 rounded-xl font-semibold text-sm transition">
              <Lock className="w-4 h-4" />
              Fechar Caixa
            </button>
          )}
        </div>
      </div>

      {showClose && (
        <CloseModal
          session={session}
          onDone={() => { setShowClose(false); onRefresh() }}
          onCancel={() => setShowClose(false)}
        />
      )}

      {showConferencia && (
        <ConferenciaModal
          session={session}
          onDone={() => setShowConferencia(false)}
          onCancel={() => setShowConferencia(false)}
        />
      )}
    </>
  )
}
