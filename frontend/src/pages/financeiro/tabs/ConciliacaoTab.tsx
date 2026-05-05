import { useEffect, useState } from 'react'
import { Upload } from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../../../services/api'
import { fmt } from '../utils/formatters'
import type { CashBox, PixPendingItem } from '../types/financeiro'

const inputCls = 'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#26619c]/40 focus:border-[#26619c]'

export default function ConciliacaoTab() {
  const [pixPending, setPixPending] = useState<PixPendingItem[]>([])
  const [pixSelected, setPixSelected] = useState<Set<string>>(new Set())
  const [pixBatchBox, setPixBatchBox] = useState('')
  const [loading, setLoading] = useState(false)
  const [cashBoxes, setCashBoxes] = useState<CashBox[]>([])
  const [bankFile, setBankFile] = useState<File | null>(null)
  const [bankType, setBankType] = useState<'itau' | 'cora' | 'infinitypay'>('infinitypay')
  const [importing, setImporting] = useState(false)
  const [reconRunning, setReconRunning] = useState(false)
  const [reconProgress, setReconProgress] = useState(0)
  const [reconLogs, setReconLogs] = useState<{ type: string; desc: string; amount: number; date: string; payer?: string }[]>([])
  const [reconSummary, setReconSummary] = useState<{ matched: number; unmatched: number; total: number } | null>(null)
  const [pixShowHistory, setPixShowHistory] = useState(false)
  const [batchingPix, setBatchingPix] = useState(false)
  const [editingPayer, setEditingPayer] = useState<{ id: string; value: string } | null>(null)
  const [editingResident, setEditingResident] = useState<{ txId: string; residentId: string; value: string } | null>(null)

  useEffect(() => {
    loadPixPending()
    api.get<CashBox[]>('/cash-boxes').then(r => setCashBoxes(r.data)).catch(() => {})
  }, [])

  const loadPixPending = async (showHistory = pixShowHistory) => {
    setLoading(true)
    try {
      const res = await api.get(`/finance/pix/pending${showHistory ? '?incluir_enviados=true' : ''}`)
      setPixPending(res.data)
    } catch { toast.error('Erro ao carregar PIX pendentes.') } finally { setLoading(false) }
  }

  const handlePixBatch = async () => {
    if (!pixBatchBox || pixSelected.size === 0) return
    setBatchingPix(true)
    try {
      const res = await api.post('/financeiro/bank-statements/batch-to-cashbox', {
        cash_box_id: pixBatchBox,
        transaction_ids: Array.from(pixSelected),
      })
      toast.success(`${res.data.count} PIX (R$ ${parseFloat(res.data.total).toFixed(2)}) enviados para a caixinha.`)
      setPixSelected(new Set()); setPixBatchBox('')
      loadPixPending()
    } catch (e: any) {
      toast.error(e.response?.data?.detail ?? 'Erro ao enviar para caixinha.')
    } finally { setBatchingPix(false) }
  }

  const handleImportCSV = async () => {
    if (!bankFile) { toast.error('Selecione um arquivo CSV'); return }
    setImporting(true)
    try {
      const formData = new FormData()
      formData.append('file', bankFile)
      formData.append('bank', bankType)
      await api.post('/financeiro/bank-statements/import', formData, { headers: { 'Content-Type': 'multipart/form-data' } })
      toast.success('Extrato importado!'); setBankFile(null)
      handleReconcile()
    } catch (e: any) {
      toast.error(e.response?.data?.detail ?? 'Erro ao importar.')
    } finally { setImporting(false) }
  }

  const handleReconcile = async () => {
    setReconRunning(true); setReconProgress(0); setReconLogs([]); setReconSummary(null)
    const raw = localStorage.getItem('aprxm-auth') ?? sessionStorage.getItem('aprxm-auth')
    const token = raw ? JSON.parse(raw)?.state?.token : null
    const base = import.meta.env.VITE_API_URL ?? '/api/v1'
    try {
      const resp = await fetch(`${base}/financeiro/reconcile/stream`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!resp.ok || !resp.body) { toast.error('Erro ao iniciar conciliação.'); setReconRunning(false); return }
      const reader = resp.body.getReader(); const dec = new TextDecoder(); let buf = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += dec.decode(value, { stream: true })
        const lines = buf.split('\n'); buf = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const ev = JSON.parse(line.slice(6))
            if (ev.type === 'start') setReconProgress(0)
            else if (ev.type === 'processing') setReconProgress(ev.pct)
            else if (ev.type === 'matched') { setReconProgress(ev.pct); setReconLogs(p => [...p, ev]) }
            else if (ev.type === 'unmatched') { setReconProgress(ev.pct); setReconLogs(p => [...p, ev]) }
            else if (ev.type === 'done') {
              setReconProgress(100)
              setReconSummary({ matched: ev.matched, unmatched: ev.unmatched, total: ev.total })
              setReconRunning(false); loadPixPending()
            } else if (ev.type === 'error') { toast.error(ev.message); setReconRunning(false) }
          } catch { /* ignore */ }
        }
      }
    } catch { toast.error('Erro na conciliação.'); setReconRunning(false) }
  }

  const statusMap: Record<string, { label: string; cls: string }> = {
    nao_conciliado: { label: 'Não-Conciliado', cls: 'bg-gray-100 text-gray-500' },
    pendente: { label: 'Pendente', cls: 'bg-amber-100 text-amber-700' },
    conciliado: { label: 'Conciliado', cls: 'bg-green-100 text-green-700' },
    cancelado: { label: 'Cancelado', cls: 'bg-red-100 text-red-600' },
    enviado_caixinha: { label: 'Na Caixinha', cls: 'bg-blue-100 text-blue-700' },
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Pipeline Financeiro */}
      <div className="bg-white rounded-xl border border-blue-100 shadow-sm p-4">
        <h3 className="text-sm font-bold text-gray-800 mb-3">Esteira Financeira — Fluxo do Caixa ao Faturamento</h3>
        <div className="flex flex-col gap-1.5 text-xs text-gray-600">
          {[
            { num: 1, label: 'Operador fecha caixa (conf. cega) e coloca o dinheiro no malote físico', status: 'op' },
            { num: 2, label: 'Conferente recolhe o dinheiro e verifica se o valor físico bate com o fechamento', status: 'conf' },
            { num: 3, label: 'Dinheiro (espécie) → lançado no faturamento. PIX → enviado para esteira de conciliação abaixo', status: 'split' },
            { num: 4, label: 'Conciliação PIX: cada venda PIX deve ser confirmada com o extrato bancário', status: 'pix' },
            { num: 5, label: 'PIX conciliados → contabilizados no faturamento (caixinha cofre)', status: 'pix' },
            { num: 6, label: 'Responsável transfere espécie do malote para o cofre no sistema (Caixinhas)', status: 'cofre' },
          ].map(s => (
            <div key={s.num} className="flex items-start gap-2 py-1.5 border-b border-gray-50 last:border-0">
              <span className={`shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold text-white ${
                s.status === 'op' ? 'bg-amber-400' : s.status === 'conf' ? 'bg-blue-500' : s.status === 'split' ? 'bg-purple-500' : s.status === 'pix' ? 'bg-green-500' : 'bg-gray-400'
              }`}>{s.num}</span>
              <span>{s.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Conciliação PIX */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-gray-800">Conciliação PIX</h2>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer select-none">
              <input type="checkbox" checked={pixShowHistory}
                onChange={e => { setPixShowHistory(e.target.checked); loadPixPending(e.target.checked) }}
                className="rounded" />
              Ver enviados à caixinha
            </label>
            <button onClick={() => loadPixPending()} disabled={loading} className="text-xs text-[#26619c] hover:underline">
              {loading ? 'Carregando…' : 'Atualizar'}
            </button>
          </div>
        </div>
        {pixPending.length === 0 ? (
          <p className="text-xs text-gray-400">Nenhuma venda registrada.</p>
        ) : (
          <>
            <div className="overflow-x-auto max-h-[480px] overflow-y-auto mb-3">
              <table className="w-full text-xs border-collapse">
                <thead className="sticky top-0 bg-gray-50 z-10">
                  <tr className="text-gray-500 text-left">
                    <th className="px-2 py-2 w-6">
                      <input type="checkbox"
                        checked={pixPending.filter(p => p.status !== 'cancelado' && p.status !== 'enviado_caixinha').length > 0
                          && pixPending.filter(p => p.status !== 'cancelado' && p.status !== 'enviado_caixinha').every(p => pixSelected.has(p.id))}
                        onChange={e => {
                          const batchable = pixPending.filter(p => p.status !== 'cancelado' && p.status !== 'enviado_caixinha').map(p => p.id)
                          setPixSelected(e.target.checked ? new Set(batchable) : new Set())
                        }} />
                    </th>
                    <th className="px-2 py-2 font-medium">Status</th>
                    <th className="px-2 py-2 font-medium">Data</th>
                    <th className="px-2 py-2 font-medium">Valor</th>
                    <th className="px-2 py-2 font-medium">Descrição</th>
                    <th className="px-2 py-2 font-medium">Morador</th>
                    <th className="px-2 py-2 font-medium">Retirado por</th>
                    <th className="px-2 py-2 font-medium">Pagador PIX</th>
                    <th className="px-2 py-2 font-medium">Operador</th>
                    <th className="px-2 py-2 font-medium">Sessão</th>
                    <th className="px-2 py-2 font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {pixPending.map(p => {
                    const st = statusMap[p.status] ?? statusMap.nao_conciliado
                    const canBatch = p.status !== 'cancelado' && p.status !== 'enviado_caixinha'
                    return (
                      <tr key={p.id} className={`border-b border-gray-100 hover:bg-gray-50 ${canBatch && pixSelected.has(p.id) ? 'bg-blue-50' : ''}`}>
                        <td className="px-2 py-2">
                          <input type="checkbox" disabled={!canBatch}
                            checked={canBatch && pixSelected.has(p.id)}
                            onChange={e => {
                              setPixSelected(prev => { const n = new Set(prev); e.target.checked ? n.add(p.id) : n.delete(p.id); return n })
                            }} />
                        </td>
                        <td className="px-2 py-2 whitespace-nowrap">
                          <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${st.cls}`}>{st.label}</span>
                        </td>
                        <td className="px-2 py-2 whitespace-nowrap text-gray-600">
                          {new Date(p.date + 'T00:00:00').toLocaleDateString('pt-BR')}
                        </td>
                        <td className="px-2 py-2 whitespace-nowrap font-semibold text-green-700">{fmt(p.amount)}</td>
                        <td className="px-2 py-2 text-gray-800 max-w-[180px] truncate">{p.description || '—'}</td>
                        <td className="px-2 py-2 max-w-[140px]">
                          {editingResident?.txId === p.id ? (
                            <input autoFocus
                              className="w-full border border-blue-400 rounded px-1.5 py-0.5 text-xs text-gray-800 outline-none"
                              value={editingResident.value}
                              onChange={e => setEditingResident({ ...editingResident, value: e.target.value })}
                              onBlur={async () => {
                                const { residentId, value } = editingResident
                                const name = value.trim(); setEditingResident(null)
                                if (!name || !residentId) return
                                try {
                                  await api.put(`/residents/${residentId}`, { full_name: name })
                                  setPixPending(prev => prev.map(x => x.id === p.id ? { ...x, resident_name: name } : x))
                                } catch { toast.error('Erro ao salvar nome do morador.') }
                              }}
                              onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                            />
                          ) : (
                            <span className={`block truncate text-xs rounded px-1 py-0.5 ${p.resident_id ? 'text-gray-600 cursor-text hover:bg-gray-100' : 'text-gray-400'}`}
                              onClick={() => { if (!p.resident_id) return; setEditingResident({ txId: p.id, residentId: p.resident_id, value: p.resident_name ?? '' }) }}>
                              {p.resident_name || '—'}
                            </span>
                          )}
                        </td>
                        <td className="px-2 py-2 text-gray-500 max-w-[130px] truncate text-xs">{p.delivered_to_name || '—'}</td>
                        <td className="px-2 py-2 max-w-[160px]">
                          {editingPayer?.id === (p.bank_statement_id ?? p.id) ? (
                            <input autoFocus
                              className="w-full border border-blue-400 rounded px-1.5 py-0.5 text-xs text-gray-800 outline-none"
                              value={editingPayer.value}
                              onChange={e => setEditingPayer({ id: editingPayer.id, value: e.target.value })}
                              onBlur={async () => {
                                const sid = editingPayer.id; const name = editingPayer.value.trim(); setEditingPayer(null)
                                if (!name) return
                                try {
                                  await api.patch(`/financeiro/bank-statements/${sid}/payer`, { name })
                                  setPixPending(prev => prev.map(x => (x.bank_statement_id ?? x.id) === sid ? { ...x, payer_name: name } : x))
                                } catch { toast.error('Erro ao salvar nome.') }
                              }}
                              onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                            />
                          ) : (
                            <span className="block truncate text-gray-600 text-xs cursor-text hover:bg-gray-100 rounded px-1 py-0.5"
                              onClick={() => setEditingPayer({ id: p.bank_statement_id ?? p.id, value: p.payer_name ?? '' })}>
                              {p.payer_name || <span className="text-gray-300 italic">Clique para digitar</span>}
                            </span>
                          )}
                        </td>
                        <td className="px-2 py-2 text-gray-400 whitespace-nowrap">{p.operador_name || '—'}</td>
                        <td className="px-2 py-2 text-gray-400 whitespace-nowrap">
                          {p.session_opened_at ? new Date(p.session_opened_at).toLocaleDateString('pt-BR') : '—'}
                        </td>
                        <td className="px-2 py-2 whitespace-nowrap">
                          {(p.status === 'nao_conciliado' || p.status === 'pendente') && (
                            <button
                              onClick={async () => {
                                try {
                                  const payload = p.bank_statement_id
                                    ? { statement_id: p.bank_statement_id, transaction_id: p.id }
                                    : { transaction_id: p.id, amount: parseFloat(p.amount), date: p.date, payer_name: p.payer_name || p.description || 'Manual', description: p.description || 'Conciliação manual' }
                                  await api.post('/financeiro/bank-statements/manual-reconcile', payload)
                                  toast.success('PIX marcado como conciliado.'); loadPixPending()
                                } catch (e: any) { toast.error(e.response?.data?.detail ?? 'Erro ao conciliar.') }
                              }}
                              className="text-[10px] bg-green-600 text-white px-2 py-1 rounded-lg font-semibold hover:bg-green-700 whitespace-nowrap">
                              Conciliar
                            </button>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <div className="flex gap-2 items-center flex-wrap">
              <select value={pixBatchBox} onChange={e => setPixBatchBox(e.target.value)}
                className="flex-1 border border-gray-200 rounded-lg px-2 py-1.5 text-xs min-w-[140px]">
                <option value="">Caixinha destino (conciliados)…</option>
                {cashBoxes.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
              <button onClick={handlePixBatch} disabled={batchingPix || pixSelected.size === 0 || !pixBatchBox}
                className="bg-[#26619c] text-white px-3 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-50 whitespace-nowrap">
                {batchingPix ? '…' : `Enviar ${pixSelected.size} conciliados`}
              </button>
            </div>
          </>
        )}
      </div>

      {/* Importar Extrato */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
        <h2 className="font-semibold text-gray-800 mb-1">Importar Extrato Bancário</h2>
        <p className="text-xs text-gray-400 mb-4">Importe o extrato CSV para conciliar pagamentos PIX.</p>
        <div className="flex flex-col gap-3">
          <div>
            <label className="block text-xs text-gray-600 mb-1">Banco</label>
            <select value={bankType} onChange={e => setBankType(e.target.value as any)} className={inputCls}>
              <option value="infinitypay">InfinityPay</option>
              <option value="cora">Cora</option>
              <option value="itau">Itaú</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-600 mb-1">Arquivo CSV</label>
            <input type="file" accept=".csv" onChange={e => setBankFile(e.target.files?.[0] ?? null)}
              className="w-full text-sm text-gray-600 file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-medium file:bg-[#26619c] file:text-white hover:file:bg-[#1a4f87]" />
          </div>
          <button onClick={handleImportCSV} disabled={importing || !bankFile}
            className="flex items-center justify-center gap-2 bg-[#26619c] hover:bg-[#1a4f87] text-white py-2.5 rounded-xl font-semibold transition disabled:opacity-50">
            <Upload className="w-4 h-4" />
            {importing ? 'Importando…' : 'Importar e Conciliar'}
          </button>
          <button onClick={handleReconcile} disabled={reconRunning}
            className="flex items-center justify-center gap-2 border border-[#26619c] text-[#26619c] py-2 rounded-xl text-sm font-medium transition hover:bg-blue-50 disabled:opacity-50">
            {reconRunning ? 'Conciliando…' : 'Re-executar Conciliação'}
          </button>
        </div>
      </div>

      {(reconRunning || reconSummary || reconLogs.length > 0) && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-gray-700">
              {reconRunning ? `Conciliando… ${reconProgress}%` : reconSummary ? `Concluído — ${reconSummary.matched} conciliados / ${reconSummary.unmatched} sem match` : ''}
            </span>
            {!reconRunning && reconLogs.length > 0 && (
              <button onClick={() => { setReconLogs([]); setReconSummary(null); setReconProgress(0) }}
                className="text-xs text-gray-400 hover:text-gray-600">Limpar</button>
            )}
          </div>
          <div className="w-full bg-gray-100 rounded-full h-2">
            <div className="h-2 rounded-full transition-all duration-300"
              style={{ width: `${reconProgress}%`, background: reconRunning ? '#26619c' : reconSummary ? '#16a34a' : '#26619c' }} />
          </div>
          {reconLogs.length > 0 && (
            <div className="max-h-64 overflow-y-auto flex flex-col gap-1 text-xs font-mono">
              {reconLogs.map((log, i) => (
                <div key={i} className={`flex items-start gap-2 px-2 py-1 rounded ${log.type === 'matched' ? 'bg-green-50 text-green-800' : 'bg-gray-50 text-gray-500'}`}>
                  <span className="shrink-0">{log.type === 'matched' ? '✓' : '—'}</span>
                  <span className="flex-1 truncate">{log.desc}</span>
                  <span className="shrink-0">R$ {log.amount?.toFixed(2)}</span>
                  <span className="shrink-0 text-gray-400">{log.date}</span>
                  {log.type === 'matched' && log.payer && (
                    <span className="shrink-0 text-green-600 truncate max-w-[120px]">← {log.payer}</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
