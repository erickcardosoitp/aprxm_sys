import { useEffect, useState } from 'react'
import { Building2, Users, DollarSign, AlertCircle, Package, Search, TrendingUp } from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../../services/api'
import { useAuthStore } from '../../store/authStore'

type AssocFilter = 'all' | string  // 'all' ou UUID da associação

interface LinkedAssoc { id: string; name: string; slug: string }
interface Dashboard {
  total_moradores: number
  total_membros: number
  total_arrecadado: string
  total_pendente: string
  inadimplentes: number
  encomendas_aguardando: number
}
interface CobrancaItem {
  id: string
  association_name: string
  association_slug: string
  resident_name: string
  reference_month: string
  due_date: string
  amount: string
  status: string
  paid_at: string | null
}
interface Morador {
  id: string
  full_name: string
  cpf: string | null
  unit: string | null
  block: string | null
  type: string
  status: string
  association_name: string
  association_slug: string
  pendencias: number
}

type Tab = 'dashboard' | 'cobrancas' | 'moradores'
type CobrancasFilter = 'all' | 'paid' | 'pending' | 'overdue'

const fmt = (v: string | number) =>
  `R$ ${parseFloat(String(v)).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const fmtDate = (s: string) =>
  new Date(s).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' })

const BADGE: Record<string, string> = {
  'vaz-lobo': 'bg-blue-100 text-blue-700',
  'congonha': 'bg-purple-100 text-purple-700',
}

export default function GeralPage() {
  const linkedIds = useAuthStore(s => s.linkedAssociationIds)

  const [tab, setTab] = useState<Tab>('dashboard')
  const [assocs, setAssocs] = useState<LinkedAssoc[]>([])
  const [assocFilter, setAssocFilter] = useState<AssocFilter>('all')

  // Dashboard
  const [dashboard, setDashboard] = useState<Dashboard | null>(null)
  const [loadingDash, setLoadingDash] = useState(false)

  // Cobranças
  const [cobrancas, setCobrancas] = useState<CobrancaItem[]>([])
  const [loadingCob, setLoadingCob] = useState(false)
  const [cobFilter, setCobFilter] = useState<CobrancasFilter>('all')

  // Moradores
  const [moradores, setMoradores] = useState<Morador[]>([])
  const [loadingMor, setLoadingMor] = useState(false)
  const [searchQ, setSearchQ] = useState('')
  const [searchTimeout, setSearchTimeout] = useState<ReturnType<typeof setTimeout> | null>(null)

  const assocIdsParam = assocFilter === 'all' ? undefined : [assocFilter]

  useEffect(() => { loadAssocs() }, [])
  useEffect(() => {
    if (tab === 'dashboard') loadDashboard()
    if (tab === 'cobrancas') loadCobrancas(cobFilter)
    if (tab === 'moradores') loadMoradores()
  }, [tab, assocFilter])

  const loadAssocs = async () => {
    try {
      const res = await api.get<LinkedAssoc[]>('/geral/associations')
      setAssocs(res.data)
    } catch { }
  }

  const loadDashboard = async () => {
    setLoadingDash(true)
    try {
      const params: any = {}
      if (assocFilter !== 'all') params.assoc_ids = [assocFilter]
      const res = await api.get<Dashboard>('/geral/dashboard', { params })
      setDashboard(res.data)
    } catch (e: any) {
      toast.error(e.response?.data?.detail ?? 'Erro ao carregar dashboard.')
    } finally { setLoadingDash(false) }
  }

  const loadCobrancas = async (statusFilter: CobrancasFilter) => {
    setLoadingCob(true)
    try {
      const params: any = { status_filter: statusFilter }
      if (assocFilter !== 'all') params.assoc_ids = [assocFilter]
      const res = await api.get<CobrancaItem[]>('/geral/cobrancas', { params })
      setCobrancas(res.data)
    } catch { setCobrancas([]) } finally { setLoadingCob(false) }
  }

  const loadMoradores = async (q?: string) => {
    setLoadingMor(true)
    try {
      const params: any = {}
      if (assocFilter !== 'all') params.assoc_ids = [assocFilter]
      if (q) params.q = q
      const res = await api.get<Morador[]>('/geral/moradores', { params })
      setMoradores(res.data)
    } catch { setMoradores([]) } finally { setLoadingMor(false) }
  }

  const handleSearch = (q: string) => {
    setSearchQ(q)
    if (searchTimeout) clearTimeout(searchTimeout)
    setSearchTimeout(setTimeout(() => loadMoradores(q || undefined), 400))
  }

  const TABS: { key: Tab; label: string; icon: any }[] = [
    { key: 'dashboard', label: 'Resumo', icon: TrendingUp },
    { key: 'cobrancas', label: 'Cobranças', icon: DollarSign },
    { key: 'moradores', label: 'Moradores', icon: Users },
  ]

  const AssocBadge = ({ slug, name }: { slug: string; name: string }) => (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${BADGE[slug] ?? 'bg-gray-100 text-gray-600'}`}>
      {name}
    </span>
  )

  return (
    <div className="flex flex-col gap-4 p-4 sm:p-6">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Building2 className="w-5 h-5 text-[#26619c]" />
        <h1 className="text-xl font-bold text-gray-900">Painel Geral</h1>
      </div>

      {/* Association filter */}
      <div className="flex gap-2 flex-wrap">
        <button
          onClick={() => setAssocFilter('all')}
          className={`px-3 py-1.5 rounded-lg text-sm font-medium transition ${
            assocFilter === 'all' ? 'bg-[#26619c] text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
          }`}>
          Todas
        </button>
        {assocs.map(a => (
          <button key={a.id}
            onClick={() => setAssocFilter(a.id)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition ${
              assocFilter === a.id ? 'bg-[#26619c] text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
            }`}>
            {a.name}
          </button>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button key={key} onClick={() => setTab(key)}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-medium transition ${
              tab === key ? 'bg-white text-[#26619c] shadow-sm' : 'text-gray-500'
            }`}>
            <Icon className="w-3.5 h-3.5" />{label}
          </button>
        ))}
      </div>

      {/* Dashboard */}
      {tab === 'dashboard' && (
        <div className="flex flex-col gap-3">
          {loadingDash ? (
            <div className="p-8 text-center text-gray-400 text-sm">Carregando…</div>
          ) : dashboard ? (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
                  <p className="text-xs text-gray-500 flex items-center gap-1"><Users className="w-3 h-3" /> Moradores</p>
                  <p className="text-2xl font-bold text-gray-800 mt-1">{dashboard.total_moradores}</p>
                  <p className="text-xs text-gray-400">{dashboard.total_membros} membros</p>
                </div>
                <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
                  <p className="text-xs text-gray-500 flex items-center gap-1"><Package className="w-3 h-3" /> Encomendas</p>
                  <p className="text-2xl font-bold text-gray-800 mt-1">{dashboard.encomendas_aguardando}</p>
                  <p className="text-xs text-gray-400">aguardando retirada</p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-green-50 rounded-xl border border-green-200 p-4">
                  <p className="text-xs text-green-600">Total Arrecadado</p>
                  <p className="text-xl font-bold text-green-700 mt-1">{fmt(dashboard.total_arrecadado)}</p>
                </div>
                <div className="bg-red-50 rounded-xl border border-red-200 p-4">
                  <p className="text-xs text-red-500">Pendente</p>
                  <p className="text-xl font-bold text-red-600 mt-1">{fmt(dashboard.total_pendente)}</p>
                  <p className="text-xs text-red-400 mt-0.5">{dashboard.inadimplentes} inadimplentes</p>
                </div>
              </div>
            </>
          ) : null}
        </div>
      )}

      {/* Cobranças */}
      {tab === 'cobrancas' && (
        <div className="flex flex-col gap-3">
          <div className="flex gap-1 bg-gray-100 rounded-xl p-1">
            {([
              { key: 'all', label: 'Todas' },
              { key: 'pending', label: 'A Receber' },
              { key: 'overdue', label: 'Inadimplentes' },
              { key: 'paid', label: 'Pagas' },
            ] as const).map(({ key, label }) => (
              <button key={key}
                onClick={() => { setCobFilter(key); loadCobrancas(key) }}
                className={`flex-1 py-2 rounded-lg text-xs font-medium transition ${
                  cobFilter === key ? 'bg-white text-[#26619c] shadow-sm' : 'text-gray-500'
                }`}>
                {label}
              </button>
            ))}
          </div>
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
              <p className="text-sm font-semibold text-gray-800">Cobranças</p>
              <span className="text-xs text-gray-400">
                {loadingCob ? 'Carregando…' : `${cobrancas.length} registro(s)`}
              </span>
            </div>
            {!loadingCob && cobrancas.length === 0 ? (
              <div className="p-6 text-center text-gray-400 text-sm">Nenhum registro encontrado.</div>
            ) : (
              <ul className="divide-y divide-gray-100">
                {cobrancas.map(c => (
                  <li key={c.id} className="px-4 py-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-gray-800 truncate">{c.resident_name}</p>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <AssocBadge slug={c.association_slug} name={c.association_name} />
                          <span className="text-xs text-gray-400">Ref: {c.reference_month}</span>
                        </div>
                        {c.paid_at && (
                          <p className="text-xs text-green-600 mt-0.5">Pago em: {fmtDate(c.paid_at)}</p>
                        )}
                        {c.status !== 'paid' && new Date(c.due_date) < new Date() && (
                          <p className="text-xs text-red-500 mt-0.5">
                            <AlertCircle className="w-3 h-3 inline mr-0.5" />
                            Venceu: {fmtDate(c.due_date)}
                          </p>
                        )}
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="text-sm font-bold text-gray-800">{fmt(c.amount)}</p>
                        <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${
                          c.status === 'paid' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'
                        }`}>
                          {c.status === 'paid' ? 'Pago' : 'Pendente'}
                        </span>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {/* Moradores */}
      {tab === 'moradores' && (
        <div className="flex flex-col gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              value={searchQ}
              onChange={e => handleSearch(e.target.value)}
              placeholder="Buscar por nome ou CPF…"
              className="w-full border border-gray-300 rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#26619c]/40"
            />
          </div>
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
              <p className="text-sm font-semibold text-gray-800">Moradores</p>
              <span className="text-xs text-gray-400">
                {loadingMor ? 'Carregando…' : `${moradores.length} registro(s)`}
              </span>
            </div>
            {!loadingMor && moradores.length === 0 ? (
              <div className="p-6 text-center text-gray-400 text-sm">Nenhum morador encontrado.</div>
            ) : (
              <ul className="divide-y divide-gray-100">
                {moradores.map(m => (
                  <li key={m.id} className="px-4 py-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-gray-800 truncate">{m.full_name}</p>
                        <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                          <AssocBadge slug={m.association_slug} name={m.association_name} />
                          {m.unit && <span className="text-xs text-gray-400">Unid. {m.unit}{m.block ? ` / Bl. ${m.block}` : ''}</span>}
                          {m.cpf && <span className="text-xs text-gray-400">{m.cpf}</span>}
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${
                          m.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                        }`}>
                          {m.status === 'active' ? 'Ativo' : m.status}
                        </span>
                        {m.pendencias > 0 && (
                          <p className="text-xs text-red-500 mt-1">{m.pendencias} pendência(s)</p>
                        )}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
