import { useEffect, useState } from 'react'
import { X, ChevronLeft, ChevronRight, CheckCircle2, AlertCircle, ClipboardList, Calculator, Award, ArrowRight, Eye, RefreshCw, Pencil, Banknote, Send } from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../../services/api'

interface Session {
  id: string; status: string
  closing_balance: string | null
  expected_balance: string | null
  difference: string | null
  opened_at: string; closed_at: string | null
  operador_name?: string; conferido_por?: string
  total_pix?: string; total_dinheiro?: string
  total_bruto?: string; total_baixas?: string; total_expense?: string
  quebra_caixa?: string | null
  malote_sent_at?: string | null
  blind_pix?: string | null
  blind_dinheiro?: string | null
  troco_deixado?: string | null
}

interface TxReview {
  id: string; type: string; income_subtype?: string | null; amount: string
  description: string; transaction_at: string; is_sangria: boolean
  created_by_name?: string; conferido: boolean; observacao?: string | null
  payment_method_name?: string | null; reversed_at?: string | null
  resident_name?: string | null
}

interface CashBox {
  id: string; name: string; balance: string; is_active: boolean; is_malote?: boolean
}

interface Conferente { id: string; full_name: string; role: string }

interface Props {
  session: Session
  txs: TxReview[]
  conferentes: Conferente[]
  onClose: () => void
  onSaved: () => void
  onEditTx: (tx: TxReview) => void
}

