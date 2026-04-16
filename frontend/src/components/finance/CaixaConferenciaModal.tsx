import { useState } from 'react'
import { X, ChevronLeft, ChevronRight, CheckCircle2, AlertCircle, ClipboardList, Calculator, Award, Eye } from 'lucide-react'
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
  total_bruto?: string; total_baixas?: string
  quebra_caixa?: string | null
  malote_sent_at?: string | null
}

interface TxReview {
  id: string; type: string; income_subtype?: string | null; amount: string
  description: string; transaction_at: string; is_sangria: boolean
  created_by_name?: string; conferido: boolean; observacao?: string | null
  payment_method_name?: string | null; reversed_at?: string | null
}

interface Conferente { id: string; full_name: string; role: string }

interface Props {
  session: Session
  txs: TxReview[]
  conferentes: Conferente[]
  onClose: () => void
  onSaved: () => void
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
  { label: 'Finalizar', icon: Award },
]

export function CaixaConferenciaModal({ session, txs: initialTxs, conferentes, onClose, onSaved }: Props) {
  const [step, setStep] = useState(0)
  const [txs, setTxs] = useState<TxReview[]>(initialTxs)
  const [contagemInput, setContagemInput] = useState(session.closing_balance ?? '')
  const [conferidoPor, setConferidoPor] = useState('')
  const [observacaoGeral, setObservacaoGeral] = useState('')
  const [saving, setSaving] = useState(false)

  const bruto = parseFloat(session.total_bruto ?? '0')
  const baixas = parseFloat(session.total_baixas ?? '0')
  const pix = parseFloat(session.total_pix ?? '0')
  const dinheiro = parseFloat(session.total_dinheiro ?? '0')
  const liquido = bruto - baixas
  const contagem = parseFloat(contagemInput || '0')
  const diferenca = !isNaN(contagem) ? contagem - dinheiro : null

  const naoConferidos = txs.filter(t => !t.reversed_at && !t.conferido)
  const irregularesSemObs = naoConferidos.filter(t => !t.observacao?.trim())

  const handleSave = async () => {
    if (step < 3) return
    setSaving(true)
    try {
      await api.put(`/finance/sessions/${session.id}/reviews`, {
        reviews: txs.map(t => ({ transaction_id: t.id, conferido: t.conferido, observacao: t.observacao || null })),
        reviewed_by_id: conferidoPor || null,
        closing_balance: isNaN(contagem) ? undefined : contagem,
        notes: observacaoGeral || null,
      })
      toast.success('Conferência salva!')
      onSaved()
      onClose()
    } catch (e: any) {
      toast.error(e.response?.data?.detail ?? 'Erro ao salvar.')
    } finally {
      setSaving(false)
    }
  }

  const canNext = () => {
    if (step === 1) return irregularesSemObs.length === 0
    return true
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4 overflow-y-auto">
      <div className="bg-white w-full sm:max-w-2xl rounded-t-2xl sm:rounded-2xl shadow-2xl flex flex-col max-h-[95dvh]">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 shrink-0">
          <div>
            <h2 className="text-sm font-bold text-gray-900">Conferência de Caixa</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              {session.operador_name ?? 'Operador'} · {new Date(session.opened_at).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })}
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Stepper */}
        <div className="flex border-b border-gray-100 shrink-0">
          {STEPS.map((s, i) => {
            const Icon = s.icon
            const done = i < step
            const active = i === step
            return (
              <button key={i}
                onClick={() => i < step && setStep(i)}
                className={`flex-1 flex flex-col items-center gap-0.5 py-3 text-[10px] font-semibold border-b-2 transition ${
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
                <div className="bg-gray-50 rounded-xl p-3">
                  <p className="text-[10px] text-gray-400 mb-1 uppercase tracking-wide">PIX recebido</p>
                  <p className="text-xl font-bold text-blue-700">{fmt(pix)}</p>
                  <p className="text-[10px] text-gray-400 mt-0.5">conciliado separado</p>
                </div>
                <div className="bg-gray-50 rounded-xl p-3">
                  <p className="text-[10px] text-gray-400 mb-1 uppercase tracking-wide">Dinheiro</p>
                  <p className="text-xl font-bold text-gray-800">{fmt(dinheiro)}</p>
                  <p className="text-[10px] text-gray-400 mt-0.5">para conferência física</p>
                </div>
                <div className="bg-gray-50 rounded-xl p-3">
                  <p className="text-[10px] text-gray-400 mb-1 uppercase tracking-wide">Baixas / Sangrias</p>
                  <p className="text-xl font-bold text-red-600">-{fmt(baixas)}</p>
                </div>
                <div className="bg-green-50 rounded-xl p-3 border border-green-200">
                  <p className="text-[10px] text-green-600 mb-1 uppercase tracking-wide font-semibold">Líquido Esperado</p>
                  <p className="text-xl font-bold text-green-700">{fmt(liquido)}</p>
                </div>
              </div>

              <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
                <p className="text-xs font-semibold text-blue-800 mb-2">O que você vai fazer agora:</p>
                <ol className="flex flex-col gap-1.5 text-xs text-blue-700">
                  <li className="flex items-start gap-2"><span className="bg-blue-200 text-blue-800 rounded-full w-4 h-4 flex items-center justify-center text-[10px] font-bold shrink-0 mt-0.5">1</span> Revisar cada lançamento da sessão</li>
                  <li className="flex items-start gap-2"><span className="bg-blue-200 text-blue-800 rounded-full w-4 h-4 flex items-center justify-center text-[10px] font-bold shrink-0 mt-0.5">2</span> Contar fisicamente o dinheiro no malote</li>
                  <li className="flex items-start gap-2"><span className="bg-blue-200 text-blue-800 rounded-full w-4 h-4 flex items-center justify-center text-[10px] font-bold shrink-0 mt-0.5">3</span> Registrar a contagem e identificar quebra de caixa</li>
                  <li className="flex items-start gap-2"><span className="bg-blue-200 text-blue-800 rounded-full w-4 h-4 flex items-center justify-center text-[10px] font-bold shrink-0 mt-0.5">4</span> Assinar e salvar a conferência</li>
                </ol>
              </div>

              <div className="flex gap-3 text-xs text-gray-500">
                <div className="flex-1 bg-gray-50 rounded-lg p-2 text-center">
                  <p className="font-semibold text-gray-800 text-sm">{txs.filter(t => !t.reversed_at).length}</p>
                  <p>lançamentos</p>
                </div>
                <div className="flex-1 bg-gray-50 rounded-lg p-2 text-center">
                  <p className="font-semibold text-gray-800 text-sm">{txs.filter(t => t.type === 'income' && !t.reversed_at).length}</p>
                  <p>entradas</p>
                </div>
                <div className="flex-1 bg-gray-50 rounded-lg p-2 text-center">
                  <p className="font-semibold text-gray-800 text-sm">{txs.filter(t => t.type !== 'income' && !t.reversed_at).length}</p>
                  <p>saídas/sangrias</p>
                </div>
              </div>
            </div>
          )}

          {/* ── Step 1: Lançamentos ── */}
          {step === 1 && (
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <p className="text-xs text-gray-500">Marque ✓ os lançamentos corretos. Para irregulares, adicione uma observação.</p>
                <button onClick={() => setTxs(prev => prev.map(t => ({ ...t, conferido: !t.reversed_at ? true : t.conferido })))}
                  className="text-xs text-[#26619c] font-semibold hover:underline shrink-0 ml-2">
                  Marcar todos
                </button>
              </div>

              {naoConferidos.length > 0 && (
                <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-700">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  {naoConferidos.length} lançamento(s) não conferido(s).
                  {irregularesSemObs.length > 0 && <span className="font-semibold ml-1">Adicione observação em cada um para continuar.</span>}
                </div>
              )}

              <div className="flex flex-col gap-2">
                {txs.map((tx, i) => {
                  const isReversed = !!tx.reversed_at
                  const isIncome = tx.type === 'income'
                  return (
                    <div key={tx.id} className={`rounded-xl border p-3 transition ${
                      isReversed ? 'opacity-40 bg-gray-50 border-gray-200' :
                      tx.conferido ? 'bg-white border-gray-200' :
                      'bg-red-50 border-red-200'
                    }`}>
                      <div className="flex items-start gap-3">
                        <input type="checkbox" checked={tx.conferido} disabled={isReversed}
                          onChange={e => setTxs(prev => prev.map((t, j) => j === i ? { ...t, conferido: e.target.checked } : t))}
                          className="w-5 h-5 accent-indigo-600 mt-0.5 shrink-0 cursor-pointer" />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap mb-1">
                            {tx.income_subtype ? (
                              <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${SUBTYPE_COLORS[tx.income_subtype] ?? 'bg-gray-100 text-gray-600'}`}>
                                {SUBTYPE_LABELS[tx.income_subtype] ?? tx.income_subtype}
                              </span>
                            ) : (
                              <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-medium ${
                                tx.is_sangria ? 'bg-amber-100 text-amber-700' :
                                isIncome ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'
                              }`}>
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
                            <p className="text-sm text-gray-700 truncate flex-1">{tx.description}</p>
                            <p className={`text-sm font-bold shrink-0 ${isIncome ? 'text-green-600' : 'text-red-600'}`}>
                              {isIncome ? '+' : '-'}{fmt(tx.amount)}
                            </p>
                          </div>
                          {!tx.conferido && !isReversed && (
                            <input
                              type="text"
                              value={tx.observacao ?? ''}
                              placeholder="Observação obrigatória para irregular…"
                              onChange={e => setTxs(prev => prev.map((t, j) => j === i ? { ...t, observacao: e.target.value } : t))}
                              className="mt-2 w-full border border-red-300 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-red-300 bg-white"
                            />
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })}
                {txs.length === 0 && (
                  <p className="text-center text-gray-400 text-sm py-6">Nenhum lançamento nesta sessão.</p>
                )}
              </div>
            </div>
          )}

          {/* ── Step 2: Contagem ── */}
          {step === 2 && (
            <div className="flex flex-col gap-4">
              <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
                <p className="text-xs font-semibold text-blue-800 mb-1">Como fazer a contagem</p>
                <p className="text-xs text-blue-700">Abra o malote físico da sessão. Conte cédula por cédula e informe o total encontrado abaixo. O sistema irá calcular a diferença automaticamente.</p>
              </div>

              <div className="bg-white border-2 border-gray-200 rounded-xl p-4 flex flex-col items-center gap-3">
                <p className="text-xs text-gray-500 font-medium">Total encontrado no malote (R$)</p>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={contagemInput}
                  onChange={e => setContagemInput(e.target.value)}
                  placeholder="0,00"
                  autoFocus
                  className="w-full text-center text-3xl font-bold border-b-2 border-[#26619c] py-2 focus:outline-none bg-transparent text-gray-900"
                />
              </div>

              <div className="grid grid-cols-3 gap-3 text-center">
                <div className="bg-gray-50 rounded-xl p-3">
                  <p className="text-[10px] text-gray-400 mb-1">Esperado (dinheiro)</p>
                  <p className="text-base font-bold text-gray-800">{fmt(dinheiro)}</p>
                </div>
                <div className="bg-gray-50 rounded-xl p-3">
                  <p className="text-[10px] text-gray-400 mb-1">Contado</p>
                  <p className="text-base font-bold text-gray-800">{contagemInput ? fmt(contagem) : '—'}</p>
                </div>
                <div className={`rounded-xl p-3 ${
                  diferenca === null ? 'bg-gray-50' :
                  diferenca === 0 ? 'bg-green-50 border border-green-200' :
                  diferenca > 0 ? 'bg-blue-50 border border-blue-200' :
                  'bg-red-50 border border-red-200'
                }`}>
                  <p className="text-[10px] text-gray-400 mb-1">Diferença</p>
                  {diferenca === null ? (
                    <p className="text-base font-bold text-gray-400">—</p>
                  ) : (
                    <p className={`text-base font-bold ${diferenca === 0 ? 'text-green-700' : diferenca > 0 ? 'text-blue-700' : 'text-red-700'}`}>
                      {diferenca >= 0 ? '+' : ''}{fmt(diferenca)}
                    </p>
                  )}
                </div>
              </div>

              {diferenca !== null && diferenca !== 0 && (
                <div className={`rounded-xl p-3 text-xs ${diferenca > 0 ? 'bg-blue-50 border border-blue-200 text-blue-800' : 'bg-red-50 border border-red-200 text-red-800'}`}>
                  {diferenca > 0 ? (
                    <><span className="font-semibold">Sobra de {fmt(diferenca)}</span> — o operador fechou com mais dinheiro do que o registrado. Verifique se há lançamentos faltando.</>
                  ) : (
                    <><span className="font-semibold">Falta de {fmt(Math.abs(diferenca))}</span> — o operador fechou com menos dinheiro do que o registrado. Verifique sangrias não lançadas ou erros.</>
                  )}
                </div>
              )}

              {diferenca === 0 && (
                <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-xl p-3 text-xs text-green-700">
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  <span className="font-semibold">Conferência perfeita!</span> O valor contado bate com o sistema.
                </div>
              )}
            </div>
          )}

          {/* ── Step 3: Finalizar ── */}
          {step === 3 && (
            <div className="flex flex-col gap-4">
              {/* Resumo final */}
              <div className="bg-gray-50 rounded-xl p-4 flex flex-col gap-2">
                <p className="text-xs font-semibold text-gray-700 mb-1">Resumo da conferência</p>
                <div className="flex justify-between text-xs">
                  <span className="text-gray-500">Bruto lançado</span>
                  <span className="font-medium text-gray-800">{fmt(bruto)}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-gray-500">Baixas / Sangrias</span>
                  <span className="font-medium text-red-600">-{fmt(baixas)}</span>
                </div>
                <div className="flex justify-between text-xs border-t border-gray-200 pt-2">
                  <span className="text-gray-600 font-medium">Líquido esperado</span>
                  <span className="font-bold text-gray-900">{fmt(liquido)}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-gray-500">PIX (conciliar separado)</span>
                  <span className="font-medium text-blue-600">{fmt(pix)}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-gray-500">Dinheiro esperado</span>
                  <span className="font-medium text-gray-800">{fmt(dinheiro)}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-gray-500">Contado no malote</span>
                  <span className="font-medium text-gray-800">{contagemInput ? fmt(contagem) : '—'}</span>
                </div>
                {diferenca !== null && (
                  <div className={`flex justify-between text-xs border-t border-gray-200 pt-2 font-bold ${diferenca === 0 ? 'text-green-700' : diferenca > 0 ? 'text-blue-700' : 'text-red-700'}`}>
                    <span>Quebra de caixa</span>
                    <span>{diferenca >= 0 ? '+' : ''}{fmt(diferenca)}</span>
                  </div>
                )}
                <div className="flex justify-between text-xs border-t border-gray-200 pt-2">
                  <span className="text-gray-500">Lançamentos conferidos</span>
                  <span className="font-medium text-gray-800">{txs.filter(t => t.conferido).length} / {txs.filter(t => !t.reversed_at).length}</span>
                </div>
                {naoConferidos.length > 0 && (
                  <div className="flex justify-between text-xs text-amber-600 font-medium">
                    <span>Irregulares com observação</span>
                    <span>{naoConferidos.filter(t => t.observacao?.trim()).length} / {naoConferidos.length}</span>
                  </div>
                )}
              </div>

              {/* Conferente */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1.5">Conferido por <span className="text-red-500">*</span></label>
                <select value={conferidoPor} onChange={e => setConferidoPor(e.target.value)}
                  className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#26619c]/30">
                  <option value="">Selecionar conferente…</option>
                  {conferentes.map(c => <option key={c.id} value={c.id}>{c.full_name}</option>)}
                </select>
              </div>

              {/* Observação geral */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1.5">Observações gerais</label>
                <textarea value={observacaoGeral} onChange={e => setObservacaoGeral(e.target.value)}
                  placeholder="Alguma observação sobre esta conferência…"
                  rows={3}
                  className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#26619c]/30 resize-none" />
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-4 border-t border-gray-100 shrink-0">
          <button
            onClick={step === 0 ? onClose : () => setStep(step - 1)}
            className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700">
            <ChevronLeft className="w-4 h-4" />
            {step === 0 ? 'Cancelar' : 'Anterior'}
          </button>

          {step < 3 ? (
            <button
              onClick={() => setStep(step + 1)}
              disabled={!canNext()}
              className="flex items-center gap-2 bg-[#26619c] hover:bg-[#1a4f87] disabled:opacity-40 text-white px-5 py-2.5 rounded-xl text-sm font-semibold transition">
              Próximo <ChevronRight className="w-4 h-4" />
            </button>
          ) : (
            <button
              onClick={handleSave}
              disabled={saving || !conferidoPor}
              className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white px-6 py-2.5 rounded-xl text-sm font-semibold transition">
              <CheckCircle2 className="w-4 h-4" />
              {saving ? 'Salvando…' : 'Salvar Conferência'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
