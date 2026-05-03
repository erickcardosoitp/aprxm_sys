import { useEffect, useState } from 'react'
import { Building2, Users, DollarSign, AlertCircle, Package, Search, TrendingUp, RefreshCw, CheckCircle, AlertTriangle, XCircle, ClipboardList, Server } from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../../services/api'
import { useAuthStore } from '../../store/authStore'
import SuperAdminPage from '../superadmin/SuperAdminPage'

type AssocFilter = 'all' | string
interface LinkedAssoc { id: string; name: string; slug: string }
interface Dashboard {
  total_moradores: number
  total_membros: number
  total_arrecadado: string
  total_pendente: string
  inadimplentes: number
  encomendas_aguardando: number
  cofres?: { association: string; balance: string }[]
  total_cofres?: string
}
interface CobrancaItem {
  id: string; association_name: string; association_slug: string
  resident_name: string; reference_month: string; due_date: string
  amount: string; status: string; paid_at: string | null
}
interface Morador {
  id: string; full_name: string; cpf: string | null; unit: string | null
  block: string | null; type: string; status: string
  association_name: string; association_slug: string; pendencias: number
}
interface SyncItem {
  id: string; name: string; slug: string
  moradores_ativos: number; membros_ativos: number
  encomendas_pendentes: number; encomendas_entregues_mes: number
  saldo_cofre: string; ultima_transacao: string | null
  sessao_aberta_em: string | null; ultima_sessao_fechada: string | null
  inadimplentes: number; sync_status: 'ok' | 'warning' | 'error'
  warnings: string[]
}
interface InventoryRecord {
  id: string; pix_counted: string; cash_counted: string
  total_counted: string; expected_total: string | null
  difference: string | null; justification: string
  status: 'draft' | 'concluded' | 'cancelled'
  reference_month: string | null; signed_at: string | null
  cancelled_at: string | null; signed_by_name: string | null
  cancelled_by_name: string | null
  attributed_association_id: string | null
  attributed_association_name: string | null
}

type Tab = 'dashboard' | 'cobrancas' | 'moradores' | 'inventario' | 'sincronizacao' | 'ti'
type CobrancasFilter = 'all' | 'paid' | 'pending' | 'overdue'

