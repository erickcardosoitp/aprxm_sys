import { lazy, Suspense, useEffect, useState } from 'react'
import { ChevronLeft, RefreshCw, Search, Tag, Home, PlusCircle, MinusCircle, ListOrdered, CreditCard } from 'lucide-react'
import toast from 'react-hot-toast'
import { SimplificaHeader } from './components/SimplificaHeader'
import { SimplificaTile } from './components/SimplificaTile'
import { SimplificaBottomSheet } from './components/SimplificaBottomSheet'
import { SECTOR_COLORS } from './theme'
import { financeService } from '../../services/finance'
import { SangriaModal } from '../../components/finance/SangriaModal'
import { useAuthStore } from '../../store/authStore'
import type { CashSession, Transaction, Resident } from '../../types'
import api from '../../services/api'

const TransactionModal = lazy(() =>
  import('../../components/finance/TransactionModal').then(m => ({ default: m.TransactionModal }))
)

type ActiveModal = 'mensalidades' | 'residencia' | 'outras' | 'sangria' | null

// ── helpers ──────────────────────────────────────────────────────────────────

const SIGLA: Record<string, string> = {
  mensalidade: 'Mens.',
  proof_of_residence: 'Comp.',
  delivery_fee: 'Taxa',
  other: 'Outro',
}

function shortDesc(tx: Transaction): string {
  const base = tx.description ?? ''
  const afterDash = base.includes(' — ') ? base.split(' — ').slice(1).join(' — ') : base
  const clean = afterDash.replace(/^\[INCIDENTE\]\s*/, '').trim()
  if (!clean) return base
  const sigla = tx.income_subtype ? SIGLA[tx.income_subtype] : tx.type === 'sangria' ? 'Saída' : tx.type === 'expense' ? 'Saída' : ''
  return sigla ? `${sigla} ${clean}` : clean
}

// ── Movimentações (tela cheia) ────────────────────────────────────────────────

