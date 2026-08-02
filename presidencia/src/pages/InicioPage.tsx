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

  function anteriorLabel(anterior: number | null, formatter: (v: number) => string = String): string | undefined {
    if (anterior === null) return undefined
    return `${periodoLabelCurto} anterior: ${formatter(anterior)}`
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
          legenda="Soma de tudo que entrou (mensalidade, taxa de entrega, comprovante de residência, outras) no período selecionado."
          hint={`vs ${periodoLabelCurto} anterior`}
          delta={{ pct: pctDelta(data.financeiro.receita_mes_atual, data.financeiro.receita_mes_anterior), anteriorLabel: anteriorLabel(data.financeiro.receita_mes_anterior, formatBRL) }}
          breakdown={breakdownFor('receita', formatBRL)}
          icon={<Wallet size={16} className="text-marque-500" />}
        />
        <StatTile
          label="Taxa de cobrança"
          value={data.financeiro.taxa_cobranca !== null ? `${data.financeiro.taxa_cobranca}%` : '—'}
          legenda="De tudo que foi gerado (mensalidades) no período, quanto % já foi pago."
          hint={`vs ${periodoLabelCurto} anterior`}
          delta={{ pct: pctDelta(data.financeiro.taxa_cobranca, data.financeiro.taxa_cobranca_anterior), anteriorLabel: anteriorLabel(data.financeiro.taxa_cobranca_anterior, (v) => `${v}%`) }}
          breakdown={breakdownFor('taxa_cobranca', (v) => `${v}%`)}
          icon={<Percent size={16} className="text-marque-500" />}
        />
        <StatTile
          label="Inadimplência"
          value={formatBRL(data.financeiro.total_inadimplente)}
          legenda="Quanto está em aberto (não pago) neste exato momento, considerando quem já passou do prazo de tolerância (2 dias). Não é escopado por período: é sempre o total atual."
          hint="valor em aberto neste momento"
          badge="agora"
          breakdown={breakdownFor('total_inadimplente', formatBRL)}
          icon={<Warning size={16} className="text-marque-500" />}
        />
        <StatTile
          label="Mensalidades pagas"
          value={String(data.financeiro.mensalidades_pagas)}
          legenda="Quantidade de mensalidades geradas no período selecionado que já foram pagas."
          hint={`no ${periodoLabelCurto}`}
          delta={{ pct: pctDelta(data.financeiro.mensalidades_pagas, data.financeiro.mensalidades_pagas_anterior), anteriorLabel: anteriorLabel(data.financeiro.mensalidades_pagas_anterior) }}
          breakdown={breakdownFor('mensalidades_pagas')}
          icon={<CheckCircle size={16} className="text-marque-500" />}
        />
        <StatTile
          label="Mensalidades vencidas"
          value={String(data.financeiro.mensalidades_vencidas)}
          legenda="Quantidade de mensalidades do período que não foram pagas e já passaram do prazo de tolerância (2 dias)."
          hint={`no ${periodoLabelCurto}`}
          delta={{ pct: pctDelta(data.financeiro.mensalidades_vencidas, data.financeiro.mensalidades_vencidas_anterior), positiveIsGood: false, anteriorLabel: anteriorLabel(data.financeiro.mensalidades_vencidas_anterior) }}
          breakdown={breakdownFor('mensalidades_vencidas')}
          icon={<Clock size={16} className="text-marque-500" />}
        />
        <StatTile
          label="Taxa de retenção"
          value={data.financeiro.taxa_retencao !== null ? `${data.financeiro.taxa_retencao}%` : '—'}
          legenda="Mensalidades pagas ÷ (pagas + vencidas) do período. Mede quanto do que já venceu ou foi cobrado efetivamente foi honrado."
          hint={`vs ${periodoLabelCurto} anterior`}
          delta={{ pct: pctDelta(data.financeiro.taxa_retencao, data.financeiro.taxa_retencao_anterior), anteriorLabel: anteriorLabel(data.financeiro.taxa_retencao_anterior, (v) => `${v}%`) }}
          breakdown={breakdownFor('taxa_retencao', (v) => `${v}%`)}
          icon={<Percent size={16} className="text-marque-500" />}
        />
        <StatTile
          label="Moradores ativos"
          value={String(data.moradores.total)}
          legenda="Total de pessoas cadastradas ativas agora (associados + dependentes + visitantes). Snapshot do momento, não varia por período."
          hint={`${data.moradores.associados} associados · ${data.moradores.dependentes} dependentes · ${data.moradores.visitantes} visitantes`}
          badge="agora"
          breakdown={breakdownFor('moradores_total')}
          icon={<Users size={16} className="text-marque-500" />}
        />
        <StatTile
          label="Pacotes recebidos"
          value={String(data.pacotes_os.pacotes_recebidos)}
          legenda="Quantidade de encomendas recebidas no período selecionado."
          hint={data.pacotes_os.tempo_medio_entrega_dias !== null ? `${data.pacotes_os.tempo_medio_entrega_dias} dias até retirada, em média` : `vs ${periodoLabelCurto} anterior`}
          delta={{ pct: pctDelta(data.pacotes_os.pacotes_recebidos, data.pacotes_os.pacotes_recebidos_anterior), anteriorLabel: anteriorLabel(data.pacotes_os.pacotes_recebidos_anterior) }}
          breakdown={breakdownFor('pacotes_recebidos')}
          icon={<Package size={16} className="text-marque-500" />}
        />
        <StatTile
          label="Ordens de serviço"
          value={`${Number(data.pacotes_os.os_fechadas) + Number(data.pacotes_os.os_abertas) > 0 ? `${data.pacotes_os.os_fechadas}/${Number(data.pacotes_os.os_abertas) + Number(data.pacotes_os.os_fechadas)}` : '0/0'}`}
          legenda="Fechadas / total de ordens de serviço abertas no período selecionado."
          hint={`fechadas / total · vs ${periodoLabelCurto} anterior`}
          delta={{ pct: pctDelta(data.pacotes_os.os_fechadas, data.pacotes_os.os_fechadas_anterior), anteriorLabel: anteriorLabel(data.pacotes_os.os_fechadas_anterior) }}
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
