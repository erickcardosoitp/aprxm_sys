import { useCallback, useEffect, useState } from 'react'
import {
  Plus, RefreshCw, X, Link, Users, TrendingUp, Clock, AlertCircle,
  CheckCircle, Package, ChevronRight,
} from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../../services/api'

interface User { id: string; full_name: string }
interface CashBox { id: string; name: string; is_malote: boolean }

const fmt = (v: string | number) =>
  `R$ ${parseFloat(String(v)).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const inputCls = 'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#26619c]/40 focus:border-[#26619c]'

function monthsDiff(from: string, to: string): number {
  const [fy, fm] = from.split('-').map(Number)
  const [ty, tm] = to.split('-').map(Number)
  return (ty * 12 + tm) - (fy * 12 + fm) + 1
}

function currentMonth() {
  const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

// ─── Status badge ─────────────────────────────────────────────────────────────

const STATUS_CFG: Record<string, { label: string; cls: string }> = {
  paid:      { label: 'Pago',      cls: 'bg-green-100 text-green-700' },
  agreement: { label: 'Acordo',    cls: 'bg-purple-100 text-purple-700' },
  pending:   { label: 'Pendente',  cls: 'bg-amber-100 text-amber-700' },
  cancelled: { label: 'Cancelado', cls: 'bg-gray-100 text-gray-500' },
}

// ─── Modals ───────────────────────────────────────────────────────────────────

function AcordoModal({ lead, onClose, onSaved }: {
  lead: any; onClose: () => void; onSaved: () => void
}) {
  const [form, setForm] = useState({
    date_from: currentMonth(), date_to: currentMonth(),
    parcelas: '2', sinal: '', payment_method: '',
  })
  const [saving, setSaving] = useState(false)

  const months = form.date_from && form.date_to ? Math.max(1, monthsDiff(form.date_from, form.date_to)) : 1
  const total = months * parseFloat(lead.monthly_fee || '20')
  const sinalVal = parseFloat(form.sinal || '0')
  const restante = Math.max(0, total - sinalVal)
  const perParcela = restante / Math.max(1, parseInt(form.parcelas || '1'))

  // Commission preview
  const commission = months <= 6 ? 30 : months >= 12 ? 40 : null

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }))

  const handleSave = async () => {
    if (months <= 0) { toast.error('Período inválido.'); return }
    setSaving(true)
    try {
      await api.post(`/porta-a-porta/leads/${lead.id}/acordo`, {
        date_from: form.date_from,
        date_to: form.date_to,
        parcelas: parseInt(form.parcelas),
        sinal: sinalVal > 0 ? sinalVal : undefined,
        payment_method: form.payment_method || null,
      })
      toast.success('Acordo registrado.')
      onSaved()
      onClose()
    } catch (e: any) {
      toast.error(e.response?.data?.detail ?? 'Erro ao registrar acordo.')
    } finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl w-full max-w-sm p-5 flex flex-col gap-4 mb-4 shadow-2xl">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold text-gray-800">Registrar Acordo</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>

        <div className="bg-purple-50 rounded-xl p-3 border border-purple-100">
          <p className="text-sm font-semibold text-purple-900">{lead.full_name}</p>
          <p className="text-xs text-purple-600 mt-0.5">Mensalidade base: {fmt(lead.monthly_fee)}</p>
        </div>

        {/* Date range */}
        <div>
          <label className="text-xs font-medium text-gray-600 mb-1.5 block">Período do acordo</label>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] text-gray-400 mb-0.5 block">De (mês/ano)</label>
              <input type="month" value={form.date_from} onChange={set('date_from')} className={inputCls} />
            </div>
            <div>
              <label className="text-[10px] text-gray-400 mb-0.5 block">Até (mês/ano)</label>
              <input type="month" value={form.date_to} min={form.date_from} onChange={set('date_to')} className={inputCls} />
            </div>
          </div>
          {months > 0 && (
            <div className="mt-2 bg-gray-50 rounded-lg px-3 py-2 text-xs text-gray-600 flex items-center justify-between">
              <span>{months} {months === 1 ? 'mês' : 'meses'}</span>
              <span className="font-bold text-gray-800">Total: {fmt(total)}</span>
              {commission !== null && (
                <span className="text-purple-600 font-medium">Comissão: {fmt(commission)}</span>
              )}
            </div>
          )}
        </div>

        {/* Sinal (optional) */}
        <div>
          <label className="text-xs text-gray-500 mb-0.5 block">Sinal (entrada agora — opcional)</label>
          <input type="number" step="0.01" min="0" value={form.sinal} onChange={set('sinal')} className={inputCls} placeholder="0.00" />
          {sinalVal > 0 && restante > 0 && (
            <p className="text-xs text-purple-600 mt-1">
              Restante: {fmt(restante)} ÷ {form.parcelas} = {fmt(perParcela)}/parcela
            </p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-xs text-gray-500 mb-0.5 block">Parcelas</label>
            <input type="number" min="1" max="24" value={form.parcelas} onChange={set('parcelas')} className={inputCls} />
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-0.5 block">Pagamento do sinal</label>
            <input placeholder="PIX, Dinheiro…" value={form.payment_method} onChange={set('payment_method')} className={inputCls} />
          </div>
        </div>

        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 border border-gray-300 text-gray-600 py-2.5 rounded-xl text-sm">Cancelar</button>
          <button onClick={handleSave} disabled={saving || months <= 0}
            className="flex-1 bg-purple-600 hover:bg-purple-700 text-white py-2.5 rounded-xl text-sm font-bold disabled:opacity-50">
            {saving ? 'Registrando…' : 'Confirmar Acordo'}
          </button>
        </div>
      </div>
    </div>
  )
}

function PayModal({ lead, maloteBoxes, onClose, onSaved }: {
  lead: any; maloteBoxes: CashBox[]; onClose: () => void; onSaved: () => void
}) {
  const [form, setForm] = useState({ payment_method_id: '', cash_session_id: '', malote_box_id: '', paid_at: '' })
  const [saving, setSaving] = useState(false)
  const [paymentMethods, setPaymentMethods] = useState<{ id: string; name: string }[]>([])
  const [openSessions, setOpenSessions] = useState<{ id: string; opened_by_name: string }[]>([])

  useEffect(() => {
    api.get<{ id: string; name: string }[]>('/finance/payment-methods').then(r => setPaymentMethods(r.data)).catch(() => {})
    api.get<any[]>('/finance/sessions/open-picker').then(r => setOpenSessions(r.data)).catch(() => {})
  }, [])

  const handleSave = async () => {
    if (!form.payment_method_id) { toast.error('Selecione a forma de pagamento.'); return }
    setSaving(true)
    try {
      await api.post(`/porta-a-porta/leads/${lead.id}/pay`, {
        payment_method_id: form.payment_method_id || null,
        cash_session_id: form.cash_session_id || null,
        malote_box_id: form.malote_box_id || null,
        paid_at: form.paid_at ? new Date(form.paid_at).toISOString() : undefined,
      })
      toast.success('Pagamento registrado.')
      onSaved()
      onClose()
    } catch (e: any) {
      toast.error(e.response?.data?.detail ?? 'Erro.')
    } finally { setSaving(false) }
  }

  const isAgreement = lead.status === 'agreement'

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl w-full max-w-sm p-5 flex flex-col gap-4 mb-4 shadow-2xl">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold text-gray-800">{isAgreement ? 'Pagar Parcela' : 'Confirmar Pagamento'}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>
        <div className="bg-green-50 rounded-xl p-3 border border-green-100">
          <p className="text-sm font-semibold text-green-900">{lead.full_name}</p>
          <p className="text-xs text-green-600 mt-0.5">{fmt(lead.monthly_fee)} · {isAgreement ? 'Acordo' : 'À vista'}</p>
        </div>

        {openSessions.length === 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 text-xs text-amber-700">
            ⚠️ Nenhum caixa aberto. O pagamento será registrado sem sessão.
          </div>
        )}
        {openSessions.length === 1 && (
          <div className="bg-blue-50 border border-blue-100 rounded-xl px-3 py-2 text-xs text-blue-700">
            Caixa: <strong>{openSessions[0].opened_by_name}</strong>
          </div>
        )}
        {openSessions.length > 1 && (
          <div>
            <label className="text-xs text-gray-500 mb-0.5 block">Caixa de destino <span className="text-red-500">*</span></label>
            <select value={form.cash_session_id} onChange={e => setForm(f => ({ ...f, cash_session_id: e.target.value }))} className={inputCls}>
              <option value="">Selecione o caixa…</option>
              {openSessions.map(s => <option key={s.id} value={s.id}>{s.opened_by_name}</option>)}
            </select>
          </div>
        )}

        <div className="flex flex-col gap-3">
          <div>
            <label className="text-xs text-gray-500 mb-0.5 block">Forma de pagamento <span className="text-red-500">*</span></label>
            <select value={form.payment_method_id} onChange={e => setForm(f => ({ ...f, payment_method_id: e.target.value }))} className={inputCls}>
              <option value="">Selecione…</option>
              {paymentMethods.map(pm => <option key={pm.id} value={pm.id}>{pm.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-0.5 block">Data (opcional)</label>
            <input type="date" value={form.paid_at}
              onChange={e => setForm(f => ({ ...f, paid_at: e.target.value }))} className={inputCls} />
          </div>
          {maloteBoxes.length > 0 && (
            <div>
              <label className="text-xs text-gray-500 mb-0.5 block">Enviar para malote</label>
              <select value={form.malote_box_id} onChange={e => setForm(f => ({ ...f, malote_box_id: e.target.value }))} className={inputCls}>
                <option value="">Caixa atual (padrão)</option>
                {maloteBoxes.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
          )}
        </div>
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 border border-gray-300 text-gray-600 py-2.5 rounded-xl text-sm">Cancelar</button>
          <button onClick={handleSave} disabled={saving || !form.payment_method_id}
            className="flex-1 bg-green-600 hover:bg-green-700 text-white py-2.5 rounded-xl text-sm font-bold disabled:opacity-50">
            {saving ? 'Registrando…' : 'Confirmar'}
          </button>
        </div>
      </div>
    </div>
  )
}

function CommPayModal({ target, onClose, onSaved, allOperators }: {
  target: any | null; allOperators: any[]; onClose: () => void; onSaved: () => void
}) {
  const [selectedOp, setSelectedOp] = useState<any>(target)
  const [form, setForm] = useState({ amount: target ? parseFloat(target.commission_pending ?? '0').toFixed(2) : '', payment_method: '', paid_at: '', notes: '' })
  const [saving, setSaving] = useState(false)

  const handleSave = async () => {
    if (!selectedOp || !form.amount) return
    setSaving(true)
    try {
      await api.post('/porta-a-porta/commission-payments', {
        operator_id: selectedOp.operator_id,
        amount: parseFloat(form.amount),
        payment_method: form.payment_method || null,
        paid_at: form.paid_at ? new Date(form.paid_at).toISOString() : undefined,
        notes: form.notes || null,
      })
      toast.success('Comissão registrada.')
      onSaved()
      onClose()
    } catch { toast.error('Erro ao registrar.') } finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl w-full max-w-sm p-5 flex flex-col gap-4 mb-4 shadow-2xl">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold text-gray-800">Pagar Comissão</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>
        {!target && (
          <select onChange={e => { const op = allOperators.find((o: any) => o.operator_id === e.target.value); setSelectedOp(op ?? null); if (op) setForm(f => ({ ...f, amount: parseFloat(op.commission_pending ?? '0').toFixed(2) })) }}
            className={inputCls}>
            <option value="">— Selecionar operador —</option>
            {allOperators.filter((o: any) => parseFloat(o.commission_pending ?? '0') > 0)
              .map((o: any) => <option key={o.operator_id} value={o.operator_id}>{o.operator_name}</option>)}
          </select>
        )}
        {selectedOp && (
          <div className="bg-amber-50 rounded-xl p-3 border border-amber-100 text-sm">
            <p className="font-semibold text-amber-900">{selectedOp.operator_name}</p>
            <p className="text-xs text-amber-600 mt-0.5">A pagar: {fmt(selectedOp.commission_pending ?? '0')}</p>
          </div>
        )}
        <div className="grid grid-cols-2 gap-2">
          {[['Valor (R$)', 'amount', 'number'], ['Forma', 'payment_method', 'text'], ['Data', 'paid_at', 'date'], ['Obs.', 'notes', 'text']].map(([label, key, type]) => (
            <div key={key}>
              <label className="text-xs text-gray-500 mb-0.5 block">{label}</label>
              <input type={type} value={(form as any)[key]} onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))} className={inputCls} />
            </div>
          ))}
        </div>
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 border border-gray-300 text-gray-600 py-2.5 rounded-xl text-sm">Cancelar</button>
          <button onClick={handleSave} disabled={saving || !selectedOp || !form.amount}
            className="flex-1 bg-amber-600 hover:bg-amber-700 text-white py-2.5 rounded-xl text-sm font-bold disabled:opacity-50">
            {saving ? 'Registrando…' : 'Confirmar'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Main component ────────────────────────────────────────────────────────────

export default function PortaAPortaTab({ users }: { users: User[] }) {
  const [leads, setLeads] = useState<any[]>([])
  const [summary, setSummary] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [token, setToken] = useState('')
  const [maloteBoxes, setMaloteBoxes] = useState<CashBox[]>([])

  // Filters
  const [statusFilter, setStatusFilter] = useState<string>('all')

  // Forms / modals
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ full_name: '', phone: '', cpf: '', address_street: '', address_number: '', address_complement: '', monthly_fee: '20.00', notes: '', lancado_por: '' })
  const [deps, setDeps] = useState<{ name: string; phone: string; cpf: string }[]>([])
  const [saving, setSaving] = useState(false)

  const [acordoLead, setAcordoLead] = useState<any>(null)
  const [payLead, setPayLead] = useState<any>(null)
  const [commTarget, setCommTarget] = useState<any>(null)
  const [showComm, setShowComm] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [l, s] = await Promise.all([api.get('/porta-a-porta/leads'), api.get('/porta-a-porta/summary')])
      setLeads(l.data); setSummary(s.data)
    } catch { toast.error('Erro ao carregar.') } finally { setLoading(false) }
  }, [])

  useEffect(() => {
    load()
    api.get<{ token: string }>('/porta-a-porta/public-token').then(r => setToken(r.data.token)).catch(() => {})
    api.get<CashBox[]>('/cash-boxes').then(r => setMaloteBoxes(r.data.filter(b => b.is_malote))).catch(() => {})
  }, [load])

  const handleSubmit = async () => {
    if (!form.full_name.trim() || !form.address_street.trim() || !form.address_number.trim()) { toast.error('Campos obrigatórios.'); return }
    if (!form.lancado_por) { toast.error('Selecione o responsável.'); return }
    setSaving(true)
    try {
      const user = users.find(u => u.id === form.lancado_por)
      await api.post('/porta-a-porta/leads', {
        ...form,
        monthly_fee: parseFloat(form.monthly_fee),
        payment_type: 'avista',
        total_installments: 1,
        dependents: deps,
        commissioned_to: form.lancado_por || null,
        lancado_por: user?.full_name ?? null,
      })
      toast.success('Cadastro registrado.')
      setShowForm(false)
      setForm({ full_name: '', phone: '', cpf: '', address_street: '', address_number: '', address_complement: '', monthly_fee: '20.00', notes: '', lancado_por: '' })
      setDeps([])
      load()
    } catch (e: any) { toast.error(e.response?.data?.detail ?? 'Erro.') } finally { setSaving(false) }
  }

  const handleCancel = async (id: string) => {
    if (!confirm('Cancelar este lead?')) return
    try { await api.delete(`/porta-a-porta/leads/${id}`); toast.success('Cancelado.'); load() }
    catch { toast.error('Erro ao cancelar.') }
  }

  const filteredLeads = leads.filter(l =>
    statusFilter === 'all' ? l.status !== 'cancelled' : l.status === statusFilter
  )

  const STATUS_TABS = [
    { key: 'all', label: 'Todos' },
    { key: 'pending', label: 'Pendentes' },
    { key: 'agreement', label: 'Acordo' },
    { key: 'paid', label: 'Pagos' },
    { key: 'cancelled', label: 'Cancelados' },
  ]

  return (
    <div className="flex flex-col gap-5">
      {loading && !summary ? (
        <div className="p-8 text-center text-gray-400 text-sm">Carregando…</div>
      ) : (
        <>
          {/* ── KPIs ── */}
          {summary && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="col-span-2 bg-gradient-to-br from-green-500 to-emerald-600 rounded-2xl p-4 text-white">
                <div className="flex items-center gap-2 mb-1">
                  <TrendingUp className="w-4 h-4 opacity-80" />
                  <p className="text-xs opacity-80 font-medium">Gerado / Recebido</p>
                </div>
                <p className="text-2xl font-bold">{fmt(summary.gross_revenue)}</p>
                <p className="text-sm opacity-75 mt-0.5">{fmt(summary.total_received)} recebido</p>
              </div>
              <div className="bg-blue-50 rounded-xl p-3 border border-blue-100 flex flex-col gap-1">
                <div className="flex items-center gap-1.5 text-blue-600">
                  <Users className="w-3.5 h-3.5" />
                  <p className="text-xs font-medium">Associados</p>
                </div>
                <p className="text-2xl font-bold text-blue-700">{summary.paid_leads}</p>
              </div>
              <div className="bg-amber-50 rounded-xl p-3 border border-amber-100 flex flex-col gap-1">
                <div className="flex items-center gap-1.5 text-amber-700">
                  <TrendingUp className="w-3.5 h-3.5" />
                  <p className="text-xs font-medium">Comissões</p>
                </div>
                <p className="text-xl font-bold text-amber-700">{fmt(summary.total_commission)}</p>
              </div>
              <div className="bg-gray-50 rounded-xl p-3 border border-gray-200 flex items-center gap-3">
                <Clock className="w-4 h-4 text-gray-400 shrink-0" />
                <div>
                  <p className="text-xs text-gray-500">Pendentes</p>
                  <p className="text-lg font-bold text-gray-700">{summary.pending_leads}</p>
                </div>
              </div>
              <div className="bg-purple-50 rounded-xl p-3 border border-purple-100 flex items-center gap-3">
                <Package className="w-4 h-4 text-purple-400 shrink-0" />
                <div>
                  <p className="text-xs text-purple-600">Em acordo</p>
                  <p className="text-lg font-bold text-purple-700">{summary.agreement_leads}</p>
                </div>
              </div>
            </div>
          )}

          {/* ── Metas por operador ── */}
          {summary?.commissions?.length > 0 && (
            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
                <div>
                  <p className="text-sm font-bold text-gray-800">Metas por Operador</p>
                  <p className="text-xs text-gray-400 mt-0.5">A cada 5 novos → 2 mensalidades · Acordo ≤6m = R$30 · 1 ano = R$40</p>
                </div>
                <button onClick={() => { setCommTarget(null); setShowComm(true) }}
                  className="text-xs bg-amber-600 hover:bg-amber-700 text-white px-3 py-1.5 rounded-lg transition shrink-0">
                  Pagar comissão
                </button>
              </div>
              <ul className="divide-y divide-gray-100">
                {summary.commissions.map((c: any) => {
                  const pct = Math.min(100, ((c.paid_count % 5) / 5) * 100)
                  const pending = parseFloat(c.commission_pending ?? '0')
                  return (
                    <li key={c.operator_id} className="px-4 py-3.5">
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-sm font-semibold text-gray-800">{c.operator_name ?? 'Operador'}</p>
                        <div className="text-right">
                          <span className="text-sm font-bold text-amber-700">{fmt(c.commission_earned)}</span>
                          {pending > 0 && <p className="text-[10px] text-red-500 font-medium">A pagar: {fmt(pending)}</p>}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 mb-1.5">
                        <div className="flex-1 bg-gray-100 rounded-full h-1.5">
                          <div className="bg-amber-400 h-1.5 rounded-full transition-all" style={{ width: `${pct}%` }} />
                        </div>
                        <p className="text-[10px] text-gray-400 shrink-0">{c.paid_count} assoc. · faltam {c.next_commission_in}</p>
                      </div>
                      {pending > 0 && (
                        <button onClick={() => { setCommTarget(c); setShowComm(true) }}
                          className="text-[11px] border border-amber-300 text-amber-700 px-2.5 py-1 rounded-lg hover:bg-amber-50 transition">
                          Registrar pagamento →
                        </button>
                      )}
                    </li>
                  )
                })}
              </ul>
            </div>
          )}

          {/* ── Link público ── */}
          {token && (
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-3.5 flex items-center gap-3">
              <Link className="w-4 h-4 text-blue-500 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-blue-700">Link público de cadastro</p>
                <p className="text-[10px] text-blue-400 truncate mt-0.5">{window.location.origin}/associar?token={token}</p>
              </div>
              <button onClick={() => { navigator.clipboard.writeText(`${window.location.origin}/associar?token=${token}`); toast.success('Copiado!') }}
                className="shrink-0 text-xs bg-blue-600 text-white px-3 py-1.5 rounded-lg hover:bg-blue-700 transition">
                Copiar
              </button>
            </div>
          )}

          {/* ── Actions ── */}
          <div className="flex gap-2">
            <button onClick={() => setShowForm(v => !v)}
              className="flex items-center gap-2 bg-[#26619c] hover:bg-[#1a4f87] text-white py-2.5 px-4 rounded-xl text-sm font-semibold transition">
              <Plus className="w-4 h-4" /> Registrar Cadastro
            </button>
            <button onClick={load} className="flex items-center gap-2 border border-gray-300 text-gray-600 py-2.5 px-3 rounded-xl text-sm hover:bg-gray-50 transition">
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>

          {/* ── Form ── */}
          {showForm && (
            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5 flex flex-col gap-3">
              <p className="text-sm font-bold text-gray-800">Novo Cadastro</p>
              <input placeholder="Nome completo *" value={form.full_name} onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))} className={inputCls} />
              <div className="grid grid-cols-2 gap-2">
                <input placeholder="Telefone" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} className={inputCls} />
                <input placeholder="CPF" value={form.cpf} onChange={e => setForm(f => ({ ...f, cpf: e.target.value }))} className={inputCls} />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <input placeholder="Rua *" value={form.address_street} onChange={e => setForm(f => ({ ...f, address_street: e.target.value }))} className={inputCls} />
                <input placeholder="Número *" value={form.address_number} onChange={e => setForm(f => ({ ...f, address_number: e.target.value }))} className={inputCls} />
              </div>
              <input placeholder="Complemento" value={form.address_complement} onChange={e => setForm(f => ({ ...f, address_complement: e.target.value }))} className={inputCls} />

              {/* Dependents */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <p className="text-xs font-medium text-gray-500">Dependentes (máx. 3)</p>
                  {deps.length < 3 && (
                    <button onClick={() => setDeps(d => [...d, { name: '', phone: '', cpf: '' }])}
                      className="text-xs text-[#26619c] font-medium flex items-center gap-1">
                      <Plus className="w-3 h-3" /> Adicionar
                    </button>
                  )}
                </div>
                {deps.map((d, i) => (
                  <div key={i} className="bg-gray-50 rounded-xl p-2.5 mb-2 border border-gray-200">
                    <div className="flex justify-between mb-1.5">
                      <span className="text-[10px] text-gray-400">Dep. {i + 1}</span>
                      <button onClick={() => setDeps(d => d.filter((_, idx) => idx !== i))}><X className="w-3.5 h-3.5 text-gray-400" /></button>
                    </div>
                    <input placeholder="Nome *" value={d.name} onChange={e => setDeps(ds => ds.map((x, idx) => idx === i ? { ...x, name: e.target.value } : x))} className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-xs mb-1.5" />
                    <div className="grid grid-cols-2 gap-1">
                      <input placeholder="Telefone" value={d.phone} onChange={e => setDeps(ds => ds.map((x, idx) => idx === i ? { ...x, phone: e.target.value } : x))} className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-xs" />
                      <input placeholder="CPF" value={d.cpf} onChange={e => setDeps(ds => ds.map((x, idx) => idx === i ? { ...x, cpf: e.target.value } : x))} className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-xs" />
                    </div>
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs text-gray-500 mb-0.5 block">Mensalidade (R$)</label>
                  <input type="number" step="0.01" value={form.monthly_fee} onChange={e => setForm(f => ({ ...f, monthly_fee: e.target.value }))} className={inputCls} />
                </div>
                <div>
                  <label className="text-xs text-gray-500 mb-0.5 block">Lançado por *</label>
                  <select value={form.lancado_por} onChange={e => setForm(f => ({ ...f, lancado_por: e.target.value }))} className={inputCls}>
                    <option value="">— Selecionar —</option>
                    {users.map(u => <option key={u.id} value={u.id}>{u.full_name}</option>)}
                  </select>
                </div>
              </div>
              <input placeholder="Observações" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} className={inputCls} />

              <div className="flex gap-2 pt-1">
                <button onClick={() => setShowForm(false)} className="flex-1 border border-gray-300 text-gray-600 py-2.5 rounded-xl text-sm">Cancelar</button>
                <button onClick={handleSubmit} disabled={saving}
                  className="flex-1 bg-[#26619c] text-white py-2.5 rounded-xl text-sm font-bold disabled:opacity-50">
                  {saving ? 'Salvando…' : 'Registrar'}
                </button>
              </div>
            </div>
          )}

          {/* ── Leads ── */}
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
            {/* Status tabs */}
            <div className="flex border-b border-gray-100 overflow-x-auto">
              {STATUS_TABS.map(t => (
                <button key={t.key} onClick={() => setStatusFilter(t.key)}
                  className={`px-3 py-2.5 text-xs font-medium whitespace-nowrap transition border-b-2 ${
                    statusFilter === t.key ? 'text-[#26619c] border-[#26619c]' : 'text-gray-400 border-transparent hover:text-gray-600'
                  }`}>
                  {t.label}
                  {t.key !== 'cancelled' && t.key !== 'all' && (
                    <span className="ml-1 text-[10px] opacity-60">
                      ({leads.filter(l => l.status === t.key).length})
                    </span>
                  )}
                </button>
              ))}
            </div>

            {filteredLeads.length === 0 ? (
              <div className="p-8 text-center text-gray-400 text-sm flex flex-col items-center gap-2">
                <AlertCircle className="w-6 h-6 opacity-40" />
                Nenhum cadastro neste status.
              </div>
            ) : (
              <ul className="divide-y divide-gray-100">
                {filteredLeads.map((lead: any) => {
                  const cfg = STATUS_CFG[lead.status] ?? STATUS_CFG.pending
                  return (
                    <li key={lead.id} className="px-4 py-3.5">
                      <div className="flex items-start gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap mb-0.5">
                            <p className="text-sm font-semibold text-gray-800">{lead.full_name}</p>
                            <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${cfg.cls}`}>{cfg.label}</span>
                          </div>
                          <p className="text-xs text-gray-400 truncate">{lead.address_street}, {lead.address_number}{lead.address_complement ? ` – ${lead.address_complement}` : ''}</p>
                          {lead.phone && <p className="text-xs text-gray-400">{lead.phone}</p>}
                          <div className="flex items-center gap-3 mt-1 flex-wrap">
                            <span className="text-xs font-medium text-gray-600">{fmt(lead.monthly_fee)}</span>
                            {lead.dependents?.length > 0 && (
                              <span className="text-xs text-gray-400">{lead.dependents.length} dep.</span>
                            )}
                            <span className="text-xs text-gray-400">
                              Resp: <span className="text-gray-600">{lead.commissioned_to_name ?? lead.operator_name}</span>
                            </span>
                          </div>
                        </div>

                        {/* Actions */}
                        {lead.status !== 'cancelled' && lead.status !== 'paid' && (
                          <div className="flex flex-col gap-1 shrink-0">
                            {(lead.status === 'pending' || lead.status === 'agreement') && (
                              <button onClick={() => setPayLead(lead)}
                                className="flex items-center gap-1 text-xs bg-green-600 hover:bg-green-700 text-white px-2.5 py-1.5 rounded-lg transition">
                                <CheckCircle className="w-3 h-3" />
                                {lead.status === 'agreement' ? 'Pagar parcela' : 'Confirmar'}
                              </button>
                            )}
                            {lead.status === 'pending' && (
                              <button onClick={() => setAcordoLead(lead)}
                                className="flex items-center gap-1 text-xs bg-purple-600 hover:bg-purple-700 text-white px-2.5 py-1.5 rounded-lg transition">
                                <ChevronRight className="w-3 h-3" /> Acordo
                              </button>
                            )}
                            <button onClick={() => handleCancel(lead.id)}
                              className="text-xs border border-red-200 text-red-500 px-2.5 py-1.5 rounded-lg hover:bg-red-50 transition">
                              Cancelar
                            </button>
                          </div>
                        )}
                        {lead.status === 'paid' && (
                          <CheckCircle className="w-5 h-5 text-green-500 shrink-0 mt-0.5" />
                        )}
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </>
      )}

      {/* ── Modals ── */}
      {acordoLead && (
        <AcordoModal lead={acordoLead} onClose={() => setAcordoLead(null)} onSaved={load} />
      )}
      {payLead && (
        <PayModal lead={payLead} maloteBoxes={maloteBoxes} onClose={() => setPayLead(null)} onSaved={load} />
      )}
      {showComm && (
        <CommPayModal
          target={commTarget}
          allOperators={summary?.commissions ?? []}
          onClose={() => { setShowComm(false); setCommTarget(null) }}
          onSaved={load}
        />
      )}
    </div>
  )
}