function MovimentacoesTela({ onClose }: { onClose: () => void }) {
  const role = useAuthStore((s) => s.role)
  const isOperator = role === 'operator' || role === 'viewer'

  const [session, setSession] = useState<CashSession | null>(null)
  const [txs, setTxs] = useState<Transaction[]>([])
  const [loading, setLoading] = useState(true)

  const load = async () => {
    setLoading(true)
    try {
      const sessRes = await financeService.getCurrentSession()
      setSession(sessRes.data)
      const txRes = await financeService.listTransactions(sessRes.data.id)
      setTxs(txRes.data)
    } catch {
      toast.error('Nenhuma sessão de caixa aberta.')
      onClose()
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const totalEntradas = txs.filter(t => t.type === 'income').reduce((s, t) => s + parseFloat(t.amount), 0)
  const totalSaidas   = txs.filter(t => t.type !== 'income').reduce((s, t) => s + parseFloat(t.amount), 0)

  return (
    <div className="fixed inset-0 z-40 bg-slate-100 flex flex-col">
      <div className="flex items-center gap-3 px-4 py-3 text-white sticky top-0 z-10"
        style={{ backgroundColor: SECTOR_COLORS.caixa, paddingTop: 'max(12px, env(safe-area-inset-top))' }}>
        <button onClick={onClose} className="p-1 -ml-1 rounded-lg hover:bg-white/10 transition">
          <ChevronLeft className="w-6 h-6" />
        </button>
        <span className="font-bold text-base flex-1">Movimentações</span>
        <button onClick={load} className="p-2 rounded-lg hover:bg-white/10 transition">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="w-8 h-8 border-2 border-t-transparent rounded-full animate-spin"
            style={{ borderColor: SECTOR_COLORS.caixa }} />
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto pb-8">
          {/* Resumo — oculto para operadores */}
          {!isOperator && session && (
            <div className="p-4 grid grid-cols-2 gap-3">
              <div className="bg-white rounded-2xl p-3 shadow-sm text-center">
                <p className="text-[11px] text-gray-500 font-medium uppercase tracking-wide mb-1">Entradas</p>
                <p className="text-base font-bold text-emerald-600">
                  R$ {totalEntradas.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                </p>
              </div>
              <div className="bg-white rounded-2xl p-3 shadow-sm text-center">
                <p className="text-[11px] text-gray-500 font-medium uppercase tracking-wide mb-1">Saídas</p>
                <p className="text-base font-bold text-red-500">
                  R$ {totalSaidas.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                </p>
              </div>
            </div>
          )}

          {txs.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-16 text-gray-400">
              <span className="text-4xl">📋</span>
              <p className="text-sm">Nenhuma movimentação ainda.</p>
            </div>
          ) : (
            <div className="px-4 flex flex-col gap-2">
              {txs.map(tx => {
                const isIncome = tx.type === 'income'
                const isSangria = tx.type === 'sangria'
                const colorClass = isIncome ? 'text-emerald-600' : isSangria ? 'text-amber-600' : 'text-red-500'

                return (
                  <div key={tx.id} className="bg-white rounded-2xl shadow-sm p-4 flex items-center gap-3">
                    <div className={`w-8 h-8 rounded-xl flex items-center justify-center text-sm font-bold shrink-0 ${
                      isIncome ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-500'
                    }`}>
                      {isIncome ? '↑' : '↓'}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-800 truncate">{shortDesc(tx)}</p>
                      <p className="text-xs text-gray-400 mt-0.5">
                        {new Date(tx.transaction_at).toLocaleString('pt-BR', {
                          day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
                        })}
                        {tx.payment_method_name && ` · ${tx.payment_method_name}`}
                      </p>
                    </div>
                    {/* Valor oculto para operadores */}
                    {!isOperator && (
                      <span className={`text-sm font-bold shrink-0 ${colorClass}`}>
                        {isIncome ? '+' : '-'} R$ {parseFloat(tx.amount).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Consultar Pagamentos ───────────────────────────────────────────────────────

interface PaymentHistory {
  total_payments: number
  last_payment_at: string | null
  current_month_paid: boolean
  is_delinquent: boolean
  monthly_payment_day: number | null
  payments: Array<{ id: string; amount: string; description: string; transaction_at: string }>
}

function ConsultarPagamentosSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Resident[]>([])
  const [searching, setSearching] = useState(false)
  const [selected, setSelected] = useState<Resident | null>(null)
  const [history, setHistory] = useState<PaymentHistory | null>(null)
  const [loadingHistory, setLoadingHistory] = useState(false)

  const search = async (q: string) => {
    setQuery(q)
    setSelected(null)
    setHistory(null)
    if (q.length < 2) { setResults([]); return }
    setSearching(true)
    try {
      const r = await api.get<Resident[]>('/residents/search', { params: { q } })
      setResults(r.data.slice(0, 6))
    } catch { /* silent */ } finally { setSearching(false) }
  }

  const select = async (r: Resident) => {
    setSelected(r)
    setResults([])
    setQuery(r.full_name)
    setLoadingHistory(true)
    try {
      const res = await api.get<PaymentHistory>(`/finance/residents/${r.id}/payment-history`)
      setHistory(res.data)
    } catch { toast.error('Erro ao consultar histórico.') } finally { setLoadingHistory(false) }
  }

  const reset = () => { setQuery(''); setResults([]); setSelected(null); setHistory(null) }

  return (
    <SimplificaBottomSheet open={open} title="Consultar Pagamentos" onClose={() => { reset(); onClose() }}>
      <div className="flex flex-col gap-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            value={query}
            onChange={e => search(e.target.value)}
            placeholder="Nome do morador…"
            className="w-full border-2 border-gray-200 rounded-xl pl-10 pr-4 py-3 text-sm focus:outline-none focus:border-emerald-500"
            autoFocus
          />
          {searching && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400">…</span>}
        </div>

        {results.length > 0 && !selected && (
          <div className="flex flex-col divide-y divide-gray-100 border border-gray-200 rounded-xl overflow-hidden">
            {results.map(r => (
              <button key={r.id} onClick={() => select(r)}
                className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 text-left transition">
                <div>
                  <p className="text-sm font-semibold text-gray-800">{r.full_name}</p>
                  <p className="text-xs text-gray-400">{r.unit ? `Casa/Apto ${r.unit}` : ''}{r.cpf ? ` · ${r.cpf}` : ''}</p>
                </div>
              </button>
            ))}
          </div>
        )}

        {loadingHistory && (
          <div className="flex justify-center py-6">
            <div className="w-6 h-6 border-2 border-t-transparent rounded-full animate-spin"
              style={{ borderColor: SECTOR_COLORS.caixa }} />
          </div>
        )}

        {selected && history && (
          <div className="flex flex-col gap-3">
            <div className={`rounded-2xl p-4 border ${
              history.is_delinquent ? 'bg-red-50 border-red-200' :
              history.current_month_paid ? 'bg-emerald-50 border-emerald-200' :
              'bg-amber-50 border-amber-200'
            }`}>
              <p className="font-bold text-gray-800 mb-1">{selected.full_name}</p>
              <p className={`text-sm font-semibold ${
                history.is_delinquent ? 'text-red-600' :
                history.current_month_paid ? 'text-emerald-600' : 'text-amber-600'
              }`}>
                {history.is_delinquent ? '🚨 Inadimplente' :
                 history.current_month_paid ? '✅ Adimplente — mês pago' : '⚠️ Mês atual em aberto'}
              </p>
              <p className="text-xs text-gray-500 mt-1">
                {history.total_payments} pagamento(s) registrado(s)
                {history.last_payment_at && ` · Último: ${new Date(history.last_payment_at).toLocaleDateString('pt-BR')}`}
                {history.monthly_payment_day && ` · Vence dia ${history.monthly_payment_day}`}
              </p>
            </div>

            {history.payments.length > 0 && (
              <div className="flex flex-col gap-2">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Últimos pagamentos</p>
                {history.payments.slice(0, 5).map(p => (
                  <div key={p.id} className="bg-white rounded-xl border border-gray-100 px-4 py-3 flex justify-between items-center shadow-sm">
                    <div>
                      <p className="text-sm text-gray-700 truncate max-w-[180px]">{p.description}</p>
                      <p className="text-xs text-gray-400">
                        {new Date(p.transaction_at).toLocaleDateString('pt-BR')}
                      </p>
                    </div>
                    <span className="text-sm font-bold text-emerald-600 shrink-0">
                      R$ {parseFloat(p.amount).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                ))}
              </div>
            )}

            <button onClick={reset}
              className="text-sm text-gray-400 hover:text-gray-600 underline self-center mt-1">
              Buscar outro morador
            </button>
          </div>
        )}
      </div>
    </SimplificaBottomSheet>
  )
}

// ── SimplificaCaixa ───────────────────────────────────────────────────────────

export default function SimplificaCaixa() {
  const [modal, setModal] = useState<ActiveModal>(null)
  const [movOpen, setMovOpen] = useState(false)
  const [pagamentosOpen, setPagamentosOpen] = useState(false)

  return (
    <div className="flex flex-col min-h-screen">
      <SimplificaHeader title="Caixa" showBack />

      <main className="flex-1 p-4 grid grid-cols-2 gap-4 content-start">
        <SimplificaTile icon={Tag}        label="Mensalidades"      color={SECTOR_COLORS.caixa} onClick={() => setModal('mensalidades')} />
        <SimplificaTile icon={Home}       label="Comp. Residência"  color={SECTOR_COLORS.caixa} onClick={() => setModal('residencia')} />
        <SimplificaTile icon={PlusCircle} label="Outras Entradas"   color={SECTOR_COLORS.caixa} onClick={() => setModal('outras')} />
        <SimplificaTile icon={MinusCircle} label="Registrar Saída"  color={SECTOR_COLORS.caixa} onClick={() => setModal('sangria')} />
        <SimplificaTile icon={ListOrdered} label="Consultar Movim." color={SECTOR_COLORS.caixa} onClick={() => setMovOpen(true)} />
        <SimplificaTile icon={CreditCard} label="Consultar Pgtos"   color={SECTOR_COLORS.caixa} onClick={() => setPagamentosOpen(true)} />
      </main>

      {movOpen && <MovimentacoesTela onClose={() => setMovOpen(false)} />}

      {modal === 'mensalidades' && (
        <Suspense fallback={null}>
          <TransactionModal initialTxType="income" initialSubtype="mensalidade" initialStep={1}
            skipAutoPrint onClose={() => setModal(null)} onSuccess={() => setModal(null)} />
        </Suspense>
      )}
      {modal === 'residencia' && (
        <Suspense fallback={null}>
          <TransactionModal initialTxType="income" initialSubtype="proof_of_residence" initialStep={1}
            skipAutoPrint onClose={() => setModal(null)} onSuccess={() => setModal(null)} />
        </Suspense>
      )}
      {modal === 'outras' && (
        <Suspense fallback={null}>
          <TransactionModal initialTxType="income" initialSubtype="other" initialStep={1}
            skipAutoPrint onClose={() => setModal(null)} onSuccess={() => setModal(null)} />
        </Suspense>
      )}
      {modal === 'sangria' && (
        <SangriaModal onClose={() => setModal(null)} onSuccess={() => setModal(null)} />
      )}

      <ConsultarPagamentosSheet open={pagamentosOpen} onClose={() => setPagamentosOpen(false)} />
    </div>
  )
}
