import { UsersThree, ChatCircleText } from '@phosphor-icons/react'
import { getOperadores } from '../lib/api'
import { StatTile } from '../components/StatTile'
import { DataTable } from '../components/DataTable'
import { usePresidenciaData } from '../lib/usePresidenciaData'

export function OperadoresPage() {
  const { data, freshness, error, loading } = usePresidenciaData(getOperadores)

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

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <StatTile
          label="Score médio"
          value={data.score_medio !== null ? data.score_medio.toFixed(1) : '—'}
          legenda="Base 100, -5 por estorno, -3 por tarefa em atraso, +0.5 por entrega (até +10)."
          icon={<UsersThree size={16} className="text-marque-500" />}
        />
        <StatTile
          label="Feedbacks recebidos"
          value={String(data.feedback.reduce((acc, f) => acc + f.qtd, 0))}
          icon={<ChatCircleText size={16} className="text-marque-500" />}
        />
      </div>

      <DataTable
        title="Ranking de operadores"
        rows={data.ranking}
        keyFn={(r, i) => `${r.nome}-${i}`}
        columns={[
          { header: 'Nome', render: (r) => r.nome },
          { header: 'Score', align: 'right', render: (r) => r.score ?? '—' },
          { header: 'Estornos', align: 'right', render: (r) => r.estornos },
          { header: 'Tarefas em atraso', align: 'right', render: (r) => r.tarefas_atraso },
          { header: 'Entregas', align: 'right', render: (r) => r.entregas },
        ]}
      />

      <DataTable
        title="Desempenho (sessões e encomendas)"
        rows={data.desempenho}
        keyFn={(r, i) => `${r.nome}-${i}`}
        columns={[
          { header: 'Nome', render: (r) => r.nome },
          { header: 'Sessões', align: 'right', render: (r) => r.sessoes },
          { header: 'Encomendas recebidas', align: 'right', render: (r) => r.encomendas_recebidas },
          { header: 'Encomendas entregues', align: 'right', render: (r) => r.encomendas_entregues },
        ]}
      />
    </div>
  )
}