const fmt = (v: string | number) =>
  `R$ ${parseFloat(String(v)).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const fmtDate = (s: string) =>
  new Date(s).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' })

const fmtDateTime = (s: string) =>
  new Date(s).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })

const BADGE: Record<string, string> = {
  'vaz-lobo': 'bg-blue-100 text-blue-700',
  'congonha': 'bg-purple-100 text-purple-700',
}

export default function GeralPage() {
  const linkedIds = useAuthStore(s => s.linkedAssociationIds)
  const isOffice = useAuthStore(s => s.isOffice)
  const role = useAuthStore(s => s.role)

  const [tab, setTab] = useState<Tab>('dashboard')
  const [assocs, setAssocs] = useState<LinkedAssoc[]>([])
  const [assocFilter, setAssocFilter] = useState<AssocFilter>('all')

  const [dashboard, setDashboard] = useState<Dashboard | null>(null)
  const [loadingDash, setLoadingDash] = useState(false)

  const [cobrancas, setCobrancas] = useState<CobrancaItem[]>([])
  const [loadingCob, setLoadingCob] = useState(false)
  const [cobFilter, setCobFilter] = useState<CobrancasFilter>('all')

  const [moradores, setMoradores] = useState<Morador[]>([])
  const [loadingMor, setLoadingMor] = useState(false)
  const [searchQ, setSearchQ] = useState('')
  const [searchTimeout, setSearchTimeout] = useState<ReturnType<typeof setTimeout> | null>(null)

  const [invMonth, setInvMonth] = useState(() => new Date().toISOString().slice(0, 7))
  const [inventario, setInventario] = useState<any[]>([])
  const [loadingInv, setLoadingInv] = useState(false)

  // Escritório: inventário financeiro
  const [invRecords, setInvRecords] = useState<InventoryRecord[]>([])
  const [loadingInvRec, setLoadingInvRec] = useState(false)
  const [activeDraft, setActiveDraft] = useState<InventoryRecord | null>(null)
  const [pixInput, setPixInput] = useState('')
  const [cashInput, setCashInput] = useState('')
  const [justInput, setJustInput] = useState('')
  const [attrAssocId, setAttrAssocId] = useState<string>('')
  const [savingInv, setSavingInv] = useState(false)

  // Sync panel
  const [syncData, setSyncData] = useState<SyncItem[]>([])
  const [loadingSync, setLoadingSync] = useState(false)
  const [expandedSync, setExpandedSync] = useState<string | null>(null)

  useEffect(() => { loadAssocs() }, [])
  useEffect(() => {
    if (tab === 'dashboard') loadDashboard()
    if (tab === 'cobrancas') loadCobrancas(cobFilter)
    if (tab === 'moradores') loadMoradores()
    if (tab === 'inventario') { loadInventario(); if (isOffice) loadInvRecords() }
    if (tab === 'sincronizacao') loadSync()
  }, [tab, assocFilter])

  const loadAssocs = async () => {
    try { const res = await api.get<LinkedAssoc[]>('/geral/associations'); setAssocs(res.data) } catch { }
  }

  const loadDashboard = async () => {
    setLoadingDash(true)
    try {
      const params: any = {}
      if (assocFilter !== 'all') params.assoc_ids = [assocFilter]
      const res = await api.get<Dashboard>('/geral/dashboard', { params })
      setDashboard(res.data)
    } catch (e: any) { toast.error(e.response?.data?.detail ?? 'Erro ao carregar dashboard.') }
    finally { setLoadingDash(false) }
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

  const loadInventario = async (month?: string) => {
    setLoadingInv(true)
    try {
      const params: any = { month: month ?? invMonth }
      if (assocFilter !== 'all') params.assoc_ids = [assocFilter]
      const res = await api.get<any[]>('/geral/inventario', { params })
      setInventario(res.data)
    } catch { setInventario([]) } finally { setLoadingInv(false) }
  }

  const loadInvRecords = async () => {
    setLoadingInvRec(true)
    try {
      const res = await api.get<InventoryRecord[]>('/geral/inventory')
      setInvRecords(res.data)
      const draft = res.data.find(r => r.status === 'draft') ?? null
      setActiveDraft(draft)
      if (draft) {
        setPixInput(draft.pix_counted !== '0' ? draft.pix_counted : '')
        setCashInput(draft.cash_counted !== '0' ? draft.cash_counted : '')
        setJustInput(draft.justification)
      }
    } catch { setInvRecords([]) } finally { setLoadingInvRec(false) }
  }

  const loadSync = async () => {
    setLoadingSync(true)
    try {
      const res = await api.get<SyncItem[]>('/geral/sync')
      setSyncData(res.data)
    } catch { setSyncData([]) } finally { setLoadingSync(false) }
  }

  const handleSearch = (q: string) => {
    setSearchQ(q)
    if (searchTimeout) clearTimeout(searchTimeout)
    setSearchTimeout(setTimeout(() => loadMoradores(q || undefined), 400))
  }

  const handleCreateDraft = async () => {
    try {
      await api.post('/geral/inventory/draft')
      await loadInvRecords()
      toast.success('Inventário iniciado.')
    } catch (e: any) { toast.error(e.response?.data?.detail ?? 'Erro ao criar inventário.') }
  }

  const handleSaveDraft = async () => {
    if (!activeDraft) return
    setSavingInv(true)
    try {
      await api.patch(`/geral/inventory/${activeDraft.id}`, {
        pix_counted: parseFloat(pixInput) || 0,
        cash_counted: parseFloat(cashInput) || 0,
        justification: justInput,
      })
      await loadInvRecords()
    } catch (e: any) { toast.error(e.response?.data?.detail ?? 'Erro ao salvar.') }
    finally { setSavingInv(false) }
  }

  const handleConclude = async () => {
    if (!activeDraft) return
    if (!justInput.trim()) { toast.error('Justificativa obrigatória.'); return }
    setSavingInv(true)
    try {
      await api.post(`/geral/inventory/${activeDraft.id}/conclude`, {
        pix_counted: parseFloat(pixInput) || 0,
        cash_counted: parseFloat(cashInput) || 0,
        justification: justInput,
        attributed_association_id: attrAssocId || null,
      })
      await loadInvRecords()
      toast.success('Inventário concluído e assinado.')
    } catch (e: any) { toast.error(e.response?.data?.detail ?? 'Erro ao concluir.') }
    finally { setSavingInv(false) }
  }

  const handleCancelInv = async (id: string) => {
    if (!confirm('Cancelar este inventário?')) return
    try {
      await api.post(`/geral/inventory/${id}/cancel`)
      await loadInvRecords()
      toast.success('Inventário cancelado.')
    } catch (e: any) { toast.error(e.response?.data?.detail ?? 'Erro ao cancelar.') }
  }

  const pixVal = parseFloat(pixInput) || 0
  const cashVal = parseFloat(cashInput) || 0
  const totalVal = pixVal + cashVal
  const expectedVal = activeDraft?.expected_total ? parseFloat(activeDraft.expected_total) : null
  const diffVal = expectedVal !== null ? totalVal - expectedVal : null

  const TABS: { key: Tab; label: string; icon: any }[] = [
    { key: 'dashboard', label: 'Resumo', icon: TrendingUp },
    { key: 'cobrancas', label: 'Cobranças', icon: DollarSign },
    { key: 'moradores', label: 'Moradores', icon: Users },
    { key: 'inventario', label: 'Inventário', icon: ClipboardList },
    ...(isOffice ? [{ key: 'sincronizacao' as Tab, label: 'Sinc.', icon: RefreshCw }] : []),
    ...(isOffice && role === 'superadmin' ? [{ key: 'ti' as Tab, label: 'TI', icon: Server }] : []),
  ]

  const AssocBadge = ({ slug, name }: { slug: string; name: string }) => (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${BADGE[slug] ?? 'bg-gray-100 text-gray-600'}`}>
      {name}
    </span>
  )

  const SyncIcon = ({ status }: { status: string }) => {
    if (status === 'ok') return <CheckCircle className="w-4 h-4 text-green-500" />
    if (status === 'warning') return <AlertTriangle className="w-4 h-4 text-yellow-500" />
    return <XCircle className="w-4 h-4 text-red-500" />
  }

  const officeHeaderColor = 'from-slate-800 to-slate-700'

  return (
    <div className="flex flex-col gap-4 p-4 sm:p-6 max-w-screen-xl mx-auto w-full">
      {/* Header */}
      {isOffice ? (
        <div className={`bg-gradient-to-r ${officeHeaderColor} rounded-xl p-4 text-white`}>
          <div className="flex items-center gap-2">
            <Building2 className="w-5 h-5 text-slate-300" />
            <h1 className="text-xl font-bold">Escritório</h1>
            <span className="ml-auto text-xs bg-slate-600 px-2 py-0.5 rounded-full text-slate-300">Estratégico</span>
          </div>
          <div className="flex gap-2 mt-2 flex-wrap">
            {assocs.map(a => (
              <span key={a.id} className={`text-xs px-2 py-0.5 rounded-full font-medium ${BADGE[a.slug] ?? 'bg-slate-500 text-white'}`}>{a.name}</span>
            ))}
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <Building2 className="w-5 h-5 text-[#26619c]" />
          <h1 className="text-xl font-bold text-gray-900">Painel Geral</h1>
        </div>
      )}

      {/* Association filter */}
      <div className="flex gap-2 flex-wrap">
        <button onClick={() => setAssocFilter('all')}
          className={`px-3 py-1.5 rounded-lg text-sm font-medium transition ${assocFilter === 'all' ? (isOffice ? 'bg-slate-700 text-white' : 'bg-[#26619c] text-white') : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
          Todas
        </button>
        {assocs.map(a => (
          <button key={a.id} onClick={() => setAssocFilter(a.id)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition ${assocFilter === a.id ? (isOffice ? 'bg-slate-700 text-white' : 'bg-[#26619c] text-white') : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
            {a.name}
          </button>
        ))}
      </div>

      {/* Tabs */}
      <div className="sticky top-0 z-10 bg-white pt-1 pb-1 -mx-4 px-4 sm:-mx-6 sm:px-6">
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button key={key} onClick={() => setTab(key)}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-medium transition ${tab === key ? `bg-white shadow-sm ${isOffice ? 'text-slate-700' : 'text-[#26619c]'}` : 'text-gray-500'}`}>
            <Icon className="w-3.5 h-3.5" />{label}
          </button>
        ))}
      </div>
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
              {dashboard.cofres && dashboard.cofres.length > 0 && (
                <div className="bg-slate-50 rounded-xl border border-slate-200 p-4">
                  <p className="text-xs text-slate-600 font-medium mb-2">Cofres</p>
                  <p className="text-xl font-bold text-slate-800">{fmt(dashboard.total_cofres ?? '0')}</p>
                  <div className="mt-2 flex flex-col gap-1">
                    {dashboard.cofres.map((c, i) => (
                      <div key={i} className="flex justify-between text-xs text-slate-600">
                        <span>{c.association}</span>
                        <span className="font-medium">{fmt(c.balance)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
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
              <button key={key} onClick={() => { setCobFilter(key); loadCobrancas(key) }}
                className={`flex-1 py-2 rounded-lg text-xs font-medium transition ${cobFilter === key ? 'bg-white text-[#26619c] shadow-sm' : 'text-gray-500'}`}>
                {label}
              </button>
            ))}
          </div>
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
              <p className="text-sm font-semibold text-gray-800">Cobranças</p>
              <span className="text-xs text-gray-400">{loadingCob ? 'Carregando…' : `${cobrancas.length} registro(s)`}</span>
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
                        {c.paid_at && <p className="text-xs text-green-600 mt-0.5">Pago em: {fmtDate(c.paid_at)}</p>}
                        {c.status !== 'paid' && new Date(c.due_date) < new Date() && (
                          <p className="text-xs text-red-500 mt-0.5">
                            <AlertCircle className="w-3 h-3 inline mr-0.5" />Venceu: {fmtDate(c.due_date)}
                          </p>
                        )}
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="text-sm font-bold text-gray-800">{fmt(c.amount)}</p>
                        <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${c.status === 'paid' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>
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
            <input value={searchQ} onChange={e => handleSearch(e.target.value)}
              placeholder="Buscar por nome ou CPF…"
              className="w-full border border-gray-300 rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#26619c]/40" />
          </div>
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
              <p className="text-sm font-semibold text-gray-800">Moradores</p>
              <span className="text-xs text-gray-400">{loadingMor ? 'Carregando…' : `${moradores.length} registro(s)`}</span>
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
                        <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${m.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                          {m.status === 'active' ? 'Ativo' : m.status}
                        </span>
                        {m.pendencias > 0 && <p className="text-xs text-red-500 mt-1">{m.pendencias} pendência(s)</p>}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {/* Inventário */}
      {tab === 'inventario' && (
        <div className="flex flex-col gap-3">
          {/* Inventário Financeiro — apenas Escritório */}
          {isOffice && (
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-slate-800">Inventário Financeiro</p>
                {!activeDraft && (
                  <button onClick={handleCreateDraft}
                    className="text-xs bg-slate-700 text-white px-3 py-1.5 rounded-lg hover:bg-slate-800 transition">
                    Iniciar inventário
                  </button>
                )}
              </div>

              {activeDraft && (
                <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 flex flex-col gap-3">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                    <p className="text-sm font-medium text-slate-700">
                      Draft — {activeDraft.reference_month ? new Date(activeDraft.reference_month + 'T12:00:00').toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }) : ''}
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs text-gray-500 block mb-1">PIX contado (R$)</label>
                      <input type="number" step="0.01" min="0" value={pixInput}
                        onChange={e => setPixInput(e.target.value)}
                        placeholder="0,00"
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                    </div>
                    <div>
                      <label className="text-xs text-gray-500 block mb-1">Espécie contada (R$)</label>
                      <input type="number" step="0.01" min="0" value={cashInput}
                        onChange={e => setCashInput(e.target.value)}
                        placeholder="0,00"
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                    </div>
                  </div>

                  {/* Cálculo em tempo real */}
                  <div className="bg-slate-50 rounded-lg p-3 flex flex-col gap-1.5 text-xs">
                    <div className="flex justify-between text-slate-600">
                      <span>Total contado</span>
                      <span className="font-bold text-slate-800">{fmt(totalVal)}</span>
                    </div>
                    {expectedVal !== null && (
                      <>
                        <div className="flex justify-between text-slate-600">
                          <span>Saldo esperado (sistema)</span>
                          <span className="font-medium">{fmt(expectedVal)}</span>
                        </div>
                        <div className={`flex justify-between font-bold text-sm pt-1 border-t border-slate-200 ${diffVal === 0 ? 'text-green-600' : diffVal! > 0 ? 'text-blue-600' : 'text-red-600'}`}>
                          <span>{diffVal === 0 ? 'Cofre equilibrado' : diffVal! > 0 ? 'Sobra' : 'Falta'}</span>
                          <span>{diffVal !== 0 ? fmt(Math.abs(diffVal!)) : '—'}</span>
                        </div>
                      </>
                    )}
                  </div>

                  {/* Atribuição de diferença — só aparece se houver quebra/sobra */}
                  {diffVal !== null && diffVal !== 0 && (
                    <div>
                      <label className="text-xs text-gray-500 block mb-1">
                        Atribuir diferença a <span className="text-gray-400">(opcional)</span>
                      </label>
                      <select value={attrAssocId} onChange={e => setAttrAssocId(e.target.value)}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400">
                        <option value="">— Sem atribuição (quebra geral) —</option>
                        {assocs.map(a => (
                          <option key={a.id} value={a.id}>{a.name}</option>
                        ))}
                      </select>
                      {attrAssocId && (
                        <p className="text-xs text-amber-600 mt-1">
                          A diferença de {fmt(Math.abs(diffVal))} será atribuída a {assocs.find(a => a.id === attrAssocId)?.name}.
                        </p>
                      )}
                    </div>
                  )}

                  <div>
                    <label className="text-xs text-gray-500 block mb-1">Justificativa <span className="text-red-500">*</span></label>
                    <textarea value={justInput} onChange={e => setJustInput(e.target.value)}
                      rows={3} placeholder="Descreva a situação do cofre…"
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400 resize-none" />
                  </div>

                  <div className="flex gap-2">
                    <button onClick={handleSaveDraft} disabled={savingInv}
                      className="flex-1 border border-slate-300 text-slate-700 py-2 rounded-lg text-sm font-medium hover:bg-slate-50 transition disabled:opacity-50">
                      Salvar rascunho
                    </button>
                    <button onClick={handleConclude} disabled={savingInv || !justInput.trim()}
                      className="flex-1 bg-slate-700 text-white py-2 rounded-lg text-sm font-medium hover:bg-slate-800 transition disabled:opacity-50">
                      Concluir e assinar
                    </button>
                  </div>

                  <button onClick={() => handleCancelInv(activeDraft.id)}
                    className="text-xs text-red-500 hover:underline text-center">
                    Cancelar inventário
                  </button>
                </div>
              )}

              {/* Histórico */}
              {invRecords.filter(r => r.status !== 'draft').length > 0 && (
                <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                  <p className="px-4 py-3 text-sm font-semibold text-gray-800 border-b border-gray-100">Histórico</p>
                  <ul className="divide-y divide-gray-100">
                    {invRecords.filter(r => r.status !== 'draft').map(r => (
                      <li key={r.id} className="px-4 py-3">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className="text-sm font-medium text-gray-800">
                              {r.reference_month ? new Date(r.reference_month + 'T12:00:00').toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }) : '—'}
                            </p>
                            {r.status === 'concluded' && r.difference !== null && (
                              <p className={`text-xs mt-0.5 ${parseFloat(r.difference) === 0 ? 'text-green-600' : parseFloat(r.difference) > 0 ? 'text-blue-600' : 'text-red-600'}`}>
                                {parseFloat(r.difference) === 0 ? 'Equilibrado' : parseFloat(r.difference) > 0 ? `Sobra ${fmt(parseFloat(r.difference))}` : `Falta ${fmt(Math.abs(parseFloat(r.difference)))}`}
                              </p>
                            )}
                            {r.attributed_association_name && (
                              <p className="text-xs text-amber-600 mt-0.5">Atribuído a {r.attributed_association_name}</p>
                            )}
                            {r.signed_by_name && <p className="text-xs text-gray-400 mt-0.5">Assinado por {r.signed_by_name}</p>}
                            {r.cancelled_by_name && <p className="text-xs text-gray-400 mt-0.5">Cancelado por {r.cancelled_by_name}</p>}
                          </div>
                          <div className="flex flex-col items-end gap-1">
                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${r.status === 'concluded' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                              {r.status === 'concluded' ? 'Concluído' : 'Cancelado'}
                            </span>
                            {r.status === 'concluded' && (
                              <button onClick={() => handleCancelInv(r.id)} className="text-xs text-red-400 hover:underline">Cancelar</button>
                            )}
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <hr className="border-gray-200 my-1" />
              <p className="text-xs text-gray-400 font-medium uppercase tracking-wide">Resumo por associação — {invMonth}</p>
            </div>
          )}

          {/* Inventário mensal (resumo financeiro) */}
          <div className="flex items-center gap-2">
            <input type="month" value={invMonth}
              onChange={e => { setInvMonth(e.target.value); loadInventario(e.target.value) }}
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm" />
          </div>
          {loadingInv ? (
            <div className="p-8 text-center text-gray-400 text-sm">Carregando…</div>
          ) : inventario.length === 0 ? (
            <div className="p-6 text-center text-gray-400 text-sm">Nenhum dado.</div>
          ) : (
            <div className="flex flex-col gap-3">
              {inventario.map(row => (
                <div key={row.association_id} className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
                  <p className="text-sm font-semibold text-gray-800 mb-3">{row.association_name}</p>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="bg-green-50 rounded-lg p-2">
                      <p className="text-green-600">Receitas do mês</p>
                      <p className="font-bold text-green-700 text-base mt-0.5">{fmt(row.total_receitas)}</p>
                    </div>
                    <div className="bg-red-50 rounded-lg p-2">
                      <p className="text-red-500">Despesas do mês</p>
                      <p className="font-bold text-red-600 text-base mt-0.5">{fmt(row.total_despesas)}</p>
                    </div>
                    <div className="bg-blue-50 rounded-lg p-2">
                      <p className="text-blue-600">Mensalidades pagas</p>
                      <p className="font-bold text-blue-700 text-base mt-0.5">{fmt(row.mensalidades_pagas)}</p>
                      <p className="text-blue-400 mt-0.5">{row.qtd_mensalidades} pagamento(s)</p>
                    </div>
                    <div className={`rounded-lg p-2 ${parseFloat(row.liquido_mes) >= 0 ? 'bg-emerald-50' : 'bg-orange-50'}`}>
                      <p className={parseFloat(row.liquido_mes) >= 0 ? 'text-emerald-600' : 'text-orange-600'}>Líquido do mês</p>
                      <p className={`font-bold text-base mt-0.5 ${parseFloat(row.liquido_mes) >= 0 ? 'text-emerald-700' : 'text-orange-700'}`}>{fmt(row.liquido_mes)}</p>
                    </div>
                    <div className="bg-gray-50 rounded-lg p-2">
                      <p className="text-gray-500">Saldo caixinhas</p>
                      <p className="font-bold text-gray-700 text-base mt-0.5">{fmt(row.saldo_caixinhas)}</p>
                    </div>
                    <div className="bg-slate-50 rounded-lg p-2">
                      <p className="text-slate-500">Saldo cofres</p>
                      <p className="font-bold text-slate-700 text-base mt-0.5">{fmt(row.saldo_cofres)}</p>
                    </div>
                  </div>
                </div>
              ))}
              <div className="bg-gray-800 rounded-xl p-4 text-white">
                <p className="text-xs text-gray-400 mb-1">Consolidado — {invMonth}</p>
                <div className="flex justify-between text-sm">
                  <span>Total receitas</span>
                  <span className="font-bold text-green-400">{fmt(String(inventario.reduce((s, r) => s + parseFloat(r.total_receitas), 0)))}</span>
                </div>
                <div className="flex justify-between text-sm mt-1">
                  <span>Total despesas</span>
                  <span className="font-bold text-red-400">{fmt(String(inventario.reduce((s, r) => s + parseFloat(r.total_despesas), 0)))}</span>
                </div>
                <div className="flex justify-between text-sm mt-1">
                  <span>Saldo total cofres</span>
                  <span className="font-bold text-slate-300">{fmt(String(inventario.reduce((s, r) => s + parseFloat(r.saldo_cofres), 0)))}</span>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* TI — apenas Escritório + superadmin */}
      {tab === 'ti' && isOffice && role === 'superadmin' && (
        <SuperAdminPage />
      )}

      {/* Sincronização — apenas Escritório */}
      {tab === 'sincronizacao' && isOffice && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-slate-800">Painel de Sincronização</p>
            <button onClick={loadSync} disabled={loadingSync}
              className="flex items-center gap-1.5 text-xs text-slate-600 border border-slate-300 px-3 py-1.5 rounded-lg hover:bg-slate-50 transition disabled:opacity-50">
              <RefreshCw className={`w-3.5 h-3.5 ${loadingSync ? 'animate-spin' : ''}`} /> Atualizar
            </button>
          </div>

          {loadingSync ? (
            <div className="p-8 text-center text-gray-400 text-sm">Verificando…</div>
          ) : syncData.length === 0 ? (
            <div className="p-6 text-center text-gray-400 text-sm">Nenhum dado.</div>
          ) : (
            syncData.map(item => (
              <div key={item.id} className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                <div className="px-4 py-3 flex items-center gap-2 cursor-pointer"
                  onClick={() => setExpandedSync(expandedSync === item.id ? null : item.id)}>
                  <SyncIcon status={item.sync_status} />
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-gray-800">{item.name}</p>
                    {item.warnings.length > 0 && (
                      <p className="text-xs text-yellow-600">{item.warnings[0]}</p>
                    )}
                    {item.sync_status === 'ok' && (
                      <p className="text-xs text-green-600">Sincronizado</p>
                    )}
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-bold text-slate-700">{fmt(item.saldo_cofre)}</p>
                    <p className="text-xs text-gray-400">cofre</p>
                  </div>
                </div>

                {expandedSync === item.id && (
                  <div className="border-t border-gray-100 px-4 py-3 grid grid-cols-2 gap-2 text-xs">
                    <div className="bg-gray-50 rounded-lg p-2">
                      <p className="text-gray-500">Moradores ativos</p>
                      <p className="font-bold text-gray-700">{item.moradores_ativos}</p>
                      <p className="text-gray-400">{item.membros_ativos} membros</p>
                    </div>
                    <div className="bg-gray-50 rounded-lg p-2">
                      <p className="text-gray-500">Encomendas</p>
                      <p className="font-bold text-gray-700">{item.encomendas_pendentes} pendentes</p>
                      <p className="text-gray-400">{item.encomendas_entregues_mes} entregues no mês</p>
                    </div>
                    <div className="bg-gray-50 rounded-lg p-2">
                      <p className="text-gray-500">Inadimplentes</p>
                      <p className={`font-bold ${item.inadimplentes > 0 ? 'text-red-600' : 'text-green-600'}`}>{item.inadimplentes}</p>
                    </div>
                    <div className="bg-gray-50 rounded-lg p-2">
                      <p className="text-gray-500">Última transação</p>
                      <p className="font-bold text-gray-700 text-xs leading-tight">
                        {item.ultima_transacao ? fmtDateTime(item.ultima_transacao) : '—'}
                      </p>
                    </div>
                    <div className="bg-gray-50 rounded-lg p-2">
                      <p className="text-gray-500">Sessão de caixa</p>
                      <p className={`font-bold text-xs ${item.sessao_aberta_em ? 'text-amber-600' : 'text-gray-700'}`}>
                        {item.sessao_aberta_em ? `Aberta desde ${fmtDateTime(item.sessao_aberta_em)}` : 'Fechada'}
                      </p>
                    </div>
                    <div className="bg-gray-50 rounded-lg p-2">
                      <p className="text-gray-500">Última sessão fechada</p>
                      <p className="font-bold text-gray-700 text-xs leading-tight">
                        {item.ultima_sessao_fechada ? fmtDateTime(item.ultima_sessao_fechada) : '—'}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}
