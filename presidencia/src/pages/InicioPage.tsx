import { useEffect, useState } from 'react'
import { Wallet, Percent, Warning, Users, Package, Wrench, CheckCircle, Clock } from '@phosphor-icons/react'
import { getInicio, type FreshnessInfo, type InicioData } from '../lib/api'
import { StatTile } from '../components/StatTile'
import { useUnidade } from '../lib/UnidadeContext'
import { nomeAssociacaoFor, labelForNomeAssociacao } from '../lib/unidade'
import { usePeriodo } from '../lib/PeriodoContext'
import { PERIODOS } from '../lib/periodo'
import { takeInicioCache } from '../lib/prefetchCache'

function formatBRL(v: number): string {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function pctDelta(atual: number | null, anterior: number | null): number | null {
  if (atual === null || anterior === null || anterior === 0) return null
  return ((atual - anterior) / anterior) * 100
}

export function InicioPage() {
  const [data, setData] = useState<InicioData | null>(null)
  const [freshness, setFreshness] = useState<FreshnessInfo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const { unidade } = useUnidade()
  const { periodo, ate, isAtual } = usePeriodo()

  useEffect(() => {
    const cached = takeInicioCache()
    if (cached && unidade === 'todos' && periodo === 'mes' && isAtual) {
      setData(cached.data)
      setFreshness({ generated_at: cached.generated_at, stale: cached.stale })
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    getInicio(nomeAssociacaoFor(unidade), periodo, ate)
      .then((res) => {
        if (cancelled) return
        setData(res.data)
        setFreshness({ generated_at: res.generated_at, stale: res.stale })
      })
      .catch((err) => {
        if (cancelled) return
        const status = err?.response?.status
        const detail = err?.response?.data?.detail
        setError(
          status
            ? `Erro ${status}${detail ? `: ${detail}` : ''}`
            : `Falha de rede: ${err?.message ?? 'desconhecida'}`,
        )
      })
      .finally(() => !cancelled && setLoading(false))
    return () => { cancelled = true }
  }, [unidade, periodo, ate])

  if (loading) return <p className="text-sm text-ink-muted">Carregando...</p>
  if (error) return <p className="rounded bg-red-100 px-3 py-2 text-sm text-red-700">{error}</p>
  if (!data) return null

  const periodoLabelCurto = PERIODOS.find((p) => p.key === periodo)?.label.toLowerCase() ?? 'período'

  function breakdownFor(campo: 'receita' | 'taxa_cobranca' | 'total_inadimplente' | 'pacotes_recebidos' | 'os_fechadas' | 'moradores_total' | 'mensalidades_pagas' | 'mensalidades_vencidas' | 'taxa_retencao', formatter: (v: number) => string = String) {
    if (!data!.por_unidade) return undefined
    return Object.entries(data!.por_unidade).map(([nome, metricas]) => {
      const v = metricas[campo]
      return { label: labelForNomeAssociacao(nome), value: v != null ? formatter(v) : '—' }
    })
  }

  return (
    <div className="space-y-4">
      {freshness?.stale && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Dado pode estar desatualizado — última carga: {freshness.generated_at ? new Date(freshness.generated_at).toLocaleString('pt-BR') : 'nunca'}.
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <StatTile
          label="Receita"
          value={formatBRL(data.financeiro.receita_mes_atual)}
          hint={`vs ${periodoLabelCurto} anterior`}
          delta={{ pct: pctDelta(data.financeiro.receita_mes_atual, data.financeiro.receita_mes_anterior) }}
          breakdown={breakdownFor('receita', formatBRL)}
          icon={<Wallet size={16} className="text-marque-500" />}
        />
        <StatTile
          label="Taxa de cobrança"
          value={data.financeiro.taxa_cobranca !== null ? `${data.financeiro.taxa_cobranca}%` : '—'}
          hint={`vs ${periodoLabelCurto} anterior`}
          delta={{ pct: pctDelta(data.financeiro.taxa_cobranca, data.financeiro.taxa_cobranca_anterior) }}
          breakdown={breakdownFor('taxa_cobranca', (v) => `${v}%`)}
          icon={<Percent size={16} className="text-marque-500" />}
        />
        <StatTile
          label="Inadimplência"
          value={formatBRL(data.financeiro.total_inadimplente)}
          hint={`vencido no ${periodoLabelCurto} · vs anterior`}
          delta={{ pct: pctDelta(data.financeiro.total_inadimplente, data.financeiro.total_inadimplente_anterior), positiveIsGood: false }}
          breakdown={breakdownFor('total_inadimplente', formatBRL)}
          icon={<Warning size={16} className="text-marque-500" />}
        />
        <StatTile
          label="Mensalidades pagas"
          value={String(data.financeiro.mensalidades_pagas)}
          hint={`no ${periodoLabelCurto}`}
          breakdown={breakdownFor('mensalidades_pagas')}
          icon={<CheckCircle size={16} className="text-marque-500" />}
        />
        <StatTile
          label="Mensalidades vencidas"
          value={String(data.financeiro.mensalidades_vencidas)}
          hint={`no ${periodoLabelCurto}`}
          breakdown={breakdownFor('mensalidades_vencidas')}
          icon={<Clock size={16} className="text-marque-500" />}
        />
        <StatTile
          label="Taxa de retenção"
          value={data.financeiro.taxa_retencao !== null ? `${data.financeiro.taxa_retencao}%` : '—'}
          hint={`vs ${periodoLabelCurto} anterior`}
          delta={{ pct: pctDelta(data.financeiro.taxa_retencao, data.financeiro.taxa_retencao_anterior) }}
          breakdown={breakdownFor('taxa_retencao', (v) => `${v}%`)}
          icon={<Percent size={16} className="text-marque-500" />}
        />
        <StatTile
          label="Moradores ativos"
          value={String(data.moradores.total)}
          hint={`${data.moradores.associados} associados · ${data.moradores.dependentes} dependentes · ${data.moradores.visitantes} visitantes`}
          badge="agora"
          breakdown={breakdownFor('moradores_total')}
          icon={<Users size={16} className="text-marque-500" />}
        />
        <StatTile
          label="Pacotes recebidos"
          value={String(data.pacotes_os.pacotes_recebidos)}
          hint={data.pacotes_os.tempo_medio_entrega_dias !== null ? `${data.pacotes_os.tempo_medio_entrega_dias} dias até retirada, em média` : `vs ${periodoLabelCurto} anterior`}
          delta={{ pct: pctDelta(data.pacotes_os.pacotes_recebidos, data.pacotes_os.pacotes_recebidos_anterior) }}
          breakdown={breakdownFor('pacotes_recebidos')}
          icon={<Package size={16} className="text-marque-500" />}
        />
        <StatTile
          label="Ordens de serviço"
          value={`${data.pacotes_os.os_fechadas}/${data.pacotes_os.os_abertas + data.pacotes_os.os_fechadas}`}
          hint={`fechadas / total · vs ${periodoLabelCurto} anterior`}
          delta={{ pct: pctDelta(data.pacotes_os.os_fechadas, data.pacotes_os.os_fechadas_anterior) }}
          breakdown={breakdownFor('os_fechadas')}
          icon={<Wrench size={16} className="text-marque-500" />}
        />
      </div>

      {data.alertas.length > 0 && (
        <div className="rounded-xl border border-border bg-surface p-4">
          <h2 className="mb-2 text-sm font-semibold text-ink">Alertas</h2>
          <ul className="space-y-1">
            {data.alertas.map((a, i) => (
              <li key={i} className="flex items-center gap-2 text-sm text-ink-muted">
                <Warning size={14} className="text-marque-500" /> {a}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
