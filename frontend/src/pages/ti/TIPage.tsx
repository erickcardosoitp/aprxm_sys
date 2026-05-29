import { useEffect, useState } from 'react'
import { Database, Globe, RefreshCw, ChevronDown, ChevronRight, Activity, Zap } from 'lucide-react'
import api from '../../services/api'

type Tab = 'endpoints' | 'banco' | 'perf'

interface Route {
  path: string
  methods: string[]
  name: string
  tags: string[]
  summary: string | null
}

interface TableStat {
  name: string
  total_size: string
  data_size: string
  index_size: string
  total_bytes: number
  row_estimate: number
  dead_rows: number
  last_vacuum: string | null
  last_analyze: string | null
}

interface IndexStat {
  name: string
  table: string
  size: string
  scans: number
  tuples_read: number
}

interface PerfRow {
  method: string
  path: string
  requests: number
  avg_ms: number
  p95_ms: number
  max_ms: number
  errors: number
  last_seen: string | null
}

interface ActiveQuery {
  pid: number
  state: string
  wait_type: string | null
  wait_event: string | null
  query: string
  duration_s: number
}

interface DbData {
  tables: TableStat[]
  indexes: IndexStat[]
  active_queries: ActiveQuery[]
  cache: { hit: number; read: number; hit_pct: number }
  row_counts: { table: string; estimate: number }[]
}

const METHOD_COLORS: Record<string, string> = {
  GET:    'bg-green-100 text-green-700',
  POST:   'bg-blue-100 text-blue-700',
  PATCH:  'bg-yellow-100 text-yellow-700',
  PUT:    'bg-orange-100 text-orange-700',
  DELETE: 'bg-red-100 text-red-700',
}

