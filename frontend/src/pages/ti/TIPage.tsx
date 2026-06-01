import { useCallback, useEffect, useRef, useState } from 'react'
import { Database, Globe, RefreshCw, ChevronDown, ChevronRight, Activity, Zap, AlertTriangle, Heart, Package, Users, Wallet, GitBranch, Play, CheckCircle2, XCircle, Clock, BarChart2 } from 'lucide-react'
import api from '../../services/api'

interface HealthData {
  timestamp: string
  db: { ok: boolean; ping_ms: number; size: string }
  api: { requests_1h: number; avg_ms: number; errors_1h: number }
  business: { open_cash_sessions: number; active_residents: number; pending_packages: number }
}

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
const fmtMs = (ms: number) => ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${ms}ms`
const perfColor = (ms: number) => ms > 2000 ? 'text-red-600 font-bold' : ms > 800 ? 'text-amber-600 font-semibold' : 'text-green-700'
const AUTO_REFRESH_INTERVAL = 10 // segundos

// ── Diagrama de Arquitetura SVG ─────────────────────────────────────────────

// ── Analytics Panel — Pipeline ETL tipo Airflow ───────────────────────────────

interface EtlRun {
  id: string; run_date: string; mode: string; status: string
  started_at: string; completed_at: string | null; duration_s: number | null
  bronze_rows: number; silver_rows: number; gold_files: number
  neon_kb: number | null; error_msg: string | null; triggered_by: string
}

interface EtlTask { task_name: string; status: string; started_at: string; completed_at: string | null; duration_s: number | null; rows_in: number; rows_out: number }
interface R2File   { key: string; size_kb: number; last_modified: string }
interface GovFile { arquivo: string; size_kb: number; atualizado_em: string }
interface ProximaExec { utc: string; brasilia: string; em: string }
interface Alerta { nivel: 'critico' | 'aviso' | 'info'; mensagem: string; run_id?: string }
interface CamadaInfo { arquivos: GovFile[]; total_arquivos: number; total_kb: number }
interface Governance {
  configured: boolean
  bucket?: string
  timestamp?: string
  saude?: 'ok' | 'critico'
  proximas_execucoes?: ProximaExec[]
  cron_horarios_brasilia?: string[]
  ultimo_etl_metadata?: Record<string, string>
  camadas?: {
    bronze: { atual: CamadaInfo; historico: { datas_disponiveis: string[] } }
    prata:  { hoje: CamadaInfo }
    ouro:   { total_kb: number; financeiro: CamadaInfo; moradores: CamadaInfo; encomendas: CamadaInfo; operacional: CamadaInfo; equipe: CamadaInfo }
  }
  ultimas_execucoes?: EtlRun[]
  estatisticas?: { total_runs: number; successos: number; falhas: number; avg_duracao_s: number; total_neon_kb: number; taxa_sucesso_pct: number }
  alertas?: Alerta[]
}
// retrocompat
interface DlStatus { configured: boolean; ouro_financeiro?: R2File[]; ouro_moradores?: R2File[]; ouro_encomendas?: R2File[]; ouro_operacional?: R2File[]; ouro_equipe?: R2File[]; bronze_atual?: R2File[] }

const TASK_ICON: Record<string, React.ReactNode> = {
  bronze:         <Database className="w-4 h-4" />,
  silver:         <Activity className="w-4 h-4" />,
  gold:           <BarChart2 className="w-4 h-4" />,
  analytics_load: <Database className="w-4 h-4" />,
  validate:       <CheckCircle2 className="w-4 h-4" />,
  error:          <XCircle className="w-4 h-4" />,
}
const STATUS_COLOR: Record<string, string> = {
  success: 'text-emerald-600 bg-emerald-50 border-emerald-200',
  warning: 'text-amber-600 bg-amber-50 border-amber-200',
  failed:  'text-red-600 bg-red-50 border-red-200',
  running: 'text-blue-600 bg-blue-50 border-blue-200',
  pending: 'text-gray-500 bg-gray-50 border-gray-200',
}
const fmtDur = (s: number | null) => s == null ? '—' : s >= 60 ? `${(s/60).toFixed(1)}min` : `${s.toFixed(1)}s`
const fmtDate = (iso: string) => new Date(iso).toLocaleString('pt-BR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' })

const STEP_LABEL: Record<string, string> = {
  bronze: 'Bronze', silver: 'Silver', gold: 'Gold',
  analytics_load: 'Analytics', validate: 'Validate',
}

function PipelineFlow({ tasks }: { tasks: EtlTask[] }) {
  const steps = ['bronze', 'silver', 'gold', 'analytics_load', 'validate']
  return (
    <div className="flex items-center gap-2 py-4 overflow-x-auto">
      {steps.map((step, i) => {
        const task = tasks.find(t => t.task_name === step)
        const status = task?.status ?? 'pending'
        const cls = STATUS_COLOR[status] ?? STATUS_COLOR.pending
        const label = STEP_LABEL[step] ?? step
        const unit = step === 'gold' ? 'files' : step === 'analytics_load' ? 'tabelas' : 'rows'
        return (
          <div key={step} className="flex items-center gap-2 shrink-0">
            <div className={`flex flex-col items-center gap-1 px-4 py-3 rounded-2xl border-2 min-w-[100px] ${cls}`}>
              <div className="flex items-center gap-1.5">
                {TASK_ICON[step] ?? <Activity className="w-4 h-4" />}
                <span className="text-xs font-bold uppercase tracking-wide">{label}</span>
              </div>
              {task ? (
                <>
                  <span className="text-[10px] font-semibold">{status}</span>
                  <span className="text-[10px] opacity-70">{fmtDur(task.duration_s)}</span>
                  {task.rows_out > 0 && <span className="text-[10px] opacity-70">{task.rows_out.toLocaleString('pt-BR')} {unit}</span>}
                </>
              ) : (
                <span className="text-[10px] opacity-50">aguardando</span>
              )}
            </div>
            {i < steps.length - 1 && (
              <div className={`h-0.5 w-6 ${task?.status === 'success' ? 'bg-emerald-400' : 'bg-gray-200'}`} />
            )}
          </div>
        )
      })}
    </div>
  )
}

function AnalyticsPanel() {
  const [gov, setGov] = useState<Governance | null>(null)
  const [selectedRun, setSelectedRun] = useState<(EtlRun & { tasks: EtlTask[] }) | null>(null)
  const [loading, setLoading] = useState(true)
  const [triggering, setTriggering] = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      const r = await api.get<Governance>('/datalake/governance')
      setGov(r.data)
    } catch { /* silent */ } finally { setLoading(false) }
  }

  const loadRun = async (id: string) => {
    const r = await api.get(`/datalake/runs/${id}`)
    setSelectedRun(r.data)
  }

  const triggerManual = async (forceFull = false) => {
    setTriggering(true)
    try {
      await api.post(`/datalake/run/manual?force_full=${forceFull}`)
      setTimeout(load, 3000)
    } catch { /* silent */ } finally { setTriggering(false) }
  }

  useEffect(() => { load() }, [])

  const runs = gov?.ultimas_execucoes ?? []
  const lastRun = runs[0]
  const r2Configured = gov?.configured

  const stats   = gov?.estatisticas
  const alertas = gov?.alertas ?? []
  const camadas = gov?.camadas

  return (
    <div className="flex flex-col gap-4">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-bold text-gray-800">Governança do Pipeline — Data Lake APRXM</h2>
            {gov?.saude === 'ok'
              ? <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">SAUDÁVEL</span>
              : <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-100 text-red-700">ATENÇÃO</span>
            }
          </div>
          <p className="text-xs text-gray-400">Bronze → Silver → Gold → Analytics · R2 + Neon Analytics · 09h e 17h</p>
        </div>
        <div className="flex gap-2">
          <button onClick={load} disabled={loading} className="p-2 rounded-xl border border-gray-200 text-gray-500 hover:bg-gray-50 transition">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button onClick={() => triggerManual(false)} disabled={triggering || !r2Configured}
            className="flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-xl bg-[#26619c] text-white disabled:opacity-40">
            <Play className="w-3.5 h-3.5" /> {triggering ? 'Executando…' : 'Incremental'}
          </button>
          <button onClick={() => triggerManual(true)} disabled={triggering || !r2Configured}
            className="flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-xl border border-gray-300 text-gray-600 disabled:opacity-40">
            Carga Completa
          </button>
        </div>
      </div>

      {/* Alertas */}
      {alertas.length > 0 && (
        <div className="flex flex-col gap-2">
          {alertas.map((a, i) => (
            <div key={i} className={`flex items-start gap-2 px-4 py-3 rounded-xl border text-xs font-medium ${
              a.nivel === 'critico' ? 'bg-red-50 border-red-200 text-red-700' : 'bg-amber-50 border-amber-200 text-amber-700'
            }`}>
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{a.mensagem}</span>
              {a.run_id && (
                <button onClick={() => loadRun(a.run_id!)} className="ml-auto underline shrink-0">ver run →</button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Próximas execuções + estatísticas */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {gov?.proximas_execucoes?.map((p, i) => (
          <div key={i} className="bg-white border border-gray-200 rounded-2xl p-3 shadow-sm">
            <p className="text-[10px] text-gray-400 font-semibold uppercase tracking-wide">Próxima execução {i+1}</p>
            <p className="text-base font-bold text-[#26619c]">{p.brasilia}</p>
            <p className="text-[10px] text-gray-400">em {p.em}</p>
          </div>
        ))}
        {stats && (<>
          <div className="bg-white border border-gray-200 rounded-2xl p-3 shadow-sm">
            <p className="text-[10px] text-gray-400 font-semibold uppercase">Taxa de Sucesso</p>
            <p className={`text-base font-bold ${(stats.taxa_sucesso_pct ?? 0) >= 90 ? 'text-emerald-600' : 'text-amber-600'}`}>{stats.taxa_sucesso_pct ?? '—'}%</p>
            <p className="text-[10px] text-gray-400">{stats.successos} ok / {stats.falhas} falhas</p>
          </div>
          <div className="bg-white border border-gray-200 rounded-2xl p-3 shadow-sm">
            <p className="text-[10px] text-gray-400 font-semibold uppercase">Neon consumido</p>
            <p className="text-base font-bold text-gray-700">{Math.round((stats.total_neon_kb ?? 0)/1024*10)/10} MB</p>
            <p className="text-[10px] text-gray-400">acumulado total</p>
          </div>
        </>)}
      </div>

      {/* Pipeline última execução */}
      {lastRun && (
        <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full border ${STATUS_COLOR[lastRun.status] ?? ''}`}>{lastRun.status.toUpperCase()}</span>
              <span className="text-xs text-gray-500">{lastRun.mode} · {fmtDate(lastRun.started_at)} · {fmtDur(lastRun.duration_s)}</span>
            </div>
            <button onClick={() => loadRun(lastRun.id)} className="text-xs text-[#26619c] hover:underline">tasks →</button>
          </div>
          {selectedRun?.id === lastRun.id
            ? <PipelineFlow tasks={selectedRun.tasks} />
            : (
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                {[
                  { l: 'Bronze',      v: lastRun.bronze_rows?.toLocaleString('pt-BR') ?? '—', s: 'linhas extraídas', c: 'text-amber-600' },
                  { l: 'Silver',      v: lastRun.silver_rows?.toLocaleString('pt-BR') ?? '—', s: 'linhas enriquecidas', c: 'text-blue-600' },
                  { l: 'Gold / R2',   v: lastRun.gold_files, s: 'parquet no R2', c: 'text-emerald-600' },
                  { l: 'Analytics',   v: '18', s: 'tabelas no Neon', c: 'text-purple-600' },
                  { l: 'Bronze (KB)', v: `${lastRun.neon_kb ?? 0}`, s: 'KB extraídos', c: 'text-gray-500' },
                ].map(s => (
                  <div key={s.l} className="bg-gray-50 rounded-xl p-3 text-center">
                    <p className="text-[10px] text-gray-400 font-semibold uppercase">{s.l}</p>
                    <p className={`text-lg font-bold ${s.c}`}>{s.v}</p>
                    <p className="text-[10px] text-gray-400">{s.s}</p>
                  </div>
                ))}
              </div>
            )
          }
          {lastRun.error_msg && <div className="mt-2 bg-red-50 border border-red-200 rounded-xl p-3 text-xs text-red-700 font-mono truncate">{lastRun.error_msg}</div>}
        </div>
      )}

      {/* Detalhe tasks de run selecionado */}
      {selectedRun && selectedRun.id !== lastRun?.id && (
        <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-semibold text-gray-800">{fmtDate(selectedRun.started_at)} — {selectedRun.mode}</span>
            <button onClick={() => setSelectedRun(null)} className="text-xs text-gray-400">fechar</button>
          </div>
          <PipelineFlow tasks={selectedRun.tasks} />
        </div>
      )}

      {/* Inventário R2 — todas as camadas */}
      {camadas && (
        <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-4">
          <p className="text-xs font-bold text-gray-600 mb-3">Inventário R2 — {gov?.bucket}</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">

            {/* Bronze */}
            <div>
              <p className="text-[11px] font-semibold text-amber-700 mb-2">🥉 Bronze/atual ({camadas.bronze.atual.total_arquivos} tabelas · {camadas.bronze.atual.total_kb} KB)</p>
              {camadas.bronze.atual.arquivos.map(f => (
                <div key={f.arquivo} className="flex items-center justify-between py-1 border-b border-gray-50 last:border-0">
                  <span className="text-[11px] text-gray-700 truncate">{f.arquivo.replace('.parquet','')}</span>
                  <span className="text-[10px] text-gray-400 shrink-0 ml-2">{f.size_kb} KB</span>
                </div>
              ))}
              {camadas.bronze.historico.datas_disponiveis.length > 0 && (
                <p className="text-[10px] text-gray-400 mt-2">
                  Histórico: {camadas.bronze.historico.datas_disponiveis.slice(0,3).join(', ')}
                  {camadas.bronze.historico.datas_disponiveis.length > 3 && ` +${camadas.bronze.historico.datas_disponiveis.length-3}`}
                </p>
              )}
            </div>

            {/* Prata */}
            <div>
              <p className="text-[11px] font-semibold text-blue-700 mb-2">🥈 Prata/hoje ({camadas.prata.hoje.total_arquivos} · {camadas.prata.hoje.total_kb} KB)</p>
              {camadas.prata.hoje.arquivos.length === 0
                ? <p className="text-[10px] text-gray-400">Nenhum arquivo hoje ainda.</p>
                : camadas.prata.hoje.arquivos.map(f => (
                  <div key={f.arquivo} className="flex items-center justify-between py-1 border-b border-gray-50 last:border-0">
                    <span className="text-[11px] text-gray-700 truncate">{f.arquivo.replace('.parquet','')}</span>
                    <span className="text-[10px] text-gray-400 shrink-0 ml-2">{f.size_kb} KB</span>
                  </div>
                ))
              }
            </div>

            {/* Ouro */}
            <div>
              <p className="text-[11px] font-semibold text-emerald-700 mb-2">🥇 Ouro ({camadas.ouro.total_kb} KB total)</p>
              {[
                { icon:'💰', label:'Financeiro',  data: camadas.ouro.financeiro  },
                { icon:'👥', label:'Moradores',   data: camadas.ouro.moradores   },
                { icon:'📦', label:'Encomendas',  data: camadas.ouro.encomendas  },
                { icon:'⚙️', label:'Operacional', data: camadas.ouro.operacional },
                { icon:'🗂️', label:'Equipe',      data: camadas.ouro.equipe      },
              ].map(d => (
                <div key={d.label} className="mb-2">
                  <p className="text-[10px] font-semibold text-gray-500">{d.icon} {d.label} ({d.data.total_arquivos} · {d.data.total_kb} KB)</p>
                  <div className="grid grid-cols-2 gap-1 mt-1">
                    {d.data.arquivos.map(f => (
                      <span key={f.arquivo} className="text-[9px] bg-gray-50 rounded px-1.5 py-0.5 text-gray-600 truncate">
                        {f.arquivo.replace('.parquet','')} ({f.size_kb}KB)
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Analytics DB — Neon */}
      <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-4">
        <div className="flex items-center gap-2 mb-3">
          <BarChart2 className="w-4 h-4 text-purple-600" />
          <p className="text-xs font-bold text-gray-700">Analytics DB — Neon <span className="font-normal text-gray-400">(aprxm-analytics · Power BI)</span></p>
          <span className="ml-auto text-[10px] font-semibold px-2 py-0.5 rounded-full bg-purple-100 text-purple-700">OLAP</span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
          {[
            { l: 'Tabelas Gold', v: '18', s: 'replicadas a cada ETL', c: 'text-purple-600' },
            { l: 'Domínios', v: '5', s: 'financeiro · moradores · encomendas · operacional · equipe', c: 'text-gray-700' },
            { l: 'Atualização', v: '2×/dia', s: '09h e 17h (Brasília)', c: 'text-blue-600' },
            { l: 'Estratégia', v: 'REPLACE', s: 'tabela zerada + reload a cada run', c: 'text-amber-600' },
          ].map(s => (
            <div key={s.l} className="bg-gray-50 rounded-xl p-3">
              <p className="text-[10px] text-gray-400 font-semibold uppercase">{s.l}</p>
              <p className={`text-base font-bold ${s.c}`}>{s.v}</p>
              <p className="text-[10px] text-gray-400 leading-tight mt-0.5">{s.s}</p>
            </div>
          ))}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {[
            { icon: '💰', domain: 'financeiro', tables: ['daily_revenue','collection_rate','cash_breaks','sangria_reasons','delinquency_report','runway'] },
            { icon: '👥', domain: 'moradores',  tables: ['resident_overview','member_growth_weekly','census_by_street','community_problems'] },
            { icon: '📦', domain: 'encomendas', tables: ['sla_by_type','packages_by_street','packages_stuck','resident_package_ranking'] },
            { icon: '⚙️', domain: 'operacional',tables: ['operator_performance','operator_revenue','operational_kpis'] },
            { icon: '🗂️', domain: 'equipe',     tables: ['tasks_weekly','tasks_by_collaborator'] },
          ].slice(0, 3).map(d => (
            <div key={d.domain} className="bg-purple-50 border border-purple-100 rounded-xl p-3">
              <p className="text-[10px] font-bold text-purple-700 mb-1">{d.icon} {d.domain} ({d.tables.length})</p>
              <div className="flex flex-wrap gap-1">
                {d.tables.map(t => (
                  <span key={t} className="text-[9px] bg-white border border-purple-100 rounded px-1.5 py-0.5 text-purple-600 font-mono">{t}</span>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="flex gap-2 mt-3">
          {[
            { icon: '⚙️', domain: 'operacional', tables: ['operator_performance','operator_revenue','operational_kpis'] },
            { icon: '🗂️', domain: 'equipe',      tables: ['tasks_weekly','tasks_by_collaborator'] },
          ].map(d => (
            <div key={d.domain} className="flex-1 bg-purple-50 border border-purple-100 rounded-xl p-3">
              <p className="text-[10px] font-bold text-purple-700 mb-1">{d.icon} {d.domain} ({d.tables.length})</p>
              <div className="flex flex-wrap gap-1">
                {d.tables.map(t => (
                  <span key={t} className="text-[9px] bg-white border border-purple-100 rounded px-1.5 py-0.5 text-purple-600 font-mono">{t}</span>
                ))}
              </div>
            </div>
          ))}
        </div>
        <p className="text-[10px] text-gray-400 mt-3">
          Conecte o Power BI via DirectQuery: <span className="font-mono text-gray-600">ep-floral-shadow-ap9n86vs.c-7.us-east-1.aws.neon.tech · db: neondb</span>
        </p>
      </div>

      {/* Histórico */}
      <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100">
          <p className="text-xs font-semibold text-gray-600">Histórico de execuções</p>
        </div>
        {loading ? (
          <div className="flex justify-center py-8"><div className="w-5 h-5 border-2 border-[#26619c] border-t-transparent rounded-full animate-spin" /></div>
        ) : runs.length === 0 ? (
          <p className="text-xs text-gray-400 text-center py-8">Nenhuma execução registrada.</p>
        ) : (
          <table className="w-full text-xs">
            <thead className="bg-gray-50 text-gray-500">
              <tr>{['Data','Modo','Status','Duração','Bronze','Silver','Gold','KB Bronze','Por'].map(h => (
                <th key={h} className="px-3 py-2 text-left font-semibold">{h}</th>
              ))}</tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {runs.map(r => (
                <tr key={r.id} className="hover:bg-gray-50 transition cursor-pointer" onClick={() => loadRun(r.id)}>
                  <td className="px-3 py-2 text-gray-700 whitespace-nowrap">{fmtDate(r.started_at)}</td>
                  <td className="px-3 py-2"><span className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${r.mode==='full'?'bg-purple-100 text-purple-700':'bg-blue-100 text-blue-700'}`}>{r.mode}</span></td>
                  <td className="px-3 py-2"><span className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold border ${STATUS_COLOR[r.status]??''}`}>{r.status}</span></td>
                  <td className="px-3 py-2 tabular-nums">{fmtDur(r.duration_s)}</td>
                  <td className="px-3 py-2 tabular-nums text-amber-700">{r.bronze_rows?.toLocaleString('pt-BR') ?? '—'}</td>
                  <td className="px-3 py-2 tabular-nums text-blue-700">{r.silver_rows?.toLocaleString('pt-BR') ?? '—'}</td>
                  <td className="px-3 py-2 tabular-nums text-emerald-700">{r.gold_files}</td>
                  <td className="px-3 py-2 tabular-nums text-gray-500">{r.neon_kb ?? '—'}</td>
                  <td className="px-3 py-2 text-gray-400">{r.triggered_by}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

function ArchDiagram() {
  const box = (x: number, y: number, w: number, h: number, color: string, label: string, sublabel?: string) => (
    <g key={label}>
      <rect x={x} y={y} width={w} height={h} rx={10} fill={color} opacity={0.15} stroke={color} strokeWidth={1.5} />
      <text x={x + w / 2} y={y + h / 2 - (sublabel ? 7 : 0)} textAnchor="middle" fontSize={13} fontWeight="700" fill={color}>{label}</text>
      {sublabel && <text x={x + w / 2} y={y + h / 2 + 12} textAnchor="middle" fontSize={10} fill={color} opacity={0.8}>{sublabel}</text>}
    </g>
  )
  const arrow = (x1: number, y1: number, x2: number, y2: number, label?: string, color = '#6b7280') => {
    const mx = (x1 + x2) / 2, my = (y1 + y2) / 2
    return (
      <g key={`${x1}${y1}${x2}${y2}`}>
        <defs><marker id={`ah-${x1}-${y2}`} markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill={color} /></marker></defs>
        <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={color} strokeWidth={1.5} markerEnd={`url(#ah-${x1}-${y2})`} strokeDasharray="4 2" />
        {label && <text x={mx + 4} y={my - 4} fontSize={9} fill={color}>{label}</text>}
      </g>
    )
  }

  return (
    <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-4">
      <div className="flex items-center gap-2 mb-4">
        <GitBranch className="w-4 h-4 text-[#26619c]" />
        <h3 className="text-sm font-bold text-gray-800">Arquitetura do Sistema</h3>
        <span className="text-xs text-gray-400 ml-2">APRXM ERP/SaaS Multi-tenant</span>
      </div>
      <div className="overflow-x-auto">
        <svg viewBox="0 0 820 520" className="w-full" style={{ minWidth: 600 }} fontFamily="Inter, system-ui, sans-serif">

          {/* Camada: Usuários */}
          <text x={10} y={25} fontSize={10} fill="#9ca3af" fontWeight="600">CLIENTES</text>
          {box(10, 30, 120, 50, '#6d28d9', 'Operadores', 'Browser/PWA')}
          {box(145, 30, 120, 50, '#1a3f6f', 'Admins', 'Browser')}
          {box(280, 30, 130, 50, '#0d7490', 'API Pública', 'Moradores')}

          {/* Camada: Frontend */}
          <text x={10} y={115} fontSize={10} fill="#9ca3af" fontWeight="600">FRONTEND</text>
          {box(10, 120, 280, 60, '#0f7a4d', 'React SPA (Vite)', 'Vercel CDN · aprxm-sysfrontend.vercel.app')}
          {box(300, 120, 120, 60, '#6d28d9', 'Modo Simplifica', 'Mobile-first')}
          {box(430, 120, 120, 60, '#0d7490', 'Cadastro Público', '/cadastro/:slug')}

          {/* Setas clients → frontend */}
          {arrow(70, 80, 70, 118, 'HTTPS')}
          {arrow(205, 80, 205, 118, 'HTTPS')}
          {arrow(345, 80, 480, 118, 'HTTPS')}

          {/* Camada: Backend */}
          <text x={10} y={215} fontSize={10} fill="#9ca3af" fontWeight="600">BACKEND</text>
          {box(10, 220, 540, 65, '#1a3f6f', 'FastAPI 0.136 (Python)', 'Vercel Serverless · backend-git-main.vercel.app · /api/v1/*')}

          {/* Setas frontend → backend */}
          {arrow(140, 180, 140, 218, 'REST/JSON')}
          {arrow(360, 180, 360, 218, '')}
          {arrow(490, 180, 490, 218, '')}

          {/* Camada: Serviços */}
          <text x={10} y={320} fontSize={10} fill="#9ca3af" fontWeight="600">DADOS & SERVIÇOS EXTERNOS</text>
          {box(10, 328, 140, 55, '#c2620a', 'Neon PostgreSQL', 'Serverless · asyncpg')}
          {box(160, 328, 110, 55, '#6d28d9', 'Supabase', 'Storage · fotos')}
          {box(280, 328, 100, 55, '#0f7a4d', 'Gmail SMTP', 'Emails')}
          {box(390, 328, 100, 55, '#0d7490', 'VAPID', 'Web Push')}
          {box(500, 328, 90, 55, '#c2620a', 'BrasilAPI', 'CEP lookup')}
          {box(600, 328, 90, 55, '#1a3f6f', 'Nominatim', 'Geocoding')}
          {box(700, 328, 90, 55, '#dc2626', 'Snyk', 'Security')}

          {/* Setas backend → serviços */}
          {arrow(80, 285, 80, 326, 'SQL async')}
          {arrow(200, 285, 215, 326, 'upload')}
          {arrow(280, 285, 330, 326, 'email')}
          {arrow(360, 285, 440, 326, 'push')}
          {arrow(420, 285, 550, 326, 'HTTP')}
          {arrow(460, 285, 645, 326, 'HTTP')}

          {/* Camada: Segurança */}
          <text x={10} y={415} fontSize={10} fill="#9ca3af" fontWeight="600">SEGURANÇA & AUTH</text>
          {box(10, 423, 140, 50, '#dc2626', 'JWT HS256', 'Access 2h · Refresh 7d')}
          {box(160, 423, 100, 50, '#6d28d9', 'WebAuthn', 'Passkeys')}
          {box(270, 423, 110, 50, '#c2620a', 'bcrypt', 'Senhas')}
          {box(390, 423, 120, 50, '#0f7a4d', 'Rate Limit', '10/min login')}
          {box(520, 423, 100, 50, '#0d7490', 'CSP / HSTS', 'Headers')}
          {box(630, 423, 100, 50, '#1a3f6f', 'Multi-tenant', 'assoc_id')}
          {box(740, 423, 70, 50, '#dc2626', 'Audit Log', 'Rastreio')}

          {/* Setas segurança */}
          {arrow(80, 473, 80, 495, '')}
          <text x={250} y={505} textAnchor="middle" fontSize={10} fill="#9ca3af">9 roles · permissões por módulo · soft delete · LGPD</text>
        </svg>
      </div>

      {/* Legenda */}
      <div className="flex flex-wrap gap-3 mt-3 text-[10px] text-gray-500">
        {[
          { color: '#0f7a4d', label: 'Financeiro' },
          { color: '#c2620a', label: 'Dados/Infra' },
          { color: '#6d28d9', label: 'Auth/Simplifica' },
          { color: '#1a3f6f', label: 'Core/Backend' },
          { color: '#0d7490', label: 'Comunicação' },
          { color: '#dc2626', label: 'Segurança' },
        ].map(l => (
          <span key={l.label} className="flex items-center gap-1">
            <span className="w-3 h-3 rounded-sm" style={{ backgroundColor: l.color, opacity: 0.7 }} />
            {l.label}
          </span>
        ))}
      </div>
    </div>
  )
}

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
  const [health, setHealth] = useState<HealthData | null>(null)
  const [loading, setLoading] = useState(false)
  const [countdown, setCountdown] = useState(AUTO_REFRESH_INTERVAL)
  const [activeTab, setActiveTab] = useState<'health' | 'perf' | 'db' | 'routes' | 'arch' | 'analytics'>('health')
  const [expandedTags, setExpandedTags] = useState<Set<string>>(new Set())
  const [searchRoute, setSearchRoute] = useState('')
  const [searchPerf, setSearchPerf] = useState('')
  const [sortPerf, setSortPerf] = useState<'avg_ms' | 'p95_ms' | 'requests' | 'errors'>('avg_ms')
  const [sortTable, setSortTable] = useState<'total_bytes' | 'row_estimate' | 'dead_rows' | 'name'>('total_bytes')
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const countRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const loadHealth = useCallback(async () => {
    try {
      const r = await api.get<HealthData>('/ti/health')
      setHealth(r.data)
    } catch { /* silent */ }
  }, [])

  const loadAll = useCallback(async () => {
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
  }, [])

  const refresh = useCallback(() => {
    loadHealth()
    loadAll()
    setCountdown(AUTO_REFRESH_INTERVAL)
  }, [loadHealth, loadAll])

  useEffect(() => {
    refresh()
    // Auto-refresh a cada N segundos
    timerRef.current = setInterval(refresh, AUTO_REFRESH_INTERVAL * 1000)
    // Countdown visual
    countRef.current = setInterval(() => setCountdown(c => c > 0 ? c - 1 : AUTO_REFRESH_INTERVAL), 1000)
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
      if (countRef.current) clearInterval(countRef.current)
    }
  }, [])

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
          <p className="text-xs text-gray-500">Saúde · Performance · Banco · Endpoints · Arquitetura</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-400 tabular-nums">
            Refresh em <span className="font-bold text-[#26619c]">{countdown}s</span>
          </span>
          <button onClick={refresh} disabled={loading}
            className="flex items-center gap-1.5 border border-gray-200 text-gray-600 px-3 py-1.5 rounded-xl text-sm hover:bg-gray-50 transition disabled:opacity-50">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Atualizar
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1 overflow-x-auto">
        {(['health','perf','db','routes','arch','analytics'] as const).map(tab => {
          const labels: Record<string,string> = { health: '🟢 Saúde', perf: '⚡ Performance', db: '🗄️ Banco', routes: '🌐 Endpoints', arch: '🏗️ Arquitetura', analytics: '📊 Analytics' }
          return (
            <button key={tab} onClick={() => setActiveTab(tab)}
              className={`flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold transition ${activeTab === tab ? 'bg-white text-[#26619c] shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
              {labels[tab]}
            </button>
          )
        })}
      </div>

      {/* ── TAB: SAÚDE ── */}
      {activeTab === 'health' && health && (
        <div className="flex flex-col gap-3">
          {/* Status geral */}
          <div className={`flex items-center gap-3 px-4 py-3 rounded-2xl border ${health.db.ok ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
            <div className={`w-3 h-3 rounded-full ${health.db.ok ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`} />
            <span className={`text-sm font-bold ${health.db.ok ? 'text-green-700' : 'text-red-700'}`}>
              {health.db.ok ? 'Sistema operacional' : 'Problema detectado no banco de dados'}
            </span>
            <span className="ml-auto text-xs text-gray-400">
              {new Date(health.timestamp).toLocaleTimeString('pt-BR')}
            </span>
          </div>

          {/* Cards de saúde */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div className="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm">
              <div className="flex items-center gap-2 mb-2">
                <Database className="w-4 h-4 text-[#26619c]" />
                <p className="text-xs font-semibold text-gray-600">Banco de Dados</p>
              </div>
              <p className={`text-2xl font-bold tabular-nums ${health.db.ping_ms < 100 ? 'text-green-600' : health.db.ping_ms < 300 ? 'text-amber-600' : 'text-red-600'}`}>
                {fmtMs(health.db.ping_ms)}
              </p>
              <p className="text-[10px] text-gray-400 mt-0.5">Ping · Tamanho: {health.db.size}</p>
            </div>

            <div className="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm">
              <div className="flex items-center gap-2 mb-2">
                <Activity className="w-4 h-4 text-[#26619c]" />
                <p className="text-xs font-semibold text-gray-600">API (última hora)</p>
              </div>
              <p className="text-2xl font-bold text-gray-800 tabular-nums">{health.api.requests_1h}</p>
              <p className="text-[10px] text-gray-400 mt-0.5">
                Média: {fmtMs(health.api.avg_ms)} ·
                <span className={health.api.errors_1h > 0 ? ' text-red-500 font-semibold' : ' text-green-600'}> {health.api.errors_1h} erros</span>
              </p>
            </div>

            <div className="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm">
              <div className="flex items-center gap-2 mb-2">
                <Wallet className="w-4 h-4 text-[#26619c]" />
                <p className="text-xs font-semibold text-gray-600">Caixas Abertos</p>
              </div>
              <p className={`text-2xl font-bold tabular-nums ${health.business.open_cash_sessions > 0 ? 'text-emerald-600' : 'text-gray-400'}`}>
                {health.business.open_cash_sessions}
              </p>
              <p className="text-[10px] text-gray-400 mt-0.5">sessões ativas agora</p>
            </div>

            <div className="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm">
              <div className="flex items-center gap-2 mb-2">
                <Users className="w-4 h-4 text-[#26619c]" />
                <p className="text-xs font-semibold text-gray-600">Moradores Ativos</p>
              </div>
              <p className="text-2xl font-bold text-gray-800 tabular-nums">{health.business.active_residents}</p>
              <p className="text-[10px] text-gray-400 mt-0.5">status = active</p>
            </div>

            <div className="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm">
              <div className="flex items-center gap-2 mb-2">
                <Package className="w-4 h-4 text-[#26619c]" />
                <p className="text-xs font-semibold text-gray-600">Encomendas Pendentes</p>
              </div>
              <p className={`text-2xl font-bold tabular-nums ${health.business.pending_packages > 0 ? 'text-amber-600' : 'text-green-600'}`}>
                {health.business.pending_packages}
              </p>
              <p className="text-[10px] text-gray-400 mt-0.5">aguardando retirada</p>
            </div>

            {db && (
              <div className="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm">
                <div className="flex items-center gap-2 mb-2">
                  <Heart className="w-4 h-4 text-[#26619c]" />
                  <p className="text-xs font-semibold text-gray-600">Cache do Banco</p>
                </div>
                <p className={`text-2xl font-bold tabular-nums ${db.cache.hit_pct >= 95 ? 'text-green-600' : db.cache.hit_pct >= 80 ? 'text-amber-600' : 'text-red-600'}`}>
                  {db.cache.hit_pct}%
                </p>
                <p className="text-[10px] text-gray-400 mt-0.5">hit ratio · ideal ≥ 95%</p>
              </div>
            )}
          </div>

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
        </div>
      )}

      {/* ── TAB: DB (cards de resumo legacy + tabelas) ── */}
      {(activeTab === 'db' || activeTab === 'perf') && db && (
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

      {/* ── TAB: PERFORMANCE ── */}
      {activeTab === 'perf' && (<>
      {/* PERFORMANCE */}
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
                    <td className={`px-3 py-2 text-right text-sm tabular-nums font-semibold ${perfColor(r.avg_ms)}`}>{fmtMs(r.avg_ms)}</td>
                    <td className="px-3 py-2 text-right text-xs text-gray-500 tabular-nums">{fmtMs(r.p95_ms)}</td>
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

      </>)}
      {/* ── TAB: BANCO ── */}
      {activeTab === 'db' && db && (
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

      {/* ── TAB: ENDPOINTS ── */}
      {activeTab === 'routes' && <Section title="Endpoints registrados" icon={Globe} count={routes.length} defaultOpen={true}>
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
      </Section>}

      {/* ── TAB: ARQUITETURA ── */}
      {activeTab === 'arch' && <ArchDiagram />}
      {activeTab === 'analytics' && <AnalyticsPanel />}

    </div>
  )
}
