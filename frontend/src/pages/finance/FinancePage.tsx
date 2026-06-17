import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { AlertTriangle, ArrowDownLeft, ArrowLeftRight, Check, ClipboardCheck, DollarSign, FileText, List, Loader2, Pencil, Plus, RefreshCw, RotateCcw, Scale, TrendingDown, TrendingUp, X, XCircle } from 'lucide-react'
import toast from 'react-hot-toast'
import { CashSessionPanel } from '../../components/finance/CashSessionPanel'
import { SangriaModal } from '../../components/finance/SangriaModal'
const TransactionModal = lazy(() => import('../../components/finance/TransactionModal').then(m => ({ default: m.TransactionModal })))
import api from '../../services/api'
import { financeService } from '../../services/finance'
import { settingsService } from '../../services/settings'
import { useAuthStore } from '../../store/authStore'
import type { AssociationSettings, CashSession, CashSessionSummary, Transaction } from '../../types'

const TYPE_LABELS: Record<string, string> = { income: 'Entrada', expense: 'Saída', sangria: 'Sangria' }
const TYPE_COLORS: Record<string, string> = { income: 'text-green-600', expense: 'text-red-600', sangria: 'text-amber-600' }

const SUBTYPE_LABELS: Record<string, string> = {
  delivery_fee: 'Taxa de Entrega',
  mensalidade: 'Mensalidade',
  proof_of_residence: 'Comprovante',
  other: 'Outros',
}
const SUBTYPE_COLORS: Record<string, string> = {
  delivery_fee: 'bg-amber-100 text-amber-700',
  mensalidade: 'bg-blue-100 text-blue-700',
  proof_of_residence: 'bg-purple-100 text-purple-700',
  other: 'bg-gray-100 text-gray-600',
}

const parseTxName = (desc: string, subtype: string | null): string => {
  if (subtype && desc.includes(' — ')) return desc.split(' — ').slice(1).join(' — ')
  if (desc.startsWith('Estorno: ') && desc.includes(' — ')) {
    const rest = desc.replace('Estorno: ', '')
    if (rest.includes(' — ')) return 'Estorno: ' + rest.split(' — ').slice(1).join(' — ')
  }
  return desc
}


type Tab = 'caixa' | 'sessoes' | 'extrato' | 'relatorios'

interface ExtratoEntry {
  id: string; data: string; tipo: string; descricao: string; valor: string
  categoria?: string; metodo?: string; operador?: string; aprovacao?: string
}

interface EvolucaoEntry { mes: string; entradas: number; saidas: number }
interface FluxoEntry { resident_name: string; reference_month: string; due_date: string; amount: string }

// ── Session detail modal ──────────────────────────────────────────────────────

type SessionTx = {
  id: string; type: string; income_subtype: string | null; amount: string
  description: string; transaction_at: string; is_sangria: boolean
  created_by_name: string; conferido: boolean; observacao: string | null
  payment_method_id: string | null; payment_method_name: string | null
  reversed_at: string | null; resident_name: string | null
}

type PaymentMethodOption = { id: string; name: string }

