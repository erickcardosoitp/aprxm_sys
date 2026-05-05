import { useEffect, useState } from 'react'
import { Upload, RotateCcw, RefreshCw, FileSpreadsheet, Printer } from 'lucide-react'
import * as XLSX from 'xlsx'
import api from '../../../services/api'
import toast from 'react-hot-toast'
import { uploadService } from '../../../services/upload'
import { CaixaConferenciaModal } from '../../../components/finance/CaixaConferenciaModal'
import { SignaturePad } from '../../../components/packages/SignaturePad'
import { fmt } from '../utils/formatters'
import { useFinanceiro } from '../contexts/FinanceiroContext'
import { useAuthStore } from '../../../store/authStore'
import type { Session, TxReview, ManualSessionForm, Tx } from '../types/financeiro'

const inputCls = 'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#26619c]/40 focus:border-[#26619c]'

export default function RelatoriosTab() {
  const { conferentes, operadores, paymentMethods } = useFinanceiro()
  const role = useAuthStore(s => s.role)
  const isAdmin = ['admin', 'admin_master', 'superadmin'].includes(role ?? '')

  const [sessions, setSessions] = useState<Session[]>([])
  const [loadingSessions, setLoadingSessions] = useState(false)
  const [sessaoFilterFrom, setSessaoFilterFrom] = useState('')
  const [sessaoFilterTo, setSessaoFilterTo] = useState('')
  const [sessaoFilterOp, setSessaoFilterOp] = useState('')

  const [reviewSession, setReviewSession] = useState<Session | null>(null)
  const [reviewTxs, setReviewTxs] = useState<TxReview[]>([])

  const [showManualSession, setShowManualSession] = useState(false)
  const [manualForm, setManualForm] = useState<ManualSessionForm>({ opening_balance: '', closing_balance: '', opened_at: '', closed_at: '', notes: '', manual_pix: '', manual_dinheiro: '', manual_total_baixas: '' })
  const [savingManual, setSavingManual] = useState(false)
  const [manualOperatedBy, setManualOperatedBy] = useState('')
  const [manualReviewedBy, setManualReviewedBy] = useState('')

  const [sendingMalote, setSendingMalote] = useState<string | null>(null)
  const [reopeningSession, setReopeningSession] = useState<string | null>(null)

  const [apuracaoTarget, setApuracaoTarget] = useState<Session | null>(null)
  const [apuracaoResp, setApuracaoResp] = useState('')
  const [apuracaoSig, setApuracaoSig] = useState<string | null>(null)
  const [savingApuracao, setSavingApuracao] = useState(false)

  // Inadimplentes por rua
  const [delinqByStreet, setDelinqByStreet] = useState<{ street: string; count: number; total_amount: string; residents: any[] }[] | null>(null)
  const [loadingDelinqStreet, setLoadingDelinqStreet] = useState(false)
  const [delinqStreetOpen, setDelinqStreetOpen] = useState<string | null>(null)

  const loadDelinqByStreet = async () => {
    setLoadingDelinqStreet(true)
    try {
      const res = await api.get('/mensalidades/delinquent/by-street')
      setDelinqByStreet(res.data)
    } catch (e: any) {
      toast.error(e.response?.data?.detail ?? 'Erro ao gerar relatório.')
    } finally { setLoadingDelinqStreet(false) }
  }

  const exportDelinqStreetXLSX = () => {
    if (!delinqByStreet) return
    const rows: any[] = []
    delinqByStreet.forEach(g => {
      g.residents.forEach(r => {
        rows.push({
          Rua: g.street,
          Morador: r.resident_name,
          Telefone: r.phone_primary ?? '',
          Número: r.address_number ?? '',
          Unidade: r.unit ?? '',
          'Mês Ref': r.reference_month,
          'Meses Atraso': r.months_overdue,
          'Valor': parseFloat(r.amount),
        })
      })
    })
    const ws = XLSX.utils.json_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Inadimplentes por Rua')
    XLSX.writeFile(wb, `inadimplentes-por-rua-${new Date().toISOString().slice(0, 10)}.xlsx`)
  }

  // Mensalidades report
  const [reportFromMonth, setReportFromMonth] = useState(() => {
    const now = new Date(); return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  })
  const [reportToMonth, setReportToMonth] = useState(() => {
    const now = new Date(); return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  })
  const [report, setReport] = useState<{ from_month: string; to_month: string; total: number; paid_count: number; pending_count: number; total_paid: string; total_pending: string; items: any[] } | null>(null)
  const [loadingReport, setLoadingReport] = useState(false)

  // Edit tx (from review modal)
  const [editTarget, setEditTarget] = useState<Tx | null>(null)
  const [editAmount, setEditAmount] = useState('')
  const [editPmId, setEditPmId] = useState('')
  const [editDesc, setEditDesc] = useState('')
  const [editCashSessionId, setEditCashSessionId] = useState('')
  const [editPassword, setEditPassword] = useState('')
  const [editing, setEditing] = useState(false)
  const [editSessions, setEditSessions] = useState<{ id: string; opened_by_name: string; opened_at: string }[]>([])

  useEffect(() => { loadSessions() }, [])

  const loadSessions = async () => {
    setLoadingSessions(true)
    try {
      const res = await api.get<Session[]>('/finance/sessions')
      setSessions(res.data)
    } catch { setSessions([]) } finally { setLoadingSessions(false) }
  }

  const openReview = async (s: Session) => {
    try {
      const r = await api.get<TxReview[]>(`/finance/sessions/${s.id}/transactions`)
      setReviewTxs(r.data)
    } catch { setReviewTxs([]) }
    setReviewSession(s)
  }

  const handleRevertConferencia = async (sessionId: string) => {
    try {
      await api.post(`/finance/sessions/${sessionId}/revert-conferencia`)
      toast.success('Conferência revertida — sessão voltou para Fechada.')
      loadSessions()
    } catch (e: any) {
      toast.error(e.response?.data?.detail ?? 'Erro ao reverter.')
    }
  }

  const handleReopenSession = async (sessionId: string) => {
    if (!confirm('Reabrir este caixa? Os lançamentos poderão ser corrigidos e o caixa deverá ser fechado novamente.')) return
    setReopeningSession(sessionId)
    try {
      await api.post(`/finance/sessions/${sessionId}/reopen`)
      toast.success('Caixa reaberto. Corrija os lançamentos e feche novamente.')
      loadSessions()
    } catch (e: any) {
      toast.error(e.response?.data?.detail ?? 'Erro ao reabrir caixa.')
    } finally { setReopeningSession(null) }
  }

  const handleSendToMalote = async (sessionId: string) => {
    if (!confirm('Confirmar envio do valor de fechamento para o Malote?')) return
    setSendingMalote(sessionId)
    try {
      await api.post(`/finance/sessions/${sessionId}/send-to-malote`)
      toast.success('Dinheiro enviado para o Malote.')
      loadSessions()
    } catch (e: any) {
      toast.error(e.response?.data?.detail ?? 'Erro ao enviar para malote.')
    } finally { setSendingMalote(null) }
  }

  const printSessionReport = (s: Session) => {
    const bruto = parseFloat(s.total_bruto ?? '0')
    const baixas = parseFloat(s.total_baixas ?? '0')
    const liquido = bruto - baixas
    const diff = s.difference != null ? parseFloat(s.difference) : null
    const fmtR = (v: number) => `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    const fmtDT = (d: string) => new Date(d).toLocaleString('pt-BR')
    const w = window.open('', '_blank')!
    w.document.write(`<html><head><title>Fechamento de Caixa</title><style>
      body{font-family:sans-serif;font-size:13px;padding:20px;max-width:420px;margin:auto}
      h2{text-align:center;font-size:16px;margin-bottom:4px}
      .sub{text-align:center;color:#555;font-size:11px;margin-bottom:16px}
      table{width:100%;border-collapse:collapse}
      tr td{padding:5px 0;border-bottom:1px solid #eee}
      tr td:last-child{text-align:right;font-weight:bold}
      .total{font-size:15px;font-weight:bold}
      .diff{color:${diff === null ? '#666' : diff >= 0 ? '#16a34a' : '#dc2626'}}
      @media print{button{display:none}}
    </style></head><body>
      <h2>2ª Via — Fechamento de Caixa</h2>
      <div class="sub">Gerado em ${new Date().toLocaleString('pt-BR')}</div>
      <table>
        <tr><td>Operador</td><td>${s.operador_name ?? '—'}</td></tr>
        <tr><td>Abertura</td><td>${fmtDT(s.opened_at)}</td></tr>
        <tr><td>Fechamento</td><td>${s.closed_at ? fmtDT(s.closed_at) : '—'}</td></tr>
        <tr><td>Saldo inicial</td><td>${fmtR(parseFloat(s.opening_balance))}</td></tr>
        <tr><td>Total PIX</td><td>${fmtR(parseFloat(s.total_pix ?? '0'))}</td></tr>
        <tr><td>Total Dinheiro</td><td>${fmtR(parseFloat(s.total_dinheiro ?? '0'))}</td></tr>
        <tr><td>Bruto lançado</td><td>${fmtR(bruto)}</td></tr>
        <tr><td>Sangrias / Repasses</td><td>- ${fmtR(baixas)}</td></tr>
        <tr><td class="total">Líquido esperado</td><td class="total">${fmtR(liquido)}</td></tr>
        <tr><td>Conf. cega (contado)</td><td>${s.closing_balance ? fmtR(parseFloat(s.closing_balance)) : '—'}</td></tr>
        <tr><td class="diff">Sobra / Falta</td><td class="diff">${diff !== null ? (diff >= 0 ? '+' : '') + fmtR(diff) : '—'}</td></tr>
        ${s.conferido_por ? `<tr><td>Conferido por</td><td>${s.conferido_por}</td></tr>` : ''}
      </table>
      <br/><button onclick="window.print()">Imprimir</button>
    </body></html>`)
    w.document.close()
    setTimeout(() => w.print(), 600)
  }

  const handleCreateManualSession = async () => {
    if (!manualForm.opening_balance || !manualForm.closing_balance || !manualForm.opened_at || !manualForm.closed_at) return
    setSavingManual(true)
    try {
      await api.post('/finance/sessions/manual', {
        opening_balance: parseFloat(manualForm.opening_balance) || 0,
        closing_balance: parseFloat(manualForm.closing_balance) || 0,
        opened_at: new Date(manualForm.opened_at).toISOString(),
        closed_at: new Date(manualForm.closed_at).toISOString(),
        notes: manualForm.notes || null,
        manual_pix: manualForm.manual_pix ? parseFloat(manualForm.manual_pix) : null,
        manual_dinheiro: manualForm.manual_dinheiro ? parseFloat(manualForm.manual_dinheiro) : null,
        manual_total_baixas: manualForm.manual_total_baixas ? parseFloat(manualForm.manual_total_baixas) : null,
        operated_by_id: manualOperatedBy || null,
        reviewed_by_id: manualReviewedBy || null,
      })
      setShowManualSession(false)
      setManualForm({ opening_balance: '', closing_balance: '', opened_at: '', closed_at: '', notes: '', manual_pix: '', manual_dinheiro: '', manual_total_baixas: '' })
      setManualOperatedBy('')
      setManualReviewedBy('')
      loadSessions()
    } catch { /* ignore */ } finally { setSavingManual(false) }
  }

  const loadReport = async () => {
    setLoadingReport(true)
    try {
      const res = await api.get('/mensalidades/report', { params: { from_month: reportFromMonth, to_month: reportToMonth } })
      setReport(res.data)
    } catch (e: any) {
      toast.error(e.response?.data?.detail ?? 'Erro ao gerar relatório.')
    } finally { setLoadingReport(false) }
  }

  const exportReportCSV = () => {
    if (!report) return
    const header = 'Morador,Mês Ref,Vencimento,Valor,Status,Pago em'
    const rows = report.items.map(i =>
      `"${i.resident_name}",${i.reference_month},${i.due_date},${i.amount},${i.status === 'paid' ? 'Pago' : 'Pendente'},${i.paid_at ?? ''}`
    )
    const csv = [header, ...rows].join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `mensalidades_${report.from_month}_${report.to_month}.csv`
    a.click(); URL.revokeObjectURL(url)
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
      if (reviewSession) {
        const r = await api.get<TxReview[]>(`/finance/sessions/${reviewSession.id}/transactions`)
        setReviewTxs(r.data)
      }
    } catch (e: any) {
      const d = e.response?.data?.detail
      toast.error(typeof d === 'string' ? d : 'Erro ao corrigir.')
    } finally { setEditing(false) }
  }

  const filtered = sessions.filter(s => {
    const d = (s.closed_at ?? s.opened_at).substring(0, 10)
    if (sessaoFilterFrom && d < sessaoFilterFrom) return false
    if (sessaoFilterTo && d > sessaoFilterTo) return false
    if (sessaoFilterOp && !(s.operador_name ?? '').toLowerCase().includes(sessaoFilterOp.toLowerCase())) return false
    return true
  })

  const closed = sessions.filter(s => s.status === 'closed')
  const totalDiff = closed.reduce((sum, s) => sum + parseFloat(s.difference ?? '0'), 0)

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
          <p className="text-xs text-gray-500 mb-1">Sessões</p>
          <p className="text-2xl font-bold text-gray-800">{sessions.length}</p>
          <p className="text-xs text-gray-400">{closed.length} fechadas</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 col-span-2">
          <p className="text-xs text-gray-500 mb-1">Diferença acumulada</p>
          <p className={`text-xl font-bold ${totalDiff >= 0 ? 'text-green-700' : 'text-red-700'}`}>
            {totalDiff >= 0 ? '+' : ''}{fmt(totalDiff)}
          </p>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
        <div className="px-4 py-3 border-b border-gray-100 flex flex-wrap items-center gap-2 justify-between">
          <h3 className="text-sm font-semibold text-gray-800">Histórico de Sessões</h3>
          <div className="flex items-center gap-2 flex-wrap">
            <input type="date" placeholder="De"
              className="border border-gray-200 rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-[#26619c]/30"
              onChange={e => setSessaoFilterFrom(e.target.value)} />
            <input type="date" placeholder="Até"
              className="border border-gray-200 rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-[#26619c]/30"
              onChange={e => setSessaoFilterTo(e.target.value)} />
            <input type="text" placeholder="Funcionário…"
              className="border border-gray-200 rounded-lg px-2 py-1 text-xs w-28 focus:outline-none focus:ring-1 focus:ring-[#26619c]/30"
              onChange={e => setSessaoFilterOp(e.target.value)} />
            <button onClick={() => {
              const headers = ['Data','Funcionário','R$ PIX','R$ Dinheiro','R$ Bruto','R$ Baixas','R$ Líquido','Conf. Cega','Sobra/Falta','Conferido por','Quebra Caixa','Origem']
              const data = filtered.map(s => {
                const bruto = parseFloat(s.total_bruto ?? '0')
                const baixas = parseFloat(s.total_baixas ?? '0')
                const diff = s.difference != null ? parseFloat(s.difference) : null
                return [
                  new Date(s.closed_at ?? s.opened_at).toLocaleString('pt-BR'),
                  s.operador_name ?? '',
                  parseFloat(s.total_pix ?? '0').toFixed(2),
                  parseFloat(s.total_dinheiro ?? '0').toFixed(2),
                  bruto.toFixed(2), baixas.toFixed(2), (bruto - baixas).toFixed(2),
                  s.closing_balance ? parseFloat(s.closing_balance).toFixed(2) : '',
                  diff !== null ? diff.toFixed(2) : '',
                  s.conferido_por ?? '', s.quebra_caixa ? parseFloat(s.quebra_caixa).toFixed(2) : '',
                  s.origin ?? 'Sessão de Caixa',
                ]
              })
              const ws = XLSX.utils.aoa_to_sheet([headers, ...data])
              const wb = XLSX.utils.book_new()
              XLSX.utils.book_append_sheet(wb, ws, 'Sessões')
              XLSX.writeFile(wb, `sessoes_${new Date().toISOString().substring(0,10)}.xlsx`)
            }} className="flex items-center gap-1 text-xs bg-green-600 text-white px-2.5 py-1.5 rounded-lg font-medium hover:bg-green-700">
              <FileSpreadsheet className="w-3.5 h-3.5" /> Excel
            </button>
            <button onClick={() => {
              const w = window.open('', '_blank')!
              w.document.write(`<html><head><title>Sessões</title><style>body{font-family:sans-serif;font-size:11px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #ccc;padding:4px 6px;text-align:left}th{background:#f0f0f0}</style></head><body>`)
              w.document.write(`<h2>Histórico de Sessões — ${new Date().toLocaleDateString('pt-BR')}</h2><table><tr>${['Data','Funcionário','PIX','Dinheiro','Bruto','Baixas','Líquido','Conf.Cega','Sobra/Falta','Conferido por','Quebra','Origem'].map(h => `<th>${h}</th>`).join('')}</tr>`)
              filtered.forEach(s => {
                const bruto = parseFloat(s.total_bruto ?? '0')
                const baixas = parseFloat(s.total_baixas ?? '0')
                const diff = s.difference != null ? parseFloat(s.difference) : null
                w.document.write(`<tr><td>${new Date(s.closed_at ?? s.opened_at).toLocaleString('pt-BR')}</td><td>${s.operador_name ?? ''}</td><td>R$${parseFloat(s.total_pix ?? '0').toFixed(2)}</td><td>R$${parseFloat(s.total_dinheiro ?? '0').toFixed(2)}</td><td>R$${bruto.toFixed(2)}</td><td>R$${baixas.toFixed(2)}</td><td>R$${(bruto - baixas).toFixed(2)}</td><td>${s.closing_balance ? 'R$' + parseFloat(s.closing_balance).toFixed(2) : '—'}</td><td>${diff !== null ? (diff >= 0 ? '+' : '') + 'R$' + Math.abs(diff).toFixed(2) : '—'}</td><td>${s.conferido_por ?? ''}</td><td>${s.quebra_caixa ? 'R$' + parseFloat(s.quebra_caixa).toFixed(2) : '—'}</td><td>${s.origin ?? 'Sessão'}</td></tr>`)
              })
              w.document.write('</table></body></html>')
              w.document.close()
              w.print()
            }} className="flex items-center gap-1 text-xs bg-red-600 text-white px-2.5 py-1.5 rounded-lg font-medium hover:bg-red-700">
              PDF
            </button>
            <button onClick={() => setShowManualSession(true)} className="text-xs bg-indigo-600 text-white px-3 py-1.5 rounded-lg font-medium">+ Manual</button>
          </div>
        </div>
        {loadingSessions ? (
          <div className="p-6 text-center text-gray-400 text-sm">Carregando…</div>
        ) : sessions.length === 0 ? (
          <div className="p-6 text-center text-gray-400 text-sm">Nenhuma sessão encontrada.</div>
        ) : (
          <div className="overflow-x-auto overflow-y-auto max-h-[520px]">
            <table className="w-full text-sm min-w-[1200px]">
              <thead className="bg-gray-50 border-b border-gray-200 sticky top-0 z-10">
                <tr>
                  {['Status','Abertura','Fechamento','Funcionário','R$ PIX','R$ Dinheiro','R$ Bruto Lançado','R$ Baixas','R$ Líquido','Conf. Cega','Sobra/Falta','Conferido por','Quebra de Caixa','Malote','Origem',''].map(h => (
                    <th key={h} className="px-4 py-3 text-left font-semibold text-gray-600 whitespace-nowrap text-xs bg-gray-50">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.map(s => {
                  const bruto = parseFloat(s.total_bruto ?? '0')
                  const baixas = parseFloat(s.total_baixas ?? '0')
                  const liquido = bruto - baixas
                  const diff = s.difference != null ? parseFloat(s.difference) : null
                  const isManual = s.origin === 'Manual'
                  return (
                    <tr key={s.id} className="hover:bg-blue-50/40 cursor-pointer transition" onClick={() => openReview(s)}>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {(() => {
                          const statusMap: Record<string, { label: string; cls: string }> = {
                            open: { label: 'Aberto', cls: 'bg-green-100 text-green-700' },
                            closed: { label: 'Fechado', cls: 'bg-gray-100 text-gray-600' },
                            conferido: { label: 'Conferido', cls: 'bg-blue-100 text-blue-700' },
                            cancelled: { label: 'Cancelado', cls: 'bg-red-100 text-red-700' },
                          }
                          const st = statusMap[s.status] ?? { label: s.status, cls: 'bg-gray-100 text-gray-500' }
                          return <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${st.cls}`}>{st.label}</span>
                        })()}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-gray-800 text-xs">
                        <div className="font-semibold">{new Date(s.opened_at).toLocaleDateString('pt-BR')}</div>
                        <div className="text-gray-400">{new Date(s.opened_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</div>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-gray-700 text-xs">
                        {s.closed_at ? (
                          <>
                            <div className="font-medium">{new Date(s.closed_at).toLocaleDateString('pt-BR')}</div>
                            <div className="text-gray-400">{new Date(s.closed_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</div>
                          </>
                        ) : <span className="text-gray-300">—</span>}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-gray-700">{s.operador_name ?? '—'}</td>
                      <td className="px-4 py-3 whitespace-nowrap text-blue-700 font-medium">{fmt(s.total_pix ?? '0')}</td>
                      <td className="px-4 py-3 whitespace-nowrap text-gray-700">{fmt(s.total_dinheiro ?? '0')}</td>
                      <td className="px-4 py-3 whitespace-nowrap text-gray-800 font-semibold">{fmt(bruto)}</td>
                      <td className="px-4 py-3 whitespace-nowrap text-red-600">{fmt(baixas)}</td>
                      <td className="px-4 py-3 whitespace-nowrap text-green-700 font-bold text-sm">{fmt(liquido)}</td>
                      <td className="px-4 py-3 whitespace-nowrap text-gray-600">{s.closing_balance ? fmt(s.closing_balance) : '—'}</td>
                      <td className={`px-4 py-3 whitespace-nowrap font-bold text-sm ${diff === null ? 'text-gray-400' : diff === 0 ? 'text-green-600' : diff > 0 ? 'text-blue-600' : 'text-red-600'}`}>
                        {diff !== null ? `${diff >= 0 ? '+' : ''}${fmt(diff)}` : '—'}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-gray-600 text-xs">{s.conferido_por ?? '—'}</td>
                      <td className={`px-4 py-3 whitespace-nowrap font-medium ${s.quebra_caixa && parseFloat(s.quebra_caixa) !== 0 ? 'text-amber-600' : 'text-gray-400'}`}>
                        {s.quebra_caixa ? fmt(s.quebra_caixa) : '—'}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap" onClick={e => e.stopPropagation()}>
                        {s.status === 'closed' && s.closing_balance && parseFloat(s.closing_balance) > 0 ? (
                          s.malote_sent_at ? (
                            <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">✓ Enviado</span>
                          ) : (
                            <button
                              onClick={() => handleSendToMalote(s.id)}
                              disabled={sendingMalote === s.id}
                              className="px-2 py-1 rounded-lg text-xs font-semibold bg-amber-500 hover:bg-amber-600 text-white disabled:opacity-50 whitespace-nowrap">
                              {sendingMalote === s.id ? '…' : 'Enviar'}
                            </button>
                          )
                        ) : <span className="text-gray-300 text-xs">—</span>}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${isManual ? 'bg-amber-100 text-amber-700' : 'bg-indigo-50 text-indigo-600'}`}>
                          {s.origin ?? 'Sessão de Caixa'}
                        </span>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center gap-1">
                          {s.status === 'conferido' && (
                            <button
                              onClick={() => handleRevertConferencia(s.id)}
                              title="Desfazer conferência"
                              className="flex items-center gap-1 text-xs text-amber-600 hover:text-amber-800 hover:bg-amber-50 px-2 py-1 rounded-lg transition">
                              <RotateCcw className="w-3 h-3" /> Reverter
                            </button>
                          )}
                          {(s.status === 'closed' || s.status === 'conferido') && isAdmin && (
                            <button
                              onClick={() => handleReopenSession(s.id)}
                              disabled={reopeningSession === s.id}
                              title="Reabrir caixa para correção"
                              className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 hover:bg-blue-50 px-2 py-1 rounded-lg transition disabled:opacity-50">
                              <RefreshCw className="w-3 h-3" /> Reabrir
                            </button>
                          )}
                          {(s.status === 'closed' || s.status === 'conferido') && (
                            <button
                              onClick={() => printSessionReport(s)}
                              title="Imprimir 2ª via do fechamento"
                              className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 hover:bg-gray-100 px-2 py-1 rounded-lg transition">
                              <Printer className="w-3 h-3" /> 2ª via
                            </button>
                          )}
                          {s.quebra_caixa && parseFloat(s.quebra_caixa) !== 0 && isAdmin && (
                            <button
                              onClick={() => { setApuracaoTarget(s); setApuracaoResp(s.quebra_responsavel ?? '') }}
                              title={s.quebra_apurada_at ? `Apurada por ${s.quebra_responsavel}` : 'Registrar apuração de quebra'}
                              className={`flex items-center gap-1 text-xs px-2 py-1 rounded-lg transition ${s.quebra_apurada_at ? 'text-green-600 hover:bg-green-50' : 'text-red-600 hover:bg-red-50'}`}>
                              {s.quebra_apurada_at ? '✓ Apurada' : '⚠ Apurar'}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
                {filtered.length === 0 && (
                  <tr><td colSpan={15} className="px-4 py-6 text-center text-gray-400 text-sm">Nenhuma sessão no filtro selecionado.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Relatório de Mensalidades */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-800">Relatório de Mensalidades</h3>
        </div>
        <div className="p-4 flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs text-gray-500 mb-1">De</label>
              <input type="month" value={reportFromMonth}
                onChange={e => setReportFromMonth(e.target.value)}
                className={inputCls} />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Até</label>
              <input type="month" value={reportToMonth}
                onChange={e => setReportToMonth(e.target.value)}
                className={inputCls} />
            </div>
          </div>
          <button onClick={loadReport} disabled={loadingReport}
            className="bg-[#26619c] hover:bg-[#1a4f87] disabled:opacity-50 text-white py-2 rounded-xl text-sm font-medium transition">
            {loadingReport ? 'Gerando…' : 'Gerar Relatório'}
          </button>
          {report && (
            <div className="flex flex-col gap-2">
              <div className="grid grid-cols-3 gap-2">
                <div className="bg-green-50 rounded-lg p-3 text-center">
                  <p className="text-xs text-green-600">Pagos</p>
                  <p className="text-lg font-bold text-green-700">{report.paid_count}</p>
                  <p className="text-xs text-green-600">{fmt(report.total_paid)}</p>
                </div>
                <div className="bg-red-50 rounded-lg p-3 text-center">
                  <p className="text-xs text-red-500">Pendentes</p>
                  <p className="text-lg font-bold text-red-600">{report.pending_count}</p>
                  <p className="text-xs text-red-500">{fmt(report.total_pending)}</p>
                </div>
                <div className="bg-blue-50 rounded-lg p-3 text-center">
                  <p className="text-xs text-blue-500">Total</p>
                  <p className="text-lg font-bold text-blue-700">{report.total}</p>
                  <p className="text-xs text-blue-500">registros</p>
                </div>
              </div>
              <button onClick={exportReportCSV}
                className="flex items-center justify-center gap-2 border border-[#26619c] text-[#26619c] py-2 rounded-xl text-sm font-medium hover:bg-blue-50 transition">
                <Upload className="w-4 h-4" />
                Exportar CSV
              </button>
              <div className="max-h-64 overflow-y-auto rounded-lg border border-gray-200">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50 sticky top-0">
                    <tr>
                      <th className="text-left px-3 py-2 text-gray-500 font-medium">Morador</th>
                      <th className="text-left px-3 py-2 text-gray-500 font-medium">Mês</th>
                      <th className="text-right px-3 py-2 text-gray-500 font-medium">Valor</th>
                      <th className="text-center px-3 py-2 text-gray-500 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {report.items.map(i => (
                      <tr key={i.id}>
                        <td className="px-3 py-2 text-gray-700 truncate max-w-[120px]">{i.resident_name}</td>
                        <td className="px-3 py-2 text-gray-500">{i.reference_month}</td>
                        <td className="px-3 py-2 text-right font-medium text-gray-800">{fmt(i.amount)}</td>
                        <td className="px-3 py-2 text-center">
                          <span className={`px-1.5 py-0.5 rounded-full font-medium text-xs ${
                            i.status === 'paid' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'
                          }`}>
                            {i.status === 'paid' ? 'Pago' : 'Pendente'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Inadimplentes por Rua */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-800">Inadimplentes por Rua</h3>
          {delinqByStreet && (
            <button onClick={exportDelinqStreetXLSX}
              className="flex items-center gap-1 text-xs text-[#26619c] border border-[#26619c]/30 px-2.5 py-1 rounded-lg hover:bg-blue-50 transition">
              <FileSpreadsheet className="w-3.5 h-3.5" /> Excel
            </button>
          )}
        </div>
        <div className="p-4 flex flex-col gap-3">
          <button onClick={loadDelinqByStreet} disabled={loadingDelinqStreet}
            className="bg-[#26619c] hover:bg-[#1a4f87] disabled:opacity-50 text-white py-2 rounded-xl text-sm font-medium transition">
            {loadingDelinqStreet ? 'Carregando…' : 'Gerar Relatório'}
          </button>
          {delinqByStreet && delinqByStreet.length === 0 && (
            <p className="text-center text-sm text-gray-400 py-4">Nenhum inadimplente encontrado.</p>
          )}
          {delinqByStreet && delinqByStreet.length > 0 && (
            <div className="flex flex-col gap-2">
              <p className="text-xs text-gray-500">{delinqByStreet.reduce((s, g) => s + g.count, 0)} inadimplentes em {delinqByStreet.length} ruas</p>
              {delinqByStreet.map(g => (
                <div key={g.street} className="border border-gray-100 rounded-lg overflow-hidden">
                  <button
                    onClick={() => setDelinqStreetOpen(o => o === g.street ? null : g.street)}
                    className="w-full px-3 py-2.5 flex items-center justify-between text-left bg-gray-50 hover:bg-gray-100 transition">
                    <span className="text-sm font-medium text-gray-800">{g.street}</span>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className="text-xs text-red-600 font-medium">{g.count} {g.count === 1 ? 'morador' : 'moradores'}</span>
                      <span className="text-xs text-gray-500">{fmt(g.total_amount)}</span>
                      <span className="text-gray-400 text-xs">{delinqStreetOpen === g.street ? '▲' : '▼'}</span>
                    </div>
                  </button>
                  {delinqStreetOpen === g.street && (
                    <ul className="divide-y divide-gray-100">
                      {g.residents.map((r: any) => {
                        const phone = r.phone_primary?.replace(/\D/g, '')
                        const waLink = phone ? `https://wa.me/55${phone}` : null
                        return (
                          <li key={r.id} className="px-3 py-2.5 flex items-center justify-between gap-2">
                            <div className="min-w-0">
                              <p className="text-sm text-gray-800 truncate">{r.resident_name}</p>
                              <p className="text-xs text-gray-400">{[r.address_number, r.unit].filter(Boolean).join(' · ')} · Ref: {r.reference_month} · {r.months_overdue}m atraso</p>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <span className="text-sm font-bold text-red-600">{fmt(r.amount)}</span>
                              {waLink && (
                                <a href={waLink} target="_blank" rel="noreferrer"
                                  className="p-1 text-green-500 hover:text-green-700 rounded transition">
                                  <svg viewBox="0 0 24 24" className="w-4 h-4 fill-current"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12 0C5.373 0 0 5.373 0 12c0 2.123.554 4.116 1.523 5.847L0 24l6.332-1.5A11.945 11.945 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.818a9.815 9.815 0 01-5.004-1.368l-.36-.213-3.726.882.924-3.638-.234-.373A9.818 9.818 0 012.182 12C2.182 6.57 6.57 2.182 12 2.182c5.43 0 9.818 4.388 9.818 9.818 0 5.43-4.388 9.818-9.818 9.818z"/></svg>
                                </a>
                              )}
                            </div>
                          </li>
                        )
                      })}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Session review modal */}
      {reviewSession && (
        <CaixaConferenciaModal
          session={reviewSession}
          txs={reviewTxs}
          conferentes={conferentes}
          onClose={() => setReviewSession(null)}
          onSaved={loadSessions}
          onEditTx={tx => {
            setEditTarget(tx as unknown as Tx)
            setEditAmount(tx.amount)
            setEditDesc(tx.description)
            setEditPmId('')
            setEditPassword('')
            api.get<{ id: string; opened_by_name: string; opened_at: string }[]>('/finance/sessions/open-picker')
              .then(r => setEditSessions(r.data)).catch(() => setEditSessions([]))
          }}
        />
      )}

      {/* Edit tx modal (from review) */}
      {editTarget && (
        <div className="fixed inset-0 z-[60] bg-black/40 flex items-end sm:items-center justify-center p-4">
          <div className="w-full max-w-sm bg-white rounded-2xl shadow-2xl p-5 flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-gray-900">Corrigir Lançamento</h3>
              <button onClick={() => setEditTarget(null)} className="text-gray-400 text-xl">×</button>
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

      {/* Apuração de quebra modal */}
      {apuracaoTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-5">
            <h2 className="text-base font-semibold text-gray-800 mb-1">Apuração de Quebra de Caixa</h2>
            <p className="text-sm text-gray-500 mb-4">
              Sessão de {new Date(apuracaoTarget.opened_at).toLocaleDateString('pt-BR')} — Quebra: <span className="font-medium text-red-600">{fmt(apuracaoTarget.quebra_caixa ?? '0')}</span>
            </p>
            <div className="flex flex-col gap-3">
              <div>
                <label className="block text-xs text-gray-600 mb-1">Responsável pela quebra</label>
                <input
                  value={apuracaoResp}
                  onChange={e => setApuracaoResp(e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                  placeholder="Nome do responsável"
                />
              </div>
              {apuracaoTarget.quebra_apurada_at && (
                <p className="text-xs text-green-600">✓ Apurada anteriormente por {apuracaoTarget.quebra_responsavel}</p>
              )}
              <div>
                <label className="block text-xs text-gray-600 mb-1">Assinatura do responsável</label>
                <SignaturePad
                  label=""
                  onSave={url => setApuracaoSig(url)}
                  onClear={() => setApuracaoSig(null)}
                  onUpload={dataUrl => uploadService.uploadBase64(dataUrl, 'finance/signatures')}
                />
              </div>
              <div className="flex gap-2">
                <button onClick={() => { setApuracaoTarget(null); setApuracaoSig(null); setApuracaoResp('') }} className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-600">Cancelar</button>
                <button
                  disabled={savingApuracao || !apuracaoResp.trim()}
                  onClick={async () => {
                    setSavingApuracao(true)
                    try {
                      await api.patch(`/finance/sessions/${apuracaoTarget.id}/apuracao-quebra`, {
                        responsavel: apuracaoResp,
                        assinatura_url: apuracaoSig ?? undefined,
                      })
                      toast.success('Apuração registrada.')
                      setApuracaoTarget(null); setApuracaoSig(null); setApuracaoResp('')
                      loadSessions()
                    } catch (e: any) {
                      toast.error(e.response?.data?.detail ?? 'Erro ao salvar.')
                    } finally { setSavingApuracao(false) }
                  }}
                  className="flex-1 bg-red-600 text-white py-2.5 rounded-xl text-sm font-semibold disabled:opacity-50">
                  {savingApuracao ? 'Salvando…' : 'Confirmar Apuração'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Manual session modal */}
      {showManualSession && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl w-full max-w-lg p-5 flex flex-col gap-4 my-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-gray-800">Nova Sessão Manual</h2>
              <button onClick={() => setShowManualSession(false)} className="text-gray-400 text-xl leading-none">×</button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Data/hora abertura *</label>
                <input type="datetime-local" value={manualForm.opened_at}
                  onChange={e => setManualForm(f => ({ ...f, opened_at: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Data/hora fechamento *</label>
                <input type="datetime-local" value={manualForm.closed_at}
                  onChange={e => setManualForm(f => ({ ...f, closed_at: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Saldo inicial (R$) *</label>
                <input type="number" min="0" step="0.01" value={manualForm.opening_balance}
                  onChange={e => setManualForm(f => ({ ...f, opening_balance: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" placeholder="0,00" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Conf. Cega / Saldo final (R$) *</label>
                <input type="number" min="0" step="0.01" value={manualForm.closing_balance}
                  onChange={e => setManualForm(f => ({ ...f, closing_balance: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" placeholder="0,00" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">R$ PIX</label>
                <input type="number" min="0" step="0.01" value={manualForm.manual_pix}
                  onChange={e => setManualForm(f => ({ ...f, manual_pix: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" placeholder="0,00" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">R$ Dinheiro</label>
                <input type="number" min="0" step="0.01" value={manualForm.manual_dinheiro}
                  onChange={e => setManualForm(f => ({ ...f, manual_dinheiro: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" placeholder="0,00" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">R$ Total Bruto (PIX + Dinheiro)</label>
                <div className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-gray-50 text-gray-700 font-medium">
                  {fmt((parseFloat(manualForm.manual_pix)||0) + (parseFloat(manualForm.manual_dinheiro)||0))}
                </div>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">R$ Baixas</label>
                <input type="number" min="0" step="0.01" value={manualForm.manual_total_baixas}
                  onChange={e => setManualForm(f => ({ ...f, manual_total_baixas: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" placeholder="0,00" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Operado por</label>
                <select value={manualOperatedBy} onChange={e => setManualOperatedBy(e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white">
                  <option value="">Selecionar operador…</option>
                  {operadores.map(c => <option key={c.id} value={c.id}>{c.full_name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Conferido por</label>
                <select value={manualReviewedBy} onChange={e => setManualReviewedBy(e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white">
                  <option value="">Selecionar…</option>
                  {conferentes.map(c => <option key={c.id} value={c.id}>{c.full_name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Observações</label>
                <input type="text" value={manualForm.notes}
                  onChange={e => setManualForm(f => ({ ...f, notes: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" placeholder="Opcional" />
              </div>
            </div>
            {(() => {
              const bruto = (parseFloat(manualForm.manual_pix)||0) + (parseFloat(manualForm.manual_dinheiro)||0)
              const baixas = parseFloat(manualForm.manual_total_baixas)||0
              const liquido = bruto - baixas
              const closing = parseFloat(manualForm.closing_balance)||0
              const qc = liquido - closing
              return (bruto > 0 || baixas > 0) ? (
                <div className="bg-gray-50 rounded-lg px-4 py-2 text-xs text-gray-600 flex flex-wrap gap-4">
                  <span>Bruto: <strong className="text-gray-800">{fmt(bruto)}</strong></span>
                  <span>Líquido: <strong className="text-gray-800">{fmt(liquido)}</strong></span>
                  {closing > 0 && <span>Quebra: <strong className={qc === 0 ? 'text-green-600' : qc > 0 ? 'text-blue-600' : 'text-red-600'}>{`${qc >= 0 ? '+' : ''}${fmt(qc)} (${qc > 0 ? 'sobra' : qc < 0 ? 'falta' : 'ok'})`}</strong></span>}
                </div>
              ) : null
            })()}
            <button onClick={handleCreateManualSession} disabled={savingManual}
              className="w-full bg-indigo-600 text-white py-2.5 rounded-xl text-sm font-semibold disabled:opacity-50">
              {savingManual ? 'Salvando…' : 'Criar Sessão Manual'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
