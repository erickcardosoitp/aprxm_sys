import { useEffect, useState } from 'react'
import api from '../../../services/api'
import toast from 'react-hot-toast'
import { fmt } from '../utils/formatters'
import { SUBTYPE_LABELS } from '../constants/financeiro'
import type { FinanceSummary, Tab } from '../types/financeiro'
import { ChevronDown, ChevronRight, RefreshCw } from 'lucide-react'

interface Props {
  period: string
  setPeriod: (p: string) => void
  onNavigate?: (tab: Tab) => void
}

interface BalanceSummary {
  entradas_caixa: number; entradas_manual: number
  saidas_caixa: number; saidas_manual: number
  total_entradas: number; total_saidas: number
  saldo_esperado: number; balance_start_date: string
}

interface BreakdownRow {
  label: string; entradas: number; saidas: number; saldo: number
  operador?: string; data?: string; status?: string
}

type BreakdownBy = 'day' | 'session' | 'operator'

export default function DashboardTab({ period, setPeriod, onNavigate }: Props) {
  const [summary, setSummary]           = useState<FinanceSummary | null>(null)
  const [loading, setLoading]           = useState(false)
  const [balance, setBalance]           = useState<BalanceSummary | null>(null)
  const [showDetail, setShowDetail]     = useState(false)
  const [breakdownBy, setBreakdownBy]   = useState<BreakdownBy>('day')
  const [breakdown, setBreakdown]       = useState<BreakdownRow[]>([])
  const [loadingBd, setLoadingBd]       = useState(false)

  const loadSummary = async () => {
    setLoading(true)
    try {
      const [resSum, resBal] = await Promise.all([
        api.get<FinanceSummary>('/financeiro/summary', { params: { period } }),
        api.get<BalanceSummary>('/finance/balance-summary'),
      ])
      setSummary(resSum.data)
      setBalance(resBal.data)
    } catch (e: any) {
      toast.error(e.response?.data?.detail ?? 'Erro ao carregar resumo.')
    } finally { setLoading(false) }
  }

  const loadBreakdown = async (by: BreakdownBy) => {
    setLoadingBd(true)
    try {
      const res = await api.get<BreakdownRow[]>('/finance/balance-breakdown', { params: { by } })
      setBreakdown(res.data)
    } catch { toast.error('Erro ao carregar detalhamento.') }
    finally { setLoadingBd(false) }
  }

  useEffect(() => { loadSummary() }, [period])

  const handleToggleDetail = () => {
    const next = !showDetail
    setShowDetail(next)
    if (next) loadBreakdown(breakdownBy)
  }

  const handleByChange = (by: BreakdownBy) => {
    setBreakdownBy(by)
    loadBreakdown(by)
  }

  const fmtDate = (d: string) => new Date(d + 'T12:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-2">
        {(['week', 'month', 'year'] as const).map(p => (
          <button key={p} onClick={() => setPeriod(p)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${period === p ? 'bg-[#26619c] text-white' : 'bg-gray-100 text-gray-600'}`}>
            {p === 'week' ? 'Semana' : p === 'month' ? 'Mês' : 'Ano'}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-center py-8 text-gray-400 text-sm">Carregando…</div>
      ) : summary ? (
        <div className="flex flex-col gap-3">

          {/* ── KPI Saldo Esperado do Caixa ── */}
          {balance && (
            <div className={`rounded-2xl border-2 overflow-hidden ${balance.saldo_esperado >= 0 ? 'border-[#26619c]/30 bg-gradient-to-br from-[#1a3f6f] to-[#26619c]' : 'border-red-300 bg-gradient-to-br from-red-700 to-red-500'}`}>
              <button onClick={handleToggleDetail} className="w-full text-left px-5 py-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-white/70 font-medium uppercase tracking-wide mb-0.5">
                      Saldo Esperado do Caixa
                    </p>
                    <p className="text-3xl font-bold text-white">{fmt(balance.saldo_esperado)}</p>
                    <p className="text-xs text-white/60 mt-1">
                      desde {new Date(balance.balance_start_date + 'T12:00').toLocaleDateString('pt-BR')}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    {showDetail
                      ? <ChevronDown className="w-5 h-5 text-white/80" />
                      : <ChevronRight className="w-5 h-5 text-white/80" />}
                  </div>
                </div>
                {/* Mini breakdown */}
                <div className="grid grid-cols-2 gap-3 mt-4">
                  <div className="bg-white/10 rounded-xl px-3 py-2">
                    <p className="text-[10px] text-white/60 uppercase">Entradas</p>
                    <p className="text-base font-bold text-green-300">{fmt(balance.total_entradas)}</p>
                    <p className="text-[10px] text-white/50">Caixa {fmt(balance.entradas_caixa)} · Manual {fmt(balance.entradas_manual)}</p>
                  </div>
                  <div className="bg-white/10 rounded-xl px-3 py-2">
                    <p className="text-[10px] text-white/60 uppercase">Saídas</p>
                    <p className="text-base font-bold text-red-300">{fmt(balance.total_saidas)}</p>
                    <p className="text-[10px] text-white/50">Caixa {fmt(balance.saidas_caixa)} · Manual {fmt(balance.saidas_manual)}</p>
                  </div>
                </div>
              </button>

              {/* Detalhamento */}
              {showDetail && (
                <div className="bg-white px-4 pb-4 pt-3 flex flex-col gap-3">
                  {/* Tabs */}
                  <div className="flex gap-1 bg-gray-100 p-1 rounded-xl">
                    {([['day','Por Dia'],['session','Por Sessão'],['operator','Por Operador']] as [BreakdownBy, string][]).map(([v, label]) => (
                      <button key={v} onClick={() => handleByChange(v)}
                        className={`flex-1 py-1.5 rounded-lg text-xs font-semibold transition ${breakdownBy === v ? 'bg-white text-[#26619c] shadow-sm' : 'text-gray-500'}`}>
                        {label}
                      </button>
                    ))}
                    <button onClick={() => loadBreakdown(breakdownBy)} className="px-2 text-gray-400 hover:text-gray-600">
                      <RefreshCw className={`w-3.5 h-3.5 ${loadingBd ? 'animate-spin' : ''}`} />
                    </button>
                  </div>

                  {/* Tabela */}
                  {loadingBd ? (
                    <div className="text-center py-4 text-gray-400 text-sm">Carregando…</div>
                  ) : breakdown.length === 0 ? (
                    <p className="text-center py-4 text-gray-400 text-sm">Nenhum dado.</p>
                  ) : (
                    <div className="overflow-x-auto rounded-xl border border-gray-200">
                      <table className="w-full text-xs">
                        <thead className="bg-[#1a3f6f] text-white">
                          <tr>
                            <th className="px-3 py-2 text-left font-semibold">
                              {breakdownBy === 'day' ? 'Data' : breakdownBy === 'session' ? 'Sessão' : 'Operador'}
                            </th>
                            <th className="px-3 py-2 text-right font-semibold text-green-300">Entradas</th>
                            <th className="px-3 py-2 text-right font-semibold text-red-300">Saídas</th>
                            <th className="px-3 py-2 text-right font-semibold">Saldo</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {breakdown.map((r, i) => (
                            <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}>
                              <td className="px-3 py-2 text-gray-700 max-w-[160px] truncate">
                                {breakdownBy === 'day' ? fmtDate(r.label) : r.label}
                                {r.status === 'open' && <span className="ml-1 text-[9px] bg-blue-100 text-blue-700 px-1 py-0.5 rounded">aberta</span>}
                              </td>
                              <td className="px-3 py-2 text-right text-green-700 font-medium tabular-nums">{fmt(r.entradas)}</td>
                              <td className="px-3 py-2 text-right text-red-600 font-medium tabular-nums">{fmt(r.saidas)}</td>
                              <td className={`px-3 py-2 text-right font-bold tabular-nums ${r.saldo >= 0 ? 'text-[#26619c]' : 'text-red-600'}`}>
                                {r.saldo >= 0 ? '+' : ''}{fmt(r.saldo)}
                              </td>
                            </tr>
                          ))}
                          {/* Total */}
                          <tr className="bg-gray-100 font-bold">
                            <td className="px-3 py-2 text-gray-800">Total</td>
                            <td className="px-3 py-2 text-right text-green-700 tabular-nums">{fmt(breakdown.reduce((s,r) => s+r.entradas, 0))}</td>
                            <td className="px-3 py-2 text-right text-red-600 tabular-nums">{fmt(breakdown.reduce((s,r) => s+r.saidas, 0))}</td>
                            <td className={`px-3 py-2 text-right tabular-nums ${balance.saldo_esperado >= 0 ? 'text-[#26619c]' : 'text-red-600'}`}>
                              {balance.saldo_esperado >= 0 ? '+' : ''}{fmt(balance.saldo_esperado)}
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Cards período */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
              <p className="text-xs text-gray-500 mb-1">Receitas</p>
              <p className="text-xl font-bold text-green-600">{fmt(summary.total_income)}</p>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
              <p className="text-xs text-gray-500 mb-1">Despesas</p>
              <p className="text-xl font-bold text-red-600">{fmt(summary.total_expense)}</p>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 col-span-2">
              <p className="text-xs text-gray-500 mb-1">Saldo do período</p>
              <p className={`text-2xl font-bold ${summary.total_balance >= 0 ? 'text-[#26619c]' : 'text-red-600'}`}>
                {fmt(summary.total_balance)}
              </p>
              <p className="text-xs text-gray-400 mt-1">{summary.transactions_count} transações · {summary.period_label}</p>
            </div>
          </div>

          {summary.income_by_type && Object.keys(summary.income_by_type).length > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
              <p className="text-xs font-semibold text-gray-600 mb-3">Receitas por tipo</p>
              <div className="flex flex-col gap-2">
                {Object.entries(summary.income_by_type).map(([type, total]) => (
                  <div key={type} className="flex items-center justify-between">
                    <span className="text-xs text-gray-600">{SUBTYPE_LABELS[type] ?? type}</span>
                    <span className="text-xs font-semibold text-green-700">{fmt(total)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            {(summary.contas_a_receber ?? 0) > 0 && (
              <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
                <p className="text-xs text-blue-600 mb-1">Contas a Receber</p>
                <p className="text-lg font-bold text-blue-800">{fmt(summary.contas_a_receber ?? 0)}</p>
                <p className="text-xs text-blue-500">{summary.contas_a_receber_count} mensalidade(s)</p>
              </div>
            )}
            {(summary.contas_a_receber_count ?? 0) > 0 && (
              <button onClick={() => onNavigate?.('cobrancas')}
                className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-left hover:bg-amber-100 transition">
                <p className="text-xs text-amber-600 mb-1">Ver Cobranças</p>
                <p className="text-lg font-bold text-amber-800">→</p>
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-400 text-sm">
          Nenhum dado disponível.
        </div>
      )}
    </div>
  )
}
