import { lazy, Suspense, useEffect, useState } from 'react'
import { ChevronLeft, RefreshCw } from 'lucide-react'
import toast from 'react-hot-toast'
import { SimplificaHeader } from './components/SimplificaHeader'
import { SimplificaTile } from './components/SimplificaTile'
import { SimplificaBottomSheet } from './components/SimplificaBottomSheet'
import { SECTOR_COLORS } from './theme'
import { financeService } from '../../services/finance'
import { SangriaModal } from '../../components/finance/SangriaModal'
import type { CashSession, Transaction } from '../../types'

const TransactionModal = lazy(() =>
  import('../../components/finance/TransactionModal').then(m => ({ default: m.TransactionModal }))
)

type ActiveModal = 'mensalidades' | 'residencia' | 'outras' | 'sangria' | null

const fmt = (v: string | number) =>
  parseFloat(String(v)).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const SUBTYPE_LABEL: Record<string, string> = {
  mensalidade: 'Mensalidade',
  proof_of_residence: 'Comprovante',
  delivery_fee: 'Taxa Entrega',
  other: 'Outros',
}

function MovimentacoesTela({
  onClose,
}: {
  onClose: () => void
}) {
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

  // Load on mount
  useEffect(() => { load() }, [])

  const totalEntradas = txs.filter(t => t.type === 'income').reduce((s, t) => s + parseFloat(t.amount), 0)
  const totalSaidas   = txs.filter(t => t.type !== 'income').reduce((s, t) => s + parseFloat(t.amount), 0)
  const saldo = (session ? parseFloat(session.opening_balance) : 0) + totalEntradas - totalSaidas

  return (
    <div className="fixed inset-0 z-40 bg-slate-100 flex flex-col" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
      {/* Header */}
      <div
        className="flex items-center gap-3 px-4 py-3 text-white sticky top-0 z-10"
        style={{ backgroundColor: SECTOR_COLORS.caixa, paddingTop: 'max(12px, env(safe-area-inset-top))' }}
      >
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
          <div className="w-8 h-8 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: SECTOR_COLORS.caixa }} />
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto pb-8">
          {/* Resumo da sessão */}
          <div className="p-4 grid grid-cols-3 gap-3">
            <div className="bg-white rounded-2xl p-3 shadow-sm text-center">
              <p className="text-[11px] text-gray-500 font-medium uppercase tracking-wide mb-1">Entradas</p>
              <p className="text-base font-bold text-emerald-600">R$ {fmt(totalEntradas)}</p>
            </div>
            <div className="bg-white rounded-2xl p-3 shadow-sm text-center">
              <p className="text-[11px] text-gray-500 font-medium uppercase tracking-wide mb-1">Saídas</p>
              <p className="text-base font-bold text-red-500">R$ {fmt(totalSaidas)}</p>
            </div>
            <div className="bg-white rounded-2xl p-3 shadow-sm text-center">
              <p className="text-[11px] text-gray-500 font-medium uppercase tracking-wide mb-1">Saldo</p>
              <p className="text-base font-bold" style={{ color: SECTOR_COLORS.caixa }}>R$ {fmt(saldo)}</p>
            </div>
          </div>

          {/* Lista */}
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
                const bgClass = isIncome ? 'bg-emerald-50 border-emerald-100' : isSangria ? 'bg-amber-50 border-amber-100' : 'bg-red-50 border-red-100'
                const prefix = isIncome ? '+' : '-'

                return (
                  <div key={tx.id} className={`bg-white rounded-2xl shadow-sm border p-4 flex items-start gap-3`}>
                    <div className={`w-9 h-9 rounded-xl flex items-center justify-center text-base shrink-0 ${bgClass} border`}>
                      {isIncome ? '↑' : isSangria ? '↓↓' : '↓'}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-800 truncate">{tx.description}</p>
                      <p className="text-xs text-gray-400 mt-0.5">
                        {new Date(tx.transaction_at).toLocaleString('pt-BR', {
                          day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
                        })}
                        {tx.income_subtype && ` · ${SUBTYPE_LABEL[tx.income_subtype] ?? tx.income_subtype}`}
                        {tx.payment_method_name && ` · ${tx.payment_method_name}`}
                      </p>
                    </div>
                    <span className={`text-sm font-bold shrink-0 ${colorClass}`}>
                      {prefix} R$ {fmt(tx.amount)}
                    </span>
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

export default function SimplificaCaixa() {
  const [modal, setModal] = useState<ActiveModal>(null)
  const [movOpen, setMovOpen] = useState(false)
  const [incidenteSheet, setIncidenteSheet] = useState(false)
  const [incidente, setIncidente] = useState('')
  const [salvando, setSalvando] = useState(false)

  const handleIncidente = async () => {
    if (!incidente.trim()) return
    setSalvando(true)
    try {
      await financeService.registerTransaction({
        type: 'income',
        amount: 0.01,
        description: `[INCIDENTE] ${incidente.trim()}`,
        income_subtype: 'other',
      })
      toast.success('Incidente registrado.')
      setIncidente('')
      setIncidenteSheet(false)
    } catch (e: any) {
      toast.error(e.response?.data?.detail ?? 'Erro ao registrar.')
    } finally {
      setSalvando(false)
    }
  }

  return (
    <div className="flex flex-col min-h-screen">
      <SimplificaHeader title="Caixa" showBack />

      <main className="flex-1 p-4 grid grid-cols-2 gap-4 content-start">
        <SimplificaTile icon="🏷️" label="Mensalidades"       color={SECTOR_COLORS.caixa} onClick={() => setModal('mensalidades')} />
        <SimplificaTile icon="🏠" label="Comp. Residência"   color={SECTOR_COLORS.caixa} onClick={() => setModal('residencia')} />
        <SimplificaTile icon="➕" label="Outras Entradas"    color={SECTOR_COLORS.caixa} onClick={() => setModal('outras')} />
        <SimplificaTile icon="➖" label="Registrar Saída"    color={SECTOR_COLORS.caixa} onClick={() => setModal('sangria')} />
        <SimplificaTile icon="📊" label="Consultar Movim."  color={SECTOR_COLORS.caixa} onClick={() => setMovOpen(true)} />
        <SimplificaTile icon="⚠️" label="Informar Incidente" color={SECTOR_COLORS.caixa} onClick={() => setIncidenteSheet(true)} />
      </main>

      {/* Tela cheia: Movimentações */}
      {movOpen && <MovimentacoesTela onClose={() => setMovOpen(false)} />}

      {/* Modais existentes */}
      {modal === 'mensalidades' && (
        <Suspense fallback={null}>
          <TransactionModal initialTxType="income" initialSubtype="mensalidade"
            onClose={() => setModal(null)} onSuccess={() => setModal(null)} />
        </Suspense>
      )}
      {modal === 'residencia' && (
        <Suspense fallback={null}>
          <TransactionModal initialTxType="income" initialSubtype="proof_of_residence"
            onClose={() => setModal(null)} onSuccess={() => setModal(null)} />
        </Suspense>
      )}
      {modal === 'outras' && (
        <Suspense fallback={null}>
          <TransactionModal initialTxType="income" initialSubtype="other"
            onClose={() => setModal(null)} onSuccess={() => setModal(null)} />
        </Suspense>
      )}
      {modal === 'sangria' && (
        <SangriaModal
          onClose={() => setModal(null)}
          onSuccess={() => setModal(null)}
        />
      )}

      {/* Sheet: Informar Incidente */}
      <SimplificaBottomSheet
        open={incidenteSheet}
        title="Informar Incidente"
        onClose={() => setIncidenteSheet(false)}
      >
        <div className="flex flex-col gap-4">
          <textarea
            rows={4}
            placeholder="Descreva o incidente ocorrido…"
            value={incidente}
            onChange={e => setIncidente(e.target.value)}
            className="w-full border-2 border-gray-200 rounded-xl px-4 py-3 text-sm resize-none focus:outline-none focus:border-amber-400"
            autoFocus
          />
          <button
            onClick={handleIncidente}
            disabled={salvando || !incidente.trim()}
            className="w-full py-4 rounded-xl text-base font-bold text-white disabled:opacity-50 transition bg-amber-500"
          >
            {salvando ? 'Salvando…' : 'Registrar Incidente'}
          </button>
        </div>
      </SimplificaBottomSheet>
    </div>
  )
}
