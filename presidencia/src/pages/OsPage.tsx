import { Wrench, CheckCircle, Hourglass } from '@phosphor-icons/react'
import { getOs } from '../lib/api'
import { StatTile } from '../components/StatTile'
import { DataTable } from '../components/DataTable'
import { usePresidenciaData } from '../lib/usePresidenciaData'

export function OsPage() {
  const { data, freshness, error, loading } = usePresidenciaData(getOs)

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
          label="Abertas"
          value={String(data.abertas)}
          icon={<Wrench size={16} className="text-marque-500" />}
        />
        <StatTile
          label="Fechadas"
          value={String(data.fechadas)}
          icon={<CheckCircle size={16} className="text-marque-500" />}
        />
        <StatTile
          label="Pendentes"
          value={String(data.pendentes)}
          badge="agora"
          icon={<Hourglass size={16} className="text-marque-500" />}
        />
      </div>

      <DataTable
        title="SLA por tipo de morador"
        rows={data.sla_por_tipo}
        keyFn={(r) => r.tipo}
        columns={[
          { header: 'Tipo', render: (r) => r.tipo },
          { header: 'Entregues', align: 'right', render: (r) => r.entregues },
          { header: 'Espera média (h)', align: 'right', render: (r) => r.media_horas_espera ?? '—' },
        ]}
      />
    </div>
  )
}
