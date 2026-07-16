import { useEffect, useState } from 'react'
import { listProvisioningRuns, type ProvisioningRun } from '../lib/api'

const statusClass: Record<ProvisioningRun['status'], string> = {
  success: 'bg-emerald-950 text-emerald-300',
  failed: 'bg-red-950 text-red-300',
  running: 'bg-amber-950 text-amber-300',
}

export function ProvisioningRunsPage() {
  const [runs, setRuns] = useState<ProvisioningRun[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<string | null>(null)

  useEffect(() => {
    listProvisioningRuns().then(setRuns).finally(() => setLoading(false))
  }, [])

  if (loading) return <p className="text-sm text-slate-400">Carregando...</p>

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-semibold text-slate-100">Execuções de provisionamento</h1>

      {runs.length === 0 ? (
        <p className="text-sm text-slate-400">Nenhuma execução registrada ainda.</p>
      ) : (
        <div className="divide-y divide-slate-800 rounded-lg border border-slate-800">
          {runs.map((r) => (
            <div key={r.id} className="px-4 py-3">
              <button
                onClick={() => setExpanded(expanded === r.id ? null : r.id)}
                className="flex w-full items-center justify-between text-left"
              >
                <div>
                  <p className="text-sm font-medium text-slate-100">
                    {r.run_type === 'create_empresa' ? 'Criar empresa' : 'Criar associação'}
                  </p>
                  <p className="text-xs text-slate-500">{new Date(r.started_at).toLocaleString('pt-BR')}</p>
                </div>
                <span className={`rounded px-2 py-0.5 text-xs ${statusClass[r.status]}`}>{r.status}</span>
              </button>

              {expanded === r.id && (
                <div className="mt-3 space-y-2 rounded-md bg-slate-950 p-3">
                  {r.steps.map((step, i) => (
                    <div key={i} className="text-xs text-slate-400">
                      <span className="text-slate-500">{new Date(step.at).toLocaleTimeString('pt-BR')}</span> — {step.step}
                    </div>
                  ))}
                  {r.error_detail && (
                    <p className="rounded bg-red-950 px-2 py-1 text-xs text-red-300">{r.error_detail}</p>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
