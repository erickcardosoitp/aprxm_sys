import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { listEmpresas, type Empresa } from '../lib/api'

export function EmpresasPage() {
  const [empresas, setEmpresas] = useState<Empresa[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    listEmpresas().then(setEmpresas).finally(() => setLoading(false))
  }, [])

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-slate-100">Empresas</h1>
        <Link to="/empresas/nova" className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm text-white hover:bg-indigo-500">
          + Criar empresa
        </Link>
      </div>

      {loading ? (
        <p className="text-sm text-slate-400">Carregando...</p>
      ) : empresas.length === 0 ? (
        <p className="text-sm text-slate-400">Nenhuma empresa criada ainda.</p>
      ) : (
        <div className="divide-y divide-slate-800 rounded-lg border border-slate-800">
          {empresas.map((e) => (
            <Link
              key={e.id}
              to={`/empresas/${e.id}`}
              className="flex items-center justify-between px-4 py-3 hover:bg-slate-900"
            >
              <div>
                <p className="text-sm font-medium text-slate-100">{e.name}</p>
                <p className="text-xs text-slate-500">{e.slug}</p>
              </div>
              <div className="flex items-center gap-2 text-xs">
                {e.financeiro_centralizado && (
                  <span className="rounded bg-indigo-950 px-2 py-0.5 text-indigo-300">financeiro centralizado</span>
                )}
                <span className={`rounded px-2 py-0.5 ${e.is_active ? 'bg-emerald-950 text-emerald-300' : 'bg-slate-800 text-slate-400'}`}>
                  {e.is_active ? 'ativa' : 'inativa'}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
