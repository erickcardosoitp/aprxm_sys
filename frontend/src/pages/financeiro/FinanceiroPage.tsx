import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { TrendingUp, X } from 'lucide-react'
import toast from 'react-hot-toast'
import { useAuthStore } from '../../store/authStore'
import { financeService } from '../../services/finance'
import { FinanceiroProvider, useFinanceiro } from './contexts/FinanceiroContext'
import { TABS } from './constants/financeiro'
import type { Tab } from './types/financeiro'
import DashboardTab from './tabs/DashboardTab'
import MovimentacoesTab from './tabs/MovimentacoesTab'
import CobrancasTab from './tabs/CobrancasTab'
import RelatoriosTab from './tabs/RelatoriosTab'
import TransferenciasTab from './tabs/TransferenciasTab'
import ConciliacaoTab from './tabs/ConciliacaoTab'
import DRETab from './tabs/DRETab'
import EsteiraTab from './tabs/EsteiraTab'
import PortaAPortaTab from './PortaAPortaTab'

function FinanceiroInner() {
  const location = useLocation()
  const role = useAuthStore(s => s.role)
  const isAdmin = ['admin', 'admin_master', 'superadmin'].includes(role ?? '')
  const { conferentes, operadores } = useFinanceiro()

  const [tab, setTab] = useState<Tab>('dashboard')
  const [period, setPeriod] = useState('month')

  // Admin close modal (shared: triggered from TransferenciasTab)
  const [adminCloseTarget, setAdminCloseTarget] = useState<{ id: string; operador: string } | null>(null)
  const [adminCloseBalance, setAdminCloseBalance] = useState('')
  const [adminClosing, setAdminClosing] = useState(false)

  // Navigate from PackagesPage
  const [cobrancasInit, setCobrancasInit] = useState<{ residentId?: string; residentName?: string }>({})

  useEffect(() => {
    const s = location.state as any
    if (s?.tab === 'cobrancas' && s?.residentId) {
      setTab('cobrancas')
      setCobrancasInit({ residentId: s.residentId, residentName: s.residentName ?? '' })
      window.history.replaceState({}, '')
    }
  }, [])

  const handleAdminClose = async () => {
    if (!adminCloseTarget) return
    const bal = parseFloat(adminCloseBalance)
    if (isNaN(bal) || bal < 0) { toast.error('Informe o valor contado.'); return }
    setAdminClosing(true)
    try {
      await financeService.closeSession(bal, undefined, adminCloseTarget.id)
      toast.success('Caixa fechado.')
      setAdminCloseTarget(null)
      setAdminCloseBalance('')
    } catch (e: any) {
      toast.error(e.response?.data?.detail ?? 'Erro ao fechar caixa.')
    } finally { setAdminClosing(false) }
  }

  const users = [...(conferentes ?? []), ...(operadores ?? [])].filter(
    (u: any, i: number, arr: any[]) => arr.findIndex((x: any) => x.id === u.id) === i
  )

  return (
    <div className="flex flex-col gap-4 p-4 sm:p-6 max-w-screen-2xl mx-auto w-full">
      <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
        <TrendingUp className="w-5 h-5 text-[#26619c]" />
        Financeiro
      </h1>

      {/* Tab navigation */}
      <div className="grid grid-cols-4 gap-1.5">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button key={key} onClick={() => setTab(key)}
            className={`flex flex-col items-center gap-1 px-2 py-3 rounded-xl text-[11px] font-semibold transition border ${
              tab === key
                ? 'bg-[#26619c] text-white border-[#26619c] shadow-md'
                : 'bg-white text-gray-500 border-gray-200 hover:border-[#26619c]/40 hover:text-[#26619c]'
            }`}>
            <Icon className={`w-5 h-5 ${tab === key ? 'text-white' : 'text-gray-400'}`} />
            <span className="text-center leading-tight">{label}</span>
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === 'dashboard' && (
        <DashboardTab period={period} setPeriod={setPeriod} onNavigate={setTab} />
      )}
      {tab === 'esteira' && <EsteiraTab />}
      {tab === 'movimentacoes' && (
        <MovimentacoesTab period={period} setPeriod={setPeriod} />
      )}
      {tab === 'cobrancas' && (
        <CobrancasTab
          initialResidentId={cobrancasInit.residentId}
          initialResidentName={cobrancasInit.residentName}
        />
      )}
      {tab === 'relatorios' && <RelatoriosTab />}
      {tab === 'dre' && <DRETab />}
      {tab === 'transferencias' && (
        <TransferenciasTab
          onRequestAdminClose={isAdmin ? setAdminCloseTarget : undefined}
        />
      )}
      {tab === 'conciliacao' && <ConciliacaoTab />}
      {tab === 'porta_a_porta' && <PortaAPortaTab users={users} />}

      {/* Admin close modal (global) */}
      {adminCloseTarget && (
        <div className="fixed inset-0 z-[70] bg-black/40 flex items-center justify-center p-4">
          <div className="w-full max-w-sm bg-white rounded-2xl shadow-2xl p-5 flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-gray-900">Fechar caixa de {adminCloseTarget.operador}</h3>
              <button onClick={() => setAdminCloseTarget(null)}><X className="w-5 h-5 text-gray-400" /></button>
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Valor contado (R$)</label>
              <input
                type="number" min="0" step="0.01"
                value={adminCloseBalance}
                onChange={e => setAdminCloseBalance(e.target.value)}
                placeholder="0,00"
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-300"
                autoFocus
              />
            </div>
            <button
              onClick={handleAdminClose}
              disabled={adminClosing || !adminCloseBalance}
              className="w-full bg-red-600 text-white rounded-xl py-2.5 text-sm font-semibold disabled:opacity-50">
              {adminClosing ? 'Fechando…' : 'Confirmar fechamento'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default function FinanceiroPage() {
  return (
    <FinanceiroProvider>
      <FinanceiroInner />
    </FinanceiroProvider>
  )
}