export default function TIPage() {
  const [tab, setTab] = useState<Tab>('endpoints')
  const [routes, setRoutes] = useState<Route[]>([])
  const [db, setDb] = useState<DbData | null>(null)
  const [perf, setPerf] = useState<PerfRow[]>([])
  const [loading, setLoading] = useState(false)
  const [expandedTags, setExpandedTags] = useState<Set<string>>(new Set())
  const [searchRoute, setSearchRoute] = useState('')
  const [searchPerf, setSearchPerf] = useState('')
  const [sortCol, setSortCol] = useState<'name' | 'total_bytes' | 'row_estimate' | 'dead_rows'>('total_bytes')
  const [sortPerf, setSortPerf] = useState<'avg_ms' | 'p95_ms' | 'requests' | 'errors'>('avg_ms')

  const loadRoutes = async () => {
    setLoading(true)
    try {
      const r = await api.get<Route[]>('/ti/routes')
      setRoutes(r.data)
      // Expandir todas as tags por padrão
      const tags = new Set(r.data.flatMap(x => x.tags.length ? x.tags : ['Sem tag']))
      setExpandedTags(tags)
    } catch { /* silent */ }
    finally { setLoading(false) }
  }

  const loadDb = async () => {
    setLoading(true)
    try {
      const r = await api.get<DbData>('/ti/db')
      setDb(r.data)
    } catch { /* silent */ }
    finally { setLoading(false) }
  }

  const loadPerf = async () => {
    setLoading(true)
    try {
      const r = await api.get<PerfRow[]>('/ti/perf')
      setPerf(r.data)
    } catch { /* silent */ }
    finally { setLoading(false) }
  }

  useEffect(() => {
    if (tab === 'endpoints') loadRoutes()
    else if (tab === 'banco') loadDb()
    else loadPerf()
  }, [tab])

  const toggleTag = (tag: string) => {
    setExpandedTags(prev => {
      const n = new Set(prev)
      n.has(tag) ? n.delete(tag) : n.add(tag)
      return n
    })
  }

  // Agrupar rotas por tag
  const grouped: Record<string, Route[]> = {}
  for (const r of routes) {
    const tag = r.tags[0] || 'Sem tag'
    if (!grouped[tag]) grouped[tag] = []
    const q = searchRoute.toLowerCase()
    if (!q || r.path.toLowerCase().includes(q) || (r.summary || '').toLowerCase().includes(q)) {
      grouped[tag].push(r)
    }
  }

  const sortedTables = db ? [...db.tables].sort((a, b) => {
    if (sortCol === 'name') return a.name.localeCompare(b.name)
    if (sortCol === 'row_estimate') return b.row_estimate - a.row_estimate
    if (sortCol === 'dead_rows') return b.dead_rows - a.dead_rows
    return b.total_bytes - a.total_bytes
  }) : []

  const Th = ({ label, col }: { label: string; col: typeof sortCol }) => (
    <th className={`px-3 py-2 text-left text-xs font-semibold cursor-pointer select-none hover:text-[#26619c] ${sortCol === col ? 'text-[#26619c]' : 'text-gray-500'}`}
      onClick={() => setSortCol(col)}>
      {label} {sortCol === col ? '↓' : ''}
    </th>
  )

  return (
    <div className="flex flex-col gap-4 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-gray-800">Painel de TI</h1>
          <p className="text-xs text-gray-500">Endpoints, banco de dados e performance</p>
        </div>
        <button onClick={() => tab === 'endpoints' ? loadRoutes() : tab === 'banco' ? loadDb() : loadPerf()}
          disabled={loading}
          className="flex items-center gap-1.5 border border-gray-200 text-gray-600 px-3 py-1.5 rounded-xl text-sm hover:bg-gray-50 transition disabled:opacity-50">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Atualizar
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit">
        {([
          { key: 'endpoints', label: 'Endpoints', icon: Globe },
          { key: 'perf',      label: 'Performance', icon: Zap },
          { key: 'banco',     label: 'Banco', icon: Database },
        ] as const).map(({ key, label, icon: Icon }) => (
          <button key={key} onClick={() => setTab(key)}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition ${tab === key ? 'bg-white shadow-sm text-[#26619c]' : 'text-gray-600 hover:text-gray-800'}`}>
            <Icon className="w-4 h-4" /> {label}
          </button>
        ))}
      </div>

      {loading && <p className="text-sm text-gray-400 text-center py-12">Carregando…</p>}

      {/* ── ENDPOINTS ── */}
      {tab === 'endpoints' && !loading && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <input value={searchRoute} onChange={e => setSearchRoute(e.target.value)}
              placeholder="Buscar endpoint ou path…"
              className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#26619c]" />
            <span className="text-sm text-gray-400 shrink-0">{routes.length} endpoints</span>
          </div>

          {Object.entries(grouped)
            .filter(([, rs]) => rs.length > 0)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([tag, rs]) => (
            <div key={tag} className="border border-gray-200 rounded-2xl overflow-hidden bg-white shadow-sm">
              <button onClick={() => toggleTag(tag)}
                className="w-full flex items-center gap-2 px-4 py-3 bg-gray-50 hover:bg-gray-100 transition text-left">
                {expandedTags.has(tag) ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
                <span className="text-sm font-semibold text-gray-700">{tag}</span>
                <span className="ml-auto text-xs text-gray-400 bg-white border border-gray-200 rounded-full px-2 py-0.5">{rs.length}</span>
              </button>
              {expandedTags.has(tag) && (
                <div className="divide-y divide-gray-100">
                  {rs.map(r => (
                    <div key={r.name} className="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 transition">
                      <div className="flex gap-1 shrink-0">
                        {r.methods.map(m => (
                          <span key={m} className={`text-[10px] font-bold px-1.5 py-0.5 rounded-md ${METHOD_COLORS[m] || 'bg-gray-100 text-gray-600'}`}>{m}</span>
                        ))}
                      </div>
                      <code className="text-xs text-gray-700 font-mono flex-1 truncate">{r.path}</code>
                      {r.summary && <span className="text-xs text-gray-400 shrink-0 hidden sm:block truncate max-w-[240px]">{r.summary}</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── PERFORMANCE ── */}
      {tab === 'perf' && !loading && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <input value={searchPerf} onChange={e => setSearchPerf(e.target.value)}
              placeholder="Filtrar por path…"
              className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#26619c]" />
            <span className="text-xs text-gray-400 shrink-0">{perf.length} endpoints · últimas 24h</span>
          </div>

          {perf.length === 0 ? (
            <div className="text-center text-gray-400 text-sm py-12">
              Nenhum dado ainda. Os tempos aparecem após os primeiros requests.
            </div>
          ) : (
            <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b border-gray-100 bg-gray-50">
                    <tr>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 w-16">Método</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500">Path</th>
                      {([
                        ['avg_ms',   'Média (s)'],
                        ['p95_ms',   'P95 (s)'],
                        ['requests', 'Requests'],
                        ['errors',   'Erros'],
                      ] as const).map(([col, label]) => (
                        <th key={col}
                          onClick={() => setSortPerf(col)}
                          className={`px-3 py-2 text-right text-xs font-semibold cursor-pointer select-none hover:text-[#26619c] ${sortPerf === col ? 'text-[#26619c]' : 'text-gray-500'}`}>
                          {label} {sortPerf === col ? '↓' : ''}
                        </th>
                      ))}
                      <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 hidden sm:table-cell">Último</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {[...perf]
                      .filter(r => !searchPerf || r.path.includes(searchPerf))
                      .sort((a, b) => b[sortPerf] - a[sortPerf])
                      .map((r, i) => {
                        const slow = r.avg_ms > 2000
                        const medium = r.avg_ms > 800
                        const avgColor = slow ? 'text-red-600 font-bold' : medium ? 'text-yellow-600 font-semibold' : 'text-green-700'
                        return (
                          <tr key={i} className={`hover:bg-gray-50 transition ${slow ? 'bg-red-50/30' : ''}`}>
                            <td className="px-3 py-2">
                              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-md ${METHOD_COLORS[r.method] || 'bg-gray-100 text-gray-600'}`}>{r.method}</span>
                            </td>
                            <td className="px-3 py-2 font-mono text-xs text-gray-700 max-w-[300px] truncate">{r.path}</td>
                            <td className={`px-3 py-2 text-right text-sm tabular-nums ${avgColor}`}>
                              {(r.avg_ms / 1000).toFixed(2)}s
                            </td>
                            <td className="px-3 py-2 text-right text-xs text-gray-500 tabular-nums">
                              {(r.p95_ms / 1000).toFixed(2)}s
                            </td>
                            <td className="px-3 py-2 text-right text-xs text-gray-600 tabular-nums">{r.requests.toLocaleString('pt-BR')}</td>
                            <td className={`px-3 py-2 text-right text-xs tabular-nums ${r.errors > 0 ? 'text-red-600 font-semibold' : 'text-gray-400'}`}>
                              {r.errors > 0 ? r.errors : '—'}
                            </td>
                            <td className="px-3 py-2 text-xs text-gray-400 hidden sm:table-cell">{r.last_seen || '—'}</td>
                          </tr>
                        )
                      })}
                  </tbody>
                </table>
              </div>
              <div className="px-4 py-2 bg-gray-50 border-t border-gray-100 flex gap-4 text-[10px] text-gray-400">
                <span className="text-green-700 font-medium">■ Verde</span> &lt; 0.80s
                <span className="text-yellow-600 font-medium">■ Amarelo</span> 0.80s – 2.00s
                <span className="text-red-600 font-medium">■ Vermelho</span> &gt; 2.00s (gargalo)
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── BANCO ── */}
      {tab === 'banco' && !loading && db && (
        <div className="flex flex-col gap-4">
          {/* Cards de resumo */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm">
              <p className="text-xs text-gray-500 mb-1">Cache Hit</p>
              <p className={`text-2xl font-bold ${db.cache.hit_pct >= 95 ? 'text-green-600' : db.cache.hit_pct >= 80 ? 'text-yellow-600' : 'text-red-600'}`}>
                {db.cache.hit_pct}%
              </p>
              <p className="text-[10px] text-gray-400 mt-0.5">ideal ≥ 95%</p>
            </div>
            <div className="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm">
              <p className="text-xs text-gray-500 mb-1">Tabelas</p>
              <p className="text-2xl font-bold text-gray-800">{db.tables.length}</p>
            </div>
            <div className="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm">
              <p className="text-xs text-gray-500 mb-1">Índices</p>
              <p className="text-2xl font-bold text-gray-800">{db.indexes.length}</p>
            </div>
            <div className="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm">
              <p className="text-xs text-gray-500 mb-1">Queries ativas</p>
              <p className={`text-2xl font-bold ${db.active_queries.length > 0 ? 'text-amber-600' : 'text-green-600'}`}>
                {db.active_queries.length}
              </p>
            </div>
          </div>

          {/* Queries ativas */}
          {db.active_queries.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4">
              <div className="flex items-center gap-2 mb-3">
                <Activity className="w-4 h-4 text-amber-600" />
                <p className="text-sm font-semibold text-amber-800">Queries em execução</p>
              </div>
              <div className="flex flex-col gap-2">
                {db.active_queries.map(q => (
                  <div key={q.pid} className="bg-white rounded-xl border border-amber-100 p-3">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-mono text-gray-500">PID {q.pid}</span>
                      <span className="text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full">{q.state}</span>
                      {q.wait_event && <span className="text-[10px] text-gray-400">{q.wait_type}: {q.wait_event}</span>}
                      <span className="ml-auto text-xs font-semibold text-amber-700">{q.duration_s}s</span>
                    </div>
                    <code className="text-xs text-gray-700 block truncate">{q.query}</code>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Tabelas */}
          <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm">
            <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
              <p className="text-sm font-semibold text-gray-700">Tabelas — por tamanho</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-gray-100">
                  <tr>
                    <Th label="Tabela" col="name" />
                    <Th label="Tamanho total" col="total_bytes" />
                    <Th label="Linhas (est.)" col="row_estimate" />
                    <Th label="Dead rows" col="dead_rows" />
                    <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500">Dados / Índices</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500">Último vacuum</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {sortedTables.map(t => (
                    <tr key={t.name} className="hover:bg-gray-50 transition">
                      <td className="px-3 py-2 font-mono text-xs text-gray-700 font-medium">{t.name}</td>
                      <td className="px-3 py-2 text-xs text-gray-600">{t.total_size}</td>
                      <td className="px-3 py-2 text-xs text-gray-600">{t.row_estimate.toLocaleString('pt-BR')}</td>
                      <td className={`px-3 py-2 text-xs font-medium ${t.dead_rows > 1000 ? 'text-red-600' : t.dead_rows > 100 ? 'text-yellow-600' : 'text-gray-400'}`}>
                        {t.dead_rows > 0 ? t.dead_rows.toLocaleString('pt-BR') : '—'}
                      </td>
                      <td className="px-3 py-2 text-[10px] text-gray-400">{t.data_size} / {t.index_size}</td>
                      <td className="px-3 py-2 text-[10px] text-gray-400">{t.last_vacuum || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Índices menos usados */}
          <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm">
            <div className="px-4 py-3 border-b border-gray-100 bg-gray-50 flex items-center justify-between">
              <p className="text-sm font-semibold text-gray-700">Índices — menos utilizados (candidatos a remover)</p>
              <span className="text-xs text-gray-400">{db.indexes.length} índices</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-gray-100">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500">Índice</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500">Tabela</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500">Tamanho</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500">Scans</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {db.indexes.slice(0, 20).map(idx => (
                    <tr key={idx.name} className="hover:bg-gray-50 transition">
                      <td className="px-3 py-2 font-mono text-xs text-gray-700">{idx.name}</td>
                      <td className="px-3 py-2 text-xs text-gray-500">{idx.table}</td>
                      <td className="px-3 py-2 text-xs text-gray-500">{idx.size}</td>
                      <td className={`px-3 py-2 text-xs font-semibold ${idx.scans === 0 ? 'text-red-500' : idx.scans < 10 ? 'text-yellow-600' : 'text-green-600'}`}>
                        {idx.scans}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
