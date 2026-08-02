import { Package, Clock, WarningCircle } from '@phosphor-icons/react'
import { getPacotes } from '../lib/api'
import { StatTile } from '../components/StatTile'
import { DataTable } from '../components/DataTable'
import { usePresidenciaData } from '../lib/usePresidenciaData'

export function PacotesPage() {
  const { data, freshness, error, loading } = usePresidenciaData(getPacotes)

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
          label="Recebidos"
          value={String(data.recebidos)}
          hint={`${data.entregues} entregues · ${data.devolvidos} devolvidos`}
          icon={<Package size={16} className="text-marque-500" />}
        />
        <StatTile
          label="Tempo médio até retirada"
          value={data.tempo_medio_dias !== null ? `${data.tempo_medio_dias} dias` : '—'}
          icon={<Clock size={16} className="text-marque-500" />}
        />
        <StatTile
          label="Parados"
          value={`${data.paradas_3d} / ${data.paradas_7d}`}
          legenda="Encomendas paradas há mais de 3 dias / 7 dias."
          hint="3 dias / 7 dias"
          badge="agora"
          icon={<WarningCircle size={16} className="text-marque-500" />}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <DataTable
          title="Ranking de moradores"
          rows={data.ranking_moradores}
          keyFn={(r, i) => `${r.nome}-${i}`}
          columns={[
            { header: 'Nome', render: (r) => r.nome },
            { header: 'Rua', render: (r) => r.rua },
            { header: 'Total', align: 'right', render: (r) => r.total },
            { header: 'Pendentes agora', align: 'right', render: (r) => r.pendentes_agora },
          ]}
        />
        <DataTable
          title="Por rua"
          rows={data.por_rua}
          keyFn={(r) => r.rua}
          columns={[
            { header: 'Rua', render: (r) => r.rua },
            { header: 'Total', align: 'right', render: (r) => r.total },
            { header: 'Moradores distintos', align: 'right', render: (r) => r.moradores_distintos },
            { header: 'Espera média (h)', align: 'right', render: (r) => r.media_espera_horas ?? '—' },
          ]}
        />
      </div>
    </div>
  )
}
