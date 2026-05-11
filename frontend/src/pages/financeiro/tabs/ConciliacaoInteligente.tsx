import { useState, type ReactNode } from 'react'
import { Upload, CheckCheck, TrendingUp, AlertCircle, XCircle, ChevronDown, ChevronUp } from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../../../services/api'
import { fmtCurrency } from '../utils/formatters'
import type { ReconciliationItem } from '../types/financeiro'

type ReconGroup = {
  automatico: ReconciliationItem[]
  sugestao: ReconciliationItem[]
  pendente: ReconciliationItem[]
  identificado: ReconciliationItem[]
}

const SCORE_VERDE = 150
const SCORE_AMARELO = 80

function ScoreBar({ score }: { score: number }) {
  const pct = Math.min(100, Math.round((score / 230) * 100))
  const color = score >= SCORE_VERDE ? 'bg-green-500' : score >= SCORE_AMARELO ? 'bg-amber-400' : 'bg-red-400'
  return (
    <div className="flex items-center gap-1.5">
      <div className="w-20 h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[10px] text-gray-500 tabular-nums">{score}pts</span>
    </div>
  )
}

type ConfirmState = {
  item: ReconciliationItem
  residentQuery: string
  residentResults: { id: string; full_name: string }[]
  selectedResidentId: string
  selectedResidentName: string
  loading: boolean
  mode: 'vincular' | 'register-income'
}

