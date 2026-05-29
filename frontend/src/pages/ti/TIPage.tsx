import { useEffect, useState } from 'react'
import { Database, Globe, RefreshCw, ChevronDown, ChevronRight, Activity, Zap, AlertTriangle } from 'lucide-react'
import api from '../../services/api'

interface Route { path: string; methods: string[]; name: string; tags: string[]; summary: string | null }
interface PerfRow { method: string; path: string; requests: number; avg_ms: number; p95_ms: number; max_ms: number; errors: number; last_seen: string | null }
interface TableStat { name: string; total_size: string; data_size: string; index_size: string; total_bytes: number; row_estimate: number; dead_rows: number; last_vacuum: string | null; last_analyze: string | null }
interface IndexStat { name: string; table: string; size: string; scans: number; tuples_read: number }
interface ActiveQuery { pid: number; state: string; wait_type: string | null; wait_event: string | null; query: string; duration_s: number }
interface DbData { tables: TableStat[]; indexes: IndexStat[]; active_queries: ActiveQuery[]; cache: { hit: number; read: number; hit_pct: number }; row_counts: { table: string; estimate: number }[] }

const MC: Record<string, string> = {
  GET: 'bg-green-100 text-green-700', POST: 'bg-blue-100 text-blue-700',
  PATCH: 'bg-amber-100 text-amber-700', PUT: 'bg-orange-100 text-orange-700', DELETE: 'bg-red-100 text-red-700',
}
const fmt = (ms: number) => `${(ms / 1000).toFixed(2)}s`
const perfColor = (ms: number) => ms > 2000 ? 'text-red-600 font-bold' : ms > 800 ? 'text-amber-600 font-semibold' : 'text-green-700'

function Section({ title, icon: Icon, count, children, defaultOpen = true }: {
  title: string; icon: React.ComponentType<any>; count?: number; children: React.ReactNode; defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="border border-gray-200 rounded-2xl overflow-hidden bg-white shadow-sm">
      <button onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 px-4 py-3 bg-gray-50 hover:bg-gray-100 transition text-left">
        <Icon className="w-4 h-4 text-[#26619c]" />
        <span className="text-sm font-semibold text-gray-800">{title}</span>
        {count !== undefined && <span className="ml-1 text-xs text-gray-400 bg-white border border-gray-200 rounded-full px-2 py-0.5">{count}</span>}
        <span className="ml-auto">{open ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}</span>
      </button>
      {open && <div className="border-t border-gray-100">{children}</div>}
    </div>
  )
}