const fmt = (v: string | number) =>
  `R$ ${parseFloat(String(v)).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

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

const STEPS = [
  { label: 'Resumo', icon: Eye },
  { label: 'Lançamentos', icon: ClipboardList },
  { label: 'Contagem', icon: Calculator },
  { label: 'Confirmar', icon: Award },
  { label: 'Repasse', icon: ArrowRight },
]

export function CaixaConferenciaModal({ session, txs: initialTxs, conferentes, onClose, onSaved, onEditTx }: Props) {
  const [step, setStep] = useState(0)
  const [txs, setTxs] = useState<TxReview[]>(initialTxs)
  const [contagemInput, setContagemInput] = useState(session.closing_balance ?? '')
  const [conferidoPor, setConferidoPor] = useState('')
  const [observacaoGeral, setObservacaoGeral] = useState('')
  const [saving, setSaving] = useState(false)
  const [savedConferencia, setSavedConferencia] = useState(session.status === 'conferido')

  // Repasse
  const [cashBoxes, setCashBoxes] = useState<CashBox[]>([])
  const [loadingBoxes, setLoadingBoxes] = useState(false)
  const [repasses, setRepasses] = useState<{ boxId: string; amount: string }[]>([{ boxId: '', amount: '' }])
  const [transferring, setTransferring] = useState(false)
  const [transfersDone, setTransfersDone] = useState<string[]>([])

  // PIX reconciliation
  const [pixSyncLoading, setPixSyncLoading] = useState(false)
  const [pixSyncResult, setPixSyncResult] = useState<{ synced: number; mode: 'reconciled' | 'batched' } | null>(null)

  const bruto = parseFloat(session.total_bruto ?? '0')
  const baixas = parseFloat(session.total_baixas ?? '0')
  const expense = parseFloat(session.total_expense ?? '0')
  const pix = parseFloat(session.total_pix ?? '0')
  const dinheiro = parseFloat(session.total_dinheiro ?? '0')
  const liquido = bruto - baixas - expense
  const contagem = parseFloat(contagemInput || '0')
  const diferenca = contagemInput !== '' && !isNaN(contagem) ? contagem - liquido : null

  const naoConferidos = txs.filter(t => !t.reversed_at && !t.conferido)
  const irregularesSemObs = naoConferidos.filter(t => !t.observacao?.trim())

  const transferredAmount = repasses
    .filter(r => transfersDone.includes(r.boxId))
    .reduce((s, r) => s + (parseFloat(r.amount) || 0), 0)
  const repasseTotal = repasses.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0)
  // Espécie = contagem total − PIX (PIX é eletrônico, não sai fisicamente)
  const especie = isNaN(contagem) || contagemInput === '' ? dinheiro : Math.max(0, contagem - pix)
  const disponivelReal = especie - transferredAmount
  const repasseRestante = especie - repasseTotal

  const isAlreadyConferido = session.status === 'conferido' || savedConferencia

  useEffect(() => {
    if (step === 4) loadBoxes()
  }, [step])

  const loadBoxes = async () => {
    setLoadingBoxes(true)
    try {
      const res = await api.get<CashBox[]>('/cash-boxes')
      setCashBoxes(res.data.filter(b => b.is_active))
    } catch { /* silent */ } finally { setLoadingBoxes(false) }
  }

  const handleSaveConferencia = async () => {
    setSaving(true)
    try {
      await api.put(`/finance/sessions/${session.id}/reviews`, {
        reviews: txs.map(t => ({ transaction_id: t.id, conferido: t.conferido, observacao: t.observacao || null })),
        reviewed_by_id: conferidoPor || null,
        closing_balance: contagemInput !== '' ? parseFloat(contagemInput) : undefined,
        notes: observacaoGeral || null,
      })
      setSavedConferencia(true)
      toast.success('Conferência salva! Sessão marcada como conferida.')
      onSaved()
      setStep(4)
    } catch (e: any) {
      toast.error(e.response?.data?.detail ?? 'Erro ao salvar.')
    } finally {
      setSaving(false)
    }
  }

  const handleTransfer = async (i: number) => {
    const rep = repasses[i]
    if (!rep.boxId || !rep.amount || parseFloat(rep.amount) <= 0) {
      toast.error('Selecione a caixinha e informe o valor.')
      return
    }
    setTransferring(true)
    try {
      await api.post(`/finance/sessions/${session.id}/transfer-to-cashbox`, {
        cash_box_id: rep.boxId,
        amount: parseFloat(rep.amount),
        troco: 0,
        close_session: false,
      })
      setTransfersDone(prev => [...prev, rep.boxId])
      toast.success(`Repasse de ${fmt(rep.amount)} realizado!`)
      onSaved()
    } catch (e: any) {
      toast.error(e.response?.data?.detail ?? 'Erro ao transferir.')
    } finally {
      setTransferring(false)
    }
  }

  const handleSyncPix = async (autoReconcile: boolean) => {
    setPixSyncLoading(true)
    try {
      const r = await api.post<{ synced: number }>('/finance/sessions/sync-pix', {
        auto_reconcile: autoReconcile,
      })
      setPixSyncResult({ synced: r.data.synced, mode: autoReconcile ? 'reconciled' : 'batched' })
      if (r.data.synced === 0) {
        toast.success('Todos os PIX já estão na esteira de conciliação.')
      } else {
        toast.success(autoReconcile
          ? `${r.data.synced} PIX conciliado(s) automaticamente.`
          : `${r.data.synced} PIX encaminhado(s) para esteira.`)
      }
    } catch (e: any) {
      toast.error(e.response?.data?.detail ?? 'Erro ao sincronizar PIX.')
    } finally {
      setPixSyncLoading(false)
    }
  }

  const canNext = () => {
    if (step === 1) return irregularesSemObs.length === 0
    return true
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 overflow-y-auto">
      <div className="bg-white w-full sm:max-w-2xl rounded-t-2xl sm:rounded-2xl shadow-2xl flex flex-col" style={{ maxHeight: '95dvh' }}>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 shrink-0">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-bold text-gray-900">Conferência de Caixa</h2>
              {isAlreadyConferido && (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-green-100 text-green-700">✓ Conferido</span>
              )}
            </div>
            <p className="text-xs text-gray-400 mt-0.5">
              {session.operador_name ?? 'Operador'} · {new Date(session.opened_at).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })}
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>

        {/* Stepper */}
        <div className="flex border-b border-gray-100 shrink-0">
          {STEPS.map((s, i) => {
            const Icon = s.icon
            const done = i < step || (isAlreadyConferido && i <= 3)
            const active = i === step
            const clickable = i < step || (isAlreadyConferido && i === 4)
            return (
              <button key={i} onClick={() => clickable ? setStep(i) : undefined}
                className={`flex-1 flex flex-col items-center gap-0.5 py-2.5 text-[10px] font-semibold border-b-2 transition ${
                  active ? 'text-[#26619c] border-[#26619c]' :
                  done ? 'text-green-600 border-green-400 cursor-pointer' :
                  'text-gray-300 border-transparent cursor-default'
                }`}>
                <Icon className="w-4 h-4" />
                {s.label}
              </button>
            )
          })}
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 px-5 py-4">

          {/* ── Step 0: Resumo ── */}
          {step === 0 && (
            <div className="flex flex-col gap-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-blue-50 border border-blue-100 rounded-xl p-3">
                  <p className="text-[10px] text-blue-500 font-semibold uppercase tracking-wide mb-1">PIX</p>
                  <p className="text-2xl font-bold text-blue-700">{fmt(pix)}</p>
                  <p className="text-[10px] text-blue-400 mt-0.5">conciliar separado</p>
                </div>
                <div className="bg-gray-50 rounded-xl p-3">
                  <p className="text-[10px] text-gray-400 font-semibold uppercase tracking-wide mb-1">Dinheiro</p>
                  <p className="text-2xl font-bold text-gray-800">{fmt(dinheiro)}</p>
                  <p className="text-[10px] text-gray-400 mt-0.5">contar no malote</p>
                </div>
                <div className="bg-red-50 rounded-xl p-3">
                  <p className="text-[10px] text-red-400 font-semibold uppercase tracking-wide mb-1">Saídas</p>
                  <p className="text-2xl font-bold text-red-600">-{fmt(baixas)}</p>
                </div>
                <div className="bg-green-50 border border-green-200 rounded-xl p-3">
                  <p className="text-[10px] text-green-600 font-semibold uppercase tracking-wide mb-1">Líquido</p>
                  <p className="text-2xl font-bold text-green-700">{fmt(liquido)}</p>
                </div>
              </div>

              {(session.blind_pix != null || session.blind_dinheiro != null || session.troco_deixado != null) && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 flex flex-col gap-1 text-xs">
                  <p className="font-semibold text-amber-800 mb-0.5">Declarado pelo operador</p>
                  {session.blind_pix != null && (
                    <div className="flex justify-between text-amber-700"><span>PIX contado:</span><span className="font-bold">{fmt(session.blind_pix)}</span></div>
                  )}
                  {session.blind_dinheiro != null && (
                    <div className="flex justify-between text-amber-700"><span>Dinheiro contado:</span><span className="font-bold">{fmt(session.blind_dinheiro)}</span></div>
                  )}
                  {session.troco_deixado != null && (
                    <div className="flex justify-between text-amber-700"><span>Troco deixado:</span><span className="font-bold">{fmt(session.troco_deixado)}</span></div>
                  )}
                </div>
              )}

              {isAlreadyConferido && session.closing_balance && (
                <div className="bg-green-50 border border-green-200 rounded-xl p-3 flex flex-col gap-1 text-xs">
                  <p className="font-semibold text-green-800 mb-0.5">Já conferido</p>
                  <div className="flex justify-between text-green-700"><span>Contado:</span><span className="font-bold">{fmt(session.closing_balance)}</span></div>
                  {session.quebra_caixa && parseFloat(session.quebra_caixa) !== 0 && (
                    <div className="flex justify-between">
                      <span className="text-gray-500">Quebra:</span>
                      <span className={`font-bold ${parseFloat(session.quebra_caixa) < 0 ? 'text-red-600' : 'text-blue-600'}`}>
                        {parseFloat(session.quebra_caixa) >= 0 ? '+' : ''}{fmt(session.quebra_caixa)}
                      </span>
                    </div>
                  )}
                  {session.conferido_por && <div className="flex justify-between text-gray-500"><span>Por:</span><span>{session.conferido_por}</span></div>}
                </div>
              )}

              <div className="bg-blue-50 border border-blue-100 rounded-xl p-4">
                <p className="text-xs font-semibold text-blue-800 mb-2">Roteiro:</p>
                <ol className="flex flex-col gap-1.5 text-xs text-blue-700">
                  {['Revisar cada lançamento da sessão', 'Contar fisicamente o dinheiro no malote', 'Informar a contagem — sistema calcula a quebra', 'Confirmar e assinar → status vira "Conferido"', 'Repassar o dinheiro para as caixinhas'].map((s, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <span className="bg-blue-200 text-blue-800 rounded-full w-4 h-4 flex items-center justify-center text-[10px] font-bold shrink-0 mt-0.5">{i + 1}</span>
                      {s}
                    </li>
                  ))}
                </ol>
              </div>

              <div className="grid grid-cols-3 gap-2 text-xs text-center text-gray-500">
                <div className="bg-gray-50 rounded-lg p-2"><p className="text-sm font-bold text-gray-800">{txs.filter(t => !t.reversed_at).length}</p><p>lançamentos</p></div>
                <div className="bg-gray-50 rounded-lg p-2"><p className="text-sm font-bold text-gray-800">{txs.filter(t => t.type === 'income' && !t.reversed_at).length}</p><p>entradas</p></div>
                <div className="bg-gray-50 rounded-lg p-2"><p className="text-sm font-bold text-gray-800">{txs.filter(t => t.type !== 'income' && !t.reversed_at).length}</p><p>saídas</p></div>
              </div>
            </div>
          )}

          {/* ── Step 1: Lançamentos ── */}
          {step === 1 && (
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <p className="text-xs text-gray-500">✓ correto · sem ✓ = irregular (exige observação)</p>
                <button onClick={() => setTxs(prev => prev.map(t => ({ ...t, conferido: !t.reversed_at ? true : t.conferido })))}
                  className="text-xs text-[#26619c] font-semibold hover:underline shrink-0">Marcar todos</button>
              </div>

              {naoConferidos.length > 0 && (
                <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-700">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  {irregularesSemObs.length > 0
                    ? <><strong>{irregularesSemObs.length}</strong> irregular(is) sem observação — preencha para continuar.</>
                    : <>{naoConferidos.length} irregular(is) — com observação registrada.</>
                  }
                </div>
              )}

              {txs.length === 0 && <p className="text-center text-gray-400 text-sm py-6">Nenhum lançamento nesta sessão.</p>}

              <div className="flex flex-col gap-2">
                {txs.map((tx, i) => {
                  const isReversed = !!tx.reversed_at
                  const isIncome = tx.type === 'income'
                  return (
                    <div key={tx.id} className={`rounded-xl border p-3 ${isReversed ? 'opacity-40 bg-gray-50 border-gray-200' : tx.conferido ? 'bg-white border-gray-200' : 'bg-red-50 border-red-200'}`}>
                      <div className="flex items-start gap-3">
                        <input type="checkbox" checked={tx.conferido} disabled={isReversed}
                          onChange={e => setTxs(prev => prev.map((t, j) => j === i ? { ...t, conferido: e.target.checked } : t))}
                          className="w-5 h-5 accent-indigo-600 mt-0.5 shrink-0 cursor-pointer" />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap mb-1">
                            {tx.income_subtype ? (
                              <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${SUBTYPE_COLORS[tx.income_subtype] ?? 'bg-gray-100 text-gray-600'}`}>
                                {SUBTYPE_LABELS[tx.income_subtype] ?? tx.income_subtype}
                              </span>
                            ) : (
                              <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-medium ${tx.is_sangria ? 'bg-amber-100 text-amber-700' : isIncome ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>
                                {tx.is_sangria ? 'Sangria' : isIncome ? 'Receita' : 'Despesa'}
                              </span>
                            )}
                            {tx.payment_method_name && (
                              <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-blue-50 text-blue-600">{tx.payment_method_name}</span>
                            )}
                            {isReversed && <span className="text-[10px] text-red-400 font-medium">Estornado</span>}
                            <span className="text-[10px] text-gray-400 ml-auto">
                              {new Date(tx.transaction_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </div>
                          <div className="flex items-center justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              <p className="text-sm text-gray-700 truncate">
                                {tx.resident_name
                                  ? tx.resident_name
                                  : tx.income_subtype && tx.description.includes(' — ')
                                    ? tx.description.split(' — ').slice(1).join(' — ')
                                    : tx.description}
                              </p>
                              {tx.created_by_name && (
                                <p className="text-[10px] text-gray-400 truncate">· {tx.created_by_name}</p>
                              )}
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0">
                              <p className={`text-sm font-bold ${isIncome ? 'text-green-600' : 'text-red-600'}`}>
                                {isIncome ? '+' : '-'}{fmt(tx.amount)}
                              </p>
                              {!isReversed && (
                                <button onClick={() => onEditTx(tx)} title="Corrigir lançamento"
                                  className="p-1 text-gray-300 hover:text-[#26619c] hover:bg-blue-50 rounded transition">
                                  <Pencil className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                          </div>
                          {!tx.conferido && !isReversed && (
                            <input type="text" value={tx.observacao ?? ''}
                              placeholder="Observação obrigatória…"
                              onChange={e => setTxs(prev => prev.map((t, j) => j === i ? { ...t, observacao: e.target.value } : t))}
                              className="mt-2 w-full border border-red-300 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-red-300 bg-white"
                            />
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* ── Step 2: Contagem ── */}
          {step === 2 && (
            <div className="flex flex-col gap-4">
              <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 text-xs text-blue-700">
                Abra o malote, conte cédula por cédula e informe o total encontrado.
              </div>
              <div className="border-2 border-gray-200 rounded-xl p-5 flex flex-col items-center gap-2">
                <p className="text-xs text-gray-500 font-medium">Total encontrado (R$)</p>
                <input type="number" min="0" step="0.01" value={contagemInput}
                  onChange={e => setContagemInput(e.target.value)} placeholder="0,00" autoFocus
                  className="w-full text-center text-3xl font-bold border-b-2 border-[#26619c] py-2 focus:outline-none bg-transparent text-gray-900" />
              </div>
              <div className="grid grid-cols-3 gap-3 text-center">
                <div className="bg-gray-50 rounded-xl p-3">
                  <p className="text-[10px] text-gray-400 mb-1">Esperado</p>
                  <p className="text-base font-bold text-gray-800">{fmt(liquido)}</p>
                </div>
                <div className="bg-gray-50 rounded-xl p-3">
                  <p className="text-[10px] text-gray-400 mb-1">Contado</p>
                  <p className="text-base font-bold text-gray-800">{contagemInput !== '' ? fmt(contagem) : '—'}</p>
                </div>
                <div className={`rounded-xl p-3 ${diferenca === null ? 'bg-gray-50' : diferenca === 0 ? 'bg-green-50 border border-green-200' : diferenca > 0 ? 'bg-blue-50 border border-blue-200' : 'bg-red-50 border border-red-200'}`}>
                  <p className="text-[10px] text-gray-400 mb-1">Diferença</p>
                  {diferenca === null ? <p className="text-base font-bold text-gray-400">—</p> : (
                    <p className={`text-base font-bold ${diferenca === 0 ? 'text-green-700' : diferenca > 0 ? 'text-blue-700' : 'text-red-700'}`}>
                      {diferenca >= 0 ? '+' : ''}{fmt(diferenca)}
                    </p>
                  )}
                </div>
              </div>
              {diferenca !== null && diferenca !== 0 && (
                <div className={`rounded-xl p-3 text-xs ${diferenca > 0 ? 'bg-blue-50 border border-blue-200 text-blue-800' : 'bg-red-50 border border-red-200 text-red-800'}`}>
                  {diferenca > 0
                    ? <><strong>Sobra de {fmt(diferenca)}</strong> — mais dinheiro do que o registrado.</>
                    : <><strong>Falta de {fmt(Math.abs(diferenca))}</strong> — menos dinheiro do que o registrado.</>
                  }
                </div>
              )}
              {diferenca === 0 && (
                <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-xl p-3 text-xs text-green-700">
                  <CheckCircle2 className="w-4 h-4 shrink-0" /><strong>Conferência perfeita!</strong> Valor contado bate com o sistema.
                </div>
              )}
            </div>
          )}

          {/* ── Step 3: Confirmar ── */}
          {step === 3 && (
            <div className="flex flex-col gap-4">
              <div className="bg-gray-50 rounded-xl p-4 flex flex-col gap-1.5 text-xs">
                <p className="text-xs font-semibold text-gray-700 mb-1">Resumo final</p>
                <div className="flex justify-between"><span className="text-gray-500">Bruto lançado</span><span className="font-medium">{fmt(bruto)}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Sangrias</span><span className="font-medium text-red-600">-{fmt(baixas)}</span></div>
                {expense > 0 && <div className="flex justify-between"><span className="text-gray-500">Despesas</span><span className="font-medium text-red-600">-{fmt(expense)}</span></div>}
                <div className="flex justify-between border-t border-gray-200 pt-1.5"><span className="font-medium text-gray-700">Líquido esperado</span><span className="font-bold text-gray-900">{fmt(liquido)}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">PIX (conciliar separado)</span><span className="font-medium text-blue-600">{fmt(pix)}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Dinheiro esperado</span><span className="font-medium">{fmt(dinheiro)}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Contado no malote</span><span className="font-medium">{contagemInput !== '' ? fmt(contagem) : '—'}</span></div>
                {diferenca !== null && (
                  <div className={`flex justify-between border-t border-gray-200 pt-1.5 font-bold ${diferenca === 0 ? 'text-green-700' : diferenca > 0 ? 'text-blue-700' : 'text-red-700'}`}>
                    <span>Quebra de caixa</span>
                    <span>{diferenca >= 0 ? '+' : ''}{fmt(diferenca)}</span>
                  </div>
                )}
                <div className="flex justify-between border-t border-gray-200 pt-1.5">
                  <span className="text-gray-500">Conferidos</span>
                  <span className="font-medium">{txs.filter(t => t.conferido).length} / {txs.filter(t => !t.reversed_at).length}</span>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1.5">Conferido por <span className="text-red-500">*</span></label>
                <select value={conferidoPor} onChange={e => setConferidoPor(e.target.value)}
                  className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#26619c]/30">
                  <option value="">Selecionar conferente…</option>
                  {conferentes.map(c => <option key={c.id} value={c.id}>{c.full_name}</option>)}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1.5">Observações gerais</label>
                <textarea value={observacaoGeral} onChange={e => setObservacaoGeral(e.target.value)}
                  placeholder="Observações sobre esta conferência…" rows={2}
                  className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#26619c]/30 resize-none" />
              </div>

              {isAlreadyConferido && (
                <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-xl p-3 text-xs text-green-700">
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  Sessão já conferida. Avance para o repasse.
                </div>
              )}
            </div>
          )}

          {/* ── Step 4: Repasse ── */}
          {step === 4 && (
            <div className="flex flex-col gap-4">
              <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5 text-xs text-amber-800">
                Envie o dinheiro para o <b>Malote</b>. O responsável pelo malote verificará e transferirá para o Cofre.
              </div>
              <div className="bg-gray-50 rounded-xl p-4 flex flex-col gap-1.5 text-xs">
                <div className="flex justify-between text-sm font-semibold">
                  <span className="text-gray-700">Espécie disponível para repasse</span>
                  <span className={disponivelReal < 0 ? 'text-red-600' : 'text-gray-900'}>{fmt(disponivelReal)}</span>
                </div>
                {transferredAmount > 0 && (
                  <div className="flex justify-between text-gray-400">
                    <span>Já repassado (sessões anteriores)</span>
                    <span className="text-orange-500 font-medium">− {fmt(transferredAmount)}</span>
                  </div>
                )}
                <div className="flex justify-between text-gray-500">
                  <span>PIX (conciliar separado)</span>
                  <span className="text-blue-600 font-medium">{fmt(pix)}</span>
                </div>
                {repasseTotal > 0 && <>
                  <div className="flex justify-between border-t border-gray-200 pt-1.5">
                    <span className="text-gray-500">Distribuído agora</span>
                    <span className="font-medium text-green-600">{fmt(repasseTotal)}</span>
                  </div>
                  <div className="flex justify-between font-semibold">
                    <span className="text-gray-600">Restante</span>
                    <span className={repasseRestante < 0 ? 'text-red-600' : 'text-gray-900'}>{fmt(repasseRestante)}</span>
                  </div>
                </>}
              </div>

              {loadingBoxes ? (
                <div className="flex items-center justify-center py-6 gap-2 text-gray-400 text-sm">
                  <RefreshCw className="w-4 h-4 animate-spin" /> Carregando caixinhas…
                </div>
              ) : cashBoxes.length === 0 ? (
                <p className="text-center text-sm text-gray-400 py-6">Nenhuma caixinha ativa.</p>
              ) : (
                <>
                  <div className="flex flex-col gap-3">
                    {repasses.map((rep, i) => {
                      const box = cashBoxes.find(b => b.id === rep.boxId)
                      const done = transfersDone.includes(rep.boxId)
                      return (
                        <div key={i} className={`rounded-xl border p-3 ${done ? 'bg-green-50 border-green-200' : 'bg-white border-gray-200'}`}>
                          <div className="flex items-center justify-between mb-2">
                            <p className="text-xs font-semibold text-gray-700">Destino {i + 1}</p>
                            {done ? <CheckCircle2 className="w-4 h-4 text-green-600" /> :
                              repasses.length > 1 && (
                                <button onClick={() => setRepasses(prev => prev.filter((_, j) => j !== i))}
                                  className="text-gray-300 hover:text-red-400"><X className="w-3.5 h-3.5" /></button>
                              )}
                          </div>
                          {done ? (
                            <p className="text-xs text-green-700">{box?.name} — {fmt(rep.amount)} transferido ✓</p>
                          ) : (
                            <div className="flex gap-2">
                              <select value={rep.boxId}
                                onChange={e => setRepasses(prev => prev.map((r, j) => j === i ? { ...r, boxId: e.target.value } : r))}
                                className="flex-1 border border-gray-300 rounded-lg px-2 py-2 text-xs bg-white focus:outline-none">
                                <option value="">Selecionar caixinha…</option>
                                {cashBoxes.map(b => (
                                  <option key={b.id} value={b.id}>{b.is_malote ? '📦 ' : ''}{b.name} ({fmt(b.balance)})</option>
                                ))}
                              </select>
                              <input type="number" min="0.01" step="0.01" value={rep.amount}
                                onChange={e => setRepasses(prev => prev.map((r, j) => j === i ? { ...r, amount: e.target.value } : r))}
                                placeholder="Valor"
                                className="w-24 border border-gray-300 rounded-lg px-2 py-2 text-xs focus:outline-none" />
                              <button
                                onClick={() => handleTransfer(i)}
                                disabled={transferring || !rep.boxId || !rep.amount || parseFloat(rep.amount || '0') > disponivelReal + 0.005}
                                className="px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold disabled:opacity-40 whitespace-nowrap">
                                Repassar
                              </button>
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                  <button onClick={() => setRepasses(prev => [...prev, { boxId: '', amount: '' }])}
                    className="text-xs text-[#26619c] font-semibold hover:underline text-center">
                    + Adicionar destino
                  </button>
                </>
              )}

              {/* PIX reconciliation */}
              {pix > 0 && (
                <div className="border border-blue-200 rounded-xl p-4 bg-blue-50 flex flex-col gap-3">
                  <div className="flex items-center gap-2">
                    <Banknote className="w-4 h-4 text-blue-600 shrink-0" />
                    <div>
                      <p className="text-xs font-semibold text-blue-800">PIX desta sessão — {fmt(pix)}</p>
                      <p className="text-[10px] text-blue-500">Deseja conciliar agora ou encaminhar para a esteira?</p>
                    </div>
                  </div>
                  {pixSyncResult ? (
                    <div className="flex items-center gap-2 text-xs font-medium text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
                      <CheckCircle2 className="w-4 h-4 shrink-0" />
                      {pixSyncResult.mode === 'reconciled'
                        ? `${pixSyncResult.synced} PIX conciliado(s) automaticamente.`
                        : `${pixSyncResult.synced} PIX encaminhado(s) para esteira de conciliação.`}
                    </div>
                  ) : (
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleSyncPix(true)}
                        disabled={pixSyncLoading}
                        className="flex-1 flex items-center justify-center gap-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white text-xs font-semibold py-2 rounded-lg transition"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        Conciliar PIX agora
                      </button>
                      <button
                        onClick={() => handleSyncPix(false)}
                        disabled={pixSyncLoading}
                        className="flex-1 flex items-center justify-center gap-1.5 border border-blue-300 text-blue-700 hover:bg-blue-100 disabled:opacity-40 text-xs font-semibold py-2 rounded-lg transition"
                      >
                        <Send className="w-3.5 h-3.5" />
                        Encaminhar para esteira
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-4 border-t border-gray-100 shrink-0">
          <button onClick={step === 0 ? onClose : () => setStep(step - 1)}
            className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700">
            <ChevronLeft className="w-4 h-4" />
            {step === 0 ? 'Fechar' : 'Anterior'}
          </button>

          {step === 3 ? (
            isAlreadyConferido ? (
              <button onClick={() => setStep(4)}
                className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2.5 rounded-xl text-sm font-semibold">
                Repassar dinheiro <ChevronRight className="w-4 h-4" />
              </button>
            ) : (
              <button onClick={handleSaveConferencia} disabled={saving || !conferidoPor}
                className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white px-6 py-2.5 rounded-xl text-sm font-semibold">
                <CheckCircle2 className="w-4 h-4" />
                {saving ? 'Salvando…' : 'Confirmar Conferência'}
              </button>
            )
          ) : step === 4 ? (
            <button
              onClick={onClose}
              disabled={false}
              className="bg-gray-800 hover:bg-gray-900 disabled:opacity-40 text-white px-6 py-2.5 rounded-xl text-sm font-semibold">
              Concluir
            </button>
          ) : (
            <button onClick={() => setStep(step + 1)} disabled={!canNext()}
              className="flex items-center gap-2 bg-[#26619c] hover:bg-[#1a4f87] disabled:opacity-40 text-white px-5 py-2.5 rounded-xl text-sm font-semibold">
              Próximo <ChevronRight className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