export default function ConciliacaoInteligente() {
  const [bankFile, setBankFile] = useState<File | null>(null)
  const [bankType, setBankType] = useState<'itau' | 'cora' | 'infinitypay'>('infinitypay')
  const [importing, setImporting] = useState(false)
  const [running, setRunning] = useState(false)
  const [groups, setGroups] = useState<ReconGroup | null>(null)
  const [approvingAll, setApprovingAll] = useState(false)
  const [confirming, setConfirming] = useState<Record<string, boolean>>({})
  const [confirmModal, setConfirmModal] = useState<ConfirmState | null>(null)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({ verde: true, amarelo: true, vermelho: false })

  // Estado global de bloqueio: impede cliques duplos em qualquer operação pesada
  const isProcessing = importing || running || approvingAll

  // ── Import CSV ────────────────────────────────────────────────────────────
  const handleImport = async () => {
    if (!bankFile || isProcessing) { toast.error('Selecione um arquivo CSV'); return }
    setImporting(true)
    try {
      const fd = new FormData()
      fd.append('file', bankFile)
      fd.append('bank', bankType)
      await api.post('/financeiro/bank-statements/import', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      toast.success('Extrato importado!')
      setBankFile(null)
      handleReconcile()
    } catch (e: any) {
      toast.error(e.response?.data?.detail ?? 'Erro ao importar.')
    } finally { setImporting(false) }
  }

  // ── Run reconciliation ────────────────────────────────────────────────────
  const handleReconcile = async () => {
    if (isProcessing) return
    setRunning(true)
    try {
      const res = await api.post<ReconGroup>('/financeiro/reconcile')
      setGroups(res.data)
      const total = (res.data.automatico?.length ?? 0) + (res.data.sugestao?.length ?? 0)
        + (res.data.pendente?.length ?? 0) + (res.data.identificado?.length ?? 0)
      toast.success(`Conciliação concluída — ${total} itens analisados.`)
    } catch (e: any) {
      toast.error(e.response?.data?.detail ?? 'Erro na conciliação.')
    } finally { setRunning(false) }
  }

  // ── Confirm single match ──────────────────────────────────────────────────
  const confirmItem = async (item: ReconciliationItem, residentId?: string) => {
    if (!item.bank_statement_id || !item.transaction_id) {
      toast.error('Item sem statement ou transação vinculada.')
      return
    }
    setConfirming(p => ({ ...p, [item.id]: true }))
    try {
      await api.post('/financeiro/pix-learning/confirm', {
        bank_statement_id: item.bank_statement_id,
        transaction_id: item.transaction_id,
        resident_id: residentId,
      })
      toast.success('Correspondência confirmada!')
      setGroups(prev => {
        if (!prev) return prev
        const remove = (arr: ReconciliationItem[]) => arr.filter(i => i.id !== item.id)
        return {
          ...prev,
          automatico: remove(prev.automatico),
          sugestao: remove(prev.sugestao),
          pendente: remove(prev.pendente),
          identificado: remove(prev.identificado),
        }
      })
    } catch (e: any) {
      toast.error(e.response?.data?.detail ?? 'Erro ao confirmar.')
    } finally {
      setConfirming(p => ({ ...p, [item.id]: false }))
      setConfirmModal(null)
    }
  }

  // ── Approve all VERDE (automatico) ────────────────────────────────────────
  const approveAllVerde = async () => {
    if (!groups?.automatico?.length) return
    setApprovingAll(true)
    let ok = 0
    for (const item of groups.automatico) {
      if (!item.bank_statement_id || !item.transaction_id || !item.resident_id) continue
      try {
        await api.post('/financeiro/pix-learning/confirm', {
          bank_statement_id: item.bank_statement_id,
          transaction_id: item.transaction_id,
          resident_id: item.resident_id,
        })
        ok++
      } catch { /* continue */ }
    }
    toast.success(`${ok} correspondências aprovadas.`)
    setGroups(prev => prev ? { ...prev, automatico: [] } : prev)
    setApprovingAll(false)
  }

  // ── Register orphan as income ─────────────────────────────────────────────
  const registerAsIncome = async (item: ReconciliationItem, residentId: string) => {
    if (!item.bank_statement_id) return
    setConfirming(p => ({ ...p, [item.id]: true }))
    try {
      await api.post(`/financeiro/bank-statements/${item.bank_statement_id}/register-as-income`, {
        resident_id: residentId,
        income_subtype: 'other',
      })
      toast.success('Receita registrada e conciliada!')
      setGroups(prev => prev ? {
        ...prev,
        identificado: prev.identificado.filter(i => i.id !== item.id),
      } : prev)
    } catch (e: any) {
      toast.error(e.response?.data?.detail ?? 'Erro ao registrar receita.')
    } finally {
      setConfirming(p => ({ ...p, [item.id]: false }))
      setConfirmModal(null)
    }
  }

  // ── Resident search for manual confirm ───────────────────────────────────
  const searchResidents = async (q: string) => {
    if (!confirmModal || q.length < 2) return
    try {
      const res = await api.get<{ id: string; full_name: string }[]>(`/residents/search?q=${encodeURIComponent(q)}`)
      setConfirmModal(m => m ? { ...m, residentResults: res.data } : m)
    } catch { /* noop */ }
  }

  const toggle = (key: string) => setExpanded(p => ({ ...p, [key]: !p[key] }))

  // ── Render helpers ────────────────────────────────────────────────────────
  const renderItem = (item: ReconciliationItem, canConfirm: boolean, needsResident = false) => (
    <div key={item.id} className="flex items-start gap-3 py-3 border-b border-gray-50 last:border-0">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="font-medium text-xs text-gray-800 truncate">{item.name || '—'}</span>
          {item.resident && item.resident !== item.name && (
            <span className="text-[10px] text-gray-400 truncate">→ {item.resident}</span>
          )}
        </div>
        <div className="flex items-center gap-3 text-[11px] text-gray-500">
          <span>{fmtCurrency(item.amount)}</span>
          <span>{item.date}</span>
          {item.bank && <span className="uppercase font-mono">{item.bank}</span>}
        </div>
        {item.sale_description && (
          <div className="text-[10px] text-gray-400 truncate mt-0.5">{item.sale_description}</div>
        )}
        <ScoreBar score={item.score} />
      </div>
      {canConfirm && (
        needsResident ? (
          <div className="flex flex-col gap-1 shrink-0">
            <button
              onClick={() => setConfirmModal({
              item,
              residentQuery: item.resident || item.name || '',
              residentResults: [],
              selectedResidentId: '',
              selectedResidentName: '',
              loading: false,
              mode: 'vincular',
            })}
              className="text-xs bg-amber-500 text-white px-2.5 py-1 rounded-lg hover:bg-amber-600"
            >
              Vincular
            </button>
            <button
              onClick={() => setConfirmModal({
                item,
                residentQuery: '',
                residentResults: [],
                selectedResidentId: '',
                selectedResidentName: '',
                loading: false,
                mode: 'register-income',
              })}
              className="text-xs bg-green-600 text-white px-2.5 py-1 rounded-lg hover:bg-green-700"
            >
              + Receita
            </button>
          </div>
        ) : (
          <button
            onClick={() => item.resident_id && confirmItem(item, item.resident_id)}
            disabled={confirming[item.id] || !item.resident_id}
            className="shrink-0 text-xs bg-[#26619c] text-white px-2.5 py-1 rounded-lg hover:bg-[#1e4f82] disabled:opacity-50"
          >
            {confirming[item.id] ? '…' : 'Confirmar'}
          </button>
        )
      )}
    </div>
  )

  const sectionHeader = (
    label: string,
    key: string,
    count: number,
    color: string,
    icon: ReactNode,
    action?: ReactNode,
  ) => (
    <div
      className={`flex items-center justify-between px-4 py-2.5 rounded-xl border cursor-pointer select-none ${color}`}
      onClick={() => toggle(key)}
    >
      <div className="flex items-center gap-2">
        {icon}
        <span className="font-semibold text-sm">{label}</span>
        <span className="text-xs font-mono bg-white/60 rounded px-1.5 py-0.5">{count}</span>
      </div>
      <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
        {action}
        {expanded[key] ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </div>
    </div>
  )

  return (
    <div className="flex flex-col gap-4">
      {/* Pipeline info */}
      <div className="bg-white rounded-xl border border-blue-100 shadow-sm p-4">
        <h3 className="text-sm font-bold text-gray-800 mb-3">Esteira Financeira — Fluxo do Caixa ao Faturamento</h3>
        <div className="flex flex-col gap-1.5 text-xs text-gray-600">
          {[
            { n: 1, t: 'Operador fecha caixa (conf. cega) e coloca o dinheiro no malote físico', c: 'bg-amber-400' },
            { n: 2, t: 'Conferente recolhe o dinheiro e verifica se o valor físico bate com o fechamento', c: 'bg-blue-500' },
            { n: 3, t: 'Dinheiro (espécie) → lançado no faturamento. PIX → esteira de conciliação abaixo', c: 'bg-purple-500' },
            { n: 4, t: 'Conciliação PIX: cada venda PIX confirmada com o extrato bancário (motor inteligente)', c: 'bg-green-500' },
            { n: 5, t: 'PIX conciliados → contabilizados no faturamento (caixinha cofre)', c: 'bg-green-500' },
            { n: 6, t: 'Responsável transfere espécie do malote para o cofre no sistema (Caixinhas)', c: 'bg-gray-400' },
          ].map(s => (
            <div key={s.n} className="flex items-start gap-2 py-1.5 border-b border-gray-50 last:border-0">
              <span className={`shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold text-white ${s.c}`}>{s.n}</span>
              <span>{s.t}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Import + run */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
        <h2 className="font-semibold text-gray-800 mb-3">Importar Extrato Bancário</h2>
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Banco</label>
            <select
              value={bankType}
              onChange={e => setBankType(e.target.value as any)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
            >
              <option value="infinitypay">InfinityPay</option>
              <option value="cora">Cora</option>
              <option value="itau">Itaú</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Arquivo CSV</label>
            <input
              type="file"
              accept=".csv"
              onChange={e => setBankFile(e.target.files?.[0] ?? null)}
              className="text-sm"
            />
          </div>
          <button
            onClick={handleImport}
            disabled={isProcessing || !bankFile}
            className="flex items-center gap-1.5 bg-[#26619c] text-white px-4 py-2 rounded-lg text-sm disabled:opacity-50"
          >
            <Upload size={14} />
            {importing ? 'Importando…' : isProcessing ? 'Aguarde…' : 'Importar e Conciliar'}
          </button>
          <button
            onClick={handleReconcile}
            disabled={isProcessing}
            className="flex items-center gap-1.5 border border-[#26619c] text-[#26619c] px-4 py-2 rounded-lg text-sm disabled:opacity-50"
          >
            <TrendingUp size={14} />
            {running ? 'Analisando…' : isProcessing ? 'Aguarde…' : 'Re-executar Conciliação'}
          </button>
        </div>
      </div>

      {/* Results */}
      {groups && (
        <div className="flex flex-col gap-3">
          {/* VERDE */}
          <div>
            {sectionHeader(
              'VERDE — Alta confiança (≥150 pts)',
              'verde',
              groups.automatico.length,
              'bg-green-50 border-green-200 text-green-800',
              <CheckCheck size={16} className="text-green-600" />,
              groups.automatico.length > 0 ? (
                <button
                  onClick={approveAllVerde}
                  disabled={isProcessing}
                  className="text-xs bg-green-600 text-white px-3 py-1 rounded-lg hover:bg-green-700 disabled:opacity-50"
                >
                  {approvingAll ? '…' : 'Aprovar Tudo Verde'}
                </button>
              ) : undefined,
            )}
            {expanded.verde && groups.automatico.length > 0 && (
              <div className="bg-white border border-green-100 border-t-0 rounded-b-xl px-4 divide-y divide-gray-50">
                {groups.automatico.map(item => renderItem(item, true))}
              </div>
            )}
            {expanded.verde && groups.automatico.length === 0 && (
              <div className="bg-white border border-green-100 border-t-0 rounded-b-xl px-4 py-3 text-xs text-gray-400">
                Nenhuma correspondência automática pendente.
              </div>
            )}
          </div>

          {/* AMARELO */}
          <div>
            {sectionHeader(
              'AMARELO — Confirmação necessária (80–149 pts)',
              'amarelo',
              groups.sugestao.length,
              'bg-amber-50 border-amber-200 text-amber-800',
              <AlertCircle size={16} className="text-amber-500" />,
            )}
            {expanded.amarelo && groups.sugestao.length > 0 && (
              <div className="bg-white border border-amber-100 border-t-0 rounded-b-xl px-4 divide-y divide-gray-50">
                {groups.sugestao.map(item => renderItem(item, true))}
              </div>
            )}
            {expanded.amarelo && groups.sugestao.length === 0 && (
              <div className="bg-white border border-amber-100 border-t-0 rounded-b-xl px-4 py-3 text-xs text-gray-400">
                Sem sugestões pendentes.
              </div>
            )}
          </div>

          {/* VERMELHO */}
          <div>
            {sectionHeader(
              'VERMELHO — Baixa confiança (<80 pts)',
              'vermelho',
              groups.pendente.length + groups.identificado.length,
              'bg-red-50 border-red-200 text-red-800',
              <XCircle size={16} className="text-red-400" />,
            )}
            {expanded.vermelho && (
              <div className="bg-white border border-red-100 border-t-0 rounded-b-xl px-4 divide-y divide-gray-50">
                {groups.pendente.length === 0 && groups.identificado.length === 0 && (
                  <p className="py-3 text-xs text-gray-400">Nenhum item com baixa confiança.</p>
                )}
                {groups.pendente.map(item => renderItem(item, false))}
                {groups.identificado.length > 0 && (
                  <div className="py-2">
                    <p className="text-[10px] uppercase tracking-wide text-gray-400 mb-2">Extratos sem transação correspondente</p>
                    {groups.identificado.map(item => renderItem(item, true, true))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Confirm modal (vincular residente para orphan) */}
      {confirmModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-5">
            <h3 className="font-semibold text-gray-800 mb-1">
              {confirmModal.mode === 'register-income' ? 'Registrar como Receita' : 'Vincular Pagamento a Morador'}
            </h3>
            <p className="text-xs text-gray-500 mb-3">
              {fmtCurrency(confirmModal.item.amount)} de <strong>{confirmModal.item.name}</strong> em {confirmModal.item.date}
            </p>
            <label className="block text-xs text-gray-500 mb-1">Buscar morador</label>
            <input
              type="text"
              value={confirmModal.residentQuery}
              onChange={e => {
                setConfirmModal(m => m ? { ...m, residentQuery: e.target.value, selectedResidentId: '' } : m)
                searchResidents(e.target.value)
              }}
              placeholder="Nome do morador…"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mb-2"
            />
            {confirmModal.residentResults.length > 0 && (
              <ul className="border border-gray-200 rounded-lg divide-y divide-gray-100 mb-3 max-h-40 overflow-y-auto">
                {confirmModal.residentResults.map(r => (
                  <li
                    key={r.id}
                    onClick={() => setConfirmModal(m => m ? {
                      ...m,
                      selectedResidentId: r.id,
                      selectedResidentName: r.full_name,
                      residentQuery: r.full_name,
                      residentResults: [],
                    } : m)}
                    className={`px-3 py-2 text-sm cursor-pointer hover:bg-gray-50 ${
                      confirmModal.selectedResidentId === r.id ? 'bg-blue-50 text-[#26619c]' : ''
                    }`}
                  >
                    {r.full_name}
                  </li>
                ))}
              </ul>
            )}
            <div className="flex gap-2 mt-1">
              <button
                onClick={() => setConfirmModal(null)}
                className="flex-1 border border-gray-200 text-gray-600 rounded-xl py-2 text-sm"
              >
                Cancelar
              </button>
              <button
                onClick={() => {
                  if (!confirmModal.selectedResidentId) return
                  if (confirmModal.mode === 'register-income') {
                    registerAsIncome(confirmModal.item, confirmModal.selectedResidentId)
                  } else {
                    confirmItem(confirmModal.item, confirmModal.selectedResidentId)
                  }
                }}
                disabled={!confirmModal.selectedResidentId || confirming[confirmModal.item.id]}
                className="flex-1 bg-[#26619c] text-white rounded-xl py-2 text-sm disabled:opacity-50"
              >
                {confirming[confirmModal.item.id] ? '…' : 'Confirmar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
