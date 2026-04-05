import { useEffect, useState } from 'react'
import { Users, Package, Wrench, Wallet } from 'lucide-react'
import api from '../../services/api'
import { useAuthStore } from '../../store/authStore'
import type { Resident, Package as Pkg, ServiceOrder, CashSession } from '../../types'

interface KpiData {
  activeMembers: number
  pendingPackages: number
  openOrders: number
  sessionOpen: boolean | null
}

interface RecentActivity {
  packages: Pkg[]
  orders: ServiceOrder[]
}

export default function OverviewPage() {
  const role = useAuthStore((s) => s.role)
  const isViewer = role === 'viewer'

  const [kpi, setKpi] = useState<KpiData | null>(null)
  const [activity, setActivity] = useState<RecentActivity>({ packages: [], orders: [] })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchAll = async () => {
      setLoading(true)
      try {
        const [residentsRes, packagesRes, ordersRes, sessionRes] = await Promise.allSettled([
          api.get<Resident[]>('/residents'),
          api.get<Pkg[]>('/packages'),
          api.get<ServiceOrder[]>('/service-orders'),
          api.get<CashSession>('/finance/session/current'),
        ])

        const residents = residentsRes.status === 'fulfilled' ? residentsRes.value.data : []
        const packages = packagesRes.status === 'fulfilled' ? packagesRes.value.data : []
        const orders = ordersRes.status === 'fulfilled' ? ordersRes.value.data : []
        const sessionOpen =
          sessionRes.status === 'fulfilled'
            ? sessionRes.value.data?.status === 'open'
            : sessionRes.status === 'rejected' && (sessionRes.reason as any)?.response?.status === 404
            ? false
            : null

        setKpi({
          activeMembers: residents.filter((r) => r.status === 'active').length,
          pendingPackages: packages.filter((p) => p.status === 'received' || p.status === 'notified').length,
          openOrders: orders.filter((o) => o.status === 'open' || o.status === 'in_progress').length,
          sessionOpen,
        })

        setActivity({
          packages: packages
            .sort((a, b) => new Date(b.received_at).getTime() - new Date(a.received_at).getTime())
            .slice(0, 5),
          orders: orders
            .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
            .slice(0, 3),
        })
      } finally {
        setLoading(false)
      }
    }

    fetchAll()
  }, [])

  const fmtDate = (s: string) =>
    new Date(s).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' })

  const PKG_STATUS_LABEL: Record<string, string> = {
    received: 'Recebida',
    notified: 'Notificada',
    delivered: 'Entregue',
    returned: 'Devolvida',
  }

  const ORDER_STATUS_LABEL: Record<string, string> = {
    pending: 'Pendente',
    open: 'Aberta',
    in_progress: 'Em andamento',
    waiting_third_party: 'Ag. Terceiros',
    resolved: 'Resolvida',
    archived: 'Arquivada',
    cancelled: 'Cancelada',
  }

  const ORDER_STATUS_COLOR: Record<string, string> = {
    open: 'bg-red-100 text-red-700',
    in_progress: 'bg-amber-100 text-amber-700',
    resolved: 'bg-green-100 text-green-700',
    cancelled: 'bg-gray-100 text-gray-500',
  }

  return (
    <div className="flex flex-col gap-6 p-4 max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900">Visão Geral</h1>

      {/* KPI Cards */}
      {loading ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="bg-gray-100 rounded-xl p-4 h-24 animate-pulse" />
          ))}
        </div>
      ) : kpi ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {/* Associados ativos */}
          <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4 text-[#26619c] shrink-0" />
              <p className="text-xs font-medium text-[#26619c] leading-tight">Associados ativos</p>
            </div>
            {isViewer ? (
              <p className="text-sm text-blue-300 font-medium">—</p>
            ) : (
              <p className="text-2xl font-bold text-[#26619c]">{kpi.activeMembers}</p>
            )}
          </div>

          {/* Encomendas pendentes */}
          <div className="bg-amber-50 border border-amber-100 rounded-xl p-4 flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <Package className="w-4 h-4 text-amber-600 shrink-0" />
              <p className="text-xs font-medium text-amber-700 leading-tight">Encomendas pendentes</p>
            </div>
            {isViewer ? (
              <p className="text-sm text-amber-300 font-medium">—</p>
            ) : (
              <p className="text-2xl font-bold text-amber-700">{kpi.pendingPackages}</p>
            )}
          </div>

          {/* Ordens abertas */}
          <div className="bg-red-50 border border-red-100 rounded-xl p-4 flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <Wrench className="w-4 h-4 text-red-600 shrink-0" />
              <p className="text-xs font-medium text-red-700 leading-tight">OS abertas</p>
            </div>
            {isViewer ? (
              <p className="text-sm text-red-300 font-medium">—</p>
            ) : (
              <p className="text-2xl font-bold text-red-700">{kpi.openOrders}</p>
            )}
          </div>

          {/* Sessão de caixa */}
          <div className={`border rounded-xl p-4 flex flex-col gap-2 ${kpi.sessionOpen ? 'bg-green-50 border-green-100' : 'bg-gray-50 border-gray-200'}`}>
            <div className="flex items-center gap-2">
              <Wallet className={`w-4 h-4 shrink-0 ${kpi.sessionOpen ? 'text-green-600' : 'text-gray-400'}`} />
              <p className={`text-xs font-medium leading-tight ${kpi.sessionOpen ? 'text-green-700' : 'text-gray-500'}`}>
                Sessão de caixa
              </p>
            </div>
            <p className={`text-sm font-bold ${kpi.sessionOpen ? 'text-green-700' : 'text-gray-500'}`}>
              {kpi.sessionOpen === null ? '—' : kpi.sessionOpen ? 'Aberta' : 'Fechada'}
            </p>
          </div>
        </div>
      ) : null}

      {/* Recent Activity */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Last 5 Packages */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
            <Package className="w-4 h-4 text-amber-500" />
            <h3 className="font-semibold text-gray-800 text-sm">Últimas Encomendas</h3>
          </div>
          {loading ? (
            <div className="p-6 text-center text-gray-400 text-sm">Carregando…</div>
          ) : activity.packages.length === 0 ? (
            <div className="p-6 text-center text-gray-400 text-sm">Nenhuma encomenda encontrada.</div>
          ) : (
            <ul className="divide-y divide-gray-100">
              {activity.packages.map((pkg) => (
                <li key={pkg.id} className="px-4 py-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-800 truncate">
                      {pkg.resident_name ?? pkg.unit ?? 'Destinatário não informado'}
                    </p>
                    <p className="text-xs text-gray-400">
                      {fmtDate(pkg.received_at)}
                      {pkg.carrier_name ? ` · ${pkg.carrier_name}` : ''}
                    </p>
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium shrink-0 ${
                    pkg.status === 'received' || pkg.status === 'notified'
                      ? 'bg-amber-100 text-amber-700'
                      : 'bg-gray-100 text-gray-500'
                  }`}>
                    {PKG_STATUS_LABEL[pkg.status] ?? pkg.status}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Last 3 Service Orders */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
            <Wrench className="w-4 h-4 text-red-500" />
            <h3 className="font-semibold text-gray-800 text-sm">Últimas Ordens de Serviço</h3>
          </div>
          {loading ? (
            <div className="p-6 text-center text-gray-400 text-sm">Carregando…</div>
          ) : activity.orders.length === 0 ? (
            <div className="p-6 text-center text-gray-400 text-sm">Nenhuma ordem encontrada.</div>
          ) : (
            <ul className="divide-y divide-gray-100">
              {activity.orders.map((order) => (
                <li key={order.id} className="px-4 py-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-800 truncate">
                      #{order.number} — {order.title}
                    </p>
                    <p className="text-xs text-gray-400">{fmtDate(order.created_at)}</p>
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium shrink-0 ${ORDER_STATUS_COLOR[order.status] ?? 'bg-gray-100 text-gray-500'}`}>
                    {ORDER_STATUS_LABEL[order.status] ?? order.status}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
