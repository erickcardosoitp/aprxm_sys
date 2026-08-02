import { Receipt, Percent, Warning, ArrowsClockwise, Handshake } from '@phosphor-icons/react'
import { getMensalidades } from '../lib/api'
import { StatTile } from '../components/StatTile'
import { DataTable } from '../components/DataTable'
import { usePresidenciaData } from '../lib/usePresidenciaData'

function formatBRL(v: number): string {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

export function MensalidadesPage() {
  const { data, freshness, error, loading } = usePresidenciaData(getMensalidades)

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
          label="Taxa de cobrança"
          value={data.taxa_cobranca_pct !== null ? `${data.taxa_cobranca_pct}%` : '—'}
          hint={`${data.pagas} pagas de ${data.total} geradas`}
          icon={<Percent size={16} className="text-marque-500" />}
        />
        <StatTile
          label="Vencidas"
          value={String(data.vencidas)}
          hint={`valor em aberto: ${formatBRL(data.valor_vencido)}`}
          icon={<Warning size={16} className="text-marque-500" />}
        />
        <StatTile
          label="Em acordo (parcelamento)"
          value={String(data.acordos)}
          legenda="Mensalidades cobertas por acordo de parcelamento — não contam como vencidas."
          icon={<Handshake size={16} className="text-marque-500" />}
        />
        <StatTile
          label="Taxa de recuperação"
          value={data.recuperacao.taxa_recuperacao_pct !== null ? `${data.recuperacao.taxa_recuperacao_pct}%` : '—'}
          legenda="De tudo que já venceu, quanto acabou sendo pago (mesmo que atrasado)."
          badge="agora"
          icon={<ArrowsClockwise size={16} className="text-marque-500" />}
        />
        <StatTile
          label="Recuperado"
          value={formatBRL(data.recuperacao.valor_recuperada)}
          badge="agora"
          icon={<Receipt size={16} className="text-marque-500" />}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <DataTable
          title="Maiores devedores"
          rows={data.devedores}
          keyFn={(r, i) => `${r.nome}-${i}`}
          columns={[
            { header: 'Nome', render: (r) => r.nome },
            { header: 'Rua', render: (r) => r.rua },
            { header: 'Meses de atraso', align: 'right', render: (r) => r.meses_atraso },
            { header: 'Valor devido', align: 'right', render: (r) => formatBRL(r.valor_devido) },
          ]}
        />
        <DataTable
          title="Cobrança por rua"
          rows={data.por_rua}
          keyFn={(r) => r.rua}
          columns={[
            { header: 'Rua', render: (r) => r.rua },
            { header: 'Total', align: 'right', render: (r) => r.total },
            { header: 'Pagas', align: 'right', render: (r) => r.pagas },
            { header: 'Vencidas', align: 'right', render: (r) => r.vencidas },
          ]}
        />
      </div>
    </div>
  )
}