function SessionDetailModal({
  session,
  onClose,
}: {
  session: CashSessionSummary
  onClose: () => void
}) {
  const role = useAuthStore((s) => s.role)
  const userId = useAuthStore((s) => s.userId)
  const isConferenteOrAbove = role === 'conferente' || role === 'admin' || role === 'superadmin' || role === 'diretoria' || role === 'conselho'
  const isAdminRole = role === 'admin' || role === 'superadmin' || role === 'diretoria' || role === 'conselho'
  const [transactions, setTransactions] = useState<SessionTx[]>([])
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethodOption[]>([])
  const [loading, setLoading] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editingTx, setEditingTx] = useState(false)
  const [saving, setSaving] = useState(false)
  const [savingTx, setSavingTx] = useState(false)
  const [editForm, setEditForm] = useState({
    closing_balance: session.closing_balance ?? '',
    manual_pix: session.total_pix ?? '',
    manual_dinheiro: session.total_dinheiro ?? '',
    manual_total_baixas: session.total_baixas ?? '',
  })
  const [txEdits, setTxEdits] = useState<Record<string, { payment_method_id: string; observacao: string }>>({})
  const [recalculating, setRecalculating] = useState(false)
  const [recalcResult, setRecalcResult] = useState<{ expected_balance: string; difference: string | null } | null>(null)
  const [subtypeFilter, setSubtypeFilter] = useState<string | null>(null)
  const [reassignTarget, setReassignTarget] = useState<SessionTx | null>(null)
  const [reassignSessions, setReassignSessions] = useState<CashSessionSummary[]>([])
  const [reassigning, setReassigning] = useState(false)
  const [reprinting, setReprinting] = useState<string | null>(null)

  const handleReprint = async (txId: string) => {
    setReprinting(txId)
    try {
      const res = await api.get(`/finance/proof-of-residence/${txId}/reprint`, { responseType: 'blob' })
      const url = URL.createObjectURL(res.data)
      const a = document.createElement('a'); a.href = url; a.download = 'comprovante_2via.pdf'; a.click()
      setTimeout(() => URL.revokeObjectURL(url), 10000)
    } catch (e: any) {
      toast.error(e.response?.data?.detail ?? 'Erro ao gerar 2ª via.')
    } finally { setReprinting(null) }
  }

  const openReassign = async (tx: SessionTx) => {
    setReassignTarget(tx)
    try {
      const res = await financeService.listSessions()
      setReassignSessions(res.data.filter(s => s.id !== session.id))
    } catch { setReassignSessions([]) }
  }

  const doReassign = async (newSessionId: string) => {
    if (!reassignTarget) return
    setReassigning(true)
    try {
      await api.patch(`/finance/transactions/${reassignTarget.id}/reassign`, { cash_session_id: newSessionId })
      toast.success('Transação redirecionada.')
      setReassignTarget(null)
      loadTx()
    } catch (e: any) {
      toast.error(e.response?.data?.detail ?? 'Erro ao redirecionar.')
    } finally { setReassigning(false) }
  }

  const fmtBRL = (v: string | undefined) => (v != null ? `R$ ${parseFloat(v).toFixed(2)}` : '—')
  const fmtDate = (s: string) =>
    new Date(s).toLocaleDateString('pt-BR', {
      day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit',
    })

  const loadTx = async () => {
    setLoading(true)
    try {
      const [txRes, pmRes] = await Promise.all([
        api.get<SessionTx[]>(`/finance/sessions/${session.id}/transactions`),
        api.get<PaymentMethodOption[]>('/finance/payment-methods'),
      ])
      setTransactions(txRes.data)
      setPaymentMethods(pmRes.data)
      const initial: Record<string, { payment_method_id: string; observacao: string }> = {}
      txRes.data.forEach(tx => {
        initial[tx.id] = { payment_method_id: tx.payment_method_id ?? '', observacao: tx.observacao ?? '' }
      })
      setTxEdits(initial)
    } catch { setTransactions([]) } finally { setLoading(false) }
  }

  useEffect(() => { loadTx() }, [session.id])

  const handleSaveEdit = async () => {
    setSaving(true)
    try {
      await api.patch(`/finance/sessions/${session.id}`, {
        closing_balance: editForm.closing_balance ? parseFloat(editForm.closing_balance) : undefined,
        manual_pix: editForm.manual_pix ? parseFloat(editForm.manual_pix) : undefined,
        manual_dinheiro: editForm.manual_dinheiro ? parseFloat(editForm.manual_dinheiro) : undefined,
        manual_total_baixas: editForm.manual_total_baixas ? parseFloat(editForm.manual_total_baixas) : undefined,
      })
      toast.success('Valores atualizados.')
      setEditing(false)
    } catch { toast.error('Erro ao salvar.') } finally { setSaving(false) }
  }

  const handleSaveTxEdits = async () => {
    setSavingTx(true)
    try {
      const changed = transactions.filter(tx => {
        const edit = txEdits[tx.id]
        return edit && (
          (edit.payment_method_id || '') !== (tx.payment_method_id ?? '') ||
          (edit.observacao || '') !== (tx.observacao ?? '')
        )
      })
      await Promise.all(changed.map(tx =>
        api.patch(`/finance/transactions/${tx.id}/payment-method`, {
          payment_method_id: txEdits[tx.id].payment_method_id || null,
          cash_session_id: session.id,
          observacao: txEdits[tx.id].observacao || null,
          reviewed_by_id: userId || null,
        })
      ))
      toast.success('Movimentações corrigidas.')
      setEditingTx(false)
      loadTx()
    } catch { toast.error('Erro ao salvar correções.') } finally { setSavingTx(false) }
  }

  const handleRecalculate = async () => {
    setRecalculating(true)
    try {
      const res = await api.post<{ expected_balance: string; difference: string | null }>(
        `/finance/sessions/${session.id}/recalculate`
      )
      setRecalcResult(res.data)
      toast.success('Quebra de caixa recalculada.')
    } catch { toast.error('Erro ao recalcular.') } finally { setRecalculating(false) }
  }

  const diff = recalcResult?.difference != null
    ? parseFloat(recalcResult.difference)
    : session.difference ? parseFloat(session.difference) : null

  return (
    <>
    {reassignTarget && (
      <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
        <div className="w-full max-w-sm bg-white rounded-2xl shadow-2xl overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
            <h2 className="font-bold text-gray-900 text-sm">Redirecionar Transação</h2>
            <button onClick={() => setReassignTarget(null)} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
          </div>
          <div className="px-5 py-4 flex flex-col gap-2">
            <p className="text-xs text-gray-500 mb-1">Selecione a nova sessão de caixa:</p>
            {reassignSessions.length === 0 ? (
              <p className="text-xs text-gray-400">Nenhuma outra sessão disponível.</p>
            ) : reassignSessions.map(s => (
              <button key={s.id} onClick={() => doReassign(s.id)} disabled={reassigning}
                className="flex items-center gap-3 px-4 py-3 rounded-xl border border-gray-200 hover:bg-blue-50 hover:border-[#26619c] transition text-left w-full">
                <ArrowLeftRight className="w-4 h-4 text-gray-400 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-800">{s.operador_name ?? '—'}</p>
                  <p className="text-xs text-gray-400">{new Date(s.opened_at).toLocaleString('pt-BR')} · {s.status}</p>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    )}
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg bg-white rounded-2xl shadow-2xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 shrink-0">
          <h2 className="font-bold text-gray-900">Detalhe da Sessão</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Summary */}
        <div className="px-6 py-4 bg-gray-50 border-b border-gray-100 shrink-0">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <p className="text-xs text-gray-400">Abertura</p>
              <p className="font-medium text-gray-800">{fmtDate(session.opened_at)}</p>
            </div>
            {session.closed_at && (
              <div>
                <p className="text-xs text-gray-400">Fechamento</p>
                <p className="font-medium text-gray-800">{fmtDate(session.closed_at)}</p>
              </div>
            )}
            <div>
              <p className="text-xs text-gray-400">Saldo de abertura</p>
              <p className="font-semibold text-gray-800">{fmtBRL(session.opening_balance)}</p>
            </div>
            {session.closing_balance && (
              <div>
                <p className="text-xs text-gray-400">Saldo de fechamento</p>
                <p className="font-semibold text-gray-800">{fmtBRL(session.closing_balance)}</p>
              </div>
            )}
            {(recalcResult?.expected_balance || session.expected_balance) && (
              <div>
                <p className="text-xs text-gray-400">Saldo esperado{recalcResult ? ' (recalculado)' : ''}</p>
                <p className="font-semibold text-gray-800">{fmtBRL(recalcResult?.expected_balance ?? session.expected_balance)}</p>
              </div>
            )}
            {diff !== null && (
              <div>
                <p className="text-xs text-gray-400">Diferença</p>
                <p className={`font-semibold ${diff >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {diff >= 0 ? '+' : ''}R$ {Math.abs(diff).toFixed(2)}
                </p>
              </div>
            )}
          </div>
          <div className="mt-2">
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
              session.status === 'open' ? 'bg-green-100 text-green-700'
              : session.status === 'conferido' ? 'bg-blue-100 text-blue-700'
              : session.status === 'cancelled' ? 'bg-red-100 text-red-700'
              : 'bg-gray-100 text-gray-600'
            }`}>
              {session.status === 'open' ? 'Aberta'
               : session.status === 'conferido' ? 'Conferido'
               : session.status === 'cancelled' ? 'Cancelado'
               : 'Fechado'}
            </span>
          </div>
        </div>

        {/* Edit session values form */}
        {editing && isConferenteOrAbove && (
          <div className="px-6 py-4 bg-blue-50 border-b border-blue-100 shrink-0">
            <p className="text-xs font-semibold text-blue-700 mb-3">Corrigir valores da sessão</p>
            <div className="grid grid-cols-2 gap-3">
              {[
                ['Conf. Cega (R$)', 'closing_balance'],
                ['Total PIX (R$)', 'manual_pix'],
                ['Total Dinheiro (R$)', 'manual_dinheiro'],
                ['Total Baixas (R$)', 'manual_total_baixas'],
              ].map(([label, key]) => (
                <div key={key}>
                  <label className="text-xs text-gray-500 mb-0.5 block">{label}</label>
                  <input type="number" step="0.01" min="0"
                    value={editForm[key as keyof typeof editForm]}
                    onChange={e => setEditForm(f => ({ ...f, [key]: e.target.value }))}
                    className="w-full border border-blue-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300" />
                </div>
              ))}
            </div>
            <div className="flex gap-2 mt-3">
              <button onClick={() => setEditing(false)}
                className="flex-1 border border-gray-300 text-gray-600 py-2 rounded-xl text-sm">
                Cancelar
              </button>
              <button onClick={handleSaveEdit} disabled={saving}
                className="flex-1 bg-[#26619c] text-white py-2 rounded-xl text-sm font-semibold disabled:opacity-50">
                {saving ? 'Salvando…' : 'Salvar'}
              </button>
            </div>
          </div>
        )}

        {/* Transactions */}
        <div className="flex-1 overflow-y-auto">
          <div className="px-6 py-3 border-b border-gray-100 flex items-center justify-between">
            <h3 className="font-semibold text-gray-800 text-sm">Movimentações</h3>
            {isConferenteOrAbove && !editing && (
              editingTx ? (
                <div className="flex gap-2">
                  <button onClick={() => setEditingTx(false)}
                    className="text-xs border border-gray-300 text-gray-600 px-3 py-1 rounded-lg">
                    Cancelar
                  </button>
                  <button onClick={handleSaveTxEdits} disabled={savingTx}
                    className="text-xs bg-[#26619c] text-white px-3 py-1 rounded-lg disabled:opacity-50">
                    {savingTx ? 'Salvando…' : 'Salvar'}
                  </button>
                </div>
              ) : (
                <button onClick={() => setEditingTx(true)}
                  className="text-xs border border-[#26619c] text-[#26619c] px-3 py-1 rounded-lg hover:bg-blue-50">
                  Corrigir Movimentações
                </button>
              )
            )}
          </div>
          {/* Subtype filter pills */}
          {!loading && transactions.length > 0 && (
            <div className="px-6 py-2 border-b border-gray-100 flex gap-1.5 flex-wrap">
              <button onClick={() => setSubtypeFilter(null)}
                className={`text-xs px-2.5 py-1 rounded-full font-medium transition ${subtypeFilter === null ? 'bg-[#26619c] text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                Todos
              </button>
              {Object.entries(SUBTYPE_LABELS).map(([key, label]) =>
                transactions.some(t => t.income_subtype === key) && (
                  <button key={key} onClick={() => setSubtypeFilter(f => f === key ? null : key)}
                    className={`text-xs px-2.5 py-1 rounded-full font-medium transition ${subtypeFilter === key ? SUBTYPE_COLORS[key] + ' ring-2 ring-offset-1 ring-current' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                    {label}
                  </button>
                )
              )}
            </div>
          )}
          {loading ? (
            <div className="p-6 text-center text-gray-400 text-sm">Carregando…</div>
          ) : transactions.length === 0 ? (
            <div className="p-6 text-center text-gray-400 text-sm">Nenhuma movimentação registrada.</div>
          ) : (
            <ul className="divide-y divide-gray-100">
              {transactions
                .filter(tx => subtypeFilter === null || tx.income_subtype === subtypeFilter)
                .map(tx => (
                <li key={tx.id} className="px-6 py-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap mb-0.5">
                        {tx.income_subtype && (
                          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${SUBTYPE_COLORS[tx.income_subtype] ?? 'bg-gray-100 text-gray-600'}`}>
                            {SUBTYPE_LABELS[tx.income_subtype] ?? tx.income_subtype}
                          </span>
                        )}
                        {!tx.income_subtype && (
                          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${TYPE_COLORS[tx.type]} bg-opacity-10`}>{TYPE_LABELS[tx.type]}</span>
                        )}
                        {tx.payment_method_name && !editingTx && (
                          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-600">{tx.payment_method_name}</span>
                        )}
                      </div>
                      <p className="text-sm font-medium text-gray-800">{parseTxName(tx.description, tx.income_subtype ?? null)}</p>
                      <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                        <span className="text-xs text-gray-400">{new Date(tx.transaction_at).toLocaleString('pt-BR')}</span>
                      </div>
                      {tx.observacao && !editingTx && (
                        <p className="text-xs text-amber-600 mt-0.5">Obs: {tx.observacao}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className={`text-sm font-semibold ${tx.type === 'income' ? 'text-green-600' : 'text-red-600'}`}>
                        {tx.type === 'income' ? '+' : '-'} R$ {parseFloat(tx.amount).toFixed(2)}
                      </span>
                      {tx.income_subtype === 'proof_of_residence' && !tx.reversed_at && (
                        <button onClick={() => handleReprint(tx.id)} disabled={reprinting === tx.id}
                          title="2ª via" className="text-gray-300 hover:text-purple-600 transition disabled:opacity-40">
                          <FileText className="w-3.5 h-3.5" />
                        </button>
                      )}
                      {isAdminRole && !tx.reversed_at && (
                        <button onClick={() => openReassign(tx)} title="Redirecionar sessão"
                          className="text-gray-300 hover:text-[#26619c] transition">
                          <ArrowLeftRight className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                  {editingTx && paymentMethods.length > 0 && (
                    <div className="mt-2 flex flex-col gap-1.5">
                      <select
                        value={txEdits[tx.id]?.payment_method_id ?? ''}
                        onChange={e => setTxEdits(prev => ({ ...prev, [tx.id]: { ...prev[tx.id], payment_method_id: e.target.value } }))}
                        className="w-full border border-gray-300 rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-[#26619c]/30">
                        <option value="">— Forma de pagamento —</option>
                        {paymentMethods.map(pm => (
                          <option key={pm.id} value={pm.id}>{pm.name}</option>
                        ))}
                      </select>
                      <input
                        type="text"
                        placeholder="Observação (opcional)"
                        value={txEdits[tx.id]?.observacao ?? ''}
                        onChange={e => setTxEdits(prev => ({ ...prev, [tx.id]: { ...prev[tx.id], observacao: e.target.value } }))}
                        className="w-full border border-gray-300 rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-[#26619c]/30" />
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Footer */}
        <div className="flex gap-3 px-6 py-4 border-t border-gray-100 shrink-0">
          <button onClick={onClose}
            className="flex-1 border border-gray-300 text-gray-600 py-2.5 rounded-xl text-sm hover:bg-gray-50 transition">
            Fechar
          </button>
          {isConferenteOrAbove && session.status !== 'open' && !editingTx && !editing && (
            <>
              <button onClick={() => setEditing(true)}
                className="flex-1 flex items-center justify-center gap-2 border border-[#26619c] text-[#26619c] py-2.5 rounded-xl text-sm font-semibold hover:bg-blue-50 transition">
                Corrigir Valores
              </button>
              <button onClick={handleRecalculate} disabled={recalculating}
                className="flex-1 flex items-center justify-center gap-2 bg-amber-500 text-white py-2.5 rounded-xl text-sm font-semibold hover:bg-amber-600 transition disabled:opacity-50">
                {recalculating ? 'Calculando…' : 'Recalcular Quebra'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
    </>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function FinancePage() {
  const role = useAuthStore((s) => s.role)
  const canSeeTotals = role !== 'operator' && role !== 'viewer'
  const isConferenteOrAbove = role === 'conferente' || role === 'admin' || role === 'superadmin' || role === 'diretoria' || role === 'conselho'
  const isAdminRole = role === 'admin' || role === 'superadmin' || role === 'diretoria' || role === 'conselho'

  const [tab, setTab] = useState<Tab>('caixa')
  const [session, setSession] = useState<CashSession | null>(null)
  const [openSessions, setOpenSessions] = useState<{ id: string; opened_by_name: string; opening_balance: string }[]>([])
  const [viewedSessionId, setViewedSessionId] = useState<string | null>(null)
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const latestTxSidRef = useRef<string | null>(null)
  const [showSangria, setShowSangria] = useState(false)
  const [showTransaction, setShowTransaction] = useState(false)
  const [loadingTx, setLoadingTx] = useState(false)
  const [sessions, setSessions] = useState<CashSessionSummary[]>([])
  const [loadingSessions, setLoadingSessions] = useState(false)
  const [recalcingRow, setRecalcingRow] = useState<string | null>(null)
  const [settings, setSettings] = useState<AssociationSettings | null>(null)
  const [selectedSession, setSelectedSession] = useState<CashSessionSummary | null>(null)
const [showOfflineExpense, setShowOfflineExpense] = useState(false)
  const [offlineType, setOfflineType] = useState<'expense' | 'income'>('expense')
  const [offlinePaymentStatus, setOfflinePaymentStatus] = useState<'paid' | 'pending'>('paid')
  const [offlineForm, setOfflineForm] = useState({ description: '', amount: '', category_id: '' })
  const [offlineCategories, setOfflineCategories] = useState<{ id: string; name: string }[]>([])
  const [offlinePayMethods, setOfflinePayMethods] = useState<{ id: string; name: string }[]>([])
  const [offlineResidentQuery, setOfflineResidentQuery] = useState('')
  const [offlineResidentResults, setOfflineResidentResults] = useState<{ id: string; full_name: string; cpf?: string; phone_primary?: string }[]>([])
  const [offlineResident, setOfflineResident] = useState<{ id: string; full_name: string } | null>(null)
  const [offlineSubtype, setOfflineSubtype] = useState('mensalidade')
  const [offlinePaymentMethodId, setOfflinePaymentMethodId] = useState('')
  const [savingOffline, setSavingOffline] = useState(false)

  // ── Transfer conferido → caixinha state ──
  const [transferSession, setTransferSession] = useState<CashSessionSummary | null>(null)
  const [transferBoxId, setTransferBoxId] = useState('')
  const [transferAmount, setTransferAmount] = useState('')
  const [transferLoading, setTransferLoading] = useState(false)
  const [cashBoxes, setCashBoxes] = useState<{ id: string; name: string; balance: string }[]>([])

  // ── Admin close other session ──
  const [adminCloseTarget, setAdminCloseTarget] = useState<{ id: string; name: string } | null>(null)
  const [adminCloseBalance, setAdminCloseBalance] = useState('')
  const [adminClosing, setAdminClosing] = useState(false)

  const handleAdminClose = async () => {
    if (!adminCloseTarget) return
    const bal = parseFloat(adminCloseBalance)
    if (isNaN(bal)) { toast.error('Valor inválido.'); return }
    setAdminClosing(true)
    try {
      await financeService.closeSession(bal, undefined, adminCloseTarget.id)
      toast.success(`Caixa de ${adminCloseTarget.name} fechado.`)
      setAdminCloseTarget(null)
      setAdminCloseBalance('')
      loadSession()
    } catch (e: any) {
      toast.error(e.response?.data?.detail ?? 'Erro ao fechar caixa.')
    } finally { setAdminClosing(false) }
  }

  // ── Estorno state ──
  const [estornoTarget, setEstornoTarget] = useState<Transaction | null>(null)
  const [estornoReason, setEstornoReason] = useState('')
  const [estornoPassword, setEstornoPassword] = useState('')
  const [savingEstorno, setSavingEstorno] = useState(false)

  // ── Inline payment method edit ──
  const [editingPayMethodTx, setEditingPayMethodTx] = useState<string | null>(null)
  const [payMethodEdit, setPayMethodEdit] = useState<string>('')
  const [savingPayMethod, setSavingPayMethod] = useState(false)

  // ── Extrato state ──
  const today = new Date().toISOString().slice(0, 10)
  const firstOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10)
  const [extratoFrom, setExtratoFrom] = useState(firstOfMonth)
  const [extratoTo, setExtratoTo] = useState(today)
  const [extrato, setExtrato] = useState<ExtratoEntry[]>([])
  const [loadingExtrato, setLoadingExtrato] = useState(false)

  // ── Relatórios state ──
  const [evolucao, setEvolucao] = useState<EvolucaoEntry[]>([])
  const [fluxo, setFluxo] = useState<FluxoEntry[]>([])
  const [loadingRel, setLoadingRel] = useState(false)


  const loadSession = async () => {
    try {
      const res = await financeService.getCurrentSession()
      setSession(res.data)
      if (isConferenteOrAbove) {
        const sessRes = await financeService.listOpenSessions()
        setOpenSessions(sessRes.data)
        if (!viewedSessionId) setViewedSessionId(res.data.id)
      }
    }
    catch { setSession(null) }
  }

  const loadTransactions = async () => {
    const sid = viewedSessionId ?? session?.id
    if (!sid) return
    latestTxSidRef.current = sid
    setLoadingTx(true)
    try {
      const res = await financeService.listTransactions(sid)
      if (latestTxSidRef.current === sid) setTransactions(res.data)
    }
    catch { toast.error('Erro ao carregar transações.') }
    finally { setLoadingTx(false) }
  }

  const savePayMethod = async (txId: string) => {
    setSavingPayMethod(true)
    try {
      await api.patch(`/finance/transactions/${txId}/payment-method`, {
        payment_method_id: payMethodEdit || null,
        cash_session_id: viewedSessionId ?? session?.id,
      })
      toast.success('Forma de pagamento atualizada.')
      setEditingPayMethodTx(null)
      loadTransactions()
    } catch (e: any) {
      toast.error(e.response?.data?.detail ?? 'Erro ao salvar.')
    } finally { setSavingPayMethod(false) }
  }

const loadSessions = async () => {
    setLoadingSessions(true)
    try {
      const [sessRes, boxRes] = await Promise.all([
        financeService.listSessions(),
        api.get<{ id: string; name: string; balance: string }[]>('/cash-boxes'),
      ])
      setSessions(sessRes.data)
      setCashBoxes(boxRes.data)
    } catch { toast.error('Erro ao carregar sessões.') }
    finally { setLoadingSessions(false) }
  }

  const handleTransfer = async () => {
    if (!transferSession || !transferBoxId || !transferAmount) return
    setTransferLoading(true)
    try {
      await api.post(`/finance/sessions/${transferSession.id}/transfer-to-cashbox`, {
        cash_box_id: transferBoxId,
        amount: parseFloat(transferAmount),
      })
      toast.success('Valor transferido — sangria registrada no caixa e saldo creditado na caixinha!')
      setTransferSession(null)
      setTransferBoxId('')
      setTransferAmount('')
      loadSessions()
    } catch (e: any) {
      toast.error(e.response?.data?.detail ?? 'Erro ao transferir.')
    } finally {
      setTransferLoading(false)
    }
  }

  const loadExtrato = async () => {
    setLoadingExtrato(true)
    try {
      const res = await api.get<ExtratoEntry[]>('/financeiro/extrato', { params: { date_from: extratoFrom, date_to: extratoTo } })
      setExtrato(res.data)
    } catch { toast.error('Erro ao carregar extrato.') }
    finally { setLoadingExtrato(false) }
  }


  const loadRelatorios = async () => {
    setLoadingRel(true)
    try {
      const [evRes, flRes] = await Promise.all([
        api.get<EvolucaoEntry[]>('/financeiro/evolucao'),
        api.get<FluxoEntry[]>('/financeiro/fluxo-projetado'),
      ])
      setEvolucao(evRes.data)
      setFluxo(flRes.data)
    } catch { /* silent */ }
    finally { setLoadingRel(false) }
  }

  useEffect(() => {
    loadSession()
    api.get<{ id: string; name: string }[]>('/finance/categories', { params: { type: 'expense' } })
      .then(r => setOfflineCategories(r.data)).catch(() => {})
    api.get<{ id: string; name: string }[]>('/finance/payment-methods')
      .then(r => setOfflinePayMethods(r.data)).catch(() => {})
  }, [])
  useEffect(() => { loadTransactions() }, [session?.id, viewedSessionId])
  useEffect(() => { if (tab === 'sessoes') loadSessions() }, [tab])
  useEffect(() => { if (tab === 'extrato') loadExtrato() }, [tab])
  useEffect(() => { if (tab === 'relatorios') loadRelatorios() }, [tab])

  useEffect(() => {
    if (canSeeTotals) settingsService.get().then(r => setSettings(r.data)).catch(() => {})
  }, [canSeeTotals])
const todayLabel = new Date().toLocaleDateString('pt-BR')
  const activeTxs = transactions.filter(t => !t.reversed_at && !t.is_reversal)
  const todayTxs = activeTxs.filter(t => new Date(t.transaction_at).toLocaleDateString('pt-BR') === todayLabel)
  const income = todayTxs.filter(t => t.type === 'income').reduce((s, t) => s + parseFloat(t.amount), 0)
  const expenses = todayTxs.filter(t => t.type !== 'income').reduce((s, t) => s + parseFloat(t.amount), 0)
  const sessionIncome = income
  const sessionExpenses = expenses
  const viewedOpeningBalance = viewedSessionId && viewedSessionId !== session?.id
    ? parseFloat(openSessions.find(s => s.id === viewedSessionId)?.opening_balance ?? '0')
    : (session ? parseFloat(session.opening_balance) : 0)
  const currentBalance = (session || viewedSessionId) ? viewedOpeningBalance + sessionIncome - sessionExpenses : 0

  // Payment method breakdown (income only, today)
  const pmBreakdown = todayTxs
    .filter(t => t.type === 'income')
    .reduce<Record<string, number>>((acc, t) => {
      const key = t.payment_method_name ?? 'Sem forma'
      acc[key] = (acc[key] ?? 0) + parseFloat(t.amount)
      return acc
    }, {})
  const maxCash = settings ? parseFloat(settings.max_cash_before_sangria) : null
  const sangriaAlert = canSeeTotals && maxCash !== null && currentBalance > maxCash

  const searchOfflineResident = async (q: string) => {
    setOfflineResidentQuery(q)
    setOfflineResident(null)
    if (q.length < 2) { setOfflineResidentResults([]); return }
    try {
      const r = await api.get<{ id: string; full_name: string; cpf?: string; phone_primary?: string }[]>('/residents/search', { params: { q } })
      setOfflineResidentResults(r.data.slice(0, 6))
    } catch { setOfflineResidentResults([]) }
  }

  const handleOfflineExpense = async () => {
    const amt = parseFloat(offlineForm.amount)
    if (!amt || amt <= 0) { toast.error('Valor inválido.'); return }
    if (offlineType === 'expense' && !offlineForm.description.trim()) { toast.error('Informe a descrição.'); return }
    setSavingOffline(true)
    try {
      const desc = offlineType === 'income'
        ? `${offlineSubtype === 'mensalidade' ? 'Mensalidade' : offlineSubtype}${offlineResident ? ` — ${offlineResident.full_name}` : ''}`
        : offlineForm.description
      await api.post('/finance/transactions/offline', {
        type: offlineType,
        amount: amt,
        description: desc,
        category_id: offlineForm.category_id || null,
        resident_id: offlineResident?.id || null,
        income_subtype: offlineType === 'income' ? offlineSubtype : undefined,
        payment_method_id: offlinePaymentMethodId || null,
        payment_status: offlinePaymentStatus,
      })
      toast.success(offlineType === 'income' ? 'Entrada registrada (sem caixa)!' : 'Saída externa registrada!')
      setShowOfflineExpense(false)
      setOfflineForm({ description: '', amount: '', category_id: '' })
      setOfflineResident(null)
      setOfflineResidentQuery('')
      setOfflineResidentResults([])
      setOfflinePaymentMethodId('')
      setOfflinePaymentStatus('paid')
    } catch (e: any) {
      toast.error(e.response?.data?.detail ?? 'Erro ao registrar.')
    } finally {
      setSavingOffline(false)
    }
  }

  const handleEstorno = async () => {
    if (!estornoTarget) return
    if (!estornoReason.trim() || estornoReason.trim().length < 5) { toast.error('Motivo deve ter ao menos 5 caracteres.'); return }
    if (!estornoPassword.trim()) { toast.error('Senha obrigatória.'); return }
    setSavingEstorno(true)
    try {
      await api.post(`/finance/transactions/${estornoTarget.id}/reverse`, {
        reason: estornoReason.trim(),
        admin_password: estornoPassword,
      })
      toast.success('Estorno registrado com sucesso!')
      setEstornoTarget(null)
      setEstornoReason('')
      setEstornoPassword('')
      loadTransactions()
    } catch (e: any) {
      toast.error(e.response?.data?.detail ?? 'Erro ao estornar.')
    } finally {
      setSavingEstorno(false)
    }
  }

  const fmtBRL = (v: string | undefined) => v != null ? `R$ ${parseFloat(v).toFixed(2)}` : '—'
  const fmtDate = (s: string) => new Date(s).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })

  return (
    <div className="flex flex-col gap-6 p-4 sm:p-6 max-w-screen-xl mx-auto w-full">
      <h1 className="text-2xl font-bold text-gray-900">Operação de Caixa</h1>

      {/* ── Modal Estorno ── */}
      {estornoTarget && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-black/50">
          <div className="flex min-h-full items-center justify-center p-4">
            <div className="w-full max-w-sm bg-white rounded-2xl shadow-2xl overflow-hidden">
              <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
                <div className="flex items-center gap-2">
                  <RotateCcw className="w-4 h-4 text-orange-500" />
                  <h2 className="font-bold text-gray-900 text-sm">Estorno de Transação</h2>
                </div>
                <button onClick={() => { setEstornoTarget(null); setEstornoReason(''); setEstornoPassword('') }}>
                  <X className="w-5 h-5 text-gray-400" />
                </button>
              </div>
              <div className="px-5 py-4 flex flex-col gap-4">
                <div className="bg-orange-50 border border-orange-200 rounded-xl px-4 py-3">
                  <p className="text-xs text-orange-700 font-medium mb-1">{estornoTarget.description}</p>
                  <p className="text-sm font-bold text-orange-800">
                    {estornoTarget.type === 'income' ? '+' : '-'} R$ {parseFloat(estornoTarget.amount).toFixed(2)}
                  </p>
                  <p className="text-xs text-orange-600 mt-0.5">
                    {new Date(estornoTarget.transaction_at).toLocaleString('pt-BR')}
                  </p>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Motivo do estorno <span className="text-red-500">*</span></label>
                  <textarea rows={2} value={estornoReason} onChange={e => setEstornoReason(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-orange-400/40 focus:border-orange-400"
                    placeholder="Descreva o motivo do estorno (mín. 5 caracteres)…" autoFocus />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Senha do administrador <span className="text-red-500">*</span></label>
                  <input type="password" value={estornoPassword} onChange={e => setEstornoPassword(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') handleEstorno() }}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400/40 focus:border-orange-400"
                    placeholder="Sua senha de acesso" />
                </div>
              </div>
              <div className="flex gap-3 px-5 pb-5">
                <button onClick={() => { setEstornoTarget(null); setEstornoReason(''); setEstornoPassword('') }}
                  className="flex-1 border border-gray-300 text-gray-600 py-2.5 rounded-xl text-sm hover:bg-gray-50">Cancelar</button>
                <button onClick={handleEstorno} disabled={savingEstorno || !estornoReason.trim() || !estornoPassword}
                  className="flex-1 bg-orange-500 hover:bg-orange-600 text-white py-2.5 rounded-xl text-sm font-semibold transition disabled:opacity-50">
                  {savingEstorno ? 'Estornando…' : 'Confirmar Estorno'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal Saída Externa ── */}
      {showOfflineExpense && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm bg-white rounded-2xl shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <h2 className="font-bold text-gray-900 text-sm">Lançamento sem caixa</h2>
              <button onClick={() => setShowOfflineExpense(false)}><X className="w-5 h-5 text-gray-400" /></button>
            </div>
            <div className="px-5 py-4 flex flex-col gap-3">
              <p className="text-xs text-gray-400">Não afeta saldo de sessão de caixa.</p>

              {/* Tipo */}
              <div className="grid grid-cols-2 gap-2">
                {(['income', 'expense'] as const).map(t => (
                  <button key={t} type="button" onClick={() => setOfflineType(t)}
                    className={`py-2.5 rounded-xl text-sm font-semibold border-2 transition ${
                      offlineType === t
                        ? t === 'income' ? 'border-green-500 bg-green-50 text-green-700' : 'border-red-500 bg-red-50 text-red-700'
                        : 'border-gray-200 text-gray-400 hover:border-gray-300'
                    }`}>
                    {t === 'income' ? '↑ Entrada' : '↓ Saída'}
                  </button>
                ))}
              </div>

              {offlineType === 'income' ? (
                <>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Tipo de entrada</label>
                    <select value={offlineSubtype} onChange={e => setOfflineSubtype(e.target.value)}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#26619c]/40">
                      <option value="mensalidade">Mensalidade</option>
                      <option value="delivery_fee">Taxa de Entrega</option>
                      <option value="other">Doação / Outro</option>
                    </select>
                  </div>
                  <div className="relative">
                    <label className="block text-xs font-medium text-gray-600 mb-1">Morador (opcional)</label>
                    <input value={offlineResidentQuery} onChange={e => searchOfflineResident(e.target.value)}
                      placeholder="Nome, CPF ou telefone…"
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#26619c]/40" />
                    {offlineResidentResults.length > 0 && !offlineResident && (
                      <div className="absolute z-10 left-0 right-0 top-full mt-1 bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden">
                        {offlineResidentResults.map(r => (
                          <button key={r.id} type="button"
                            onClick={() => { setOfflineResident(r); setOfflineResidentQuery(r.full_name); setOfflineResidentResults([]) }}
                            className="w-full text-left px-4 py-2.5 hover:bg-blue-50 border-b border-gray-50 last:border-0">
                            <p className="text-sm font-medium text-gray-800">{r.full_name}</p>
                            <p className="text-xs text-gray-400">{r.cpf ?? r.phone_primary ?? ''}</p>
                          </button>
                        ))}
                      </div>
                    )}
                    {offlineResident && <p className="text-xs text-green-600 mt-1">✓ {offlineResident.full_name}</p>}
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Descrição</label>
                    <input value={offlineForm.description} onChange={e => setOfflineForm(f => ({ ...f, description: e.target.value }))}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#26619c]/40"
                      placeholder="Ex: Conta de luz, aluguel…" />
                  </div>
                  {offlineCategories.length > 0 && (
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Categoria</label>
                      <select value={offlineForm.category_id} onChange={e => setOfflineForm(f => ({ ...f, category_id: e.target.value }))}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#26619c]/40">
                        <option value="">— Sem categoria —</option>
                        {offlineCategories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                    </div>
                  )}
                </>
              )}

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Valor (R$)</label>
                <input type="number" min="0.01" step="0.01" value={offlineForm.amount}
                  onChange={e => setOfflineForm(f => ({ ...f, amount: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#26619c]/40" />
              </div>

              {offlinePayMethods.length > 0 && (
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1.5">Forma de pagamento</label>
                  <div className="flex flex-wrap gap-1.5">
                    {offlinePayMethods.map(m => (
                      <button key={m.id} type="button"
                        onClick={() => setOfflinePaymentMethodId(id => id === m.id ? '' : m.id)}
                        className={`px-3 py-1.5 rounded-full text-xs font-medium border transition ${offlinePaymentMethodId === m.id ? 'bg-[#26619c] text-white border-[#26619c]' : 'border-gray-300 text-gray-600 hover:border-[#26619c]'}`}>
                        {m.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
            {/* Status do pagamento */}
            <div className="px-5 pb-3">
              <p className="text-xs font-medium text-gray-600 mb-2">Status do pagamento</p>
              <div className="flex gap-2">
                {(['paid', 'pending'] as const).map(s => (
                  <button key={s} type="button" onClick={() => setOfflinePaymentStatus(s)}
                    className={`flex-1 py-2 rounded-xl text-sm font-medium border transition ${offlinePaymentStatus === s
                      ? s === 'paid' ? 'bg-green-600 text-white border-green-600' : 'bg-amber-500 text-white border-amber-500'
                      : 'border-gray-200 text-gray-600 hover:border-gray-300'}`}>
                    {s === 'paid' ? '✓ Pago' : '⏳ Pendente'}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex gap-3 px-5 pb-5">
              <button onClick={() => setShowOfflineExpense(false)}
                className="flex-1 border border-gray-300 text-gray-600 py-2.5 rounded-xl text-sm hover:bg-gray-50">Cancelar</button>
              <button onClick={handleOfflineExpense} disabled={savingOffline}
                className={`flex-1 text-white py-2.5 rounded-xl text-sm font-semibold transition disabled:opacity-50 ${offlineType === 'income' ? 'bg-green-600 hover:bg-green-700' : 'bg-red-600 hover:bg-red-700'}`}>
                {savingOffline ? 'Salvando…' : offlineType === 'income' ? 'Registrar Entrada' : 'Registrar Saída'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Tabs — operators only see Frente de Caixa */}
      {isConferenteOrAbove && (
        <div className="flex border-b border-gray-200">
          {([['caixa', 'Frente de Caixa'], ['sessoes', 'Sessões'], ['extrato', 'Extrato'], ['relatorios', 'Relatórios']] as [Tab, string][]).map(([t, label]) => (
            <button key={t} onClick={() => setTab(t)}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition -mb-px ${tab === t ? 'border-[#26619c] text-[#26619c]' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
              {t === 'sessoes' && <List className="w-4 h-4" />}
              {label}
            </button>
          ))}
        </div>
      )}

      {/* ── TAB: CAIXA ── */}
      {tab === 'caixa' && (
        <>
          {/* Admin session selector */}
          {isConferenteOrAbove && openSessions.length > 1 && (
            <div className="flex gap-2 flex-wrap">
              {openSessions.map(s => (
                <div key={s.id} className="flex items-center gap-1">
                  <button onClick={() => setViewedSessionId(s.id)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition ${viewedSessionId === s.id ? 'bg-[#26619c] text-white border-[#26619c]' : 'bg-white text-gray-600 border-gray-300 hover:border-[#26619c]'}`}>
                    {s.opened_by_name}
                  </button>
                  {isAdminRole && s.id !== session?.id && (
                    <button onClick={() => { setAdminCloseTarget({ id: s.id, name: s.opened_by_name }); setAdminCloseBalance('') }}
                      className="text-xs bg-red-50 text-red-600 border border-red-200 rounded-lg px-2 py-1 hover:bg-red-100 whitespace-nowrap">
                      Fechar
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          <CashSessionPanel session={session} onRefresh={loadSession} canConferencia={isConferenteOrAbove} />

          {/* Lançamento sem caixa — disponível para todos */}
          <button onClick={() => { setShowOfflineExpense(true); setOfflineType('expense') }}
            className="flex items-center justify-center gap-2 border border-gray-300 text-gray-600 py-2.5 px-4 rounded-xl text-sm font-medium hover:bg-gray-50 transition w-full">
            <ArrowDownLeft className="w-4 h-4" /> Lançamento sem caixa
          </button>

          {session && (
            <>
              {sangriaAlert && (
                <div className="flex items-start gap-3 bg-amber-50 border border-amber-300 rounded-xl px-4 py-3">
                  <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-semibold text-amber-800">Sangria necessária</p>
                    <p className="text-xs text-amber-700">
                      Saldo atual <strong>R$ {currentBalance.toFixed(2)}</strong> excede o limite de <strong>R$ {maxCash!.toFixed(2)}</strong>. Realize uma sangria.
                    </p>
                  </div>
                </div>
              )}

              {/* KPIs for conferente+ users */}
              {isConferenteOrAbove && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-blue-50 rounded-xl p-4 border border-blue-100 flex flex-col gap-1">
                    <div className="flex items-center gap-1.5">
                      <DollarSign className="w-3.5 h-3.5 text-blue-500" />
                      <p className="text-xs text-blue-600 font-medium">Saldo Atual</p>
                    </div>
                    <p className="text-xl font-bold text-blue-700">R$ {currentBalance.toFixed(2)}</p>
                  </div>
                  <div className="bg-green-50 rounded-xl p-4 border border-green-100 flex flex-col gap-1">
                    <div className="flex items-center gap-1.5">
                      <TrendingUp className="w-3.5 h-3.5 text-green-500" />
                      <p className="text-xs text-green-600 font-medium">Entradas do Dia</p>
                    </div>
                    <p className="text-xl font-bold text-green-700">R$ {income.toFixed(2)}</p>
                  </div>
                  <div className="bg-red-50 rounded-xl p-4 border border-red-100 flex flex-col gap-1">
                    <div className="flex items-center gap-1.5">
                      <TrendingDown className="w-3.5 h-3.5 text-red-500" />
                      <p className="text-xs text-red-600 font-medium">Saídas do Dia</p>
                    </div>
                    <p className="text-xl font-bold text-red-700">R$ {expenses.toFixed(2)}</p>
                  </div>
                  <div className="bg-gray-50 rounded-xl p-4 border border-gray-200 flex flex-col gap-1">
                    <div className="flex items-center gap-1.5">
                      <Scale className="w-3.5 h-3.5 text-gray-500" />
                      <p className="text-xs text-gray-500 font-medium">Saldo Esperado</p>
                    </div>
                    <p className="text-xl font-bold text-gray-700">
                      {session.expected_balance
                        ? `R$ ${parseFloat(session.expected_balance).toFixed(2)}`
                        : `R$ ${currentBalance.toFixed(2)}`}
                    </p>
                  </div>
                </div>
              )}

              {/* Payment method breakdown */}
              {isConferenteOrAbove && Object.keys(pmBreakdown).length > 0 && (
                <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Entradas por Forma de Pagamento</p>
                  <div className="flex flex-col gap-2">
                    {Object.entries(pmBreakdown).map(([name, total]) => (
                      <div key={name} className="flex items-center justify-between">
                        <span className="text-sm text-gray-700">{name}</span>
                        <span className="text-sm font-semibold text-green-700">R$ {total.toFixed(2)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Legacy 2-column totals for non-conferente canSeeTotals users (e.g. diretoria_adjunta) */}
              {canSeeTotals && !isConferenteOrAbove && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-green-50 rounded-xl p-4 border border-green-100">
                    <p className="text-xs text-green-600 font-medium mb-1">Total Entradas</p>
                    <p className="text-xl font-bold text-green-700">R$ {income.toFixed(2)}</p>
                  </div>
                  <div className="bg-red-50 rounded-xl p-4 border border-red-100">
                    <p className="text-xs text-red-600 font-medium mb-1">Total Saídas</p>
                    <p className="text-xl font-bold text-red-700">R$ {expenses.toFixed(2)}</p>
                  </div>
                </div>
              )}


<div className="flex gap-3">
                <button onClick={() => setShowTransaction(true)}
                  className="flex-1 flex items-center justify-center gap-2 bg-[#26619c] hover:bg-[#1a4f87] text-white py-2.5 rounded-xl text-sm font-semibold transition">
                  <Plus className="w-4 h-4" /> Nova Transação
                </button>
                <button onClick={() => setShowSangria(true)}
                  className="flex items-center justify-center gap-2 border border-amber-400 text-amber-600 py-2.5 px-4 rounded-xl text-sm font-medium hover:bg-amber-50 transition">
                  <ArrowDownLeft className="w-4 h-4" /> Registrar Saída
                </button>
                <button onClick={loadTransactions}
                  className="flex items-center justify-center gap-2 border border-gray-300 text-gray-600 py-2.5 px-3 rounded-xl text-sm hover:bg-gray-50 transition">
                  <RefreshCw className="w-4 h-4" />
                </button>
              </div>

              <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-100">
                  <h3 className="font-semibold text-gray-800">Movimentações</h3>
                </div>
                {(() => {
                  const isOperator = !isConferenteOrAbove && role !== 'viewer'
                  const displayTxsInMain = isOperator
                    ? transactions.filter(t => new Date(t.transaction_at).toLocaleDateString('pt-BR') === todayLabel)
                    : transactions
                  return loadingTx ? (
                  <div className="p-6 text-center text-gray-400 text-sm">Carregando…</div>
                ) : displayTxsInMain.length === 0 ? (
                  <div className="p-6 text-center text-gray-400 text-sm">Nenhuma movimentação ainda.</div>
                ) : (
                  <ul className="divide-y divide-gray-100">
                    {displayTxsInMain.map(tx => {
                      const isVoided = !!(tx as any).reversed_at
                      const isEstorno = !!tx.is_reversal
                      const isCanceled = isVoided || isEstorno
                      return (
                        <li key={tx.id} className={`px-4 py-3 ${
                          isCanceled ? 'bg-gray-50/70 opacity-60' :
                          tx.approval_status === 'pending' ? 'bg-amber-50/50' :
                          tx.approval_status === 'rejected' ? 'bg-red-50/40' : ''
                        }`}>
                          <div className="flex items-center justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              <p className={`text-sm font-medium truncate ${isCanceled ? 'line-through text-gray-400' : 'text-gray-800'}`}>{tx.description}</p>
                              {tx.resident_name && <p className="text-xs text-[#26619c] font-medium truncate">👤 {tx.resident_name}</p>}
                              {(tx as any).resident_type === 'dependent' && <p className="text-[10px] text-purple-600">Dependente{(tx as any).resident_responsible_name ? ` de ${(tx as any).resident_responsible_name}` : ''}</p>}
                              {(tx as any).resident_type === 'guest' && <p className="text-[10px] text-orange-500">Visitante</p>}
                              <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                                <span className="text-xs text-gray-400">{new Date(tx.transaction_at).toLocaleString('pt-BR')}</span>
                                {!isCanceled && <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${TYPE_COLORS[tx.type]}`}>{TYPE_LABELS[tx.type]}</span>}
                                {tx.payment_method_name && !isCanceled && (
                                  <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-700">{tx.payment_method_name}</span>
                                )}
                                {isEstorno && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-gray-200 text-gray-500">Estorno</span>}
                                {isVoided && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-gray-200 text-gray-500">Estornado</span>}
                              </div>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              {canSeeTotals && (
                                <span className={`text-sm font-semibold ${isCanceled ? 'line-through text-gray-400' : tx.type === 'income' ? 'text-green-600' : 'text-red-600'}`}>
                                  {tx.type === 'income' ? '+' : '-'} R$ {parseFloat(tx.amount).toFixed(2)}
                                </span>
                              )}
                              {isAdminRole && !isCanceled && (
                                <button onClick={() => { setEditingPayMethodTx(tx.id); setPayMethodEdit(tx.payment_method_id ?? '') }}
                                  className="p-1.5 rounded-lg text-gray-400 hover:text-[#26619c] hover:bg-blue-50 transition"
                                  title="Alterar forma de pagamento">
                                  <Pencil className="w-3.5 h-3.5" />
                                </button>
                              )}
                              {isConferenteOrAbove && !tx.is_reversal && !(tx as any).reversed_at && (
                                <button onClick={() => setEstornoTarget(tx)}
                                  className="p-1.5 rounded-lg text-gray-400 hover:text-orange-500 hover:bg-orange-50 transition"
                                  title="Estornar">
                                  <RotateCcw className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                          </div>
                          {editingPayMethodTx === tx.id && (
                            <div className="mt-2 flex items-center gap-2">
                              <select value={payMethodEdit} onChange={e => setPayMethodEdit(e.target.value)}
                                className="flex-1 border border-gray-300 rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-[#26619c]/30">
                                <option value="">— Sem forma —</option>
                                {offlinePayMethods.map(pm => (
                                  <option key={pm.id} value={pm.id}>{pm.name}</option>
                                ))}
                              </select>
                              <button onClick={() => savePayMethod(tx.id)} disabled={savingPayMethod}
                                className="px-3 py-1 bg-[#26619c] text-white text-xs rounded-lg hover:bg-[#1e4d7d] disabled:opacity-50">
                                {savingPayMethod ? '…' : 'Salvar'}
                              </button>
                              <button onClick={() => setEditingPayMethodTx(null)}
                                className="px-3 py-1 border border-gray-300 text-gray-600 text-xs rounded-lg hover:bg-gray-50">
                                Cancelar
                              </button>
                            </div>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                )
                })()}
              </div>
            </>
          )}
        </>
      )}

      {/* ── TAB: SESSÕES ── */}
      {tab === 'sessoes' && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
            <h3 className="font-bold text-gray-900 text-base">Histórico de Sessões</h3>
            <button onClick={loadSessions} className="text-gray-400 hover:text-gray-600">
              <RefreshCw className="w-5 h-5" />
            </button>
          </div>
          {loadingSessions ? (
            <div className="p-10 text-center text-gray-400">Carregando…</div>
          ) : sessions.length === 0 ? (
            <div className="p-10 text-center text-gray-400">Nenhuma sessão encontrada.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="bg-gray-50 border-b-2 border-gray-200 text-gray-500 text-xs font-bold uppercase tracking-wider">
                    <th className="px-5 py-3 text-left whitespace-nowrap">Status</th>
                    <th className="px-5 py-3 text-left whitespace-nowrap">Data</th>
                    <th className="px-5 py-3 text-left whitespace-nowrap">Operador</th>
                    <th className="px-5 py-3 text-left whitespace-nowrap">Fechado por</th>
                    <th className="px-5 py-3 text-right whitespace-nowrap">Saldo Inicial</th>
                    <th className="px-5 py-3 text-right whitespace-nowrap">PIX</th>
                    <th className="px-5 py-3 text-right whitespace-nowrap">Dinheiro</th>
                    <th className="px-5 py-3 text-right whitespace-nowrap">Total Bruto</th>
                    <th className="px-5 py-3 text-right whitespace-nowrap">Baixas</th>
                    <th className="px-5 py-3 text-right whitespace-nowrap">Total Líquido</th>
                    <th className="px-5 py-3 text-right whitespace-nowrap">Conf. Cega</th>
                    <th className="px-5 py-3 text-right whitespace-nowrap">Sobra / Falta</th>
                    <th className="px-5 py-3 text-left whitespace-nowrap">Conferido por</th>
                    <th className="px-5 py-3 text-left whitespace-nowrap">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {sessions.map(s => {
                    const bruto = parseFloat(s.total_bruto ?? '0')
                    const baixas = parseFloat(s.total_baixas ?? '0')
                    const expense = parseFloat((s as any).total_expense ?? '0')
                    const liquido = bruto - baixas - expense
                    const rawDiff = s.difference != null ? parseFloat(s.difference) : null
                    const displayDiff = rawDiff != null ? -rawDiff : null
                    const isSobra = displayDiff != null && displayDiff < 0
                    const isFalta = displayDiff != null && displayDiff > 0
                    const fmtV = (v: number) => `R$ ${v.toFixed(2)}`
                    const statusMap: Record<string, { label: string; cls: string }> = {
                      open: { label: 'Aberta', cls: 'bg-green-100 text-green-700' },
                      closed: { label: 'Fechado', cls: 'bg-gray-100 text-gray-600' },
                      conferido: { label: 'Conferido', cls: 'bg-blue-100 text-blue-700' },
                      cancelled: { label: 'Cancelado', cls: 'bg-red-100 text-red-700' },
                    }
                    const st = statusMap[s.status] ?? { label: s.status, cls: 'bg-gray-100 text-gray-500' }
                    return (
                      <tr key={s.id}
                        className="hover:bg-blue-50/40 transition cursor-pointer"
                        onClick={() => setSelectedSession(s)}>
                        <td className="px-5 py-4 whitespace-nowrap">
                          <span className={`inline-block text-[10px] font-bold px-2 py-0.5 rounded-full ${st.cls}`}>{st.label}</span>
                        </td>
                        <td className="px-5 py-4 whitespace-nowrap">
                          <div className="font-semibold text-gray-900">{new Date(s.opened_at).toLocaleDateString('pt-BR')}</div>
                          <div className="text-xs text-gray-400 mt-0.5">{new Date(s.opened_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}{s.closed_at ? ` – ${new Date(s.closed_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}` : ''}</div>
                        </td>
                        <td className="px-5 py-4 text-gray-800 whitespace-nowrap font-medium">{s.operador_name ?? '—'}</td>
                        <td className="px-5 py-4 text-gray-600 whitespace-nowrap">{s.fechado_por ?? '—'}</td>
                        <td className="px-5 py-4 text-right text-gray-500 whitespace-nowrap">{fmtV(parseFloat(s.opening_balance ?? '0'))}</td>
                        <td className="px-5 py-4 text-right text-gray-700 whitespace-nowrap">{fmtV(parseFloat(s.total_pix ?? '0'))}</td>
                        <td className="px-5 py-4 text-right text-gray-700 whitespace-nowrap">{fmtV(parseFloat(s.total_dinheiro ?? '0'))}</td>
                        <td className="px-5 py-4 text-right font-bold text-green-700 whitespace-nowrap text-base">{fmtV(bruto)}</td>
                        <td className="px-5 py-4 text-right text-amber-700 whitespace-nowrap">{fmtV(baixas + expense)}</td>
                        <td className="px-5 py-4 text-right font-bold text-[#26619c] whitespace-nowrap text-base">{fmtV(liquido)}</td>
                        <td className="px-5 py-4 text-right text-gray-700 whitespace-nowrap font-medium">
                          {s.closing_balance != null ? fmtV(parseFloat(s.closing_balance)) : '—'}
                        </td>
                        <td className="px-5 py-4 text-right whitespace-nowrap">
                          {displayDiff == null ? <span className="text-gray-400">—</span> : (
                            <span className={`inline-flex items-center gap-1 font-bold text-base ${isSobra ? 'text-amber-600' : isFalta ? 'text-red-600' : 'text-green-600'}`}>
                              {isSobra ? '▼' : isFalta ? '▲' : '✓'}
                              {`R$ ${Math.abs(displayDiff).toFixed(2)}`}
                              <span className="font-normal text-xs">{isSobra ? 'Sobra' : isFalta ? 'Falta' : 'OK'}</span>
                            </span>
                          )}
                        </td>
                        <td className="px-5 py-4 text-gray-600 whitespace-nowrap">{s.conferido_por ?? '—'}</td>
                        <td className="px-5 py-4 whitespace-nowrap">
                          <div className="flex items-center gap-2">
                            {s.status !== 'open' && isConferenteOrAbove && (
                              <button
                                disabled={recalcingRow === s.id}
                                onClick={async e => {
                                  e.stopPropagation()
                                  setRecalcingRow(s.id)
                                  try {
                                    const res = await api.post<{ expected_balance: string; difference: string | null }>(`/finance/sessions/${s.id}/recalculate`)
                                    setSessions(prev => prev.map(x => x.id === s.id
                                      ? { ...x, expected_balance: res.data.expected_balance, difference: res.data.difference ?? undefined }
                                      : x))
                                    toast.success('Recalculado.')
                                  } catch { toast.error('Erro ao recalcular.') } finally { setRecalcingRow(null) }
                                }}
                                className="text-xs bg-amber-50 hover:bg-amber-100 text-amber-700 font-semibold px-3 py-1.5 rounded-lg transition disabled:opacity-50 whitespace-nowrap"
                              >
                                {recalcingRow === s.id ? '…' : 'Recalcular'}
                              </button>
                            )}
                            {s.status === 'conferido' && cashBoxes.length > 0 && (
                              <button
                                onClick={e => {
                                  e.stopPropagation()
                                  setTransferSession(s)
                                  setTransferAmount(s.closing_balance ?? s.expected_balance ?? '0')
                                  setTransferBoxId('')
                                }}
                                className="text-xs bg-blue-50 hover:bg-blue-100 text-blue-700 font-semibold px-3 py-1.5 rounded-lg transition"
                              >
                                Transferir
                              </button>
                            )}
                            {s.status !== 'open' && isAdminRole && (
                              <button
                                onClick={async e => {
                                  e.stopPropagation()
                                  const hasConferencia = !!s.conferido_por
                                  const msg = hasConferencia
                                    ? `Reabrir esta sessão?\n\nEsta sessão foi conferida por ${s.conferido_por}. Ao reabrir, os dados de conferência serão mantidos mas o status voltará para "Aberto".\n\nDeseja continuar?`
                                    : 'Reabrir esta sessão para correção de lançamentos?'
                                  if (!window.confirm(msg)) return
                                  try {
                                    await api.post(`/finance/sessions/${s.id}/reopen`)
                                    toast.success('Caixa reaberto.')
                                    loadSessions()
                                    loadSession()
                                  } catch (err: any) {
                                    toast.error(err.response?.data?.detail ?? 'Erro ao reabrir caixa.')
                                  }
                                }}
                                className="text-xs bg-orange-50 hover:bg-orange-100 text-orange-700 font-semibold px-3 py-1.5 rounded-lg transition whitespace-nowrap"
                              >
                                Reabrir
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── MODAL: Transferir sessão conferida → caixinha ── */}
      {transferSession && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-sm bg-white rounded-2xl shadow-xl p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold text-gray-800">Transferir para caixinha</h3>
              <button onClick={() => setTransferSession(null)} className="text-gray-400 hover:text-gray-600"><X className="w-4 h-4" /></button>
            </div>
            <p className="text-xs text-gray-500 mb-1">
              Sessão de {new Date(transferSession.opened_at).toLocaleDateString('pt-BR')} — {transferSession.operador_name ?? ''}
            </p>
            {transferSession.closing_balance && (
              <p className="text-xs text-blue-700 font-medium mb-3">
                Contado na conferência: R$ {parseFloat(transferSession.closing_balance).toFixed(2)}
              </p>
            )}
            <div className="flex flex-col gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Valor (R$)</label>
                <input
                  type="number" min="0.01" step="0.01"
                  value={transferAmount}
                  onChange={e => setTransferAmount(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Caixinha destino</label>
                <select
                  value={transferBoxId}
                  onChange={e => setTransferBoxId(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                >
                  <option value="">Selecione…</option>
                  {cashBoxes.map(b => (
                    <option key={b.id} value={b.id}>{b.name} — saldo R$ {parseFloat(b.balance).toFixed(2)}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex gap-2 mt-5">
              <button onClick={() => setTransferSession(null)} className="flex-1 border border-gray-300 text-gray-600 py-2 rounded-xl text-sm font-medium">Cancelar</button>
              <button
                onClick={handleTransfer}
                disabled={!transferBoxId || !transferAmount || transferLoading}
                className="flex-1 bg-blue-600 hover:bg-blue-700 text-white py-2 rounded-xl text-sm font-semibold disabled:opacity-50"
              >
                {transferLoading ? 'Transferindo…' : 'Confirmar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── TAB: EXTRATO ── */}
      {tab === 'extrato' && (
        <div className="flex flex-col gap-4">
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 flex flex-col gap-3">
            <div className="flex gap-3 items-end">
              <div className="flex-1">
                <label className="block text-xs font-medium text-gray-600 mb-1">De</label>
                <input type="date" value={extratoFrom} onChange={e => setExtratoFrom(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
              </div>
              <div className="flex-1">
                <label className="block text-xs font-medium text-gray-600 mb-1">Até</label>
                <input type="date" value={extratoTo} onChange={e => setExtratoTo(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
              </div>
              <button onClick={loadExtrato} disabled={loadingExtrato}
                className="px-4 py-2 bg-[#26619c] text-white rounded-lg text-sm font-medium disabled:opacity-50">
                {loadingExtrato ? '…' : 'Buscar'}
              </button>
            </div>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            {loadingExtrato ? (
              <div className="p-6 text-center text-gray-400 text-sm">Carregando…</div>
            ) : extrato.length === 0 ? (
              <div className="p-6 text-center text-gray-400 text-sm">Nenhuma transação no período.</div>
            ) : (
              <ul className="divide-y divide-gray-100">
                {extrato.map(e => (
                  <li key={e.id} className="px-4 py-3 flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-800 truncate">{e.descricao}</p>
                      <p className="text-xs text-gray-400">
                        {new Date(e.data).toLocaleDateString('pt-BR')}
                        {e.categoria ? ` · ${e.categoria}` : ''}
                        {e.metodo ? ` · ${e.metodo}` : ''}
                        {e.operador ? ` · ${e.operador}` : ''}
                      </p>
                    </div>
                    <span className={`text-sm font-semibold shrink-0 ${e.tipo === 'income' ? 'text-green-600' : 'text-red-600'}`}>
                      {e.tipo === 'income' ? '+' : '-'}R$ {parseFloat(e.valor).toFixed(2)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {/* ── TAB: RELATÓRIOS ── */}
      {tab === 'relatorios' && (
        <div className="flex flex-col gap-5">
          {loadingRel ? (
            <div className="p-8 text-center text-gray-400 text-sm">Carregando…</div>
          ) : (
            <>
              {/* Evolução mensal */}
              <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
                <h3 className="font-semibold text-gray-800 mb-4">Evolução Mensal (6 meses)</h3>
                {evolucao.length === 0 ? (
                  <p className="text-xs text-gray-400">Sem dados.</p>
                ) : (
                  <div className="flex flex-col gap-3">
                    {evolucao.map(e => {
                      const max = Math.max(...evolucao.map(x => Math.max(x.entradas, x.saidas)), 1)
                      return (
                        <div key={e.mes}>
                          <p className="text-xs text-gray-500 mb-1">{e.mes}</p>
                          <div className="flex flex-col gap-1">
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-green-600 w-14 shrink-0">Entrada</span>
                              <div className="flex-1 bg-gray-100 rounded-full h-2">
                                <div className="bg-green-500 h-2 rounded-full" style={{ width: `${(e.entradas / max) * 100}%` }} />
                              </div>
                              <span className="text-xs text-green-700 w-20 text-right shrink-0">R$ {e.entradas.toFixed(2)}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-red-600 w-14 shrink-0">Saída</span>
                              <div className="flex-1 bg-gray-100 rounded-full h-2">
                                <div className="bg-red-400 h-2 rounded-full" style={{ width: `${(e.saidas / max) * 100}%` }} />
                              </div>
                              <span className="text-xs text-red-700 w-20 text-right shrink-0">R$ {e.saidas.toFixed(2)}</span>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>

              {/* Fluxo projetado */}
              <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
                <h3 className="font-semibold text-gray-800 mb-1">Fluxo Projetado (próximos 30 dias)</h3>
                <p className="text-xs text-gray-400 mb-4">Mensalidades pendentes com vencimento nos próximos 30 dias.</p>
                {fluxo.length === 0 ? (
                  <p className="text-xs text-gray-400">Nenhuma mensalidade projetada.</p>
                ) : (
                  <ul className="divide-y divide-gray-100">
                    {fluxo.map((f, i) => (
                      <li key={i} className="py-2.5 flex items-center justify-between gap-2">
                        <div>
                          <p className="text-sm font-medium text-gray-800">{f.resident_name}</p>
                          <p className="text-xs text-gray-400">
                            Venc: {new Date(f.due_date).toLocaleDateString('pt-BR')}
                          </p>
                        </div>
                        <span className="text-sm font-semibold text-[#26619c] shrink-0">R$ {parseFloat(f.amount).toFixed(2)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}
        </div>
      )}


      {showSangria && <SangriaModal onClose={() => setShowSangria(false)} onSuccess={loadTransactions} />}
      {showTransaction && session && (
        <Suspense fallback={<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"><Loader2 className="w-8 h-8 text-white animate-spin" /></div>}>
          <TransactionModal onClose={() => setShowTransaction(false)} onSuccess={loadTransactions} />
        </Suspense>
      )}
      {selectedSession && (
        <SessionDetailModal
          session={selectedSession}
          onClose={() => setSelectedSession(null)}
        />
      )}

{adminCloseTarget && (
        <div className="fixed inset-0 z-[70] bg-black/40 flex items-center justify-center p-4">
          <div className="w-full max-w-sm bg-white rounded-2xl shadow-2xl p-5 flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-gray-900">Fechar caixa de {adminCloseTarget.name}</h3>
              <button onClick={() => setAdminCloseTarget(null)}><X className="w-5 h-5 text-gray-400" /></button>
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Valor contado (R$)</label>
              <input
                type="number" min="0" step="0.01"
                value={adminCloseBalance}
                onChange={e => setAdminCloseBalance(e.target.value)}
                placeholder="0,00"
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-300"
                autoFocus
              />
            </div>
            <button
              onClick={handleAdminClose}
              disabled={adminClosing || !adminCloseBalance}
              className="w-full bg-red-600 text-white rounded-xl py-2.5 text-sm font-semibold disabled:opacity-50"
            >
              {adminClosing ? 'Fechando…' : 'Confirmar fechamento'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
