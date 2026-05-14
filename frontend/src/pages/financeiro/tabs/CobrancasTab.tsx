import { useEffect, useState } from 'react'
import { AlertCircle, Plus, Search, X, Users, MessageCircle, MapPin, Pencil, CalendarPlus } from 'lucide-react'
import api from '../../../services/api'
import toast from 'react-hot-toast'
import { fmt, fmtDate, fmtDateOnly } from '../utils/formatters'
import { printCarne as printCarneUtil } from '../../../utils/printCarne'
import { useFinanceiro } from '../contexts/FinanceiroContext'
import type { Mensalidade, DelinquentItem, PaidItem } from '../types/financeiro'
import type { Resident } from '../../../types'

const inputCls = 'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#26619c]/40 focus:border-[#26619c]'

interface Props {
  initialResidentId?: string
  initialResidentName?: string
}

export default function CobrancasTab({ initialResidentId, initialResidentName }: Props) {
  const { openSession, carneOperator, setCarneOperator, paymentMethods, assocName } = useFinanceiro()

  const [pendingMensalidades, setPendingMensalidades] = useState<Mensalidade[]>([])
  const [pendingNames, setPendingNames] = useState<Record<string, string>>({})
  const [delinquent, setDelinquent] = useState<DelinquentItem[]>([])
  const [delinquentNames, setDelinquentNames] = useState<Record<string, string>>({})
  const [cobrancasSearch, setCobrancasSearch] = useState('')
  const [loadingCobrancas, setLoadingCobrancas] = useState(false)
  const [payingId, setPayingId] = useState<string | null>(null)

  const [showCreateForm, setShowCreateForm] = useState(false)
  const [showGenMonth, setShowGenMonth] = useState(false)
  const [genMonthForm, setGenMonthForm] = useState({ reference_month: new Date().toISOString().slice(0, 7), due_day: '10', amount: '' })
  const [generatingMonth, setGeneratingMonth] = useState(false)
  const [createForm, setCreateForm] = useState({ resident_id: '', reference_month: '', due_date: '', amount: '', notes: '' })

  const [residentSearch, setResidentSearch] = useState('')
  const [residentResults, setResidentResults] = useState<Resident[]>([])
  const [selectedResident, setSelectedResident] = useState<Resident | null>(null)

  const [historyResidentId, setHistoryResidentId] = useState<string | null>(initialResidentId ?? null)
  const [historyResidentName, setHistoryResidentName] = useState<string | null>(initialResidentName ?? null)
  const [historySearch, setHistorySearch] = useState('')
  const [history, setHistory] = useState<Mensalidade[]>([])

  const [cobrancasView, setCobrancasView] = useState<'pendentes' | 'inadimplentes' | 'pagos' | 'historico'>(
    initialResidentId ? 'historico' : 'pendentes'
  )

  const [paidItems, setPaidItems] = useState<PaidItem[]>([])
  const [paidMonth, setPaidMonth] = useState(() => new Date().toISOString().slice(0, 7))
  const [loadingPaid, setLoadingPaid] = useState(false)

  const [deleteMonthVal, setDeleteMonthVal] = useState(() => new Date().toISOString().slice(0, 7))
  const [deletingMonth, setDeletingMonth] = useState(false)
  const [showDeleteMonth, setShowDeleteMonth] = useState(false)

  // Edit due date
  const [editDueDateId, setEditDueDateId] = useState<string | null>(null)
  const [editDueDateVal, setEditDueDateVal] = useState('')
  const [savingDueDate, setSavingDueDate] = useState(false)

  // Advance payment
  const [advanceLoading, setAdvanceLoading] = useState(false)

  // Permanent due day change
  const [showChangeDueDay, setShowChangeDueDay] = useState(false)
  const [newDueDay, setNewDueDay] = useState('')
  const [savingDueDay, setSavingDueDay] = useState(false)

  // Payment method modal
  const [payPmTarget, setPayPmTarget] = useState<{ id: string; meta?: { name: string; cpf?: string; unit?: string; resident_id?: string }; amount?: number } | null>(null)
  const [payPmId, setPayPmId] = useState('')
  const [splitEnabled, setSplitEnabled] = useState(false)
  const [payPmId2, setPayPmId2] = useState('')
  const [payAmount2, setPayAmount2] = useState('')
  const [pixPayerName, setPixPayerName] = useState('')
  const [pixPayerMode, setPixPayerMode] = useState<'manual' | 'dependent'>('manual')
  const [dependents, setDependents] = useState<{ id: string; full_name: string }[]>([])

  useEffect(() => {
    loadCobrancas()
    if (initialResidentId) loadResidentHistory(initialResidentId, initialResidentName ?? undefined)
  }, [])

  const loadResidentNames = async (ids: string[]): Promise<Record<string, string>> => {
    const names: Record<string, string> = {}
    await Promise.all(ids.map(async (id) => {
      try {
        const r = await api.get<Resident>(`/residents/${id}`)
        names[id] = r.data.full_name
      } catch { names[id] = id.slice(0, 8) }
    }))
    return names
  }

  const loadCobrancas = async () => {
    setLoadingCobrancas(true)
    try {
      const [pendingRes, delinqRes] = await Promise.all([
        api.get<Mensalidade[]>('/mensalidades/pending'),
        api.get<DelinquentItem[]>('/mensalidades/delinquent'),
      ])
      setPendingMensalidades(pendingRes.data)
      setDelinquent(delinqRes.data)
      const names: Record<string, string> = {}
      pendingRes.data.forEach(m => { if (m.resident_name) names[m.resident_id] = m.resident_name })
      delinqRes.data.forEach(d => { if (d.resident_name) names[d.resident_id] = d.resident_name })
      setPendingNames(names)
      setDelinquentNames(names)
    } catch { } finally { setLoadingCobrancas(false) }
  }

  const loadPaidMensalidades = async (month: string) => {
    setLoadingPaid(true)
    try {
      const res = await api.get<any[]>('/mensalidades/paid', { params: { month } })
      setPaidItems(res.data)
    } catch { setPaidItems([]) } finally { setLoadingPaid(false) }
  }

  const loadResidentHistory = async (residentId: string, residentName?: string) => {
    try {
      const res = await api.get<Mensalidade[]>(`/mensalidades/residents/${residentId}`)
      setHistory(res.data)
      setHistoryResidentId(residentId)
      if (residentName) setHistoryResidentName(residentName)
      setCobrancasView('historico')
    } catch { toast.error('Erro ao carregar histórico.') }
  }

  const searchResidents = async (q: string) => {
    if (q.length < 2) { setResidentResults([]); return }
    try {
      const res = await api.get<Resident[]>('/residents/search', { params: { q } })
      setResidentResults(res.data.slice(0, 6))
    } catch { }
  }

  const printCarneFinanceiro = async (residentId: string, residentName: string, residentCpf?: string, residentUnit?: string) => {
    try {
      const res = await api.get<any[]>(`/mensalidades/residents/${residentId}`)
      printCarneUtil({ full_name: residentName, cpf: residentCpf, unit: residentUnit }, res.data, assocName, { operatorName: carneOperator || undefined })
    } catch { toast.error('Erro ao gerar carnê.') }
  }

  const printRecibo = (
    residentName: string,
    residentCpf: string | undefined,
    residentUnit: string | undefined,
    allMensalidades: Mensalidade[],
    paidNow: Mensalidade,
    paymentMethodLabel: string,
    operator: string,
    _assocNameUnused?: string,
    paymentMethodLabel2?: string,
    amount2?: number,
  ) => {
    const sd = (s: string | null | undefined) => {
      if (!s) return '—'
      const d = new Date(s); return isNaN(d.getTime()) ? s : d.toLocaleDateString('pt-BR')
    }
    const fmtR = (v: string | number) =>
      `R$ ${parseFloat(String(v)).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    const MONTHS = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez']
    const fmtRef = (ref: string) => {
      const [y, m] = ref.split('-'); return `${MONTHS[parseInt(m) - 1]}/${y}`
    }
    const paid = allMensalidades.filter(m => m.status === 'paid').sort((a, b) => a.reference_month.localeCompare(b.reference_month))
    const defaultAmount = allMensalidades.length ? parseFloat(allMensalidades[allMensalidades.length - 1].amount) : parseFloat(paidNow.amount)
    const now = new Date()
    const emitido = now.toLocaleString('pt-BR')

    const stub = (via: 'interno' | 'morador') => `
<div style="width:76mm;font-family:'Courier New',monospace;font-size:7.5pt;page-break-inside:avoid;margin-bottom:4mm">
  <div style="text-align:center;padding:2.5mm 2mm 2mm;border-bottom:2px solid #111">
    <div style="font-size:9.5pt;font-weight:bold;letter-spacing:.5px;text-transform:uppercase">${assocName || 'Associação'}</div>
    <div style="font-size:6pt;margin-top:.5mm;letter-spacing:.3px">COMPROVANTE DE MENSALIDADE</div>
    <div style="display:inline-block;margin-top:1mm;font-size:5.5pt;font-weight:bold;border:1px solid #111;padding:0.5mm 2mm">
      ${via === 'interno' ? '1ª VIA — CONTROLE INTERNO' : '2ª VIA — MORADOR'}
    </div>
  </div>
  <div style="padding:2mm 2mm 1.5mm;border-bottom:1px dashed #999">
    <div style="display:flex;justify-content:space-between"><span style="color:#555">Associado</span><span style="font-weight:bold;text-align:right;max-width:46mm;overflow:hidden;white-space:nowrap;text-overflow:ellipsis">${residentName}</span></div>
    ${residentCpf ? `<div style="display:flex;justify-content:space-between"><span style="color:#555">CPF</span><span style="font-weight:bold">${residentCpf}</span></div>` : ''}
    ${residentUnit ? `<div style="display:flex;justify-content:space-between"><span style="color:#555">Unidade</span><span style="font-weight:bold">${residentUnit}</span></div>` : ''}
  </div>
  <div style="padding:2mm;border-bottom:1px dashed #999">
    <div style="font-size:6pt;font-weight:bold;letter-spacing:.3px;color:#555;margin-bottom:1mm">PAGAMENTO EFETUADO</div>
    <div style="display:flex;justify-content:space-between"><span style="color:#555">Competência</span><span style="font-weight:bold">${fmtRef(paidNow.reference_month)}</span></div>
    <div style="display:flex;justify-content:space-between"><span style="color:#555">Data</span><span style="font-weight:bold">${sd(paidNow.paid_at)}</span></div>
    <div style="display:flex;justify-content:space-between;margin-top:1mm"><span style="color:#555">Total pago</span><span style="font-size:10pt;font-weight:bold">${fmtR(paidNow.amount)}</span></div>
    ${via === 'interno' && amount2 && paymentMethodLabel2 ? `
    <div style="margin-top:1mm;padding-top:1mm;border-top:1px dotted #ccc">
      <div style="display:flex;justify-content:space-between"><span style="color:#555">${paymentMethodLabel}</span><span style="font-weight:bold">${fmtR(parseFloat(paidNow.amount) - amount2)}</span></div>
      <div style="display:flex;justify-content:space-between"><span style="color:#555">${paymentMethodLabel2}</span><span style="font-weight:bold">${fmtR(amount2)}</span></div>
    </div>` : via === 'interno' ? `<div style="display:flex;justify-content:space-between"><span style="color:#555">Forma pagto</span><span style="font-weight:bold">${paymentMethodLabel}</span></div>` : ''}
  </div>
  <div style="padding:2mm;border-bottom:1px dashed #999;background:#f9f9f9">
    <div style="display:flex;justify-content:space-between">
      <span style="color:#555">Mensalidade padrão</span>
      <span style="font-weight:bold">${fmtR(defaultAmount)}</span>
    </div>
    <div style="display:flex;justify-content:space-between">
      <span style="color:#555">Vencimento padrão</span>
      <span style="font-weight:bold">Todo dia ${paidNow.due_date ? new Date(paidNow.due_date).getDate() : '—'}</span>
    </div>
  </div>
  <div style="padding:2mm;border-bottom:1px dashed #999">
    <div style="font-size:6pt;font-weight:bold;letter-spacing:.3px;color:#555;margin-bottom:1.5mm">MESES PAGOS (${paid.length})</div>
    ${paid.length === 0
      ? '<div style="color:#999;font-size:6.5pt">Nenhum pagamento registrado.</div>'
      : `<div style="display:flex;flex-wrap:wrap;gap:1mm">${paid.map(m =>
          `<span style="font-size:6pt;padding:0.5mm 1.5mm;border:1px solid #26619c;border-radius:2px;color:#26619c;font-weight:bold">${fmtRef(m.reference_month)}</span>`
        ).join('')}</div>`
    }
  </div>
  <div style="padding:2mm;font-size:6pt">
    <div style="display:flex;justify-content:space-between">
      <span style="color:#555">Operador</span>
      <span style="font-weight:bold">${operator || '______________________'}</span>
    </div>
    <div style="margin-top:2.5mm;color:#555">Assinatura / Carimbo:</div>
    <div style="border-bottom:1px solid #999;height:7mm;margin-top:1mm"></div>
    <div style="margin-top:1.5mm;color:#aaa;font-size:5pt">Emitido em ${emitido}</div>
  </div>
</div>`

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Comprovante</title>
<style>
  @page{size:80mm auto;margin:2mm}
  *{box-sizing:border-box;margin:0;padding:0}
  body{width:80mm;background:#fff}
</style>
</head><body>
  ${stub('interno')}
  <div style="border-top:1px dotted #ccc;margin:1mm 0 3mm"></div>
  ${stub('morador')}
</body></html>`

    const w = window.open('', '_blank', 'width=400,height=800')
    if (!w) return
    w.document.write(html)
    w.document.close()
    w.focus()
    setTimeout(() => { w.print() }, 400)
  }

  const handlePayMensalidade = (
    id: string,
    residentMeta?: { name: string; cpf?: string; unit?: string; resident_id?: string },
    amount?: number,
  ) => {
    if (!openSession) {
      toast.error('Abra o caixa antes de registrar pagamentos.')
      return
    }
    setPayPmId(paymentMethods[0]?.id ?? '')
    setSplitEnabled(false)
    setPayPmId2('')
    setPayAmount2('')
    setPixPayerName('')
    setPixPayerMode('manual')
    setDependents([])
    setPayPmTarget({ id, meta: residentMeta, amount })
    if (residentMeta?.resident_id) {
      api.get<{ id: string; full_name: string }[]>('/residents', {
        params: { responsible_id: residentMeta.resident_id, type: 'dependent' }
      }).then(r => setDependents(r.data)).catch(() => {})
    }
  }

  const confirmPayMensalidade = async () => {
    if (!payPmTarget) return
    const { id, meta: residentMeta, amount: totalAmount } = payPmTarget

    const amount2 = splitEnabled ? parseFloat(payAmount2) : NaN
    if (splitEnabled) {
      if (isNaN(amount2) || amount2 <= 0) { toast.error('Informe o valor da 2ª forma de pagamento.'); return }
      if (totalAmount && amount2 >= totalAmount) { toast.error('O valor da 2ª forma deve ser menor que o total.'); return }
      if (!payPmId2) { toast.error('Selecione a 2ª forma de pagamento.'); return }
    }

    setPayPmTarget(null)
    setPayingId(id)
    try {
      const payload: Record<string, any> = {}
      if (payPmId) payload.payment_method_id = payPmId
      if (splitEnabled) {
        payload.payment_method_id_2 = payPmId2
        payload.amount_2 = amount2
      }
      const selectedPmName = paymentMethods.find(p => p.id === payPmId)?.name ?? ''
      const isPix = selectedPmName.toLowerCase().includes('pix')
      if (isPix && pixPayerName.trim()) {
        payload.pix_payer_name = pixPayerName.trim()
        if (pixPayerMode === 'dependent') {
          const dep = dependents.find(d => d.full_name === pixPayerName)
          if (dep) payload.payer_entity_id = dep.id
        }
      }
      const res = await api.post<{ mensalidade: Mensalidade; transaction: any; next_month: Mensalidade | null }>(
        `/mensalidades/${id}/pay`, payload
      )
      const paidNow = res.data.mensalidade
      const next = res.data.next_month
      toast.success(next ? `Pago! Próxima mensalidade criada: ${next.reference_month}` : 'Mensalidade paga!')
      loadCobrancas()
      if (historyResidentId) loadResidentHistory(historyResidentId)
      if (residentMeta) {
        try {
          const allRes = await api.get<Mensalidade[]>(`/mensalidades/residents/${paidNow.resident_id}`)
          const pm1Label = paymentMethods.find(p => p.id === payPmId)?.name ?? 'Dinheiro/PIX'
          const pm2Label = splitEnabled ? (paymentMethods.find(p => p.id === payPmId2)?.name ?? '') : undefined
          const amount2Val = splitEnabled ? amount2 : undefined
          printRecibo(
            residentMeta.name, residentMeta.cpf, residentMeta.unit, allRes.data, paidNow,
            pm1Label, carneOperator, assocName, pm2Label, amount2Val,
          )
          setTimeout(() => printCarneFinanceiro(paidNow.resident_id, residentMeta.name, residentMeta.cpf, residentMeta.unit), 1200)
        } catch { /* silently skip print */ }
      }
    } catch (e: any) {
      toast.error(e.response?.data?.detail ?? 'Erro ao pagar mensalidade.')
    } finally { setPayingId(null) }
  }

  const handleCreateMensalidade = async () => {
    if (!selectedResident || !createForm.reference_month || !createForm.due_date || !createForm.amount) {
      toast.error('Preencha todos os campos obrigatórios.')
      return
    }
    try {
      await api.post('/mensalidades', {
        resident_id: selectedResident.id,
        reference_month: createForm.reference_month,
        due_date: createForm.due_date,
        amount: parseFloat(createForm.amount),
        notes: createForm.notes || undefined,
      })
      toast.success('Mensalidade criada!')
      setShowCreateForm(false)
      setCreateForm({ resident_id: '', reference_month: '', due_date: '', amount: '', notes: '' })
      setSelectedResident(null)
      setResidentSearch('')
      loadCobrancas()
    } catch (e: any) {
      toast.error(e.response?.data?.detail ?? 'Erro ao criar mensalidade.')
    }
  }

  const handleGenerateMonth = async () => {
    if (!genMonthForm.reference_month || !genMonthForm.amount) { toast.error('Preencha mês e valor.'); return }
    setGeneratingMonth(true)
    try {
      const res = await api.post('/mensalidades/generate-month', {
        reference_month: genMonthForm.reference_month,
        due_day: parseInt(genMonthForm.due_day) || 10,
        amount: parseFloat(genMonthForm.amount),
      })
      toast.success(`${res.data.created} mensalidade(s) gerada(s) para ${genMonthForm.reference_month}.`)
      setShowGenMonth(false)
      loadCobrancas()
    } catch (e: any) {
      toast.error(e.response?.data?.detail ?? 'Erro ao gerar mensalidades.')
    } finally { setGeneratingMonth(false) }
  }

  const handleDeleteMonth = async () => {
    if (!deleteMonthVal) return
    if (!window.confirm(`Excluir todas as cobranças PENDENTES de ${deleteMonthVal}? Esta ação não pode ser desfeita.`)) return
    setDeletingMonth(true)
    try {
      const res = await api.delete(`/mensalidades/by-month/${deleteMonthVal}`)
      toast.success(`${res.data.deleted} cobrança(s) excluída(s) de ${deleteMonthVal}.`)
      setShowDeleteMonth(false)
      loadCobrancas()
    } catch (e: any) {
      toast.error(e.response?.data?.detail ?? 'Erro ao excluir cobranças.')
    } finally { setDeletingMonth(false) }
  }

  const handleSaveDueDate = async (mensalidadeId: string, updateResident: boolean) => {
    if (!editDueDateVal) return
    setSavingDueDate(true)
    try {
      await api.patch(`/mensalidades/${mensalidadeId}/due-date`, {
        due_date: editDueDateVal,
        update_resident_day: updateResident,
      })
      toast.success(updateResident ? 'Vencimento e dia padrão atualizados.' : 'Vencimento atualizado.')
      setEditDueDateId(null)
      if (historyResidentId) loadResidentHistory(historyResidentId, historyResidentName ?? undefined)
      loadCobrancas()
    } catch (e: any) {
      toast.error(e.response?.data?.detail ?? 'Erro ao atualizar vencimento.')
    } finally { setSavingDueDate(false) }
  }

  const handleChangeDueDay = async () => {
    const day = parseInt(newDueDay)
    if (!historyResidentId || !day || day < 1 || day > 31) return
    setSavingDueDay(true)
    try {
      // Update resident's default payment day
      await api.put(`/residents/${historyResidentId}`, { monthly_payment_day: day })
      // Update all pending mensalidades for this resident
      const pending = history.filter(m => m.status !== 'paid' && m.id && m.due_date)
      await Promise.all(pending.map(m => {
        const [yr, mo] = m.due_date!.split('-').map(Number)
        const lastDay = new Date(yr, mo, 0).getDate()
        const actualDay = Math.min(day, lastDay)
        const newDate = `${yr}-${String(mo).padStart(2, '0')}-${String(actualDay).padStart(2, '0')}`
        return api.patch(`/mensalidades/${m.id}/due-date`, { due_date: newDate, update_resident_day: false }).catch(() => null)
      }))
      toast.success(`Dia de vencimento alterado para dia ${day}.`)
      setShowChangeDueDay(false)
      setNewDueDay('')
      loadResidentHistory(historyResidentId, historyResidentName ?? undefined)
    } catch (e: any) {
      toast.error(e.response?.data?.detail ?? 'Erro ao alterar vencimento.')
    } finally { setSavingDueDay(false) }
  }

  const handleAdvancePayment = async () => {
    if (!historyResidentId) return
    setAdvanceLoading(true)
    try {
      const res = await api.post('/mensalidades/advance', { resident_id: historyResidentId })
      toast.success(`Mensalidade ${res.data.reference_month} criada.`)
      await loadResidentHistory(historyResidentId, historyResidentName ?? undefined)
      handlePayMensalidade(res.data.id, { name: historyResidentName ?? '' }, parseFloat(res.data.amount))
    } catch (e: any) {
      toast.error(e.response?.data?.detail ?? 'Erro ao criar mês adiantado.')
    } finally { setAdvanceLoading(false) }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={carneOperator}
          onChange={e => setCarneOperator(e.target.value)}
          placeholder="Nome do operador (comprovante)"
          className="flex-1 text-xs border border-gray-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-1 focus:ring-blue-300"
        />
      </div>

      {openSession === null && (
        <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
          <AlertCircle className="w-4 h-4 text-amber-500 shrink-0" />
          <p className="text-xs text-amber-700">Nenhum caixa aberto. Abra o caixa para registrar pagamentos.</p>
        </div>
      )}

      <div className="flex gap-1 bg-gray-100 rounded-xl p-1 flex-wrap">
        {([
          { key: 'pendentes', label: 'A Receber' },
          { key: 'inadimplentes', label: 'Inadimplentes' },
          { key: 'pagos', label: 'Pagos' },
          { key: 'historico', label: 'Por Morador' },
        ] as const).map(({ key, label }) => (
          <button key={key}
            onClick={() => {
              setCobrancasView(key)
              if (key === 'pagos') loadPaidMensalidades(paidMonth)
            }}
            className={`flex-1 py-2 rounded-lg text-xs font-medium transition min-w-[70px] ${
              cobrancasView === key ? 'bg-white text-[#26619c] shadow-sm' : 'text-gray-500'
            }`}>
            {label}
          </button>
        ))}
      </div>

      {(cobrancasView === 'pendentes' || cobrancasView === 'inadimplentes') && (
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
          <input
            type="text"
            placeholder="Filtrar por nome ou rua…"
            value={cobrancasSearch}
            onChange={e => setCobrancasSearch(e.target.value)}
            className="w-full pl-8 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#26619c]/30"
          />
        </div>
      )}

      <div className="flex gap-2 flex-wrap">
        <button onClick={() => { setShowCreateForm(!showCreateForm); setShowGenMonth(false); setShowDeleteMonth(false) }}
          className="flex-1 flex items-center justify-center gap-2 border-2 border-dashed border-[#26619c]/40 rounded-xl py-2.5 text-sm text-[#26619c] hover:bg-blue-50 transition min-w-[120px]">
          <Plus className="w-4 h-4" />
          Nova
        </button>
        <button onClick={() => { setShowGenMonth(!showGenMonth); setShowCreateForm(false); setShowDeleteMonth(false) }}
          className="flex-1 flex items-center justify-center gap-2 border-2 border-dashed border-green-400/60 rounded-xl py-2.5 text-sm text-green-700 hover:bg-green-50 transition min-w-[120px]">
          <Plus className="w-4 h-4" />
          Gerar Mês
        </button>
        <button onClick={() => { setShowDeleteMonth(!showDeleteMonth); setShowCreateForm(false); setShowGenMonth(false) }}
          className="flex-1 flex items-center justify-center gap-2 border-2 border-dashed border-red-300/60 rounded-xl py-2.5 text-sm text-red-600 hover:bg-red-50 transition min-w-[120px]">
          <X className="w-4 h-4" />
          Excluir Mês
        </button>
      </div>

      {showDeleteMonth && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex flex-col gap-3">
          <p className="text-sm font-semibold text-red-700">Excluir cobranças pendentes do mês</p>
          <p className="text-xs text-red-600">Apenas cobranças com status <strong>pendente</strong> serão excluídas. Pagas não são afetadas.</p>
          <div className="flex gap-2">
            <input type="month" value={deleteMonthVal}
              onChange={e => setDeleteMonthVal(e.target.value)}
              className={`${inputCls} flex-1`} />
            <button onClick={handleDeleteMonth} disabled={deletingMonth}
              className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-xl text-sm font-semibold transition disabled:opacity-50">
              {deletingMonth ? '…' : 'Excluir'}
            </button>
          </div>
        </div>
      )}

      {showGenMonth && (
        <div className="bg-white border border-gray-200 rounded-xl p-4 flex flex-col gap-3 shadow-sm">
          <p className="text-sm font-semibold text-gray-800">Gerar Mensalidades do Mês</p>
          <p className="text-xs text-gray-500">Cria mensalidades pendentes para todos os associados ativos sem registro no mês.</p>
          <div className="grid grid-cols-3 gap-2">
            <div className="col-span-1">
              <label className="block text-xs text-gray-600 mb-1">Mês *</label>
              <input type="month" value={genMonthForm.reference_month}
                onChange={e => setGenMonthForm(f => ({ ...f, reference_month: e.target.value }))}
                className={inputCls} />
            </div>
            <div className="col-span-1">
              <label className="block text-xs text-gray-600 mb-1">Dia venc.</label>
              <input type="number" min="1" max="31" value={genMonthForm.due_day}
                onChange={e => setGenMonthForm(f => ({ ...f, due_day: e.target.value }))}
                className={inputCls} placeholder="10" />
            </div>
            <div className="col-span-1">
              <label className="block text-xs text-gray-600 mb-1">Valor R$ *</label>
              <input type="number" min="0" step="0.01" value={genMonthForm.amount}
                onChange={e => setGenMonthForm(f => ({ ...f, amount: e.target.value }))}
                className={inputCls} placeholder="0.00" />
            </div>
          </div>
          <button onClick={handleGenerateMonth} disabled={generatingMonth}
            className="bg-green-600 hover:bg-green-700 text-white py-2 rounded-xl text-sm font-semibold transition disabled:opacity-50">
            {generatingMonth ? 'Gerando…' : 'Gerar Mensalidades'}
          </button>
        </div>
      )}

      {showCreateForm && (
        <div className="bg-white border border-gray-200 rounded-xl p-4 flex flex-col gap-3 shadow-sm">
          <p className="text-sm font-semibold text-gray-800">Nova Mensalidade</p>
          <div>
            <label className="block text-xs text-gray-600 mb-1">Morador *</label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                value={residentSearch}
                onChange={e => { setResidentSearch(e.target.value); searchResidents(e.target.value) }}
                className={`${inputCls} pl-9`}
                placeholder="Buscar por nome ou CPF…"
              />
            </div>
            {residentResults.length > 0 && !selectedResident && (
              <ul className="border border-gray-200 rounded-lg mt-1 divide-y divide-gray-100 max-h-36 overflow-y-auto">
                {residentResults.map(r => (
                  <li key={r.id}>
                    <button className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50 flex flex-col"
                      onClick={() => { setSelectedResident(r); setResidentSearch(r.full_name); setResidentResults([]) }}>
                      <span className="font-medium text-gray-800">{r.full_name}</span>
                      <span className="text-xs text-gray-400">{r.cpf ? `CPF: ${r.cpf}` : ''}{r.unit ? ` · Unid. ${r.unit}` : ''}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {selectedResident && (
              <div className="flex items-center gap-2 mt-1 bg-blue-50 rounded-lg px-3 py-1.5">
                <span className="text-xs font-medium text-blue-800 flex-1">{selectedResident.full_name}</span>
                <button onClick={() => { setSelectedResident(null); setResidentSearch('') }}>
                  <X className="w-3.5 h-3.5 text-gray-400 hover:text-red-500" />
                </button>
              </div>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-600 mb-1">Mês de referência *</label>
              <input type="month" value={createForm.reference_month}
                onChange={e => setCreateForm(f => ({ ...f, reference_month: e.target.value }))}
                className={inputCls} />
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">Vencimento *</label>
              <input type="date" value={createForm.due_date}
                onChange={e => setCreateForm(f => ({ ...f, due_date: e.target.value }))}
                className={inputCls} />
            </div>
          </div>
          <div>
            <label className="block text-xs text-gray-600 mb-1">Valor (R$) *</label>
            <input type="number" step="0.01" min="0.01" value={createForm.amount}
              onChange={e => setCreateForm(f => ({ ...f, amount: e.target.value }))}
              className={inputCls} placeholder="0,00" />
          </div>
          <div>
            <label className="block text-xs text-gray-600 mb-1">Observações</label>
            <input value={createForm.notes}
              onChange={e => setCreateForm(f => ({ ...f, notes: e.target.value }))}
              className={inputCls} placeholder="Opcional…" />
          </div>
          <div className="flex gap-2">
            <button onClick={() => setShowCreateForm(false)}
              className="flex-1 border border-gray-300 text-gray-600 py-2 rounded-xl text-sm hover:bg-gray-50 transition">
              Cancelar
            </button>
            <button onClick={handleCreateMensalidade}
              className="flex-1 bg-[#26619c] hover:bg-[#1a4f87] text-white py-2 rounded-xl text-sm font-medium transition">
              Criar
            </button>
          </div>
        </div>
      )}

      {cobrancasView === 'pendentes' && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
            <p className="text-sm font-semibold text-gray-800">
              A Receber ({
                new Set(
                  (cobrancasSearch
                    ? pendingMensalidades.filter(m => {
                        const q = cobrancasSearch.toLowerCase()
                        return (m.resident_name ?? pendingNames[m.resident_id] ?? '').toLowerCase().includes(q)
                          || (m.address_street ?? '').toLowerCase().includes(q)
                      })
                    : pendingMensalidades
                  ).map(m => m.resident_id)
                ).size
              } associados)
            </p>
            {loadingCobrancas && <span className="text-xs text-gray-400">Carregando…</span>}
          </div>
          {!loadingCobrancas && pendingMensalidades.length === 0 ? (
            <div className="p-6 text-center text-gray-400 text-sm">Nenhuma mensalidade pendente.</div>
          ) : (
            <ul className="divide-y divide-gray-100">
              {pendingMensalidades
                .filter(m => {
                  if (!cobrancasSearch) return true
                  const q = cobrancasSearch.toLowerCase()
                  return (m.resident_name ?? pendingNames[m.resident_id] ?? '').toLowerCase().includes(q)
                    || (m.address_street ?? '').toLowerCase().includes(q)
                })
                .map(m => {
                  const name = m.resident_name ?? pendingNames[m.resident_id] ?? '…'
                  const phone = m.phone_primary?.replace(/\D/g, '')
                  const waLink = phone ? `https://wa.me/55${phone}` : null
                  const address = [m.address_street, m.address_number, m.unit].filter(Boolean).join(', ')
                  return (
                    <li key={m.id} className="px-4 py-3 flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-gray-800 truncate">{name}</p>
                        {address && (
                          <p className="text-xs text-gray-400 flex items-center gap-1 mt-0.5">
                            <MapPin className="w-3 h-3 shrink-0" />{address}
                          </p>
                        )}
                        <p className="text-xs text-gray-500 mt-0.5">Ref: {m.reference_month} · Venc: {m.due_date ? fmtDateOnly(m.due_date) : '—'}</p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {waLink && (
                          <a href={waLink} target="_blank" rel="noreferrer"
                            title={`WhatsApp: ${m.phone_primary}`}
                            className="p-1.5 text-green-500 hover:text-green-700 hover:bg-green-50 rounded-lg transition">
                            <MessageCircle className="w-4 h-4" />
                          </a>
                        )}
                        <span className="text-sm font-bold text-blue-700">{fmt(m.amount)}</span>
                        <button
                          disabled={!openSession || payingId === m.id}
                          onClick={() => m.id && handlePayMensalidade(m.id, { name }, parseFloat(m.amount))}
                          className="text-xs bg-green-600 hover:bg-green-700 disabled:opacity-40 text-white px-3 py-1.5 rounded-lg transition">
                          {payingId === m.id ? '…' : 'Pagar'}
                        </button>
                      </div>
                    </li>
                  )
                })}
            </ul>
          )}
        </div>
      )}

      {cobrancasView === 'inadimplentes' && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 bg-red-50">
            <p className="text-sm font-semibold text-red-700 flex items-center gap-2">
              <AlertCircle className="w-4 h-4" />
              Inadimplentes ({
                new Set(
                  (cobrancasSearch
                    ? delinquent.filter(d => {
                        const q = cobrancasSearch.toLowerCase()
                        return (d.resident_name ?? delinquentNames[d.resident_id] ?? '').toLowerCase().includes(q)
                          || (d.address_street ?? '').toLowerCase().includes(q)
                      })
                    : delinquent
                  ).map(d => d.resident_id)
                ).size
              } moradores)
            </p>
            {delinquent.length > 0 && (
              <p className="text-xs text-red-500 mt-0.5">
                Total em atraso: {fmt(delinquent.reduce((s, d) => s + parseFloat(d.amount), 0))}
              </p>
            )}
          </div>
          {delinquent.length === 0 ? (
            <div className="p-6 text-center text-gray-400 text-sm">Nenhum inadimplente.</div>
          ) : (
            <ul className="divide-y divide-gray-100">
              {delinquent
                .filter(d => {
                  if (!cobrancasSearch) return true
                  const q = cobrancasSearch.toLowerCase()
                  return (d.resident_name ?? delinquentNames[d.resident_id] ?? '').toLowerCase().includes(q)
                    || (d.address_street ?? '').toLowerCase().includes(q)
                })
                .map(d => {
                  const name = d.resident_name ?? delinquentNames[d.resident_id] ?? '…'
                  const phone = d.phone_primary?.replace(/\D/g, '')
                  const waLink = phone ? `https://wa.me/55${phone}` : null
                  const address = [d.address_street, d.address_number, d.unit].filter(Boolean).join(', ')
                  return (
                    <li key={d.id} className="px-4 py-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-gray-800 truncate">{name}</p>
                          {address && (
                            <p className="text-xs text-gray-400 flex items-center gap-1 mt-0.5">
                              <MapPin className="w-3 h-3 shrink-0" />{address}
                            </p>
                          )}
                          <p className="text-xs text-gray-500 mt-0.5">Ref: {d.reference_month} · Venc: {fmtDateOnly(d.due_date)}</p>
                          <span className="text-xs text-red-600 font-medium">
                            {d.months_overdue} {d.months_overdue === 1 ? 'mês' : 'meses'} em atraso
                          </span>
                        </div>
                        <div className="flex flex-col items-end gap-1.5 shrink-0">
                          <span className="text-sm font-bold text-gray-800">{fmt(d.amount)}</span>
                          <div className="flex gap-1 items-center">
                            {waLink && (
                              <a href={waLink} target="_blank" rel="noreferrer"
                                title={`WhatsApp: ${d.phone_primary}`}
                                className="p-1.5 text-green-500 hover:text-green-700 hover:bg-green-50 rounded-lg transition">
                                <MessageCircle className="w-4 h-4" />
                              </a>
                            )}
                            <button onClick={() => loadResidentHistory(d.resident_id)}
                              className="text-xs text-[#26619c] hover:underline flex items-center gap-1">
                              <Users className="w-3 h-3" /> Histórico
                            </button>
                            <button
                              onClick={() => handlePayMensalidade(d.id, { name }, parseFloat(d.amount as any))}
                              disabled={!openSession || payingId === d.id}
                              className="text-xs bg-green-500 hover:bg-green-600 disabled:opacity-40 text-white px-2 py-1 rounded-lg transition">
                              {payingId === d.id ? '…' : 'Pagar'}
                            </button>
                          </div>
                        </div>
                      </div>
                    </li>
                  )
                })}
            </ul>
          )}
        </div>
      )}

      {cobrancasView === 'pagos' && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <input type="month" value={paidMonth}
              onChange={e => { setPaidMonth(e.target.value); loadPaidMensalidades(e.target.value) }}
              className={inputCls} />
          </div>
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
              <p className="text-sm font-semibold text-gray-800">Pagamentos Recebidos — {paidMonth}</p>
              <span className="text-xs text-gray-400">{loadingPaid ? 'Carregando…' : `${paidItems.length} registro(s)`}</span>
            </div>
            {!loadingPaid && paidItems.length === 0 ? (
              <div className="p-6 text-center text-gray-400 text-sm">Nenhum pagamento neste mês.</div>
            ) : (
              <ul className="divide-y divide-gray-100">
                {paidItems.map(p => (
                  <li key={p.id} className="px-4 py-3 flex items-center justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-gray-800 truncate">{p.resident_name}</p>
                      <p className="text-xs text-gray-500">Ref: {p.reference_month}</p>
                      {p.paid_at && <p className="text-xs text-green-600">Pago em: {fmtDate(p.paid_at)}</p>}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-sm font-bold text-green-700">{fmt(p.amount)}</span>
                      <button
                        onClick={() => printCarneFinanceiro(p.resident_id, p.resident_name)}
                        className="text-xs border border-blue-200 text-blue-600 px-2 py-0.5 rounded-lg hover:bg-blue-50 transition"
                        title="Imprimir Carnê">
                        Carnê
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {paidItems.length > 0 && (
              <div className="px-4 py-2 bg-gray-50 border-t border-gray-100 flex justify-between items-center">
                <span className="text-xs text-gray-500">Total arrecadado</span>
                <span className="text-sm font-bold text-green-700">
                  {fmt(paidItems.reduce((s, p) => s + parseFloat(p.amount), 0))}
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      {cobrancasView === 'historico' && (
        <div className="flex flex-col gap-3">
          {!historyResidentId ? (
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                value={historySearch}
                placeholder="Buscar morador por nome…"
                className={`${inputCls} pl-9`}
                onChange={e => { setHistorySearch(e.target.value); searchResidents(e.target.value) }}
              />
              {residentResults.length > 0 && (
                <ul className="absolute z-10 top-full left-0 right-0 mt-1 border border-gray-200 rounded-xl divide-y divide-gray-100 bg-white shadow-lg max-h-52 overflow-y-auto">
                  {residentResults.map(r => (
                    <li key={r.id}>
                      <button className="w-full text-left px-4 py-3 text-sm hover:bg-blue-50 transition"
                        onClick={() => {
                          setResidentResults([])
                          setHistorySearch('')
                          loadResidentHistory(r.id, r.full_name)
                        }}>
                        <span className="font-medium text-gray-800">{r.full_name}</span>
                        <span className="text-xs text-gray-400 ml-2">{r.unit ? `Unid. ${r.unit}` : ''}{r.cpf ? ` · ${r.cpf}` : ''}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : (
            <div className="flex items-center justify-between bg-blue-50 border border-blue-100 rounded-xl px-4 py-3">
              <div>
                <p className="text-xs text-gray-500">Histórico de</p>
                <p className="text-sm font-semibold text-[#1a3f6f]">{historyResidentName}</p>
              </div>
              <button onClick={() => { setHistoryResidentId(null); setHistoryResidentName(null); setHistory([]) }}
                className="text-xs text-gray-400 hover:text-red-500 flex items-center gap-1 transition">
                <X className="w-3.5 h-3.5" /> Trocar
              </button>
            </div>
          )}

          {historyResidentId && (
            <div className="flex gap-2">
              <button
                onClick={handleAdvancePayment}
                disabled={advanceLoading || !openSession}
                className="flex-1 flex items-center justify-center gap-2 border-2 border-dashed border-blue-400/50 rounded-xl py-2.5 text-sm text-blue-700 hover:bg-blue-50 transition disabled:opacity-40"
                title={!openSession ? 'Abra o caixa para pagar' : 'Criar e pagar mês adiantado'}
              >
                <CalendarPlus className="w-4 h-4" />
                {advanceLoading ? 'Criando…' : 'Pagar Adiantado'}
              </button>
              <button
                onClick={() => { setShowChangeDueDay(v => !v); setNewDueDay('') }}
                className="flex-1 flex items-center justify-center gap-2 border-2 border-dashed border-amber-400/50 rounded-xl py-2.5 text-sm text-amber-700 hover:bg-amber-50 transition"
              >
                <Pencil className="w-4 h-4" />
                Alterar Vencimento
              </button>
            </div>
          )}

          {showChangeDueDay && historyResidentId && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex flex-col gap-3">
              <p className="text-sm font-semibold text-amber-800">Alterar dia de vencimento permanente</p>
              <p className="text-xs text-amber-600">Atualiza o dia padrão do morador e todas as cobranças pendentes.</p>
              <div className="flex gap-2">
                <input
                  type="number" min="1" max="31"
                  value={newDueDay}
                  onChange={e => setNewDueDay(e.target.value)}
                  placeholder="Dia (1–31)"
                  className={`${inputCls} flex-1`}
                  autoFocus
                />
                <button
                  onClick={handleChangeDueDay}
                  disabled={savingDueDay || !newDueDay}
                  className="bg-amber-600 hover:bg-amber-700 text-white px-4 py-2 rounded-xl text-sm font-semibold transition disabled:opacity-50">
                  {savingDueDay ? '…' : 'Salvar'}
                </button>
              </div>
            </div>
          )}

          {history.length > 0 && (() => {
            const paid = history.filter(m => m.status === 'paid').length
            const pending = history.filter(m => m.status !== 'paid').length
            const total = history.reduce((s, m) => s + parseFloat(m.amount), 0)
            const paidTotal = history.filter(m => m.status === 'paid').reduce((s, m) => s + parseFloat(m.amount), 0)
            return (
              <div className="grid grid-cols-3 gap-2">
                <div className="bg-white rounded-xl border border-gray-200 p-3 text-center">
                  <p className="text-lg font-bold text-green-600">{paid}</p>
                  <p className="text-xs text-gray-400">Pagas</p>
                </div>
                <div className="bg-white rounded-xl border border-gray-200 p-3 text-center">
                  <p className="text-lg font-bold text-red-500">{pending}</p>
                  <p className="text-xs text-gray-400">Pendentes</p>
                </div>
                <div className="bg-white rounded-xl border border-gray-200 p-3 text-center">
                  <p className="text-sm font-bold text-gray-700">{fmt(paidTotal)}</p>
                  <p className="text-xs text-gray-400">de {fmt(total)}</p>
                </div>
              </div>
            )
          })()}

          {history.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
              <ul className="divide-y divide-gray-100">
                {history.map((m, idx) => {
                  const isPaid = m.status === 'paid'
                  const isMig = m.origem === 'migracao'
                  const graceCutoff = new Date(); graceCutoff.setDate(graceCutoff.getDate() - 2)
                  const isOverdue = !isPaid && m.due_date && new Date(m.due_date) < graceCutoff
                  return (
                    <li key={m.id ?? `mig-${idx}`} className="px-4 py-3 flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <div className={`w-2 h-2 rounded-full shrink-0 ${isPaid ? 'bg-green-400' : isOverdue ? 'bg-red-400' : 'bg-amber-400'}`} />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-semibold text-gray-800">{m.reference_month}</p>
                            {isMig && <span className="text-xs bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded-full">Migração</span>}
                          </div>
                          {isPaid && m.paid_at ? (
                            <p className="text-xs text-green-600">Pago em {fmtDate(m.paid_at)}</p>
                          ) : m.due_date ? (
                            editDueDateId === m.id ? (
                              <div className="flex items-center gap-1 mt-1">
                                <input
                                  type="date"
                                  value={editDueDateVal}
                                  onChange={e => setEditDueDateVal(e.target.value)}
                                  className="text-xs border border-gray-300 rounded px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-[#26619c]/40"
                                  autoFocus
                                />
                                <button
                                  onClick={() => handleSaveDueDate(m.id!, false)}
                                  disabled={savingDueDate}
                                  title="Salvar só esta cobrança"
                                  className="text-[10px] bg-[#26619c] text-white px-1.5 py-0.5 rounded hover:bg-[#1a4f87] disabled:opacity-50">
                                  {savingDueDate ? '…' : 'Salvar'}
                                </button>
                                <button
                                  onClick={() => handleSaveDueDate(m.id!, true)}
                                  disabled={savingDueDate}
                                  title="Salvar e atualizar dia padrão do morador"
                                  className="text-[10px] bg-green-600 text-white px-1.5 py-0.5 rounded hover:bg-green-700 disabled:opacity-50">
                                  + Padrão
                                </button>
                                <button onClick={() => setEditDueDateId(null)} className="text-gray-400 hover:text-gray-600">
                                  <X className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            ) : (
                              <div className="flex items-center gap-1">
                                <p className={`text-xs ${isOverdue ? 'text-red-500' : 'text-gray-400'}`}>Venc. {fmtDate(m.due_date)}</p>
                                {!isMig && (
                                  <button
                                    onClick={() => { setEditDueDateId(m.id!); setEditDueDateVal(m.due_date!) }}
                                    className="text-gray-300 hover:text-[#26619c] transition"
                                    title="Editar vencimento">
                                    <Pencil className="w-3 h-3" />
                                  </button>
                                )}
                              </div>
                            )
                          ) : (
                            <p className="text-xs text-gray-400">Histórico anterior</p>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-sm font-bold text-gray-800">{fmt(m.amount)}</span>
                        {!isPaid && !isMig && (
                          <button
                            onClick={() => handlePayMensalidade(m.id!, { name: historyResidentName ?? '' }, parseFloat(m.amount))}
                            disabled={!openSession || payingId === m.id}
                            className="text-xs bg-green-500 hover:bg-green-600 disabled:opacity-40 text-white px-3 py-1 rounded-lg transition">
                            {payingId === m.id ? '…' : 'Pagar'}
                          </button>
                        )}
                      </div>
                    </li>
                  )
                })}
              </ul>
            </div>
          )}

          {historyResidentId && history.length === 0 && (
            <p className="text-sm text-center text-gray-400 py-6">Nenhuma cobrança encontrada.</p>
          )}
        </div>
      )}

      {/* Payment method modal */}
      {payPmTarget && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-5 flex flex-col gap-3">
            <h2 className="text-base font-semibold text-gray-800">Forma de pagamento</h2>

            {paymentMethods.length > 0 ? (
              <>
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">
                    {splitEnabled ? '1ª forma' : 'Forma de pagamento'}
                    {splitEnabled && payPmTarget.amount && (
                      <span className="ml-1 text-gray-400">
                        ({new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(
                          payPmTarget.amount - (parseFloat(payAmount2) || 0)
                        )})
                      </span>
                    )}
                  </label>
                  <select
                    value={payPmId}
                    onChange={e => setPayPmId(e.target.value)}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm"
                  >
                    <option value="">Não informar</option>
                    {paymentMethods.map(pm => <option key={pm.id} value={pm.id}>{pm.name}</option>)}
                  </select>
                </div>

                {/* PIX payer name */}
                {paymentMethods.find(p => p.id === payPmId)?.name?.toLowerCase().includes('pix') && (
                  <div className="flex flex-col gap-2 border border-blue-100 rounded-xl p-3 bg-blue-50">
                    <label className="text-xs font-medium text-blue-700">Nome Pagador PIX</label>
                    <div className="flex gap-1 mb-1">
                      <button
                        type="button"
                        onClick={() => { setPixPayerMode('manual'); setPixPayerName('') }}
                        className={`flex-1 py-1 rounded-lg text-xs font-medium border transition ${pixPayerMode === 'manual' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-200'}`}
                      >Manual</button>
                      <button
                        type="button"
                        onClick={() => { setPixPayerMode('dependent'); setPixPayerName('') }}
                        className={`flex-1 py-1 rounded-lg text-xs font-medium border transition ${pixPayerMode === 'dependent' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-200'}`}
                      >Dependente</button>
                    </div>
                    {pixPayerMode === 'manual' ? (
                      <input
                        type="text"
                        value={pixPayerName}
                        onChange={e => setPixPayerName(e.target.value)}
                        placeholder="Nome de quem fez o PIX"
                        className="w-full border border-blue-200 rounded-xl px-3 py-2 text-sm bg-white"
                      />
                    ) : (
                      <select
                        value={pixPayerName}
                        onChange={e => setPixPayerName(e.target.value)}
                        className="w-full border border-blue-200 rounded-xl px-3 py-2 text-sm bg-white"
                      >
                        <option value="">Selecione o dependente</option>
                        {dependents.map(d => <option key={d.id} value={d.full_name}>{d.full_name}</option>)}
                        {dependents.length === 0 && <option disabled>Nenhum dependente cadastrado</option>}
                      </select>
                    )}
                  </div>
                )}

                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={splitEnabled}
                    onChange={e => { setSplitEnabled(e.target.checked); setPayPmId2(''); setPayAmount2('') }}
                    className="w-4 h-4 rounded accent-[#26619c]"
                  />
                  <span className="text-sm text-gray-700">Pagamento dividido (2 formas)</span>
                </label>

                {splitEnabled && (
                  <div className="flex flex-col gap-2 border border-gray-100 rounded-xl p-3 bg-gray-50">
                    <div>
                      <label className="text-xs text-gray-500 mb-1 block">2ª forma de pagamento</label>
                      <select
                        value={payPmId2}
                        onChange={e => setPayPmId2(e.target.value)}
                        className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm"
                      >
                        <option value="">Selecione</option>
                        {paymentMethods.map(pm => <option key={pm.id} value={pm.id}>{pm.name}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="text-xs text-gray-500 mb-1 block">Valor da 2ª forma (R$)</label>
                      <input
                        type="number" min="0.01" step="0.01"
                        value={payAmount2}
                        onChange={e => setPayAmount2(e.target.value)}
                        placeholder="0,00"
                        className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm"
                      />
                    </div>
                    {payPmTarget.amount && parseFloat(payAmount2) > 0 && (
                      <p className="text-xs text-gray-500">
                        1ª forma: {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(
                          payPmTarget.amount - parseFloat(payAmount2)
                        )}
                        {' · '}2ª forma: {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(parseFloat(payAmount2))}
                      </p>
                    )}
                  </div>
                )}
              </>
            ) : (
              <p className="text-sm text-gray-400">Nenhuma forma de pagamento cadastrada.</p>
            )}

            <div className="flex gap-2">
              <button onClick={() => setPayPmTarget(null)} className="flex-1 py-2 rounded-xl border border-gray-200 text-sm text-gray-600">Cancelar</button>
              <button onClick={confirmPayMensalidade} className="flex-1 py-2 rounded-xl bg-green-600 text-white text-sm font-medium">Confirmar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
