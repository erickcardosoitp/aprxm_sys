import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  AlertTriangle, CheckCircle, ClipboardCheck, DollarSign, Lock, MinusCircle,
  PlusCircle, TrendingUp, Unlock, User, X,
} from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../../services/api'
import { financeService } from '../../services/finance'
import { settingsService } from '../../services/settings'
import { useAuthStore } from '../../store/authStore'
import type { AssociationSettings, CashSession, Transaction } from '../../types'

interface Props {
  session: CashSession | null
  onRefresh: () => void
  canConferencia?: boolean
}

type CloseStep = 'blind' | 'troco' | 'review' | 'sign' | 'done'

// ── helpers ──────────────────────────────────────────────────────────────────

function fmt(v: number) {
  if (!isFinite(v)) return '0,00'
  return v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function elapsed(openedAt: string) {
  const ms = Date.now() - new Date(openedAt).getTime()
  const h = Math.floor(ms / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  return h > 0 ? `${h}h ${m}min` : `${m}min`
}

// ── Close multi-step modal ────────────────────────────────────────────────────

interface CloseModalProps {
  session: CashSession
  onDone: () => void
  onCancel: () => void
  onRefresh: () => void
}

function CloseModal({ session, onDone, onCancel, onRefresh }: CloseModalProps) {
  const role = useAuthStore((s) => s.role)
  const isOperator = role === 'operator'
  const [step, setStep] = useState<CloseStep>('blind')
  const [settings, setSettings] = useState<AssociationSettings | null>(null)

  useEffect(() => {
    settingsService.get().then(r => setSettings(r.data)).catch(() => {})
  }, [])
  const [blindPix, setBlindPix] = useState('')
  const [blindDinheiro, setBlindDinheiro] = useState('')
  const [trocoValor, setTrocoValor] = useState('')
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<{ expected: number; counted: number; diff: number; blindPix: number; blindDinheiro: number } | null>(null)
  const [registrarQuebra, setRegistrarQuebra] = useState(false)

  const blindPixVal = parseFloat(blindPix.replace(',', '.')) || 0
  const blindDinheiroVal = parseFloat(blindDinheiro.replace(',', '.')) || 0
  const blindTotal = blindPixVal + blindDinheiroVal
  const canProceed = (blindPix !== '' || blindDinheiro !== '') && blindTotal >= 0

  // Signature canvas (operator only)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [drawing, setDrawing] = useState(false)
  const [hasSig, setHasSig] = useState(false)

  const openingBalance = parseFloat(session.opening_balance)

  const getPos = (e: React.MouseEvent | React.TouchEvent, rect: DOMRect) => {
    if ('touches' in e) return { x: e.touches[0].clientX - rect.left, y: e.touches[0].clientY - rect.top }
    return { x: (e as React.MouseEvent).clientX - rect.left, y: (e as React.MouseEvent).clientY - rect.top }
  }
  const startDraw = (e: React.MouseEvent | React.TouchEvent) => {
    const canvas = canvasRef.current; if (!canvas) return
    setDrawing(true); setHasSig(true)
    const ctx = canvas.getContext('2d')!
    const { x, y } = getPos(e, canvas.getBoundingClientRect())
    ctx.beginPath(); ctx.moveTo(x, y)
  }
  const draw = (e: React.MouseEvent | React.TouchEvent) => {
    if (!drawing) return
    const canvas = canvasRef.current!
    const ctx = canvas.getContext('2d')!
    const { x, y } = getPos(e, canvas.getBoundingClientRect())
    ctx.lineTo(x, y); ctx.strokeStyle = '#1e293b'; ctx.lineWidth = 2; ctx.stroke()
  }
  const stopDraw = () => setDrawing(false)
  const clearSig = () => {
    const canvas = canvasRef.current; if (!canvas) return
    canvas.getContext('2d')!.clearRect(0, 0, canvas.width, canvas.height)
    setHasSig(false)
  }

  const fetchAndContinue = async () => {
    if (!canProceed) { toast.error('Informe ao menos um valor.'); return }
    const counted = blindTotal
    setLoading(true)
    try {
      // Warn if there are pending approvals
      const pendingRes = await financeService.listPendingApprovals().catch(() => ({ data: [] }))
      const pendingCount = pendingRes.data?.length ?? 0
      if (pendingCount > 0) {
        const ok = window.confirm(
          `⚠️ Há ${pendingCount} despesa(s) pendente(s) de aprovação!\n\nSe fechar agora, essas despesas ficam sem aprovação e podem gerar diferença.\n\nClique em OK para fechar mesmo assim, ou Cancelar para revisar antes.`
        )
        if (!ok) { setLoading(false); return }
      }
      const res = await financeService.listTransactions(session.id)
      const txs: Transaction[] = res.data
      setTransactions(txs)
      const income = txs.filter(t => t.type === 'income' && !(t as any).reversed_at && !t.is_reversal).reduce((s, t) => s + parseFloat(t.amount), 0)
      const exits = txs.filter(t => t.type !== 'income' && !(t as any).reversed_at && !t.is_reversal).reduce((s, t) => s + parseFloat(t.amount), 0)
      const expected = income - exits
      setResult({ expected, counted, diff: counted - expected, blindPix: blindPixVal, blindDinheiro: blindDinheiroVal })
      setStep('troco')
    } catch {
      toast.error('Erro ao buscar movimentações.')
    } finally {
      setLoading(false)
    }
  }

  const printClosingReceipt = (txs: Transaction[], res: typeof result, assocName: string) => {
    if (!res) return
    const fmtR = (v: number) => `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    const active = txs.filter(t => !(t as any).reversed_at && !(t as any).is_reversal)
    const reversed = txs.filter(t => (t as any).reversed_at)
    const totalEstornos = reversed.reduce((s, t) => s + parseFloat(t.amount), 0)

    // Group by payment method
    const byPm: Record<string, number> = {}
    for (const t of active.filter(t => t.type === 'income')) {
      const key = (t as any).payment_method_name ?? 'Não informado'
      byPm[key] = (byPm[key] ?? 0) + parseFloat(t.amount)
    }
    const income = active.filter(t => t.type === 'income').reduce((s, t) => s + parseFloat(t.amount), 0)
    const exits = active.filter(t => t.type !== 'income').reduce((s, t) => s + parseFloat(t.amount), 0)

    const now = new Date().toLocaleString('pt-BR')
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Fechamento de Caixa</title>
<style>@page{size:80mm auto;margin:2mm}*{box-sizing:border-box;margin:0;padding:0;font-family:'Courier New',monospace;font-size:7.5pt}body{width:80mm}</style>
</head><body>
<div style="text-align:center;padding:2mm 0 1.5mm;border-bottom:2px solid #111">
  <div style="font-size:9.5pt;font-weight:bold;text-transform:uppercase">${assocName || 'Associação'}</div>
  <div style="font-size:6.5pt;margin-top:.5mm">FECHAMENTO DE CAIXA</div>
  <div style="font-size:6pt;color:#555;margin-top:.5mm">${now}</div>
</div>

<div style="padding:2mm;border-bottom:1px dashed #999">
  <div style="font-size:6pt;font-weight:bold;color:#555;margin-bottom:1mm">RESUMO</div>
  <div style="display:flex;justify-content:space-between"><span>Saldo abertura</span><span>${fmtR(parseFloat(session.opening_balance))}</span></div>
  <div style="display:flex;justify-content:space-between"><span>Total entradas</span><span style="color:#166534">${fmtR(income)}</span></div>
  <div style="display:flex;justify-content:space-between"><span>Total saídas</span><span style="color:#991b1b">${fmtR(exits)}</span></div>
  <div style="display:flex;justify-content:space-between"><span>Total estornos</span><span style="color:#92400e">${fmtR(totalEstornos)}</span></div>
  <div style="display:flex;justify-content:space-between;font-weight:bold;margin-top:1.5mm;border-top:1px solid #ccc;padding-top:1mm"><span>Saldo esperado</span><span>${fmtR(res.expected)}</span></div>
  <div style="display:flex;justify-content:space-between;font-weight:bold"><span>Total contado</span><span>${fmtR(res.counted)}</span></div>
  <div style="display:flex;justify-content:space-between"><span style="color:#555">PIX contado</span><span>${fmtR(res.blindPix)}</span></div>
  <div style="display:flex;justify-content:space-between"><span style="color:#555">Dinheiro contado</span><span>${fmtR(res.blindDinheiro)}</span></div>
  <div style="display:flex;justify-content:space-between;font-weight:bold;color:${res.diff === 0 ? '#166534' : res.diff > 0 ? '#1d4ed8' : '#991b1b'}"><span>Diferença</span><span>${res.diff >= 0 ? '+' : ''}${fmtR(res.diff)}</span></div>
</div>

<div style="padding:2mm;border-bottom:1px dashed #999">
  <div style="font-size:6pt;font-weight:bold;color:#555;margin-bottom:1mm">POR FORMA DE PAGAMENTO</div>
  ${Object.entries(byPm).map(([k, v]) => `<div style="display:flex;justify-content:space-between"><span>${k}</span><span>${fmtR(v)}</span></div>`).join('')}
  ${Object.keys(byPm).length === 0 ? '<div style="color:#aaa">Nenhuma entrada.</div>' : ''}
</div>

<div style="padding:2mm;border-bottom:1px dashed #999">
  <div style="font-size:6pt;font-weight:bold;color:#555;margin-bottom:1mm">MOVIMENTAÇÕES (${active.length} lançamentos)</div>
  ${active.slice(0, 30).map(t => `<div style="display:flex;justify-content:space-between;margin-bottom:.5mm">
    <span style="max-width:48mm;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;color:${t.type === 'income' ? '#166534' : '#991b1b'}">${t.description}</span>
    <span style="white-space:nowrap">${fmtR(parseFloat(t.amount))}</span>
  </div>`).join('')}
  ${active.length > 30 ? `<div style="color:#aaa;font-size:6pt">... e mais ${active.length - 30} lançamentos</div>` : ''}
</div>

<div style="padding:2mm">
  <div style="margin-top:3mm">Conferido por:</div>
  <div style="border-bottom:1px solid #999;height:6mm;margin-top:1mm"></div>
  <div style="margin-top:1mm;font-size:5.5pt;color:#aaa">Emitido em ${now}</div>
</div>
</body></html>`

    const w = window.open('', '_blank', 'width=400,height=800')
    if (!w) return
    w.document.write(html); w.document.close(); w.focus()
    setTimeout(() => w.print(), 400)
  }

  const handleConfirm = async () => {
    if (!result) return
    setLoading(true)
    try {
      await financeService.closeSession(
        result.counted, undefined, undefined,
        result.blindPix, result.blindDinheiro,
        parseFloat(trocoValor.replace(',', '.')) || 0,
      )
      if (registrarQuebra && result.diff !== 0) {
        const tipo = result.diff > 0 ? 'sobra' : 'desconto'
        await api.post(`/finance/sessions/${session.id}/quebra`, {
          tipo,
          amount: Math.abs(result.diff).toFixed(2),
        }).catch(() => {})
      }
      printClosingReceipt(transactions, result, (settings as any)?.association_name ?? '')
      onRefresh()
      setStep('done')
      setTimeout(() => { onDone() }, 1800)
    } catch (e: any) {
      toast.error(e.response?.data?.detail ?? 'Erro ao fechar caixa.')
      onRefresh()
    } finally {
      setLoading(false)
    }
  }

  const income = transactions.filter(t => t.type === 'income' && !(t as any).reversed_at && !t.is_reversal).reduce((s, t) => s + parseFloat(t.amount), 0)
  const exits = transactions.filter(t => t.type !== 'income' && !(t as any).reversed_at && !t.is_reversal).reduce((s, t) => s + parseFloat(t.amount), 0)

  // Step labels differ per role
  const stepLabels = isOperator
    ? [{ key: 'blind', label: 'Contagem Cega' }, { key: 'troco', label: 'Troco' }, { key: 'sign', label: 'Assinatura' }]
    : [{ key: 'blind', label: 'Contagem Cega' }, { key: 'troco', label: 'Troco' }, { key: 'review', label: 'Conferência' }]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <Lock className="w-4 h-4 text-gray-500" />
            <span className="font-bold text-gray-900 text-sm">Fechamento de Caixa</span>
          </div>
          {step !== 'done' && (
            <button onClick={onCancel} className="text-gray-400 hover:text-gray-600"><X className="w-4 h-4" /></button>
          )}
        </div>

        {step !== 'done' && (
          <div className="flex border-b border-gray-100">
            {stepLabels.map(({ key, label }, i) => (
              <div key={key} className={`flex-1 py-2 text-center text-xs font-medium border-b-2 transition ${
                step === key ? 'border-[#26619c] text-[#26619c]' :
                (stepLabels.findIndex(s => s.key === key) < stepLabels.findIndex(s => s.key === step)) ? 'border-green-400 text-green-600' :
                'border-transparent text-gray-400'
              }`}>
                {i + 1}. {label}
              </div>
            ))}
          </div>
        )}

        <div className="px-6 py-5">
          {/* ── Step 1: Blind count ── */}
          {step === 'blind' && (
            <div className="flex flex-col gap-4">
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-amber-900">Contagem Cega</p>
                  <p className="text-xs text-amber-700 mt-1">Conte o dinheiro na gaveta <strong>sem olhar o sistema</strong>. Informe o valor contado abaixo.</p>
                </div>
              </div>
              <div className="flex flex-col gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">PIX (R$)</label>
                  <input type="number" min="0" step="0.01" value={blindPix}
                    onChange={e => setBlindPix(e.target.value)} placeholder="0,00" autoFocus
                    className="w-full border border-gray-300 rounded-xl px-4 py-3 text-lg font-semibold text-center focus:outline-none focus:ring-2 focus:ring-[#26619c]/40 focus:border-[#26619c]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Dinheiro (R$)</label>
                  <input type="number" min="0" step="0.01" value={blindDinheiro}
                    onChange={e => setBlindDinheiro(e.target.value)} placeholder="0,00"
                    onKeyDown={e => { if (e.key === 'Enter' && canProceed) fetchAndContinue() }}
                    className="w-full border border-gray-300 rounded-xl px-4 py-3 text-lg font-semibold text-center focus:outline-none focus:ring-2 focus:ring-[#26619c]/40 focus:border-[#26619c]"
                  />
                </div>
                <div className="bg-gray-50 rounded-xl px-4 py-3 flex items-center justify-between border border-gray-200">
                  <span className="text-xs font-medium text-gray-500">Total contado</span>
                  <span className="text-lg font-bold text-gray-900">R$ {fmt(blindTotal)}</span>
                </div>
              </div>
              <div className="flex gap-3">
                <button onClick={onCancel} className="flex-1 border border-gray-300 text-gray-600 py-2.5 rounded-xl text-sm hover:bg-gray-50 transition">Cancelar</button>
                <button onClick={fetchAndContinue} disabled={!canProceed || loading}
                  className="flex-1 bg-[#26619c] hover:bg-[#1a4f87] text-white py-2.5 rounded-xl text-sm font-semibold transition disabled:opacity-50">
                  {loading ? 'Calculando…' : isOperator ? 'Próximo →' : 'Ver Conferência →'}
                </button>
              </div>
            </div>
          )}

          {/* ── Step troco ── */}
          {step === 'troco' && (
            <div className="flex flex-col gap-4">
              <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
                <p className="text-sm font-semibold text-blue-900">Troco no caixa</p>
                <p className="text-xs text-blue-700 mt-1">Quanto você vai deixar de troco na gaveta para o próximo turno?</p>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Valor do troco (R$)</label>
                <input type="number" min="0" step="0.01" value={trocoValor}
                  onChange={e => setTrocoValor(e.target.value)} placeholder="0,00" autoFocus
                  onKeyDown={e => { if (e.key === 'Enter') setStep(isOperator ? 'sign' : 'review') }}
                  className="w-full border border-gray-300 rounded-xl px-4 py-3 text-lg font-semibold text-center focus:outline-none focus:ring-2 focus:ring-[#26619c]/40 focus:border-[#26619c]"
                />
              </div>
              <div className="flex gap-3">
                <button onClick={() => setStep('blind')} className="flex-1 border border-gray-300 text-gray-600 py-2.5 rounded-xl text-sm hover:bg-gray-50 transition">← Voltar</button>
                <button onClick={() => setStep(isOperator ? 'sign' : 'review')}
                  className="flex-1 bg-[#26619c] hover:bg-[#1a4f87] text-white py-2.5 rounded-xl text-sm font-semibold transition">
                  {isOperator ? 'Próximo →' : 'Ver Conferência →'}
                </button>
              </div>
            </div>
          )}

          {/* ── Step sign (operator only): signature ── */}
          {step === 'sign' && result && (
            <div className="flex flex-col gap-4">
              <div className="bg-gray-50 rounded-xl p-4 text-center">
                <p className="text-xs text-gray-400">Duração</p>
                <p className="font-semibold text-gray-800">{elapsed(session.opened_at)}</p>
              </div>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-medium text-gray-600">Assinatura do operador *</label>
                  <button onClick={clearSig} className="text-xs text-gray-400 hover:text-red-500">Limpar</button>
                </div>
                <canvas
                  ref={canvasRef}
                  width={380} height={120}
                  onMouseDown={startDraw} onMouseMove={draw} onMouseUp={stopDraw} onMouseLeave={stopDraw}
                  onTouchStart={startDraw} onTouchMove={draw} onTouchEnd={stopDraw}
                  className="w-full border-2 border-gray-300 rounded-xl bg-white cursor-crosshair touch-none"
                  style={{ height: 120 }}
                />
                {!hasSig && <p className="text-xs text-amber-600 font-medium mt-1 text-center">⚠️ Assinatura obrigatória para fechar o caixa</p>}
              </div>
              <button onClick={!hasSig ? () => toast.error('Assine o campo acima para confirmar o fechamento.') : handleConfirm} disabled={loading}
                className="w-full bg-red-600 hover:bg-red-700 text-white py-2.5 rounded-xl text-sm font-semibold transition disabled:opacity-50 flex items-center justify-center gap-1.5">
                <Lock className="w-3.5 h-3.5" />
                {loading ? 'Fechando…' : 'Confirmar Fechamento'}
              </button>
            </div>
          )}

          {/* ── Step 2: Review (non-operator) ── */}
          {step === 'review' && result && (
            <div className="flex flex-col gap-4">
              <div className="bg-gray-50 rounded-xl p-4 grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-xs text-gray-400">Saldo de abertura</p>
                  <p className="font-semibold text-gray-800">R$ {fmt(openingBalance)}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-400">Duração</p>
                  <p className="font-semibold text-gray-800">{elapsed(session.opened_at)}</p>
                </div>
                <div className="flex items-center gap-1">
                  <PlusCircle className="w-3.5 h-3.5 text-green-500 shrink-0" />
                  <div>
                    <p className="text-xs text-gray-400">Entradas</p>
                    <p className="font-semibold text-green-700">R$ {fmt(income)}</p>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <MinusCircle className="w-3.5 h-3.5 text-red-500 shrink-0" />
                  <div>
                    <p className="text-xs text-gray-400">Saídas</p>
                    <p className="font-semibold text-red-600">R$ {fmt(exits)}</p>
                  </div>
                </div>
              </div>

              <div className="border border-gray-200 rounded-xl overflow-hidden">
                <div className="flex">
                  <div className="flex-1 p-4 text-center border-r border-gray-200">
                    <p className="text-xs text-gray-500 mb-1">Saldo esperado</p>
                    <p className="text-xl font-bold text-gray-800">R$ {fmt(result.expected)}</p>
                  </div>
                  <div className="flex-1 p-4 text-center">
                    <p className="text-xs text-gray-500 mb-1">Total contado</p>
                    <p className="text-xl font-bold text-[#26619c]">R$ {fmt(result.counted)}</p>
                    <p className="text-xs text-gray-400 mt-1">
                      PIX R$ {fmt(result.blindPix)} · Din. R$ {fmt(result.blindDinheiro)}
                    </p>
                  </div>
                </div>
                <div className={`px-4 py-3 text-center border-t border-gray-200 ${result.diff === 0 ? 'bg-green-50' : result.diff > 0 ? 'bg-blue-50' : 'bg-red-50'}`}>
                  <p className="text-xs font-medium text-gray-500 mb-0.5">Diferença</p>
                  <p className={`text-lg font-bold ${result.diff === 0 ? 'text-green-700' : result.diff > 0 ? 'text-blue-700' : 'text-red-700'}`}>
                    {result.diff >= 0 ? '+' : ''}R$ {fmt(result.diff)}
                  </p>
                  <p className={`text-xs mt-0.5 ${result.diff === 0 ? 'text-green-600' : result.diff > 0 ? 'text-blue-600' : 'text-red-600'}`}>
                    {result.diff === 0 ? 'Caixa conferido — sem diferença' : result.diff > 0 ? 'Sobra de caixa detectada' : 'Falta de caixa detectada'}
                  </p>
                </div>
              </div>

              {/* Deposit guidance */}
              {settings && (() => {
                const minBalance = parseFloat(settings.default_cash_balance ?? '20')
                const toDeposit = Math.max(0, result.counted - minBalance)
                return toDeposit > 0 ? (
                  <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-xs">
                    <p className="font-semibold text-blue-800 mb-1">Orientação de depósito</p>
                    <div className="flex justify-between text-blue-700">
                      <span>Manter no caixa</span>
                      <span className="font-semibold">R$ {fmt(minBalance)}</span>
                    </div>
                    <div className="flex justify-between text-blue-700 mt-0.5">
                      <span>Depositar no banco</span>
                      <span className="font-semibold text-green-700">R$ {fmt(toDeposit)}</span>
                    </div>
                  </div>
                ) : null
              })()}

              {result.diff !== 0 && (
                <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={registrarQuebra}
                    onChange={e => setRegistrarQuebra(e.target.checked)}
                    className="w-4 h-4 rounded border-gray-300"
                  />
                  <span className="text-gray-700">
                    Registrar quebra de caixa (R$ {fmt(Math.abs(result.diff))})
                  </span>
                </label>
              )}

              <div className="flex gap-3">
                <button onClick={() => setStep('troco')}
                  className="flex-1 border border-gray-300 text-gray-600 py-2.5 rounded-xl text-sm hover:bg-gray-50 transition">
                  ← Voltar
                </button>
                <button onClick={handleConfirm} disabled={loading}
                  className="flex-1 bg-red-600 hover:bg-red-700 text-white py-2.5 rounded-xl text-sm font-semibold transition disabled:opacity-50 flex items-center justify-center gap-1.5">
                  <Lock className="w-3.5 h-3.5" />
                  {loading ? 'Fechando…' : 'Confirmar Fechamento'}
                </button>
              </div>
            </div>
          )}

          {/* ── Done ── */}
          {step === 'done' && result && (
            <div className="flex flex-col items-center gap-4 py-4">
              <div className={`w-16 h-16 rounded-full flex items-center justify-center ${result.diff === 0 ? 'bg-green-100' : 'bg-amber-100'}`}>
                <CheckCircle className={`w-8 h-8 ${result.diff === 0 ? 'text-green-600' : 'text-amber-500'}`} />
              </div>
              <div className="text-center">
                <p className="font-bold text-gray-900 mb-1">Caixa fechado!</p>
                <p className="text-sm text-gray-500">
                  {result.diff === 0 ? 'Caixa conferido com sucesso. Sem diferença.' :
                   result.diff > 0 ? `Sobra de R$ ${fmt(result.diff)} registrada.` :
                   `Falta de R$ ${fmt(Math.abs(result.diff))} registrada.`}
                </p>
              </div>
              {settings && (() => {
                const minBalance = parseFloat(settings.default_cash_balance ?? '20')
                const toDeposit = Math.max(0, result.counted - minBalance)
                return toDeposit > 0 ? (
                  <div className="w-full bg-blue-50 border border-blue-200 rounded-xl p-3 text-xs">
                    <p className="font-semibold text-blue-800 mb-1">Depositar no banco</p>
                    <p className="text-blue-700">Mantenha <strong>R$ {fmt(minBalance)}</strong> no caixa e deposite <strong className="text-green-700">R$ {fmt(toDeposit)}</strong> na conta da associação.</p>
                  </div>
                ) : null
              })()}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Conferência modal ─────────────────────────────────────────────────────────

interface ConferenciaModalProps {
  session: CashSession
  onDone: () => void
  onCancel: () => void
}

function ConferenciaModal({ session, onDone, onCancel }: ConferenciaModalProps) {
  const [step, setStep] = useState<'blind' | 'review' | 'done'>('blind')
  const [blindPix, setBlindPix] = useState('')
  const [blindDinheiro, setBlindDinheiro] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<{ expected: number; counted: number; diff: number; income: number; exits: number; blindPix: number; blindDinheiro: number } | null>(null)
  const [syncingPix, setSyncingPix] = useState(false)
  const [pixSynced, setPixSynced] = useState<number | null>(null)

  const blindPixVal = parseFloat(blindPix.replace(',', '.')) || 0
  const blindDinheiroVal = parseFloat(blindDinheiro.replace(',', '.')) || 0
  const blindTotal = blindPixVal + blindDinheiroVal
  const canProceed = (blindPix !== '' || blindDinheiro !== '') && blindTotal >= 0

  const handleConferencia = async () => {
    if (!canProceed) { toast.error('Informe ao menos um valor.'); return }
    const counted = blindTotal
    setLoading(true)
    try {
      const res = await financeService.conferencia(counted)
      const d = res.data
      setResult({
        expected: parseFloat(d.expected),
        counted: parseFloat(d.counted),
        diff: parseFloat(d.difference),
        income: parseFloat(d.income),
        exits: parseFloat(d.exits),
        blindPix: blindPixVal,
        blindDinheiro: blindDinheiroVal,
      })
      setStep('review')
    } catch (e: any) {
      toast.error(e.response?.data?.detail ?? 'Erro ao realizar conferência.')
    } finally {
      setLoading(false)
    }
  }

  const openingBalance = parseFloat(session.opening_balance)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <ClipboardCheck className="w-4 h-4 text-gray-500" />
            <span className="font-bold text-gray-900 text-sm">Conferência de Caixa</span>
          </div>
          {step !== 'done' && (
            <button onClick={onCancel} className="text-gray-400 hover:text-gray-600"><X className="w-4 h-4" /></button>
          )}
        </div>

        {/* Step indicators */}
        {step !== 'done' && (
          <div className="flex border-b border-gray-100">
            {(['blind', 'review'] as const).map((s, i) => (
              <div key={s} className={`flex-1 py-2 text-center text-xs font-medium border-b-2 transition ${
                step === s ? 'border-[#26619c] text-[#26619c]' :
                (step === 'review' && s === 'blind') ? 'border-green-400 text-green-600' :
                'border-transparent text-gray-400'
              }`}>
                {i + 1}. {s === 'blind' ? 'Contagem Cega' : 'Resultado'}
              </div>
            ))}
          </div>
        )}

        <div className="px-6 py-5">
          {/* ── Step 1: Blind count ── */}
          {step === 'blind' && (
            <div className="flex flex-col gap-4">
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-semibold text-amber-900">Contagem Cega</p>
                    <p className="text-xs text-amber-700 mt-1">
                      Conte o dinheiro na gaveta <strong>sem olhar o sistema</strong>.
                      Informe o valor contado abaixo.
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex flex-col gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">PIX (R$)</label>
                  <input
                    type="number" min="0" step="0.01"
                    value={blindPix} onChange={e => setBlindPix(e.target.value)}
                    placeholder="0,00" autoFocus
                    className="w-full border border-gray-300 rounded-xl px-4 py-3 text-lg font-semibold text-center focus:outline-none focus:ring-2 focus:ring-[#26619c]/40 focus:border-[#26619c]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Dinheiro (R$)</label>
                  <input
                    type="number" min="0" step="0.01"
                    value={blindDinheiro} onChange={e => setBlindDinheiro(e.target.value)}
                    placeholder="0,00"
                    onKeyDown={e => { if (e.key === 'Enter' && canProceed) handleConferencia() }}
                    className="w-full border border-gray-300 rounded-xl px-4 py-3 text-lg font-semibold text-center focus:outline-none focus:ring-2 focus:ring-[#26619c]/40 focus:border-[#26619c]"
                  />
                </div>
                <div className="bg-gray-50 rounded-xl px-4 py-3 flex items-center justify-between border border-gray-200">
                  <span className="text-xs font-medium text-gray-500">Total contado</span>
                  <span className="text-lg font-bold text-gray-900">R$ {fmt(blindTotal)}</span>
                </div>
              </div>

              <button
                onClick={async () => {
                  setSyncingPix(true)
                  try {
                    const r = await api.post<{ synced: number }>('/finance/sessions/sync-pix')
                    setPixSynced(r.data.synced)
                    toast.success(`${r.data.synced} lançamento(s) PIX sincronizado(s).`)
                  } catch {
                    toast.error('Erro ao sincronizar PIX.')
                  } finally {
                    setSyncingPix(false)
                  }
                }}
                disabled={syncingPix}
                className="w-full border border-blue-300 text-blue-700 py-2 rounded-xl text-sm font-medium hover:bg-blue-50 transition disabled:opacity-50"
              >
                {syncingPix ? 'Sincronizando…' : pixSynced !== null ? `PIX sincronizado (${pixSynced})` : 'Sincronizar PIX'}
              </button>

              <div className="flex gap-3">
                <button onClick={onCancel}
                  className="flex-1 border border-gray-300 text-gray-600 py-2.5 rounded-xl text-sm hover:bg-gray-50 transition">
                  Cancelar
                </button>
                <button onClick={handleConferencia} disabled={!canProceed || loading}
                  className="flex-1 bg-[#26619c] hover:bg-[#1a4f87] text-white py-2.5 rounded-xl text-sm font-semibold transition disabled:opacity-50">
                  {loading ? 'Calculando…' : 'Ver Resultado →'}
                </button>
              </div>
            </div>
          )}

          {/* ── Step 2: Review/Result ── */}
          {step === 'review' && result && (
            <div className="flex flex-col gap-4">
              {/* Summary grid */}
              <div className="bg-gray-50 rounded-xl p-4 grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-xs text-gray-400">Saldo de abertura</p>
                  <p className="font-semibold text-gray-800">R$ {fmt(openingBalance)}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-400">Duração</p>
                  <p className="font-semibold text-gray-800">{elapsed(session.opened_at)}</p>
                </div>
                <div className="flex items-center gap-1">
                  <PlusCircle className="w-3.5 h-3.5 text-green-500 shrink-0" />
                  <div>
                    <p className="text-xs text-gray-400">Entradas</p>
                    <p className="font-semibold text-green-700">R$ {fmt(result.income)}</p>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <MinusCircle className="w-3.5 h-3.5 text-red-500 shrink-0" />
                  <div>
                    <p className="text-xs text-gray-400">Saídas</p>
                    <p className="font-semibold text-red-600">R$ {fmt(result.exits)}</p>
                  </div>
                </div>
              </div>

              {/* Expected vs Counted */}
              <div className="border border-gray-200 rounded-xl overflow-hidden">
                <div className="flex">
                  <div className="flex-1 p-4 text-center border-r border-gray-200">
                    <p className="text-xs text-gray-500 mb-1">Saldo esperado</p>
                    <p className="text-xl font-bold text-gray-800">R$ {fmt(result.expected)}</p>
                  </div>
                  <div className="flex-1 p-4 text-center">
                    <p className="text-xs text-gray-500 mb-1">Total contado</p>
                    <p className="text-xl font-bold text-[#26619c]">R$ {fmt(result.counted)}</p>
                    <p className="text-xs text-gray-400 mt-1">
                      PIX R$ {fmt(result.blindPix)} · Din. R$ {fmt(result.blindDinheiro)}
                    </p>
                  </div>
                </div>
                <div className={`px-4 py-3 text-center border-t border-gray-200 ${
                  result.diff === 0 ? 'bg-green-50' : result.diff > 0 ? 'bg-blue-50' : 'bg-red-50'
                }`}>
                  <p className="text-xs font-medium text-gray-500 mb-0.5">Diferença</p>
                  <p className={`text-lg font-bold ${
                    result.diff === 0 ? 'text-green-700' : result.diff > 0 ? 'text-blue-700' : 'text-red-700'
                  }`}>
                    {result.diff >= 0 ? '+' : ''}R$ {fmt(result.diff)}
                  </p>
                  <p className={`text-xs mt-0.5 ${
                    result.diff === 0 ? 'text-green-600' : result.diff > 0 ? 'text-blue-600' : 'text-red-600'
                  }`}>
                    {result.diff === 0 ? 'Caixa conferido — sem diferença' :
                     result.diff > 0 ? 'Sobra de caixa detectada' : 'Falta de caixa detectada'}
                  </p>
                </div>
              </div>

              <div className="flex gap-3">
                <button onClick={() => setStep('blind')}
                  className="flex-1 border border-gray-300 text-gray-600 py-2.5 rounded-xl text-sm hover:bg-gray-50 transition">
                  ← Redigitar
                </button>
                <button
                  onClick={() => { setStep('done'); setTimeout(() => { onDone() }, 1500) }}
                  className="flex-1 bg-[#26619c] hover:bg-[#1a4f87] text-white py-2.5 rounded-xl text-sm font-semibold transition flex items-center justify-center gap-1.5">
                  <ClipboardCheck className="w-3.5 h-3.5" />
                  Registrar Conferência
                </button>
              </div>
            </div>
          )}

          {/* ── Step 3: Done ── */}
          {step === 'done' && result && (
            <div className="flex flex-col items-center gap-4 py-4">
              <div className={`w-16 h-16 rounded-full flex items-center justify-center ${
                result.diff === 0 ? 'bg-green-100' : 'bg-amber-100'
              }`}>
                <CheckCircle className={`w-8 h-8 ${result.diff === 0 ? 'text-green-600' : 'text-amber-500'}`} />
              </div>
              <div className="text-center">
                <p className="font-bold text-gray-900 mb-1">Conferência registrada!</p>
                <p className="text-sm text-gray-500">
                  {result.diff === 0
                    ? 'Caixa conferido com sucesso. Sem diferença.'
                    : result.diff > 0
                      ? `Sobra de R$ ${fmt(result.diff)} registrada.`
                      : `Falta de R$ ${fmt(Math.abs(result.diff))} registrada.`}
                </p>
                <p className="text-xs text-gray-400 mt-1">O caixa continua aberto.</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Main panel ────────────────────────────────────────────────────────────────

export function CashSessionPanel({ session, onRefresh, canConferencia = true }: Props) {
  const fullName = useAuthStore((s) => s.fullName)
  const userId = useAuthStore((s) => s.userId)
  const role = useAuthStore((s) => s.role)
  const isOperator = role === 'operator'
  const [openBalance, setOpenBalance] = useState('')
  const [sessionType, setSessionType] = useState<'pdv' | 'externo'>('pdv')
  const [opening, setOpening] = useState(false)
  const [showClose, setShowClose] = useState(false)
  const [showConferencia, setShowConferencia] = useState(false)
  const navigate = useNavigate()

  const handleOpen = async () => {
    setOpening(true)
    try {
      await financeService.openSession(parseFloat(openBalance) || 0, undefined, sessionType)
      toast.success('Caixa aberto!')
      if (sessionType === 'externo') {
        navigate('/crm')
      } else {
        onRefresh()
      }
    } catch (e: any) {
      toast.error(e.response?.data?.detail ?? 'Erro ao abrir caixa.')
    } finally {
      setOpening(false)
    }
  }

  const mySession = session && session.opened_by === userId
  const otherSession = session && session.opened_by !== userId
  const isAdmin = ['admin', 'admin_master', 'superadmin'].includes(role ?? '')

  // ── Caixa fechado ou pertence a outro operador (admins sempre veem controles) ─
  if (!session || (otherSession && !isAdmin)) {
    return (
      <div className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
        <div className="bg-gray-50 px-5 py-4 border-b border-gray-100">
          <h2 className="font-bold text-gray-800 flex items-center gap-2 text-sm">
            <DollarSign className="w-4 h-4 text-gray-400" />
            Frente de Caixa
          </h2>
          <p className="text-xs text-gray-400 mt-0.5">
            {otherSession ? `Caixa aberto por ${session!.opened_by_name ?? 'outro operador'}` : 'Nenhuma sessão ativa'}
          </p>
        </div>

        <div className="p-5 flex flex-col gap-4">
          {fullName && (
            <div className="flex items-center gap-2 text-sm text-gray-600 bg-gray-50 rounded-xl px-4 py-2.5 border border-gray-100">
              <User className="w-4 h-4 text-gray-400" />
              <span>Operador: <strong>{fullName}</strong></span>
            </div>
          )}

          <div className="flex gap-2">
            {(['pdv', 'externo'] as const).map(t => (
              <button key={t} type="button" onClick={() => setSessionType(t)}
                className={`flex-1 py-2.5 rounded-xl text-sm font-semibold border transition ${sessionType === t ? 'bg-[#26619c] text-white border-[#26619c]' : 'border-gray-300 text-gray-600 hover:border-[#26619c]'}`}>
                {t === 'pdv' ? '🖥 PDV' : '📱 Externo'}
              </button>
            ))}
          </div>

          {sessionType === 'pdv' && (
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1.5">Saldo inicial (R$)</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={openBalance}
                onChange={e => setOpenBalance(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleOpen() }}
                placeholder="0,00"
                className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#26619c]/40 focus:border-[#26619c]"
              />
            </div>
          )}

          {sessionType === 'externo' && (
            <p className="text-xs text-gray-500 bg-blue-50 border border-blue-100 rounded-xl px-4 py-3">
              Sessão de campo — somente registro de mensalidades via CRM.
            </p>
          )}

          <button
            onClick={handleOpen}
            disabled={opening}
            className="w-full flex items-center justify-center gap-2 bg-[#26619c] hover:bg-[#1a4f87] text-white py-3 rounded-xl font-semibold text-sm transition disabled:opacity-50"
          >
            <Unlock className="w-4 h-4" />
            {opening ? 'Abrindo…' : 'Abrir Caixa'}
          </button>
        </div>
      </div>
    )
  }

  // ── Caixa aberto ──────────────────────────────────────────────────────────
  const openedTime = new Date(session.opened_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })

  return (
    <>
      <div className="rounded-2xl border border-green-200 bg-white shadow-sm overflow-hidden">
        {/* Session header */}
        <div className="bg-green-600 px-5 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2 text-white">
            <Unlock className="w-4 h-4" />
            <span className="font-bold text-sm">Caixa Aberto</span>
          </div>
          <div className="flex items-center gap-3 text-green-100 text-xs">
            <span>Aberto às {openedTime}</span>
            <span className="bg-green-500 px-2 py-0.5 rounded-full font-medium text-white">
              {elapsed(session.opened_at)}
            </span>
          </div>
        </div>

        <div className="p-5 flex flex-col gap-4">
          {/* Operator + opening balance */}
          <div className="grid grid-cols-2 gap-3">
            {fullName && (
              <div className="bg-gray-50 rounded-xl px-3 py-2.5 border border-gray-100">
                <p className="text-xs text-gray-400 mb-0.5">Aberto por</p>
                <p className="text-sm font-semibold text-gray-800 truncate">{session.opened_by_name ?? fullName}</p>
              </div>
            )}
            {!isOperator && (
              <div className="bg-gray-50 rounded-xl px-3 py-2.5 border border-gray-100">
                <p className="text-xs text-gray-400 mb-0.5">Saldo de abertura</p>
                <p className="text-sm font-semibold text-gray-800">
                  R$ {fmt(parseFloat(session.opening_balance))}
                </p>
              </div>
            )}
          </div>

          {/* Instructions */}
          <div className="flex items-start gap-2 bg-blue-50 border border-blue-100 rounded-xl px-4 py-3 text-xs text-blue-800">
            <TrendingUp className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" />
            <p>Registre entradas e saídas usando os botões acima. Ao encerrar o turno, clique em <strong>Fechar Caixa</strong> para realizar a conferência.</p>
          </div>

          {/* Conferência + Close buttons */}
          {canConferencia ? (
            <div className="grid grid-cols-2 gap-3">
              <button onClick={() => setShowConferencia(true)} className="flex items-center justify-center gap-2 border-2 border-[#26619c] text-[#26619c] hover:bg-[#26619c]/5 py-3 rounded-xl font-semibold text-sm transition">
                <ClipboardCheck className="w-4 h-4" />
                Conferência
              </button>
              <button onClick={() => setShowClose(true)} className="flex items-center justify-center gap-2 bg-red-600 hover:bg-red-700 text-white py-3 rounded-xl font-semibold text-sm transition">
                <Lock className="w-4 h-4" />
                Fechar Caixa
              </button>
            </div>
          ) : (
            <button onClick={() => setShowClose(true)} className="w-full flex items-center justify-center gap-2 bg-red-600 hover:bg-red-700 text-white py-3 rounded-xl font-semibold text-sm transition">
              <Lock className="w-4 h-4" />
              Fechar Caixa
            </button>
          )}

          {userId && session.opened_by !== userId && (
            <button
              onClick={async () => {
                try {
                  await financeService.openSession(0)
                  toast.success('Seu caixa foi aberto!')
                  onRefresh()
                } catch (e: any) {
                  toast.error(e.response?.data?.detail ?? 'Erro ao abrir caixa.')
                }
              }}
              className="w-full flex items-center justify-center gap-2 border border-[#26619c] text-[#26619c] hover:bg-[#26619c]/5 py-2.5 rounded-xl text-sm font-medium transition"
            >
              <Unlock className="w-4 h-4" />
              Abrir meu caixa
            </button>
          )}
        </div>
      </div>

      {showClose && (
        <CloseModal
          session={session}
          onDone={() => { setShowClose(false); onRefresh() }}
          onCancel={() => setShowClose(false)}
          onRefresh={onRefresh}
        />
      )}

      {showConferencia && (
        <ConferenciaModal
          session={session}
          onDone={() => setShowConferencia(false)}
          onCancel={() => setShowConferencia(false)}
        />
      )}
    </>
  )
}