export default function TIPage() {
  const [routes, setRoutes] = useState<Route[]>([])
  const [perf, setPerf] = useState<PerfRow[]>([])
  const [db, setDb] = useState<DbData | null>(null)
  const [loading, setLoading] = useState(false)
  const [expandedTags, setExpandedTags] = useState<Set<string>>(new Set())
  const [searchRoute, setSearchRoute] = useState('')
  const [searchPerf, setSearchPerf] = useState('')
  const [sortPerf, setSortPerf] = useState<'avg_ms' | 'p95_ms' | 'requests' | 'errors'>('avg_ms')
  const [sortTable, setSortTable] = useState<'total_bytes' | 'row_estimate' | 'dead_rows' | 'name'>('total_bytes')

  const loadAll = async () => {
    setLoading(true)
    try {
      const [rRoutes, rPerf, rDb] = await Promise.all([
        api.get<Route[]>('/ti/routes'),
        api.get<PerfRow[]>('/ti/perf'),
        api.get<DbData>('/ti/db'),
      ])
      setRoutes(rRoutes.data)
      setExpandedTags(new Set(rRoutes.data.flatMap(x => x.tags.length ? x.tags : ['Sem tag'])))
      setPerf(rPerf.data)
      setDb(rDb.data)
    } catch { /* silent */ }
    finally { setLoading(false) }
  }

  useEffect(() => { loadAll() }, [])

  const toggleTag = (tag: string) =>
    setExpandedTags(prev => { const n = new Set(prev); n.has(tag) ? n.delete(tag) : n.add(tag); return n })

  const grouped: Record<string, Route[]> = {}
  for (const r of routes) {
    const tag = r.tags[0] || 'Sem tag'
    const q = searchRoute.toLowerCase()
    if (!q || r.path.toLowerCase().includes(q) || (r.summary || '').toLowerCase().includes(q)) {
      if (!grouped[tag]) grouped[tag] = []
      grouped[tag].push(r)
    }
  }

  const sortedTables = db ? [...db.tables].sort((a, b) => {
    if (sortTable === 'name') return a.name.localeCompare(b.name)
    if (sortTable === 'row_estimate') return b.row_estimate - a.row_estimate
    if (sortTable === 'dead_rows') return b.dead_rows - a.dead_rows
    return b.total_bytes - a.total_bytes
  }) : []

  const filteredPerf = [...perf]
    .filter(r => !searchPerf || r.path.includes(searchPerf))
    .sort((a, b) => b[sortPerf] - a[sortPerf])

  const slowEndpoints = perf.filter(r => r.avg_ms > 800).length

  return (
    <div className="flex flex-col gap-4 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-gray-800">Painel de TI</h1>
          <p className="text-xs text-gray-500">Endpoints · Performance · Banco de dados</p>
        </div>
        <button onClick={loadAll} disabled={loading}
          className="flex items-center gap-1.5 border border-gray-200 text-gray-600 px-3 py-1.5 rounded-xl text-sm hover:bg-gray-50 transition disabled:opacity-50">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Atualizar tudo
        </button>
      </div>

      {/* Cards de resumo */}
      {db && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm">
            <p className="text-xs text-gray-500 mb-1">Cache Hit (DB)</p>
            <p className={`text-2xl font-bold ${db.cache.hit_pct >= 95 ? 'text-green-600' : db.cache.hit_pct >= 80 ? 'text-amber-600' : 'text-red-600'}`}>{db.cache.hit_pct}%</p>
            <p className="text-[10px] text-gray-400 mt-0.5">ideal ≥ 95%</p>
          </div>
          <div className="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm">
            <p className="text-xs text-gray-500 mb-1">Endpoints lentos</p>
            <p className={`text-2xl font-bold ${slowEndpoints > 0 ? 'text-red-600' : 'text-green-600'}`}>{slowEndpoints}</p>
            <p className="text-[10px] text-gray-400 mt-0.5">média {'>'} 0.80s</p>
          </div>
          <div className="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm">
            <p className="text-xs text-gray-500 mb-1">Queries ativas</p>
            <p className={`text-2xl font-bold ${db.active_queries.length > 0 ? 'text-amber-600' : 'text-green-600'}`}>{db.active_queries.length}</p>
          </div>
          <div className="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm">
            <p className="text-xs text-gray-500 mb-1">Tabelas / Índices</p>
            <p className="text-2xl font-bold text-gray-800">{db.tables.length} / {db.indexes.length}</p>
          </div>
        </div>
      )}

      {/* Queries ativas */}
      {db && db.active_queries.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-600" />
            <p className="text-sm font-semibold text-amber-800">Queries em execução agora</p>
          </div>
          {db.active_queries.map(q => (
            <div key={q.pid} className="bg-white rounded-xl border border-amber-100 p-3">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs font-mono text-gray-500">PID {q.pid}</span>
                <span className="text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full">{q.state}</span>
                {q.wait_event && <span className="text-[10px] text-gray-400">{q.wait_type}: {q.wait_event}</span>}
                <span className="ml-auto text-sm font-bold text-amber-700">{q.duration_s.toFixed(2)}s</span>
              </div>
              <code className="text-xs text-gray-700 block truncate">{q.query}</code>
            </div>
          ))}
        </div>
      )}

      {/* ── PERFORMANCE ── */}
      <Section title="Performance — tempo médio por endpoint (24h)" icon={Zap} count={perf.length}>
        <div className="p-3 flex items-center gap-2 border-b border-gray-100 bg-gray-50">
          <input value={searchPerf} onChange={e => setSearchPerf(e.target.value)}
            placeholder="Filtrar por path…"
            className="flex-1 border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-[#26619c] bg-white" />
          <span className="text-[10px] text-gray-400 shrink-0 hidden sm:block">Verde &lt;0.80s · Amarelo &lt;2.00s · Vermelho ≥2.00s</span>
        </div>
        {filteredPerf.length === 0 ? (
          <p className="text-center text-sm text-gray-400 py-8">Nenhum dado ainda — dados aparecem após os primeiros requests.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-gray-100 bg-gray-50/50">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 w-16">Método</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500">Path</th>
                  {([['avg_ms','Média (s)'],['p95_ms','P95 (s)'],['requests','Requests'],['errors','Erros']] as const).map(([col, label]) => (
                    <th key={col} onClick={() => setSortPerf(col)}
                      className={`px-3 py-2 text-right text-xs font-semibold cursor-pointer select-none hover:text-[#26619c] ${sortPerf === col ? 'text-[#26619c]' : 'text-gray-500'}`}>
                      {label} {sortPerf === col ? '↓' : ''}
                    </th>
                  ))}
                  <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 hidden sm:table-cell">Último</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filteredPerf.map((r, i) => (
                  <tr key={i} className={`hover:bg-gray-50 transition ${r.avg_ms > 2000 ? 'bg-red-50/40' : r.avg_ms > 800 ? 'bg-amber-50/30' : ''}`}>
                    <td className="px-3 py-2">
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-md ${MC[r.method] || 'bg-gray-100 text-gray-600'}`}>{r.method}</span>
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-gray-700 max-w-[280px] truncate">{r.path}</td>
                    <td className={`px-3 py-2 text-right text-sm tabular-nums font-semibold ${perfColor(r.avg_ms)}`}>{fmt(r.avg_ms)}</td>
                    <td className="px-3 py-2 text-right text-xs text-gray-500 tabular-nums">{fmt(r.p95_ms)}</td>
                    <td className="px-3 py-2 text-right text-xs text-gray-600 tabular-nums">{r.requests.toLocaleString('pt-BR')}</td>
                    <td className={`px-3 py-2 text-right text-xs tabular-nums ${r.errors > 0 ? 'text-red-600 font-semibold' : 'text-gray-400'}`}>{r.errors > 0 ? r.errors : '—'}</td>
                    <td className="px-3 py-2 text-xs text-gray-400 hidden sm:table-cell">{r.last_seen || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {/* ── BANCO ── */}
      {db && (
        <Section title="Banco de Dados — tabelas" icon={Database} count={db.tables.length}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-gray-100 bg-gray-50/50">
                <tr>
                  {([['name','Tabela'],['total_bytes','Tamanho'],['row_estimate','Linhas'],['dead_rows','Dead rows']] as const).map(([col, label]) => (
                    <th key={col} onClick={() => setSortTable(col)}
                      className={`px-3 py-2 text-left text-xs font-semibold cursor-pointer select-none hover:text-[#26619c] ${sortTable === col ? 'text-[#26619c]' : 'text-gray-500'}`}>
                      {label} {sortTable === col ? '↓' : ''}
                    </th>
                  ))}
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
                    <td className={`px-3 py-2 text-xs font-medium ${t.dead_rows > 1000 ? 'text-red-600' : t.dead_rows > 100 ? 'text-amber-600' : 'text-gray-400'}`}>
                      {t.dead_rows > 0 ? t.dead_rows.toLocaleString('pt-BR') : '—'}
                    </td>
                    <td className="px-3 py-2 text-[10px] text-gray-400">{t.data_size} / {t.index_size}</td>
                    <td className="px-3 py-2 text-[10px] text-gray-400">{t.last_vacuum || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      {/* ── ÍNDICES ── */}
      {db && (
        <Section title="Índices menos utilizados (candidatos a remover)" icon={Database} count={db.indexes.length} defaultOpen={false}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-gray-100 bg-gray-50/50">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500">Índice</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500">Tabela</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500">Tamanho</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500">Scans</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {db.indexes.slice(0, 25).map(idx => (
                  <tr key={idx.name} className="hover:bg-gray-50 transition">
                    <td className="px-3 py-2 font-mono text-xs text-gray-700">{idx.name}</td>
                    <td className="px-3 py-2 text-xs text-gray-500">{idx.table}</td>
                    <td className="px-3 py-2 text-xs text-gray-500">{idx.size}</td>
                    <td className={`px-3 py-2 text-xs font-semibold ${idx.scans === 0 ? 'text-red-500' : idx.scans < 10 ? 'text-amber-600' : 'text-green-600'}`}>
                      {idx.scans}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      {/* ── ENDPOINTS ── */}
      <Section title="Endpoints registrados" icon={Globe} count={routes.length} defaultOpen={false}>
        <div className="p-3 border-b border-gray-100 bg-gray-50">
          <input value={searchRoute} onChange={e => setSearchRoute(e.target.value)}
            placeholder="Buscar endpoint ou path…"
            className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-[#26619c] bg-white" />
        </div>
        <div className="flex flex-col divide-y divide-gray-100">
          {Object.entries(grouped)
            .filter(([, rs]) => rs.length > 0)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([tag, rs]) => (
            <div key={tag}>
              <button onClick={() => toggleTag(tag)}
                className="w-full flex items-center gap-2 px-4 py-2 hover:bg-gray-50 transition text-left">
                {expandedTags.has(tag) ? <ChevronDown className="w-3.5 h-3.5 text-gray-400" /> : <ChevronRight className="w-3.5 h-3.5 text-gray-400" />}
                <span className="text-xs font-semibold text-gray-600">{tag}</span>
                <span className="text-[10px] text-gray-400 ml-1">({rs.length})</span>
              </button>
              {expandedTags.has(tag) && rs.map(r => (
                <div key={r.name} className="flex items-center gap-3 px-8 py-2 hover:bg-gray-50 transition border-t border-gray-50">
                  <div className="flex gap-1 shrink-0">
                    {r.methods.map(m => <span key={m} className={`text-[10px] font-bold px-1.5 py-0.5 rounded-md ${MC[m] || 'bg-gray-100 text-gray-600'}`}>{m}</span>)}
                  </div>
                  <code className="text-xs text-gray-700 font-mono flex-1 truncate">{r.path}</code>
                  {r.summary && <span className="text-xs text-gray-400 hidden sm:block truncate max-w-[200px]">{r.summary}</span>}
                </div>
              ))}
            </div>
          ))}
        </div>
      </Section>
    </div>
  )
}
