import { Users, UserPlus, WifiSlash, TrendUp } from '@phosphor-icons/react'
import { getMoradores } from '../lib/api'
import { StatTile } from '../components/StatTile'
import { DataTable } from '../components/DataTable'
import { MiniTrendChart } from '../components/MiniTrendChart'
import { usePresidenciaDataSemPeriodo } from '../lib/usePresidenciaData'

export function MoradoresPage() {
  const { data, freshness, error, loading } = usePresidenciaDataSemPeriodo(getMoradores)

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
          label="Moradores ativos"
          value={String(data.total)}
          hint={`${data.associados} associados · ${data.dependentes} dependentes · ${data.visitantes} visitantes`}
          badge="agora"
          icon={<Users size={16} className="text-marque-500" />}
        />
        <StatTile
          label="Novos no mês"
          value={String(data.novos_mes)}
          icon={<UserPlus size={16} className="text-marque-500" />}
        />
        <StatTile
          label="Sem internet"
          value={String(data.sem_internet)}
          legenda="Moradores que declararam não ter acesso à internet no cadastro."
          badge="agora"
          icon={<WifiSlash size={16} className="text-marque-500" />}
        />
      </div>

      <div className="rounded-lg border border-border bg-surface p-3">
        <div className="mb-2 flex items-center gap-1.5 text-xs text-ink-muted">
          <TrendUp size={14} className="text-marque-500" /> Crescimento de associados
        </div>
        <MiniTrendChart data={data.crescimento_serie} height={120} showDataLabels />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <DataTable
          title="Nunca pagaram nenhuma mensalidade"
          rows={data.churn}
          keyFn={(r, i) => `${r.nome}-${i}`}
          emptyLabel="Nenhum associado ativo sem pagamento nunca"
          columns={[
            { header: 'Nome', render: (r) => r.nome },
            { header: 'Associação', render: (r) => r.associacao },
          ]}
        />
        <DataTable
          title="Por rua"
          rows={data.por_rua}
          keyFn={(r) => r.rua}
          columns={[
            { header: 'Rua', render: (r) => r.rua },
            { header: 'Total', align: 'right', render: (r) => r.total },
            { header: 'Associados', align: 'right', render: (r) => r.associados },
            { header: 'Com problemas', align: 'right', render: (r) => r.com_problemas },
          ]}
        />
      </div>
    </div>
  )
}
