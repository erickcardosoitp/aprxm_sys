import { useEffect, useState } from 'react'
import { Check, ChevronLeft, ChevronRight, Copy, RotateCcw, Search, X } from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../../services/api'

interface AuditEntry {
  id: string
  type: string
  income_subtype: string | null
  amount: string
  description: string
  is_sangria: boolean
  is_reversal: boolean
  is_reversed: boolean
  reversal_of_id: string | null
  reversal_reason: string | null
  transaction_at: string
  creator_name: string
  reverser_name: string | null
  reversed_at: string | null
}

interface SysLogEntry {
  id: string
  acao: string
  entidade: string
  entidade_id: string
  detalhe: string
  data: string
  autor: string
}

const TYPE_LABELS: Record<string, string> = { income: 'Entrada', expense: 'Saída', sangria: 'Sangria' }
const TYPE_COLORS: Record<string, string> = {
  income: 'bg-green-100 text-green-700',
  expense: 'bg-red-100 text-red-700',
  sangria: 'bg-amber-100 text-amber-700',
}

const PAGE_SIZE = 50

type LogTab = 'financeiro' | 'sistema'

export default function LogsPage() {
  const [logTab, setLogTab] = useState<LogTab>('financeiro')

  // Financial logs
  const [items, setItems] = useState<AuditEntry[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [page, setPage] = useState(0)

  const today = new Date().toISOString().slice(0, 10)
  const firstOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10)

  const [dateFrom, setDateFrom] = useState(firstOfMonth)
  const [dateTo, setDateTo] = useState(today)
  const [txType, setTxType] = useState('')
  const [onlyReversals, setOnlyReversals] = useState<'' | 'true' | 'false'>('')
  const [q, setQ] = useState('')
  const [copied, setCopied] = useState<string | null>(null)

  // System logs
  const [sysLogs, setSysLogs] = useState<SysLogEntry[]>([])
  const [loadingSys, setLoadingSys] = useState(false)
  const [sysQ, setSysQ] = useState('')

  const load = async (p = 0) => {
    setLoading(true)
    try {
      const params: Record<string, string | number> = { limit: PAGE_SIZE, offset: p * PAGE_SIZE }
      if (dateFrom) params.date_from = dateFrom
      if (dateTo) params.date_to = dateTo
      if (txType) params.type = txType
      if (onlyReversals !== '') params.is_reversal = onlyReversals
      if (q.trim()) params.q = q.trim()
      const res = await api.get<{ total: number; items: AuditEntry[] }>('/finance/audit', { params })
      setItems(res.data.items)
      setTotal(res.data.total)
      setPage(p)
    } catch { toast.error('Erro ao carregar logs.') } finally { setLoading(false) }
  }

  const loadSysLogs = async () => {
    setLoadingSys(true)
    try {
      const res = await api.get<SysLogEntry[]>('/admin/audit-log')
      setSysLogs(res.data)
    } catch { setSysLogs([]) } finally { setLoadingSys(false) }
  }

  useEffect(() => { load(0) }, [dateFrom, dateTo, txType, onlyReversals])
  useEffect(() => { if (logTab === 'sistema') loadSysLogs() }, [logTab])

  const handleSearch = (e: React.FormEvent) => { e.preventDefault(); load(0) }

  const copyId = (id: string) => {
    navigator.clipboard.writeText(id)
    setCopied(id)
    setTimeout(() => setCopied(null), 1500)
  }

  const totalPages = Math.ceil(total / PAGE_SIZE)

  const filteredSys = sysLogs.filter(l =>
    !sysQ || l.acao.toLowerCase().includes(sysQ.toLowerCase()) || l.detalhe.toLowerCase().includes(sysQ.toLowerCase()) || l.autor.toLowerCase().includes(sysQ.toLowerCase())
  )

  return (
    <div className="flex flex-col gap-4 p-4 sm:p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
          <RotateCcw className="w-5 h-5 text-[#26619c]" />
          Logs
        </h1>
      </div>

      {/* Tab selector */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-xl">
        {([['financeiro', 'Movimentações Financeiras'], ['sistema', 'Logs do Sistema']] as [LogTab, string][]).map(([t, label]) => (
          <button key={t} onClick={() => setLogTab(t)}
            className={`flex-1 py-2 text-xs font-medium rounded-lg transition ${logTab === t ? 'bg-white text-[#26619c] shadow-sm' : 'text-gray-500'}`}>
            {label}
          </button>
        ))}
      </div>

      {/* ── FINANCEIRO ── */}
      {logTab === 'financeiro' && (
        <>
          <div className="flex items-center justify-between">
            {total > 0 && <span className="text-xs text-gray-400">{total} registro(s)</span>}
          </div>

          <div className="bg-white rounded-xl border border-gray-200 p-4 flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">De</label>
                <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Até</label>
                <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <select value={txType} onChange={e => setTxType(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white">
                <option value="">Todos os tipos</option>
                <option value="income">Entradas</option>
                <option value="expense">Saídas</option>
                <option value="sangria">Sangrias</option>
              </select>
              <select value={onlyReversals} onChange={e => setOnlyReversals(e.target.value as any)}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white">
                <option value="">Todas as ações</option>
                <option value="true">Apenas estornos</option>
                <option value="false">Sem estornos</option>
              </select>
            </div>
            <form onSubmit={handleSearch} className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar por descrição ou operador…"
                  className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#26619c]/30" />
              </div>
              <button type="submit" className="px-4 py-2 bg-[#26619c] text-white rounded-lg text-sm font-medium hover:bg-[#1a4f87] transition">
                Buscar
              </button>
              {(q || txType || onlyReversals) && (
                <button type="button" onClick={() => { setQ(''); setTxType(''); setOnlyReversals('') }}
                  className="px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-500 hover:bg-gray-50">
                  <X className="w-4 h-4" />
                </button>
              )}
            </form>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            {loading ? (
              <div className="p-8 text-center text-gray-400 text-sm">Carregando…</div>
            ) : items.length === 0 ? (
              <div className="p-8 text-center text-gray-400 text-sm">Nenhum registro encontrado.</div>
            ) : (
              <ul className="divide-y divide-gray-100">
                {items.map(item => (
                  <li key={item.id} className={`px-4 py-3 ${item.is_reversal ? 'bg-orange-50/50' : item.is_reversed ? 'bg-gray-50' : ''}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold shrink-0 ${TYPE_COLORS[item.type]}`}>
                            {item.is_reversal ? 'Estorno' : TYPE_LABELS[item.type] ?? item.type}
                          </span>
                          {item.is_reversed && !item.is_reversal && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full font-semibold bg-gray-200 text-gray-600 shrink-0">Estornado</span>
                          )}
                          <p className="text-sm font-medium text-gray-800 truncate">{item.description}</p>
                        </div>
                        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                          <button onClick={() => copyId(item.id)}
                            className="flex items-center gap-1 text-[10px] text-gray-400 hover:text-[#26619c] font-mono transition shrink-0">
                            {copied === item.id ? <Check className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3" />}
                            {item.id.slice(0, 8)}…
                          </button>
                          <span className="text-xs text-gray-400">{new Date(item.transaction_at).toLocaleString('pt-BR')}</span>
                          <span className="text-xs text-gray-400">· {item.creator_name}</span>
                        </div>
                        {item.is_reversal && item.reversal_of_id && (
                          <p className="text-xs text-orange-600 mt-0.5">
                            Estorno de: <span className="font-mono">{item.reversal_of_id.slice(0, 8)}…</span>
                            {item.reversal_reason && ` — ${item.reversal_reason}`}
                          </p>
                        )}
                        {item.is_reversed && item.reverser_name && (
                          <p className="text-xs text-gray-500 mt-0.5">
                            Estornado por {item.reverser_name} em {new Date(item.reversed_at!).toLocaleString('pt-BR')}
                          </p>
                        )}
                      </div>
                      <span className={`text-sm font-semibold shrink-0 ${item.type === 'income' ? 'text-green-600' : 'text-red-600'}`}>
                        {item.type === 'income' ? '+' : '-'} R$ {parseFloat(item.amount).toFixed(2)}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between">
              <button onClick={() => load(page - 1)} disabled={page === 0}
                className="flex items-center gap-1 px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-40 transition">
                <ChevronLeft className="w-4 h-4" /> Anterior
              </button>
              <span className="text-xs text-gray-500">Página {page + 1} de {totalPages}</span>
              <button onClick={() => load(page + 1)} disabled={page >= totalPages - 1}
                className="flex items-center gap-1 px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-40 transition">
                Próximo <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          )}
        </>
      )}

      {/* ── SISTEMA ── */}
      {logTab === 'sistema' && (
        <>
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input value={sysQ} onChange={e => setSysQ(e.target.value)} placeholder="Buscar por ação, detalhe ou autor…"
                className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#26619c]/30" />
            </div>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            {loadingSys ? (
              <div className="p-8 text-center text-gray-400 text-sm">Carregando…</div>
            ) : filteredSys.length === 0 ? (
              <div className="p-8 text-center text-gray-400 text-sm">Nenhum log encontrado.</div>
            ) : (
              <ul className="divide-y divide-gray-100">
                {filteredSys.map(log => (
                  <li key={log.id} className="px-4 py-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full font-semibold bg-indigo-100 text-indigo-700 shrink-0">
                            {log.acao.replace(/_/g, ' ')}
                          </span>
                          <p className="text-sm font-medium text-gray-800 truncate">{log.entidade}</p>
                        </div>
                        <p className="text-xs text-gray-500 mt-0.5 truncate">{log.detalhe}</p>
                        <p className="text-xs text-gray-400">por {log.autor}</p>
                      </div>
                      <p className="text-xs text-gray-400 shrink-0">{new Date(log.data).toLocaleString('pt-BR')}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  )
}
