import { useEffect, useState } from 'react'
import { Pencil, Trash2 } from 'lucide-react'
import api from '../../../services/api'
import toast from 'react-hot-toast'
import { fmt } from '../utils/formatters'
import { useFinanceiro } from '../contexts/FinanceiroContext'
import { SaldoConsolidado } from '../components/SaldoConsolidado'
import { useAuthStore } from '../../../store/authStore'
import type { CashBox, BoxMovement, Tesouraria } from '../types/financeiro'

interface Props {
  onRequestAdminClose?: (target: { id: string; operador: string }) => void
}

export default function TransferenciasTab({ onRequestAdminClose }: Props) {
  const { openSession } = useFinanceiro()
  const role = useAuthStore(s => s.role)
  const isAdmin = ['admin', 'admin_master', 'superadmin'].includes(role ?? '')

  const [cashBoxes, setCashBoxes] = useState<CashBox[]>([])
  const [boxSummary, setBoxSummary] = useState<{ open_session_balance: string | null; total_in_boxes: string; sangria_by_destination: { destination: string; total: string }[] } | null>(null)
  const [loadingBoxes, setLoadingBoxes] = useState(false)
  const [tesouraria, setTesouraria] = useState<Tesouraria | null>(null)

  const [transferTarget, setTransferTarget] = useState<{ id: string; opened_at: string; operador_name?: string; closing_balance?: string } | null>(null)
  const [transferBoxId, setTransferBoxId] = useState('')
  const [transferAmt, setTransferAmt] = useState('')
  const [transferring, setTransferring] = useState(false)
  const [transferTroco, setTransferTroco] = useState('0')
  const [transferClose, setTransferClose] = useState(true)

  const [selectedBox, setSelectedBox] = useState<CashBox | null>(null)
  const [boxMovements, setBoxMovements] = useState<BoxMovement[]>([])
  const [showBoxForm, setShowBoxForm] = useState(false)
  const [boxForm, setBoxForm] = useState({ name: '', description: '', is_malote: false, is_cofre: false })
  const [editBox, setEditBox] = useState<CashBox | null>(null)
  const [showMoveForm, setShowMoveForm] = useState(false)
  const [moveForm, setMoveForm] = useState({ amount: '', movement_type: 'credit', description: '' })
  const [savingBox, setSavingBox] = useState(false)

  const [boxTransferSource, setBoxTransferSource] = useState<CashBox | null>(null)
  const [boxTransferDest, setBoxTransferDest] = useState('')
  const [boxTransferAmt, setBoxTransferAmt] = useState('')
  const [boxTransferDesc, setBoxTransferDesc] = useState('')
  const [boxTransferring, setBoxTransferring] = useState(false)

  useEffect(() => { loadBoxSummary() }, [])

  const loadBoxSummary = async () => {
    setLoadingBoxes(true)
    try {
      const [sumR, boxR, tesR] = await Promise.all([
        api.get('/cash-boxes/summary'),
        api.get<CashBox[]>('/cash-boxes'),
        api.get('/finance/tesouraria'),
      ])
      setBoxSummary(sumR.data)
      setCashBoxes(boxR.data)
      setTesouraria(tesR.data)
    } catch { /* ignore */ } finally { setLoadingBoxes(false) }
  }

  const handleTransferConferido = async () => {
    if (!transferTarget || !transferBoxId || !transferAmt) return
    setTransferring(true)
    try {
      await api.post(`/finance/sessions/${transferTarget.id}/transfer-to-cashbox`, {
        cash_box_id: transferBoxId,
        amount: parseFloat(transferAmt),
        troco: parseFloat(transferTroco) || 0,
        close_session: transferClose,
      })
      toast.success('Repasse realizado!' + (transferClose ? ' Caixa fechado.' : ''))
      setTransferTarget(null)
      setTransferBoxId('')
      setTransferAmt('')
      setTransferTroco('0')
      loadBoxSummary()
    } catch (e: any) {
      toast.error(e.response?.data?.detail ?? 'Erro ao transferir.')
    } finally { setTransferring(false) }
  }

  const loadBoxMovements = async (boxId: string) => {
    try { const r = await api.get<BoxMovement[]>(`/cash-boxes/${boxId}/movements`); setBoxMovements(r.data) } catch { setBoxMovements([]) }
  }

  const handleSaveBox = async () => {
    if (!boxForm.name.trim()) return
    setSavingBox(true)
    try {
      if (editBox) {
        await api.put(`/cash-boxes/${editBox.id}`, boxForm)
      } else {
        await api.post('/cash-boxes', boxForm)
      }
      setShowBoxForm(false); setEditBox(null); setBoxForm({ name: '', description: '', is_malote: false, is_cofre: false })
      loadBoxSummary()
    } catch { /* ignore */ } finally { setSavingBox(false) }
  }

  const handleDeactivateBox = async (id: string) => {
    if (!window.confirm('Desativar esta caixinha?')) return
    try {
      await api.delete(`/cash-boxes/${id}`)
      loadBoxSummary()
      if (selectedBox?.id === id) setSelectedBox(null)
    } catch (e: any) {
      toast.error(e.response?.data?.detail ?? 'Erro ao desativar caixinha.')
    }
  }

  const handleAddMovement = async () => {
    if (!selectedBox || !moveForm.amount || !moveForm.description) return
    setSavingBox(true)
    try {
      await api.post(`/cash-boxes/${selectedBox.id}/movements`, {
        amount: parseFloat(moveForm.amount),
        movement_type: moveForm.movement_type,
        description: moveForm.description,
      })
      setShowMoveForm(false); setMoveForm({ amount: '', movement_type: 'credit', description: '' })
      loadBoxSummary()
      loadBoxMovements(selectedBox.id)
    } catch { /* ignore */ } finally { setSavingBox(false) }
  }

  const handleBoxTransfer = async () => {
    if (!boxTransferSource || !boxTransferDest || !boxTransferAmt || !boxTransferDesc) return
    setBoxTransferring(true)
    try {
      await api.post(`/cash-boxes/${boxTransferSource.id}/transfer`, {
        destination_id: boxTransferDest,
        amount: parseFloat(boxTransferAmt),
        description: boxTransferDesc,
      })
      toast.success('Transferência realizada!')
      setBoxTransferSource(null)
      setBoxTransferDest('')
      setBoxTransferAmt('')
      setBoxTransferDesc('')
      loadBoxSummary()
    } catch (e: any) {
      toast.error(e.response?.data?.detail ?? 'Erro ao transferir.')
    } finally { setBoxTransferring(false) }
  }

  return (
    <div className="flex flex-col gap-4">
      {loadingBoxes ? (
        <div className="text-center text-gray-400 text-sm py-8">Carregando…</div>
      ) : (
        <>
          {tesouraria && tesouraria.conferido_sessions.length > 0 && (
            <div className="bg-amber-50 rounded-xl border border-amber-300">
              <div className="px-4 py-3 border-b border-amber-200 flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-amber-900">⚡ Repasse Pendente</h3>
                  <p className="text-xs text-amber-700 mt-0.5">{tesouraria.conferido_sessions.length} sessão(ões) conferida(s) aguardando repasse para caixinha</p>
                </div>
                <span className="text-sm font-bold text-amber-800">
                  {fmt(tesouraria.conferido_sessions.reduce((s, c) => s + parseFloat(c.remaining ?? '0'), 0))}
                </span>
              </div>
              <ul className="divide-y divide-amber-100">
                {tesouraria.conferido_sessions.map(s => (
                  <li key={s.id} className="px-4 py-3 flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium text-gray-800">{new Date(s.opened_at).toLocaleDateString('pt-BR')} · {s.operador}</p>
                      <p className="text-xs font-semibold text-amber-700 mt-0.5">
                        Contado: {fmt(s.closing_balance ?? '0')}
                        {parseFloat(s.already_transferred) > 0 && (
                          <span className="ml-2 text-gray-500">· já repassado: {fmt(s.already_transferred)}</span>
                        )}
                        {s.difference && parseFloat(s.difference) !== 0 && (
                          <span className={`ml-2 ${parseFloat(s.difference) < 0 ? 'text-red-600' : 'text-green-600'}`}>
                            ({parseFloat(s.difference) > 0 ? '+' : ''}{fmt(s.difference)})
                          </span>
                        )}
                      </p>
                      <p className="text-xs font-bold text-amber-900 mt-0.5">A repassar: {fmt(s.remaining)}</p>
                    </div>
                    <button
                      onClick={() => {
                        setTransferTarget({ id: s.id, opened_at: s.opened_at, operador_name: s.operador, closing_balance: s.closing_balance ?? undefined })
                        setTransferAmt(s.remaining)
                        setTransferTroco('0')
                        setTransferClose(true)
                        setTransferBoxId('')
                      }}
                      className="text-xs bg-amber-500 hover:bg-amber-600 text-white font-semibold px-3 py-1.5 rounded-lg transition whitespace-nowrap"
                    >
                      Repassar
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {tesouraria && tesouraria.open_sessions.length > 0 && (
            <div className="bg-white rounded-xl border border-blue-200 shadow-sm overflow-hidden">
              <div className="px-4 py-3 border-b border-blue-100 bg-blue-50 flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-blue-800">Caixas Abertos</h3>
                  <p className="text-xs text-blue-600 mt-0.5">{tesouraria.open_sessions.length} caixa(s) com operador agora</p>
                </div>
                <span className="text-sm font-bold text-blue-800">
                  {fmt(tesouraria.open_sessions.reduce((s, c) => s + parseFloat(c.expected_balance ?? '0'), 0))}
                </span>
              </div>
              <ul className="divide-y divide-gray-100">
                {tesouraria.open_sessions.map(s => (
                  <li key={s.id} className="px-4 py-3 flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium text-gray-800">{s.operador}</p>
                      <p className="text-xs text-gray-500">Aberto em {new Date(s.opened_at).toLocaleString('pt-BR')}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-bold text-blue-700">{fmt(s.expected_balance)}</span>
                      {isAdmin && onRequestAdminClose && (
                        <button
                          onClick={() => onRequestAdminClose({ id: s.id, operador: s.operador })}
                          className="text-xs bg-red-50 text-red-600 border border-red-200 rounded-lg px-2 py-1 hover:bg-red-100 whitespace-nowrap"
                        >
                          Fechar
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-gray-800">Caixinhas</h3>
                {boxSummary && <p className="text-xs text-gray-500 mt-0.5">Total: <b className="text-indigo-700">{fmt(boxSummary.total_in_boxes)}</b></p>}
              </div>
              <button onClick={() => { setEditBox(null); setBoxForm({ name: '', description: '', is_malote: false, is_cofre: false }); setShowBoxForm(true) }}
                className="text-xs bg-indigo-600 text-white px-3 py-1.5 rounded-lg font-medium">+ Nova</button>
            </div>
            {cashBoxes.length === 0 ? (
              <p className="p-4 text-sm text-gray-400">Nenhuma caixinha cadastrada.</p>
            ) : (
              <ul className="divide-y divide-gray-100">
                {cashBoxes.map(box => (
                  <li key={box.id} className="px-4 py-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-indigo-400 shrink-0" />
                        <div>
                          <div className="flex items-center gap-1.5">
                            <p className="text-sm font-semibold text-gray-800">{box.name}</p>
                            {box.is_malote && <span className="px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-amber-100 text-amber-700">Malote</span>}
                            {box.is_cofre && <span className="px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 text-slate-700">Cofre</span>}
                          </div>
                          {box.description && <p className="text-xs text-gray-400">{box.description}</p>}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-base font-bold text-indigo-700">{fmt(box.balance)}</span>
                        <button onClick={() => { setEditBox(box); setBoxForm({ name: box.name, description: box.description ?? '', is_malote: box.is_malote ?? false, is_cofre: box.is_cofre ?? false }); setShowBoxForm(true) }}
                          className="text-gray-300 hover:text-gray-500 p-1"><Pencil className="w-3.5 h-3.5" /></button>
                        <button onClick={() => handleDeactivateBox(box.id)} className="text-red-300 hover:text-red-500 p-1">
                          <Trash2 className="w-3.5 h-3.5" /></button>
                      </div>
                    </div>
                    <div className="flex gap-2 mt-2.5">
                      <button onClick={() => { setSelectedBox(box); setMoveForm({ amount: '', movement_type: 'credit', description: '' }); setShowMoveForm(true); loadBoxMovements(box.id) }}
                        className="flex-1 text-xs bg-green-50 text-green-700 border border-green-200 py-1.5 rounded-lg font-medium text-center">+ Entrada</button>
                      <button onClick={() => { setSelectedBox(box); setMoveForm({ amount: '', movement_type: 'debit', description: '' }); setShowMoveForm(true); loadBoxMovements(box.id) }}
                        className="flex-1 text-xs bg-red-50 text-red-700 border border-red-200 py-1.5 rounded-lg font-medium text-center">− Saída</button>
                      <button onClick={() => { setSelectedBox(box); setShowMoveForm(false); loadBoxMovements(box.id) }}
                        className="flex-1 text-xs bg-gray-100 text-gray-600 py-1.5 rounded-lg font-medium text-center">Histórico</button>
                      {cashBoxes.filter(b => b.id !== box.id && b.is_active).length > 0 && (
                        <button onClick={() => { setBoxTransferSource(box); setBoxTransferDest(''); setBoxTransferAmt(''); setBoxTransferDesc('') }}
                          className="flex-1 text-xs bg-indigo-50 text-indigo-700 border border-indigo-200 py-1.5 rounded-lg font-medium text-center">↗ Transferir</button>
                      )}
                    </div>
                    {selectedBox?.id === box.id && !showMoveForm && boxMovements.length > 0 && (
                      <div className="mt-2 border-t border-gray-100 pt-2">
                        <ul className="flex flex-col gap-1 max-h-40 overflow-y-auto">
                          {boxMovements.slice(0, 10).map(m => (
                            <li key={m.id} className="flex justify-between text-xs text-gray-500">
                              <span className="truncate max-w-[60%]">{m.description}</span>
                              <span className={m.movement_type === 'credit' ? 'text-green-600 font-medium' : 'text-red-600 font-medium'}>
                                {m.movement_type === 'credit' ? '+' : '−'}{fmt(m.amount)}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div className="bg-white rounded-xl border border-gray-200 p-3 text-center">
              <p className="text-[10px] text-gray-500 mb-1">Hoje</p>
              <p className="text-sm font-bold text-green-700">{tesouraria ? fmt(tesouraria.faturamento_hoje) : '—'}</p>
            </div>
            <div className="bg-white rounded-xl border border-amber-100 p-3 text-center">
              <p className="text-[10px] text-gray-500 mb-1">A Repassar</p>
              <p className="text-sm font-bold text-amber-700">{tesouraria ? fmt(tesouraria.total_limbo) : '—'}</p>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 p-3 text-center">
              <p className="text-[10px] text-gray-500 mb-1">PAP Hoje</p>
              <p className="text-sm font-bold text-green-700">{tesouraria ? fmt(tesouraria.pap_today.total) : '—'}</p>
              <p className="text-[10px] text-gray-400">{tesouraria?.pap_today.count ?? 0} pgtos</p>
            </div>
          </div>

          <SaldoConsolidado />

          {boxSummary && boxSummary.sangria_by_destination.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
              <p className="text-sm font-semibold text-gray-800 mb-3">Sangrias — últimos 30 dias</p>
              <ul className="flex flex-col gap-1">
                {boxSummary.sangria_by_destination.map((s, i) => (
                  <li key={i} className="flex justify-between text-sm">
                    <span className="text-gray-600">{s.destination}</span>
                    <span className="font-semibold text-amber-700">{fmt(s.total)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}

      {/* Transfer conferido → caixinha modal */}
      {transferTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm p-5 flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-gray-800">Transferir para caixinha</h2>
              <button onClick={() => setTransferTarget(null)} className="text-gray-400 text-xl">×</button>
            </div>
            <div>
              <p className="text-xs text-gray-500">Sessão de {new Date(transferTarget.opened_at).toLocaleDateString('pt-BR')} — {transferTarget.operador_name ?? ''}</p>
              <p className="text-xs text-blue-700 font-medium mt-0.5">Contado: R$ {parseFloat(transferTarget.closing_balance!).toFixed(2)}</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Valor a repassar (R$)</label>
                <input type="number" min="0.01" step="0.01" value={transferAmt} onChange={e => setTransferAmt(e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Troco que fica (R$)</label>
                <input type="number" min="0" step="0.01" value={transferTroco} onChange={e => setTransferTroco(e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
              </div>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Caixinha destino</label>
              <select value={transferBoxId} onChange={e => setTransferBoxId(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">
                <option value="">Selecione…</option>
                {cashBoxes.map(b => (
                  <option key={b.id} value={b.id}>{b.name} — R$ {parseFloat(b.balance).toFixed(2)}</option>
                ))}
              </select>
            </div>
            <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
              <input type="checkbox" checked={transferClose} onChange={e => setTransferClose(e.target.checked)} className="w-4 h-4 rounded" />
              Fechar sessão após transferência
            </label>
            <div className="flex gap-2">
              <button onClick={() => setTransferTarget(null)} className="flex-1 border border-gray-200 text-gray-600 py-2 rounded-xl text-sm">Cancelar</button>
              <button onClick={handleTransferConferido} disabled={!transferBoxId || !transferAmt || transferring}
                className="flex-1 bg-amber-500 hover:bg-amber-600 text-white py-2 rounded-xl text-sm font-semibold disabled:opacity-50">
                {transferring ? 'Transferindo…' : 'Confirmar repasse'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Transferência entre caixinhas modal */}
      {boxTransferSource && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm p-5 flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-gray-800">Transferir entre caixinhas</h2>
              <button onClick={() => setBoxTransferSource(null)} className="text-gray-400 text-xl">×</button>
            </div>
            <p className="text-xs text-gray-500">
              Origem: <span className="font-semibold text-gray-700">{boxTransferSource.name}</span>
              {boxTransferSource.is_malote && <span className="ml-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-amber-100 text-amber-700">Malote</span>}
              <span className="ml-1 text-indigo-700 font-medium">· Saldo: R$ {parseFloat(boxTransferSource.balance).toFixed(2)}</span>
            </p>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Destino</label>
              <select value={boxTransferDest} onChange={e => setBoxTransferDest(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">
                <option value="">Selecione…</option>
                {cashBoxes.filter(b => b.id !== boxTransferSource.id && b.is_active).map(b => (
                  <option key={b.id} value={b.id}>{b.name}{b.is_malote ? ' (Malote)' : b.is_cofre ? ' (Cofre)' : ''} — R$ {parseFloat(b.balance).toFixed(2)}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Valor (R$)</label>
              <input type="number" min="0.01" step="0.01" value={boxTransferAmt} onChange={e => setBoxTransferAmt(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Descrição</label>
              <input type="text" value={boxTransferDesc} onChange={e => setBoxTransferDesc(e.target.value)}
                placeholder="Ex: Recolhimento semanal"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div className="flex gap-2">
              <button onClick={() => setBoxTransferSource(null)} className="flex-1 border border-gray-200 text-gray-600 py-2 rounded-xl text-sm">Cancelar</button>
              <button onClick={handleBoxTransfer} disabled={!boxTransferDest || !boxTransferAmt || !boxTransferDesc || boxTransferring}
                className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white py-2 rounded-xl text-sm font-semibold disabled:opacity-50">
                {boxTransferring ? 'Transferindo…' : 'Confirmar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Box form modal */}
      {showBoxForm && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl w-full max-w-md p-5 flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-gray-800">{editBox ? 'Editar Caixinha' : 'Nova Caixinha'}</h2>
              <button onClick={() => setShowBoxForm(false)} className="text-gray-400 text-xl">×</button>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Nome *</label>
              <input value={boxForm.name} onChange={e => setBoxForm(f => ({ ...f, name: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" placeholder="Ex: Cofre, Banco X…" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Descrição</label>
              <input value={boxForm.description} onChange={e => setBoxForm(f => ({ ...f, description: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" placeholder="Opcional" />
            </div>
            <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
              <input type="checkbox" checked={boxForm.is_malote} onChange={e => setBoxForm(f => ({ ...f, is_malote: e.target.checked }))} className="w-4 h-4 rounded" />
              É um Malote (recebe dinheiro físico do fechamento)
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
              <input type="checkbox" checked={boxForm.is_cofre} onChange={e => setBoxForm(f => ({ ...f, is_cofre: e.target.checked }))} className="w-4 h-4 rounded" />
              É um Cofre (reserva permanente da associação)
            </label>
            <button onClick={handleSaveBox} disabled={savingBox}
              className="w-full bg-indigo-600 text-white py-2.5 rounded-xl text-sm font-semibold disabled:opacity-50">
              {savingBox ? 'Salvando…' : 'Salvar'}
            </button>
          </div>
        </div>
      )}

      {/* Movement modal */}
      {showMoveForm && selectedBox && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl w-full max-w-md p-5 flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-gray-800">
                {moveForm.movement_type === 'credit' ? 'Entrada' : 'Saída'} — {selectedBox.name}
              </h2>
              <button onClick={() => setShowMoveForm(false)} className="text-gray-400 text-xl">×</button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Tipo</label>
                <select value={moveForm.movement_type} onChange={e => setMoveForm(f => ({ ...f, movement_type: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white">
                  <option value="credit">Entrada (+)</option>
                  <option value="debit">Saída (−)</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Valor (R$)</label>
                <input type="number" min="0.01" step="0.01" value={moveForm.amount}
                  onChange={e => setMoveForm(f => ({ ...f, amount: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
              </div>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Descrição *</label>
              <input value={moveForm.description} onChange={e => setMoveForm(f => ({ ...f, description: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" placeholder="Ex: Depósito do caixa do dia" />
            </div>
            <button onClick={handleAddMovement} disabled={savingBox}
              className="w-full bg-indigo-600 text-white py-2.5 rounded-xl text-sm font-semibold disabled:opacity-50">
              {savingBox ? 'Salvando…' : 'Confirmar'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
