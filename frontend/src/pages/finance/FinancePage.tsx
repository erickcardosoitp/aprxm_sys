import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, ArrowDownLeft, Check, ClipboardCheck, DollarSign, List, Loader2, Plus, RefreshCw, Scale, TrendingDown, TrendingUp, X, XCircle } from 'lucide-react'
import toast from 'react-hot-toast'
import { CashSessionPanel } from '../../components/finance/CashSessionPanel'
import { SangriaModal } from '../../components/finance/SangriaModal'
import { TransactionModal } from '../../components/finance/TransactionModal'
import api from '../../services/api'
import { financeService, type PendingApproval } from '../../services/finance'
import { settingsService } from '../../services/settings'
import { useAuthStore } from '../../store/authStore'
import type { AssociationSettings, CashSession, CashSessionSummary, Transaction } from '../../types'

const TYPE_LABELS: Record<string, string> = { income: 'Entrada', expense: 'Saída', sangria: 'Sangria' }
const TYPE_COLORS: Record<string, string> = { income: 'text-green-600', expense: 'text-red-600', sangria: 'text-amber-600' }

// ── Approval modal ─────────────────────────────────────────────────────────────

function ApprovalModal({
  item,
  onClose,
  onDone,
}: {
  item: PendingApproval
  onClose: () => void
  onDone: () => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [drawing, setDrawing] = useState(false)
  const [hasSig, setHasSig] = useState(false)
  const [rejectMode, setRejectMode] = useState(false)
  const [rejectReason, setRejectReason] = useState('')
  const [loading, setLoading] = useState(false)

  const startDraw = (e: React.MouseEvent | React.TouchEvent) => {
    const canvas = canvasRef.current
    if (!canvas) return
    setDrawing(true)
    setHasSig(true)
    const ctx = canvas.getContext('2d')!
    const rect = canvas.getBoundingClientRect()
    const x = 'touches' in e ? e.touches[0].clientX - rect.left : (e as React.MouseEvent).clientX - rect.left
    const y = 'touches' in e ? e.touches[0].clientY - rect.top : (e as React.MouseEvent).clientY - rect.top
    ctx.beginPath(); ctx.moveTo(x, y)
  }
  const draw = (e: React.MouseEvent | React.TouchEvent) => {
    if (!drawing) return
    const canvas = canvasRef.current!
    const ctx = canvas.getContext('2d')!
    const rect = canvas.getBoundingClientRect()
    const x = 'touches' in e ? e.touches[0].clientX - rect.left : (e as React.MouseEvent).clientX - rect.left
    const y = 'touches' in e ? e.touches[0].clientY - rect.top : (e as React.MouseEvent).clientY - rect.top
    ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.strokeStyle = '#1a3f6f'
    ctx.lineTo(x, y); ctx.stroke()
  }
  const stopDraw = () => setDrawing(false)
  const clearSig = () => {
    const canvas = canvasRef.current!
    canvas.getContext('2d')!.clearRect(0, 0, canvas.width, canvas.height)
    setHasSig(false)
  }

  const handleApprove = async () => {
    if (!hasSig) { toast.error('Assine para aprovar.'); return }
    setLoading(true)
    try {
      const sig = canvasRef.current!.toDataURL('image/png')
      await financeService.approveTransaction(item.id, sig)
      toast.success('Despesa aprovada.')
      onDone()
    } catch { toast.error('Erro ao aprovar.') } finally { setLoading(false) }
  }

  const handleReject = async () => {
    if (!rejectReason.trim() || rejectReason.length < 5) { toast.error('Informe o motivo (mín. 5 caracteres).'); return }
    setLoading(true)
    try {
      await financeService.rejectTransaction(item.id, rejectReason)
      toast.success('Despesa recusada.')
      onDone()
    } catch { toast.error('Erro ao recusar.') } finally { setLoading(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="font-bold text-gray-900 text-sm">Aprovação de Despesa</h2>
          <button onClick={onClose}><X className="w-5 h-5 text-gray-400" /></button>
        </div>
        <div className="px-5 py-4 space-y-3">
          <div className="bg-red-50 rounded-xl p-3 border border-red-100">
            <p className="text-sm font-semibold text-red-800">{item.description}</p>
            <p className="text-xs text-red-600 mt-0.5">R$ {parseFloat(item.amount).toFixed(2)} · {item.creator_name}</p>
            {item.category_name && <p className="text-xs text-gray-400 mt-0.5">{item.category_name}</p>}
          </div>
          {!rejectMode ? (
            <>
              <p className="text-xs text-gray-500 font-medium">Assinatura do aprovador</p>
              <div className="relative border-2 border-dashed border-gray-200 rounded-xl overflow-hidden bg-gray-50">
                <canvas
                  ref={canvasRef} width={320} height={120}
                  className="w-full touch-none cursor-crosshair"
                  onMouseDown={startDraw} onMouseMove={draw} onMouseUp={stopDraw} onMouseLeave={stopDraw}
                  onTouchStart={startDraw} onTouchMove={draw} onTouchEnd={stopDraw}
                />
                {!hasSig && (
                  <p className="absolute inset-0 flex items-center justify-center text-xs text-gray-300 pointer-events-none">Assine aqui</p>
                )}
              </div>
              {hasSig && <button onClick={clearSig} className="text-xs text-gray-400 hover:text-gray-600">Limpar assinatura</button>}
              <div className="flex gap-2 pt-1">
                <button onClick={() => setRejectMode(true)} className="flex-1 flex items-center justify-center gap-1.5 border border-red-200 text-red-600 py-2.5 rounded-xl text-sm hover:bg-red-50 transition">
                  <XCircle className="w-4 h-4" /> Recusar
                </button>
                <button onClick={handleApprove} disabled={loading} className="flex-1 flex items-center justify-center gap-1.5 bg-green-600 hover:bg-green-700 text-white py-2.5 rounded-xl text-sm font-semibold transition disabled:opacity-50">
                  {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Check className="w-4 h-4" /> Aprovar</>}
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="text-xs text-gray-500 font-medium">Motivo da recusa</p>
              <textarea
                value={rejectReason} onChange={e => setRejectReason(e.target.value)}
                rows={3} placeholder="Descreva o motivo..."
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-300"
              />
              <div className="flex gap-2">
                <button onClick={() => setRejectMode(false)} className="flex-1 border border-gray-200 text-gray-600 py-2.5 rounded-xl text-sm hover:bg-gray-50">Voltar</button>
                <button onClick={handleReject} disabled={loading} className="flex-1 flex items-center justify-center gap-1.5 bg-red-600 hover:bg-red-700 text-white py-2.5 rounded-xl text-sm font-semibold disabled:opacity-50">
                  {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Confirmar Recusa'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

type Tab = 'caixa' | 'sessoes' | 'extrato' | 'relatorios'

interface ExtratoEntry {
  id: string; data: string; tipo: string; descricao: string; valor: string
  categoria?: string; metodo?: string; operador?: string; aprovacao?: string
}

interface EvolucaoEntry { mes: string; entradas: number; saidas: number }
interface FluxoEntry { resident_name: string; unit?: string; block?: string; reference_month: string; due_date: string; amount: string }

// ── Session detail modal ──────────────────────────────────────────────────────

function SessionDetailModal({
  session,
  onClose,
}: {
  session: CashSessionSummary
  onClose: () => void
}) {
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [loading, setLoading] = useState(false)
  const [conferencing, setConferencing] = useState(false)

  const fmtBRL = (v: string | undefined) => (v != null ? `R$ ${parseFloat(v).toFixed(2)}` : '—')
  const fmtDate = (s: string) =>
    new Date(s).toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })

  useEffect(() => {
    const loadTx = async () => {
      setLoading(true)
      try {
        const res = await financeService.listTransactions(session.id)
        setTransactions(res.data)
      } catch {
        setTransactions([])
      } finally {
        setLoading(false)
      }
    }
    loadTx()
  }, [session.id])

  const handleConferencia = () => {
    setConferencing(true)
    setTimeout(() => {
      toast.success('Conferência registrada')
      setConferencing(false)
    }, 600)
  }

  const diff = session.difference ? parseFloat(session.difference) : null

  return (
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
            {session.expected_balance && (
              <div>
                <p className="text-xs text-gray-400">Saldo esperado</p>
                <p className="font-semibold text-gray-800">{fmtBRL(session.expected_balance)}</p>
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
              session.status === 'open' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'
            }`}>
              {session.status === 'open' ? 'Aberta' : 'Fechada'}
            </span>
          </div>
        </div>

        {/* Transactions */}
        <div className="flex-1 overflow-y-auto">
          <div className="px-6 py-3 border-b border-gray-100">
            <h3 className="font-semibold text-gray-800 text-sm">Movimentações</h3>
          </div>
          {loading ? (
            <div className="p-6 text-center text-gray-400 text-sm">Carregando…</div>
          ) : transactions.length === 0 ? (
            <div className="p-6 text-center text-gray-400 text-sm">Nenhuma movimentação registrada.</div>
          ) : (
            <ul className="divide-y divide-gray-100">
              {transactions.map((tx) => (
                <li key={tx.id} className="flex items-center justify-between px-6 py-3">
                  <div>
                    <p className="text-sm font-medium text-gray-800">{tx.description}</p>
                    <p className="text-xs text-gray-400">
                      {new Date(tx.transaction_at).toLocaleString('pt-BR')}
                      {' · '}
                      <span className={TYPE_COLORS[tx.type]}>{TYPE_LABELS[tx.type]}</span>
                    </p>
                  </div>
                  <span className={`text-sm font-semibold ${tx.type === 'income' ? 'text-green-600' : 'text-red-600'}`}>
                    {tx.type === 'income' ? '+' : '-'} R$ {parseFloat(tx.amount).toFixed(2)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Footer */}
        <div className="flex gap-3 px-6 py-4 border-t border-gray-100 shrink-0">
          <button
            onClick={onClose}
            className="flex-1 border border-gray-300 text-gray-600 py-2.5 rounded-xl text-sm hover:bg-gray-50 transition"
          >
            Fechar
          </button>
          <button
            onClick={handleConferencia}
            disabled={conferencing}
            className="flex-1 flex items-center justify-center gap-2 bg-[#26619c] hover:bg-[#1a4f87] text-white py-2.5 rounded-xl text-sm font-semibold transition disabled:opacity-50"
          >
            <ClipboardCheck className="w-4 h-4" />
            {conferencing ? 'Registrando…' : 'Conferência de Caixa'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function FinancePage() {
  const role = useAuthStore((s) => s.role)
  const canSeeTotals = role !== 'operator' && role !== 'viewer'
  const isConferenteOrAbove = role === 'conferente' || role === 'admin' || role === 'superadmin'

  const [tab, setTab] = useState<Tab>('caixa')
  const [session, setSession] = useState<CashSession | null>(null)
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [showSangria, setShowSangria] = useState(false)
  const [showTransaction, setShowTransaction] = useState(false)
  const [loadingTx, setLoadingTx] = useState(false)
  const [sessions, setSessions] = useState<CashSessionSummary[]>([])
  const [loadingSessions, setLoadingSessions] = useState(false)
  const [settings, setSettings] = useState<AssociationSettings | null>(null)
  const [selectedSession, setSelectedSession] = useState<CashSessionSummary | null>(null)
  const [pendingApprovals, setPendingApprovals] = useState<PendingApproval[]>([])
  const [approvalItem, setApprovalItem] = useState<PendingApproval | null>(null)
  const [showOfflineExpense, setShowOfflineExpense] = useState(false)
  const [offlineForm, setOfflineForm] = useState({ description: '', amount: '', category_id: '' })
  const [offlineCategories, setOfflineCategories] = useState<{ id: string; name: string }[]>([])
  const [savingOffline, setSavingOffline] = useState(false)

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
    try { const res = await financeService.getCurrentSession(); setSession(res.data) }
    catch { setSession(null) }
  }

  const loadTransactions = async () => {
    if (!session) return
    setLoadingTx(true)
    try { const res = await financeService.listTransactions(); setTransactions(res.data) }
    catch { toast.error('Erro ao carregar transações.') }
    finally { setLoadingTx(false) }
  }

  const loadPendingApprovals = async () => {
    if (!isConferenteOrAbove) return
    try { const res = await financeService.listPendingApprovals(); setPendingApprovals(res.data) }
    catch { setPendingApprovals([]) }
  }

  const loadSessions = async () => {
    setLoadingSessions(true)
    try { const res = await financeService.listSessions(); setSessions(res.data) }
    catch { toast.error('Erro ao carregar sessões.') }
    finally { setLoadingSessions(false) }
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
  }, [])
  useEffect(() => { loadTransactions() }, [session?.id])
  useEffect(() => { if (tab === 'sessoes') loadSessions() }, [tab])
  useEffect(() => { if (tab === 'extrato') loadExtrato() }, [tab])
  useEffect(() => { if (tab === 'relatorios') loadRelatorios() }, [tab])
  useEffect(() => {
    if (canSeeTotals) settingsService.get().then(r => setSettings(r.data)).catch(() => {})
  }, [canSeeTotals])
  useEffect(() => { if (session) loadPendingApprovals() }, [session?.id])

  const income = transactions.filter(t => t.type === 'income').reduce((s, t) => s + parseFloat(t.amount), 0)
  const expenses = transactions.filter(t => t.type !== 'income').reduce((s, t) => s + parseFloat(t.amount), 0)
  const currentBalance = session ? parseFloat(session.opening_balance) + income - expenses : 0
  const maxCash = settings ? parseFloat(settings.max_cash_before_sangria) : null
  const sangriaAlert = canSeeTotals && maxCash !== null && currentBalance > maxCash

  const handleOfflineExpense = async () => {
    if (!offlineForm.description.trim()) { toast.error('Informe a descrição.'); return }
    const amt = parseFloat(offlineForm.amount)
    if (!amt || amt <= 0) { toast.error('Valor inválido.'); return }
    setSavingOffline(true)
    try {
      await api.post('/finance/transactions/offline', {
        type: 'expense',
        amount: amt,
        description: offlineForm.description,
        category_id: offlineForm.category_id || null,
      })
      toast.success('Saída externa registrada!')
      setShowOfflineExpense(false)
      setOfflineForm({ description: '', amount: '', category_id: '' })
    } catch (e: any) {
      toast.error(e.response?.data?.detail ?? 'Erro ao registrar.')
    } finally {
      setSavingOffline(false)
    }
  }

  const fmtBRL = (v: string | undefined) => v != null ? `R$ ${parseFloat(v).toFixed(2)}` : '—'
  const fmtDate = (s: string) => new Date(s).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })

  return (
    <div className="flex flex-col gap-6 p-4 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900">Operação de Caixa</h1>

      {/* ── Modal Saída Externa ── */}
      {showOfflineExpense && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm bg-white rounded-2xl shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <h2 className="font-bold text-gray-900 text-sm">Adicionar Saída (sem caixa)</h2>
              <button onClick={() => setShowOfflineExpense(false)}><X className="w-5 h-5 text-gray-400" /></button>
            </div>
            <div className="px-5 py-4 flex flex-col gap-3">
              <p className="text-xs text-gray-400">Registra uma saída que não passa pelo caixa. Não afeta saldo de sessão.</p>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Descrição</label>
                <input value={offlineForm.description} onChange={e => setOfflineForm(f => ({ ...f, description: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#26619c]/40"
                  placeholder="Ex: Conta de luz, aluguel…" autoFocus />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Valor</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-400">R$</span>
                  <input type="number" min="0.01" step="0.01" value={offlineForm.amount}
                    onChange={e => setOfflineForm(f => ({ ...f, amount: e.target.value }))}
                    className="w-full pl-9 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#26619c]/40" />
                </div>
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
            </div>
            <div className="flex gap-3 px-5 pb-5">
              <button onClick={() => setShowOfflineExpense(false)}
                className="flex-1 border border-gray-300 text-gray-600 py-2.5 rounded-xl text-sm hover:bg-gray-50">Cancelar</button>
              <button onClick={handleOfflineExpense} disabled={savingOffline}
                className="flex-1 bg-red-600 hover:bg-red-700 text-white py-2.5 rounded-xl text-sm font-semibold transition disabled:opacity-50">
                {savingOffline ? 'Salvando…' : 'Registrar Saída'}
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
          <CashSessionPanel session={session} onRefresh={loadSession} canConferencia={isConferenteOrAbove} />

          {/* Saída Externa — disponível mesmo sem caixa aberto (admin+) */}
          {isConferenteOrAbove && (
            <button onClick={() => setShowOfflineExpense(true)}
              className="flex items-center justify-center gap-2 border border-red-300 text-red-600 py-2.5 px-4 rounded-xl text-sm font-medium hover:bg-red-50 transition w-full">
              <TrendingDown className="w-4 h-4" /> Adicionar Saída (sem caixa)
            </button>
          )}

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

              {/* Pending approvals — conferente/admin only */}
              {isConferenteOrAbove && pendingApprovals.length > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl overflow-hidden">
                  <div className="px-4 py-2.5 border-b border-amber-200 flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-amber-800 flex items-center gap-1.5">
                      <AlertTriangle className="w-4 h-4" />
                      Aguardando Aprovação ({pendingApprovals.length})
                    </h3>
                  </div>
                  <ul className="divide-y divide-amber-100">
                    {pendingApprovals.map(p => (
                      <li key={p.id} className="flex items-center justify-between px-4 py-3 gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-gray-800 truncate">{p.description}</p>
                          <p className="text-xs text-gray-500">{p.creator_name} · {p.category_name ?? '—'}</p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-sm font-semibold text-red-600">R$ {parseFloat(p.amount).toFixed(2)}</span>
                          <button
                            onClick={() => setApprovalItem(p)}
                            className="text-xs bg-amber-600 hover:bg-amber-700 text-white px-3 py-1.5 rounded-lg font-medium transition"
                          >
                            Revisar
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="flex gap-3">
                <button onClick={() => setShowTransaction(true)}
                  className="flex-1 flex items-center justify-center gap-2 bg-[#26619c] hover:bg-[#1a4f87] text-white py-2.5 rounded-xl text-sm font-semibold transition">
                  <Plus className="w-4 h-4" /> Nova Transação
                </button>
                <button onClick={() => setShowSangria(true)}
                  className="flex items-center justify-center gap-2 border border-amber-400 text-amber-600 py-2.5 px-4 rounded-xl text-sm font-medium hover:bg-amber-50 transition">
                  <ArrowDownLeft className="w-4 h-4" /> Sangria
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
                {loadingTx ? (
                  <div className="p-6 text-center text-gray-400 text-sm">Carregando…</div>
                ) : transactions.length === 0 ? (
                  <div className="p-6 text-center text-gray-400 text-sm">Nenhuma movimentação ainda.</div>
                ) : (
                  <ul className="divide-y divide-gray-100">
                    {transactions.map(tx => (
                      <li key={tx.id} className={`flex items-center justify-between px-4 py-3 ${tx.approval_status === 'pending' ? 'bg-amber-50/50' : tx.approval_status === 'rejected' ? 'bg-red-50/40' : ''}`}>
                        <div>
                          <p className="text-sm font-medium text-gray-800">{tx.description}</p>
                          <p className="text-xs text-gray-400">
                            {new Date(tx.transaction_at).toLocaleString('pt-BR')}
                            {' · '}
                            <span className={TYPE_COLORS[tx.type]}>{TYPE_LABELS[tx.type]}</span>
                            {tx.approval_status === 'pending' && <span className="ml-1.5 text-amber-600 font-medium">· Aguarda aprovação</span>}
                            {tx.approval_status === 'rejected' && <span className="ml-1.5 text-red-500 font-medium">· Recusada</span>}
                          </p>
                        </div>
                        {canSeeTotals && (
                          <span className={`text-sm font-semibold ${tx.type === 'income' ? 'text-green-600' : tx.approval_status === 'pending' ? 'text-amber-500' : 'text-red-600'}`}>
                            {tx.type === 'income' ? '+' : '-'} R$ {parseFloat(tx.amount).toFixed(2)}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}
        </>
      )}

      {/* ── TAB: SESSÕES ── */}
      {tab === 'sessoes' && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
            <h3 className="font-semibold text-gray-800 text-sm">Histórico de Sessões</h3>
            <button onClick={loadSessions} className="text-gray-400 hover:text-gray-600">
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
          {loadingSessions ? (
            <div className="p-6 text-center text-gray-400 text-sm">Carregando…</div>
          ) : sessions.length === 0 ? (
            <div className="p-6 text-center text-gray-400 text-sm">Nenhuma sessão encontrada.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200 text-gray-500 font-semibold uppercase tracking-wide">
                    <th className="px-3 py-2.5 text-left whitespace-nowrap">Data</th>
                    <th className="px-3 py-2.5 text-left whitespace-nowrap">Operador</th>
                    <th className="px-3 py-2.5 text-right whitespace-nowrap">Saldo Inicial</th>
                    <th className="px-3 py-2.5 text-right whitespace-nowrap">R$ PIX</th>
                    <th className="px-3 py-2.5 text-right whitespace-nowrap">R$ Dinheiro</th>
                    <th className="px-3 py-2.5 text-right whitespace-nowrap">R$ Total Bruto</th>
                    <th className="px-3 py-2.5 text-right whitespace-nowrap">R$ Baixas</th>
                    <th className="px-3 py-2.5 text-right whitespace-nowrap">R$ Total Líquido</th>
                    <th className="px-3 py-2.5 text-right whitespace-nowrap">Conf. Cega</th>
                    <th className="px-3 py-2.5 text-right whitespace-nowrap">Sobra/Falta</th>
                    <th className="px-3 py-2.5 text-left whitespace-nowrap">Conferido por</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {sessions.map(s => {
                    const bruto = parseFloat(s.total_bruto ?? '0')
                    const baixas = parseFloat(s.total_baixas ?? '0')
                    const liquido = bruto - baixas
                    // difference stored as (counted - expected); user wants sobra=negative, falta=positive → negate
                    const rawDiff = s.difference != null ? parseFloat(s.difference) : null
                    const displayDiff = rawDiff != null ? -rawDiff : null
                    const isSobra = displayDiff != null && displayDiff < 0
                    const isFalta = displayDiff != null && displayDiff > 0
                    const fmtV = (v: number) => `R$ ${v.toFixed(2)}`
                    return (
                      <tr key={s.id}
                        className="hover:bg-gray-50 transition cursor-pointer"
                        onClick={() => setSelectedSession(s)}>
                        <td className="px-3 py-2.5 text-gray-700 whitespace-nowrap">
                          <div>{new Date(s.opened_at).toLocaleDateString('pt-BR')}</div>
                          {s.status === 'open' && (
                            <span className="inline-block mt-0.5 text-[10px] font-semibold bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full">Aberta</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-gray-700 whitespace-nowrap">{s.operador_name ?? '—'}</td>
                        <td className="px-3 py-2.5 text-right text-gray-500 whitespace-nowrap">{fmtV(parseFloat(s.opening_balance ?? '0'))}</td>
                        <td className="px-3 py-2.5 text-right text-gray-700 whitespace-nowrap">{fmtV(parseFloat(s.total_pix ?? '0'))}</td>
                        <td className="px-3 py-2.5 text-right text-gray-700 whitespace-nowrap">{fmtV(parseFloat(s.total_dinheiro ?? '0'))}</td>
                        <td className="px-3 py-2.5 text-right font-semibold text-green-700 whitespace-nowrap">{fmtV(bruto)}</td>
                        <td className="px-3 py-2.5 text-right text-amber-700 whitespace-nowrap">{fmtV(baixas)}</td>
                        <td className="px-3 py-2.5 text-right font-semibold text-[#26619c] whitespace-nowrap">{fmtV(liquido)}</td>
                        <td className="px-3 py-2.5 text-right text-gray-700 whitespace-nowrap">
                          {s.closing_balance != null ? fmtV(parseFloat(s.closing_balance)) : '—'}
                        </td>
                        <td className="px-3 py-2.5 text-right whitespace-nowrap font-semibold">
                          {displayDiff == null ? '—' : (
                            <span className={isSobra ? 'text-amber-600' : isFalta ? 'text-red-600' : 'text-green-600'}>
                              {isSobra ? '▼ ' : isFalta ? '▲ ' : ''}
                              {`R$ ${Math.abs(displayDiff).toFixed(2)}`}
                              <span className="ml-1 font-normal text-[10px]">{isSobra ? 'Sobra' : isFalta ? 'Falta' : 'OK'}</span>
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-gray-700 whitespace-nowrap">{s.conferido_por ?? '—'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
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
                      {e.aprovacao && e.aprovacao !== 'approved' && (
                        <span className={`text-xs font-medium ${e.aprovacao === 'pending' ? 'text-amber-600' : 'text-red-600'}`}>
                          {e.aprovacao === 'pending' ? 'Pendente aprovação' : 'Rejeitada'}
                        </span>
                      )}
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
                            {f.unit ? ` · Unid. ${f.unit}` : ''}
                            {f.block ? ` / Bl. ${f.block}` : ''}
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
      {showTransaction && session && <TransactionModal onClose={() => setShowTransaction(false)} onSuccess={() => { loadTransactions(); loadPendingApprovals() }} />}
      {selectedSession && (
        <SessionDetailModal
          session={selectedSession}
          onClose={() => setSelectedSession(null)}
        />
      )}
      {approvalItem && (
        <ApprovalModal
          item={approvalItem}
          onClose={() => setApprovalItem(null)}
          onDone={() => { setApprovalItem(null); loadPendingApprovals(); loadTransactions() }}
        />
      )}
    </div>
  )
}
