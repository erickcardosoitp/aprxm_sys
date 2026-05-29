import { lazy, Suspense, useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { SimplificaHeader } from './components/SimplificaHeader'
import { SimplificaTile } from './components/SimplificaTile'
import { SimplificaBottomSheet } from './components/SimplificaBottomSheet'
import { SECTOR_COLORS } from './theme'
import { financeService } from '../../services/finance'
import { SangriaModal } from '../../components/finance/SangriaModal'
import type { Transaction } from '../../types'

const TransactionModal = lazy(() =>
  import('../../components/finance/TransactionModal').then(m => ({ default: m.TransactionModal }))
)

type ActiveModal = 'mensalidades' | 'residencia' | 'outras' | 'sangria' | null
type ActiveSheet = 'movimentacoes' | 'incidente' | null

const fmt = (v: string | number) =>
  parseFloat(String(v)).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const TYPE_LABELS: Record<string, string> = { income: 'Entrada', expense: 'Saída', sangria: 'Sangria' }
const TYPE_COLORS: Record<string, string> = {
  income: 'text-emerald-600',
  expense: 'text-red-500',
  sangria: 'text-amber-600',
}

export default function SimplificaCaixa() {
  const [modal, setModal] = useState<ActiveModal>(null)
  const [sheet, setSheet] = useState<ActiveSheet>(null)

  // Movimentações
  const [txs, setTxs] = useState<Transaction[]>([])
  const [loadingTxs, setLoadingTxs] = useState(false)

  // Incidente
  const [incidente, setIncidente] = useState('')
  const [salvando, setSalvando] = useState(false)

  const loadMovimentacoes = async () => {
    setLoadingTxs(true)
    try {
      const r = await financeService.listTransactions()
      setTxs(r.data)
    } catch {
      toast.error('Erro ao carregar movimentações.')
    } finally {
      setLoadingTxs(false)
    }
  }

  const handleOpenSheet = (s: ActiveSheet) => {
    setSheet(s)
    if (s === 'movimentacoes') loadMovimentacoes()
  }

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
      setSheet(null)
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
        <SimplificaTile icon="📊" label="Consultar Movim."  color={SECTOR_COLORS.caixa} onClick={() => handleOpenSheet('movimentacoes')} />
        <SimplificaTile icon="⚠️" label="Informar Incidente" color={SECTOR_COLORS.caixa} onClick={() => handleOpenSheet('incidente')} />
      </main>

      {/* Modais completos existentes — renderizados como overlay fixo */}
      {modal === 'mensalidades' && (
        <Suspense fallback={null}>
          <TransactionModal initialTxType="income" initialSubtype="mensalidade" initialStep={1}
            onClose={() => setModal(null)} onSuccess={() => setModal(null)} />
        </Suspense>
      )}
      {modal === 'residencia' && (
        <Suspense fallback={null}>
          <TransactionModal initialTxType="income" initialSubtype="proof_of_residence" initialStep={1}
            onClose={() => setModal(null)} onSuccess={() => setModal(null)} />
        </Suspense>
      )}
      {modal === 'outras' && (
        <Suspense fallback={null}>
          <TransactionModal initialTxType="income" initialSubtype="other" initialStep={1}
            onClose={() => setModal(null)} onSuccess={() => setModal(null)} />
        </Suspense>
      )}
      {modal === 'sangria' && (
        <SangriaModal
          onClose={() => setModal(null)}
          onSuccess={() => setModal(null)}
        />
      )}

      {/* Sheet: Consultar Movimentações */}
      <SimplificaBottomSheet
        open={sheet === 'movimentacoes'}
        title="Movimentações"
        onClose={() => setSheet(null)}
      >
        {loadingTxs ? (
          <div className="flex justify-center py-8">
            <div className="w-6 h-6 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: SECTOR_COLORS.caixa }} />
          </div>
        ) : txs.length === 0 ? (
          <p className="text-center text-gray-400 text-sm py-8">Nenhuma movimentação na sessão.</p>
        ) : (
          <div className="flex flex-col divide-y divide-gray-100">
            {txs.map(tx => (
              <div key={tx.id} className="flex items-center justify-between py-3 gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-800 truncate">{tx.description}</p>
                  <p className="text-xs text-gray-400">
                    {new Date(tx.transaction_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                    {' · '}
                    <span>{TYPE_LABELS[tx.type] ?? tx.type}</span>
                  </p>
                </div>
                <span className={`text-sm font-bold shrink-0 ${TYPE_COLORS[tx.type] ?? 'text-gray-700'}`}>
                  R$ {fmt(tx.amount)}
                </span>
              </div>
            ))}
          </div>
        )}
      </SimplificaBottomSheet>

      {/* Sheet: Informar Incidente */}
      <SimplificaBottomSheet
        open={sheet === 'incidente'}
        title="Informar Incidente"
        onClose={() => setSheet(null)}
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
