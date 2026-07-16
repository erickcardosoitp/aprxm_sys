import { useEffect, useState, useCallback } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api, desativarAssociacao, listEmpresas, type Associacao, type Empresa } from '../lib/api'

export function EmpresaDetailPage() {
  const { empresaId } = useParams<{ empresaId: string }>()
  const [empresa, setEmpresa] = useState<Empresa | null>(null)
  const [associacoes, setAssociacoes] = useState<Associacao[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!empresaId) return
    setLoading(true)
    const [empresas, assocResp] = await Promise.all([
      listEmpresas(),
      api.get<Associacao[]>(`/governanca/empresas/${empresaId}/associacoes`),
    ])
    setEmpresa(empresas.find((e) => e.id === empresaId) ?? null)
    setAssociacoes(assocResp.data)
    setLoading(false)
  }, [empresaId])

  useEffect(() => {
    load()
  }, [load])

  async function handleDesativar(associacaoId: string) {
    if (!confirm('Desativar esta associação? Usuários vinculados só a ela também serão desativados.')) return
    await desativarAssociacao(associacaoId)
    load()
  }

  if (loading) return <p className="text-sm text-slate-400">Carregando...</p>
  if (!empresa) return <p className="text-sm text-slate-400">Empresa não encontrada.</p>

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-slate-100">{empresa.name}</h1>
        <p className="text-sm text-slate-500">{empresa.slug}</p>
      </div>

      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-slate-300">Associações</h2>
        <Link
          to={`/empresas/${empresa.id}/associacoes/nova`}
          className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm text-white hover:bg-indigo-500"
        >
          + Criar associação
        </Link>
      </div>

      {associacoes.length === 0 ? (
        <p className="text-sm text-slate-400">Nenhuma associação criada ainda.</p>
      ) : (
        <div className="divide-y divide-slate-800 rounded-lg border border-slate-800">
          {associacoes.map((a) => (
            <div key={a.id} className="flex items-center justify-between px-4 py-3">
              <div>
                <p className="text-sm font-medium text-slate-100">{a.name}</p>
                <p className="text-xs text-slate-500">{a.slug}</p>
              </div>
              <div className="flex items-center gap-3">
                <span className={`rounded px-2 py-0.5 text-xs ${a.is_active ? 'bg-emerald-950 text-emerald-300' : 'bg-slate-800 text-slate-400'}`}>
                  {a.is_active ? 'ativa' : 'inativa'}
                </span>
                {a.is_active && (
                  <button onClick={() => handleDesativar(a.id)} className="text-xs text-red-400 hover:text-red-300">
                    Desativar
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
