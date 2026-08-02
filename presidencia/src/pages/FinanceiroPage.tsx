import { useMemo, useState } from 'react'
import { TrendDown, PiggyBank, Warning, ArrowsClockwise, WarningCircle } from '@phosphor-icons/react'
import { getFinanceiro } from '../lib/api'
import { StatTile } from '../components/StatTile'
import { DataTable } from '../components/DataTable'
import { SegmentedProgressBar } from '../components/SegmentedProgressBar'
import { HorizontalBarRanked } from '../components/HorizontalBarRanked'
import { FaturamentoChart } from '../components/FaturamentoChart'
import { MultiSeriesArea } from '../components/MultiSeriesArea'
import { HeatmapCalendar } from '../components/HeatmapCalendar'
import { usePresidenciaData } from '../lib/usePresidenciaData'
import { usePeriodo } from '../lib/PeriodoContext'
import { labelForNomeAssociacao } from '../lib/unidade'

function formatBRL(v: number): string {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

export function FinanceiroPage() {
  const { data, freshness, error, loading } = usePresidenciaData(getFinanceiro)
  const { periodo } = usePeriodo()
  const [mostrarQuebras, setMostrarQuebras] = useState(false)

  const receitaPorTipo = useMemo(() => {
    if (!data) return []
    const totais = data.serie_diaria.reduce(
      (acc, d) => {
        acc.mensalidade += d.mensalidade
        acc.taxa_entrega += d.taxa_entrega
        acc.comprovante_residencia += d.comprovante_residencia
        acc.outras_receitas += d.outras_receitas
        return acc
      },
      { mensalidade: 0, taxa_entrega: 0, comprovante_residencia: 0, outras_receitas: 0 },
    )
    return [
      { label: 'Mensalidade', value: totais.mensalidade },
      { label: 'Taxa de entrega', value: totais.taxa_entrega },
      { label: 'Comprovante de residência', value: totais.comprovante_residencia },
      { label: 'Outras', value: totais.outras_receitas },
    ].sort((a, b) => b.value - a.value)
  }, [data])

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

      <FaturamentoChart
        serie={data.serie_diaria.map((d) => ({ data: d.data, receita_total: d.receita_total }))}
        totalPeriodo={data.receita_total}
        totalAnterior={data.receita_total_anterior}
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <StatTile
          label="Resultado líquido"
          value={formatBRL(data.saldo_liquido)}
          legenda="Receita menos despesa do período. Pode ficar negativo."
          hint={data.margem_pct !== null ? `margem: ${data.margem_pct}%` : undefined}
          icon={<TrendDown size={16} className="text-marque-500" />}
        />
        <StatTile
          label="Runway"
          value={data.runway_semanas !== null ? `${data.runway_semanas.toFixed(1)} semanas` : '—'}
          legenda="Quantas semanas o saldo em caixa atual sustenta no ritmo médio de despesa. Snapshot atual, não é escopado por período."
          hint={`saldo em caixa: ${formatBRL(data.saldo_caixa)}`}
          badge="agora"
          icon={<PiggyBank size={16} className="text-marque-500" />}
        />
        <StatTile
          label="Inadimplência"
          value={formatBRL(data.total_inadimplente)}
          hint={`${data.qtd_inadimplentes} mensalidades em aberto`}
          badge="agora"
          icon={<Warning size={16} className="text-marque-500" />}
        />
        <StatTile
          label="Taxa de recuperação"
          value={data.recuperacao.taxa_recuperacao_pct !== null ? `${data.recuperacao.taxa_recuperacao_pct}%` : '—'}
          legenda="De tudo que já venceu, quanto acabou sendo pago (mesmo que atrasado)."
          hint={`recuperado: ${formatBRL(data.recuperacao.valor_recuperada)} · nunca recuperado: ${formatBRL(data.recuperacao.valor_nunca_recuperada)}`}
          badge="agora"
          icon={<ArrowsClockwise size={16} className="text-marque-500" />}
        />
        <StatTile
          label="Quebras de caixa"
          value={String(data.quebras_caixa.com_quebra)}
          legenda="Sessões de caixa com diferença entre o valor esperado e o contado. Clique para ver o detalhe por operador/semana."
          hint={`valor total: ${formatBRL(data.quebras_caixa.valor_total)} · clique para detalhar`}
          badge="agora"
          icon={<WarningCircle size={16} className="text-marque-500" />}
          onClick={() => setMostrarQuebras((v) => !v)}
        />
        <SegmentedProgressBar
          label="Margem líquida"
          pct={data.margem_pct}
          legenda="Resultado líquido dividido pelo faturamento do período."
        />
      </div>

      {mostrarQuebras && (
        <DataTable
          title="Quebras de caixa — detalhe por operador/semana"
          rows={data.quebras_caixa.detalhe}
          keyFn={(r, i) => `${r.operador}-${r.semana}-${i}`}
          emptyLabel="Nenhuma quebra registrada"
          columns={[
            { header: 'Semana', render: (r) => r.semana ?? '—' },
            { header: 'Operador', render: (r) => r.operador },
            { header: 'Associação', render: (r) => r.associacao },
            { header: 'Sessões', align: 'right', render: (r) => r.total_sessoes },
            { header: 'Com quebra', align: 'right', render: (r) => r.com_quebra },
            { header: 'Valor quebra', align: 'right', render: (r) => formatBRL(r.valor_quebra) },
            { header: 'Valor diferença', align: 'right', render: (r) => formatBRL(r.valor_diferenca) },
          ]}
        />
      )}

      <div className="rounded-xl border border-border bg-surface p-4">
        <h2 className="mb-3 text-sm font-semibold text-ink">Comparativo Vaz Lobo × Congonha</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {data.comparativo_unidades.map((u) => (
            <div key={u.nome_associacao} className="rounded-lg border border-border p-3">
              <div className="mb-2 text-sm font-medium text-ink">{labelForNomeAssociacao(u.nome_associacao)}</div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div><span className="text-ink-muted">Faturamento</span><div className="font-semibold text-ink">{formatBRL(u.receita_total)}</div></div>
                <div><span className="text-ink-muted">Despesa</span><div className="font-semibold text-ink">{formatBRL(u.despesa_total)}</div></div>
                <div><span className="text-ink-muted">Resultado</span><div className="font-semibold text-ink">{formatBRL(u.saldo_liquido)}</div></div>
                <div><span className="text-ink-muted">Margem</span><div className="font-semibold text-ink">{u.margem_pct !== null ? `${u.margem_pct}%` : '—'}</div></div>
                <div><span className="text-ink-muted">Taxa de cobrança</span><div className="font-semibold text-ink">{u.taxa_cobranca_pct !== null ? `${u.taxa_cobranca_pct}%` : '—'}</div></div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <MultiSeriesArea serie={data.serie_diaria} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <HorizontalBarRanked title="Receita por tipo (total do período)" items={receitaPorTipo} formatter={formatBRL} />
        <DataTable
          title="Receita por rua"
          rows={data.receita_por_rua}
          keyFn={(r) => r.rua}
          columns={[
            { header: 'Rua', render: (r) => r.rua },
            { header: 'Receita', align: 'right', render: (r) => formatBRL(r.receita_total) },
            { header: 'Transações', align: 'right', render: (r) => r.qtd_transacoes },
          ]}
        />
      </div>

      <HeatmapCalendar
        serie={data.serie_diaria.map((d) => ({ data: d.data, valor: d.receita_total }))}
        periodo={periodo}
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <DataTable
          title="Inadimplência por pessoa"
          rows={data.inadimplentes}
          keyFn={(r, i) => `${r.nome}-${i}`}
          columns={[
            { header: 'Nome', render: (r) => r.nome },
            { header: 'Meses de atraso', align: 'right', render: (r) => r.meses_atraso },
            { header: 'Valor devido', align: 'right', render: (r) => formatBRL(r.valor_devido) },
          ]}
        />
        <DataTable
          title="Aging de inadimplência"
          rows={data.aging}
          keyFn={(r) => r.faixa}
          columns={[
            { header: 'Faixa', render: (r) => `${r.faixa} dias` },
            { header: 'Qtd', align: 'right', render: (r) => r.qtd },
            { header: 'Valor', align: 'right', render: (r) => formatBRL(r.valor) },
          ]}
        />
      </div>

      <DataTable
        title="Motivos de sangria"
        rows={data.motivos_sangria}
        keyFn={(r) => r.motivo}
        columns={[
          { header: 'Motivo', render: (r) => r.motivo },
          { header: 'Ocorrências', align: 'right', render: (r) => r.ocorrencias },
          { header: 'Valor', align: 'right', render: (r) => formatBRL(r.valor) },
        ]}
      />

      <DataTable
        title="Detalhe dia × produto"
        rows={[...data.serie_diaria].reverse()}
        keyFn={(r) => r.data}
        columns={[
          { header: 'Data', render: (r) => new Date(r.data + 'T00:00:00').toLocaleDateString('pt-BR') },
          { header: 'Mensalidade', align: 'right', render: (r) => formatBRL(r.mensalidade) },
          { header: 'Taxa de entrega', align: 'right', render: (r) => formatBRL(r.taxa_entrega) },
          { header: 'Comprovante residência', align: 'right', render: (r) => formatBRL(r.comprovante_residencia) },
          { header: 'Outras', align: 'right', render: (r) => formatBRL(r.outras_receitas) },
          { header: 'Total', align: 'right', render: (r) => formatBRL(r.receita_total) },
        ]}
      />
    </div>
  )
}
