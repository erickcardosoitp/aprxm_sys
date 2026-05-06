import { useEffect, useState } from 'react'
import { Pencil, RotateCcw, Printer, X } from 'lucide-react'
import api from '../../../services/api'
import toast from 'react-hot-toast'
import { fmt, fmtDate, parseTxName } from '../utils/formatters'
import { SUBTYPE_LABELS, SUBTYPE_COLORS, PERIOD_LABEL } from '../constants/financeiro'
import { useFinanceiro } from '../contexts/FinanceiroContext'
import type { Tx } from '../types/financeiro'

interface Props {
  period: string
  setPeriod: (p: string) => void
}

const inputCls = 'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#26619c]/40 focus:border-[#26619c]'

export default function MovimentacoesTab({ period, setPeriod }: Props) {
  const { paymentMethods } = useFinanceiro()

  const [transactions, setTransactions] = useState<Tx[]>([])
  const [loadingTx, setLoadingTx] = useState(false)
  const [movSubTab, setMovSubTab] = useState<'entradas' | 'despesas' | 'estornos' | 'transferencias'>('entradas')
  const [movSubtypeFilter, setMovSubtypeFilter] = useState<string | null>(null)
  const [txFilterOp, setTxFilterOp] = useState<string | null>(null)

  // Reversal
  const [reversing, setReversing] = useState<string | null>(null)
  const [reversalReason, setReversalReason] = useState('')
  const [reversalPassword, setReversalPassword] = useState('')
  const [reversalTarget, setReversalTarget] = useState<Tx | null>(null)

  // Edit
  const [editTarget, setEditTarget] = useState<Tx | null>(null)
  const [editAmount, setEditAmount] = useState('')
  const [editPmId, setEditPmId] = useState('')
  const [editDesc, setEditDesc] = useState('')
  const [editCashSessionId, setEditCashSessionId] = useState('')
  const [editPassword, setEditPassword] = useState('')
  const [editing, setEditing] = useState(false)
  const [editSessions, setEditSessions] = useState<{ id: string; opened_by_name: string; opened_at: string }[]>([])

  // Reprint
  const [reprinting, setReprinting] = useState<string | null>(null)

  const loadTransactions = async () => {
    setLoadingTx(true)
    try {
      const res = await api.get<Tx[]>('/finance/transactions')
      setTransactions(res.data)
    } catch { setTransactions([]) } finally { setLoadingTx(false) }
  }

  useEffect(() => { loadTransactions() }, [])

  const periodStart = () => {
    const now = new Date()
    if (period === 'week') return new Date(now.getTime() - 7 * 24 * 3600 * 1000)
    if (period === 'year') return new Date(now.getFullYear(), 0, 1)
    return new Date(now.getFullYear(), now.getMonth(), 1)
  }
  const filterByPeriod = (txs: Tx[]) => txs.filter(t => new Date(t.transaction_at) >= periodStart())

  const entradas = filterByPeriod(transactions.filter(t => t.type === 'income' && !t.is_reversal && !t.reversed_at))
  const despesas = filterByPeriod(transactions.filter(t => t.type === 'expense' && !t.is_reversal))
  const estornos = filterByPeriod(transactions.filter(t => t.is_reversal))
  const transferencias = filterByPeriod(transactions.filter(t => t.type === 'sangria'))

  const baseRows =
    movSubTab === 'entradas' ? entradas :
    movSubTab === 'despesas' ? despesas :
    movSubTab === 'estornos' ? estornos :
    transferencias
  const opRows = txFilterOp ? baseRows.filter(t => t.created_by_name === txFilterOp) : baseRows
  const rows = movSubTab === 'entradas' && movSubtypeFilter ? opRows.filter(t => t.income_subtype === movSubtypeFilter) : opRows
  const opNames = [...new Set(baseRows.map(t => t.created_by_name).filter(Boolean))] as string[]

  const totalEntradas = entradas.reduce((s, t) => s + parseFloat(t.amount), 0)
  const totalDespesas = despesas.reduce((s, t) => s + parseFloat(t.amount), 0)
  const totalEstornos = estornos.reduce((s, t) => s + parseFloat(t.amount), 0)
  const totalTransferencias = transferencias.reduce((s, t) => s + parseFloat(t.amount), 0)
  const resultado = totalEntradas - totalDespesas - totalEstornos

  // count shown reflects active filters (subtype + operator) for the active tab
  const activeCount = movSubTab === 'entradas' ? rows.length : baseRows.length
  const activeTotal = movSubTab === 'entradas'
    ? rows.reduce((s, t) => s + parseFloat(t.amount), 0)
    : baseRows.reduce((s, t) => s + parseFloat(t.amount), 0)

  const tabCfg = [
    { key: 'entradas' as const, label: 'Receitas', total: movSubTab === 'entradas' ? activeTotal : totalEntradas, count: movSubTab === 'entradas' ? activeCount : entradas.length, active: 'bg-green-50 border-green-400', inactive: 'bg-white border-gray-200', textActive: 'text-green-700', textInactive: 'text-green-600' },
    { key: 'despesas' as const, label: 'Despesas', total: movSubTab === 'despesas' ? activeTotal : totalDespesas, count: movSubTab === 'despesas' ? activeCount : despesas.length, active: 'bg-red-50 border-red-400', inactive: 'bg-white border-gray-200', textActive: 'text-red-700', textInactive: 'text-red-500' },
    { key: 'estornos' as const, label: 'Estornos', total: movSubTab === 'estornos' ? activeTotal : totalEstornos, count: movSubTab === 'estornos' ? activeCount : estornos.length, active: 'bg-orange-50 border-orange-400', inactive: 'bg-white border-gray-200', textActive: 'text-orange-700', textInactive: 'text-orange-500' },
    { key: 'transferencias' as const, label: 'Sangrias/Repasses', total: movSubTab === 'transferencias' ? activeTotal : totalTransferencias, count: movSubTab === 'transferencias' ? activeCount : transferencias.length, active: 'bg-indigo-50 border-indigo-400', inactive: 'bg-white border-gray-200', textActive: 'text-indigo-700', textInactive: 'text-indigo-500' },
  ]

  const amountColor =
    movSubTab === 'entradas' ? 'text-green-600' :
    movSubTab === 'despesas' ? 'text-red-600' :
    movSubTab === 'estornos' ? 'text-orange-600' :
    'text-blue-600'

  const openEditModal = (t: Tx) => {
    setEditTarget(t); setEditAmount(t.amount); setEditDesc(t.description)
    setEditPmId(''); setEditPassword(''); setEditCashSessionId('')
    api.get<{ id: string; opened_by_name: string; opened_at: string }[]>('/finance/sessions/open-picker')
      .then(r => setEditSessions(r.data)).catch(() => setEditSessions([]))
  }

  const handleEditTx = async () => {
    if (!editTarget || !editPassword.trim()) { toast.error('Senha obrigatória.'); return }
    setEditing(true)
    try {
      const body: Record<string, any> = { admin_password: editPassword }
      if (editAmount) body.amount = editAmount
      if (editPmId) body.payment_method_id = editPmId
      if (editDesc) body.description = editDesc
      if (editCashSessionId) body.cash_session_id = editCashSessionId
      await api.patch(`/finance/transactions/${editTarget.id}/correct`, body)
      toast.success('Lançamento corrigido.')
      setEditTarget(null); setEditAmount(''); setEditPmId(''); setEditDesc(''); setEditPassword(''); setEditCashSessionId('')
      loadTransactions()
    } catch (e: any) {
      const d = e.response?.data?.detail
      toast.error(typeof d === 'string' ? d : 'Erro ao corrigir.')
    } finally { setEditing(false) }
  }

  const handleReversal = async () => {
    if (!reversalTarget || !reversalReason.trim()) return
    if (!reversalPassword.trim()) { toast.error('Senha de administrador obrigatória.'); return }
    setReversing(reversalTarget.id)
    try {
      await api.post(`/finance/transactions/${reversalTarget.id}/reverse`, {
        reason: reversalReason.trim(),
        admin_password: reversalPassword.trim(),
      })
      toast.success('Estorno realizado!')
      setReversalTarget(null)
      setReversalReason('')
      setReversalPassword('')
      loadTransactions()
    } catch (e: any) {
      const d = e.response?.data?.detail
      toast.error(typeof d === 'string' ? d : 'Erro ao estornar.')
    } finally { setReversing(null) }
  }

  const handleReprint = async (txId: string) => {
    setReprinting(txId)
    try {
      const res = await api.get(`/finance/proof-of-residence/${txId}/reprint`, { responseType: 'blob' })
      const url = URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }))
      window.open(url, '_blank')
    } catch {
      toast.error('Erro ao gerar 2ª via.')
    } finally { setReprinting(null) }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2">
        {(['week', 'month', 'year'] as const).map(p => (
          <button key={p} onClick={() => setPeriod(p)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${period === p ? 'bg-[#26619c] text-white' : 'bg-gray-100 text-gray-600'}`}>
            {p === 'week' ? 'Semana' : p === 'month' ? 'Mês' : 'Ano'}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 px-4 py-3 flex items-center justify-between">
        <span className="text-xs text-gray-500 font-medium">Resultado líquido — {PERIOD_LABEL[period]}</span>
        <span className={`text-base font-black ${resultado >= 0 ? 'text-green-700' : 'text-red-700'}`}>
          {resultado >= 0 ? '+' : ''}{fmt(resultado)}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {tabCfg.map(c => (
          <button key={c.key} onClick={() => { setMovSubTab(c.key); setMovSubtypeFilter(null) }}
            className={`rounded-xl p-3 text-left border-2 transition ${movSubTab === c.key ? c.active : c.inactive}`}>
            <p className="text-[11px] text-gray-500 mb-0.5">{c.label}</p>
            <p className={`text-base font-bold leading-tight ${movSubTab === c.key ? c.textActive : c.textInactive}`}>{fmt(c.total)}</p>
            <p className="text-[10px] text-gray-400 mt-0.5">{c.count} lançamento{c.count !== 1 ? 's' : ''}</p>
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-2">
        {movSubTab === 'entradas' && (
          <div className="flex gap-1.5 flex-wrap">
            <button onClick={() => setMovSubtypeFilter(null)}
              className={`text-xs px-2.5 py-1 rounded-full font-medium transition ${movSubtypeFilter === null ? 'bg-[#26619c] text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
              Todos
            </button>
            {Object.entries(SUBTYPE_LABELS).map(([key, label]) =>
              entradas.some(t => t.income_subtype === key) && (
                <button key={key} onClick={() => setMovSubtypeFilter(f => f === key ? null : key)}
                  className={`text-xs px-2.5 py-1 rounded-full font-medium transition ${movSubtypeFilter === key ? SUBTYPE_COLORS[key] + ' ring-2 ring-offset-1' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                  {label}
                </button>
              )
            )}
          </div>
        )}
        {opNames.length > 0 && (
          <select value={txFilterOp ?? ''} onChange={e => setTxFilterOp(e.target.value || null)}
            className="text-xs border border-gray-200 rounded-lg px-2 py-1 text-gray-600 bg-white">
            <option value="">Todos os operadores</option>
            {opNames.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        )}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        {loadingTx ? (
          <div className="p-6 text-center text-gray-400 text-sm">Carregando…</div>
        ) : rows.length === 0 ? (
          <div className="p-6 text-center text-gray-400 text-sm">Nenhum lançamento no período.</div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {rows.map(t => (
              <li key={t.id} className="px-4 py-3 flex items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 flex-wrap mb-0.5">
                    {t.income_subtype && (
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${SUBTYPE_COLORS[t.income_subtype] ?? 'bg-gray-100 text-gray-600'}`}>
                        {SUBTYPE_LABELS[t.income_subtype] ?? t.income_subtype}
                      </span>
                    )}
                    {t.payment_method_name && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500 font-medium">
                        {t.payment_method_name}
                      </span>
                    )}
                    {movSubTab === 'transferencias' && (
                      t.description?.startsWith('Repasse para caixinha') ? (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-indigo-50 text-indigo-600 font-medium">Repasse</span>
                      ) : (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-600 font-medium">Sangria</span>
                      )
                    )}
                    {movSubTab === 'estornos' && (
                      <span className="text-[10px] px-1.5 py-0.5 bg-orange-50 text-orange-600 rounded-full font-medium">dedução de receita</span>
                    )}
                  </div>
                  <p className="text-sm font-medium truncate text-gray-800">
                    {parseTxName(t.description, t.income_subtype, t.resident_name)}
                  </p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {fmtDate(t.transaction_at)}
                    {t.created_by_name && <span className="ml-1.5 text-[10px] text-gray-400">· {t.created_by_name}</span>}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className={`text-sm font-bold ${amountColor}`}>{fmt(t.amount)}</span>
                  {movSubTab === 'entradas' && !t.reversed_at && !t.is_reversal && (
                    <>
                      <button onClick={() => openEditModal(t)} title="Corrigir"
                        className="p-1.5 text-gray-400 hover:text-blue-500 rounded-lg hover:bg-blue-50 transition">
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => { setReversalTarget(t); setReversalReason('') }} title="Estornar"
                        className="p-1.5 text-gray-400 hover:text-red-500 rounded-lg hover:bg-red-50 transition">
                        <RotateCcw className="w-3.5 h-3.5" />
                      </button>
                    </>
                  )}
                  {movSubTab === 'despesas' && !t.is_reversal && (
                    <button onClick={() => openEditModal(t)} title="Corrigir"
                      className="p-1.5 text-gray-400 hover:text-blue-500 rounded-lg hover:bg-blue-50 transition">
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                  )}
                  {t.income_subtype === 'proof_of_residence' && (
                    <button onClick={() => handleReprint(t.id)} disabled={reprinting === t.id} title="2ª via"
                      className="p-1.5 text-purple-400 hover:text-purple-600 rounded-lg hover:bg-purple-50 transition">
                      <Printer className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Edit modal */}
      {editTarget && (
        <div className="fixed inset-0 z-[60] bg-black/40 flex items-end sm:items-center justify-center p-4">
          <div className="w-full max-w-sm bg-white rounded-2xl shadow-2xl p-5 flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-gray-900">Corrigir Lançamento</h3>
              <button onClick={() => setEditTarget(null)}><X className="w-5 h-5 text-gray-400" /></button>
            </div>
            <div className="bg-blue-50 border border-blue-200 rounded-lg px-3 py-2">
              <p className="text-xs text-gray-500 truncate">{editTarget.description}</p>
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">Descrição</label>
              <input value={editDesc} onChange={e => setEditDesc(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">Valor (R$)</label>
              <input type="number" step="0.01" value={editAmount} onChange={e => setEditAmount(e.target.value)} className={inputCls} />
            </div>
            {paymentMethods.length > 0 && (
              <div>
                <label className="block text-xs text-gray-600 mb-1">Forma de pagamento</label>
                <select value={editPmId} onChange={e => setEditPmId(e.target.value)} className={inputCls}>
                  <option value="">Manter atual</option>
                  {paymentMethods.map(pm => <option key={pm.id} value={pm.id}>{pm.name}</option>)}
                </select>
              </div>
            )}
            {editSessions.length > 0 && (
              <div>
                <label className="block text-xs text-gray-600 mb-1">Mover para caixa</label>
                <select value={editCashSessionId} onChange={e => setEditCashSessionId(e.target.value)} className={inputCls}>
                  <option value="">Manter caixa atual</option>
                  {editSessions.map(s => (
                    <option key={s.id} value={s.id}>
                      {s.opened_by_name} — {new Date(s.opened_at).toLocaleDateString('pt-BR')}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div>
              <label className="block text-xs text-gray-600 mb-1">Senha de administrador *</label>
              <input type="password" value={editPassword} onChange={e => setEditPassword(e.target.value)} className={inputCls} placeholder="Senha de admin" />
            </div>
            <div className="flex gap-2">
              <button onClick={() => setEditTarget(null)} className="flex-1 border border-gray-300 text-gray-600 py-2.5 rounded-xl text-sm hover:bg-gray-50 transition">Cancelar</button>
              <button onClick={handleEditTx} disabled={!editPassword.trim() || editing}
                className="flex-1 bg-[#26619c] hover:bg-[#1a4f87] text-white py-2.5 rounded-xl text-sm font-semibold transition disabled:opacity-50">
                {editing ? 'Salvando…' : 'Salvar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reversal modal */}
      {reversalTarget && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-4">
          <div className="w-full max-w-sm bg-white rounded-2xl shadow-2xl p-5 flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-gray-900">Estornar Transação</h3>
              <button onClick={() => { setReversalTarget(null); setReversalReason(''); setReversalPassword('') }}><X className="w-5 h-5 text-gray-400" /></button>
            </div>
            <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2.5">
              <p className="text-sm font-medium text-gray-800">{reversalTarget.description}</p>
              <p className="text-lg font-bold text-red-600">- {fmt(reversalTarget.amount)}</p>
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">Motivo do estorno *</label>
              <input
                value={reversalReason}
                onChange={e => setReversalReason(e.target.value)}
                className={inputCls}
                placeholder="Descreva o motivo…"
                autoFocus
              />
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">Senha de administrador *</label>
              <input
                type="password"
                value={reversalPassword}
                onChange={e => setReversalPassword(e.target.value)}
                className={inputCls}
                placeholder="Senha de admin"
              />
            </div>
            <div className="flex gap-2">
              <button onClick={() => { setReversalTarget(null); setReversalReason(''); setReversalPassword('') }}
                className="flex-1 border border-gray-300 text-gray-600 py-2.5 rounded-xl text-sm hover:bg-gray-50 transition">
                Cancelar
              </button>
              <button
                onClick={handleReversal}
                disabled={!reversalReason.trim() || !reversalPassword.trim() || reversing === reversalTarget.id}
                className="flex-1 bg-red-500 hover:bg-red-600 text-white py-2.5 rounded-xl text-sm font-semibold transition disabled:opacity-50">
                {reversing === reversalTarget.id ? 'Estornando…' : 'Confirmar Estorno'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
