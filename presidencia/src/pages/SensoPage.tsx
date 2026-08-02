import { MapTrifold, Bug, WifiSlash, Warning } from '@phosphor-icons/react'
import { getSenso } from '../lib/api'
import { StatTile } from '../components/StatTile'
import { DataTable } from '../components/DataTable'
import { usePresidenciaData } from '../lib/usePresidenciaData'

export function SensoPage() {
  const { data, freshness, error, loading } = usePresidenciaData(getSenso)

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
          label="Moradores censados"
          value={String(data.total_moradores)}
          badge="agora"
          icon={<MapTrifold size={16} className="text-marque-500" />}
        />
        <StatTile
          label="Com pragas"
          value={String(data.com_pragas)}
          badge="agora"
          icon={<Bug size={16} className="text-marque-500" />}
        />
        <StatTile
          label="Sem internet"
          value={String(data.sem_internet)}
          badge="agora"
          icon={<WifiSlash size={16} className="text-marque-500" />}
        />
        <StatTile
          label="Com problemas relatados"
          value={String(data.com_problemas)}
          badge="agora"
          icon={<Warning size={16} className="text-marque-500" />}
        />
      </div>

      <DataTable
        title="Perfil por rua"
        rows={data.por_rua}
        keyFn={(r) => r.rua}
        columns={[
          { header: 'Rua', render: (r) => r.rua },
          { header: 'Total', align: 'right', render: (r) => r.total },
          { header: 'Associados', align: 'right', render: (r) => r.associados },
          { header: 'Com pragas', align: 'right', render: (r) => r.com_pragas },
          { header: 'Sem internet', align: 'right', render: (r) => r.sem_internet },
          { header: 'Com problemas', align: 'right', render: (r) => r.com_problemas },
        ]}
      />
    </div>
  )
}
