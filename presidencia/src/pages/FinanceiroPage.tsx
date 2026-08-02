import { useState } from 'react'
import { Wallet, TrendDown, PiggyBank, Warning, ArrowsClockwise, WarningCircle } from '@phosphor-icons/react'
import { getFinanceiro } from '../lib/api'
import { StatTile } from '../components/StatTile'
import { DataTable } from '../components/DataTable'
import { usePresidenciaData } from '../lib/usePresidenciaData'

function formatBRL(v: number): string {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

export function FinanceiroPage() {
  const { data, freshness, error, loading } = usePresidenciaData(getFinanceiro)
  const [mostrarQuebras, setMostrarQuebras] = useState(false)

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
        <StatTile
          label="Faturamento"
          value={formatBRL(data.receita_total)}
          hint={`despesa: ${formatBRL(data.despesa_total)}`}
          icon={<Wallet size={16} className="text-marque-500" />}
        />
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

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
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
      </div>
    </div>
  )
}
