import { useEffect, useState } from 'react'
import {
  Wallet, Package, TrendUp, Clock, Percent, Warning, Users, Wrench, UsersThree,
  ArrowUp, ArrowDown,
} from '@phosphor-icons/react'
import { getResumo, type FreshnessInfo, type KpiWow, type ResumoData } from '../lib/api'
import { MiniTrendChart } from '../components/MiniTrendChart'
import { useUnidade } from '../lib/UnidadeContext'
import { nomeAssociacaoFor } from '../lib/unidade'
import { usePeriodo } from '../lib/PeriodoContext'

function formatBRL(v: number): string {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })
}

interface KpiDef {
  key: keyof ResumoData
  label: string
  icon: React.ReactNode
  formatter: (v: number) => string
  positiveIsGood: boolean
}

const KPIS: KpiDef[] = [
  { key: 'receita_liquida', label: 'Faturamento', icon: <Wallet size={16} className="text-marque-500" />, formatter: formatBRL, positiveIsGood: true },
  { key: 'encomendas', label: 'Encomendas recebidas', icon: <Package size={16} className="text-marque-500" />, formatter: (v) => String(Math.round(v)), positiveIsGood: true },
  { key: 'crescimento', label: 'Crescimento de associados', icon: <TrendUp size={16} className="text-marque-500" />, formatter: (v) => String(Math.round(v)), positiveIsGood: true },
  { key: 'tempo_entrega', label: 'Tempo médio de entrega (dias)', icon: <Clock size={16} className="text-marque-500" />, formatter: (v) => v.toFixed(1), positiveIsGood: false },
  { key: 'taxa_cobranca', label: 'Taxa de cobrança', icon: <Percent size={16} className="text-marque-500" />, formatter: (v) => `${v.toFixed(1)}%`, positiveIsGood: true },
  { key: 'inadimplencia', label: '% de inadimplência', icon: <Warning size={16} className="text-marque-500" />, formatter: (v) => `${v.toFixed(1)}%`, positiveIsGood: false },
  { key: 'retencao', label: 'Taxa de retenção', icon: <Users size={16} className="text-marque-500" />, formatter: (v) => `${v.toFixed(1)}%`, positiveIsGood: true },
  { key: 'tarefas_no_prazo', label: 'Tarefas concluídas no prazo', icon: <Wrench size={16} className="text-marque-500" />, formatter: (v) => `${v.toFixed(1)}%`, positiveIsGood: true },
  { key: 'score_operadores', label: 'Score médio de operadores', icon: <UsersThree size={16} className="text-marque-500" />, formatter: (v) => v.toFixed(1), positiveIsGood: true },
]

function KpiCard({ def, kpi }: { def: KpiDef; kpi: KpiWow }) {
  const delta = kpi.mom_pct
  const hasDelta = delta !== null && delta !== undefined
  const isUp = hasDelta && delta >= 0
  const isGood = hasDelta && (def.positiveIsGood ? isUp : !isUp)

  return (
    <div className="rounded-lg border border-border bg-surface p-3 transition-all duration-200 hover:-translate-y-0.5 hover:border-marque-300 hover:shadow-md">
      <div className="flex items-center justify-between">
        <span className="text-xs text-ink-muted">{def.label}</span>
        {def.icon}
      </div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="text-xl font-semibold text-ink">{def.formatter(kpi.atual)}</span>
        {hasDelta && (
          <span className={`flex items-center gap-0.5 text-[11px] font-medium ${isGood ? 'text-emerald-600' : 'text-red-500'}`}>
            {isUp ? <ArrowUp size={11} weight="bold" /> : <ArrowDown size={11} weight="bold" />}
            {Math.abs(delta).toFixed(1)}%
          </span>
        )}
      </div>
      <div className="mt-1 text-[11px] text-ink-muted">
        vs mês anterior: {def.formatter(kpi.anterior)}
      </div>
      <div className="mt-2">
        <MiniTrendChart data={kpi.serie} height={88} valueFormatter={def.formatter} showDataLabels />
      </div>
    </div>
  )
}

export function ResumoPage() {
  const [data, setData] = useState<ResumoData | null>(null)
  const [freshness, setFreshness] = useState<FreshnessInfo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const { unidade } = useUnidade()
  const { periodo } = usePeriodo()

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    getResumo(nomeAssociacaoFor(unidade), periodo)
      .then((res) => {
        if (cancelled) return
        setData(res.data)
        setFreshness({ generated_at: res.generated_at, stale: res.stale })
      })
      .catch((err) => {
        if (cancelled) return
        const status = err?.response?.status
        const detail = err?.response?.data?.detail
        setError(status ? `Erro ${status}${detail ? `: ${detail}` : ''}` : `Falha de rede: ${err?.message ?? 'desconhecida'}`)
      })
      .finally(() => !cancelled && setLoading(false))
    return () => { cancelled = true }
  }, [unidade, periodo])

  if (loading) return <p className="text-sm text-ink-muted">Carregando...</p>
  if (error) return <p className="rounded bg-red-100 px-3 py-2 text-sm text-red-700">{error}</p>
  if (!data) return null

  return (
    <div className="space-y-4">
      {freshness?.stale && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Dado pode estar desatualizado — última carga: {freshness.generated_at ? new Date(freshness.generated_at).toLocaleString('pt-BR') : 'nunca'}.
        </div>
      )}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {KPIS.map((def) => (
          <KpiCard key={def.key} def={def} kpi={data[def.key]} />
        ))}
      </div>
    </div>
  )
}
