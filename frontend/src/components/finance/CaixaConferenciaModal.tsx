import { useEffect, useRef, useState } from 'react'
import { X, ChevronLeft, ChevronRight, CheckCircle2, AlertCircle,
         Calculator, ClipboardList, Award, Eye, Pencil } from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../../services/api'
import { SignaturePad } from '../packages/SignaturePad'

// ── Types ─────────────────────────────────────────────────────────────────────
interface Session {
  id: string; status: string
  closing_balance: string | null; expected_balance: string | null
  difference: string | null; opened_at: string; closed_at: string | null
  operador_name?: string; conferido_por?: string
  total_pix?: string; total_dinheiro?: string
  total_bruto?: string; total_baixas?: string; total_expense?: string
  quebra_caixa?: string | null
}
interface TxReview {
  id: string; type: string; income_subtype?: string | null; amount: string
  description: string; transaction_at: string; is_sangria: boolean
  created_by_name?: string; conferido: boolean; observacao?: string | null
  payment_method_name?: string | null; reversed_at?: string | null
  resident_name?: string | null; payment_method_id?: string | null
  resident_id?: string | null
}
interface Conferente { id: string; full_name: string; role: string }
interface Props {
  session: Session; txs: TxReview[]; conferentes: Conferente[]
  onClose: () => void; onSaved: () => void; onEditTx: (tx: TxReview) => void
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const fmt = (v: string | number) =>
  `R$ ${parseFloat(String(v)).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`

const SUBTYPE_LABELS: Record<string, string> = {
  delivery_fee: 'Taxa Entrega', mensalidade: 'Mensalidade',
  proof_of_residence: 'Comprovante', other: 'Outros',
}
const QUEBRA_CATEGORIAS = [
  'Erro de troco', 'Falta de registro', 'Dinheiro extra nao registrado',
  'Diferenca de pagamento', 'Outro',
]
const STEPS = [
  { label: 'Contagem',      icon: Calculator },
  { label: 'Movimentacoes', icon: ClipboardList },
  { label: 'Quebra',        icon: AlertCircle },
  { label: 'Assinar',       icon: Award },
]
const inputCls = 'w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#26619c]/40'

export function CaixaConferenciaModal({ session, txs: initialTxs, conferentes, onClose, onSaved, onEditTx }: Props) {
  const [step, setStep] = useState(0)
  const [txs, setTxs] = useState<TxReview[]>(initialTxs)
  const [saving, setSaving] = useState(false)

  // Step 0 — Contagem
  const pix_esperado  = parseFloat(session.total_pix    || '0')
  const din_esperado  = parseFloat(session.total_dinheiro || '0')
  const esperado      = parseFloat(session.expected_balance || '0')
  const [dinInput, setDinInput] = useState(String(din_esperado || ''))
  const [pixInput, setPixInput] = useState(String(pix_esperado || ''))
  const dinContado = parseFloat(dinInput || '0')
  const pixContado = parseFloat(pixInput || '0')
  const totalContado = dinContado + pixContado
  const diferenca = totalContado - esperado

  // Step 1 — Movimentações
  const [editingTxId, setEditingTxId] = useState<string | null>(null)
  const [editPw, setEditPw] = useState('')
  const [editForm, setEditForm] = useState({ amount: '', description: '', payment_method_id: '' })
  const [editingSaving, setEditingSaving] = useState(false)
  const [paymentMethods, setPaymentMethods] = useState<{ id: string; name: string }[]>([])

  // Step 2 — Quebra
  const [conferidoPor, setConferidoPor] = useState('')
  const [quebraCategoria, setQuebraCategoria] = useState('')
  const [quebraMotivo, setQuebraMotivo] = useState('')
  const [obsGeral, setObsGeral] = useState('')

  // Step 3 — Assinar
  const [assinatura, setAssinatura] = useState<{ url: string } | null>(null)
  const [pdfLoading, setPdfLoading] = useState(false)

  useEffect(() => {
    api.get('/finance/payment-methods').then(r => setPaymentMethods(r.data)).catch(() => {})
  }, [])

  const canNext = () => {
    if (step === 0) return dinInput !== '' && pixInput !== ''
    if (step === 1) return true
    if (step === 2) {
      if (diferenca !== 0 && !quebraMotivo.trim()) return false
      if (!conferidoPor) return false
      return true
    }
    return false
  }

  const startEditTx = (tx: TxReview) => {
    setEditingTxId(tx.id)
    setEditForm({ amount: tx.amount, description: tx.description || '', payment_method_id: tx.payment_method_id || '' })
  }

  const saveEditTx = async (txId: string) => {
    if (!editPw.trim()) { toast.error('Informe a senha de admin.'); return }
    setEditingSaving(true)
    try {
      const body: any = { admin_password: editPw }
      if (editForm.amount) body.amount = parseFloat(editForm.amount)
      if (editForm.description) body.description = editForm.description
      if (editForm.payment_method_id) body.payment_method_id = editForm.payment_method_id
      await api.patch(`/finance/transactions/${txId}/correct`, body)
      toast.success('Lançamento corrigido.')
      // Reload txs
      const r = await api.get<TxReview[]>(`/finance/sessions/${session.id}/transactions`)
      setTxs(r.data)
      setEditingTxId(null); setEditForm({ amount: '', description: '', payment_method_id: '' })
    } catch (e: any) {
      const d = e.response?.data?.detail
      toast.error(typeof d === 'string' ? d : 'Erro ao corrigir.')
    } finally { setEditingSaving(false) }
  }

  const toggleConferido = (txId: string) =>
    setTxs(prev => prev.map(t => t.id === txId ? { ...t, conferido: !t.conferido } : t))

  const setObs = (txId: string, obs: string) =>
    setTxs(prev => prev.map(t => t.id === txId ? { ...t, observacao: obs } : t))

  const handleConfirmar = async (sig: { url: string } | null) => {
    setSaving(true)
    try {
      const motivo = diferenca !== 0 ? `${quebraCategoria}: ${quebraMotivo}` : null
      await api.put(`/finance/sessions/${session.id}/reviews`, {
        reviews: txs.map(t => ({ transaction_id: t.id, conferido: t.conferido, observacao: t.observacao || null })),
        reviewed_by_id: conferidoPor || null,
        closing_balance: totalContado,
        dinheiro_contado: dinContado,
        pix_contado: pixContado,
        quebra_motivo: motivo,
        assinatura_url: sig?.url || null,
        notes: obsGeral || null,
      })
      toast.success('Conferencia salva!')
      onSaved()
      // Gera PDF automaticamente
      if (sig) {
        try {
          setPdfLoading(true)
          const conf = conferentes.find(c => c.id === conferidoPor)
          const res = await api.post(`/finance/sessions/${session.id}/conferencia-pdf`, {
            conferente_nome: conf?.full_name || 'Conferente',
            dinheiro_contado: dinContado,
            pix_contado: pixContado,
            quebra_motivo: motivo,
            assinatura_url: sig.url,
          }, { responseType: 'blob' })
          const url = URL.createObjectURL(res.data)
          const a = document.createElement('a'); a.href = url
          a.download = `conferencia_${session.id.slice(0, 8)}.pdf`; a.click()
          URL.revokeObjectURL(url)
        } catch { toast.error('Conferencia salva, mas erro ao gerar PDF.') }
        finally { setPdfLoading(false) }
      }
      onClose()
    } catch (e: any) {
      toast.error(e.response?.data?.detail ?? 'Erro ao salvar.')
    } finally { setSaving(false) }
  }

  const naoConferidos = txs.filter(t => !t.reversed_at && !t.conferido)
  const irregularesSemObs = naoConferidos.filter(t => !t.observacao?.trim())

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 overflow-y-auto">
      <div className="bg-white w-full sm:max-w-2xl rounded-t-2xl sm:rounded-2xl shadow-2xl flex flex-col" style={{ maxHeight: '95dvh' }}>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 shrink-0">
          <div>
            <h2 className="text-sm font-bold text-gray-900">Conferencia de Caixa</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              {session.operador_name} · {new Date(session.opened_at).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })}
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>

        {/* Stepper */}
        <div className="flex border-b border-gray-100 shrink-0">
          {STEPS.map((s, i) => {
            const Icon = s.icon
            const active = i === step
            const done = i < step
            return (
              <button key={i} onClick={() => done ? setStep(i) : undefined}
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

          {/* ── Step 0: Contagem ── */}
          {step === 0 && (
            <div className="flex flex-col gap-4">
              <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 text-xs text-blue-700">
                Conte o dinheiro fisico e confira o PIX. Informe os totais abaixo.
              </div>
              <div className="grid grid-cols-3 gap-3 text-center">
                <div className="bg-gray-50 rounded-xl p-3">
                  <p className="text-[10px] text-gray-400 mb-1">Bruto lancado</p>
                  <p className="text-base font-bold text-gray-800">{fmt(session.total_bruto || '0')}</p>
                </div>
                <div className="bg-blue-50 rounded-xl p-3">
                  <p className="text-[10px] text-blue-500 mb-1">PIX esperado</p>
                  <p className="text-base font-bold text-blue-700">{fmt(pix_esperado)}</p>
                </div>
                <div className="bg-green-50 rounded-xl p-3">
                  <p className="text-[10px] text-green-600 mb-1">Saldo esperado</p>
                  <p className="text-base font-bold text-green-700">{fmt(esperado)}</p>
                </div>
              </div>
              <div className="flex flex-col gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Dinheiro fisico contado (R$) *</label>
                  <input type="number" inputMode="decimal" min="0" step="0.01" value={dinInput}
                    onChange={e => setDinInput(e.target.value)} placeholder="0,00" autoFocus
                    className="w-full text-center text-2xl font-bold border-b-2 border-[#26619c] py-2 focus:outline-none bg-transparent" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">PIX contado (R$) *</label>
                  <input type="number" inputMode="decimal" min="0" step="0.01" value={pixInput}
                    onChange={e => setPixInput(e.target.value)} placeholder="0,00"
                    className="w-full text-center text-2xl font-bold border-b-2 border-blue-400 py-2 focus:outline-none bg-transparent" />
                </div>
              </div>
              {dinInput !== '' && pixInput !== '' && (
                <div className={`rounded-2xl p-4 text-center ${Math.abs(diferenca) < 0.01 ? 'bg-green-50 border border-green-200' : 'bg-amber-50 border border-amber-200'}`}>
                  <p className="text-xs text-gray-500 mb-1">Total contado</p>
                  <p className="text-2xl font-bold text-gray-900">{fmt(totalContado)}</p>
                  <p className={`text-sm font-semibold mt-1 ${Math.abs(diferenca) < 0.01 ? 'text-green-700' : 'text-amber-700'}`}>
                    {Math.abs(diferenca) < 0.01 ? '✓ Conferencia perfeita' : `Diferenca: R$ ${diferenca >= 0 ? '+' : ''}${diferenca.toFixed(2)}`}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* ── Step 1: Movimentações ── */}
          {step === 1 && (
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <p className="text-xs text-gray-500">Clique em Editar para corrigir um lancamento</p>
                <div className="flex items-center gap-2">
                  <input value={editPw} onChange={e => setEditPw(e.target.value)} type="password"
                    placeholder="Senha admin (para editar)" className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 w-44" />
                  <button onClick={() => setTxs(prev => prev.map(t => ({ ...t, conferido: !t.reversed_at ? true : t.conferido })))}
                    className="text-xs text-[#26619c] font-semibold hover:underline whitespace-nowrap">Marcar todos</button>
                </div>
              </div>
              {irregularesSemObs.length > 0 && (
                <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-700">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  {irregularesSemObs.length} irregular(is) sem observacao — preencha para continuar.
                </div>
              )}
              <div className="flex flex-col gap-2">
                {txs.filter(t => !t.reversed_at).map(tx => (
                  <div key={tx.id} className={`rounded-xl border p-3 ${tx.conferido ? 'border-gray-200 bg-white' : 'border-amber-200 bg-amber-50'}`}>
                    <div className="flex items-start gap-2">
                      <button onClick={() => toggleConferido(tx.id)}
                        className={`shrink-0 w-5 h-5 rounded-full border-2 flex items-center justify-center mt-0.5 transition ${tx.conferido ? 'bg-green-500 border-green-500' : 'border-gray-300'}`}>
                        {tx.conferido && <CheckCircle2 className="w-3.5 h-3.5 text-white" />}
                      </button>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${
                            tx.type === 'income' ? 'bg-green-100 text-green-700' :
                            tx.is_sangria ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'
                          }`}>
                            {tx.income_subtype ? SUBTYPE_LABELS[tx.income_subtype] ?? tx.income_subtype : tx.type === 'income' ? 'Entrada' : tx.is_sangria ? 'Sangria' : 'Saida'}
                          </span>
                          <span className="text-sm font-semibold text-gray-900">{fmt(tx.amount)}</span>
                          {tx.payment_method_name && <span className="text-xs text-gray-500">{tx.payment_method_name}</span>}
                        </div>
                        <p className="text-xs text-gray-600 truncate mt-0.5">{tx.description || tx.resident_name || '—'}</p>
                        {editingTxId === tx.id ? (
                          <div className="mt-2 flex flex-col gap-2 bg-blue-50 rounded-lg p-2">
                            <input value={editForm.amount} onChange={e => setEditForm(f => ({...f, amount: e.target.value}))}
                              placeholder="Novo valor (R$)" type="number" className={inputCls + ' text-sm'} />
                            <input value={editForm.description} onChange={e => setEditForm(f => ({...f, description: e.target.value}))}
                              placeholder="Nova descricao" className={inputCls + ' text-sm'} />
                            <select value={editForm.payment_method_id} onChange={e => setEditForm(f => ({...f, payment_method_id: e.target.value}))}
                              className={inputCls + ' text-sm'}>
                              <option value="">Forma de pagamento (manter)</option>
                              {paymentMethods.map(pm => <option key={pm.id} value={pm.id}>{pm.name}</option>)}
                            </select>
                            <div className="flex gap-2">
                              <button onClick={() => saveEditTx(tx.id)} disabled={editingSaving || !editPw}
                                className="flex-1 bg-[#26619c] text-white text-xs py-1.5 rounded-lg disabled:opacity-50">
                                {editingSaving ? 'Salvando…' : 'Salvar'}
                              </button>
                              <button onClick={() => setEditingTxId(null)}
                                className="flex-1 border border-gray-300 text-xs py-1.5 rounded-lg">Cancelar</button>
                            </div>
                          </div>
                        ) : (
                          <button onClick={() => startEditTx(tx)}
                            className="mt-1 flex items-center gap-1 text-[10px] text-[#26619c] hover:underline">
                            <Pencil className="w-3 h-3" /> Editar
                          </button>
                        )}
                      </div>
                    </div>
                    {!tx.conferido && (
                      <input value={tx.observacao || ''} onChange={e => setObs(tx.id, e.target.value)}
                        placeholder="Observacao obrigatoria para lancamentos irregulares…"
                        className="mt-2 w-full text-xs border border-amber-300 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-amber-400" />
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Step 2: Quebra ── */}
          {step === 2 && (
            <div className="flex flex-col gap-4">
              <div className="bg-gray-50 rounded-xl p-4 flex flex-col gap-1.5 text-xs">
                {[
                  ['Dinheiro esperado', fmt(din_esperado), false],
                  ['Dinheiro contado', fmt(dinContado), false],
                  ['PIX esperado', fmt(pix_esperado), false],
                  ['PIX contado', fmt(pixContado), false],
                  ['Total esperado', fmt(esperado), true],
                  ['Total contado', fmt(totalContado), true],
                ].map(([l, v, b]) => (
                  <div key={String(l)} className={`flex justify-between ${b ? 'border-t border-gray-200 pt-1.5 font-bold text-sm' : ''}`}>
                    <span className="text-gray-500">{l}</span><span>{v}</span>
                  </div>
                ))}
                <div className={`flex justify-between border-t-2 pt-1.5 font-bold text-sm ${Math.abs(diferenca) < 0.01 ? 'text-green-700' : 'text-amber-700'}`}>
                  <span>Diferenca (quebra)</span>
                  <span>{diferenca >= 0 ? '+' : ''}{fmt(diferenca)}</span>
                </div>
              </div>

              {Math.abs(diferenca) < 0.01 ? (
                <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-xl p-3 text-xs text-green-700">
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  <strong>Conferencia perfeita!</strong> Valor contado bate com o sistema.
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  <div className={`rounded-xl p-3 text-xs ${diferenca > 0 ? 'bg-blue-50 border border-blue-200 text-blue-800' : 'bg-red-50 border border-red-200 text-red-800'}`}>
                    {diferenca > 0
                      ? <><strong>Sobra de {fmt(diferenca)}</strong> — mais dinheiro do que o registrado.</>
                      : <><strong>Falta de {fmt(Math.abs(diferenca))}</strong> — menos dinheiro do que o registrado.</>}
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Categoria da quebra *</label>
                    <select value={quebraCategoria} onChange={e => setQuebraCategoria(e.target.value)} className={inputCls}>
                      <option value="">Selecione…</option>
                      {QUEBRA_CATEGORIAS.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Descricao do motivo *</label>
                    <textarea value={quebraMotivo} onChange={e => setQuebraMotivo(e.target.value)} rows={2}
                      placeholder="Descreva o motivo da diferenca…"
                      className={`${inputCls} resize-none`} />
                  </div>
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1.5">Conferido por *</label>
                <select value={conferidoPor} onChange={e => setConferidoPor(e.target.value)} className={inputCls}>
                  <option value="">Selecionar conferente…</option>
                  {conferentes.map(c => <option key={c.id} value={c.id}>{c.full_name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Observacoes gerais</label>
                <textarea value={obsGeral} onChange={e => setObsGeral(e.target.value)} rows={2}
                  placeholder="Observacoes sobre esta conferencia…" className={`${inputCls} resize-none`} />
              </div>
            </div>
          )}

          {/* ── Step 3: Assinar ── */}
          {step === 3 && (
            <div className="flex flex-col gap-4">
              <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 text-xs text-blue-700">
                O conferente deve assinar abaixo. Apos a assinatura, clique em "Confirmar e Imprimir" para salvar e gerar o PDF.
              </div>
              <SignaturePad
                label="Assinatura do Conferente"
                onSave={(url: string) => setAssinatura({ url })}
              />
              <button onClick={() => handleConfirmar(assinatura)} disabled={saving || pdfLoading || !assinatura}
                className="w-full bg-[#26619c] hover:bg-[#1a4f87] text-white py-3 rounded-xl text-sm font-semibold transition disabled:opacity-50">
                {saving || pdfLoading ? 'Salvando e gerando PDF…' : 'Confirmar e Imprimir Comprovante'}
              </button>
              <button onClick={() => handleConfirmar(null)} disabled={saving}
                className="w-full border border-gray-300 text-gray-600 py-2 rounded-xl text-sm transition hover:bg-gray-50 disabled:opacity-50">
                Confirmar sem imprimir
              </button>
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
          {step < 3 && (
            <button onClick={() => setStep(step + 1)} disabled={!canNext()}
              className="flex items-center gap-2 bg-[#26619c] hover:bg-[#1a4f87] disabled:opacity-40 text-white px-5 py-2.5 rounded-xl text-sm font-semibold">
              Proximo <ChevronRight className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
