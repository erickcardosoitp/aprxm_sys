import { useEffect, useState } from 'react'
import { Wallet, Percent, Warning, Users, Package, Wrench } from '@phosphor-icons/react'
import { getInicio, type FreshnessInfo, type InicioData } from '../lib/api'
import { StatTile } from '../components/StatTile'
import { useUnidade } from '../lib/UnidadeContext'
import { nomeAssociacaoFor } from '../lib/unidade'

function formatBRL(v: number): string {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

export function InicioPage() {
  const [data, setData] = useState<InicioData | null>(null)
  const [freshness, setFreshness] = useState<FreshnessInfo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const { unidade } = useUnidade()

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    getInicio(nomeAssociacaoFor(unidade))
      .then((res) => {
        if (cancelled) return
        setData(res.data)
        setFreshness({ generated_at: res.generated_at, stale: res.stale })
      })
      .catch(() => !cancelled && setError('Não foi possível carregar os indicadores.'))
      .finally(() => !cancelled && setLoading(false))
    return () => { cancelled = true }
  }, [unidade])

  if (loading) return <p className="text-sm text-ink-muted">Carregando...</p>
  if (error) return <p className="rounded bg-red-100 px-3 py-2 text-sm text-red-700">{error}</p>
  if (!data) return null

  return (
    <div className="space-y-6">
      {freshness?.stale && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Dado pode estar desatualizado — última carga: {freshness.generated_at ? new Date(freshness.generated_at).toLocaleString('pt-BR') : 'nunca'}.
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatTile
          label="Receita do mês"
          value={formatBRL(data.financeiro.receita_mes_atual)}
          icon={<Wallet size={18} className="text-marque-500" />}
        />
        <StatTile
          label="Taxa de cobrança"
          value={data.financeiro.taxa_cobranca !== null ? `${data.financeiro.taxa_cobranca}%` : '—'}
          hint="do que foi gerado este mês"
          icon={<Percent size={18} className="text-marque-500" />}
        />
        <StatTile
          label="Inadimplência"
          value={formatBRL(data.financeiro.total_inadimplente)}
          hint="em aberto agora"
          icon={<Warning size={18} className="text-marque-500" />}
        />
        <StatTile
          label="Moradores ativos"
          value={String(data.moradores.total)}
          hint={`${data.moradores.associados} associados · ${data.moradores.dependentes} dependentes · ${data.moradores.visitantes} visitantes`}
          icon={<Users size={18} className="text-marque-500" />}
        />
        <StatTile
          label="Pacotes recebidos (mês)"
          value={String(data.pacotes_os.pacotes_recebidos)}
          hint={data.pacotes_os.tempo_medio_entrega_dias !== null ? `${data.pacotes_os.tempo_medio_entrega_dias} dias até retirada, em média` : undefined}
          icon={<Package size={18} className="text-marque-500" />}
        />
        <StatTile
          label="Ordens de serviço (mês)"
          value={`${data.pacotes_os.os_fechadas}/${data.pacotes_os.os_abertas + data.pacotes_os.os_fechadas}`}
          hint="fechadas / total"
          icon={<Wrench size={18} className="text-marque-500" />}
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
